/**
 * Horas — Jardim da Mata
 *
 * Liga a web app (Cloudflare Worker) à folha Google Sheets.
 * Colar este ficheiro em Extensões › Apps Script, a partir da própria folha.
 * Ver README.md para os passos completos.
 */

const FOLHAS = {
  funcionarios: 'Funcionarios',
  registos: 'Registos',
  feriados: 'Feriados', // tem de ser igual ao nome do separador na folha
};

// Colunas de cada separador, com o formato de cada uma ('@' = texto simples)
const COLUNAS = {
  funcionarios: [
    ['id', '@'], ['nome', '@'], ['pin', '@'], ['saldo_inicial', '0.00'], ['ativo', '@'], ['dias_ferias', '0.##'],
    ['entrada_manha', '@'], ['saida_manha', '@'], ['entrada_tarde', '@'], ['saida_tarde', '@'],
  ],
  registos: [
    ['data', '@'], ['funcionario', '@'], ['horas', '0.00'], ['nota', '@'], ['atualizado_em', 'yyyy-mm-dd hh:mm'], ['tipo', '@'],
    ['entrada_manha', '@'], ['saida_manha', '@'], ['entrada_tarde', '@'], ['saida_tarde', '@'], ['ajuste', '0.00'], ['observacao', '@'],
  ],
  feriados: [['data', '@'], ['descricao', '@']],
};

// Horário habitual das pessoas iniciais: bloco da manhã e bloco da tarde (o resto preenche-se na folha)
const HORARIOS_INICIAIS = { mariana: ['10:00', '14:00', '15:00', '19:00'], vera: ['09:30', '14:00', '15:00', '18:30'] };
const BLOCOS = ['entrada_manha', 'saida_manha', 'entrada_tarde', 'saida_tarde'];
// Máximos aceites ao gravar (a app valida as regras; aqui só se evitam valores absurdos)
const MAX_HORAS_POR_DIA = 8; // "Tirar o dia" grava −8
const MAX_AJUSTE = 7;
const MAX_OBSERVACAO = 300;
// Valores da coluna "tipo" que a app pode escrever (férias só se marcam na folha)
const TIPOS_DA_APP = ['', 'folga', 'greve'];
// Dias de férias por ano quando a folha ainda não os indica (o mínimo legal; ajustar na folha)
const DIAS_FERIAS_POR_OMISSAO = 22;

/**
 * Correr à mão: cria os separadores e o token, ou atualiza uma folha antiga.
 * Pode correr-se várias vezes: só acrescenta o que falta e não apaga nada.
 */
function configurar() {
  const ss = SpreadsheetApp.getActive();

  criarFolha(ss, FOLHAS.funcionarios, COLUNAS.funcionarios, [
    ['mariana', 'Mariana', '0000', 70, 'sim', 22, '10:00', '14:00', '15:00', '19:00'],
    ['vera', 'Vera', '0000', 0, 'sim', 22, '09:30', '14:00', '15:00', '18:30'],
  ]);
  criarFolha(ss, FOLHAS.registos, COLUNAS.registos, []);
  criarFolha(ss, FOLHAS.feriados, COLUNAS.feriados, [
    ['2026-12-01', 'Restauração da Independência'],
    ['2026-12-08', 'Imaculada Conceição'],
    ['2026-12-25', 'Natal'],
  ]);

  // Folhas antigas: acrescentar as colunas novas e o horário habitual (dois blocos)
  garantirColunas(ss.getSheetByName(FOLHAS.funcionarios), COLUNAS.funcionarios);
  garantirColunas(ss.getSheetByName(FOLHAS.registos), COLUNAS.registos);
  preencherHorariosIniciais(ss.getSheetByName(FOLHAS.funcionarios));

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid());
  Logger.log('TOKEN (usar como APPS_SCRIPT_TOKEN no Cloudflare): ' + props.getProperty('TOKEN'));
}

function criarFolha(ss, nome, colunas, linhas) {
  if (ss.getSheetByName(nome)) return;
  const folha = ss.insertSheet(nome);
  colunas.forEach(([, formato], i) => folha.getRange(1, i + 1, folha.getMaxRows(), 1).setNumberFormat(formato));
  folha.getRange(1, 1, 1, colunas.length).setValues([colunas.map(([c]) => c)]).setFontWeight('bold');
  if (linhas.length) folha.getRange(2, 1, linhas.length, colunas.length).setValues(linhas);
  folha.setFrozenRows(1);
}

