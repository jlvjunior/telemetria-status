// Rollback: volta a produção do Cloudflare Pages para uma versão anterior, sem rebuild (leva segundos).
// Sem commit informado: volta para o deploy de produção bem-sucedido anterior ao que está no ar.
// Com commit (7+ caracteres): volta para o deploy de produção daquele commit.
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';

async function chamar(fetchFn, token, caminho, opcoes = {}, acao = 'a operação') {
  const r = await fetchFn(`${API}${caminho}`, {
    ...opcoes,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  let corpo = null;
  try { corpo = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok || corpo?.success === false) {
    const erro = corpo?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${r.status}`;
    throw new Error(`Cloudflare recusou ${acao}: ${erro}`);
  }
  return corpo.result;
}

const commitDe = (d) => d?.deployment_trigger?.metadata?.commit_hash ?? '';
const sucesso = (d) => d?.latest_stage?.status === 'success';

// Escolhe o deploy de destino (função pura, testada separadamente).
export function escolherDestino(deploys, atualId, commit) {
  const producao = deploys
    .filter((d) => d.environment === 'production' && sucesso(d))
    .sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  const atual = deploys.find((d) => d.id === atualId);
  if (commit) {
    const alvo = commit.trim().toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(alvo)) throw new Error('Informe o commit com pelo menos 7 caracteres (0-9, a-f).');
    const achado = producao.find((d) => commitDe(d).toLowerCase().startsWith(alvo));
    if (!achado) throw new Error(`Não há deploy de produção bem-sucedido do commit ${alvo}.`);
    if (achado.id === atualId) throw new Error(`O commit ${alvo} já é a versão no ar.`);
    return { atual, destino: achado };
  }
  const commitAtual = commitDe(atual);
  const inicioAtual = atual ? Date.parse(atual.created_on) : Infinity;
  const destino = producao.find((d) => d.id !== atualId && Date.parse(d.created_on) < inicioAtual && commitDe(d) !== commitAtual);
  if (!destino) throw new Error('Não há uma versão anterior de produção para voltar.');
  return { atual, destino };
}

export async function rollback({ token, conta, projeto, commit, fetchFn = fetch }) {
  const base = `/accounts/${conta}/pages/projects/${projeto}`;
  const info = await chamar(fetchFn, token, base, {}, 'a leitura do projeto');
  const deploys = await chamar(fetchFn, token, `${base}/deployments?env=production&per_page=25`, {}, 'a lista de deploys');
  const atualId = info?.canonical_deployment?.id;
  const { atual, destino } = escolherDestino(deploys, atualId, commit);
  await chamar(fetchFn, token, `${base}/deployments/${destino.id}/rollback`, { method: 'POST' }, 'o rollback');
  return {
    de: commitDe(atual) || atualId || 'desconhecido',
    para: commitDe(destino),
    mensagem: destino.deployment_trigger?.metadata?.commit_message?.split('\n')[0] ?? '',
    publicado_em: destino.created_on,
    endereco: `https://${info.subdomain}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: conta, PROJETO_PAGES: projeto, COMMIT: commit, MOTIVO: motivo } = process.env;
  if (!token || !conta || !projeto) {
    console.error('::error::Faltam CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID ou PROJETO_PAGES.');
    process.exit(1);
  }
  try {
    const r = await rollback({ token, conta, projeto, commit });
    console.log(`Produção voltou de ${r.de.slice(0, 7)} para ${r.para.slice(0, 7)} (${r.mensagem}).`);
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `commit=${r.para}\nendereco=${r.endereco}\n`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, [
        '### ↩️ Rollback executado',
        `- Motivo: ${motivo || '(não informado)'}`,
        `- Versão que estava no ar: \`${r.de.slice(0, 7)}\``,
        `- Versão restaurada: \`${r.para.slice(0, 7)}\` — ${r.mensagem}`,
        `- Publicada originalmente em: ${r.publicado_em}`,
        `- Endereço: ${r.endereco}`,
        '',
      ].join('\n'));
    }
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
