import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fimDoMes, segundaDeReferencia } from '../src/datas.js';
import { calcularSaldo, desvioDoHorario, estadoDosLimites, validarRegisto, semanasEditaveis, historico } from '../src/saldo.js';
import { preencherDias } from '../src/index.js';
import { interpretar, lerData, lerHoras } from '../src/dados.js';

// Outubro de 2026: segunda 19, quarta 21, sábado 24, segunda 26, quarta 28.
const r = (data, minutos) => ({ data, minutos, nota: '' });
const H = 60;
const HORARIO_VERA = { entrada: 9 * H + 30, saida: 18 * H + 30, pausa: H };
const saldo = (registos, hoje, extra = {}) => calcularSaldo({ saldoInicial: 0, registos, hoje, ...extra });

test('fim do mês', () => {
  assert.equal(fimDoMes('2026-11-14'), '2026-11-30');
  assert.equal(fimDoMes('2028-02-01'), '2028-02-29');
});

test('ao fim de semana, a semana corrente é a que vem', () => {
  assert.equal(segundaDeReferencia('2026-10-24'), '2026-10-26');
  assert.equal(segundaDeReferencia('2026-10-25'), '2026-10-26');
  assert.equal(segundaDeReferencia('2026-10-23'), '2026-10-19');
});

// Os limites (+50h / −30h) aplicam-se a partir de 1 de novembro de 2026.

test('antes do início dos limites, tudo conta para o saldo transitado', () => {
  const s = calcularSaldo({ saldoInicial: 70 * H, registos: [r('2026-10-27', -2 * H), r('2026-10-28', H)], hoje: '2026-10-30' });
  assert.equal(s.saldoTotal, 69 * H);
  assert.equal(s.saldoTransitado, 69 * H);
  assert.equal(s.limites.saldo, 0);
});

test('o saldo transitado está isento dos limites e só diminui', () => {
  const s = calcularSaldo({
    saldoInicial: 70 * H,
    registos: [r('2026-11-02', -2 * H), r('2026-11-03', H)],
    hoje: '2026-12-01',
  });
  // −2h abatem o transitado; +1h vai para o saldo com limites
  assert.equal(s.saldoTransitado, 68 * H);
  assert.equal(s.limites.saldo, H);
  assert.equal(s.saldoTotal, 69 * H);
  assert.deepEqual(s.fechos, [{ data: '2026-11-30', antes: H, depois: H, perdidas: 0, aDescontar: 0 }]);
});

test('no fecho do mês, as horas acima de +50h perdem-se', () => {
  const s = saldo([r('2026-11-07', 30 * H), r('2026-11-14', 24 * H), r('2026-12-02', H)], '2026-12-03');
  assert.deepEqual(s.fechos, [{ data: '2026-11-30', antes: 54 * H, depois: 50 * H, perdidas: 4 * H, aDescontar: 0 }]);
  assert.equal(s.saldoTotal, 51 * H);
});

test('no fecho do mês, as horas abaixo de −30h são descontadas no salário', () => {
  const s = saldo([r('2026-11-10', -8 * H), r('2026-11-11', -8 * H), r('2026-11-12', -8 * H), r('2026-11-13', -8 * H)], '2026-12-01');
  assert.deepEqual(s.fechos, [{ data: '2026-11-30', antes: -32 * H, depois: -30 * H, perdidas: 0, aDescontar: 2 * H }]);
  assert.equal(s.saldoTotal, -30 * H);
});

test('o mês só fecha depois de o último dia terminar', () => {
  const registos = [r('2026-11-07', 52 * H)];
  assert.equal(saldo(registos, '2026-11-30').fechos.length, 0);
  assert.equal(saldo(registos, '2026-11-30').limites.estado, 'acima');
  assert.equal(saldo(registos, '2026-11-30').limites.perdidasNoFecho, 2 * H);
  assert.equal(saldo(registos, '2026-12-01').saldoTotal, 50 * H);
});

