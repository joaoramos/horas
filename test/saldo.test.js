import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fimDoMes, segundaDeReferencia } from '../src/datas.js';
import { calcularSaldo, desvioDoHorario, desvioDosBlocos, estadoDosLimites, feriasDoAno, validarRegisto, semanasEditaveis, historico } from '../src/saldo.js';
import { preencherDias } from '../src/index.js';
import { interpretar, lerData, lerHoras } from '../src/dados.js';

// Outubro de 2026: segunda 19, quarta 21, sábado 24, segunda 26, quarta 28.
const r = (data, minutos) => ({ data, minutos, nota: '' });
const H = 60;
const bloco = (e, s) => ({ entrada: e, saida: s });
const HORARIO_VERA = { manha: bloco(9 * H + 30, 14 * H), tarde: bloco(15 * H, 18 * H + 30) };
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

test('o desvio vem dos dois blocos e do ajuste extraordinário', () => {
  // Vera: 9:30–14:00 e 15:00–18:30 = 8h
  assert.equal(desvioDosBlocos(bloco(9 * H + 30, 14 * H), bloco(15 * H, 18 * H + 30)), 0);
  // Mariana: 10:00–14:00 e 15:00–19:00 = 8h, mais 45 minutos de ajuste
  assert.equal(desvioDosBlocos(bloco(10 * H, 14 * H), bloco(15 * H, 19 * H), 45), 45);
  // Só a manhã
  assert.equal(desvioDosBlocos(bloco(10 * H, 14 * H), null), -4 * H);
  // Registos antigos, com uma entrada, uma saída e a pausa
  assert.equal(desvioDoHorario(9 * H + 30, 19 * H, H), 30);
});

test('validação dos registos', () => {
  const hoje = '2026-10-21';
  const f = new Set(['2026-10-22']);
  const b = (entrada, saida) => ({ entrada, saida });
  const v = (data, manha, tarde, extra = {}, opcoes) => validarRegisto({ data, manha, tarde, ...extra }, hoje, f, opcoes);
  const VERA = [b('9:30', '14:00'), b('15:00', '18:30')];

  assert.deepEqual(v('2026-10-21', b('9:30', '14:00'), b('15:00', '19:45')), {
    minutos: 75, manha: b('09:30', '14:00'), tarde: b('15:00', '19:45'), ajuste: 0, observacao: '', tipo: '',
  });
  // Até 7h a menos: só 1h de trabalho
  assert.equal(v('2026-10-21', b('10:00', '11:00'), b('', '')).minutos, -7 * H);
  assert.equal(v('2026-10-21', b('', ''), b('15:00', '16:00')).tarde.entrada, '15:00');
  // Até 7h a mais: 15h de trabalho
  assert.equal(v('2026-10-21', b('07:00', '14:00'), b('15:00', '23:00')).minutos, 7 * H);
  assert.throws(() => v('2026-10-21', b('10:00', '10:45'), b('', '')), /entre 1h e 15h/);
  assert.throws(() => v('2026-10-21', b('07:00', '14:00'), b('14:00', '23:00')), /entre 1h e 15h/);
  assert.throws(() => v('2026-10-21', b('', ''), b('', '')), /Tirar o dia/);
  // Ajuste extraordinário, de 15 em 15 minutos, dentro do mesmo limite
  assert.equal(v('2026-10-21', ...VERA, { ajuste: -45 }).minutos, -45);
  assert.equal(v('2026-10-21', ...VERA, { ajuste: 7 * H }).minutos, 7 * H);
  assert.throws(() => v('2026-10-21', ...VERA, { ajuste: 20 }), /15 minutos/);
  assert.throws(() => v('2026-10-21', ...VERA, { ajuste: 7 * H + 15 }), /até 7h/);
  assert.throws(() => v('2026-10-21', b('07:00', '14:00'), b('15:00', '22:00'), { ajuste: 2 * H }), /entre 1h e 15h/);
  // Observação até 300 caracteres
  assert.equal(v('2026-10-21', ...VERA, { observacao: '  Consulta  ' }).observacao, 'Consulta');
  assert.equal(v('2026-10-21', ...VERA, { observacao: 'x'.repeat(300) }).observacao.length, 300);
  assert.throws(() => v('2026-10-21', ...VERA, { observacao: 'x'.repeat(301) }), /300 caracteres/);
  // Blocos mal preenchidos
  assert.throws(() => v('2026-10-21', b('09:30', '14:10'), VERA[1]), /15 minutos/);
  assert.throws(() => v('2026-10-21', b('14:00', '09:30'), VERA[1]), /saída da manhã/);
  assert.throws(() => v('2026-10-21', b('09:30', ''), VERA[1]), /entrada e de saída da manhã/);
  assert.throws(() => v('2026-10-21', b('09:30', '15:00'), b('14:00', '18:30')), /tarde tem de começar/);
  // Dias que não se alteram na app
  assert.throws(() => v('2026-10-24', ...VERA), /APJM/);
  assert.throws(() => v('2026-10-22', ...VERA), /APJM/);
  assert.throws(() => v('2026-10-21', ...VERA, {}, { minutosAtuais: -480 }), /registado pela APJM/);
  assert.throws(() => v('2026-10-09', ...VERA), /já não pode/);
  assert.throws(() => v('2026-11-09', ...VERA), /já não pode/);
  assert.equal(v('2026-10-12', ...VERA).minutos, 0);
  assert.equal(v('2026-11-06', ...VERA).minutos, 0);
  assert.throws(() => v('2026-02-30', ...VERA), /Data inválida/);
});

