// Corre apps-script/Code.gs contra uma folha simulada, com a estrutura antiga (sem horários),
// para garantir que a atualização da folha real e a escrita dos horários funcionam.
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
  const contexto = vm.createContext({
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
    configurar: () => correr('configurar()'),
    post: (corpo) => {
      contexto.__corpo = JSON.stringify({ token: 'segredo', ...corpo });
      return correr('doPost({ postData: { contents: __corpo } })');
    },
    get: () => correr("doGet({ parameter: { token: 'segredo' } })"),
  };
}

// A folha tal como foi criada antes dos horários
const folhaAntiga = () => ({
  Funcionarios: folhaSimulada('Funcionarios', [
    ['id', 'nome', 'pin', 'saldo_inicial', 'ativo'],
    ['mariana', 'Mariana', '1111', 0, 'sim'],
    ['vera', 'Vera', '2222', 70, 'sim'],
  ]),
  Registos: folhaSimulada('Registos', [
    ['data', 'funcionario', 'horas', 'nota', 'atualizado_em'],
    ['2026-10-27', 'vera', -2, 'Consulta', ''],
  ]),
  Feriados: folhaSimulada('Feriados', [['data', 'descricao'], ['2026-12-08', 'Imaculada Conceição']]),
});

test('Apps Script: configurar acrescenta as colunas novas sem estragar a folha antiga', () => {
  const folhas = folhaAntiga();
  const script = carregarScript(folhas);
  script.configurar();
  script.configurar(); // pode correr-se outra vez sem efeitos

  assert.deepEqual(folhas.Funcionarios.dados[0], ['id', 'nome', 'pin', 'saldo_inicial', 'ativo', 'entrada', 'saida', 'pausa']);
  assert.deepEqual(folhas.Funcionarios.dados[1].slice(5), ['09:00', '18:00', 1]);
  assert.deepEqual(folhas.Funcionarios.dados[2].slice(5), ['09:30', '18:30', 1]);
  assert.deepEqual(folhas.Registos.dados[0], ['data', 'funcionario', 'horas', 'nota', 'atualizado_em', 'entrada', 'saida', 'tipo']);
  // Os dados existentes ficam intactos
  assert.deepEqual(folhas.Registos.dados[1].slice(0, 4), ['2026-10-27', 'vera', -2, 'Consulta']);
  assert.equal(folhas.Funcionarios.dados[2][3], 70);
  // Usa o separador de feriados existente, sem criar outro
  assert.deepEqual(Object.keys(folhas).sort(), ['Feriados', 'Funcionarios', 'Registos']);
});

test('Apps Script: registar e preencher escrevem os horários nas colunas certas', () => {
  const folhas = folhaAntiga();
  const script = carregarScript(folhas);
  // Sem correr configurar: registar acrescenta as colunas que faltam
  let r = script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-02', entrada: '09:30', saida: '19:00', horas: 0.5 });
  assert.equal(r.ok, true, r.erro);
  r = script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-02', entrada: '10:00', saida: '19:00', horas: 0 });
  assert.equal(r.ok, true, r.erro);
  r = script.post({
    acao: 'preencher',
    linhas: [
      { funcionario: 'vera', data: '2026-11-02', entrada: '09:30', saida: '18:30', horas: 0 }, // já existe
      { funcionario: 'vera', data: '2026-11-03', entrada: '09:30', saida: '18:30', horas: 0 },
    ],
  });
  assert.equal(r.ok, true, r.erro);

  const linhas = folhas.Registos.dados.filter((l) => l[0] === '2026-11-02' || l[0] === '2026-11-03');
  assert.equal(linhas.length, 2);
  const cab = folhas.Registos.dados[0];
  const linha = (data) => Object.fromEntries(cab.map((c, i) => [c, folhas.Registos.dados.find((l) => l[0] === data)[i]]));
  assert.deepEqual([linha('2026-11-02').entrada, linha('2026-11-02').saida, linha('2026-11-02').horas], ['10:00', '19:00', 0]);
  assert.deepEqual([linha('2026-11-03').entrada, linha('2026-11-03').saida], ['09:30', '18:30']);

  // Um dia marcado como férias na folha não se altera pela app
  const iTipo = folhas.Registos.dados[0].indexOf('tipo');
  folhas.Registos.dados.find((l) => l[0] === '2026-11-03')[iTipo] = 'Férias';
  const recusado = script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-03', entrada: '09:30', saida: '19:30', horas: 1 });
  assert.deepEqual([recusado.ok, /férias/.test(recusado.erro)], [false, true]);

  // Valores inválidos são recusados
  assert.equal(script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-04', entrada: '9h', saida: '18:30', horas: 0 }).ok, false);
  assert.equal(script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-04', entrada: '09:30', saida: '23:30', horas: 4 }).ok, false);

  // E o Worker lê o resultado como esperado
  const dados = interpretar(script.get().dados);
  assert.deepEqual([...dados.feriados], [['2026-12-08', 'Imaculada Conceição']]);
  const vera = dados.registos.filter((x) => x.funcionario === 'vera').map((x) => [x.data, x.minutos]);
  assert.deepEqual(vera, [['2026-10-27', -120], ['2026-11-02', 0], ['2026-11-03', 0]]);
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
  const r = script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-06', entrada: '09:30', saida: '20:00', horas: 1.5 });
  assert.equal(r.ok, true, r.erro);
  dados = interpretar(script.get().dados);
  assert.deepEqual(dados.registos.map((x) => [x.data, x.minutos]), [['2026-11-05', 60], ['2026-11-06', 90]]);
});
