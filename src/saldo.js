// Regras de cálculo do balanço de horas. Tudo em minutos para evitar erros de arredondamento.
//
// Cada registo é o desvio de um dia útil face às 8 horas padrão (ex.: +90 = trabalhou 9h30).
// Um desvio tem de ser compensado por desvios de sinal contrário nos 5 dias úteis seguintes.
// As compensações abatem primeiro os desvios mais antigos (FIFO). O saldo inicial vindo da
// folha (ex.: as 70h da Mariana) é tratado como "saldo transitado": não tem prazo e só é
// abatido por desvios de sinal contrário que já não tenham nenhum desvio pendente para compensar.

import { ehDataValida, ehDiaUtil, somarDias, somarDiasUteis, segundaDeReferencia } from './datas.js';

export const REGRAS = {
  minutosPorDia: 8 * 60,
  maxMinutosPorDia: 2 * 60,
  passoMinutos: 15,
  diasUteisParaCompensar: 5,
  semanasAnterioresEditaveis: 1,
  semanasFuturasEditaveis: 2,
};

export class ErroPublico extends Error {
  constructor(mensagem, estado = 400) {
    super(mensagem);
    this.estado = estado;
  }
}

const sinal = (n) => Math.sign(n);
const somar = (lista) => lista.reduce((t, x) => t + x.minutos, 0);

function agruparPorDia(registos) {
  const dias = new Map();
  for (const r of registos) {
    const dia = dias.get(r.data) ?? { data: r.data, minutos: 0, notas: [] };
    dia.minutos += r.minutos;
    if (r.nota) dia.notas.push(r.nota);
    dias.set(r.data, dia);
  }
  return [...dias.values()].filter((d) => d.minutos !== 0).sort((a, b) => a.data.localeCompare(b.data));
}

function compensar(saldoInicial, dias, feriados) {
  let transitado = saldoInicial;
  const pendentes = []; // todos com o mesmo sinal

  for (const dia of dias) {
    let resto = dia.minutos;

    while (resto !== 0 && pendentes.length && sinal(pendentes[0].minutos) !== sinal(resto)) {
      const p = pendentes[0];
      const abate = Math.min(Math.abs(resto), Math.abs(p.minutos));
      p.minutos -= sinal(p.minutos) * abate;
      resto -= sinal(resto) * abate;
      if (p.minutos === 0) pendentes.shift();
    }

    if (resto !== 0 && transitado !== 0 && sinal(transitado) !== sinal(resto)) {
      const abate = Math.min(Math.abs(resto), Math.abs(transitado));
      transitado -= sinal(transitado) * abate;
      resto -= sinal(resto) * abate;
    }

    if (resto !== 0) {
      pendentes.push({
        data: dia.data,
        prazo: somarDiasUteis(dia.data, REGRAS.diasUteisParaCompensar, feriados),
        minutos: resto,
      });
    }
  }

  return { transitado, pendentes };
}

/**
 * Balanço de um funcionário num dado dia.
 * Os dias anteriores a `hoje` estão "confirmados"; hoje e os dias seguintes são "planeados"
 * (o balanço só é atualizado no fim de cada dia útil).
 */
export function calcularSaldo({ saldoInicial, registos, feriados = new Set(), hoje }) {
  const dias = agruparPorDia(registos);
  const confirmados = dias.filter((d) => d.data < hoje);

  const real = compensar(saldoInicial, confirmados, feriados);
  const previsto = compensar(saldoInicial, dias, feriados);

  const segunda = segundaDeReferencia(hoje);
  const sextaCorrente = somarDias(segunda, 4);
  const sextaSeguinte = somarDias(segunda, 11);
  const ateDomingo = (fim) => previsto.pendentes.filter((p) => p.prazo <= somarDias(fim, 2));

  const emAtraso = real.pendentes.filter((p) => p.prazo < hoje);

  return {
    hoje,
    saldoTotal: saldoInicial + somar(confirmados),
    saldoPrevisto: saldoInicial + somar(dias),
    saldoTransitado: real.transitado,
    semanaCorrente: { ate: sextaCorrente, minutos: somar(ateDomingo(sextaCorrente)) },
    semanaSeguinte: { ate: sextaSeguinte, minutos: somar(ateDomingo(sextaSeguinte)) },
    emIncumprimento: emAtraso.length > 0,
    emAtraso,
    pendentes: previsto.pendentes,
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

/** Valida um pedido de registo e devolve os minutos normalizados. */
export function validarRegisto({ data, horas }, hoje, feriados) {
  if (!ehDataValida(data)) throw new ErroPublico('Data inválida.');
  if (!ehDiaUtil(data, feriados)) throw new ErroPublico('Só é possível registar horas em dias úteis.');
  if (!ehEditavel(data, hoje, feriados)) throw new ErroPublico('Este dia já não pode ser alterado.');

  const minutos = Math.round(Number(horas) * 60);
  if (!Number.isFinite(minutos)) throw new ErroPublico('Número de horas inválido.');
  if (minutos % REGRAS.passoMinutos !== 0) {
    throw new ErroPublico(`As horas têm de ser múltiplos de ${REGRAS.passoMinutos} minutos.`);
  }
  if (Math.abs(minutos) > REGRAS.maxMinutosPorDia) {
    throw new ErroPublico('Não é possível alterar o balanço em mais de 2 horas por dia.');
  }
  return minutos;
}

/** Semanas mostradas na página do funcionário, para registar ou planear horas. */
export function semanasEditaveis(saldo, feriados) {
  const { hoje } = saldo;
  const porDia = new Map(saldo.dias.map((d) => [d.data, d.minutos]));
  const semanas = [];
  for (let segunda = primeiroDiaEditavel(hoje); segunda <= ultimoDiaEditavel(hoje); segunda = somarDias(segunda, 7)) {
    const dias = [];
    for (let i = 0; i < 5; i++) {
      const data = somarDias(segunda, i);
      dias.push({
        data,
        minutos: porDia.get(data) ?? 0,
        feriado: feriados.has(data),
        editavel: ehEditavel(data, hoje, feriados),
      });
    }
    semanas.push({ segunda, atual: segunda === segundaDeReferencia(hoje), dias });
  }
  return semanas;
}

export function historico(saldo) {
  const pendentePorDia = new Map(saldo.pendentes.map((p) => [p.data, p]));
  const atrasados = new Set(saldo.emAtraso.map((p) => p.data));
  return saldo.dias
    .map((d) => {
      const p = pendentePorDia.get(d.data);
      return {
        data: d.data,
        minutos: d.minutos,
        trabalhados: REGRAS.minutosPorDia + d.minutos,
        estado: d.data < saldo.hoje ? 'confirmado' : d.data === saldo.hoje ? 'hoje' : 'planeado',
        notas: d.notas,
        porCompensar: p ? p.minutos : 0,
        prazo: p ? p.prazo : null,
        atrasado: atrasados.has(d.data),
      };
    })
    .reverse();
}