test('tirar o dia: folga ou greve, conta −8h e pode ser anulado', () => {
  const hoje = '2026-10-21';
  const t = (corpo, opcoes) => validarRegisto({ data: '2026-10-23', ...corpo }, hoje, new Set(), opcoes);
  assert.deepEqual(t({ tirarDia: 'greve', observacao: 'Greve geral' }), {
    minutos: -8 * H, manha: null, tarde: null, ajuste: 0, observacao: 'Greve geral', tipo: 'greve',
  });
  assert.equal(t({ tirarDia: 'folga' }).tipo, 'folga');
  assert.throws(() => t({ tirarDia: 'ferias' }), /folga ou de greve/);
  // Um dia tirado (−8h) não é confundido com um dia registado pela APJM: pode ser anulado na app
  const anular = t({ manha: { entrada: '09:30', saida: '14:00' }, tarde: { entrada: '15:00', saida: '18:30' } }, { minutosAtuais: -8 * H, diaTirado: 'folga' });
  assert.deepEqual([anular.minutos, anular.tipo], [0, '']);
  assert.throws(() => t({ tirarDia: 'folga' }, { ferias: true }), /férias/);
  assert.throws(() => validarRegisto({ data: '2026-10-24', tirarDia: 'folga' }, hoje, new Set()), /APJM/);

  // Na folha: o dia conta −8h, mesmo que tenha blocos, e aparece como dia tirado
  const dados = interpretar({
    funcionarios: [['id', 'nome', 'pin'], ['vera', 'Vera', '1']],
    registos: [
      ['data', 'funcionario', 'entrada_manha', 'saida_manha', 'entrada_tarde', 'saida_tarde', 'horas', 'tipo', 'observacao'],
      ['2026-10-23', 'vera', '09:30', '14:00', '15:00', '19:30', '', 'Greve', 'Greve geral'],
    ],
    feriados: [['data']],
  });
  assert.deepEqual(dados.registos.map((r) => [r.minutos, r.diaTirado, r.manha, r.observacao]), [[-8 * H, 'greve', null, 'Greve geral']]);
  const s = calcularSaldo({ saldoInicial: 0, registos: dados.registos, hoje: '2026-10-24' });
  assert.equal(s.saldoTotal, -8 * H);
  const dia = semanasEditaveis(s, dados.feriados, HORARIO_VERA)[0].dias[4];
  assert.deepEqual([dia.diaTirado, dia.apjm, dia.editavel, dia.observacao], ['greve', false, true, 'Greve geral']);
  // O editor mostra o horário habitual, para poder anular
  assert.deepEqual(dia.manha, { entrada: '09:30', saida: '14:00' });
  const h = historico(s, dados.feriados)[0];
  assert.deepEqual([h.diaTirado, h.trabalhados, h.apjm, h.observacao], ['greve', 0, false, 'Greve geral']);
});

