// Leitura e validação da lista de serviços monitorados (config/servicos.json).
import { readFile } from 'node:fs/promises';
import { CATEGORIAS } from '../site/js/nucleo.js';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Devolve a lista de erros (vazia quando a configuração é válida).
export function validarServicos(lista) {
  const erros = [];
  if (!Array.isArray(lista)) return ['A configuração deve ser uma lista de serviços.'];
  if (lista.length === 0) erros.push('A lista de serviços está vazia.');
  if (lista.length > 60) erros.push('No máximo 60 serviços (o verificador roda a cada 15 minutos).');
  const vistos = new Set();
  lista.forEach((s, i) => {
    const onde = `Serviço ${i + 1}${s?.id ? ` (${s.id})` : ''}`;
    if (!s || typeof s !== 'object') { erros.push(`${onde}: deve ser um objeto.`); return; }
    if (typeof s.id !== 'string' || !ID.test(s.id)) erros.push(`${onde}: "id" deve ter só letras minúsculas, números e hífens.`);
    else if (vistos.has(s.id)) erros.push(`${onde}: "id" repetido.`);
    else vistos.add(s.id);
    if (typeof s.nome !== 'string' || s.nome.trim().length < 2 || s.nome.length > 40) erros.push(`${onde}: "nome" deve ter entre 2 e 40 caracteres.`);
    if (!CATEGORIAS.includes(s.categoria)) erros.push(`${onde}: "categoria" deve ser uma de: ${CATEGORIAS.join(', ')}.`);
    let url;
    try { url = new URL(s.url); } catch { erros.push(`${onde}: "url" inválida.`); }
    if (url && url.protocol !== 'https:') erros.push(`${onde}: "url" deve usar https.`);
    if (s.limite_lento_ms !== undefined && !(Number.isInteger(s.limite_lento_ms) && s.limite_lento_ms >= 200 && s.limite_lento_ms <= 20000)) {
      erros.push(`${onde}: "limite_lento_ms" deve ser um inteiro entre 200 e 20000.`);
    }
    if (s.timeout_ms !== undefined && !(Number.isInteger(s.timeout_ms) && s.timeout_ms >= 1000 && s.timeout_ms <= 30000)) {
      erros.push(`${onde}: "timeout_ms" deve ser um inteiro entre 1000 e 30000.`);
    }
  });
  return erros;
}

export async function lerServicos(caminho = new URL('../config/servicos.json', import.meta.url)) {
  return JSON.parse(await readFile(caminho, 'utf8'));
}