test('os saldos transitam de mês para mês', () => {
  const s = saldo([r('2026-11-10', 10 * H), r('2026-12-10', 5 * H)], '2027-01-05');
  assert.deepEqual(s.fechos.map((f) => f.depois), [10 * H, 15 * H]);
  assert.equal(s.saldoTotal, 15 * H);
});

test('aviso quando está perto dos limites', () => {
  assert.equal(estadoDosLimites(39 * H), 'ok');
  assert.equal(estadoDosLimites(40 * H), 'perto');
  assert.equal(estadoDosLimites(-24 * H), 'perto');
  assert.equal(estadoDosLimites(-31 * H), 'abaixo');
});

test('hoje e os dias seguintes contam como planeados', () => {
  const s = saldo([r('2026-11-02', H), r('2026-11-04', 2 * H)], '2026-11-04');
  assert.equal(s.saldoTotal, H);
  assert.equal(s.saldoPrevisto, 3 * H);
  assert.equal(s.limites.previsto, 3 * H);
});

test('vários registos no mesmo dia somam-se', () => {
  const s = saldo([r('2026-10-21', 60), r('2026-10-21', 30)], '2026-10-22');
  assert.equal(s.dias.length, 1);
  assert.equal(s.dias[0].minutos, 90);
});

test('o desvio vem da entrada, da saída e da pausa de 1h', () => {
  assert.equal(desvioDoHorario(9 * H + 30, 18 * H + 30, H), 0);
  assert.equal(desvioDoHorario(9 * H + 30, 19 * H, H), 30);
  assert.equal(desvioDoHorario(10 * H, 18 * H, H), -H);
});

test('validação dos registos', () => {
  const hoje = '2026-10-21';
  const f = new Set(['2026-10-22']);
  const v = (data, entrada, saida, extra) => validarRegisto({ data, entrada, saida }, hoje, f, extra);
  assert.deepEqual(v('2026-10-21', '9:30', '19:45'), { minutos: 75, entrada: '09:30', saida: '19:45' });
  assert.deepEqual(v('2026-10-21', '10:30', '17:30'), { minutos: -120, entrada: '10:30', saida: '17:30' });
  assert.throws(() => v('2026-10-21', '09:30', '20:45'), /até 2 horas/);
  assert.throws(() => v('2026-10-21', '09:30', '18:40'), /15 minutos/);
  assert.throws(() => v('2026-10-21', '18:30', '09:30'), /depois da entrada/);
  assert.throws(() => v('2026-10-21', '', '18:30'), /entrada e de saída/);
  assert.throws(() => v('2026-10-24', '09:30', '18:30'), /APJM/);
  assert.throws(() => v('2026-10-22', '09:30', '18:30'), /APJM/);
  // Um dia completo registado pela APJM na folha não pode ser alterado na app
  assert.throws(() => v('2026-10-21', '09:30', '18:30', { minutosAtuais: -480 }), /registado pela APJM/);
  assert.throws(() => v('2026-10-09', '09:30', '18:30'), /já não pode/);
  assert.throws(() => v('2026-11-09', '09:30', '18:30'), /já não pode/);
  assert.equal(v('2026-10-12', '09:00', '19:00').minutos, 60);
  assert.equal(v('2026-11-06', '09:00', '19:00').minutos, 60);
  // Outra pausa (ex.: 30 minutos)
  assert.equal(v('2026-10-21', '09:00', '17:30', { pausa: 30 }).minutos, 0);
  assert.throws(() => v('2026-02-30', '09:30', '18:30'), /Data inválida/);
});

