// Etapa de segurança: procura senhas, tokens e chaves esquecidos nos arquivos do repositório.
// Se encontrar, o pipeline para antes do build e nada é publicado.
// Para uma linha que é exemplo de propósito, acrescente o comentário "segredos:ignorar".
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const REGRAS = [
  { nome: 'Token do GitHub', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { nome: 'Token fine-grained do GitHub', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { nome: 'Chave privada', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { nome: 'Chave de acesso da AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nome: 'Token do Slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { nome: 'Cabeçalho Authorization com token', re: /Bearer\s+[A-Za-z0-9_\-.]{30,}/ },
  { nome: 'Senha ou token escrito no código', re: /\b(?:senha|password|passwd|secret|token|api[_-]?key)\b["']?\s*[:=]\s*["'][^"'\s$]{8,}["']/i },
];

const IGNORAR_ARQUIVOS = [/^package-lock\.json$/, /\.(png|jpe?g|gif|ico|woff2?|zip|pdf)$/i];
// Arquivos de ambiente nunca devem ir para o repositório.
const PROIBIDOS = [/(^|\/)\.env(\..*)?$/, /(^|\/)\.dev\.vars$/];
const EXCECOES_PROIBIDOS = [/\.exemplo$/, /\.example$/];

export function procurarNoTexto(texto, arquivo) {
  const achados = [];
  texto.split('\n').forEach((linha, i) => {
    if (linha.includes('segredos:ignorar')) return;
    for (const { nome, re } of REGRAS) {
      if (re.test(linha)) achados.push({ arquivo, linha: i + 1, nome });
    }
  });
  return achados;
}

export function arquivoProibido(arquivo) {
  return PROIBIDOS.some((re) => re.test(arquivo)) && !EXCECOES_PROIBIDOS.some((re) => re.test(arquivo));
}

export async function verificarRepositorio(raiz) {
  const arquivos = execFileSync('git', ['ls-files'], { cwd: raiz, encoding: 'utf8' }).split('\n').filter(Boolean);
  const achados = [];
  for (const arquivo of arquivos) {
    if (arquivoProibido(arquivo)) {
      achados.push({ arquivo, linha: 1, nome: 'Arquivo de ambiente com segredos não pode ir para o repositório' });
      continue;
    }
    if (IGNORAR_ARQUIVOS.some((re) => re.test(arquivo))) continue;
    let texto;
    try { texto = await readFile(join(raiz, arquivo), 'utf8'); } catch { continue; }
    achados.push(...procurarNoTexto(texto, arquivo));
  }
  return { arquivos: arquivos.length, achados };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raiz = fileURLToPath(new URL('..', import.meta.url));
  const { arquivos, achados } = await verificarRepositorio(raiz);
  for (const a of achados) console.error(`::error file=${a.arquivo},line=${a.linha}::${a.nome}. Remova o valor do código e use um segredo do GitHub.`);
  if (achados.length) process.exit(1);
  console.log(`Nenhum segredo encontrado em ${arquivos} arquivos.`);
}
