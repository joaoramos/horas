// Regras de cálculo do saldo flexível, segundo o "Regulamento interno de utilização do saldo flexível"
// da APJM. Tudo em minutos para evitar erros de arredondamento.
//
// Cada dia útil tem uma hora de entrada e de saída. O desvio é o tempo entre as duas, menos a pausa
// (1h, sem trabalho) e menos as 8 horas do horário: ex.: 9:30–19:00 com 1h de pausa = +30min.
// - Nos dias úteis, cada pessoa regista na app a entrada e a saída, com um desvio até ±2h por dia.
// - Todos os dias úteis ficam registados na folha: os que ninguém alterou são preenchidos todas
//   as noites com o horário habitual (ver preencherDias em index.js).
// - Dias completos de ausência (art. 5.º) e trabalho ao fim de semana ou feriado são registados
//   pela APJM diretamente na folha; esse registo é a aprovação.
//
// O saldo tem duas partes:
// - Saldo transitado: o saldo inicial da folha mais tudo o que foi registado antes de
//   REGRAS.inicioLimites. Está isento dos limites e só diminui: absorve primeiro os desvios
//   de sinal contrário.
// - Saldo com limites: tudo o resto. No fecho de cada mês fica entre −30h e +50h (art. 2.º).
//   Acima de +50h as horas a mais perdem-se; abaixo de −30h as horas a mais são descontadas
//   no salário desse mês.

import { ehDataValida, ehDiaUtil, fimDoMes, formatarHora, lerHora, somarDias, segundaDeReferencia } from './datas.js';

export const REGRAS = {
  minutosPorDia: 8 * 60,
  maxMinutosPorDia: 2 * 60,
  passoMinutos: 15,
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

/** Desvio de um dia útil face às 8 horas, a partir da entrada, da saída e da pausa (tudo em minutos). */
export function desvioDoHorario(entrada, saida, pausa) {
  return saida - entrada - pausa - REGRAS.minutosPorDia;
}

function agruparPorDia(registos) {
  const dias = new Map();
  for (const r of registos) {
    const dia = dias.get(r.data) ?? { data: r.data, minutos: 0, entrada: null, saida: null, notas: [] };
    dia.minutos += r.minutos;
    if (dia.entrada === null && r.entrada != null) {
      dia.entrada = r.entrada;
      dia.saida = r.saida;
    }
    if (r.nota) dia.notas.push(r.nota);
    dias.set(r.data, dia);
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

/** Dias que só a APJM pode registar: fins de semana, feriados e desvios acima de 2h (art. 5.º). */
export function registadoPelaApjm(data, minutos, feriados) {
  return !ehDiaUtil(data, feriados) || Math.abs(minutos) > REGRAS.maxMinutosPorDia;
}

/** Valida um pedido de registo (data, entrada e saída) e devolve o registo normalizado. */
export function validarRegisto({ data, entrada, saida }, hoje, feriados, { minutosAtuais = 0, pausa = 60 } = {}) {
  if (!ehDataValida(data)) throw new ErroPublico('Data inválida.');
  if (!ehDiaUtil(data, feriados)) {
    throw new ErroPublico('Fins de semana e feriados só podem ser registados pela APJM.');
  }
  if (!ehEditavel(data, hoje, feriados)) throw new ErroPublico('Este dia já não pode ser alterado.');
  if (registadoPelaApjm(data, minutosAtuais, feriados)) {
    throw new ErroPublico('Este dia foi registado pela APJM e só pode ser alterado na folha.');
  }

  const e = lerHora(entrada);
  const s = lerHora(saida);
  if (e === null || s === null) throw new ErroPublico('Indique a hora de entrada e de saída.');
  if (e % REGRAS.passoMinutos || s % REGRAS.passoMinutos) {
    throw new ErroPublico(`As horas têm de ser múltiplos de ${REGRAS.passoMinutos} minutos.`);
  }
  if (s - e <= pausa) throw new ErroPublico('A saída tem de ser depois da entrada (e da pausa).');

  const minutos = desvioDoHorario(e, s, pausa);
  if (Math.abs(minutos) > REGRAS.maxMinutosPorDia) {
    throw new ErroPublico('Na app só pode registar até 2 horas a mais ou a menos por dia. Dias completos de ausência precisam de aprovação da APJM.');
  }
  return { minutos, entrada: formatarHora(e), saida: formatarHora(s) };
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
      const apjm = minutos !== 0 && registadoPelaApjm(data, minutos, feriados);
      dias.push({
        data,
        minutos,
        // Sem registo, mostra o horário habitual
        entrada: formatarHora(registo?.entrada ?? horario.entrada),
        saida: formatarHora(registo?.saida ?? horario.saida),
        registado: Boolean(registo),
        feriado: feriados.has(data),
        apjm,
        editavel: ehEditavel(data, hoje, feriados) && !apjm,
      });
    }
    semanas.push({ segunda, atual: segunda === segundaDeReferencia(hoje), dias });
  }
  return semanas;
}

export function historico(saldo, feriados) {
  return saldo.dias
    .map((d) => {
      const util = ehDiaUtil(d.data, feriados);
      return {
        data: d.data,
        minutos: d.minutos,
        // Num dia útil o desvio é face às 8h; ao fim de semana ou feriado, são as horas trabalhadas
        trabalhados: util ? REGRAS.minutosPorDia + d.minutos : Math.max(0, d.minutos),
        entrada: d.entrada === null ? null : formatarHora(d.entrada),
        saida: d.saida === null ? null : formatarHora(d.saida),
        estado: d.data < saldo.hoje ? 'confirmado' : d.data === saldo.hoje ? 'hoje' : 'planeado',
        apjm: registadoPelaApjm(d.data, d.minutos, feriados),
        notas: d.notas,
      };
    })
    .reverse();
}

