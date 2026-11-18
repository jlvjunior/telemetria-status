// Cloudflare Pages Function: tudo que fica em /admin passa por aqui antes de ser entregue.
// Sem usuário e senha corretos, o navegador recebe 401 e nem a página nem a API são enviadas.
import { exigirSenha } from '../../lib/admin.js';

export const onRequest = exigirSenha;
