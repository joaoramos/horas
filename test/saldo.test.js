import { test } from 'node:test';
import assert from 'node:assert/strict';

import { somarDiasUteis, segundaDeReferencia } from '../src/datas.js';
import { calcularSaldo, validarRegisto, semanasEditaveis, historico } from '../src/saldo.js';
import { interpretar, lerData, lerHoras } from '../src/dados.js';

// Outubro de 2026: segunda 19, quarta 21, sábado 24, segunda 26, quarta 28.
const r = (data, minutos) => ({ data, minutos, nota: '' });
const saldo = (registos, hoje, extra = {}) => calcularSaldo({ saldoInicial: 0, registos, hoje, ...extra });

test('o prazo de compensação é 5 dias úteis depois', () => {
  assert.equal(somarDiasUteis('2026-10-21', 5), '2026-10-28');
  assert.equal(somarDiasUteis('2026-10-23', 5), '2026-10-30');
  assert.equal(somarDiasUteis('2026-10-21', 5, new Set(['2026-10-26'])), '2026-10-29');
});

test('ao fim de semana, a semana corrente é a que vem', () => {
  assert.equal(segundaDeReferencia('2026-10-24'), '2026-10-26');
  assert.equal(segundaDeReferencia('2026-10-25'), '2026-10-26');
  assert.equal(segundaDeReferencia('2026-10-23'), '2026-10-19');
});

test('horas não compensadas no prazo ficam em incumprimento', () => {
  const s = saldo([r('2026-10-21', 120)], '2026-10-29');
  assert.equal(s.saldoTotal, 120);
  assert.equal(s.emIncumprimento, true);
  assert.deepEqual(s.emAtraso, [{ data: '2026-10-21', prazo: '2026-10-28', minutos: 120 }]);
});

test('no último dia do prazo ainda não há incumprimento', () => {
  assert.equal(saldo([r('2026-10-21', 120)], '2026-10-28').emIncumprimento, false);
});

test('compensar em vários dias, dentro do prazo', () => {
  const s = saldo([r('2026-10-21', 120), r('2026-10-26', -60), r('2026-10-27', -60)], '2026-10-29');
  assert.equal(s.saldoTotal, 0);
  assert.equal(s.emIncumprimento, false);
  assert.equal(s.pendentes.length, 0);
});

test('compensar tarde resolve o incumprimento, mas só depois de o dia terminar', () => {
  const registos = [r('2026-10-21', 120), r('2026-10-29', -120)];
  assert.equal(saldo(registos, '2026-10-29').emIncumprimento, true);
  assert.equal(saldo(registos, '2026-10-30').emIncumprimento, false);
});

test('as compensações abatem primeiro as horas mais antigas', () => {
  const s = saldo([r('2026-10-19', 60), r('2026-10-20', 60), r('2026-10-21', -90)], '2026-10-22');
  assert.deepEqual(s.pendentes, [{ data: '2026-10-20', prazo: '2026-10-27', minutos: 30 }]);
});

test('o saldo inicial é transitado e não tem prazo', () => {
  const s = calcularSaldo({ saldoInicial: 70 * 60, registos: [r('2026-10-19', -120)], hoje: '2026-11-30' });
  assert.equal(s.saldoTotal, 68 * 60);
  assert.equal(s.saldoTransitado, 68 * 60);
  assert.equal(s.emIncumprimento, false);
});

test('com saldo transitado positivo, horas a mais continuam a ter de ser compensadas', () => {
  const s = calcularSaldo({ saldoInicial: 70 * 60, registos: [r('2026-10-19', 60)], hoje: '2026-11-30' });
  assert.equal(s.saldoTransitado, 70 * 60);
  assert.equal(s.emIncumprimento, true);
});

test('as compensações abatem os desvios pendentes antes do saldo transitado', () => {
  const s = calcularSaldo({
    saldoInicial: -300,
    registos: [r('2026-10-19', -60), r('2026-10-20', 120)],
    hoje: '2026-10-21',
  });
  assert.equal(s.saldoTransitado, -240);
  assert.equal(s.pendentes.length, 0);
});

test('a compensar até ao fim da semana corrente e da seguinte', () => {
  const s = saldo([r('2026-10-13', 30), r('2026-10-19', 60)], '2026-10-19');
  assert.deepEqual(s.semanaCorrente, { ate: '2026-10-23', minutos: 30 });
  assert.deepEqual(s.semanaSeguinte, { ate: '2026-10-30', minutos: 90 });
  // Hoje ainda não terminou, por isso só conta para o saldo previsto.
  assert.equal(s.saldoTotal, 30);
  assert.equal(s.saldoPrevisto, 90);
});

