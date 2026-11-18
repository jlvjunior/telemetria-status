// Área de gestão: lista, adiciona, edita e remove serviços.
// As regras de validação são as mesmas do pipeline (nucleo.js), então o erro aparece aqui antes do commit.
import { CATEGORIAS, validarServicos, gerarId } from './nucleo.js';

const $ = (id) => document.getElementById(id);
const API = 'api/servicos';
const estado = { original: [], lista: [], sha: null, repo: null, salvarDireto: false, editando: null, busca: '' };

function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  n.append(...filhos.filter(Boolean));
  return n;
}

const copia = (x) => JSON.parse(JSON.stringify(x));
const semBarra = (u) => String(u).replace(/\/+$/, '').toLowerCase();

function avisar(texto, tipo = 'info', link) {
  const a = $('aviso');
  a.className = `aviso ${tipo}`;
  a.replaceChildren(el('span', { text: texto }));
  if (link) a.append(el('a', { href: link.href, target: '_blank', rel: 'noopener', text: link.texto }));
}

async function carregar() {
  try {
    const r = await fetch(API, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.erro || `Erro ${r.status}`);
    Object.assign(estado, { original: d.servicos, lista: copia(d.servicos), sha: d.sha, repo: d.repo, salvarDireto: d.salvarDireto });
    $('btn-salvar').textContent = d.salvarDireto ? 'Salvar e publicar' : 'Gerar arquivo';
    if (!d.salvarDireto) avisar('Modo manual: salvar direto no GitHub não está configurado. As alterações geram o arquivo para você colar no GitHub.', 'alerta');
    desenhar();
  } catch (e) {
    avisar(`Não foi possível carregar a lista: ${e.message}`, 'erro');
    $('linhas').replaceChildren(el('tr', {}, el('td', { colspan: '5', class: 'mudo', text: 'Sem dados.' })));
  }
}

function mudancas() {
  const a = new Map(estado.original.map((s) => [s.id, s]));
  const d = new Map(estado.lista.map((s) => [s.id, s]));
  const itens = [];
  for (const s of estado.lista) {
    if (!a.has(s.id)) itens.push({ tipo: 'novo', texto: `Adicionar ${s.nome}` });
    else if (JSON.stringify(a.get(s.id)) !== JSON.stringify(s)) itens.push({ tipo: 'alterado', texto: `Alterar ${s.nome}` });
  }
  for (const s of estado.original) if (!d.has(s.id)) itens.push({ tipo: 'removido', texto: `Remover ${s.nome}` });
  return itens;
}

function marca(s) {
  const o = estado.original.find((x) => x.id === s.id);
  if (!o) return el('span', { class: 'etiqueta novo', text: 'novo' });
  if (JSON.stringify(o) !== JSON.stringify(s)) return el('span', { class: 'etiqueta alterado', text: 'alterado' });
  return null;
}

