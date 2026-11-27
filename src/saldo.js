// Regras de cálculo do saldo flexível, segundo o "Regulamento interno de utilização do saldo flexível"
// da APJM. Tudo em minutos para evitar erros de arredondamento.
//
// Cada dia útil tem dois blocos de trabalho: o da manhã e o da tarde (ex.: 9:30–14:00 e 15:00–18:30).
// A pausa é o intervalo entre os dois. O desvio é a soma dos dois blocos, mais o ajuste extraordinário,
// menos as 8 horas do horário: ex.: 9:30–14:00 e 15:00–19:00 = 8h30, ou seja, +30min.
// - Nos dias úteis, cada pessoa regista na app os dois blocos e, se for preciso, um ajuste
//   extraordinário (em intervalos de 15 minutos), com um desvio até ±7h por dia.
// - Também pode "tirar o dia" (exceção para dias de greve e situações pontuais, com aprovação prévia
//   do executivo): o dia conta −8h.
// - Todos os dias úteis ficam registados na folha: os que ninguém alterou são preenchidos todas
//   as noites com o horário habitual (ver preencherDias em index.js).
// - Trabalho ao fim de semana ou feriado e outras ausências são registados pela APJM diretamente
//   na folha; esse registo é a aprovação.
//
// O saldo tem duas partes:
// - Saldo transitado: o saldo inicial da folha mais tudo o que foi registado antes de
//   REGRAS.inicioLimites. Está isento dos limites e só diminui: absorve primeiro os desvios
//   de sinal contrário.
// - Saldo com limites: tudo o resto. No fecho de cada mês fica entre −30h e +50h (art. 2.º).
//   Acima de +50h as horas a mais perdem-se; abaixo de −30h as horas a mais são descontadas
//   no salário desse mês.

import { diaDaSemana, ehDataValida, ehDiaUtil, fimDoMes, formatarHora, lerHora, somarDias, segundaDeReferencia } from './datas.js';

export const REGRAS = {
  minutosPorDia: 8 * 60,
  maxMinutosPorDia: 7 * 60,
  passoMinutos: 15,
  maxCaracteresObservacao: 300,
  semanasAnterioresEditaveis: 1,
  semanasFuturasEditaveis: 2,
  inicioLimites: '2026-11-01',
  limitePositivo: 50 * 60,
  limiteNegativo: -30 * 60,
  // A partir de 80% de um limite, a app avisa que está perto
  avisoPerto: 0.8,
};

export class ErroPublico extends Error {
  constructor(mensagem, estado = 400) {
    super(mensagem);
    this.estado = estado;
  }
}

const sinal = (n) => Math.sign(n);

// `feriados` é um Map data → nome (vindo da folha) ou um Set de datas
const nomeDoFeriado = (feriados, data) => (feriados instanceof Map ? feriados.get(data) : '') || '';
const ehFimDeSemana = (data) => diaDaSemana(data) === 0 || diaDaSemana(data) === 6;

/** Desvio de um dia útil face às 8 horas, num registo antigo com entrada, saída e pausa (tudo em minutos). */
export function desvioDoHorario(entrada, saida, pausa) {
  return saida - entrada - pausa - REGRAS.minutosPorDia;
}

/** Minutos de trabalho de um bloco ({ entrada, saida } em minutos), ou 0 se não houver bloco. */
export const duracaoDoBloco = (bloco) => (bloco ? bloco.saida - bloco.entrada : 0);

/** Minutos trabalhados num dia com os blocos da manhã e da tarde, mais o ajuste extraordinário. */
export function minutosTrabalhados(manha, tarde, ajuste = 0) {
  return duracaoDoBloco(manha) + duracaoDoBloco(tarde) + ajuste;
}

/** Desvio de um dia útil face às 8 horas, a partir dos dois blocos e do ajuste extraordinário. */
export function desvioDosBlocos(manha, tarde, ajuste = 0) {
  return minutosTrabalhados(manha, tarde, ajuste) - REGRAS.minutosPorDia;
}

const MOTIVOS_DIA_TIRADO = ['folga', 'greve'];

