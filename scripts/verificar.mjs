// Verificador: testa cada serviço da lista e atualiza dados/status.json.
// Roda no GitHub Actions a cada 15 minutos (workflow "Monitoramento").
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atualizarStatus, statusVazio, ESTADOS, classificar } from '../site/js/nucleo.js';
import { lerServicos, validarServicos } from './configuracao.mjs';

const AGENTE = 'TelemetriaStatus/1.0 (+https://github.com/jlvjunior)';

// Uma verificação: GET com tempo limite. Respondeu com código < 500 = o serviço está no ar.
export async function verificarServico(servico) {
  const inicio = performance.now();
  try {
    const resp = await fetch(servico.url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': AGENTE, accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(servico.timeout_ms ?? 10000),
    });
    const ms = Math.round(performance.now() - inicio);
    await resp.body?.cancel().catch(() => {});
    const ok = resp.status < 500;
    return { ok, ms, http: resp.status, erro: ok ? null : `Resposta HTTP ${resp.status}` };
  } catch (e) {
    const ms = Math.round(performance.now() - inicio);
    const erro = e.name === 'TimeoutError' ? `Sem resposta em ${Math.round((servico.timeout_ms ?? 10000) / 1000)} s` : `Falha de conexão (${e.cause?.code ?? e.name})`;
    return { ok: false, ms, http: null, erro };
  }
}

export async function executar({ caminhoStatus, servicos, agora = Date.now() }) {
  let status;
  try { status = JSON.parse(await readFile(caminhoStatus, 'utf8')); } catch { status = statusVazio(); }
  const resultados = Object.fromEntries(
    await Promise.all(servicos.map(async (s) => [s.id, await verificarServico(s)])),
  );
  const novo = atualizarStatus(status, servicos, resultados, agora);
  await mkdir(dirname(caminhoStatus), { recursive: true });
  await writeFile(caminhoStatus, JSON.stringify(novo));
  return { novo, resultados };
}

async function principal() {
  const servicos = await lerServicos();
  const erros = validarServicos(servicos);
  if (erros.length) { erros.forEach((e) => console.error(e)); process.exit(1); }
  const caminhoStatus = fileURLToPath(new URL('../dados/status.json', import.meta.url));
  const { novo, resultados } = await executar({ caminhoStatus, servicos });

  const linhas = servicos.map((s) => {
    const r = resultados[s.id];
    const est = ESTADOS[novo.servicos[s.id].estado].rotulo;
    return `| ${s.nome} | ${est} | ${r.http ?? '—'} | ${r.ms} ms | ${classificar(r, s) === 'falha' ? r.erro : ''} |`;
  });
  console.log(['| Serviço | Estado | HTTP | Tempo | Detalhe |', '|---|---|---|---|---|', ...linhas].join('\n'));
  const abertos = novo.incidentes.filter((i) => i.fim === null).length;
  console.log(`\n${servicos.length} serviços verificados; ${abertos} incidente(s) aberto(s).`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Verificação dos serviços\n\n| Serviço | Estado | HTTP | Tempo | Detalhe |\n|---|---|---|---|---|\n${linhas.join('\n')}\n\nIncidentes abertos: **${abertos}**\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();
