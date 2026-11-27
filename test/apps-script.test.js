// Corre apps-script/Code.gs contra uma folha simulada, com a estrutura antiga (sem os dois blocos),
// para garantir que a atualização da folha real e a escrita dos blocos funcionam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { interpretar } from '../src/dados.js';

function folhaSimulada(nome, linhas) {
  const dados = linhas.map((l) => [...l]);
  let maxColunas = 26;
  const ultimaLinha = () => {
    for (let i = dados.length - 1; i >= 0; i--) if (dados[i].some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  };
  const ultimaColuna = () => Math.max(0, ...dados.map((l) => {
    for (let j = l.length - 1; j >= 0; j--) if (l[j] !== '' && l[j] != null) return j + 1;
    return 0;
  }));
  const celula = (r, c) => dados[r - 1]?.[c - 1] ?? '';
  const escrever = (r, c, v) => {
    while (dados.length < r) dados.push([]);
    const l = dados[r - 1];
    while (l.length < c) l.push('');
    l[c - 1] = v;
  };
  const intervalo = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => celula(r + i, c + j))),
    getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => String(celula(r + i, c + j)))),
    setValue(v) { escrever(r, c, v); return this; },
    setValues(vs) { vs.forEach((l, i) => l.forEach((v, j) => escrever(r + i, c + j, v))); return this; },
    setNumberFormat() { return this; },
    setFontWeight() { return this; },
  });
  return {
    nome,
    dados,
    getDataRange: () => intervalo(1, 1, ultimaLinha(), ultimaColuna()),
    getRange: intervalo,
    getLastRow: ultimaLinha,
    getLastColumn: ultimaColuna,
    getMaxRows: () => 1000,
    getMaxColumns: () => maxColunas,
    insertColumnAfter: () => { maxColunas++; },
    appendRow: (l) => { dados.splice(ultimaLinha(), 0, [...l]); },
    deleteRow: (n) => { dados.splice(n - 1, 1); },
    setFrozenRows: () => {},
  };
}

function carregarScript(folhas, { fuso = 'Europe/Lisbon' } = {}) {
  const propriedades = { TOKEN: 'segredo' };
  const emails = [];
  const acionadores = [];
  const novoAcionador = (funcao) => {
    const a = { funcao, getHandlerFunction: () => funcao };
    const cadeia = {
      timeBased: () => cadeia,
      onWeekDay: (d) => { a.dia = d; return cadeia; },
      atHour: (h) => { a.hora = h; return cadeia; },
      nearMinute: (m) => { a.minuto = m; return cadeia; },
      inTimezone: (tz) => { a.fuso = tz; return cadeia; },
      create: () => { acionadores.push(a); return a; },
    };
    return cadeia;
  };
  const contexto = vm.createContext({
    MailApp: { sendEmail: (m) => emails.push(m) },
    ScriptApp: {
      WeekDay: { SATURDAY: 'SATURDAY' },
      newTrigger: novoAcionador,
      getProjectTriggers: () => [...acionadores],
      deleteTrigger: (a) => acionadores.splice(acionadores.indexOf(a), 1),
    },
    // O mesmo Date do teste, para que `instanceof Date` funcione dentro do script
    Date,
    SpreadsheetApp: {
      getActive: () => ({
        getSpreadsheetTimeZone: () => fuso,
        getSheetByName: (n) => folhas[n] ?? null,
        insertSheet: (n) => (folhas[n] = folhaSimulada(n, [])),
      }),
    },
    Utilities: {
      // Como no Apps Script: a data vista no fuso horário indicado
      formatDate: (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
      getUuid: () => 'novo-token',
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => propriedades[k] ?? null, setProperty: (k, v) => { propriedades[k] = v; } }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (texto) => ({ setMimeType: () => JSON.parse(texto) }),
    },
    Logger: { log() {} },
  });
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), contexto);
  const correr = (codigo) => vm.runInContext(codigo, contexto);
  return {
    emails,
    acionadores,
    correr,
    configurar: () => correr('configurar()'),
    post: (corpo) => {
      contexto.__corpo = JSON.stringify({ token: 'segredo', ...corpo });
      return correr('doPost({ postData: { contents: __corpo } })');
    },
    get: () => correr("doGet({ parameter: { token: 'segredo' } })"),
  };
}

