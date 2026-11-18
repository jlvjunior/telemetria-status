import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../scripts/build.mjs';

test('o build gera o site completo em dist/ com build-info.json', async () => {
  const destino = join(await mkdtemp(join(tmpdir(), 'dist-')), 'dist');
  const info = await build(destino);
  for (const f of ['index.html', 'css/estilo.css', 'js/app.js', 'js/nucleo.js', 'config/servicos.json', 'dados/status.json', 'build-info.json', '_headers']) {
    await access(join(destino, f));
  }
  const gravado = JSON.parse(await readFile(join(destino, 'build-info.json'), 'utf8'));
  assert.equal(gravado.versao, info.versao);
  assert.ok(gravado.commit.length > 0);
  const html = await readFile(join(destino, 'index.html'), 'utf8');
  assert.match(html, /Telemetria Status/);
});
