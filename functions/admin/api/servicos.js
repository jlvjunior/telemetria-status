// API da área de gestão (já protegida pelo _middleware.js de /admin).
// GET  /admin/api/servicos → lista atual de serviços (do GitHub, quando há token) e se dá para salvar direto.
// PUT  /admin/api/servicos → valida a lista com as mesmas regras do pipeline e grava um commit no GitHub.
import { lerConfig, salvarConfig, conferirLista, limparServico, resumirMudancas, json, ErroGitHub } from '../../../lib/admin.js';
import { repositorio } from '../../../lib/repositorio.js';

export async function onRequestGet({ env, request }) {
  const repo = await repositorio(env, request);
  if (env.GH_ADMIN_TOKEN && repo) {
    try {
      const { servicos, sha } = await lerConfig({ repo, token: env.GH_ADMIN_TOKEN });
      return json({ servicos, sha, repo, salvarDireto: true });
    } catch (e) {
      return json({ erro: e.message }, e instanceof ErroGitHub ? 502 : 500);
    }
  }
  // Sem token: usa a lista publicada; a página gera o arquivo para colar no GitHub.
  const r = await env.ASSETS.fetch(new URL('/config/servicos.json', request.url));
  return json({ servicos: await r.json(), sha: null, repo, salvarDireto: false });
}

export async function onRequestPut({ env, request }) {
  // Só aceita JSON enviado pela própria página (bloqueia envio a partir de outros sites).
  const origem = request.headers.get('Origin');
  if (origem && origem !== new URL(request.url).origin) return json({ erro: 'Origem não permitida.' }, 403);
  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) return json({ erro: 'Envie JSON.' }, 415);

  const repo = await repositorio(env, request);
  if (!env.GH_ADMIN_TOKEN || !repo) {
    return json({ erro: 'Salvar direto não está configurado (segredo GH_ADMIN_TOKEN). Use “Gerar arquivo”.' }, 501);
  }

  let corpo;
  try { corpo = await request.json(); } catch { return json({ erro: 'JSON inválido.' }, 400); }
  if (!Array.isArray(corpo?.servicos) || typeof corpo.sha !== 'string') return json({ erro: 'Envie { servicos: [...], sha }.' }, 400);

  const servicos = corpo.servicos.map(limparServico);
  const erros = conferirLista(servicos);
  if (erros.length) return json({ erro: 'A lista tem erros.', erros }, 422);

  try {
    const atual = await lerConfig({ repo, token: env.GH_ADMIN_TOKEN });
    if (atual.sha !== corpo.sha) {
      return json({ erro: 'A lista mudou no GitHub enquanto você editava. Recarregue a página e refaça a alteração.' }, 409);
    }
    const resumo = resumirMudancas(atual.servicos, servicos);
    if (!resumo) return json({ erro: 'Nenhuma alteração para salvar.' }, 400);
    const mensagem = `${resumo} (via área de gestão)`;
    const salvo = await salvarConfig({ repo, token: env.GH_ADMIN_TOKEN, servicos, sha: corpo.sha, mensagem });
    return json({ ok: true, mensagem, ...salvo, actionsUrl: `https://github.com/${repo}/actions` });
  } catch (e) {
    return json({ erro: e.message }, e instanceof ErroGitHub ? (e.status === 409 ? 409 : 502) : 500);
  }
}
