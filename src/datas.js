// Datas como texto "AAAA-MM-DD", sempre em UTC para evitar surpresas com a hora de verão.

const DIA_MS = 86_400_000;

function paraDate(data) {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function paraTexto(date) {
  return date.toISOString().slice(0, 10);
}

export function hojeEmLisboa(agora = new Date()) {
  // en-CA formata como AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

export function ehDataValida(data) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  return paraTexto(paraDate(data)) === data;
}

export function somarDias(data, n) {
  return paraTexto(new Date(paraDate(data).getTime() + n * DIA_MS));
}

/** 0 = domingo … 6 = sábado */
export function diaDaSemana(data) {
  return paraDate(data).getUTCDay();
}

export function ehDiaUtil(data, feriados = new Set()) {
  const d = diaDaSemana(data);
  return d >= 1 && d <= 5 && !feriados.has(data);
}

/** O n-ésimo dia útil depois de `data` (não conta a própria data). */
export function somarDiasUteis(data, n, feriados = new Set()) {
  let atual = data;
  let contados = 0;
  while (contados < n) {
    atual = somarDias(atual, 1);
    if (ehDiaUtil(atual, feriados)) contados++;
  }
  return atual;
}

export function segundaDaSemana(data) {
  const d = diaDaSemana(data);
  return somarDias(data, d === 0 ? -6 : 1 - d);
}

/** A segunda-feira da "semana corrente". Ao fim de semana, é a semana que vem. */
export function segundaDeReferencia(hoje) {
  const d = diaDaSemana(hoje);
  if (d === 6) return somarDias(hoje, 2);
  if (d === 0) return somarDias(hoje, 1);
  return segundaDaSemana(hoje);
}

/** Último dia do mês de `data`. */
export function fimDoMes(data) {
  const [a, m] = data.split('-').map(Number);
  return paraTexto(new Date(Date.UTC(a, m, 0)));
}

/** Hora do dia em minutos desde a meia-noite. Aceita "9:30", "09:30", "09:30:00" e "9h30". */
export function lerHora(valor) {
  const m = String(valor ?? '').trim().match(/^(\d{1,2})(?::|h)(\d{2})(?::\d{2})?$/i);
  if (!m) return null;
  const minutos = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? minutos : null;
}

/** 570 → "09:30" */
export function formatarHora(minutos) {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}