function desenhar() {
  const termo = estado.busca.toLowerCase();
  const visiveis = estado.lista
    .filter((s) => !termo || `${s.nome} ${s.categoria} ${s.url}`.toLowerCase().includes(termo))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  $('contagem').textContent = `(${estado.lista.length})`;
  $('linhas').replaceChildren(...(visiveis.length ? visiveis.map((s) => el('tr', {},
    el('td', {}, el('strong', { text: s.nome }), ' ', marca(s)),
    el('td', { text: s.categoria }),
    el('td', { class: 'url' }, el('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.url })),
    el('td', { text: `${s.limite_lento_ms ?? 2000} ms` }),
    el('td', { class: 'acoes-linha' },
      el('button', { type: 'button', class: 'btn', text: 'Editar', 'aria-label': `Editar ${s.nome}`, onclick: () => abrirEditor(s) }),
      el('button', { type: 'button', class: 'btn perigo', text: 'Remover', 'aria-label': `Remover ${s.nome}`, onclick: () => remover(s) })),
  )) : [el('tr', {}, el('td', { colspan: '5', class: 'mudo', text: 'Nenhum serviço encontrado.' }))]));

  const itens = mudancas();
  $('barra-salvar').classList.toggle('oculto', itens.length === 0);
  $('pendentes').textContent = itens.length === 1 ? '1 alteração pendente' : `${itens.length} alterações pendentes`;
  $('lista-pendentes').replaceChildren(...itens.map((i) => el('li', { text: i.texto })));
  if (!itens.length) $('manual').classList.add('oculto');
}

function abrirEditor(servico) {
  estado.editando = servico ? servico.id : null;
  $('e-titulo').textContent = servico ? `Editar ${servico.nome}` : 'Adicionar serviço';
  $('e-id').textContent = servico ? `Identificador: ${servico.id}` : 'O identificador é gerado a partir do nome.';
  $('e-nome').value = servico?.nome ?? '';
  $('e-categoria').value = servico?.categoria ?? CATEGORIAS[0];
  $('e-url').value = servico?.url ?? '';
  $('e-limite').value = servico?.limite_lento_ms ?? '';
  $('e-timeout').value = servico?.timeout_ms ?? '';
  $('e-ok').textContent = servico ? 'Aplicar alteração' : 'Adicionar à lista';
  $('e-remover').classList.toggle('oculto', !servico);
  $('e-erros').replaceChildren();
  $('editor').showModal();
  $('e-nome').focus();
}

function idLivre(base) {
  let id = base;
  for (let n = 2; estado.lista.some((s) => s.id === id); n++) id = `${base.slice(0, 36)}-${n}`;
  return id;
}

function aplicarEditor(e) {
  e.preventDefault();
  const nome = $('e-nome').value.trim();
  const editando = estado.editando;
  const servico = {
    id: editando ?? idLivre(gerarId(nome)),
    nome,
    categoria: $('e-categoria').value,
    url: $('e-url').value.trim(),
  };
  if ($('e-limite').value.trim()) servico.limite_lento_ms = Number($('e-limite').value);
  if ($('e-timeout').value.trim()) servico.timeout_ms = Number($('e-timeout').value);

  const nova = editando ? estado.lista.map((s) => (s.id === editando ? servico : s)) : [...estado.lista, servico];
  const erros = validarServicos(nova)
    .filter((m) => m.includes(`(${servico.id})`) || !servico.id)
    .map((m) => m.replace(/^Serviço \d+ \([^)]*\): /, ''));
  if (!servico.id) erros.unshift('Informe um nome com letras ou números.');
  const repetido = estado.lista.find((s) => s.id !== servico.id && semBarra(s.url) === semBarra(servico.url));
  if (repetido) erros.push(`Esse endereço já é monitorado em “${repetido.nome}”.`);
  $('e-erros').replaceChildren(...erros.map((m) => el('li', { text: m })));
  if (erros.length) return;

  estado.lista = nova;
  $('editor').close();
  desenhar();
}

function remover(servico) {
  if (estado.lista.length <= 1) { avisar('A lista precisa ter pelo menos um serviço.', 'erro'); return; }
  estado.lista = estado.lista.filter((s) => s.id !== servico.id);
  if ($('editor').open) $('editor').close();
  avisar(`${servico.nome} será removido quando você salvar.`, 'info');
  desenhar();
}

function formatarConfig(lista) {
  const linha = (s) => JSON.stringify(s).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, '{ ').replace(/\}$/, ' }');
  return `[\n${lista.map((s) => `  ${linha(s)}`).join(',\n')}\n]\n`;
}

async function salvar() {
  const erros = validarServicos(estado.lista);
  if (erros.length) { avisar(`A lista tem erros: ${erros[0]}`, 'erro'); return; }

  if (!estado.salvarDireto) {
    $('m-conteudo').textContent = formatarConfig(estado.lista);
    $('m-editar').href = estado.repo ? `https://github.com/${estado.repo}/edit/main/config/servicos.json` : 'https://github.com/';
    $('manual').classList.remove('oculto');
    $('manual').scrollIntoView({ behavior: 'smooth' });
    return;
  }

  const botao = $('btn-salvar');
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  try {
    const r = await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servicos: estado.lista, sha: estado.sha }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error([d.erro, ...(d.erros ?? [])].join(' '));
    estado.original = copia(estado.lista);
    estado.sha = d.sha;
    avisar(`Salvo! Commit ${d.commit.slice(0, 7)} criado (“${d.mensagem}”). O pipeline já começou; o painel mostra a mudança em poucos minutos.`, 'ok',
      { href: d.actionsUrl, texto: 'Acompanhar no GitHub Actions' });
    desenhar();
  } catch (e) {
    avisar(e.message, 'erro');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Salvar e publicar';
  }
}

function iniciar() {
  for (const c of CATEGORIAS) $('e-categoria').append(el('option', { value: c, text: c }));
  $('btn-novo').addEventListener('click', () => abrirEditor(null));
  $('e-form').addEventListener('submit', aplicarEditor);
  $('e-fechar').addEventListener('click', () => $('editor').close());
  $('editor').addEventListener('click', (e) => { if (e.target === $('editor')) $('editor').close(); });
  $('e-remover').addEventListener('click', () => {
    const s = estado.lista.find((x) => x.id === estado.editando);
    if (s) remover(s);
  });
  $('a-busca').addEventListener('input', (e) => { estado.busca = e.target.value; desenhar(); });
  $('btn-descartar').addEventListener('click', () => {
    estado.lista = copia(estado.original);
    avisar('Alterações descartadas.', 'info');
    desenhar();
  });
  $('btn-salvar').addEventListener('click', salvar);
  $('m-copiar').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('m-conteudo').textContent);
      $('m-copiar').textContent = 'Copiado!';
    } catch {
      $('m-copiar').textContent = 'Selecione e copie com Ctrl+C';
    }
    setTimeout(() => { $('m-copiar').textContent = 'Copiar tudo'; }, 2500);
  });
  window.addEventListener('beforeunload', (e) => { if (mudancas().length) e.preventDefault(); });
  carregar();
}

iniciar();
