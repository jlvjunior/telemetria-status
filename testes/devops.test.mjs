// Testes das funções de DevOps: métricas DORA, dados ao vivo, rollback e verificações de segurança.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calcularDora, normalizarExecucao, mediana, nivelFrequencia, nivelLeadTime, nivelFalhas, nivelRecuperacao } from '../lib/dora.js';
import { gerarDora } from '../scripts/dora.mjs';
import { servirDados } from '../lib/dados.js';
import { escolherDestino, rollback } from '../scripts/rollback.mjs';
import { procurarNoTexto, arquivoProibido } from '../scripts/verificar-segredos.mjs';
import { classificar } from '../scripts/portao-codeql.mjs';

const H = 3_600_000;
const AGORA = Date.parse('2026-11-18T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

// Execução no formato da API do GitHub.
function run(n, { fimH, duracaoMin = 3, commitAntesMin = 10, conclusao = 'success', evento = 'push' }) {
  const fim = AGORA - fimH * H;
  return {
    run_number: n, html_url: `https://github.com/x/y/actions/runs/${n}`, event: evento,
    head_sha: `${n}`.padStart(40, 'a'), head_commit: { message: `Commit ${n}\ncorpo`, timestamp: iso(fim - commitAntesMin * 60_000) },
    run_started_at: iso(fim - duracaoMin * 60_000), updated_at: iso(fim), status: 'completed', conclusion: conclusao,
  };
}

test('mediana e faixas de nível DORA', () => {
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
  assert.equal(mediana([]), null);
  assert.equal(nivelFrequencia(2), 'elite');
  assert.equal(nivelFrequencia(0.5), 'alta');
  assert.equal(nivelFrequencia(0.05), 'media');
  assert.equal(nivelFrequencia(0.01), 'baixa');
  assert.equal(nivelLeadTime(2 * H), 'elite');
  assert.equal(nivelLeadTime(48 * H), 'alta');
  assert.equal(nivelFalhas(4), 'elite');
  assert.equal(nivelFalhas(30), 'baixa');
  assert.equal(nivelRecuperacao(30 * 60_000), 'elite');
  assert.equal(nivelRecuperacao(3 * H), 'alta');
});

test('calcula as quatro métricas a partir das execuções', () => {
  const execucoes = [
    normalizarExecucao(run(1, { fimH: 100 }), 'pipeline'),
    normalizarExecucao(run(2, { fimH: 50, conclusao: 'failure' }), 'pipeline'),
    normalizarExecucao(run(3, { fimH: 49 }), 'pipeline'), // recupera em 1 h
    normalizarExecucao(run(4, { fimH: 10 }), 'pipeline'),
    normalizarExecucao(run(1, { fimH: 9, duracaoMin: 1 }), 'rollback'), // desfaz o deploy 4
    normalizarExecucao(run(5, { fimH: 2, conclusao: 'cancelled' }), 'pipeline'), // ignorada
    normalizarExecucao(run(6, { fimH: 24 * 40 }), 'pipeline'), // fora da janela
  ];
  const d = calcularDora(execucoes, AGORA);
  assert.equal(d.frequencia.deploys, 4); // 3 pipelines + 1 rollback
  assert.equal(d.frequencia.nivel, 'media'); // 4 em 30 dias
  assert.equal(d.lead_time.mediana_ms, 10 * 60_000);
  assert.equal(d.lead_time.nivel, 'elite');
  assert.deepEqual([d.taxa_falha.falhas, d.taxa_falha.tentativas, d.taxa_falha.rollbacks], [2, 4, 1]);
  assert.equal(d.taxa_falha.percentual, 50);
  assert.equal(d.recuperacao.incidentes, 2);
  assert.deepEqual(d.recuperacao.mediana_ms, (1 * H + 60_000) / 2);
  assert.equal(d.serie.length, 30);
  assert.equal(d.serie.reduce((s, x) => s + x.sucesso + x.falha, 0), 5);
  assert.equal(d.recentes[0].commit.length, 7);
  assert.equal(d.recentes.find((e) => e.numero === 1 && e.tipo === 'pipeline').mensagem, 'Commit 1');
});

test('sem execuções, as métricas ficam "sem dados"', () => {
  const d = calcularDora([], AGORA);
  assert.equal(d.frequencia.nivel, 'sem_dados');
  assert.equal(d.taxa_falha.percentual, null);
  assert.equal(d.recuperacao.nivel, 'sem_dados');
});

test('gerarDora busca os dois workflows no GitHub, ignora pull requests e grava o arquivo', async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    if (url.includes('rollback.yml')) return new Response('{}', { status: 404 });
    return Response.json({ workflow_runs: [run(1, { fimH: 5 }), run(2, { fimH: 4, evento: 'pull_request' })] });
  };
  const destino = join(await mkdtemp(join(tmpdir(), 'dora-')), 'dora.json');
  const d = await gerarDora({ repo: 'x/y', token: 't', destino, agora: AGORA, fetchFn });
  assert.equal(d.frequencia.deploys, 1);
  assert.match(urls[0], /ci-cd\.yml\/runs\?branch=main/);
  assert.deepEqual(JSON.parse(await readFile(destino, 'utf8')).frequencia.deploys, 1);
});

