// Núcleo do Telemetria Status: regras puras, sem acesso à rede nem à tela.
// O mesmo arquivo é usado pelo verificador (Node, no GitHub Actions) e pelo painel (navegador).
// Os conceitos vêm da Central de Telemetria: debounce de quedas, incidentes, SLA, MTTR e oscilação.

export const REGRAS = Object.freeze({
  falhasParaFora: 2,          // debounce: só declara "fora" depois de 2 verificações seguidas com falha
  maxAmostras: 96,            // 96 verificações = 24 h com uma verificação a cada 15 min
  diasRetencao: 90,           // histórico diário mantido para o SLA de 90 dias
  maxIncidentes: 100,         // incidentes guardados (abertos e encerrados)
  limiteLentoPadraoMs: 2000,  // acima disso a resposta é considerada lenta
  janelaOscilacao: 12,        // últimas 12 verificações (3 h)
  trocasOscilacao: 4,         // 4 ou mais trocas entre ok/falha na janela = oscilando
});

export const ESTADOS = Object.freeze({
  operacional: { rotulo: 'Operacional', nivel: 0 },
  lento: { rotulo: 'Lento', nivel: 1 },
  instavel: { rotulo: 'Instável', nivel: 2 },
  fora: { rotulo: 'Fora do ar', nivel: 3 },
  desconhecido: { rotulo: 'Aguardando verificação', nivel: -1 },
});

export const CATEGORIAS = Object.freeze([
  'Comunicação', 'Redes sociais', 'Governo', 'Bancos e pagamentos', 'Compras',
  'Nuvem e desenvolvimento', 'Entretenimento', 'Trabalho',
]);