/** Acrescenta no fim as colunas que faltam. Devolve o cabeçalho normalizado. */
function garantirColunas(folha, colunas) {
  const ultima = Math.max(folha.getLastColumn(), 1);
  const cab = folha.getRange(1, 1, 1, ultima).getValues()[0].map(normalizarCabecalho);
  let proxima = folha.getLastColumn() + 1;
  colunas.forEach(([nome, formato]) => {
    if (cab.indexOf(nome) >= 0) return;
    const n = proxima++;
    if (n > folha.getMaxColumns()) folha.insertColumnAfter(folha.getMaxColumns());
    folha.getRange(1, n, folha.getMaxRows(), 1).setNumberFormat(formato);
    folha.getRange(1, n).setValue(nome).setFontWeight('bold');
    cab[n - 1] = nome;
  });
  return cab;
}

function preencherHorariosIniciais(folha) {
  const valores = folha.getDataRange().getValues();
  const cab = valores[0].map(normalizarCabecalho);
  const iId = cab.indexOf('id');
  const iFerias = cab.indexOf('dias_ferias');
  const iBlocos = BLOCOS.map((c) => cab.indexOf(c));
  for (let i = 1; i < valores.length; i++) {
    if (valores[i][iId] !== '' && valores[i][iFerias] === '') folha.getRange(i + 1, iFerias + 1).setValue(DIAS_FERIAS_POR_OMISSAO);
    const horario = HORARIOS_INICIAIS[String(valores[i][iId]).trim().toLowerCase()];
    if (!horario) continue;
    // Só se a pessoa ainda não tiver nenhum bloco preenchido
    if (iBlocos.some((j) => valores[i][j] !== '')) continue;
    iBlocos.forEach((j, k) => folha.getRange(i + 1, j + 1).setValue(horario[k]));
  }
}

function doGet(e) {
  return responder(() => {
    verificarToken(e.parameter.token);
    return lerTudo();
  });
}

function doPost(e) {
  return responder(() => {
    const pedido = JSON.parse(e.postData.contents);
    verificarToken(pedido.token);
    if (pedido.acao === 'registar') {
      registar(pedido);
      return lerTudo();
    }
    if (pedido.acao === 'preencher') {
      preencher(pedido.linhas || []);
      return lerTudo();
    }
    throw new Error('Ação desconhecida: ' + pedido.acao);
  });
}

function responder(fn) {
  let corpo;
  try {
    corpo = { ok: true, dados: fn() };
  } catch (erro) {
    corpo = { ok: false, erro: String((erro && erro.message) || erro) };
  }
  return ContentService.createTextOutput(JSON.stringify(corpo)).setMimeType(ContentService.MimeType.JSON);
}

function verificarToken(token) {
  const esperado = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!esperado || token !== esperado) throw new Error('Token inválido');
}

function lerTudo() {
  return {
    funcionarios: lerFolha(FOLHAS.funcionarios),
    registos: lerFolha(FOLHAS.registos),
    feriados: lerFolha(FOLHAS.feriados),
  };
}

function lerFolha(nome) {
  const folha = SpreadsheetApp.getActive().getSheetByName(nome);
  if (!folha) return [];
  const intervalo = folha.getDataRange();
  const textos = intervalo.getDisplayValues();
  return intervalo.getValues().map((linha, i) =>
    linha.map((v, j) => {
      if (!(v instanceof Date)) return v;
      // Horas escritas como hora (ex.: 9:30) chegam como datas de 1899: usar o texto mostrado
      if (v.getFullYear() < 1900) return textos[i][j];
      return textoDeData(v);
    })
  );
}

/**
 * Uma célula de data guarda a meia-noite no fuso horário da folha (Ficheiro › Definições).
 * Para não mudar de dia, as datas são sempre lidas nesse fuso, e não num fuso fixo.
 */
