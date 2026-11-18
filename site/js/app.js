// Painel do Telemetria Status: lê os dados publicados pelo pipeline e monta a tela.
import {
  ESTADOS, CATEGORIAS, resumoGeral, disponibilidade24h, disponibilidadeDias, latenciaMedia,
  mttr, oscilando, formatarDuracao, formatarPercentual, diaLocal, statusVazio,
} from './nucleo.js';

const $ = (id) => document.getElementById(id);
const estado = { servicos: [], status: statusVazio(), info: null, filtros: { busca: '', categoria: '', estado: '' } };

function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null) e.append(f);
  return e;
}

const fmtData = (ms) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

const fmtHora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

function haQuanto(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'agora há pouco';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `há ${h} h` : fmtData(ms);
}

async function buscar(caminho) {
  const r = await fetch(`${caminho}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  return r.json();
}

async function carregar(manual = false) {
  const botao = $('btn-atualizar');
  botao.disabled = true;
  botao.textContent = 'Atualizando…';
  try {
    const [servicos, status, info] = await Promise.all([
      buscar('config/servicos.json'),
      buscar('dados/status.json').catch(() => statusVazio()),
      buscar('build-info.json').catch(() => null),
    ]);
    const novidade = estado.status.atualizado_em !== status.atualizado_em;
    Object.assign(estado, { servicos, status, info });
    desenhar();
    if (manual) avisarAtualizacao(novidade);
  } catch (e) {
    $('faixa-titulo').textContent = 'Não foi possível carregar os dados.';
    $('faixa-detalhe').textContent = e.message;
  } finally {
    botao.disabled = false;
    botao.textContent = 'Atualizar';
  }
}

// Retorno visível do botão Atualizar: os dados só mudam quando o monitoramento roda.
function avisarAtualizacao(novidade) {
  const ult = estado.status.atualizado_em;
  const prox = ult ? fmtHora(ult + 15 * 60 * 1000) : null;
  $('atualizado').textContent = novidade
    ? `Dados novos carregados · verificação de ${ult ? fmtHora(ult) : '—'}`
    : `Já está atualizado (verificação de ${ult ? fmtHora(ult) : '—'})${prox ? ` · próxima prevista por volta de ${prox}` : ''}`;
}

function barrasAmostras(amostras, servico, n = 48) {
  const ultimas = (amostras ?? []).slice(-n);
  const limite = servico.limite_lento_ms ?? 2000;
  const vazias = Array.from({ length: n - ultimas.length }, () => el('span', { title: 'Sem verificação' }));
  const cheias = ultimas.map(([t, ok, ms]) => {
    const classe = !ok ? 'b-falha' : ms > limite ? 'b-lento' : 'b-ok';
    const texto = `${fmtData(t * 1000)} — ${ok ? `${ms} ms` : 'falha'}`;
    return el('span', { class: classe, title: texto });
  });
  return el('div', { class: 'barras', role: 'img', 'aria-label': `Últimas ${ultimas.length} verificações` }, vazias, cheias);
}

function filtrar(servicos) {
  const { busca, categoria, estado: est } = estado.filtros;
  const b = busca.trim().toLowerCase();
  return servicos.filter((sv) => {
    const e = estado.status.servicos[sv.id]?.estado ?? 'desconhecido';
    return (!b || sv.nome.toLowerCase().includes(b))
      && (!categoria || sv.categoria === categoria)
      && (!est || (est === 'problema' ? ['lento', 'instavel', 'fora'].includes(e) : e === est));
  });
}

function desenhar() {
  const { servicos, status, info } = estado;
  const agora = Date.now();
  const r = resumoGeral(status, servicos);

  const faixa = $('faixa');
  faixa.className = `faixa ${r.desconhecido === r.total ? '' : r.nivel}`;
  $('faixa-titulo').textContent = r.desconhecido === r.total
    ? 'Aguardando a primeira verificação'
    : r.nivel === 'ok' ? 'Todos os serviços estão operando normalmente'
      : r.fora ? `${r.fora} ${r.fora === 1 ? 'serviço fora do ar' : 'serviços fora do ar'}`
        : `${r.problemas} ${r.problemas === 1 ? 'serviço com lentidão ou instabilidade' : 'serviços com lentidão ou instabilidade'}`;
  $('faixa-detalhe').textContent = r.problemas && r.fora && r.problemas > r.fora ? `e ${r.problemas - r.fora} com lentidão ou instabilidade` : '';

  const slas = servicos.map((sv) => disponibilidade24h(status.servicos[sv.id]?.amostras, agora)).filter((x) => x != null);
  $('i-total').textContent = r.total;
  $('i-ok').textContent = r.operacional;
  $('i-alerta').textContent = r.lento + r.instavel;
  $('i-fora').textContent = r.fora;
  $('i-sla').textContent = slas.length ? formatarPercentual(slas.reduce((a, b) => a + b, 0) / slas.length) : '—';
  $('i-incidentes').textContent = status.incidentes.filter((i) => i.fim === null).length;
  $('atualizado').textContent = status.atualizado_em ? `Última verificação ${haQuanto(status.atualizado_em)}` : 'Sem verificações ainda';

  const visiveis = filtrar(servicos)
    .sort((a, b) => (ESTADOS[status.servicos[b.id]?.estado ?? 'desconhecido'].nivel - ESTADOS[status.servicos[a.id]?.estado ?? 'desconhecido'].nivel) || a.nome.localeCompare(b.nome));
  $('grade').replaceChildren(...visiveis.map((sv) => cartao(sv, agora)));
  $('vazio').classList.toggle('oculto', visiveis.length > 0);

  const nomes = Object.fromEntries(servicos.map((s) => [s.id, s.nome]));
  const lista = status.incidentes.slice(0, 15).map((i) => el('li', {},
    el('span', { class: `pill ${i.fim ? 'operacional' : 'fora'}`, text: i.fim ? 'Resolvido' : 'Em andamento' }),
    el('strong', { text: nomes[i.servico] ?? i.servico }),
    el('span', { class: 'quando', text: `${fmtData(i.inicio)} · ${i.fim ? `durou ${formatarDuracao(i.duracao_s)}` : `há ${formatarDuracao(Math.round((agora - i.inicio) / 1000))}`}` }),
    el('span', { class: 'motivo', text: i.motivo })));
  $('incidentes').replaceChildren(...(lista.length ? lista : [el('li', {}, el('span', { class: 'mudo', text: 'Nenhum incidente registrado.' }))]));

  $('versao').replaceChildren(info
    ? `Publicado pelo pipeline CI/CD · versão ${info.versao} · commit ${String(info.commit).slice(0, 7)}${info.execucao ? ` · execução #${info.execucao}` : ''} · ${fmtData(Date.parse(info.gerado_em))}`
    : 'Versão local');
  if (info?.repositorio) {
    $('versao').append(' · ', el('a', { href: `https://github.com/${info.repositorio}/actions`, text: 'ver o pipeline' }));
  }
}

