// Leitura e validação da lista de serviços monitorados (config/servicos.json).
import { readFile } from 'node:fs/promises';
import { validarServicos } from '../site/js/nucleo.js';

export { validarServicos };

export async function lerServicos(caminho = new URL('../config/servicos.json', import.meta.url)) {
  return JSON.parse(await readFile(caminho, 'utf8'));
}
