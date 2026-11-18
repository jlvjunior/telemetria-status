// Lógica da área de gestão (/admin), usada pelas Cloudflare Pages Functions e pelos testes.
// - exigirSenha: protege /admin com usuário e senha (HTTP Basic, só por HTTPS). A senha fica no segredo ADMIN_SENHA.
// - lerConfig / salvarConfig: leem e gravam config/servicos.json direto no GitHub (segredo GH_ADMIN_TOKEN).
//   Cada gravação vira um commit no ramo main, e o commit dispara o pipeline de CI/CD.
import { validarServicos } from '../site/js/nucleo.js';

export const USUARIO_ADMIN = 'admin';
const ARQUIVO = 'config/servicos.json';
const RAMO = 'main';

// Compara sem atalho (o tempo não revela quantos caracteres batem).
function iguais(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return dif === 0;
}

// Lê o cabeçalho "Authorization: Basic base64(usuario:senha)".
export function lerCredenciais(cabecalho) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(cabecalho ?? '');
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    const texto = new TextDecoder().decode(bytes);
    const i = texto.indexOf(':');
    return i < 0 ? null : { usuario: texto.slice(0, i), senha: texto.slice(i + 1) };
  } catch {
    return null;
  }
}

export function senhaConfere(cabecalho, senhaCorreta) {
  const c = lerCredenciais(cabecalho);
  if (!c || !senhaCorreta) return false;
  return iguais(c.usuario, USUARIO_ADMIN) & iguais(c.senha, senhaCorreta) ? true : false;
}

const SEM_CACHE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

function pagina(status, titulo, texto, extra = {}) {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title></head>`
    + `<body style="font-family:system-ui;background:#111217;color:#ccccdc;padding:40px">`
    + `<h1 style="font-size:1.3rem">${titulo}</h1><p>${texto}</p><p><a style="color:#6e9fff" href="/">Voltar ao painel</a></p></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SEM_CACHE, ...extra } });
}

// Middleware: só deixa passar quem informar o usuário "admin" e a senha certa.
export async function exigirSenha({ request, env, next }) {
  if (!env.ADMIN_SENHA) {
    return pagina(503, 'Área de gestão desativada', 'O segredo ADMIN_SENHA não foi configurado neste ambiente.');
  }
  if (!senhaConfere(request.headers.get('Authorization'), env.ADMIN_SENHA)) {
    return pagina(401, 'Acesso restrito', 'Informe o usuário e a senha da área de gestão.',
      { 'WWW-Authenticate': 'Basic realm="Telemetria Status - gestao", charset="UTF-8"' });
  }
  const resposta = await next();
  const nova = new Response(resposta.body, resposta);
  for (const [k, v] of Object.entries(SEM_CACHE)) nova.headers.set(k, v);
  return nova;
}

// ---------- GitHub ----------

function base64ParaTexto(b64) {
  const bytes = Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function textoParaBase64(texto) {
  let bin = '';
  for (const b of new TextEncoder().encode(texto)) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Mesmo formato do arquivo do repositório: um serviço por linha, fácil de ler no diff do commit.
export function formatarConfig(lista) {
  const linha = (s) => JSON.stringify(s).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, '{ ').replace(/\}$/, ' }');
  return `[\n${lista.map((s) => `  ${linha(s)}`).join(',\n')}\n]\n`;
}

// Mantém só os campos conhecidos, na ordem do arquivo, e converte números.
export function limparServico(s) {
  const r = { id: String(s.id ?? '').trim(), nome: String(s.nome ?? '').trim(), categoria: s.categoria, url: String(s.url ?? '').trim() };
  for (const campo of ['limite_lento_ms', 'timeout_ms']) {
    if (s[campo] !== undefined && s[campo] !== null && s[campo] !== '') r[campo] = Number(s[campo]);
  }
  return r;
}

// Regras do pipeline + endereço repetido.
export function conferirLista(lista) {
  const erros = validarServicos(lista);
  if (Array.isArray(lista)) {
    const vistos = new Map();
    for (const s of lista) {
      const chave = String(s?.url ?? '').replace(/\/+$/, '').toLowerCase();
      if (vistos.has(chave)) erros.push(`O endereço ${s.url} aparece em "${vistos.get(chave)}" e em "${s.nome}".`);
      else vistos.set(chave, s?.nome);
    }
  }
  return erros;
}

function cabecalhosGitHub(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'TelemetriaStatus-admin',
  };
}

export class ErroGitHub extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

async function falha(r, acao) {
  let detalhe = '';
  try { detalhe = (await r.json()).message ?? ''; } catch { /* sem corpo */ }
  const dicas = {
    401: 'o token GH_ADMIN_TOKEN é inválido ou expirou',
    403: 'o token GH_ADMIN_TOKEN não tem a permissão Contents: Read and write neste repositório',
    404: 'repositório ou arquivo não encontrado (confira se o token tem acesso ao repositório)',
    409: 'o arquivo mudou no GitHub enquanto você editava; recarregue a página e refaça a alteração',
  };
  const status = r.status === 422 && /sha/i.test(detalhe) ? 409 : r.status;
  return new ErroGitHub(status, `Não foi possível ${acao}: ${dicas[status] ?? `GitHub respondeu ${r.status}`}${detalhe ? ` (${detalhe})` : ''}.`);
}

export async function lerConfig({ repo, token, fetchFn = fetch }) {
  const r = await fetchFn(`https://api.github.com/repos/${repo}/contents/${ARQUIVO}?ref=${RAMO}`, { headers: cabecalhosGitHub(token) });
  if (!r.ok) throw await falha(r, 'ler a lista no GitHub');
  const dados = await r.json();
  return { servicos: JSON.parse(base64ParaTexto(dados.content)), sha: dados.sha };
}

export async function salvarConfig({ repo, token, servicos, sha, mensagem, fetchFn = fetch }) {
  const corpo = {
    message: mensagem,
    content: textoParaBase64(formatarConfig(servicos)),
    sha,
    branch: RAMO,
  };
  const r = await fetchFn(`https://api.github.com/repos/${repo}/contents/${ARQUIVO}`, {
    method: 'PUT',
    headers: { ...cabecalhosGitHub(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await falha(r, 'salvar no GitHub');
  const dados = await r.json();
  return { sha: dados.content.sha, commit: dados.commit.sha, commitUrl: dados.commit.html_url };
}

// Descreve o que mudou, para a mensagem do commit.
export function resumirMudancas(antes, depois) {
  const a = new Map(antes.map((s) => [s.id, s]));
  const d = new Map(depois.map((s) => [s.id, s]));
  const add = depois.filter((s) => !a.has(s.id)).map((s) => s.nome);
  const rem = antes.filter((s) => !d.has(s.id)).map((s) => s.nome);
  const alt = depois.filter((s) => a.has(s.id) && JSON.stringify(a.get(s.id)) !== JSON.stringify(s)).map((s) => s.nome);
  const partes = [];
  if (add.length) partes.push(`adiciona ${add.join(', ')}`);
  if (alt.length) partes.push(`altera ${alt.join(', ')}`);
  if (rem.length) partes.push(`remove ${rem.join(', ')}`);
  return partes.length ? `Serviços: ${partes.join('; ')}` : '';
}

export function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SEM_CACHE } });
}