function cartao(sv, agora) {
  const s = estado.status.servicos[sv.id];
  const est = s?.estado ?? 'desconhecido';
  const sla = disponibilidade24h(s?.amostras, agora);
  const lat = latenciaMedia(s?.amostras);
  const b = el('button', { type: 'button', class: `card ${est}`, 'aria-label': `${sv.nome}: ${ESTADOS[est].rotulo}. Ver detalhes.` },
    el('div', { class: 'linha' }, el('span', { class: 'nome', text: sv.nome }), el('span', { class: `pill ${est}`, text: ESTADOS[est].rotulo })),
    el('div', { class: 'linha' },
      el('span', { class: 'cat', text: sv.categoria }),
      oscilando(s?.amostras) ? el('span', { class: 'tag-osc', text: 'oscilando' }) : null),
    barrasAmostras(s?.amostras, sv),
    el('div', { class: 'linha' },
      el('span', { class: 'num', text: `24 h: ${formatarPercentual(sla)}` }),
      el('span', { class: 'num', text: lat != null ? `${lat} ms` : '—' })));
  b.addEventListener('click', () => abrirDetalhe(sv));
  return b;
}

function abrirDetalhe(sv) {
  const agora = Date.now();
  const s = estado.status.servicos[sv.id];
  const est = s?.estado ?? 'desconhecido';
  const incid = estado.status.incidentes.filter((i) => i.servico === sv.id);
  $('d-nome').textContent = sv.nome;
  $('d-sub').textContent = `${sv.categoria} · ${sv.url}`;

  const met = (rot, val) => el('div', {}, el('span', { text: rot }), el('strong', { text: val }));
  const metricas = el('div', { class: 'metricas' },
    met('Situação', ESTADOS[est].rotulo),
    met('Há quanto tempo', s?.desde ? formatarDuracao(Math.round((agora - s.desde) / 1000)) : '—'),
    met('24 horas', formatarPercentual(disponibilidade24h(s?.amostras, agora))),
    met('7 dias', formatarPercentual(disponibilidadeDias(s?.dias, 7, agora))),
    met('30 dias', formatarPercentual(disponibilidadeDias(s?.dias, 30, agora))),
    met('90 dias', formatarPercentual(disponibilidadeDias(s?.dias, 90, agora))),
    met('Tempo de resposta médio', latenciaMedia(s?.amostras) != null ? `${latenciaMedia(s?.amostras)} ms` : '—'),
    met('Tempo médio de recuperação', formatarDuracao(mttr(estado.status.incidentes, sv.id))),
    met('Última verificação', s?.ultima ? fmtHora(s.ultima.em) : '—'),
    met('Última resposta', s?.ultima ? (s.ultima.http ? `HTTP ${s.ultima.http}` : 'sem resposta') : '—'));

  const dias = Array.from({ length: 90 }, (_, i) => {
    const d = diaLocal(agora - (89 - i) * 864e5);
    const r = s?.dias?.[d];
    if (!r) return el('span', { title: `${d}: sem dados` });
    const p = (r[1] / r[0]) * 100;
    const classe = p >= 99.9 ? 'b-ok' : p >= 95 ? 'b-parcial' : 'b-falha';
    return el('span', { class: classe, title: `${d}: ${formatarPercentual(p)} (${r[0]} verificações)` });
  });

  const lista = incid.slice(0, 8).map((i) => el('li', {},
    el('span', { class: `pill ${i.fim ? 'operacional' : 'fora'}`, text: i.fim ? 'Resolvido' : 'Em andamento' }),
    el('span', { text: fmtData(i.inicio) }),
    el('span', { class: 'quando', text: i.fim ? `durou ${formatarDuracao(i.duracao_s)}` : 'em andamento' }),
    el('span', { class: 'motivo', text: i.motivo })));

  $('d-corpo').replaceChildren(
    metricas,
    el('div', { class: 'bloco' }, el('h3', { text: 'Últimas 24 horas' }), barrasAmostras(s?.amostras, sv, 96),
      el('div', { class: 'eixo' }, el('span', { text: '24 h atrás' }), el('span', { text: 'agora' }))),
    el('div', { class: 'bloco' }, el('h3', { text: 'Disponibilidade diária (90 dias)' }),
      el('div', { class: 'barras altas', role: 'img', 'aria-label': 'Disponibilidade por dia nos últimos 90 dias' }, dias),
      el('div', { class: 'eixo' }, el('span', { text: '90 dias atrás' }), el('span', { text: 'hoje' }))),
    el('div', { class: 'bloco' }, el('h3', { text: 'Incidentes' }),
      lista.length ? el('ul', { class: 'incidentes' }, lista) : el('p', { class: 'mudo', text: 'Nenhum incidente registrado para este serviço.' })));
  $('detalhe').showModal();
}

function iniciar() {
  const sel = $('f-categoria');
  for (const c of CATEGORIAS) sel.append(el('option', { value: c, text: c }));
  $('f-busca').addEventListener('input', (e) => { estado.filtros.busca = e.target.value; desenhar(); });
  sel.addEventListener('change', (e) => { estado.filtros.categoria = e.target.value; desenhar(); });
  $('f-estado').addEventListener('change', (e) => { estado.filtros.estado = e.target.value; desenhar(); });
  $('btn-atualizar').addEventListener('click', () => carregar(true));
  $('d-fechar').addEventListener('click', () => $('detalhe').close());
  $('detalhe').addEventListener('click', (e) => { if (e.target === $('detalhe')) $('detalhe').close(); });
  carregar();
  setInterval(carregar, 60_000);
}

iniciar();
