import { acrescentarRegistos, carregarDados, carregarDadosAtuais, gravarRegisto } from './dados.js';
import { ehDiaUtil, formatarHora, hojeEmLisboa, somarDias } from './datas.js';
import { calcularSaldo, desvioDoHorario, ErroPublico, feriasDoAno, historico, REGRAS, semanasEditaveis, validarRegisto } from './saldo.js';

function json(corpo, estado = 200) {
  return new Response(JSON.stringify(corpo), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function saldoDe(funcionario, dados, hoje) {
  return calcularSaldo({
    saldoInicial: funcionario.saldoInicial,
    registos: dados.registos.filter((r) => r.funcionario === funcionario.id),
    feriados: dados.feriados,
    hoje,
  });
}

function resumo(saldo) {
  const { hoje, saldoTotal, saldoPrevisto, saldoTransitado, limites, fechos } = saldo;
  // O último fecho de mês, para a APJM ver na lista horas perdidas ou a descontar
  return { hoje, saldoTotal, saldoPrevisto, saldoTransitado, limites, ultimoFecho: fechos.at(-1) ?? null };
}

function detalhe(funcionario, dados, hoje) {
  const saldo = saldoDe(funcionario, dados, hoje);
  return {
    id: funcionario.id,
    nome: funcionario.nome,
    hoje,
    regras: REGRAS,
    resumo: resumo(saldo),
    horario: {
      entrada: formatarHora(funcionario.horario.entrada),
      saida: formatarHora(funcionario.horario.saida),
      pausa: funcionario.horario.pausa,
    },
    semanas: semanasEditaveis(saldo, dados.feriados, funcionario.horario),
    historico: historico(saldo, dados.feriados),
    fechos: [...saldo.fechos].reverse(),
    ferias: feriasDoAno(saldo, dados.feriados, funcionario.diasFerias),
  };
}

function autenticar(dados, id, pin) {
  const funcionario = dados.funcionarios.find((f) => f.id === id);
  if (!funcionario) throw new ErroPublico('Funcionário não encontrado.', 404);
  if (!funcionario.pin) throw new ErroPublico('Este funcionário ainda não tem PIN definido na folha.', 403);
  if (String(pin ?? '').trim() !== funcionario.pin) throw new ErroPublico('PIN incorreto.', 401);
  return funcionario;
}

async function lerCorpo(request) {
  try {
    return await request.json();
  } catch {
    throw new ErroPublico('Pedido inválido.');
  }
}

async function api(request, env, ctx, url) {
  // HOJE só serve para testar datas em desenvolvimento (DEMO=1)
  const hoje = (env.DEMO === '1' && env.HOJE) || hojeEmLisboa();
  const partes = url.pathname.split('/').filter(Boolean); // ["api", "funcionarios", id, acao]

  if (request.method === 'GET' && partes.length === 2 && partes[1] === 'funcionarios') {
    const dados = await carregarDados(env, ctx);
    return json({
      hoje,
      funcionarios: dados.funcionarios.map((f) => ({ id: f.id, nome: f.nome, resumo: resumo(saldoDe(f, dados, hoje)) })),
    });
  }

  if (request.method === 'GET' && partes.length === 3 && partes[1] === 'funcionarios') {
    const dados = await carregarDados(env, ctx);
    const funcionario = dados.funcionarios.find((f) => f.id === partes[2]);
    if (!funcionario) throw new ErroPublico('Funcionário não encontrado.', 404);
    return json({ id: funcionario.id, nome: funcionario.nome });
  }

  if (request.method === 'POST' && partes.length === 4 && partes[1] === 'funcionarios') {
    const [, , id, acao] = partes;
    const corpo = await lerCorpo(request);

    if (acao === 'sessao') {
      const dados = await carregarDados(env, ctx);
      return json(detalhe(autenticar(dados, id, corpo.pin), dados, hoje));
    }

    if (acao === 'registos') {
      const atuais = await carregarDados(env, ctx);
      const funcionario = autenticar(atuais, id, corpo.pin);
      const doDia = atuais.registos.filter((r) => r.funcionario === funcionario.id && r.data === corpo.data);
      const registo = validarRegisto(corpo, hoje, atuais.feriados, {
        minutosAtuais: doDia.reduce((t, r) => t + r.minutos, 0),
        ferias: doDia.some((r) => r.ferias),
        pausa: funcionario.horario.pausa,
      });
      const dados = await gravarRegisto(env, ctx, { funcionario: funcionario.id, data: corpo.data, ...registo });
      return json(detalhe(funcionario, dados, hoje));
    }
  }

  throw new ErroPublico('Não encontrado.', 404);
}

/** Manifesto da app instalada no ecrã principal, com início na página de onde foi adicionada. */
async function manifesto(url, env, ctx) {
  const pedida = url.searchParams.get('pagina') ?? '/';
  const pagina = /^\/[a-z0-9-]*$/.test(pedida) ? pedida : '/';
  const id = pagina.slice(1);

  let nome = '';
  if (id && id !== 'regras') {
    try {
      nome = (await carregarDados(env, ctx)).funcionarios.find((f) => f.id === id)?.nome ?? '';
    } catch {
      // Sem a folha, o manifesto continua válido, apenas sem o nome.
    }
  }

  const corpo = {
    id: pagina,
    start_url: pagina,
    scope: '/',
    name: nome ? `Horas · ${nome}` : 'Horas · Jardim da Mata',
    short_name: 'Horas',
    description: 'Registo e compensação de horas da equipa do Jardim da Mata.',
    lang: 'pt-PT',
    display: 'standalone',
    background_color: '#fdf2dc',
    theme_color: '#fdf2dc',
    icons: [
      { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icones/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(corpo), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}

/** Páginas da app: o mesmo index.html, com o link do manifesto a apontar para a página pedida. */
async function pagina(request, env, url) {
  const resposta = await env.ASSETS.fetch(request);
  if (!resposta.headers.get('content-type')?.includes('text/html')) return resposta;
  const caminho = url.pathname.replace(/\/+$/, '').toLowerCase() || '/';
  return new HTMLRewriter()
    .on('link[rel="manifest"]', {
      element: (link) => link.setAttribute('href', `/manifest.webmanifest?pagina=${encodeURIComponent(caminho)}`),
    })
    .transform(resposta);
}

/**
 * Preenchimento noturno (Cron Trigger): todos os dias úteis ficam na folha. Para cada pessoa,
 * acrescenta o horário habitual nos dias úteis já terminados que ainda não têm registo.
 * Recua até 31 dias, para recuperar noites em que o preenchimento tenha falhado.
 */
export async function preencherDias(env, hoje = hojeEmLisboa()) {
  const dados = await carregarDadosAtuais(env);
  const existentes = new Set(dados.registos.map((r) => `${r.funcionario} ${r.data}`));
  let inicio = somarDias(hoje, -31);
  if (inicio < REGRAS.inicioLimites) inicio = REGRAS.inicioLimites;

  const linhas = [];
  for (let data = inicio; data < hoje; data = somarDias(data, 1)) {
    if (!ehDiaUtil(data, dados.feriados)) continue;
    for (const f of dados.funcionarios) {
      if (existentes.has(`${f.id} ${data}`)) continue;
      linhas.push({
        data,
        funcionario: f.id,
        entrada: formatarHora(f.horario.entrada),
        saida: formatarHora(f.horario.saida),
        horas: desvioDoHorario(f.horario.entrada, f.horario.saida, f.horario.pausa) / 60,
      });
    }
  }
  if (linhas.length) await acrescentarRegistos(env, linhas);
  console.log(`Preenchimento noturno: ${linhas.length} dia(s) acrescentado(s).`);
  return linhas.length;
}

export default {
  async scheduled(evento, env, ctx) {
    const hoje = (env.DEMO === '1' && env.HOJE) || hojeEmLisboa();
    ctx.waitUntil(preencherDias(env, hoje));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/manifest.webmanifest') return manifesto(url, env, ctx);
    if (!url.pathname.startsWith('/api/')) return pagina(request, env, url);
    try {
      return await api(request, env, ctx, url);
    } catch (erro) {
      if (erro instanceof ErroPublico) return json({ erro: erro.message }, erro.estado);
      console.error(erro);
      return json({ erro: 'Não foi possível contactar a folha de horas. Tente novamente daqui a pouco.' }, 502);
    }
  },
};
