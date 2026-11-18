import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  lerCredenciais, senhaConfere, exigirSenha, formatarConfig, conferirLista, limparServico,
  resumirMudancas, lerConfig, salvarConfig, ErroGitHub,
} from '../lib/admin.js';
import { onRequestGet, onRequestPut } from '../functions/admin/api/servicos.js';

const basic = (u, s) => `Basic ${Buffer.from(`${u}:${s}`).toString('base64')}`;
const base = { id: 'teste', nome: 'Teste', categoria: 'Trabalho', url: 'https://exemplo.com/' };

test('lê o usuário e a senha do cabeçalho Basic', () => {
  assert.deepEqual(lerCredenciais(basic('admin', 'a:b ção')), { usuario: 'admin', senha: 'a:b ção' });
  assert.equal(lerCredenciais('Bearer xyz'), null);
  assert.equal(lerCredenciais(undefined), null);
});

test('confere a senha só com o usuário admin', () => {
  assert.equal(senhaConfere(basic('admin', 'segredo'), 'segredo'), true);
  assert.equal(senhaConfere(basic('admin', 'errada'), 'segredo'), false);
  assert.equal(senhaConfere(basic('outro', 'segredo'), 'segredo'), false);
  assert.equal(senhaConfere(basic('admin', ''), ''), false);
});

test('middleware: 503 sem senha configurada, 401 sem login, libera com login', async () => {
  const proximo = async () => new Response('pagina');
  const pedido = (auth) => new Request('https://x.dev/admin/', { headers: auth ? { Authorization: auth } : {} });

  assert.equal((await exigirSenha({ request: pedido(), env: {}, next: proximo })).status, 503);
  const negado = await exigirSenha({ request: pedido(), env: { ADMIN_SENHA: 's3nha' }, next: proximo });
  assert.equal(negado.status, 401);
  assert.match(negado.headers.get('WWW-Authenticate'), /^Basic/);
  assert.equal((await exigirSenha({ request: pedido(basic('admin', 'x')), env: { ADMIN_SENHA: 's3nha' }, next: proximo })).status, 401);

  const ok = await exigirSenha({ request: pedido(basic('admin', 's3nha')), env: { ADMIN_SENHA: 's3nha' }, next: proximo });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'pagina');
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
});

test('formatarConfig gera exatamente o formato do arquivo do repositório', async () => {
  const texto = await readFile(new URL('../config/servicos.json', import.meta.url), 'utf8');
  assert.equal(formatarConfig(JSON.parse(texto)), texto);
});

test('conferirLista aponta endereço repetido e limparServico converte números', () => {
  const erros = conferirLista([base, { ...base, id: 'outro', nome: 'Outro', url: 'https://exemplo.com' }]);
  assert.match(erros.join(' '), /aparece em/);
  assert.deepEqual(limparServico({ ...base, limite_lento_ms: '3000', timeout_ms: '', extra: 1 }), { ...base, limite_lento_ms: 3000 });
});

test('resumirMudancas descreve o que foi adicionado, alterado e removido', () => {
  const antes = [base, { ...base, id: 'b', nome: 'B' }];
  const depois = [{ ...base, nome: 'Teste 2' }, { ...base, id: 'c', nome: 'C' }];
  assert.equal(resumirMudancas(antes, depois), 'Serviços: adiciona C; altera Teste 2; remove B');
  assert.equal(resumirMudancas(antes, antes), '');
});

