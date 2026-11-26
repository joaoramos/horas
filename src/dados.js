// Acesso à folha Google Sheets, através do Apps Script em apps-script/Code.gs.
// O Apps Script devolve cada separador como uma tabela (linha de cabeçalho + linhas).

import { ehDataValida, ehDiaUtil, lerHora, somarDias, hojeEmLisboa, segundaDeReferencia } from './datas.js';
import { desvioDoHorario, desvioDosBlocos, minutosTrabalhados } from './saldo.js';

// Horário habitual quando a folha não indica outro: 9:00–13:00 e 14:00–18:00
const HORARIO_POR_OMISSAO = { manha: { entrada: 9 * 60, saida: 13 * 60 }, tarde: { entrada: 14 * 60, saida: 18 * 60 } };
// Pausa dos registos antigos, de antes dos dois blocos (coluna "pausa", em horas)
const PAUSA_ANTIGA_POR_OMISSAO = 60;

const CHAVE_CACHE = 'https://cache.horas.internal/dados';
const SEGUNDOS_EM_CACHE = 30;

export function normalizarCabecalho(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function paraObjetos(tabela = []) {
  if (tabela.length < 2) return [];
  const cabecalho = tabela[0].map(normalizarCabecalho);
  return tabela
    .slice(1)
    .filter((linha) => linha.some((v) => String(v ?? '').trim() !== ''))
    .map((linha) => Object.fromEntries(cabecalho.map((c, i) => [c, linha[i] ?? ''])));
}

/** Aceita 2, "1,5", "-1.25", "+0:45", "-1h30". Devolve minutos, ou null. */
export function lerHoras(valor) {
  if (typeof valor === 'number') return Math.round(valor * 60);
  const texto = String(valor ?? '').trim().replace('−', '-').replace(/\s/g, '');
  if (texto === '') return 0;
  const hm = texto.match(/^([+-]?)(\d+)(?::|h)(\d{1,2})?m?$/i);
  if (hm) return (hm[1] === '-' ? -1 : 1) * (Number(hm[2]) * 60 + Number(hm[3] ?? 0));
  const n = Number(texto.replace(',', '.').replace(/h$/i, ''));
  return Number.isFinite(n) ? Math.round(n * 60) : null;
}

/** Aceita "2026-10-24" e "24/10/2026". */
export function lerData(valor) {
  const texto = String(valor ?? '').trim();
  const pt = texto.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const data = pt ? `${pt[3]}-${pt[2].padStart(2, '0')}-${pt[1].padStart(2, '0')}` : texto.slice(0, 10);
  return ehDataValida(data) ? data : null;
}

/** Número de dias (ex.: 22 ou "22,5"), ou null se estiver vazio. */
function lerDias(valor) {
  const texto = String(valor ?? '').trim().replace(',', '.');
  if (texto === '') return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

function lerAtivo(valor) {
  const texto = normalizarCabecalho(valor);
  return !['nao', 'n', 'no', 'false', 'falso', '0', 'inativo'].includes(texto);
}

export function slug(texto) {
  return normalizarCabecalho(texto).replace(/_/g, '-');
}

/** Um bloco de trabalho a partir de duas colunas de horas. Sem as duas horas (ou com a saída antes da entrada), não há bloco. */
function lerBloco(entrada, saida) {
  const e = lerHora(entrada);
  const s = lerHora(saida);
  return e !== null && s !== null && s > e ? { entrada: e, saida: s } : null;
}

const vazio = (v) => String(v ?? '').trim() === '';

/**
 * Horário habitual de um funcionário: os blocos da manhã e da tarde.
 * Numa folha antiga, só com `entrada`, `saida` e `pausa`, a pausa fica às 13:00.
 */
function lerHorario(f) {
  const colunasNovas = ['entrada_manha', 'saida_manha', 'entrada_tarde', 'saida_tarde'];
  if (colunasNovas.some((c) => !vazio(f[c]))) {
    return { manha: lerBloco(f.entrada_manha, f.saida_manha), tarde: lerBloco(f.entrada_tarde, f.saida_tarde) };
  }
  const antigo = lerBloco(f.entrada, f.saida);
  const pausa = vazio(f.pausa) ? PAUSA_ANTIGA_POR_OMISSAO : lerHoras(f.pausa) ?? PAUSA_ANTIGA_POR_OMISSAO;
  const almoco = 13 * 60;
  if (antigo && antigo.entrada < almoco && antigo.saida > almoco + pausa) {
    return { manha: { entrada: antigo.entrada, saida: almoco }, tarde: { entrada: almoco + pausa, saida: antigo.saida } };
  }
  return HORARIO_POR_OMISSAO;
}

/** "férias", "folga" ou "greve" (coluna "tipo"); outro valor conta como dia normal. */
function lerTipo(valor) {
  const tipo = normalizarCabecalho(valor ?? '');
  return ['ferias', 'folga', 'greve'].includes(tipo) ? tipo : '';
}

export function interpretar(tabelas) {
  const funcionarios = paraObjetos(tabelas.funcionarios)
    .map((f) => ({
      id: slug(f.id || f.nome),
      nome: String(f.nome || f.id).trim(),
      pin: String(f.pin ?? '').trim(),
      saldoInicial: lerHoras(f.saldo_inicial) ?? 0,
      // Dias de férias do ano corrente (vazio = ainda não indicado pela APJM)
      diasFerias: lerDias(f.dias_ferias),
      ativo: lerAtivo(f.ativo),
      horario: lerHorario(f),
      // Só para os registos antigos, com entrada, saída e pausa
      pausa: vazio(f.pausa) ? PAUSA_ANTIGA_POR_OMISSAO : lerHoras(f.pausa) ?? PAUSA_ANTIGA_POR_OMISSAO,
    }))
    .filter((f) => f.id && f.ativo);

  // Data → nome do feriado (ex.: "2026-12-08" → "Imaculada Conceição")
  const feriados = new Map(
    paraObjetos(tabelas.feriados)
      .map((f) => [lerData(f.data), String(f.descricao ?? '').trim()])
      .filter(([data]) => data),
  );
  const pausaDe = new Map(funcionarios.map((f) => [f.id, f.pausa]));

  const registos = paraObjetos(tabelas.registos)
    .map((r) => {
      const data = lerData(r.data);
      const funcionario = slug(r.funcionario);
      const tipo = lerTipo(r.tipo);
      const ferias = tipo === 'ferias';
      const diaTirado = tipo === 'folga' || tipo === 'greve' ? tipo : null;
      const manha = lerBloco(r.entrada_manha, r.saida_manha);
      const tarde = lerBloco(r.entrada_tarde, r.saida_tarde);
      const comBlocos = Boolean(manha || tarde);
      const ajuste = vazio(r.ajuste) ? 0 : lerHoras(r.ajuste) ?? 0;
      // Registos antigos, de antes dos dois blocos: uma entrada e uma saída, com a pausa da pessoa
      const entrada = lerHora(r.entrada);
      const saida = lerHora(r.saida);
      const comHorarioAntigo = !comBlocos && entrada !== null && saida !== null && saida > entrada;
      const horas = vazio(r.horas) ? null : lerHoras(r.horas);
      const diaUtil = data && ehDiaUtil(data, feriados);
      let minutos;
      // Num dia útil com blocos, o desvio vem dos blocos e do ajuste; senão, da coluna "horas"
      // (ex.: ausências registadas pela APJM, ou registos antigos sem horário).
      if (ferias) minutos = 0;
      else if (diaTirado) minutos = -8 * 60;
      else if (comBlocos && diaUtil) minutos = desvioDosBlocos(manha, tarde, ajuste);
      else if (comHorarioAntigo && diaUtil) minutos = desvioDoHorario(entrada, saida, pausaDe.get(funcionario) ?? PAUSA_ANTIGA_POR_OMISSAO);
      else if (horas !== null) minutos = horas;
      else if (comBlocos) minutos = minutosTrabalhados(manha, tarde, ajuste); // fim de semana ou feriado: horas trabalhadas
      else if (comHorarioAntigo) minutos = saida - entrada;
      else minutos = null;
      const semHorario = ferias || diaTirado;
      return {
        data,
        funcionario,
        minutos,
        manha: semHorario ? null : manha,
        tarde: semHorario ? null : tarde,
        ajuste: semHorario || !comBlocos ? 0 : ajuste,
        entrada: comHorarioAntigo && !semHorario ? entrada : null,
        saida: comHorarioAntigo && !semHorario ? saida : null,
        ferias,
        diaTirado,
        nota: String(r.nota ?? '').trim(),
        observacao: String(r.observacao ?? '').trim(),
      };
    })
    .filter((r) => r.data && r.funcionario && r.minutos !== null);

  return { funcionarios, registos, feriados };
}

async function pedirAoAppsScript(env, init) {
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_TOKEN) {
    throw new Error('APPS_SCRIPT_URL e APPS_SCRIPT_TOKEN não estão configurados.');
  }
  const url = new URL(env.APPS_SCRIPT_URL);
  if (!init) url.searchParams.set('token', env.APPS_SCRIPT_TOKEN);
  const resposta = await fetch(url, init ? { ...init, redirect: 'follow' } : { redirect: 'follow' });
  const texto = await resposta.text();
  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch {
    throw new Error(`Resposta inesperada do Apps Script (${resposta.status}): ${texto.slice(0, 200)}`);
  }
  if (!corpo.ok) throw new Error(`Apps Script: ${corpo.erro}`);
  return corpo.dados;
}

export async function carregarDados(env, ctx) {
  if (env.DEMO === '1') return interpretar(demo.tabelas());

  const cache = caches.default;
  const emCache = await cache.match(CHAVE_CACHE);
  if (emCache) return interpretar(await emCache.json());

  const tabelas = await pedirAoAppsScript(env);
  ctx.waitUntil(guardarEmCache(tabelas));
  return interpretar(tabelas);
}

function guardarEmCache(tabelas) {
  return caches.default.put(
    CHAVE_CACHE,
    new Response(JSON.stringify(tabelas), {
      headers: { 'content-type': 'application/json', 'cache-control': `max-age=${SEGUNDOS_EM_CACHE}` },
    }),
  );
}

/** Uma linha de "Registos" no formato que o Apps Script grava (horas em horas, blocos em "HH:MM"). */
export function linhaParaFolha({ funcionario, data, manha, tarde, ajuste = 0, minutos, observacao, tipo = '' }) {
  const linha = {
    funcionario,
    data,
    entrada_manha: manha?.entrada ?? '',
    saida_manha: manha?.saida ?? '',
    entrada_tarde: tarde?.entrada ?? '',
    saida_tarde: tarde?.saida ?? '',
    ajuste: ajuste / 60,
    horas: minutos / 60,
    tipo,
  };
  if (observacao !== undefined) linha.observacao = observacao;
  return linha;
}

/** Grava os blocos, o ajuste, a observação e o desvio de um dia (substitui o que existir). Devolve os dados atualizados. */
export async function gravarRegisto(env, ctx, registo) {
  const linha = linhaParaFolha(registo);
  if (env.DEMO === '1') {
    demo.gravar(linha);
    return interpretar(demo.tabelas());
  }
  const tabelas = await pedirAoAppsScript(env, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: env.APPS_SCRIPT_TOKEN, acao: 'registar', ...linha }),
  });
  ctx.waitUntil(guardarEmCache(tabelas));
  return interpretar(tabelas);
}