test('horas planeadas contam para o que falta compensar', () => {
  const s = saldo([r('2026-10-21', 120), r('2026-10-27', -120)], '2026-10-23');
  assert.equal(s.semanaSeguinte.minutos, 0);
  assert.equal(s.saldoTotal, 120);
});

test('vários registos no mesmo dia somam-se', () => {
  const s = saldo([r('2026-10-21', 60), r('2026-10-21', 30)], '2026-10-22');
  assert.equal(s.dias.length, 1);
  assert.equal(s.dias[0].minutos, 90);
});

test('validação dos registos', () => {
  const hoje = '2026-10-21';
  const f = new Set(['2026-10-22']);
  assert.equal(validarRegisto({ data: '2026-10-21', horas: 1.25 }, hoje, f), 75);
  assert.equal(validarRegisto({ data: '2026-10-21', horas: -2 }, hoje, f), -120);
  assert.throws(() => validarRegisto({ data: '2026-10-21', horas: 2.25 }, hoje, f), /2 horas/);
  assert.throws(() => validarRegisto({ data: '2026-10-21', horas: 1 / 6 }, hoje, f), /15 minutos/);
  assert.throws(() => validarRegisto({ data: '2026-10-24', horas: 1 }, hoje, f), /dias úteis/);
  assert.throws(() => validarRegisto({ data: '2026-10-22', horas: 1 }, hoje, f), /dias úteis/);
  assert.throws(() => validarRegisto({ data: '2026-10-09', horas: 1 }, hoje, f), /já não pode/);
  assert.throws(() => validarRegisto({ data: '2026-11-09', horas: 1 }, hoje, f), /já não pode/);
  assert.equal(validarRegisto({ data: '2026-10-12', horas: 1 }, hoje, f), 60);
  assert.equal(validarRegisto({ data: '2026-11-06', horas: 1 }, hoje, f), 60);
  assert.throws(() => validarRegisto({ data: '2026-02-30', horas: 1 }, hoje, f), /Data inválida/);
});

test('semanas para registar: a anterior, a corrente e as duas seguintes', () => {
  const s = saldo([r('2026-10-20', 45)], '2026-10-21');
  const semanas = semanasEditaveis(s, new Set());
  assert.deepEqual(semanas.map((x) => x.segunda), ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
  assert.equal(semanas[1].atual, true);
  assert.equal(semanas[1].dias[1].minutos, 45);
});

test('histórico mostra o que falta compensar', () => {
  const s = saldo([r('2026-10-19', 60), r('2026-10-21', -30)], '2026-10-21');
  const h = historico(s);
  assert.equal(h[0].estado, 'hoje');
  assert.equal(h[0].trabalhados, 450);
  assert.equal(h[1].porCompensar, 30);
  assert.equal(h[1].prazo, '2026-10-26');
});

test('ler horas e datas escritas à mão na folha', () => {
  assert.equal(lerHoras(2), 120);
  assert.equal(lerHoras('1,5'), 90);
  assert.equal(lerHoras('-1.25'), -75);
  assert.equal(lerHoras('-1:30'), -90);
  assert.equal(lerHoras('−2h'), -120);
  assert.equal(lerHoras('1h15'), 75);
  assert.equal(lerHoras(''), 0);
  assert.equal(lerHoras('abc'), null);
  assert.equal(lerData('24/10/2026'), '2026-10-24');
  assert.equal(lerData('2026-10-24'), '2026-10-24');
  assert.equal(lerData('ontem'), null);
});

test('interpretar a folha aceita cabeçalhos escritos de outra forma', () => {
  const dados = interpretar({
    funcionarios: [
      ['ID', 'Nome', 'PIN', 'Saldo inicial (horas)', 'Ativo'],
      ['', 'Mariana', 1234, 70, 'sim'],
      ['joana', 'Joana', '9', 0, 'não'],
    ],
    registos: [['Data', 'Funcionário', 'Horas'], ['2026-10-21', 'Mariana', '1,5'], ['', '', '']],
    feriados: [['Data', 'Descrição'], ['08/12/2026', 'Imaculada Conceição']],
  });
  assert.deepEqual(dados.funcionarios, [{ id: 'mariana', nome: 'Mariana', pin: '1234', saldoInicial: 4200, ativo: true }]);
  assert.deepEqual(dados.registos, [{ data: '2026-10-21', funcionario: 'mariana', minutos: 90, nota: '' }]);
  assert.deepEqual([...dados.feriados], ['2026-12-08']);
});
