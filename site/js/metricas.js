// Página de métricas DORA: lê dados/dora.json (gerado pelo monitoramento a partir do GitHub Actions).
const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v;
    else if (k === 'altura') n.style.height = v; // via CSSOM: permitido pela CSP (sem estilo inline)
    else n.setAttribute(k, v);
  }
  n.append(...filhos.filter((f) => f != null && f !== false));
  return n;
}

const ROTULOS = { elite: 'Elite', alta: 'Alta', media: 'Média', baixa: 'Baixa', sem_dados: 'Sem dados' };
const RESULTADOS = {
  success: ['Sucesso', 'ok'], failure: ['Falhou', 'crit'], cancelled: ['Cancelada', 'mudo'],
  em_andamento: ['Em andamento', 'info'], timed_out: ['Tempo esgotado', 'crit'],
};

export function formatarTempo(ms) {
  if (ms == null) return '—';
  const min = Math.round(ms / 60_000);
  if (min < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (min < 60) return `${min} min`;
  const h = ms / 3_600_000;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0).replace('.', ',')} h`;
  return `${(h / 24).toFixed(1).replace('.', ',')} dias`;
}

const num = (x, casas = 1) => x.toFixed(casas).replace('.', ',');
const quando = (ms) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

function cartao(id, valor, nivel, detalhe) {
  const c = $(id);
  c.querySelector('.valor').textContent = valor;
  const n = c.querySelector('.nivel');
  n.textContent = ROTULOS[nivel] ?? nivel;
  n.className = `nivel ${nivel}`;
  c.querySelector('.detalhe').textContent = detalhe;
}

function desenhar(d) {
  $('m-atualizado').textContent = `Atualizado em ${quando(Date.parse(d.gerado_em))}`;
  $('m-janela').textContent = `últimos ${d.janela_dias} dias`;

  const f = d.frequencia;
  cartao('c-frequencia', f.por_dia == null ? '—' : `${num(f.por_dia >= 1 ? f.por_dia : f.por_semana)} ${f.por_dia >= 1 ? 'por dia' : 'por semana'}`,
    f.nivel, `${f.deploys} deploys com sucesso em ${d.janela_dias} dias`);
  const l = d.lead_time;
  cartao('c-lead', formatarTempo(l.mediana_ms), l.nivel, l.amostras ? `mediana de ${l.amostras} deploys` : 'nenhum deploy no período');
  const t = d.taxa_falha;
  cartao('c-falha', t.percentual == null ? '—' : `${num(t.percentual)}%`, t.nivel,
    t.tentativas ? `${t.falhas} de ${t.tentativas} mudanças${t.rollbacks ? ` (${t.rollbacks} rollback${t.rollbacks > 1 ? 's' : ''})` : ''}` : 'nenhuma mudança no período');
  const r = d.recuperacao;
  cartao('c-recuperacao', formatarTempo(r.mediana_ms), r.nivel,
    r.incidentes ? `${r.incidentes} recuperação(ões)${r.em_aberto ? ' · há uma falha em aberto agora' : ''}` : (r.em_aberto ? 'há uma falha em aberto agora' : 'nenhuma falha no período'));

  const maior = Math.max(1, ...d.serie.map((s) => s.sucesso + s.falha));
  $('serie').replaceChildren(...d.serie.map((s) => {
    const total = s.sucesso + s.falha;
    const titulo = `${s.dia.split('-').reverse().join('/')}: ${s.sucesso} com sucesso, ${s.falha} com falha`;
    return el('div', { class: 'coluna', title: titulo },
      el('span', { class: 'parte crit', altura: `${(s.falha / maior) * 100}%` }),
      el('span', { class: 'parte ok', altura: `${(s.sucesso / maior) * 100}%` }),
      total ? null : el('span', { class: 'vazio' }));
  }));
  $('serie-inicio').textContent = `${d.janela_dias} dias atrás`;

  $('recentes').replaceChildren(...(d.recentes.length ? d.recentes.map((e) => {
    const [rot, cls] = RESULTADOS[e.resultado] ?? [e.resultado, 'mudo'];
    const nome = e.tipo === 'rollback' ? `Rollback #${e.numero}` : `Pipeline #${e.numero}`;
    return el('tr', {},
      el('td', {}, el('a', { href: e.url, target: '_blank', rel: 'noopener', text: nome })),
      el('td', {}, el('code', { text: e.commit ?? '' }), ' ', el('span', { class: 'mudo', text: e.mensagem })),
      el('td', {}, el('span', { class: `selo ${cls}`, text: rot })),
      el('td', { text: formatarTempo(e.duracao_ms) }),
      el('td', { text: quando(e.inicio) }));
  }) : [el('tr', {}, el('td', { colspan: '5', class: 'mudo', text: 'Nenhuma execução no período.' }))]));
}

async function carregar() {
  try {
    const r = await fetch(`../dados/dora.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    desenhar(await r.json());
  } catch {
    $('m-atualizado').textContent = '';
    const aviso = $('m-aviso');
    aviso.textContent = 'As métricas aparecem depois da próxima execução do monitoramento (a cada 15 minutos). Para gerar agora: Actions → Monitoramento → Run workflow.';
    aviso.classList.remove('oculto');
    $('recentes').replaceChildren(el('tr', {}, el('td', { colspan: '5', class: 'mudo', text: 'Sem dados ainda.' })));
  }
}

carregar();