function textoDeData(d) {
  return Utilities.formatDate(d, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

function normalizarCabecalho(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function textoDaData(v) {
  return v instanceof Date ? textoDeData(v) : String(v).trim();
}

/** Valida uma linha vinda do Worker e devolve as horas (desvio do dia) e o ajuste. */
function validarLinha(p, maximo) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data)) throw new Error('Data inválida');
  BLOCOS.forEach((c) => {
    const v = p[c] === undefined ? '' : String(p[c]);
    if (v !== '' && !/^\d{2}:\d{2}$/.test(v)) throw new Error('Horário inválido');
  });
  const horas = Number(p.horas);
  if (!isFinite(horas) || Math.abs(horas) > maximo) throw new Error('Horas inválidas');
  const ajuste = Number(p.ajuste || 0);
  if (!isFinite(ajuste) || Math.abs(ajuste) > MAX_AJUSTE) throw new Error('Ajuste inválido');
  if (TIPOS_DA_APP.indexOf(p.tipo || '') < 0) throw new Error('Tipo inválido');
  if (p.observacao !== undefined && String(p.observacao).length > MAX_OBSERVACAO) throw new Error('Observação demasiado longa');
  return { horas, ajuste };
}

/** Abre o separador de registos (com as colunas necessárias) e devolve as posições de cada coluna. */
function abrirRegistos() {
  const folha = SpreadsheetApp.getActive().getSheetByName(FOLHAS.registos);
  const cab = garantirColunas(folha, COLUNAS.registos);
  const col = {};
  cab.forEach((c, i) => { if (c) col[c] = i; });
  return { folha, col, largura: cab.length };
}

function chaveDaLinha(linha, col) {
  return String(linha[col.funcionario]).trim().toLowerCase() + ' ' + textoDaData(linha[col.data]);
}

/** Valores a escrever em cada coluna, para uma linha vinda do Worker. */
function valoresDaLinha(p, valido) {
  const v = { horas: valido.horas, ajuste: valido.ajuste || '', tipo: p.tipo || '', atualizado_em: new Date() };
  BLOCOS.forEach((c) => { v[c] = p[c] || ''; });
  if (p.observacao !== undefined) v.observacao = p.observacao;
  return v;
}

function novaLinha(p, col, largura, valido) {
  const nova = new Array(largura).fill('');
  nova[col.data] = p.data;
  nova[col.funcionario] = p.funcionario;
  const v = valoresDaLinha(p, valido);
  Object.keys(v).forEach((c) => { nova[col[c]] = v[c]; });
  return nova;
}

/**
 * Grava um dia de uma pessoa (blocos da manhã e da tarde, ajuste, observação, desvio e tipo):
 * atualiza a linha desse dia ou cria uma.
 */
function registar(p) {
  const valido = validarLinha(p, MAX_HORAS_POR_DIA);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const { folha, col, largura } = abrirRegistos();
    const valores = folha.getDataRange().getValues();
    const chave = p.funcionario + ' ' + p.data;
    for (let i = 1; i < valores.length; i++) {
      if (chaveDaLinha(valores[i], col) !== chave) continue;
      if (normalizarCabecalho(valores[i][col.tipo]) === 'ferias') throw new Error('Dia de férias: só pode ser alterado na folha');
      // Mantém a nota da APJM e as outras colunas da linha
      const n = i + 1;
      const v = valoresDaLinha(p, valido);
      Object.keys(v).forEach((c) => folha.getRange(n, col[c] + 1).setValue(v[c]));
      // Colunas antigas (uma só entrada e saída): ficam vazias para não se confundirem com os blocos
      ['entrada', 'saida'].forEach((c) => { if (col[c] !== undefined) folha.getRange(n, col[c] + 1).setValue(''); });
      return;
    }
    folha.appendRow(novaLinha(p, col, largura, valido));
  } finally {
    lock.releaseLock();
  }
}

/** Preenchimento noturno: acrescenta os dias que ainda não têm linha (ignora os que já têm). */
function preencher(linhas) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const { folha, col, largura } = abrirRegistos();
    const existentes = {};
    folha.getDataRange().getValues().slice(1).forEach((l) => { existentes[chaveDaLinha(l, col)] = true; });
    const novas = linhas
      .filter((p) => !existentes[p.funcionario + ' ' + p.data])
      .map((p) => novaLinha(p, col, largura, validarLinha(p, 24)));
    if (novas.length) folha.getRange(folha.getLastRow() + 1, 1, novas.length, largura).setValues(novas);
  } finally {
    lock.releaseLock();
  }
}