// A folha tal como estava antes dos dois blocos: uma entrada, uma saída e a pausa
const folhaAntiga = () => ({
  Funcionarios: folhaSimulada('Funcionarios', [
    ['id', 'nome', 'pin', 'saldo_inicial', 'ativo', 'entrada', 'saida', 'pausa', 'dias_ferias'],
    ['mariana', 'Mariana', '1111', 0, 'sim', '09:00', '18:00', 1, 22],
    ['vera', 'Vera', '2222', 70, 'sim', '09:30', '18:30', 1, 22],
  ]),
  Registos: folhaSimulada('Registos', [
    ['data', 'funcionario', 'entrada', 'saida', 'horas', 'nota', 'atualizado_em', 'tipo'],
    ['2026-10-27', 'vera', '', '', -2, 'Consulta', '', ''],
    ['2026-10-28', 'vera', '09:30', '19:30', 1, '', '', ''],
  ]),
  Feriados: folhaSimulada('Feriados', [['data', 'descricao'], ['2026-12-08', 'Imaculada Conceição']]),
});

const BLOCOS_VERA = { entrada_manha: '09:30', saida_manha: '14:00', entrada_tarde: '15:00', saida_tarde: '18:30' };

test('Apps Script: configurar acrescenta as colunas novas sem estragar a folha antiga', () => {
  const folhas = folhaAntiga();
  const script = carregarScript(folhas);
  script.configurar();
  script.configurar(); // pode correr-se outra vez sem efeitos

  assert.deepEqual(folhas.Funcionarios.dados[0], [
    'id', 'nome', 'pin', 'saldo_inicial', 'ativo', 'entrada', 'saida', 'pausa', 'dias_ferias',
    'entrada_manha', 'saida_manha', 'entrada_tarde', 'saida_tarde',
  ]);
  // O horário habitual passa a ter dois blocos
  assert.deepEqual(folhas.Funcionarios.dados[1].slice(9), ['10:00', '14:00', '15:00', '19:00']);
  assert.deepEqual(folhas.Funcionarios.dados[2].slice(9), ['09:30', '14:00', '15:00', '18:30']);
  assert.deepEqual(folhas.Registos.dados[0], [
    'data', 'funcionario', 'entrada', 'saida', 'horas', 'nota', 'atualizado_em', 'tipo',
    'entrada_manha', 'saida_manha', 'entrada_tarde', 'saida_tarde', 'ajuste', 'observacao',
  ]);
  // Os dados existentes ficam intactos
  assert.deepEqual(folhas.Registos.dados[1].slice(0, 6), ['2026-10-27', 'vera', '', '', -2, 'Consulta']);
  assert.equal(folhas.Funcionarios.dados[2][3], 70);
  // Usa o separador de feriados existente, sem criar outro; só acrescenta o da configuração
  assert.deepEqual(Object.keys(folhas).sort(), ['Configuracao', 'Feriados', 'Funcionarios', 'Registos']);

  // Um bloco já preenchido à mão não é substituído
  folhas.Funcionarios.dados[1][9] = '09:00';
  script.configurar();
  assert.deepEqual(folhas.Funcionarios.dados[1].slice(9), ['09:00', '14:00', '15:00', '19:00']);

  // Os registos antigos continuam a ser lidos pelo Worker
  const dados = interpretar(script.get().dados);
  assert.deepEqual(dados.registos.map((x) => [x.data, x.minutos]), [['2026-10-27', -120], ['2026-10-28', 60]]);
});