function agruparPorDia(registos) {
  const dias = new Map();
  for (const r of registos) {
    const dia = dias.get(r.data) ?? {
      data: r.data, minutos: 0, manha: null, tarde: null, ajuste: 0, entrada: null, saida: null,
      ferias: false, diaTirado: null, notas: [], observacao: '',
    };
    dia.minutos += r.minutos;
    if (r.ferias) dia.ferias = true;
    if (r.diaTirado && !dia.diaTirado) dia.diaTirado = r.diaTirado;
    if (!dia.manha && !dia.tarde && (r.manha || r.tarde)) {
      dia.manha = r.manha ?? null;
      dia.tarde = r.tarde ?? null;
      dia.ajuste = r.ajuste ?? 0;
    }
    if (dia.entrada === null && r.entrada != null) {
      dia.entrada = r.entrada;
      dia.saida = r.saida;
    }
    if (r.nota) dia.notas.push(r.nota);
    if (r.observacao && !dia.observacao) dia.observacao = r.observacao;
    dias.set(r.data, dia);
  }
  const semHorario = { manha: null, tarde: null, ajuste: 0, entrada: null, saida: null };
  for (const dia of dias.values()) {
    // Um dia de férias não conta para o saldo, mesmo que haja outras linhas nesse dia
    if (dia.ferias) Object.assign(dia, { minutos: 0, diaTirado: null }, semHorario);
    // Um dia tirado (folga ou greve) conta sempre −8h, mesmo que haja outras linhas nesse dia
    else if (dia.diaTirado) Object.assign(dia, { minutos: -REGRAS.minutosPorDia }, semHorario);
  }
  return [...dias.values()].sort((a, b) => a.data.localeCompare(b.data));
}

/** Fins de mês já fechados até `hoje` (o fecho acontece quando o último dia do mês termina). */
function fechosAte(hoje) {
  const fins = [];
  for (let fim = fimDoMes(REGRAS.inicioLimites); fim < hoje; fim = fimDoMes(somarDias(fim, 1))) fins.push(fim);
  return fins;
}

/** Percorre os dias por ordem, aplicando os fechos de mês já ocorridos. */
function acumular(saldoInicial, dias, hoje) {
  let transitado = saldoInicial;
  let comLimites = 0;
  const fechos = [];

  const fechar = (data) => {
    const antes = comLimites;
    const perdidas = Math.max(0, antes - REGRAS.limitePositivo);
    const aDescontar = Math.max(0, REGRAS.limiteNegativo - antes);
    comLimites = Math.min(REGRAS.limitePositivo, Math.max(REGRAS.limiteNegativo, antes));
    fechos.push({ data, antes, depois: comLimites, perdidas, aDescontar });
  };

  const aplicar = (dia) => {
    if (dia.data < REGRAS.inicioLimites) {
      transitado += dia.minutos;
      return;
    }
    let resto = dia.minutos;
    if (transitado !== 0 && sinal(transitado) !== sinal(resto)) {
      const abate = Math.min(Math.abs(resto), Math.abs(transitado));
      transitado -= sinal(transitado) * abate;
      resto -= sinal(resto) * abate;
    }
    comLimites += resto;
  };

  const fins = fechosAte(hoje);
  let i = 0;
  for (const dia of dias) {
    while (i < fins.length && fins[i] < dia.data) fechar(fins[i++]);
    aplicar(dia);
  }
  while (i < fins.length) fechar(fins[i++]);

  return { transitado, comLimites, fechos };
}

/** Situação face aos limites: 'ok', 'perto', 'acima' (de +50h) ou 'abaixo' (de −30h). */
export function estadoDosLimites(minutos) {
  if (minutos > REGRAS.limitePositivo) return 'acima';
  if (minutos < REGRAS.limiteNegativo) return 'abaixo';
  if (minutos >= REGRAS.limitePositivo * REGRAS.avisoPerto || minutos <= REGRAS.limiteNegativo * REGRAS.avisoPerto) {
    return 'perto';
  }
  return 'ok';
}

/**
 * Saldo de um funcionário num dado dia.
 * Os dias anteriores a `hoje` estão "confirmados"; hoje e os dias seguintes são "planeados"
 * (o saldo só é atualizado no fim de cada dia).
 */
