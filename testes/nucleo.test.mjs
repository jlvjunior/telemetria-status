import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGRAS, classificar, aplicarVerificacao, atualizarStatus, statusVazio, disponibilidadeDias,
  disponibilidade24h, latenciaMedia, mttr, oscilando, resumoGeral, formatarDuracao, formatarPercentual, diaLocal,
} from '../site/js/nucleo.js';

const SV = { id: 'site', nome: 'Site', categoria: 'Trabalho', url: 'https://exemplo.com/' };
const OK = { ok: true, ms: 300, http: 200, erro: null };
const LENTO = { ok: true, ms: 4500, http: 200, erro: null };
const FALHA = { ok: false, ms: 10000, http: null, erro: 'Sem resposta em 10 s' };
const T0 = Date.UTC(2026, 10, 17, 15, 0, 0);
const MIN15 = 15 * 60 * 1000;

test('classifica resposta rápida, lenta e falha', () => {
  assert.equal(classificar(OK, SV), 'operacional');
  assert.equal(classificar(LENTO, SV), 'lento');
  assert.equal(classificar(FALHA, SV), 'falha');
  assert.equal(classificar(LENTO, { ...SV, limite_lento_ms: 5000 }), 'operacional');
});

test('debounce: a primeira falha deixa instável; a segunda declara fora e abre incidente', () => {
  let r = aplicarVerificacao(undefined, OK, SV, T0);
  assert.equal(r.servico.estado, 'operacional');
  r = aplicarVerificacao(r.servico, FALHA, SV, T0 + MIN15);
  assert.equal(r.servico.estado, 'instavel');
  assert.equal(r.eventos.length, 0);
  r = aplicarVerificacao(r.servico, FALHA, SV, T0 + 2 * MIN15);
  assert.equal(r.servico.estado, 'fora');
  assert.deepEqual(r.eventos, [{ tipo: 'abrir', em: T0 + MIN15, motivo: 'Sem resposta em 10 s' }]);
});

test('uma falha isolada não abre incidente', () => {
  let r = aplicarVerificacao(undefined, FALHA, SV, T0);
  r = aplicarVerificacao(r.servico, OK, SV, T0 + MIN15);
  assert.equal(r.servico.estado, 'operacional');
  assert.equal(r.eventos.length, 0);
  assert.equal(r.servico.falhas_seguidas, 0);
});

test('atualizarStatus abre e encerra o incidente com a duração desde a primeira falha', () => {
  let st = statusVazio();
  st = atualizarStatus(st, [SV], { site: OK }, T0);
  st = atualizarStatus(st, [SV], { site: FALHA }, T0 + MIN15);
  st = atualizarStatus(st, [SV], { site: FALHA }, T0 + 2 * MIN15);
  assert.equal(st.incidentes.length, 1);
  assert.equal(st.incidentes[0].fim, null);
  st = atualizarStatus(st, [SV], { site: FALHA }, T0 + 3 * MIN15);
  assert.equal(st.incidentes.length, 1, 'não duplica incidente enquanto continua fora');
  st = atualizarStatus(st, [SV], { site: OK }, T0 + 4 * MIN15);
  assert.equal(st.incidentes[0].fim, T0 + 4 * MIN15);
  assert.equal(st.incidentes[0].duracao_s, 45 * 60);
  assert.equal(st.servicos.site.estado, 'operacional');
  assert.equal(mttr(st.incidentes, 'site'), 45 * 60);
});

test('guarda no máximo 96 amostras e 90 dias de histórico', () => {
  let s;
  for (let i = 0; i < 130; i++) s = aplicarVerificacao(s, OK, SV, T0 + i * MIN15).servico;
  assert.equal(s.amostras.length, REGRAS.maxAmostras);
  s.dias['2020-01-01'] = [10, 10, 1000];
  s = aplicarVerificacao(s, OK, SV, T0 + 200 * MIN15).servico;
  assert.ok(!('2020-01-01' in s.dias));
});

test('remove do status os serviços que saíram da configuração e ignora os sem resultado', () => {
  let st = atualizarStatus(statusVazio(), [SV, { ...SV, id: 'outro' }], { site: OK, outro: OK }, T0);
  st = atualizarStatus(st, [SV], { site: OK }, T0 + MIN15);
  assert.deepEqual(Object.keys(st.servicos), ['site']);
  const novo = { ...SV, id: 'novo' };
  st = atualizarStatus(st, [SV, novo], { site: OK }, T0 + 2 * MIN15);
  assert.ok(!('novo' in st.servicos));
});

test('calcula disponibilidade por dias e nas últimas 24 h', () => {
  const dias = { [diaLocal(T0)]: [4, 3, 900], [diaLocal(T0 - 864e5)]: [4, 4, 1200] };
  assert.equal(disponibilidadeDias(dias, 1, T0), 75);
  assert.equal(disponibilidadeDias(dias, 2, T0), 87.5);
  assert.equal(disponibilidadeDias({}, 30, T0), null);
  const t = T0 / 1000;
  const amostras = [[t - 90000, 0, null], [t - 3600, 1, 200], [t - 1800, 0, null], [t - 900, 1, 400]];
  assert.equal(disponibilidade24h(amostras, T0), 2 / 3 * 100);
  assert.equal(latenciaMedia(amostras), 300);
});

test('detecta oscilação (flapping)', () => {
  const t = 1;
  const alterna = Array.from({ length: 12 }, (_, i) => [t + i, i % 2, 100]);
  const estavel = Array.from({ length: 12 }, (_, i) => [t + i, 1, 100]);
  assert.equal(oscilando(alterna), true);
  assert.equal(oscilando(estavel), false);
});

test('resumo geral indica o pior nível', () => {
  const servicos = [SV, { ...SV, id: 'b' }, { ...SV, id: 'c' }];
  const st = { servicos: { site: { estado: 'operacional' }, b: { estado: 'lento' } } };
  const r = resumoGeral(st, servicos);
  assert.equal(r.nivel, 'parcial');
  assert.equal(r.desconhecido, 1);
  st.servicos.c = { estado: 'fora' };
  assert.equal(resumoGeral(st, servicos).nivel, 'grave');
});

test('formata durações e percentuais em português', () => {
  assert.equal(formatarDuracao(45), '45 s');
  assert.equal(formatarDuracao(2700), '45 min');
  assert.equal(formatarDuracao(5400), '1 h 30 min');
  assert.equal(formatarDuracao(90000), '1 d 1 h');
  assert.equal(formatarPercentual(99.5), '99,50%');
  assert.equal(formatarPercentual(100), '100%');
  assert.equal(formatarPercentual(null), '—');
});

test('gera id a partir do nome, sem acentos nem espaços', async () => {
  const { gerarId } = await import('../site/js/nucleo.js');
  assert.equal(gerarId('Banco do Brasil'), 'banco-do-brasil');
  assert.equal(gerarId('  iFood! '), 'ifood');
  assert.equal(gerarId('Receita Federal — e-CAC'), 'receita-federal-e-cac');
  assert.equal(gerarId('Ação & Cia'), 'acao-cia');
});