test('semanas para registar: a anterior, a corrente e as duas seguintes', () => {
  const s = saldo([r('2026-10-20', 45)], '2026-10-21');
  const semanas = semanasEditaveis(s, new Set(), HORARIO_VERA);
  assert.deepEqual(semanas.map((x) => x.segunda), ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
  assert.equal(semanas[1].atual, true);
  assert.equal(semanas[1].dias[1].minutos, 45);
  // Sem registo, cada dia mostra o horário habitual (os dois blocos)
  const quarta = semanas[1].dias[2];
  assert.deepEqual([quarta.manha, quarta.tarde, quarta.ajuste, quarta.registado], [
    { entrada: '09:30', saida: '14:00' }, { entrada: '15:00', saida: '18:30' }, 0, false,
  ]);
});

test('histórico: os feriados aparecem sempre, como dias sem trabalho', () => {
  const s = saldo([r('2026-12-02', 30), r('2026-12-10', -30)], '2026-12-09');
  const feriados = new Map([['2026-12-01', 'Restauração da Independência'], ['2026-12-08', 'Imaculada Conceição'], ['2026-12-25', 'Natal']]);
  const h = historico(s, feriados);
  // 1/12 é antes do primeiro registo e 25/12 depois do último: não aparecem
  assert.deepEqual(h.map((x) => [x.data, x.feriado, x.nomeFeriado, x.trabalhados]), [
    ['2026-12-10', false, '', 450],
    ['2026-12-08', true, 'Imaculada Conceição', 0],
    ['2026-12-02', false, '', 510],
  ]);
});

test('semanas para registar: feriados com nome e não editáveis', () => {
  const s = saldo([], '2026-12-07');
  const dia = semanasEditaveis(s, new Map([['2026-12-08', 'Imaculada Conceição']]), HORARIO_VERA)[1].dias[1];
  assert.deepEqual([dia.data, dia.feriado, dia.nomeFeriado, dia.editavel], ['2026-12-08', true, 'Imaculada Conceição', false]);
});

test('histórico: sem fins de semana, e com os dias registados pela APJM assinalados', () => {
  const registos = [r('2026-10-17', 4 * H), r('2026-10-19', -8 * H), r('2026-10-20', 3 * H), r('2026-10-21', -30)];
  const s = saldo(registos, '2026-10-21');
  // terça, 20/10 é feriado; sábado, 17/10 não aparece
  const h = historico(s, new Set(['2026-10-20']));
  assert.deepEqual(h.map((x) => [x.data, x.estado, x.trabalhados, x.apjm]), [
    ['2026-10-21', 'hoje', 450, false],
    ['2026-10-20', 'confirmado', 180, true], // feriado: 3h trabalhadas
    ['2026-10-19', 'confirmado', 0, true],   // dia completo de ausência
  ]);
  // O sábado continua a contar para o saldo
  assert.equal(s.saldoTotal, 4 * H - 8 * H + 3 * H);
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
  assert.deepEqual(dados.funcionarios, [{
    id: 'mariana', nome: 'Mariana', pin: '1234', saldoInicial: 4200, diasFerias: null, ativo: true,
    horario: { manha: bloco(9 * H, 13 * H), tarde: bloco(14 * H, 18 * H) }, pausa: 60,
  }]);
  assert.deepEqual(dados.registos, [{
    data: '2026-10-21', funcionario: 'mariana', minutos: 90, manha: null, tarde: null, ajuste: 0,
    entrada: null, saida: null, ferias: false, diaTirado: null, nota: '', observacao: '',
  }]);
  assert.deepEqual([...dados.feriados], [['2026-12-08', 'Imaculada Conceição']]);
});

test('interpretar: o desvio vem dos blocos e do ajuste; sem blocos, da coluna horas', () => {
  const dados = interpretar({
    funcionarios: [
      ['id', 'nome', 'pin', 'saldo_inicial', 'entrada', 'saida', 'pausa', 'Entrada manhã', 'Saída manhã', 'Entrada tarde', 'Saída tarde'],
      ['vera', 'Vera', '1', 0, '9:30', '18:30', 1, '09:30', '14:00', '15:00', '18:30'],
      ['ana', 'Ana', '2', 0, '', '', '', '', '', '', ''],
      ['rui', 'Rui', '3', 0, '8:00', '17:30', 1.5, '', '', '', ''],
    ],
    registos: [
      ['data', 'funcionario', 'entrada', 'saida', 'horas', 'nota', 'entrada_manha', 'saida_manha', 'entrada_tarde', 'saida_tarde', 'ajuste', 'Observação'],
      ['2026-11-02', 'vera', '', '', '', '', '09:30', '14:00', '15:00', '19:00', '', ''],        // dia útil: +30min, pelos blocos
      ['2026-11-03', 'vera', '', '', 5, '', '09:30', '14:00', '15:00', '18:30', '-0,75', 'Saí mais cedo'], // os blocos e o ajuste mandam sobre a coluna horas
      ['2026-11-04', 'vera', '', '', -8, 'Dia completo', '', '', '', '', '', ''],                // ausência registada pela APJM
      ['2026-11-05', 'vera', '', '', '', '', '10:00', '14:00', '', '', '', ''],                  // só a manhã: −4h
      ['2026-11-06', 'vera', '09:30', '19:00', '', '', '', '', '', '', '', ''],                  // registo antigo: entrada, saída e 1h de pausa
      ['2026-11-07', 'vera', '', '', '', 'Sábado', '10:00', '14:00', '', '', '0,5', ''],         // fim de semana: horas trabalhadas
    ],
    feriados: [['data']],
  });
  assert.deepEqual(dados.registos.map((r) => r.minutos), [30, -45, -480, -240, 30, 270]);
  assert.deepEqual(dados.registos[1].observacao, 'Saí mais cedo');
  assert.deepEqual(dados.registos[1].ajuste, -45);
  assert.deepEqual(dados.registos[4].entrada, 9 * H + 30);
  // Sem blocos na folha: o horário por omissão, ou o horário antigo com a pausa às 13:00
  assert.deepEqual(dados.funcionarios[1].horario, { manha: bloco(9 * H, 13 * H), tarde: bloco(14 * H, 18 * H) });
  assert.deepEqual(dados.funcionarios[2].horario, { manha: bloco(8 * H, 13 * H), tarde: bloco(14 * H + 30, 17 * H + 30) });
});

test('preenchimento noturno: acrescenta os dias úteis sem registo, uma só vez', async () => {
  const env = { DEMO: '1' };
  // De 1 a 9 de novembro há 6 dias úteis × 2 pessoas; a Mariana já tem os dias 2 e 3 nos dados de exemplo.
  assert.equal(await preencherDias(env, '2026-11-10'), 10);
  assert.equal(await preencherDias(env, '2026-11-10'), 0);
  const { carregarDadosAtuais } = await import('../src/dados.js');
  const vera = (await carregarDadosAtuais(env)).registos.find((r) => r.funcionario === 'vera' && r.data === '2026-11-09');
  assert.deepEqual([vera.manha, vera.tarde, vera.minutos], [bloco(9 * H + 30, 14 * H), bloco(15 * H, 18 * H + 30), 0]);
});

test('férias: o dia não conta para o saldo, não se altera na app e aparece inativo', () => {
  const dados = interpretar({
    funcionarios: [['id', 'nome', 'pin', 'entrada', 'saida', 'pausa'], ['vera', 'Vera', '1', '9:30', '18:30', 1]],
    registos: [
      ['data', 'funcionario', 'entrada', 'saida', 'horas', 'nota', 'tipo'],
      ['2026-11-09', 'vera', '09:30', '19:30', '', '', ''],           // +1h
      ['2026-11-10', 'vera', '09:30', '20:30', 2, '', 'Férias'],     // férias: horário e horas ignorados
      ['2026-11-11', 'vera', '', '', '', 'Férias de verão', 'ferias'],
      ['2026-11-11', 'vera', '09:30', '20:00', '', '', ''],          // outra linha no mesmo dia (ex.: preenchimento noturno)
    ],
    feriados: [['data']],
  });
  assert.deepEqual(dados.registos.map((r) => [r.data, r.minutos, r.ferias]), [
    ['2026-11-09', 60, false], ['2026-11-10', 0, true], ['2026-11-11', 0, true], ['2026-11-11', 90, false],
  ]);

  const s = calcularSaldo({ saldoInicial: 0, registos: dados.registos, hoje: '2026-11-12' });
  assert.equal(s.saldoTotal, 60); // só o dia 9 conta

  const semana = semanasEditaveis(s, dados.feriados, HORARIO_VERA)[1].dias;
  assert.deepEqual(semana.slice(0, 3).map((d) => [d.data, d.ferias, d.editavel, d.minutos]), [
    ['2026-11-09', false, true, 60], ['2026-11-10', true, false, 0], ['2026-11-11', true, false, 0],
  ]);

  const h = historico(s, dados.feriados).find((x) => x.data === '2026-11-11');
  assert.deepEqual([h.ferias, h.trabalhados, h.entrada, h.manha, h.notas], [true, 0, null, null, ['Férias de verão']]);

  assert.throws(
    () => validarRegisto({ data: '2026-11-11', manha: { entrada: '09:30', saida: '14:00' }, tarde: { entrada: '15:00', saida: '18:30' } }, '2026-11-12', new Set(), { ferias: true }),
    /férias/,
  );
});

test('saldo de férias: dias do ano, usados e marcados', () => {
  const dados = interpretar({
    funcionarios: [['id', 'nome', 'dias_ferias'], ['vera', 'Vera', '22'], ['ana', 'Ana', '']],
    registos: [
      ['data', 'funcionario', 'tipo'],
      ['2025-12-30', 'vera', 'férias'], // ano anterior: não conta
      ['2026-08-03', 'vera', 'férias'],
      ['2026-08-04', 'vera', 'férias'],
      ['2026-08-08', 'vera', 'férias'], // sábado: não conta
      ['2026-12-08', 'vera', 'férias'], // feriado: não conta
      ['2026-12-23', 'vera', 'férias'],
      ['2026-12-24', 'vera', 'férias'],
    ],
    feriados: [['data', 'descricao'], ['2026-12-08', 'Imaculada Conceição']],
  });
  assert.equal(dados.funcionarios[0].diasFerias, 22);
  assert.equal(dados.funcionarios[1].diasFerias, null);
  const s = calcularSaldo({ saldoInicial: 0, registos: dados.registos, hoje: '2026-12-23' });
  assert.deepEqual(feriasDoAno(s, dados.feriados, 22), {
    ano: 2026, total: 22, usados: 2, marcados: ['2026-12-23', '2026-12-24'], disponiveis: 18,
  });
  assert.equal(feriasDoAno(s, dados.feriados, null).disponiveis, null);
});
