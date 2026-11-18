// Etapa de validação do pipeline: falha (código 1) se a lista de serviços tiver erro.
import { lerServicos, validarServicos } from './configuracao.mjs';

let lista;
try {
  lista = await lerServicos();
} catch (e) {
  console.error(`::error file=config/servicos.json::JSON inválido: ${e.message}`);
  process.exit(1);
}
const erros = validarServicos(lista);
if (erros.length) {
  for (const e of erros) console.error(`::error file=config/servicos.json::${e}`);
  process.exit(1);
}
console.log(`config/servicos.json válido: ${lista.length} serviços.`);