test('Apps Script: registar e preencher escrevem os blocos nas colunas certas', () => {
  const folhas = folhaAntiga();
  const script = carregarScript(folhas);
  // Sem correr configurar: registar acrescenta as colunas que faltam
  let r = script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-02', ...BLOCOS_VERA, saida_tarde: '19:00', ajuste: 0, horas: 0.5, tipo: '', observacao: '' });
  assert.equal(r.ok, true, r.erro);
  r = script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-02', ...BLOCOS_VERA, entrada_manha: '10:00', ajuste: 0.25, horas: -0.25, tipo: '', observacao: 'Reunião depois do fecho' });
  assert.equal(r.ok, true, r.erro);
  r = script.post({
    acao: 'preencher',
    linhas: [
      { funcionario: 'vera', data: '2026-11-02', ...BLOCOS_VERA, ajuste: 0, horas: 0, tipo: '' }, // já existe
      { funcionario: 'vera', data: '2026-11-03', ...BLOCOS_VERA, ajuste: 0, horas: 0, tipo: '' },
    ],
  });
  assert.equal(r.ok, true, r.erro);

  const cab = folhas.Registos.dados[0];
  const linha = (data) => Object.fromEntries(cab.map((c, i) => [c, folhas.Registos.dados.find((l) => l[0] === data)[i]]));
  assert.equal(folhas.Registos.dados.filter((l) => l[0] === '2026-11-02' || l[0] === '2026-11-03').length, 2);
  const dia2 = linha('2026-11-02');
  assert.deepEqual(
    [dia2.entrada_manha, dia2.saida_manha, dia2.entrada_tarde, dia2.saida_tarde, dia2.ajuste, dia2.horas, dia2.observacao],
    ['10:00', '14:00', '15:00', '18:30', 0.25, -0.25, 'Reunião depois do fecho'],
  );
  assert.deepEqual([linha('2026-11-03').entrada_manha, linha('2026-11-03').saida_tarde], ['09:30', '18:30']);

  // Tirar o dia: os blocos ficam vazios, o tipo fica "greve" e a nota da APJM mantém-se
  folhas.Registos.dados.find((l) => l[0] === '2026-11-03')[cab.indexOf('nota')] = 'Nota da APJM';
  r = script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-03', ajuste: 0, horas: -8, tipo: 'greve', observacao: 'Greve geral' });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(
    [linha('2026-11-03').entrada_manha, linha('2026-11-03').horas, linha('2026-11-03').tipo, linha('2026-11-03').nota, linha('2026-11-03').observacao],
    ['', -8, 'greve', 'Nota da APJM', 'Greve geral'],
  );
  // Anular: volta ao horário e o tipo fica vazio
  r = script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-03', ...BLOCOS_VERA, ajuste: 0, horas: 0, tipo: '', observacao: '' });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual([linha('2026-11-03').entrada_manha, linha('2026-11-03').tipo], ['09:30', '']);

  // Um registo antigo alterado na app perde a entrada e a saída antigas
  r = script.post({ acao: 'registar', funcionario: 'vera', data: '2026-10-28', ...BLOCOS_VERA, ajuste: 0, horas: 0, tipo: '' });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual([linha('2026-10-28').entrada, linha('2026-10-28').saida, linha('2026-10-28').entrada_manha], ['', '', '09:30']);

  // Um dia marcado como férias na folha não se altera pela app
  folhas.Registos.dados.find((l) => l[0] === '2026-11-03')[cab.indexOf('tipo')] = 'Férias';
  const recusado = script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-03', ...BLOCOS_VERA, horas: 0, tipo: '' });
  assert.deepEqual([recusado.ok, /férias/.test(recusado.erro)], [false, true]);

  // Valores inválidos são recusados
  const invalido = (extra) => script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-04', ...BLOCOS_VERA, horas: 0, tipo: '', ...extra }).ok;
  assert.equal(invalido({ entrada_manha: '9h' }), false);
  assert.equal(invalido({ horas: 9 }), false);
  assert.equal(invalido({ ajuste: 7.5 }), false);
  assert.equal(invalido({ tipo: 'férias' }), false);
  assert.equal(invalido({ observacao: 'x'.repeat(301) }), false);
  assert.equal(invalido({ ajuste: 7, horas: 7 }), true);

  // E o Worker lê o resultado como esperado
  const dados = interpretar(script.get().dados);
  assert.deepEqual([...dados.feriados], [['2026-12-08', 'Imaculada Conceição']]);
  const vera = dados.registos.filter((x) => x.funcionario === 'vera').map((x) => [x.data, x.minutos]);
  assert.deepEqual(vera, [['2026-10-27', -120], ['2026-10-28', 0], ['2026-11-02', -15], ['2026-11-03', 0], ['2026-11-04', 7 * 60]]);
  assert.equal(dados.registos.find((x) => x.data === '2026-11-03').ferias, true);
});