test('dados ao vivo: lê do ramo "dados" e cai na cópia do build se o GitHub falhar', async () => {
  const assets = { fetch: async (u) => (String(u).endsWith('build-info.json') ? Response.json({ repositorio: 'x/y' }) : new Response('{"copia":true}')) };
  const pedido = new Request('https://x.dev/dados/status.json?t=1');

  const vivo = await servirDados({ request: pedido, env: { ASSETS: assets }, params: { arquivo: 'status.json' } },
    async (url) => { assert.equal(url, 'https://raw.githubusercontent.com/x/y/dados/status.json'); return new Response('{"vivo":true}'); });
  assert.deepEqual(await vivo.json(), { vivo: true });
  assert.equal(vivo.headers.get('X-Fonte-Dados'), 'ramo-dados');

  const copia = await servirDados({ request: pedido, env: { ASSETS: assets }, params: { arquivo: 'status.json' } },
    async () => new Response('não é json'));
  assert.deepEqual(await copia.json(), { copia: true });
  assert.equal(copia.headers.get('X-Fonte-Dados'), 'build');

  let buscou = false;
  await servirDados({ request: new Request('https://x.dev/dados/outro.json'), env: { ASSETS: assets }, params: { arquivo: 'outro.json' } },
    async () => { buscou = true; return new Response('{}'); });
  assert.equal(buscou, false, 'só status.json e dora.json vêm do GitHub');
});

// Deploys no formato da API do Cloudflare Pages.
const deploy = (id, commit, horas, status = 'success', env = 'production') => ({
  id, environment: env, created_on: iso(AGORA - horas * H), latest_stage: { status },
  deployment_trigger: { metadata: { commit_hash: commit.padEnd(40, '0'), commit_message: `versão ${id}` } },
});
const DEPLOYS = [
  deploy('d4', 'dddddd4', 1),
  deploy('d3b', 'cccccc3', 2), // mesmo commit (republicação)
  deploy('d3', 'cccccc3', 3),
  deploy('dx', 'eeeeee9', 4, 'failure'),
  deploy('dp', 'ffffff1', 5, 'success', 'preview'),
  deploy('d2', 'bbbbbb2', 6),
];

test('rollback escolhe a versão anterior com commit diferente, ou o commit pedido', () => {
  assert.equal(escolherDestino(DEPLOYS, 'd4').destino.id, 'd3b');
  assert.equal(escolherDestino(DEPLOYS, 'd3b').destino.id, 'd2'); // pula o mesmo commit
  assert.equal(escolherDestino(DEPLOYS, 'd4', 'bbbbbb2').destino.id, 'd2');
  assert.throws(() => escolherDestino(DEPLOYS, 'd4', 'eeeeee9'), /Não há deploy/); // falhou: não serve
  assert.throws(() => escolherDestino(DEPLOYS, 'd4', 'ffffff1'), /Não há deploy/); // prévia: não serve
  assert.throws(() => escolherDestino(DEPLOYS, 'd4', 'dddddd4'), /já é a versão no ar/);
  assert.throws(() => escolherDestino(DEPLOYS, 'd4', 'xyz'), /7 caracteres/);
  assert.throws(() => escolherDestino([DEPLOYS[0]], 'd4'), /Não há uma versão anterior/);
});

test('rollback chama a API do Cloudflare e informa o commit restaurado', async () => {
  const chamadas = [];
  const fetchFn = async (url, opcoes = {}) => {
    chamadas.push(`${opcoes.method ?? 'GET'} ${url.replace('https://api.cloudflare.com/client/v4', '')}`);
    if (url.endsWith('/projects/site')) return Response.json({ success: true, result: { subdomain: 'site.pages.dev', canonical_deployment: { id: 'd4' } } });
    if (url.includes('/deployments?')) return Response.json({ success: true, result: DEPLOYS });
    return Response.json({ success: true, result: {} });
  };
  const r = await rollback({ token: 't', conta: 'c', projeto: 'site', fetchFn });
  assert.equal(r.para.slice(0, 7), 'cccccc3');
  assert.equal(r.endereco, 'https://site.pages.dev');
  assert.equal(chamadas.at(-1), 'POST /accounts/c/pages/projects/site/deployments/d3b/rollback');

  const recusa = async () => Response.json({ success: false, errors: [{ code: 8000000, message: 'negado' }] }, { status: 403 });
  await assert.rejects(rollback({ token: 't', conta: 'c', projeto: 'site', fetchFn: recusa }), /negado/);
});

test('verificação de segredos encontra tokens e senhas, e respeita "segredos:ignorar"', () => {
  const tokenFalso = 'ghp_' + 'A'.repeat(36);
  const achados = procurarNoTexto([
    `const t = "${tokenFalso}";`,
    'const senha = "minhaSenha123";', // exemplo falso do teste — segredos:ignorar
    '-----BEGIN ' + 'PRIVATE KEY-----',
    `exemplo = "${tokenFalso}"; // segredos:ignorar`,
    'const senha = process.env.ADMIN_SENHA;',
  ].join('\n'), 'x.js');
  assert.deepEqual(achados.map((a) => a.linha), [1, 2, 3]);
  assert.equal(arquivoProibido('.env'), true);
  assert.equal(arquivoProibido('.dev.vars'), true);
  assert.equal(arquivoProibido('.dev.vars.exemplo'), false);
  assert.equal(arquivoProibido('site/index.html'), false);
});

test('portão do CodeQL bloqueia só nota 7.0 ou mais', () => {
  const sarif = {
    runs: [{
      tool: { driver: { rules: [] }, extensions: [{ rules: [
        { id: 'js/xss', properties: { 'security-severity': '7.8' } },
        { id: 'js/aviso', properties: { 'security-severity': '4.0' } },
      ] }] },
      results: [
        { ruleId: 'js/xss', message: { text: 'XSS' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' }, region: { startLine: 3 } } }] },
        { ruleId: 'js/aviso', message: { text: 'leve' } },
      ],
    }],
  };
  const r = classificar(sarif);
  assert.deepEqual(r.graves.map((a) => [a.regra, a.arquivo, a.linha]), [['js/xss', 'a.js', 3]]);
  assert.equal(r.outros.length, 1);
});
