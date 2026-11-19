// Gera dados/dora.json a partir do histórico do GitHub Actions (workflows ci-cd.yml e rollback.yml, ramo main).
// Uso no pipeline: GITHUB_TOKEN e GITHUB_REPOSITORY vêm do próprio GitHub Actions.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { calcularDora, normalizarExecucao } from '../lib/dora.js';

const WORKFLOWS = [
  { arquivo: 'ci-cd.yml', tipo: 'pipeline' },
  { arquivo: 'rollback.yml', tipo: 'rollback' },
];

export async function buscarExecucoes({ repo, token, dias = 30, agora = Date.now(), fetchFn = fetch }) {
  const desde = new Date(agora - dias * 86_400_000).toISOString().slice(0, 10);
  const execucoes = [];
  for (const { arquivo, tipo } of WORKFLOWS) {
    for (let pagina = 1; pagina <= 5; pagina++) {
      const url = `https://api.github.com/repos/${repo}/actions/workflows/${arquivo}/runs?branch=main&per_page=100&page=${pagina}&created=%3E%3D${desde}`;
      const r = await fetchFn(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'TelemetriaStatus-dora',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (r.status === 404) break; // workflow ainda não existe
      if (!r.ok) throw new Error(`GitHub respondeu ${r.status} ao listar ${arquivo}`);
      const { workflow_runs: runs = [] } = await r.json();
      // Pull requests não vão para produção: só push e execução manual.
      execucoes.push(...runs.filter((x) => x.event !== 'pull_request').map((x) => normalizarExecucao(x, tipo)));
      if (runs.length < 100) break;
    }
  }
  return execucoes;
}

export async function gerarDora({ repo, token, destino, agora = Date.now(), fetchFn = fetch }) {
  const execucoes = await buscarExecucoes({ repo, token, agora, fetchFn });
  const dora = { repositorio: repo, ...calcularDora(execucoes, agora) };
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, JSON.stringify(dora));
  return dora;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error('Defina GITHUB_REPOSITORY (ex.: usuario/telemetria-status).');
    process.exit(1);
  }
  const destino = fileURLToPath(new URL('../dados/dora.json', import.meta.url));
  const d = await gerarDora({ repo, token: process.env.GITHUB_TOKEN, destino });
  const h = (x) => (x == null ? '—' : `${(x / 3_600_000).toFixed(1)} h`);
  const linhas = [
    '### 📈 Métricas DORA (últimos 30 dias)',
    '| Métrica | Valor | Nível |',
    '|---|---|---|',
    `| Frequência de deploy | ${d.frequencia.deploys} deploys (${(d.frequencia.por_semana ?? 0).toFixed(1)} por semana) | ${d.frequencia.nivel} |`,
    `| Tempo de entrega (mediana) | ${h(d.lead_time.mediana_ms)} | ${d.lead_time.nivel} |`,
    `| Taxa de falha de mudanças | ${d.taxa_falha.percentual == null ? '—' : d.taxa_falha.percentual.toFixed(1) + '%'} | ${d.taxa_falha.nivel} |`,
    `| Tempo de recuperação (mediana) | ${h(d.recuperacao.mediana_ms)} | ${d.recuperacao.nivel} |`,
  ];
  console.log(linhas.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, linhas.join('\n') + '\n', { flag: 'a' });
}
