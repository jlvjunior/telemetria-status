// Métricas DORA (DevOps Research and Assessment), calculadas a partir do histórico real do GitHub Actions.
// - Frequência de deploy: quantas vezes a produção recebeu uma versão nova (pipeline ou rollback).
// - Tempo de entrega (lead time): do commit até a versão estar no ar.
// - Taxa de falha de mudanças: execuções na main que falharam + rollbacks, sobre o total de mudanças.
// - Tempo de recuperação: da primeira falha até a produção voltar a ter um deploy bem-sucedido.

const HORA = 3_600_000;
const DIA = 24 * HORA;

export const NIVEIS = {
  elite: { rotulo: 'Elite', ordem: 4 },
  alta: { rotulo: 'Alta', ordem: 3 },
  media: { rotulo: 'Média', ordem: 2 },
  baixa: { rotulo: 'Baixa', ordem: 1 },
  sem_dados: { rotulo: 'Sem dados', ordem: 0 },
};

export function mediana(valores) {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Faixas de referência do relatório State of DevOps (DORA).
export function nivelFrequencia(porDia) {
  if (porDia == null) return 'sem_dados';
  if (porDia >= 1) return 'elite';          // sob demanda, várias vezes por dia
  if (porDia >= 1 / 7) return 'alta';       // entre uma vez por dia e uma por semana
  if (porDia >= 1 / 30) return 'media';     // entre uma vez por semana e uma por mês
  return 'baixa';
}
export function nivelLeadTime(ms) {
  if (ms == null) return 'sem_dados';
  if (ms < DIA) return 'elite';
  if (ms < 7 * DIA) return 'alta';
  if (ms < 30 * DIA) return 'media';
  return 'baixa';
}
export function nivelFalhas(pct) {
  if (pct == null) return 'sem_dados';
  if (pct <= 5) return 'elite';
  if (pct <= 10) return 'alta';
  if (pct <= 15) return 'media';
  return 'baixa';
}
export function nivelRecuperacao(ms) {
  if (ms == null) return 'sem_dados';
  if (ms < HORA) return 'elite';
  if (ms < DIA) return 'alta';
  if (ms < 7 * DIA) return 'media';
  return 'baixa';
}

const ms = (iso) => (iso ? Date.parse(iso) : NaN);

// Converte uma execução da API do GitHub no formato usado aqui.
export function normalizarExecucao(run, tipo) {
  const fim = ms(run.updated_at);
  const inicio = ms(run.run_started_at ?? run.created_at);
  return {
    tipo, // 'pipeline' | 'rollback'
    numero: run.run_number,
    url: run.html_url,
    evento: run.event,
    commit: run.head_sha,
    mensagem: String(run.head_commit?.message ?? run.display_title ?? '').split('\n')[0].slice(0, 120),
    commit_em: ms(run.head_commit?.timestamp),
    inicio,
    fim,
    duracao_ms: Number.isFinite(fim - inicio) ? fim - inicio : null,
    resultado: run.status !== 'completed' ? 'em_andamento' : run.conclusion, // success | failure | cancelled | …
  };
}

export function calcularDora(execucoes, agora = Date.now(), dias = 30) {
  const desde = agora - dias * DIA;
  const concluidas = execucoes
    .filter((e) => e.resultado !== 'em_andamento' && e.resultado !== 'cancelled' && e.resultado !== 'skipped')
    .filter((e) => Number.isFinite(e.fim) && e.fim >= desde && e.fim <= agora)
    .sort((a, b) => a.fim - b.fim);

  const deploys = concluidas.filter((e) => e.resultado === 'success');
  const pipelines = concluidas.filter((e) => e.tipo === 'pipeline');
  const falhasPipeline = pipelines.filter((e) => e.resultado !== 'success');
  const rollbacks = concluidas.filter((e) => e.tipo === 'rollback' && e.resultado === 'success');

  // Frequência
  const porDia = concluidas.length ? deploys.length / dias : null;

  // Lead time: só deploys do pipeline (o rollback não leva um commit novo).
  const leads = deploys.filter((e) => e.tipo === 'pipeline').map((e) => e.fim - e.commit_em).filter((x) => x >= 0);
  const leadTime = mediana(leads);

  // Taxa de falha: falhas do pipeline + mudanças desfeitas por rollback, sobre as mudanças tentadas.
  const tentativas = pipelines.length;
  const falhas = falhasPipeline.length + rollbacks.length;
  const taxaFalha = tentativas ? Math.min(100, (falhas / tentativas) * 100) : null;

  // Recuperação: cada sequência de falhas vira um incidente, que termina no próximo deploy bem-sucedido.
  const recuperacoes = [];
  let inicioIncidente = null;
  for (const e of concluidas) {
    const falhou = (e.tipo === 'pipeline' && e.resultado !== 'success');
    if (falhou && inicioIncidente == null) inicioIncidente = e.fim;
    if (e.tipo === 'rollback' && e.resultado === 'success') {
      // O rollback é a própria recuperação de uma versão ruim: conta o tempo da execução.
      recuperacoes.push(inicioIncidente != null ? e.fim - inicioIncidente : e.duracao_ms ?? 0);
      inicioIncidente = null;
    } else if (e.resultado === 'success' && inicioIncidente != null) {
      recuperacoes.push(e.fim - inicioIncidente);
      inicioIncidente = null;
    }
  }
  const recuperacao = mediana(recuperacoes);

  // Deploys por dia (para o gráfico).
  const serie = [];
  for (let i = dias - 1; i >= 0; i--) {
    const inicioDia = new Date(agora - i * DIA);
    const chave = inicioDia.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    serie.push({ dia: chave, sucesso: 0, falha: 0 });
  }
  const indice = new Map(serie.map((d, i) => [d.dia, i]));
  for (const e of concluidas) {
    const chave = new Date(e.fim).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const i = indice.get(chave);
    if (i == null) continue;
    if (e.resultado === 'success') serie[i].sucesso++;
    else serie[i].falha++;
  }

  const recentes = [...execucoes]
    .filter((e) => Number.isFinite(e.inicio))
    .sort((a, b) => b.inicio - a.inicio)
    .slice(0, 15)
    .map((e) => ({ ...e, commit: e.commit?.slice(0, 7) ?? null }));

  return {
    gerado_em: new Date(agora).toISOString(),
    janela_dias: dias,
    frequencia: { deploys: deploys.length, por_dia: porDia, por_semana: porDia == null ? null : porDia * 7, nivel: nivelFrequencia(porDia) },
    lead_time: { mediana_ms: leadTime, amostras: leads.length, nivel: nivelLeadTime(leadTime) },
    taxa_falha: { percentual: taxaFalha, falhas, tentativas, rollbacks: rollbacks.length, nivel: nivelFalhas(taxaFalha) },
    recuperacao: { mediana_ms: recuperacao, incidentes: recuperacoes.length, em_aberto: inicioIncidente != null, nivel: recuperacoes.length ? nivelRecuperacao(recuperacao) : 'sem_dados' },
    serie,
    recentes,
  };
}
