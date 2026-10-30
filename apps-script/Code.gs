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
  feriados: 'Feriados',
};
const FUSO = 'Europe/Lisbon';

// Colunas de cada separador, com o formato de cada uma ('@' = texto simples)
const COLUNAS = {
  funcionarios: [['id', '@'], ['nome', '@'], ['pin', '@'], ['saldo_inicial', '0.00'], ['ativo', '@'], ['entrada', '@'], ['saida', '@'], ['pausa', '0.00']],
  registos: [['data', '@'], ['funcionario', '@'], ['entrada', '@'], ['saida', '@'], ['horas', '0.00'], ['nota', '@'], ['atualizado_em', 'yyyy-mm-dd hh:mm']],
  feriados: [['data', '@'], ['descricao', '@']],
};

// Horário habitual das pessoas iniciais (o resto preenche-se na folha)
const HORARIOS_INICIAIS = { mariana: ['09:00', '18:00', 1], vera: ['09:30', '18:30', 1] };

/**
 * Correr à mão: cria os separadores e o token, ou atualiza uma folha antiga.
 * Pode correr-se várias vezes: só acrescenta o que falta e não apaga nada.
 */
function configurar() {
  const ss = SpreadsheetApp.getActive();

  criarFolha(ss, FOLHAS.funcionarios, COLUNAS.funcionarios, [
    ['mariana', 'Mariana', '0000', 70, 'sim', '09:00', '18:00', 1],
    ['vera', 'Vera', '0000', 0, 'sim', '09:30', '18:30', 1],
  ]);
  criarFolha(ss, FOLHAS.registos, COLUNAS.registos, []);
  criarFolha(ss, FOLHAS.feriados, COLUNAS.feriados, [
    ['2026-12-01', 'Restauração da Independência'],
    ['2026-12-08', 'Imaculada Conceição'],
    ['2026-12-25', 'Natal'],
  ]);

  // Folhas criadas antes dos horários: acrescentar as colunas novas e o horário habitual
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
  const [iId, iEntrada, iSaida, iPausa] = ['id', 'entrada', 'saida', 'pausa'].map((c) => cab.indexOf(c));
  for (let i = 1; i < valores.length; i++) {
    const horario = HORARIOS_INICIAIS[String(valores[i][iId]).trim().toLowerCase()];
    if (!horario) continue;
    if (valores[i][iEntrada] === '') folha.getRange(i + 1, iEntrada + 1).setValue(horario[0]);
    if (valores[i][iSaida] === '') folha.getRange(i + 1, iSaida + 1).setValue(horario[1]);
    if (valores[i][iPausa] === '') folha.getRange(i + 1, iPausa + 1).setValue(horario[2]);
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
      return Utilities.formatDate(v, FUSO, 'yyyy-MM-dd');
    })
  );
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
  return v instanceof Date ? Utilities.formatDate(v, FUSO, 'yyyy-MM-dd') : String(v).trim();
}

function validarLinha(p, maximo) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data)) throw new Error('Data inválida');
  if (!/^\d{2}:\d{2}$/.test(p.entrada) || !/^\d{2}:\d{2}$/.test(p.saida)) throw new Error('Horário inválido');
  const horas = Number(p.horas);
  if (!isFinite(horas) || Math.abs(horas) > maximo) throw new Error('Horas inválidas');
  return horas;
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

function novaLinha(p, col, largura, horas) {
  const nova = new Array(largura).fill('');
  nova[col.data] = p.data;
  nova[col.funcionario] = p.funcionario;
  nova[col.entrada] = p.entrada;
  nova[col.saida] = p.saida;
  nova[col.horas] = horas;
  nova[col.atualizado_em] = new Date();
  return nova;
}

/** Grava a entrada, a saída e o desvio de uma pessoa num dia: atualiza a linha desse dia ou cria uma. */
function registar(p) {
  const horas = validarLinha(p, 2);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const { folha, col, largura } = abrirRegistos();
    const valores = folha.getDataRange().getValues();
    const chave = p.funcionario + ' ' + p.data;
    for (let i = 1; i < valores.length; i++) {
      if (chaveDaLinha(valores[i], col) !== chave) continue;
      // Mantém a nota e as outras colunas da linha
      const n = i + 1;
      folha.getRange(n, col.entrada + 1).setValue(p.entrada);
      folha.getRange(n, col.saida + 1).setValue(p.saida);
      folha.getRange(n, col.horas + 1).setValue(horas);
      folha.getRange(n, col.atualizado_em + 1).setValue(new Date());
      return;
    }
    folha.appendRow(novaLinha(p, col, largura, horas));
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