test('semanas para registar: a anterior, a corrente e as duas seguintes', () => {
  const s = saldo([r('2026-10-20', 45)], '2026-10-21');
  const semanas = semanasEditaveis(s, new Set(), HORARIO_VERA);
  assert.deepEqual(semanas.map((x) => x.segunda), ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
  assert.equal(semanas[1].atual, true);
  assert.equal(semanas[1].dias[1].minutos, 45);
  // Sem registo, cada dia mostra o horário habitual
  assert.deepEqual([semanas[1].dias[2].entrada, semanas[1].dias[2].saida, semanas[1].dias[2].registado], ['09:30', '18:30', false]);
});

test('histórico distingue os dias registados pela APJM', () => {
  const s = saldo([r('2026-10-17', 4 * H), r('2026-10-19', -8 * H), r('2026-10-21', -30)], '2026-10-21');
  const h = historico(s, new Set());
  assert.deepEqual(h.map((x) => [x.data, x.estado, x.trabalhados, x.apjm]), [
    ['2026-10-21', 'hoje', 450, false],
    ['2026-10-19', 'confirmado', 0, true],   // dia completo de ausência
    ['2026-10-17', 'confirmado', 240, true], // sábado: 4h trabalhadas
  ]);
});

test('semanas para registar: dias da APJM não são editáveis', () => {
  const s = saldo([r('2026-10-20', -8 * H)], '2026-10-21');
  const dia = semanasEditaveis(s, new Set(), HORARIO_VERA)[1].dias[1];
  assert.equal(dia.apjm, true);
  assert.equal(dia.editavel, false);
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
  assert.deepEqual(dados.funcionarios, [{ id: 'mariana', nome: 'Mariana', pin: '1234', saldoInicial: 4200, ativo: true, horario: { entrada: 540, saida: 1080, pausa: 60 } }]);
  assert.deepEqual(dados.registos, [{ data: '2026-10-21', funcionario: 'mariana', minutos: 90, entrada: null, saida: null, nota: '' }]);
  assert.deepEqual([...dados.feriados], ['2026-12-08']);
});

test('interpretar: o desvio vem do horário; sem horário, da coluna horas', () => {
  const dados = interpretar({
    funcionarios: [
      ['id', 'nome', 'pin', 'saldo_inicial', 'entrada', 'saida', 'pausa'],
      ['vera', 'Vera', '1', 0, '9:30', '18:30', 1],
      ['ana', 'Ana', '2', 0, '', '', ''],
    ],
    registos: [
      ['data', 'funcionario', 'entrada', 'saida', 'horas', 'nota'],
      ['2026-11-02', 'vera', '09:30', '19:00', '', ''],        // dia útil: +30min, pelo horário
      ['2026-11-03', 'vera', '09:30', '18:30', 5, ''],         // o horário manda sobre a coluna horas
      ['2026-11-04', 'vera', '', '', -8, 'Dia completo'],      // ausência registada pela APJM
      ['2026-11-07', 'vera', '10:00', '14:00', '', 'Sábado'],  // fim de semana: horas trabalhadas
    ],
    feriados: [['data']],
  });
  assert.deepEqual(dados.registos.map((r) => r.minutos), [30, 0, -480, 240]);
  assert.deepEqual(dados.funcionarios[1].horario, { entrada: 9 * H, saida: 18 * H, pausa: H });
});

test('preenchimento noturno: acrescenta os dias úteis sem registo, uma só vez', async () => {
  const env = { DEMO: '1' };
  // De 1 a 9 de novembro há 6 dias úteis × 2 pessoas; a Mariana já tem os dias 2 e 3 nos dados de exemplo.
  assert.equal(await preencherDias(env, '2026-11-10'), 10);
  assert.equal(await preencherDias(env, '2026-11-10'), 0);
  const { carregarDadosAtuais } = await import('../src/dados.js');
  const vera = (await carregarDadosAtuais(env)).registos.find((r) => r.funcionario === 'vera' && r.data === '2026-11-09');
  assert.deepEqual([vera.entrada, vera.saida, vera.minutos], [9 * H + 30, 18 * H + 30, 0]);
});
