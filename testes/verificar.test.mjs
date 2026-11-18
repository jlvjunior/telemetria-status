import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verificarServico, executar } from '../scripts/verificar.mjs';

// Servidor local que simula serviços no ar, lentos, com erro e sem resposta.
let servidor, base;
before(async () => {
  servidor = createServer((req, res) => {
    if (req.url === '/ok') { res.writeHead(200); res.end('ok'); }
    else if (req.url === '/proibido') { res.writeHead(403); res.end('bloqueado'); }
    else if (req.url === '/erro') { res.writeHead(503); res.end('fora'); }
    else if (req.url === '/redireciona') { res.writeHead(301, { location: '/ok' }); res.end(); }
    else if (req.url === '/trava') { /* nunca responde */ }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => { servidor.closeAllConnections(); servidor.close(); });

const sv = (caminho, extra = {}) => ({ id: caminho.slice(1), nome: caminho, categoria: 'Trabalho', url: base + caminho, ...extra });

test('serviço respondendo 200 está no ar', async () => {
  const r = await verificarServico(sv('/ok'));
  assert.equal(r.ok, true);
  assert.equal(r.http, 200);
  assert.ok(r.ms >= 0);
});

test('resposta 4xx conta como no ar (o servidor respondeu); 5xx como falha', async () => {
  assert.equal((await verificarServico(sv('/proibido'))).ok, true);
  const r = await verificarServico(sv('/erro'));
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'Resposta HTTP 503');
});

test('segue redirecionamentos', async () => {
  const r = await verificarServico(sv('/redireciona'));
  assert.equal(r.ok, true);
  assert.equal(r.http, 200);
});

test('tempo limite esgotado vira falha com mensagem clara', async () => {
  const r = await verificarServico(sv('/trava', { timeout_ms: 1000 }));
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'Sem resposta em 1 s');
});

test('executar grava o status de todos os serviços', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'status-'));
  const caminhoStatus = join(pasta, 'status.json');
  const servicos = [sv('/ok'), sv('/erro')];
  await executar({ caminhoStatus, servicos, agora: 1_000_000 });
  await executar({ caminhoStatus, servicos, agora: 1_900_000 });
  const st = JSON.parse(await readFile(caminhoStatus, 'utf8'));
  assert.equal(st.servicos.ok.estado, 'operacional');
  assert.equal(st.servicos.erro.estado, 'fora');
  assert.equal(st.incidentes.length, 1);
  assert.equal(st.incidentes[0].servico, 'erro');
});