export function calcularSaldo({ saldoInicial, registos, hoje }) {
  const dias = agruparPorDia(registos);
  const real = acumular(saldoInicial, dias.filter((d) => d.data < hoje), hoje);
  const previsto = acumular(saldoInicial, dias, hoje);

  const proximoFecho = fimDoMes(hoje < REGRAS.inicioLimites ? REGRAS.inicioLimites : hoje);
  const comLimitesPrevisto = previsto.comLimites;

  return {
    hoje,
    saldoTotal: real.transitado + real.comLimites,
    saldoPrevisto: previsto.transitado + previsto.comLimites,
    saldoTransitado: real.transitado,
    limites: {
      inicio: REGRAS.inicioLimites,
      positivo: REGRAS.limitePositivo,
      negativo: REGRAS.limiteNegativo,
      saldo: real.comLimites,
      previsto: comLimitesPrevisto,
      estado: estadoDosLimites(comLimitesPrevisto),
      proximoFecho,
      // O que acontece no próximo fecho se nada mudar (já com as horas planeadas)
      perdidasNoFecho: Math.max(0, comLimitesPrevisto - REGRAS.limitePositivo),
      aDescontarNoFecho: Math.max(0, REGRAS.limiteNegativo - comLimitesPrevisto),
    },
    fechos: real.fechos,
    dias,
  };
}

export function primeiroDiaEditavel(hoje) {
  return somarDias(segundaDeReferencia(hoje), -7 * REGRAS.semanasAnterioresEditaveis);
}

export function ultimoDiaEditavel(hoje) {
  return somarDias(segundaDeReferencia(hoje), 7 * REGRAS.semanasFuturasEditaveis + 4);
}

export function ehEditavel(data, hoje, feriados) {
  return ehDiaUtil(data, feriados) && data >= primeiroDiaEditavel(hoje) && data <= ultimoDiaEditavel(hoje);
}

/** Dias que só a APJM pode registar: fins de semana, feriados e desvios acima de 7h (art. 5.º). */
export function registadoPelaApjm(data, minutos, feriados, diaTirado = null) {
  if (diaTirado) return false;
  return !ehDiaUtil(data, feriados) || Math.abs(minutos) > REGRAS.maxMinutosPorDia;
}

