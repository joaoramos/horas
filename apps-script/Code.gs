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
  configuracao: 'Configuracao', // só para o Apps Script (a app não o lê)
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
  configuracao: [['chave', '@'], ['valor', '@'], ['descricao', '@']],
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
 * Correr à mão: cria os separadores (incluindo Configuracao) e o token, ou atualiza uma folha antiga.
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
  criarFolha(ss, FOLHAS.configuracao, COLUNAS.configuracao, [
    [RESUMO.chaveDestinatarios, '', 'Quem recebe o resumo semanal por email (vários endereços separados por vírgulas)'],
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

// ---------------------------------------------------------------------------------------------
// Resumo semanal por email, para o executivo da APJM
//
// - enviarResumoSemanal: envia já o resumo da semana atual (de segunda a domingo). É também a
//   função que o acionador corre todos os sábados às 18:00.
// - enviarResumoSemanaAnterior: envia já o resumo da semana passada (ex.: se o de sábado falhou).
// - criarAcionadorSemanal: correr uma vez para o envio automático (sábados, 18:00, hora de Lisboa).
// - removerAcionadorSemanal: para parar o envio automático.
// Os destinatários ficam no separador Configuracao, na linha email_resumo (coluna valor).
// ---------------------------------------------------------------------------------------------

const RESUMO = {
  chaveDestinatarios: 'email_resumo',
  // Dias com um desvio maior do que isto (a mais ou a menos) aparecem em destaque
  limiteDestaqueMinutos: 2 * 60,
  fuso: 'Europe/Lisbon',
  horaDoEnvio: 18,
  url: 'https://horas.jardimdamata.pt',
  remetente: 'Horas — Jardim da Mata',
};
const MINUTOS_POR_DIA = 8 * 60;
const PAUSA_ANTIGA = 60;
const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Correr à mão para enviar já o resumo desta semana. O acionador de sábado também corre esta função. */
function enviarResumoSemanal() {
  return enviarResumoDaSemana(hojeEmLisboaGs());
}

/** Correr à mão para enviar já o resumo da semana passada. */
function enviarResumoSemanaAnterior() {
  return enviarResumoDaSemana(somarDiasGs(hojeEmLisboaGs(), -7));
}

/** Correr uma vez: envio automático todos os sábados às 18:00 (hora de Lisboa). Pode correr-se outra vez sem duplicar. */
function criarAcionadorSemanal() {
  removerAcionadorSemanal();
  ScriptApp.newTrigger('enviarResumoSemanal')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(RESUMO.horaDoEnvio)
    .nearMinute(0)
    .inTimezone(RESUMO.fuso)
    .create();
  Logger.log('Acionador criado: resumo semanal aos sábados, por volta das 18:00 (hora de Lisboa).');
}

/** Para o envio automático do resumo. */
function removerAcionadorSemanal() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'enviarResumoSemanal')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/** Envia o resumo da semana (segunda a domingo) que contém `data` ("AAAA-MM-DD"). */
function enviarResumoDaSemana(data) {
  const destinatarios = lerDestinatarios();
  if (!destinatarios) {
    throw new Error('Falta o destinatário: escrever o email na linha ' + RESUMO.chaveDestinatarios +
      ', coluna valor, do separador ' + FOLHAS.configuracao + ' (correr configurar se o separador não existir).');
  }
  const resumo = resumoSemanal(data, hojeEmLisboaGs());
  MailApp.sendEmail({ to: destinatarios, subject: resumo.assunto, body: resumo.texto, htmlBody: resumo.html, name: RESUMO.remetente });
  Logger.log('Resumo enviado para ' + destinatarios + ': ' + resumo.assunto);
  return resumo;
}

function lerDestinatarios() {
  const linhas = paraObjetosGs(lerFolha(FOLHAS.configuracao));
  const linha = linhas.find((l) => normalizarCabecalho(l.chave) === RESUMO.chaveDestinatarios);
  return linha ? String(linha.valor).split(/[,;\s]+/).filter((e) => e.indexOf('@') > 0).join(',') : '';
}

/**
 * Monta o resumo da semana que contém `data`: por funcionária, cada dia com os blocos, o ajuste,
 * o trabalho e o desvio face às 8 horas, e os totais da semana. Os dias com mais de 2 horas de
 * desvio (blocos + ajuste extraordinário, ou dia tirado) ficam em destaque.
 */
function resumoSemanal(data, hoje) {
  const segunda = segundaDaSemanaGs(data);
  const domingo = somarDiasGs(segunda, 6);
  const feriados = {};
  paraObjetosGs(lerFolha(FOLHAS.feriados)).forEach((f) => {
    const d = lerDataGs(f.data);
    if (d) feriados[d] = String(f.descricao || '').trim() || 'Feriado';
  });
  const funcionarias = paraObjetosGs(lerFolha(FOLHAS.funcionarios))
    .filter((f) => String(f.id || f.nome).trim() && ['nao', 'n', 'no', 'false', 'falso', '0', 'inativo'].indexOf(normalizarCabecalho(f.ativo)) < 0)
    .map((f) => ({
      id: normalizarCabecalho(f.id || f.nome).replace(/_/g, '-'),
      nome: String(f.nome || f.id).trim(),
      pausa: String(f.pausa === undefined ? '' : f.pausa).trim() === '' ? PAUSA_ANTIGA : lerHorasGs(f.pausa),
    }));

  // Dias de cada pessoa nesta semana (várias linhas no mesmo dia somam-se, como na app)
  const dias = {};
  paraObjetosGs(lerFolha(FOLHAS.registos)).forEach((r) => {
    const d = lerDataGs(r.data);
    if (!d || d < segunda || d > domingo) return;
    const id = normalizarCabecalho(r.funcionario).replace(/_/g, '-');
    const f = funcionarias.find((x) => x.id === id);
    if (!f) return;
    const dia = interpretarRegistoGs(r, d, feriados, f.pausa);
    if (!dia) return;
    const chave = id + ' ' + d;
    dias[chave] = dias[chave] ? juntarDias(dias[chave], dia) : dia;
  });

  const destaques = [];
  const pessoas = funcionarias.map((f) => {
    const linhas = [];
    for (let d = segunda; d <= domingo; d = somarDiasGs(d, 1)) {
      const dia = dias[f.id + ' ' + d];
      const diaUtil = diaDaSemanaGs(d) >= 1 && diaDaSemanaGs(d) <= 5;
      if (dia) linhas.push(dia);
      else if (diaUtil && feriados[d]) linhas.push({ data: d, estado: 'Feriado: ' + feriados[d], minutos: 0, trabalho: 0, observacao: '' });
      else if (diaUtil) linhas.push({ data: d, estado: d < hoje ? 'Sem registo' : 'Ainda não registado', minutos: null, trabalho: null, observacao: '' });
    }
    linhas.forEach((l) => {
      l.destaque = l.minutos !== null && Math.abs(l.minutos) > RESUMO.limiteDestaqueMinutos;
      if (l.destaque) destaques.push({ nome: f.nome, dia: l });
    });
    const soma = (campo) => linhas.reduce((t, l) => t + (l[campo] || 0), 0);
    return { nome: f.nome, linhas, desvio: soma('minutos'), trabalho: soma('trabalho') };
  });

  const assunto = 'Horas: resumo da semana de ' + intervaloPorExtenso(segunda, somarDiasGs(segunda, 4)) +
    (destaques.length ? ' (' + destaques.length + (destaques.length === 1 ? ' dia' : ' dias') + ' em destaque)' : '');
  return {
    assunto,
    segunda,
    domingo,
    destaques,
    pessoas,
    html: resumoEmHtml(segunda, domingo, pessoas, destaques),
    texto: resumoEmTexto(segunda, domingo, pessoas, destaques),
  };
}

/** Um dia de uma linha de Registos, com as mesmas regras da app (src/dados.js). */
function interpretarRegistoGs(r, data, feriados, pausa) {
  const tipo = normalizarCabecalho(r.tipo || '');
  const manha = lerBlocoGs(r.entrada_manha, r.saida_manha);
  const tarde = lerBlocoGs(r.entrada_tarde, r.saida_tarde);
  const ajuste = String(r.ajuste === undefined ? '' : r.ajuste).trim() === '' ? 0 : lerHorasGs(r.ajuste) || 0;
  const antigo = !manha && !tarde ? lerBlocoGs(r.entrada, r.saida) : null;
  const horas = String(r.horas === undefined ? '' : r.horas).trim() === '' ? null : lerHorasGs(r.horas);
  const diaUtil = diaDaSemanaGs(data) >= 1 && diaDaSemanaGs(data) <= 5 && !feriados[data];
  const dia = {
    data,
    manha,
    tarde: tarde,
    antigo,
    ajuste: manha || tarde ? ajuste : 0,
    observacao: [String(r.observacao || '').trim(), String(r.nota || '').trim() ? 'Nota: ' + String(r.nota).trim() : '']
      .filter(Boolean).join(' · '),
    estado: '',
  };
  const trabalhoBlocos = duracaoGs(manha) + duracaoGs(tarde) + ajuste;
  if (tipo === 'ferias') return Object.assign(dia, { estado: 'Férias', minutos: 0, trabalho: 0, manha: null, tarde: null, antigo: null, ajuste: 0 });
  if (tipo === 'folga' || tipo === 'greve') {
    return Object.assign(dia, { estado: 'Dia tirado', minutos: -MINUTOS_POR_DIA, trabalho: 0, manha: null, tarde: null, antigo: null, ajuste: 0 });
  }
  if ((manha || tarde) && diaUtil) return Object.assign(dia, { minutos: trabalhoBlocos - MINUTOS_POR_DIA, trabalho: trabalhoBlocos });
  if (antigo && diaUtil) {
    const t = duracaoGs(antigo) - pausa;
    return Object.assign(dia, { minutos: t - MINUTOS_POR_DIA, trabalho: t });
  }
  if (horas !== null) {
    return Object.assign(dia, { estado: diaUtil ? 'Registado pela APJM' : 'Trabalho extra', minutos: horas, trabalho: diaUtil ? Math.max(0, MINUTOS_POR_DIA + horas) : horas });
  }
  if (manha || tarde) return Object.assign(dia, { estado: 'Trabalho extra', minutos: trabalhoBlocos, trabalho: trabalhoBlocos });
  if (antigo) return Object.assign(dia, { estado: 'Trabalho extra', minutos: duracaoGs(antigo), trabalho: duracaoGs(antigo) });
  return null;
}

function juntarDias(a, b) {
  if (a.estado === 'Férias' || b.estado === 'Férias') return a.estado === 'Férias' ? a : b;
  if (a.estado === 'Dia tirado' || b.estado === 'Dia tirado') return a.estado === 'Dia tirado' ? a : b;
  return Object.assign({}, a, {
    minutos: a.minutos + b.minutos,
    trabalho: a.trabalho + b.trabalho,
    observacao: [a.observacao, b.observacao].filter(Boolean).join(' · '),
  });
}

// ---- Apresentação do resumo ----

function resumoEmHtml(segunda, domingo, pessoas, destaques) {
  const limite = formatarDuracao(RESUMO.limiteDestaqueMinutos);
  const celula = 'padding:6px 8px;border-bottom:1px solid #e5e0d6;text-align:left;vertical-align:top;';
  const partes = [];
  partes.push('<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:760px">');
  partes.push('<p>Resumo das horas da semana de ' + escaparHtml(intervaloPorExtenso(segunda, domingo)) + '.</p>');

  partes.push('<h2 style="font-size:17px;margin:20px 0 8px">Dias com mais de ' + limite + ' de desvio</h2>');
  if (destaques.length) {
    partes.push('<ul style="padding-left:20px;margin:0">');
    destaques.forEach((x) => {
      partes.push('<li style="margin:4px 0"><strong>' + escaparHtml(x.nome) + '</strong>, ' + escaparHtml(diaCurto(x.dia.data)) + ': ' +
        '<strong style="color:' + (x.dia.minutos < 0 ? '#b3261e' : '#1b5e20') + '">' + formatarDesvio(x.dia.minutos) + '</strong>' +
        (x.dia.estado ? ' (' + escaparHtml(x.dia.estado.toLowerCase()) + ')' : ' (' + escaparHtml(horarioDoDia(x.dia)) + ')') +
        (x.dia.observacao ? ' — <em>' + escaparHtml(x.dia.observacao) + '</em>' : '') + '</li>');
    });
    partes.push('</ul>');
  } else {
    partes.push('<p style="margin:0">Nenhum dia com mais de ' + limite + ' a mais ou a menos.</p>');
  }

  pessoas.forEach((p) => {
    partes.push('<h2 style="font-size:17px;margin:24px 0 4px">' + escaparHtml(p.nome) + '</h2>');
    partes.push('<p style="margin:0 0 8px">Trabalho na semana: <strong>' + formatarDuracao(p.trabalho) + '</strong> · Desvio da semana: <strong>' +
      formatarDesvio(p.desvio) + '</strong></p>');
    partes.push('<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#f3efe6">' +
      ['Dia', 'Manhã', 'Tarde', 'Ajuste', 'Trabalho', 'Desvio', 'Observação'].map((t) => '<th style="' + celula + '">' + t + '</th>').join('') +
      '</tr></thead><tbody>');
    p.linhas.forEach((l) => {
      const fundo = l.destaque ? 'background:#fff1c2;font-weight:bold;' : '';
      const colunas = l.estado && !l.manha && !l.tarde && !l.antigo
        ? ['<td style="' + celula + '" colspan="3">' + escaparHtml(l.estado) + '</td>']
        : [
          '<td style="' + celula + '">' + escaparHtml(l.antigo ? textoBloco(l.antigo) + ' (pausa incluída)' : textoBloco(l.manha)) + '</td>',
          '<td style="' + celula + '">' + escaparHtml(l.antigo ? '' : textoBloco(l.tarde)) + '</td>',
          '<td style="' + celula + '">' + (l.ajuste ? formatarDesvio(l.ajuste) : '') + '</td>',
        ];
      partes.push('<tr style="' + fundo + '"><td style="' + celula + 'white-space:nowrap">' + escaparHtml(diaCurto(l.data)) + '</td>' + colunas.join('') +
        '<td style="' + celula + '">' + (l.trabalho === null ? '—' : formatarDuracao(l.trabalho)) + '</td>' +
        '<td style="' + celula + 'white-space:nowrap">' + (l.minutos === null ? '—' : formatarDesvio(l.minutos)) + '</td>' +
        '<td style="' + celula + 'font-weight:normal">' + escaparHtml(l.observacao || '') + '</td></tr>');
    });
    partes.push('</tbody></table>');
  });

  partes.push('<p style="color:#666;font-size:12px;margin-top:24px">Desvio = diferença face às 8 horas do dia (blocos da manhã e da tarde mais o ajuste extraordinário). ' +
    '"Dia tirado" conta −8h. A amarelo, os dias com mais de ' + limite + ' a mais ou a menos. ' +
    'O saldo de cada pessoa e os limites do mês estão em <a href="' + RESUMO.url + '">' + RESUMO.url.replace('https://', '') + '</a>.</p>');
  partes.push('</div>');
  return partes.join('\n');
}

function resumoEmTexto(segunda, domingo, pessoas, destaques) {
  const limite = formatarDuracao(RESUMO.limiteDestaqueMinutos);
  const linhas = ['Resumo das horas da semana de ' + intervaloPorExtenso(segunda, domingo) + '.', '', 'DIAS COM MAIS DE ' + limite.toUpperCase() + ' DE DESVIO'];
  if (destaques.length) {
    destaques.forEach((x) => linhas.push('- ' + x.nome + ', ' + diaCurto(x.dia.data) + ': ' + formatarDesvio(x.dia.minutos) +
      ' (' + (x.dia.estado ? x.dia.estado.toLowerCase() : horarioDoDia(x.dia)) + ')' + (x.dia.observacao ? ' — ' + x.dia.observacao : '')));
  } else {
    linhas.push('Nenhum dia com mais de ' + limite + ' a mais ou a menos.');
  }
  pessoas.forEach((p) => {
    linhas.push('', p.nome.toUpperCase() + ' — trabalho na semana: ' + formatarDuracao(p.trabalho) + '; desvio da semana: ' + formatarDesvio(p.desvio));
    p.linhas.forEach((l) => {
      linhas.push((l.destaque ? '* ' : '  ') + diaCurto(l.data) + ': ' + (l.estado && !l.manha && !l.tarde && !l.antigo ? l.estado : horarioDoDia(l)) +
        (l.minutos === null ? '' : ' → ' + formatarDesvio(l.minutos)) + (l.observacao ? ' — ' + l.observacao : ''));
    });
  });
  linhas.push('', '* = mais de ' + limite + ' de desvio. Saldos e limites: ' + RESUMO.url);
  return linhas.join('\n');
}

function horarioDoDia(l) {
  if (l.antigo) return textoBloco(l.antigo);
  const blocos = [l.manha, l.tarde].filter(Boolean).map(textoBloco).join(' e ') || 'sem blocos';
  return blocos + (l.ajuste ? ', ajuste ' + formatarDesvio(l.ajuste) : '');
}

function textoBloco(b) {
  return b ? horaEmTexto(b.entrada) + '–' + horaEmTexto(b.saida) : '';
}

function horaEmTexto(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** 510 → "8h30"; 480 → "8h"; 45 → "45min" */
function formatarDuracao(min) {
  const a = Math.abs(Math.round(min));
  const h = Math.floor(a / 60);
  const m = a % 60;
  if (!a) return '0h';
  if (!h) return m + 'min';
  return h + 'h' + (m ? String(m).padStart(2, '0') : '');
}

/** 150 → "+2h30"; −480 → "−8h"; 0 → "0h" */
function formatarDesvio(min) {
  if (!min) return '0h';
  return (min > 0 ? '+' : '−') + formatarDuracao(min);
}

function escaparHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Datas e valores ("AAAA-MM-DD", em UTC para não depender da hora de verão) ----

function hojeEmLisboaGs() {
  return Utilities.formatDate(new Date(), RESUMO.fuso, 'yyyy-MM-dd');
}

function paraUTC(data) {
  const p = data.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}

function somarDiasGs(data, n) {
  return new Date(paraUTC(data).getTime() + n * 86400000).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado */
function diaDaSemanaGs(data) {
  return paraUTC(data).getUTCDay();
}

function segundaDaSemanaGs(data) {
  const d = diaDaSemanaGs(data);
  return somarDiasGs(data, d === 0 ? -6 : 1 - d);
}

/** "2026-11-23" → "seg 23/11" */
function diaCurto(data) {
  return DIAS_DA_SEMANA[diaDaSemanaGs(data)] + ' ' + data.slice(8, 10) + '/' + data.slice(5, 7);
}

/** "23 a 27 de novembro", "30 de novembro a 4 de dezembro" ou "28 de dezembro de 2026 a 1 de janeiro de 2027" */
function intervaloPorExtenso(inicio, fim) {
  const dia = (d) => Number(d.slice(8, 10));
  const mes = (d) => MESES[Number(d.slice(5, 7)) - 1];
  if (inicio.slice(0, 4) !== fim.slice(0, 4)) {
    return dia(inicio) + ' de ' + mes(inicio) + ' de ' + inicio.slice(0, 4) + ' a ' + dia(fim) + ' de ' + mes(fim) + ' de ' + fim.slice(0, 4);
  }
  if (inicio.slice(5, 7) !== fim.slice(5, 7)) return dia(inicio) + ' de ' + mes(inicio) + ' a ' + dia(fim) + ' de ' + mes(fim);
  return dia(inicio) + ' a ' + dia(fim) + ' de ' + mes(fim);
}

/** Aceita "2026-10-24" e "24/10/2026" (as datas já chegam de lerFolha como texto). */
function lerDataGs(valor) {
  const texto = String(valor === undefined || valor === null ? '' : valor).trim();
  const pt = texto.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const data = pt ? pt[3] + '-' + pt[2].padStart(2, '0') + '-' + pt[1].padStart(2, '0') : texto.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null;
}

/** Hora do dia em minutos ("9:30", "09:30", "09:30:00", "9h30"), ou null. */
function lerHoraGs(valor) {
  const m = String(valor === undefined || valor === null ? '' : valor).trim().match(/^(\d{1,2})(?::|h)(\d{2})(?::\d{2})?$/i);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function lerBlocoGs(entrada, saida) {
  const e = lerHoraGs(entrada);
  const s = lerHoraGs(saida);
  return e !== null && s !== null && s > e ? { entrada: e, saida: s } : null;
}

function duracaoGs(b) {
  return b ? b.saida - b.entrada : 0;
}

/** Horas em minutos: aceita 2, "1,5", "-1.25", "+0:45", "-1h30", "-8h45". */
function lerHorasGs(valor) {
  if (typeof valor === 'number') return Math.round(valor * 60);
  const texto = String(valor === undefined || valor === null ? '' : valor).trim().replace('−', '-').replace(/\s/g, '');
  if (texto === '') return 0;
  const hm = texto.match(/^([+-]?)(\d+)(?::|h)(\d{1,2})?m?$/i);
  if (hm) return (hm[1] === '-' ? -1 : 1) * (Number(hm[2]) * 60 + Number(hm[3] || 0));
  const n = Number(texto.replace(',', '.').replace(/h$/i, ''));
  return isFinite(n) ? Math.round(n * 60) : 0;
}

/** Tabela (cabeçalho + linhas) → objetos com os cabeçalhos normalizados; ignora linhas vazias. */
function paraObjetosGs(tabela) {
  if (!tabela || tabela.length < 2) return [];
  const cab = tabela[0].map(normalizarCabecalho);
  return tabela.slice(1)
    .filter((l) => l.some((v) => String(v === null || v === undefined ? '' : v).trim() !== ''))
    .map((l) => {
      const o = {};
      cab.forEach((c, i) => { if (c) o[c] = l[i] === undefined ? '' : l[i]; });
      return o;
    });
}
