// Dados ao vivo: o monitoramento grava status.json e dora.json no ramo "dados" do GitHub a cada 15 minutos.
// Esta função entrega esses arquivos em /dados/…, então o painel se atualiza SEM precisar de um novo deploy.
// Assim, só mudanças de código geram deploy (e o rollback não é desfeito pelo monitoramento).
// Se o GitHub não responder, entrega a cópia que foi embutida no build.
import { repositorio } from './repositorio.js';

export const ARQUIVOS_DADOS = new Set(['status.json', 'dora.json']);

export async function servirDados({ request, env, params }, fetchFn = fetch) {
  const nome = Array.isArray(params?.arquivo) ? params.arquivo.join('/') : params?.arquivo;
  if (!ARQUIVOS_DADOS.has(nome)) return env.ASSETS.fetch(request);

  const repo = await repositorio(env, request);
  if (repo) {
    try {
      const r = await fetchFn(`https://raw.githubusercontent.com/${repo}/dados/${nome}`, {
        cf: { cacheTtl: 60, cacheEverything: true },
      });
      if (r.ok) {
        const texto = await r.text();
        JSON.parse(texto); // só repassa JSON válido
        return new Response(texto, {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Fonte-Dados': 'ramo-dados' },
        });
      }
    } catch { /* cai na cópia do build */ }
  }
  const copia = await env.ASSETS.fetch(new URL(`/dados/${nome}`, request.url));
  const resposta = new Response(copia.body, copia);
  resposta.headers.set('X-Fonte-Dados', 'build');
  return resposta;
}