const duracao = (m) => (m % 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m / 60}h`);

/** Lê um bloco { entrada, saida } vindo da app. Sem horas, não há bloco (null). */
function lerBloco(bloco, nome) {
  const e = lerHora(bloco?.entrada);
  const s = lerHora(bloco?.saida);
  const vazio = (v) => String(v ?? '').trim() === '';
  if (vazio(bloco?.entrada) && vazio(bloco?.saida)) return null;
  if (e === null || s === null) throw new ErroPublico(`Indica a hora de entrada e de saída ${nome}.`);
  if (e % REGRAS.passoMinutos || s % REGRAS.passoMinutos) {
    throw new ErroPublico(`As horas têm de ser múltiplos de ${REGRAS.passoMinutos} minutos.`);
  }
  if (s <= e) throw new ErroPublico(`A saída ${nome} tem de ser depois da entrada.`);
  return { entrada: e, saida: s };
}

/** Lê o ajuste extraordinário (em minutos, de 15 em 15). */
function lerAjuste(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  const ajuste = Number(valor);
  if (!Number.isInteger(ajuste) || ajuste % REGRAS.passoMinutos) {
    throw new ErroPublico(`O ajuste extraordinário tem de ser em intervalos de ${REGRAS.passoMinutos} minutos.`);
  }
  if (Math.abs(ajuste) > REGRAS.maxMinutosPorDia) {
    throw new ErroPublico(`O ajuste extraordinário vai até ${duracao(REGRAS.maxMinutosPorDia)} a mais ou a menos.`);
  }
  return ajuste;
}

function lerObservacao(valor) {
  const texto = String(valor ?? '').trim();
  if (texto.length > REGRAS.maxCaracteresObservacao) {
    throw new ErroPublico(`A observação pode ter até ${REGRAS.maxCaracteresObservacao} caracteres.`);
  }
  return texto;
}

const blocoEmTexto = (bloco) => (bloco ? { entrada: formatarHora(bloco.entrada), saida: formatarHora(bloco.saida) } : null);

/**
 * Valida um pedido de registo e devolve o registo normalizado. O pedido é um de dois:
 * - um dia normal: { data, manha: { entrada, saida }, tarde: { entrada, saida }, ajuste, observacao }
 *   (um bloco sem horas fica vazio; o ajuste é em minutos);
 * - tirar o dia: { data, tirarDia: true, observacao }, que conta −8h. A app já não pede o motivo: um dia
 *   novo fica com tipo "folga" e um dia já tirado mantém o tipo que tem ("folga" ou "greve").
 *   Ainda se aceita tirarDia: 'folga' | 'greve', de versões anteriores da app.
 */
export function validarRegisto(pedido, hoje, feriados, { minutosAtuais = 0, ferias = false, diaTirado = null } = {}) {
  const { data } = pedido;
  if (!ehDataValida(data)) throw new ErroPublico('Data inválida.');
  if (!ehDiaUtil(data, feriados)) {
    throw new ErroPublico('Fins de semana e feriados só podem ser registados pela APJM.');
  }
  if (!ehEditavel(data, hoje, feriados)) throw new ErroPublico('Este dia já não pode ser alterado.');
  if (ferias) throw new ErroPublico('Este dia está marcado como férias e só pode ser alterado na folha.');
  if (registadoPelaApjm(data, minutosAtuais, feriados, diaTirado)) {
    throw new ErroPublico('Este dia foi registado pela APJM e só pode ser alterado na folha.');
  }
  const observacao = lerObservacao(pedido.observacao);

  if (pedido.tirarDia !== undefined && pedido.tirarDia !== null && pedido.tirarDia !== '') {
    const tipo = pedido.tirarDia === true ? (diaTirado ?? 'folga') : pedido.tirarDia;
    if (!MOTIVOS_DIA_TIRADO.includes(tipo)) throw new ErroPublico('Pedido inválido para tirar o dia.');
    return { minutos: -REGRAS.minutosPorDia, manha: null, tarde: null, ajuste: 0, observacao, tipo };
  }

  const manha = lerBloco(pedido.manha, 'da manhã');
  const tarde = lerBloco(pedido.tarde, 'da tarde');
  if (manha && tarde && tarde.entrada < manha.saida) {
    throw new ErroPublico('O bloco da tarde tem de começar depois de acabar o da manhã.');
  }
  const ajuste = lerAjuste(pedido.ajuste);
  const minutos = desvioDosBlocos(manha, tarde, ajuste);
  if (Math.abs(minutos) > REGRAS.maxMinutosPorDia) {
    const minimo = duracao(REGRAS.minutosPorDia - REGRAS.maxMinutosPorDia);
    const maximo = duracao(REGRAS.minutosPorDia + REGRAS.maxMinutosPorDia);
    throw new ErroPublico(`Cada dia tem de ter entre ${minimo} e ${maximo} de trabalho (até ${duracao(REGRAS.maxMinutosPorDia)} a mais ou a menos). Para não trabalhares o dia inteiro, usa "Tirar o dia".`);
  }
  return { minutos, manha: blocoEmTexto(manha), tarde: blocoEmTexto(tarde), ajuste, observacao, tipo: '' };
}

/** Semanas mostradas na página do funcionário, para registar ou planear horas. */
export function semanasEditaveis(saldo, feriados, horario) {
  const { hoje } = saldo;
  const porDia = new Map(saldo.dias.map((d) => [d.data, d]));
  const semanas = [];
  for (let segunda = primeiroDiaEditavel(hoje); segunda <= ultimoDiaEditavel(hoje); segunda = somarDias(segunda, 7)) {
    const dias = [];
    for (let i = 0; i < 5; i++) {
      const data = somarDias(segunda, i);
      const registo = porDia.get(data);
      const minutos = registo?.minutos ?? 0;
      const ferias = Boolean(registo?.ferias);
      const diaTirado = registo?.diaTirado ?? null;
      const apjm = minutos !== 0 && registadoPelaApjm(data, minutos, feriados, diaTirado);
      const comBlocos = Boolean(registo?.manha || registo?.tarde);
      dias.push({
        data,
        minutos,
        // Sem blocos registados (dia novo, dia tirado ou registo antigo), mostra o horário habitual
        manha: blocoEmTexto(comBlocos ? registo.manha : horario.manha),
        tarde: blocoEmTexto(comBlocos ? registo.tarde : horario.tarde),
        ajuste: comBlocos ? registo.ajuste : 0,
        // Registo antigo, de antes dos dois blocos
        entrada: !comBlocos && registo?.entrada != null ? formatarHora(registo.entrada) : null,
        saida: !comBlocos && registo?.saida != null ? formatarHora(registo.saida) : null,
        observacao: registo?.observacao ?? '',
        registado: Boolean(registo),
        feriado: feriados.has(data),
        nomeFeriado: nomeDoFeriado(feriados, data),
        ferias,
        diaTirado,
        apjm,
        editavel: ehEditavel(data, hoje, feriados) && !apjm && !ferias,
      });
    }
    semanas.push({ segunda, atual: segunda === segundaDeReferencia(hoje), dias });
  }
  return semanas;
}

/**
 * Saldo de férias do ano de `hoje`: os dias marcados como férias em dias úteis desse ano,
 * separados em usados (já passaram) e marcados (hoje ou no futuro).
 */
export function feriasDoAno(saldo, feriados, total) {
  const ano = saldo.hoje.slice(0, 4);
  const dias = saldo.dias
    .filter((d) => d.ferias && d.data.startsWith(ano) && ehDiaUtil(d.data, feriados))
    .map((d) => d.data);
  const usados = dias.filter((data) => data < saldo.hoje);
  const marcados = dias.filter((data) => data >= saldo.hoje);
  return {
    ano: Number(ano),
    total,
    usados: usados.length,
    marcados,
    disponiveis: total === null ? null : total - usados.length - marcados.length,
  };
}

/**
 * Histórico dos dias de semana, do primeiro registo até hoje (ou ao último dia planeado).
 * Os feriados aparecem sempre, como dias sem trabalho; os fins de semana nunca aparecem,
 * mas continuam a contar para o saldo.
 */
export function historico(saldo, feriados) {
  const linha = (d) => {
    const feriado = feriados.has(d.data);
    return {
      data: d.data,
      minutos: d.minutos,
      // Num dia útil o desvio é face às 8h; num feriado, são as horas trabalhadas
      trabalhados: d.ferias || d.diaTirado ? 0 : feriado ? Math.max(0, d.minutos) : REGRAS.minutosPorDia + d.minutos,
      manha: blocoEmTexto(d.manha),
      tarde: blocoEmTexto(d.tarde),
      ajuste: d.ajuste ?? 0,
      entrada: d.entrada == null ? null : formatarHora(d.entrada),
      saida: d.saida == null ? null : formatarHora(d.saida),
      estado: d.data < saldo.hoje ? 'confirmado' : d.data === saldo.hoje ? 'hoje' : 'planeado',
      apjm: registadoPelaApjm(d.data, d.minutos, feriados, d.diaTirado),
      ferias: Boolean(d.ferias),
      diaTirado: d.diaTirado ?? null,
      observacao: d.observacao ?? '',
      feriado,
      nomeFeriado: nomeDoFeriado(feriados, d.data),
      notas: d.notas,
    };
  };

  const dias = saldo.dias.filter((d) => !ehFimDeSemana(d.data));
  const registados = new Set(dias.map((d) => d.data));
  const inicio = dias[0]?.data ?? saldo.hoje;
  const fim = [saldo.hoje, ...dias.map((d) => d.data)].sort().at(-1);
  const feriadosSemRegisto = [...feriados.keys()]
    .filter((data) => data >= inicio && data <= fim && !ehFimDeSemana(data) && !registados.has(data))
    .map((data) => ({ data, minutos: 0, manha: null, tarde: null, entrada: null, saida: null, notas: [] }));

  return [...dias, ...feriadosSemRegisto]
    .sort((a, b) => b.data.localeCompare(a.data))
    .map(linha);
}

