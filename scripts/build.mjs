// Build: monta a pasta dist/ que vai para o Cloudflare Pages.
// Copia o site, a configuração e os dados e grava build-info.json (versão, commit, execução do pipeline).
import { cp, rm, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { statusVazio } from '../site/js/nucleo.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));

function commitAtual() {
  // Em pull requests o GITHUB_SHA é o commit de merge; o pipeline passa o commit real em COMMIT_SHA.
  if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim(); } catch { return 'local'; }
}

export async function build(destino = join(raiz, 'dist')) {
  await rm(destino, { recursive: true, force: true });
  await mkdir(destino, { recursive: true });
  await cp(join(raiz, 'site'), destino, { recursive: true });
  await mkdir(join(destino, 'config'), { recursive: true });
  await cp(join(raiz, 'config', 'servicos.json'), join(destino, 'config', 'servicos.json'));

  // Dados: os mais recentes (trazidos do ramo "dados" pelo pipeline) ou um arquivo vazio.
  await mkdir(join(destino, 'dados'), { recursive: true });
  let dados;
  try {
    await access(join(raiz, 'dados', 'status.json'));
    dados = JSON.parse(await readFile(join(raiz, 'dados', 'status.json'), 'utf8'));
  } catch { dados = statusVazio(); }
  await writeFile(join(destino, 'dados', 'status.json'), JSON.stringify(dados));
  // Métricas DORA (cópia de segurança; a versão ao vivo vem do ramo "dados").
  try {
    await cp(join(raiz, 'dados', 'dora.json'), join(destino, 'dados', 'dora.json'));
  } catch { /* ainda não geradas */ }

  const pkg = JSON.parse(await readFile(join(raiz, 'package.json'), 'utf8'));
  const info = {
    versao: pkg.version,
    commit: commitAtual(),
    ramo: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'local',
    execucao: process.env.GITHUB_RUN_NUMBER ?? null,
    repositorio: process.env.GITHUB_REPOSITORY ?? null,
    gerado_em: new Date().toISOString(),
  };
  await writeFile(join(destino, 'build-info.json'), JSON.stringify(info, null, 2));
  return info;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const info = await build();
  console.log(`Build concluído em dist/ — versão ${info.versao}, commit ${info.commit.slice(0, 7)}.`);
}