test('Apps Script: datas guardadas como datas numa folha com outro fuso horário', () => {
  // Numa folha em Madrid, uma célula de data guarda a meia-noite de Madrid (23:00 do dia anterior em Lisboa)
  const meiaNoiteEmMadrid = (data) => new Date(`${data}T00:00:00+01:00`);
  const folhas = {
    Funcionarios: folhaSimulada('Funcionarios', [
      ['id', 'nome', 'pin', 'saldo_inicial', 'ativo', 'entrada', 'saida', 'pausa'],
      ['vera', 'Vera', '2222', 0, 'sim', '09:30', '18:30', 1],
    ]),
    Registos: folhaSimulada('Registos', [
      ['data', 'funcionario', 'entrada', 'saida', 'horas', 'nota', 'atualizado_em'],
      [meiaNoiteEmMadrid('2026-11-05'), 'vera', '09:30', '19:30', 1, '', ''],
      [meiaNoiteEmMadrid('2026-11-06'), 'vera', '09:30', '18:30', 0, '', ''],
    ]),
    Feriados: folhaSimulada('Feriados', [['data', 'descricao'], [meiaNoiteEmMadrid('2026-12-08'), 'Imaculada Conceição']]),
  };
  const script = carregarScript(folhas, { fuso: 'Europe/Madrid' });

  // Leitura: cada linha fica no seu dia
  let dados = interpretar(script.get().dados);
  assert.deepEqual(dados.registos.map((r) => [r.data, r.minutos]), [['2026-11-05', 60], ['2026-11-06', 0]]);
  assert.deepEqual([...dados.feriados.keys()], ['2026-12-08']);

  // Escrita: alterar o dia 6 atualiza a linha do dia 6, e não a do dia 5
  const r = script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-06', ...BLOCOS_VERA, saida_tarde: '20:00', horas: 1.5, tipo: '' });
  assert.equal(r.ok, true, r.erro);
  dados = interpretar(script.get().dados);
  assert.deepEqual(dados.registos.map((x) => [x.data, x.minutos]), [['2026-11-05', 60], ['2026-11-06', 90]]);
});

