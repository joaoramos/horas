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

function carregarScript(folhas) {
  const propriedades = { TOKEN: 'segredo' };
  const contexto = vm.createContext({
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: (n) => folhas[n] ?? null,
        insertSheet: (n) => (folhas[n] = folhaSimulada(n, [])),
      }),
    },
    Utilities: {
      formatDate: (d) => d.toISOString().slice(0, 10),
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
  Feriados: folhaSimulada('Feriados', [['data', 'descricao']]),
});

test('Apps Script: configurar acrescenta as colunas novas sem estragar a folha antiga', () => {
  const folhas = folhaAntiga();
  const script = carregarScript(folhas);
  script.configurar();
  script.configurar(); // pode correr-se outra vez sem efeitos

  assert.deepEqual(folhas.Funcionarios.dados[0], ['id', 'nome', 'pin', 'saldo_inicial', 'ativo', 'entrada', 'saida', 'pausa']);
  assert.deepEqual(folhas.Funcionarios.dados[1].slice(5), ['09:00', '18:00', 1]);
  assert.deepEqual(folhas.Funcionarios.dados[2].slice(5), ['09:30', '18:30', 1]);
  assert.deepEqual(folhas.Registos.dados[0], ['data', 'funcionario', 'horas', 'nota', 'atualizado_em', 'entrada', 'saida']);
  // Os dados existentes ficam intactos
  assert.deepEqual(folhas.Registos.dados[1].slice(0, 4), ['2026-10-27', 'vera', -2, 'Consulta']);
  assert.equal(folhas.Funcionarios.dados[2][3], 70);
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

  // Valores inválidos são recusados
  assert.equal(script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-04', entrada: '9h', saida: '18:30', horas: 0 }).ok, false);
  assert.equal(script.post({ acao: 'registar', funcionario: 'vera', data: '2026-11-04', entrada: '09:30', saida: '23:30', horas: 4 }).ok, false);

  // E o Worker lê o resultado como esperado
  const dados = interpretar(script.get().dados);
  const vera = dados.registos.filter((x) => x.funcionario === 'vera').map((x) => [x.data, x.minutos]);
  assert.deepEqual(vera, [['2026-10-27', -120], ['2026-11-02', 0], ['2026-11-03', 0]]);
});
