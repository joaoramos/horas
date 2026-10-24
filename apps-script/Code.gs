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

/** Correr uma vez, à mão, para criar os separadores e o token. */
function configurar() {
  const ss = SpreadsheetApp.getActive();

  criarFolha(ss, FOLHAS.funcionarios, ['id', 'nome', 'pin', 'saldo_inicial', 'ativo'], [
    ['mariana', 'Mariana', '0000', 70, 'sim'],
    ['vera', 'Vera', '0000', 0, 'sim'],
  ], ['@', '@', '@', '0.00', '@']);
  criarFolha(ss, FOLHAS.registos, ['data', 'funcionario', 'horas', 'nota', 'atualizado_em'], [], ['@', '@', '0.00', '@', 'yyyy-mm-dd hh:mm']);
  criarFolha(ss, FOLHAS.feriados, ['data', 'descricao'], [
    ['2026-12-01', 'Restauração da Independência'],
    ['2026-12-08', 'Imaculada Conceição'],
    ['2026-12-25', 'Natal'],
  ], ['@', '@']);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid());
  Logger.log('TOKEN (usar como APPS_SCRIPT_TOKEN no Cloudflare): ' + props.getProperty('TOKEN'));
}

function criarFolha(ss, nome, cabecalho, linhas, formatos) {
  if (ss.getSheetByName(nome)) return;
  const folha = ss.insertSheet(nome);
  formatos.forEach((f, i) => folha.getRange(1, i + 1, folha.getMaxRows(), 1).setNumberFormat(f));
  folha.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
  if (linhas.length) folha.getRange(2, 1, linhas.length, cabecalho.length).setValues(linhas);
  folha.setFrozenRows(1);
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
  return folha.getDataRange().getValues().map((linha) =>
    linha.map((v) => (v instanceof Date ? Utilities.formatDate(v, FUSO, 'yyyy-MM-dd') : v))
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

/** Substitui o desvio de um funcionário num dia. 0 horas apaga a linha. */
function registar(p) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.data)) throw new Error('Data inválida');
  const horas = Number(p.horas);
  if (!isFinite(horas) || Math.abs(horas) > 2) throw new Error('Horas inválidas');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const folha = SpreadsheetApp.getActive().getSheetByName(FOLHAS.registos);
    const valores = folha.getDataRange().getValues();
    const cab = valores[0].map(normalizarCabecalho);
    const col = (nome) => {
      const i = cab.indexOf(nome);
      if (i < 0) throw new Error('Falta a coluna "' + nome + '" no separador ' + FOLHAS.registos);
      return i;
    };
    const iData = col('data');
    const iFunc = col('funcionario');
    const iHoras = col('horas');
    const iAtualizado = cab.indexOf('atualizado_em');

    const linhas = [];
    for (let i = 1; i < valores.length; i++) {
      if (textoDaData(valores[i][iData]) === p.data && String(valores[i][iFunc]).trim().toLowerCase() === p.funcionario) {
        linhas.push(i + 1);
      }
    }

    // Mantém a primeira linha (e a sua nota); apaga duplicados de baixo para cima.
    const [primeira, ...duplicados] = linhas;
    duplicados.reverse().forEach((n) => folha.deleteRow(n));

    if (horas === 0) {
      if (primeira) folha.deleteRow(primeira);
      return;
    }
    if (primeira) {
      folha.getRange(primeira, iHoras + 1).setValue(horas);
      if (iAtualizado >= 0) folha.getRange(primeira, iAtualizado + 1).setValue(new Date());
      return;
    }
    const nova = new Array(cab.length).fill('');
    nova[iData] = p.data;
    nova[iFunc] = p.funcionario;
    nova[iHoras] = horas;
    if (iAtualizado >= 0) nova[iAtualizado] = new Date();
    folha.appendRow(nova);
  } finally {
    lock.releaseLock();
  }
}