// GitHub falso, guardado em memória.
function githubFalso(inicial) {
  const repo = { conteudo: formatarConfig(inicial), sha: 'sha1', commits: [] };
  const fetchFn = async (url, opcoes = {}) => {
    if ((opcoes.method ?? 'GET') === 'GET') {
      return Response.json({ content: Buffer.from(repo.conteudo).toString('base64'), sha: repo.sha });
    }
    const corpo = JSON.parse(opcoes.body);
    if (corpo.sha !== repo.sha) return Response.json({ message: 'sha does not match' }, { status: 409 });
    repo.conteudo = Buffer.from(corpo.content, 'base64').toString('utf8');
    repo.sha = `sha${repo.commits.length + 2}`;
    repo.commits.push(corpo.message);
    return Response.json({ content: { sha: repo.sha }, commit: { sha: 'c0ffee1234', html_url: 'https://github.com/x/y/commit/c0ffee1234' } });
  };
  return { repo, fetchFn };
}

test('lerConfig e salvarConfig falam com a API de conteúdo do GitHub', async () => {
  const { repo, fetchFn } = githubFalso([base]);
  const lido = await lerConfig({ repo: 'x/y', token: 't', fetchFn });
  assert.deepEqual(lido, { servicos: [base], sha: 'sha1' });
  const novo = [base, { ...base, id: 'ifood', nome: 'iFood', categoria: 'Compras', url: 'https://www.ifood.com.br/' }];
  const salvo = await salvarConfig({ repo: 'x/y', token: 't', servicos: novo, sha: 'sha1', mensagem: 'm', fetchFn });
  assert.equal(salvo.commit, 'c0ffee1234');
  assert.deepEqual(JSON.parse(repo.conteudo), novo);
  await assert.rejects(salvarConfig({ repo: 'x/y', token: 't', servicos: novo, sha: 'velho', mensagem: 'm', fetchFn }),
    (e) => e instanceof ErroGitHub && e.status === 409);
});

test('API: GET sem token usa a lista publicada; PUT valida, recusa outra origem e grava', async () => {
  const assets = { fetch: async (u) => Response.json(String(u).endsWith('build-info.json') ? { repositorio: 'x/y' } : [base]) };
  const r1 = await onRequestGet({ env: { ASSETS: assets }, request: new Request('https://x.dev/admin/api/servicos') });
  assert.deepEqual(await r1.json(), { servicos: [base], sha: null, repo: 'x/y', salvarDireto: false });

  const put = (corpo, cab = {}) => new Request('https://x.dev/admin/api/servicos', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://x.dev', ...cab }, body: JSON.stringify(corpo),
  });
  const env = { ASSETS: assets, GH_ADMIN_TOKEN: 't' };
  assert.equal((await onRequestPut({ env: { ASSETS: assets }, request: put({ servicos: [base], sha: 's' }) })).status, 501);
  assert.equal((await onRequestPut({ env, request: put({ servicos: [base], sha: 's' }, { Origin: 'https://malicioso.com' }) })).status, 403);
  const invalido = await onRequestPut({ env, request: put({ servicos: [{ ...base, url: 'http://inseguro.com' }], sha: 's' }) });
  assert.equal(invalido.status, 422);
  assert.match((await invalido.json()).erros.join(' '), /https/);
});

test('API: PUT com token grava um commit com mensagem descritiva e detecta conflito', async (t) => {
  const { repo, fetchFn } = githubFalso([base]);
  t.mock.method(globalThis, 'fetch', fetchFn);
  const env = { GH_ADMIN_TOKEN: 't', GH_REPO: 'x/y' };
  const ifood = { id: 'ifood', nome: 'iFood', categoria: 'Compras', url: 'https://www.ifood.com.br/' };
  const pedido = (sha) => new Request('https://x.dev/admin/api/servicos', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ servicos: [base, ifood], sha }),
  });

  const lido = await (await onRequestGet({ env, request: new Request('https://x.dev/admin/api/servicos') })).json();
  assert.equal(lido.salvarDireto, true);
  const r = await onRequestPut({ env, request: pedido(lido.sha) });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(repo.commits[0], 'Serviços: adiciona iFood (via área de gestão)');
  assert.equal(d.actionsUrl, 'https://github.com/x/y/actions');
  assert.equal((await onRequestPut({ env, request: pedido(lido.sha) })).status, 409);
});