test('Apps Script: resumo semanal por email, com os dias de mais de 2h em destaque', () => {
  const folhas = {
    Funcionarios: folhaSimulada('Funcionarios', [
      ['id', 'nome', 'pin', 'saldo_inicial', 'ativo', 'entrada', 'saida', 'pausa', 'dias_ferias', 'entrada_manha', 'saida_manha', 'entrada_tarde', 'saida_tarde'],
      ['mariana', 'Mariana', '1111', 0, '', '10:00', '19:00', '1,00', 22, '10:00', '14:00', '15:00', '19:00'],
      ['vera', 'Vera', '2222', 0, 'sim', '09:30', '18:30', '1,00', 22, '09:30', '14:00', '15:00', '18:30'],
      ['rui', 'Rui', '3333', 0, 'não', '', '', '', '', '', '', '', ''],
    ]),
    Registos: folhaSimulada('Registos', [
      ['data', 'funcionario', 'horas', 'nota', 'atualizado_em', 'entrada', 'saida', 'tipo', 'entrada_manha', 'saida_manha', 'entrada_tarde', 'saida_tarde', 'ajuste', 'observacao'],
      // Semana de 23 a 29 de novembro de 2026
      ['23/11/2026', 'mariana', '0', '', '', '10:00', '19:00'], // registo antigo: 9h − 1h de pausa = 8h
      ['2026-11-24', 'mariana', 2.25, '', '', '', '', '', '10:00', '14:00', '15:00', '21:00', 0.25, 'Reunião de pais <depois>'],
      ['2026-11-25', 'mariana', -2, '', '', '', '', '', '10:00', '14:00', '15:00', '17:00', '', ''],
      ['2026-11-26', 'mariana', -8, '', '', '', '', 'folga', '', '', '', '', '', 'Greve'],
      ['2026-11-23', 'vera', 0, '', '', '', '', '', '09:30', '14:00', '15:00', '18:30', '', ''],
      ['2026-11-24', 'vera', 0, '', '', '', '', 'Férias', '', '', '', '', '', ''],
      ['2026-11-28', 'vera', 8, 'Sábado: feira', '', '', '', '', '', '', '', '', '', ''],
      ['2026-11-30', 'vera', 5, '', '', '', '', '', '08:00', '14:00', '15:00', '22:00', '', ''], // semana seguinte
    ]),
    Feriados: folhaSimulada('Feriados', [['data', 'descricao'], ['2026-11-27', 'Feriado de teste']]),
  };
  const script = carregarScript(folhas);

  // Sem destinatário, não envia e explica onde o pôr
  assert.throws(() => script.correr("enviarResumoDaSemana('2026-11-28')"), /email_resumo/);
  script.configurar();
  assert.deepEqual(folhas.Configuracao.dados[1].slice(0, 2), ['email_resumo', '']);
  folhas.Configuracao.dados[1][1] = 'executivo@exemplo.pt; outra@exemplo.pt';

  // (JSON: os objetos vêm de outro contexto do vm)
  const resumo = JSON.parse(JSON.stringify(script.correr("enviarResumoDaSemana('2026-11-28')")));
  assert.equal(script.emails.length, 1);
  const email = script.emails[0];
  assert.equal(email.to, 'executivo@exemplo.pt,outra@exemplo.pt');
  assert.equal(email.subject, 'Horas: resumo da semana de 23 a 27 de novembro (3 dias em destaque)');

  // Só as pessoas ativas
  assert.deepEqual(resumo.pessoas.map((p) => p.nome), ['Mariana', 'Vera']);
  const [mariana, vera] = resumo.pessoas;
  assert.deepEqual(mariana.linhas.map((l) => [l.data, l.minutos, l.trabalho, l.destaque]), [
    ['2026-11-23', 0, 480, false],
    ['2026-11-24', 135, 615, true], // 4h + 6h + 15min de ajuste
    ['2026-11-25', -120, 360, false], // exatamente 2h: não é "mais de 2h"
    ['2026-11-26', -480, 0, true], // dia tirado
    ['2026-11-27', 0, 0, false], // feriado
  ]);
  assert.equal(mariana.desvio, 135 - 120 - 480);
  assert.deepEqual(vera.linhas.map((l) => [l.data, l.estado, l.minutos, l.destaque]), [
    ['2026-11-23', '', 0, false],
    ['2026-11-24', 'Férias', 0, false],
    ['2026-11-25', 'Sem registo', null, false],
    ['2026-11-26', 'Sem registo', null, false],
    ['2026-11-27', 'Feriado: Feriado de teste', 0, false],
    ['2026-11-28', 'Trabalho extra', 480, true], // fim de semana registado pela APJM
  ]);
  assert.deepEqual(resumo.destaques.map((d) => [d.nome, d.dia.data]), [['Mariana', '2026-11-24'], ['Mariana', '2026-11-26'], ['Vera', '2026-11-28']]);

  // O texto escapa o HTML e mostra os destaques
  assert.match(email.htmlBody, /Reunião de pais &lt;depois&gt;/);
  assert.match(email.htmlBody, /−8h/);
  assert.match(email.body, /Mariana, qui 26\/11: −8h \(dia tirado\) — Greve/);
  assert.match(email.body, /Mariana, ter 24\/11: \+2h15 \(10:00–14:00 e 15:00–21:00, ajuste \+15min\)/);

  // Semana sem destaques
  folhas.Configuracao.dados[1][1] = 'executivo@exemplo.pt';
  const outra = script.correr("enviarResumoDaSemana('2026-12-30')");
  assert.equal(outra.destaques.length, 0);
  assert.equal(script.emails[1].subject, 'Horas: resumo da semana de 28 de dezembro de 2026 a 1 de janeiro de 2027');
  assert.match(script.emails[1].body, /Nenhum dia com mais de 2h/);

  // Acionador: sábados às 18:00 em Lisboa, sem duplicar
  script.correr('criarAcionadorSemanal()');
  script.correr('criarAcionadorSemanal()');
  assert.deepEqual(script.acionadores.map((a) => [a.funcao, a.dia, a.hora, a.minuto, a.fuso]), [['enviarResumoSemanal', 'SATURDAY', 18, 0, 'Europe/Lisbon']]);
  script.correr('removerAcionadorSemanal()');
  assert.equal(script.acionadores.length, 0);
});
