import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarServicos, lerServicos } from '../scripts/configuracao.mjs';

const base = { id: 'teste', nome: 'Teste', categoria: 'Trabalho', url: 'https://exemplo.com/' };

test('a lista de serviços do repositório é válida', async () => {
  const lista = await lerServicos();
  assert.deepEqual(validarServicos(lista), []);
  assert.ok(lista.length >= 5);
});

test('aponta id repetido, url sem https, categoria e limites inválidos', () => {
  const erros = validarServicos([
    base,
    { ...base },
    { ...base, id: 'Com Espaco', url: 'http://inseguro.com' },
    { ...base, id: 'cat', categoria: 'Outra' },
    { ...base, id: 'lim', limite_lento_ms: 50, timeout_ms: 99999 },
  ]);
  const texto = erros.join('\n');
  assert.match(texto, /repetido/);
  assert.match(texto, /letras minúsculas/);
  assert.match(texto, /https/);
  assert.match(texto, /categoria/);
  assert.match(texto, /limite_lento_ms/);
  assert.match(texto, /timeout_ms/);
});

test('rejeita lista vazia ou formato errado', () => {
  assert.notDeepEqual(validarServicos([]), []);
  assert.notDeepEqual(validarServicos({}), []);
});