/** Acrescenta os dias em falta (o Apps Script ignora os que entretanto já existam). */
export async function acrescentarRegistos(env, linhas) {
  if (env.DEMO === '1') {
    linhas.forEach((l) => demo.acrescentar(l));
    return;
  }
  const tabelas = await pedirAoAppsScript(env, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: env.APPS_SCRIPT_TOKEN, acao: 'preencher', linhas }),
  });
  await guardarEmCache(tabelas);
}

/** Lê a folha sem passar pela cache (para o preenchimento noturno). */
export async function carregarDadosAtuais(env) {
  if (env.DEMO === '1') return interpretar(demo.tabelas());
  return interpretar(await pedirAoAppsScript(env));
}

// Dados em memória para desenvolvimento local (DEMO=1 em .dev.vars).
// Criados no primeiro pedido: nos Workers, a hora no âmbito global é sempre 1970.
const demo = (() => {
  let registos;
  const linha = (data, funcionario, horas, nota = '', manha = '', tarde = '', extra = {}) => {
    const [entrada_manha = '', saida_manha = ''] = manha.split('-');
    const [entrada_tarde = '', saida_tarde = ''] = tarde.split('-');
    return { data, funcionario, entrada_manha, saida_manha, entrada_tarde, saida_tarde, horas, nota, ...extra };
  };
  const iniciar = () => {
    const segunda = segundaDeReferencia(hojeEmLisboa());
    registos ??= [
      linha(somarDias(segunda, -7), 'mariana', -2, '', '10:00-14:00', '15:00-17:00'),
      linha(somarDias(segunda, -6), 'mariana', -1.5, '', '10:00-14:00', '15:00-17:30', { observacao: 'Consulta médica ao fim da tarde.' }),
      linha(somarDias(segunda, -4), 'vera', 1, '', '09:30-14:00', '15:00-19:30'),
      linha(somarDias(segunda, -3), 'vera', -0.5, '', '10:00-14:00', '15:00-18:30'),
      linha(somarDias(segunda, -5), 'vera', -8, '', '', '', { tipo: 'greve', observacao: 'Greve geral.' }),
      linha(somarDias(segunda, 1), 'vera', 2.25, '', '09:30-14:00', '15:00-20:30', { ajuste: 0.25, observacao: 'Reunião de pais depois do fecho.' }),
      // Novembro de 2026, já com limites: a Vera passa os +50h (dias completos registados pela APJM)
      linha('2026-11-07', 'vera', 8, 'Sábado: festa de outono'),
      linha('2026-11-14', 'vera', 8, 'Sábado: formação'),
      linha('2026-11-21', 'vera', 8, 'Sábado: feira'),
      linha('2026-11-22', 'vera', 8, 'Domingo: feira'),
      linha('2026-11-28', 'vera', 8, 'Sábado: limpezas'),
      linha('2026-11-29', 'vera', 8, 'Domingo: limpezas'),
      linha('2026-11-30', 'vera', 6, 'Reunião de pais', '08:00-14:00', '15:00-23:00'),
      linha('2026-12-01', 'vera', -8, 'Dia completo aprovado pela APJM'),
      linha('2026-11-02', 'mariana', -2, '', '10:00-14:00', '15:00-17:00'),
      linha('2026-11-03', 'mariana', 2, '', '09:00-14:00', '15:00-20:00'),
      // Férias da Mariana (coluna "tipo")
      linha('2026-11-11', 'mariana', '', 'Férias de outono', '', '', { tipo: 'Férias' }),
      linha('2026-11-12', 'mariana', '', 'Férias de outono', '', '', { tipo: 'Férias' }),
    ];
    return registos;
  };
  const colunas = ['data', 'funcionario', 'entrada_manha', 'saida_manha', 'entrada_tarde', 'saida_tarde', 'ajuste', 'horas', 'nota', 'tipo', 'observacao'];
  return {
    tabelas: () => ({
      funcionarios: [
        ['id', 'nome', 'pin', 'saldo_inicial', 'ativo', 'entrada_manha', 'saida_manha', 'entrada_tarde', 'saida_tarde', 'dias_ferias'],
        ['mariana', 'Mariana', '1234', 70, 'sim', '10:00', '14:00', '15:00', '19:00', 22],
        ['vera', 'Vera', '5678', 0, 'sim', '09:30', '14:00', '15:00', '18:30', ''],
      ],
      registos: [colunas, ...iniciar().map((r) => colunas.map((c) => r[c] ?? ''))],
      feriados: [['data', 'descricao'], ['2026-12-08', 'Imaculada Conceição']],
    }),
    gravar(nova) {
      iniciar();
      const atual = registos.find((r) => r.data === nova.data && r.funcionario === nova.funcionario);
      if (atual) Object.assign(atual, nova);
      else registos.push({ ...nova, nota: '' });
    },
    acrescentar(nova) {
      iniciar();
      if (!registos.some((r) => r.data === nova.data && r.funcionario === nova.funcionario)) registos.push({ ...nova, nota: '' });
    },
  };
})();
