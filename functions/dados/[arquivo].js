// Cloudflare Pages Function: /dados/status.json e /dados/dora.json vêm do ramo "dados" (ao vivo).
import { servirDados } from '../../lib/dados.js';

export const onRequestGet = (contexto) => servirDados(contexto);