// Data local (Brasília) no formato AAAA-MM-DD, usada para agrupar o histórico por dia.
export function diaLocal(ms) {
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

export function statusVazio() {
  return { versao: 1, atualizado_em: null, servicos: {}, incidentes: [] };
}

// Resultado de uma verificação: { ok, ms, http, erro }. Devolve 'operacional', 'lento' ou 'falha'.
export function classificar(resultado, servico, regras = REGRAS) {
  if (!resultado || !resultado.ok) return 'falha';
  const limite = servico.limite_lento_ms ?? regras.limiteLentoPadraoMs;
  return resultado.ms > limite ? 'lento' : 'operacional';
}

function novoServico() {
  return { estado: 'desconhecido', desde: null, falhas_seguidas: 0, primeira_falha: null, ultima: null, amostras: [], dias: {} };
}

// Aplica uma verificação ao estado de um serviço. Função pura: devolve o novo estado e os eventos.
export function aplicarVerificacao(atual, resultado, servico, agora, regras = REGRAS) {
  const s = structuredClone(atual ?? novoServico());
  const eventos = [];
  const classe = classificar(resultado, servico, regras);
  const ok = classe !== 'falha';
  const anterior = s.estado;

  let estado;
  if (ok) {
    estado = classe;
    if (anterior === 'fora') eventos.push({ tipo: 'fechar', em: agora });
    s.falhas_seguidas = 0;
    s.primeira_falha = null;
  } else {
    s.falhas_seguidas += 1;
    if (s.falhas_seguidas === 1) s.primeira_falha = agora;
    estado = s.falhas_seguidas >= regras.falhasParaFora ? 'fora' : 'instavel';
    if (estado === 'fora' && anterior !== 'fora') {
      eventos.push({ tipo: 'abrir', em: s.primeira_falha, motivo: descreverFalha(resultado) });
    }
  }

  if (estado !== anterior) s.desde = agora;
  s.estado = estado;
  s.ultima = { em: agora, ok, ms: resultado?.ms ?? null, http: resultado?.http ?? null, erro: resultado?.erro ?? null };

  // Tempo de resposta só é guardado quando houve resposta válida (falhas não entram na média).
  s.amostras.push([Math.round(agora / 1000), ok ? 1 : 0, ok ? (resultado?.ms ?? null) : null]);
  if (s.amostras.length > regras.maxAmostras) s.amostras = s.amostras.slice(-regras.maxAmostras);

  const dia = diaLocal(agora);
  const reg = s.dias[dia] ?? [0, 0, 0];
  reg[0] += 1;
  if (ok) { reg[1] += 1; reg[2] += resultado.ms ?? 0; }
  s.dias[dia] = reg;
  const corte = diaLocal(agora - (regras.diasRetencao - 1) * 864e5);
  for (const d of Object.keys(s.dias)) if (d < corte) delete s.dias[d];

  return { servico: s, eventos };
}

export function descreverFalha(r) {
  if (!r) return 'Sem resposta';
  if (r.erro) return r.erro;
  if (r.http) return `Resposta HTTP ${r.http}`;
  return 'Falha na verificação';
}

// Aplica uma rodada de verificações a todos os serviços da configuração.
export function atualizarStatus(status, servicos, resultados, agora, regras = REGRAS) {
  const novo = structuredClone(status ?? statusVazio());
  const ids = new Set(servicos.map((s) => s.id));
  for (const id of Object.keys(novo.servicos)) if (!ids.has(id)) delete novo.servicos[id];

  for (const sv of servicos) {
    const r = resultados[sv.id];
    if (!r) continue;
    const { servico, eventos } = aplicarVerificacao(novo.servicos[sv.id], r, sv, agora, regras);
    novo.servicos[sv.id] = servico;
    for (const ev of eventos) {
      if (ev.tipo === 'abrir') {
        novo.incidentes.unshift({ id: `${sv.id}-${ev.em}`, servico: sv.id, inicio: ev.em, fim: null, motivo: ev.motivo });
      } else {
        const aberto = novo.incidentes.find((i) => i.servico === sv.id && i.fim === null);
        if (aberto) { aberto.fim = ev.em; aberto.duracao_s = Math.round((ev.em - aberto.inicio) / 1000); }
      }
    }
  }
  novo.incidentes = novo.incidentes.slice(0, regras.maxIncidentes);
  novo.atualizado_em = agora;
  return novo;
}

// Disponibilidade (%) nos últimos N dias, a partir do histórico diário. null = sem dados.
export function disponibilidadeDias(dias, n, agora) {
  let total = 0, ok = 0;
  for (let i = 0; i < n; i++) {
    const r = dias?.[diaLocal(agora - i * 864e5)];
    if (r) { total += r[0]; ok += r[1]; }
  }
  return total ? (ok / total) * 100 : null;
}

// Disponibilidade (%) nas últimas 24 h, a partir das amostras.
export function disponibilidade24h(amostras, agora) {
  const desde = agora / 1000 - 86400;
  const janela = (amostras ?? []).filter((a) => a[0] >= desde);
  if (!janela.length) return null;
  return (janela.reduce((t, a) => t + a[1], 0) / janela.length) * 100;
}

export function latenciaMedia(amostras, n = 12) {
  const v = (amostras ?? []).slice(-n).map((a) => a[2]).filter((x) => x != null && x >= 0);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

// Tempo médio de recuperação (MTTR), em segundos, dos incidentes encerrados de um serviço.
export function mttr(incidentes, servicoId) {
  const enc = (incidentes ?? []).filter((i) => i.servico === servicoId && i.fim != null);
  if (!enc.length) return null;
  return Math.round(enc.reduce((t, i) => t + (i.fim - i.inicio), 0) / enc.length / 1000);
}

// Oscilação (flapping): muitas trocas entre ok e falha nas últimas verificações.
export function oscilando(amostras, regras = REGRAS) {
  const j = (amostras ?? []).slice(-regras.janelaOscilacao);
  let trocas = 0;
  for (let i = 1; i < j.length; i++) if (j[i][1] !== j[i - 1][1]) trocas++;
  return trocas >= regras.trocasOscilacao;
}

export function resumoGeral(status, servicos) {
  const cont = { operacional: 0, lento: 0, instavel: 0, fora: 0, desconhecido: 0 };
  for (const sv of servicos) cont[status?.servicos?.[sv.id]?.estado ?? 'desconhecido'] += 1;
  const problemas = cont.lento + cont.instavel + cont.fora;
  const nivel = cont.fora > 0 ? 'grave' : problemas > 0 ? 'parcial' : 'ok';
  return { total: servicos.length, ...cont, problemas, nivel };
}

export function formatarDuracao(seg) {
  if (seg == null) return '—';
  if (seg < 60) return `${seg} s`;
  const m = Math.floor(seg / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

export function formatarPercentual(p) {
  if (p == null) return '—';
  if (p >= 99.995) return '100%';
  return `${p.toFixed(2).replace('.', ',')}%`;
}
