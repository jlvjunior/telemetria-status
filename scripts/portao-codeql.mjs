// Portão de segurança: lê o resultado do CodeQL (SARIF) e bloqueia o pipeline
// se houver vulnerabilidade de severidade alta ou crítica (nota 7.0 ou mais, a mesma escala do GitHub).
import { readFile, readdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITE = 7.0;

export function classificar(sarif) {
  const achados = [];
  for (const run of sarif.runs ?? []) {
    const regras = [...(run.tool?.driver?.rules ?? []), ...(run.tool?.extensions ?? []).flatMap((e) => e.rules ?? [])];
    const nota = new Map(regras.map((r) => [r.id, Number(r.properties?.['security-severity'] ?? 0)]));
    for (const r of run.results ?? []) {
      const loc = r.locations?.[0]?.physicalLocation;
      achados.push({
        regra: r.ruleId,
        nota: nota.get(r.ruleId) ?? 0,
        arquivo: loc?.artifactLocation?.uri ?? '?',
        linha: loc?.region?.startLine ?? 1,
        mensagem: String(r.message?.text ?? '').replace(/\s+/g, ' '),
      });
    }
  }
  return { graves: achados.filter((a) => a.nota >= LIMITE), outros: achados.filter((a) => a.nota < LIMITE) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pasta = process.argv[2];
  const arquivos = (await readdir(pasta)).filter((f) => f.endsWith('.sarif'));
  const graves = [];
  const outros = [];
  for (const f of arquivos) {
    const r = classificar(JSON.parse(await readFile(join(pasta, f), 'utf8')));
    graves.push(...r.graves);
    outros.push(...r.outros);
  }
  for (const a of graves) console.log(`::error file=${a.arquivo},line=${a.linha}::[${a.regra}, nota ${a.nota}] ${a.mensagem}`);
  for (const a of outros) console.log(`::warning file=${a.arquivo},line=${a.linha}::[${a.regra}, nota ${a.nota}] ${a.mensagem}`);
  const resumo = `### 🔐 CodeQL: ${graves.length} vulnerabilidade(s) grave(s), ${outros.length} aviso(s)\n`;
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, resumo);
  console.log(resumo.replace('### ', ''));
  if (graves.length) process.exit(1);
}
