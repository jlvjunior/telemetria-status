// Descobre o repositório do GitHub: segredo GH_REPO ou o build-info.json gerado pelo pipeline.
export async function repositorio(env, request) {
  if (env.GH_REPO) return env.GH_REPO;
  try {
    const r = await env.ASSETS.fetch(new URL('/build-info.json', request.url));
    return (await r.json()).repositorio || null;
  } catch {
    return null;
  }
}
