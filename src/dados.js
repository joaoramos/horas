// Acesso à folha Google Sheets, através do Apps Script em apps-script/Code.gs.
// O Apps Script devolve cada separador como uma tabela (linha de cabeçalho + linhas).

import { ehDataValida, ehDiaUtil, lerHora, somarDias, hojeEmLisboa, segundaDeReferencia } from './datas.js';
import { desvioDoHorario } from './saldo.js';

// Horário habitual quando a folha não indica outro
const HORARIO_POR_OMISSAO = { entrada: '9:00', saida: '18:00', pausa: 1 };

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

function lerAtivo(valor) {
  const texto = normalizarCabecalho(valor);
  return !['nao', 'n', 'no', 'false', 'falso', '0', 'inativo'].includes(texto);
}

export function slug(texto) {
  return normalizarCabecalho(texto).replace(/_/g, '-');
}

export function interpretar(tabelas) {
  const funcionarios = paraObjetos(tabelas.funcionarios)
    .map((f) => ({
      id: slug(f.id || f.nome),
      nome: String(f.nome || f.id).trim(),
      pin: String(f.pin ?? '').trim(),
      saldoInicial: lerHoras(f.saldo_inicial) ?? 0,
      ativo: lerAtivo(f.ativo),
      horario: {
        entrada: lerHora(f.entrada) ?? lerHora(HORARIO_POR_OMISSAO.entrada),
        saida: lerHora(f.saida) ?? lerHora(HORARIO_POR_OMISSAO.saida),
        pausa: String(f.pausa ?? '').trim() === '' ? HORARIO_POR_OMISSAO.pausa * 60 : lerHoras(f.pausa) ?? 60,
      },
    }))
    .filter((f) => f.id && f.ativo);

  // Data → nome do feriado (ex.: "2026-12-08" → "Imaculada Conceição")
  const feriados = new Map(
    paraObjetos(tabelas.feriados)
      .map((f) => [lerData(f.data), String(f.descricao ?? '').trim()])
      .filter(([data]) => data),
  );
  const pausaDe = new Map(funcionarios.map((f) => [f.id, f.horario.pausa]));

  const registos = paraObjetos(tabelas.registos)
    .map((r) => {
      const data = lerData(r.data);
      const funcionario = slug(r.funcionario);
      const entrada = lerHora(r.entrada);
      const saida = lerHora(r.saida);
      const comHorario = entrada !== null && saida !== null && saida > entrada;
      const horas = String(r.horas ?? '').trim() === '' ? null : lerHoras(r.horas);
      let minutos;
      // Num dia útil com entrada e saída, o desvio vem do horário; senão, da coluna "horas"
      // (ex.: dias completos de ausência registados pela APJM, ou registos antigos sem horário).
      if (comHorario && data && ehDiaUtil(data, feriados)) minutos = desvioDoHorario(entrada, saida, pausaDe.get(funcionario) ?? 60);
      else if (horas !== null) minutos = horas;
      else if (comHorario) minutos = saida - entrada; // fim de semana ou feriado: horas trabalhadas
      else minutos = null;
      return {
        data,
        funcionario,
        minutos,
        entrada: comHorario ? entrada : null,
        saida: comHorario ? saida : null,
        nota: String(r.nota ?? '').trim(),
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

/** Grava a entrada, a saída e o desvio de um dia (substitui o que existir). Devolve os dados atualizados. */
export async function gravarRegisto(env, ctx, { funcionario, data, entrada, saida, minutos }) {
  const linha = { funcionario, data, entrada, saida, horas: minutos / 60 };
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
  const linha = (data, funcionario, horas, nota = '', entrada = '', saida = '') => ({ data, funcionario, entrada, saida, horas, nota });
  const iniciar = () => {
    const segunda = segundaDeReferencia(hojeEmLisboa());
    registos ??= [
      linha(somarDias(segunda, -7), 'mariana', -2, '', '09:00', '16:00'),
      linha(somarDias(segunda, -6), 'mariana', -1.5, '', '09:00', '16:30'),
      linha(somarDias(segunda, -4), 'vera', 1, '', '09:30', '19:30'),
      linha(somarDias(segunda, -3), 'vera', -0.5, '', '10:00', '18:30'),
      linha(somarDias(segunda, 1), 'vera', 2, '', '09:30', '20:30'),
      // Novembro de 2026, já com limites: a Vera passa os +50h (dias completos registados pela APJM)
      linha('2026-11-07', 'vera', 8, 'Sábado: festa de outono'),
      linha('2026-11-14', 'vera', 8, 'Sábado: formação'),
      linha('2026-11-21', 'vera', 8, 'Sábado: feira'),
      linha('2026-11-22', 'vera', 8, 'Domingo: feira'),
      linha('2026-11-28', 'vera', 8, 'Sábado: limpezas'),
      linha('2026-11-29', 'vera', 8, 'Domingo: limpezas'),
      linha('2026-11-30', 'vera', 6, 'Reunião de pais', '08:00', '23:00'),
      linha('2026-12-01', 'vera', -8, 'Dia completo aprovado pela APJM'),
      linha('2026-11-02', 'mariana', -2, '', '09:00', '16:00'),
      linha('2026-11-03', 'mariana', 2, '', '08:00', '19:00'),
    ];
    return registos;
  };
  const colunas = ['data', 'funcionario', 'entrada', 'saida', 'horas', 'nota'];
  return {
    tabelas: () => ({
      funcionarios: [
        ['id', 'nome', 'pin', 'saldo_inicial', 'ativo', 'entrada', 'saida', 'pausa'],
        ['mariana', 'Mariana', '1234', 70, 'sim', '9:00', '18:00', 1],
        ['vera', 'Vera', '5678', 0, 'sim', '9:30', '18:30', 1],
      ],
      registos: [colunas, ...iniciar().map((r) => colunas.map((c) => r[c]))],
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
