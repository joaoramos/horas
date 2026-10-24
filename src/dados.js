// Acesso à folha Google Sheets, através do Apps Script em apps-script/Code.gs.
// O Apps Script devolve cada separador como uma tabela (linha de cabeçalho + linhas).

import { ehDataValida, somarDias, hojeEmLisboa, segundaDeReferencia } from './datas.js';

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
    }))
    .filter((f) => f.id && f.ativo);

  const registos = paraObjetos(tabelas.registos)
    .map((r) => ({
      data: lerData(r.data),
      funcionario: slug(r.funcionario),
      minutos: lerHoras(r.horas),
      nota: String(r.nota ?? '').trim(),
    }))
    .filter((r) => r.data && r.funcionario && r.minutos !== null);

  const feriados = new Set(paraObjetos(tabelas.feriados).map((f) => lerData(f.data)).filter(Boolean));

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

/** Grava o desvio de um dia (substitui o que existir). Devolve os dados atualizados. */
export async function gravarRegisto(env, ctx, { funcionario, data, minutos }) {
  if (env.DEMO === '1') {
    demo.gravar(funcionario, data, minutos);
    return interpretar(demo.tabelas());
  }

  const tabelas = await pedirAoAppsScript(env, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: env.APPS_SCRIPT_TOKEN, acao: 'registar', funcionario, data, horas: minutos / 60 }),
  });
  ctx.waitUntil(guardarEmCache(tabelas));
  return interpretar(tabelas);
}

// Dados em memória para desenvolvimento local (DEMO=1 em .dev.vars).
// Criados no primeiro pedido: nos Workers, a hora no âmbito global é sempre 1970.
const demo = (() => {
  let registos;
  const iniciar = () => {
    const segunda = segundaDeReferencia(hojeEmLisboa());
    registos ??= [
      [somarDias(segunda, -7), 'mariana', -2],
      [somarDias(segunda, -6), 'mariana', -1.5],
      [somarDias(segunda, -4), 'vera', 1],
      [somarDias(segunda, -3), 'vera', -0.5],
      [somarDias(segunda, 1), 'vera', 2],
    ];
    return registos;
  };
  return {
    tabelas: () => ({
      funcionarios: [
        ['id', 'nome', 'pin', 'saldo_inicial', 'ativo'],
        ['mariana', 'Mariana', '1234', 70, 'sim'],
        ['vera', 'Vera', '5678', 0, 'sim'],
      ],
      registos: [['data', 'funcionario', 'horas', 'nota'], ...iniciar().map((r) => [...r, ''])],
      feriados: [['data', 'descricao'], ['2026-12-08', 'Imaculada Conceição']],
    }),
    gravar(funcionario, data, minutos) {
      iniciar();
      const i = registos.findIndex((r) => r[0] === data && r[1] === funcionario);
      if (i >= 0) registos.splice(i, 1);
      if (minutos !== 0) registos.push([data, funcionario, minutos / 60]);
    },
  };
})();
