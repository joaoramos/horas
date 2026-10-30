const app = document.getElementById('app');

// ---------------------------------------------------------------- formatação

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function horas(minutos, { sinal = true } = {}) {
  const abs = Math.abs(minutos);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const texto = m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  if (!sinal || minutos === 0) return texto;
  return (minutos > 0 ? '+' : '−') + texto;
}

const paraDate = (data) => new Date(`${data}T12:00:00Z`);
const formatar = (data, opcoes) => new Intl.DateTimeFormat('pt-PT', { timeZone: 'UTC', ...opcoes }).format(paraDate(data));
const diaCurto = (data) => formatar(data, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
const diaLongo = (data) => formatar(data, { weekday: 'long', day: 'numeric', month: 'long' });
const diaMes = (data) => formatar(data, { day: 'numeric', month: 'long' });
const nomeDoMes = (data) => formatar(data, { month: 'long' });

/** Frase que explica o que um saldo significa na prática. */
function explicar(minutos) {
  if (minutos > 0) return `${horas(minutos, { sinal: false })} a mais — trabalhar menos`;
  if (minutos < 0) return `${horas(minutos, { sinal: false })} em falta — trabalhar mais`;
  return 'Em dia';
}

// ---------------------------------------------------------------- API

async function api(caminho, corpo) {
  let resposta;
  try {
    resposta = await fetch(`/api/${caminho}`, corpo
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }
      : undefined);
  } catch {
    throw Object.assign(new Error('Sem ligação à internet. Tente de novo quando tiver rede.'), { estado: 0 });
  }
  const dados = await resposta.json().catch(() => ({ erro: 'Resposta inválida do servidor.' }));
  if (!resposta.ok) throw Object.assign(new Error(dados.erro || 'Erro inesperado.'), { estado: resposta.status });
  return dados;
}

// O PIN fica guardado neste dispositivo até a pessoa carregar em "Sair", para que a app
// no ecrã principal abra logo na sua página. (sessionStorage perde-se sempre que a app fecha.)
const pinGuardado = {
  ler: (id) => { try { return localStorage.getItem(`pin:${id}`); } catch { return null; } },
  gravar: (id, pin) => { try { localStorage.setItem(`pin:${id}`, pin); } catch {} },
  apagar: (id) => { try { localStorage.removeItem(`pin:${id}`); } catch {} },
};

// ---------------------------------------------------------------- navegação

// Cada link carrega a página de raiz (sem history.pushState). Assim o HTML de cada página traz o
// manifesto certo, e o Safari adiciona ao ecrã principal a página onde a pessoa está.
function navegar(caminho) {
  location.assign(caminho);
}

function marcarNavegacao(caminho) {
  document.querySelectorAll('.site-nav a').forEach((a) => {
    const ativo = a.getAttribute('href') === caminho;
    if (ativo) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// Muda a cada navegação. As páginas guardam o valor antes de cada pedido e ignoram
// respostas que chegam depois de a pessoa ter mudado de página.
let visita = 0;
const mudouDePagina = (minha) => minha !== visita;

function mostrar({ manterPosicao = false } = {}) {
  visita++;
  const caminho = location.pathname.replace(/\/+$/, '') || '/';
  marcarNavegacao(caminho);
  if (!manterPosicao) window.scrollTo(0, 0);
  if (caminho === '/') return paginaEquipa();
  if (caminho === '/regras') return paginaRegras();
  return paginaFuncionario(decodeURIComponent(caminho.slice(1)).toLowerCase());
}

// ---------------------------------------------------------------- app no ecrã principal

/** A barra de estado do telemóvel acompanha a cor de fundo do tema escolhido. */
function atualizarCorDaBarra() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
}
document.addEventListener('change', (e) => {
  if (e.target.id === 'theme-switcher') atualizarCorDaBarra();
});

// Na app instalada não há botão de recarregar: ao voltar a ela depois de algum tempo,
// os dados são atualizados (o dia pode até ter mudado).
let escondidaDesde = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    escondidaDesde = Date.now();
    return;
  }
  const ocupada = app.querySelector('.dia-campos select:disabled, form.pin');
  if (!escondidaDesde || Date.now() - escondidaDesde < 60_000 || ocupada) return;
  const y = window.scrollY;
  await mostrar({ manterPosicao: true });
  window.scrollTo(0, y);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const A_CARREGAR = '<section class="band hero"><p class="a-carregar">A carregar…</p></section>';

function erro(mensagem) {
  app.innerHTML = `
    <section class="band hero">
      <h1>Ups</h1>
      <p class="lead" role="alert">${esc(mensagem)}</p>
      <div class="actions">
        <button type="button" class="button sem-seta" data-tentar>Tentar de novo</button>
        <a class="button" href="/">Voltar à equipa</a>
      </div>
    </section>`;
  app.querySelector('[data-tentar]').addEventListener('click', () => mostrar());
}

// ---------------------------------------------------------------- blocos comuns

/** O saldo total só conta dias já terminados; as horas de hoje e as planeadas aparecem à parte. */
function comPlaneadas(r, etiqueta = 'com as horas planeadas') {
  if (r.saldoPrevisto === r.saldoTotal) return '';
  return `<span class="saldo-previsto"><b>${horas(r.saldoPrevisto)}</b> ${etiqueta}</span>`;
}

function cartoesSaldo(r, ferias) {
  const l = r.limites;
  const antesDoInicio = r.hoje < l.inicio;
  const previstoComLimites = l.previsto !== l.saldo
    ? `<span class="saldo-previsto"><b>${horas(l.previsto)}</b> com as horas planeadas</span>` : '';
  return `
    <dl class="saldos">
      <div class="saldo saldo-total cartao">
        <dt>Saldo total</dt>
        <dd><strong>${horas(r.saldoTotal)}</strong><span>${explicar(r.saldoTotal)}</span>${comPlaneadas(r)}</dd>
      </div>
      <div class="saldo cartao${l.estado === 'ok' ? '' : ' saldo-alerta'}">
        <dt>Saldo com limites</dt>
        <dd><strong>${horas(l.saldo)}</strong>
          <span>${antesDoInicio
            ? `Os limites aplicam-se a partir de ${diaMes(l.inicio)}.`
            : `Entre ${horas(l.negativo)} e ${horas(l.positivo)} no fecho do mês, a ${diaMes(l.proximoFecho)}.`}</span>
          ${previstoComLimites}</dd>
      </div>
      ${r.saldoTransitado ? `
      <div class="saldo cartao">
        <dt>Saldo transitado</dt>
        <dd><strong>${horas(r.saldoTransitado)}</strong><span>Saldo anterior aos limites. Não tem limite e vai diminuindo à medida que é compensado.</span></dd>
      </div>` : ''}
      ${ferias ? cartaoFerias(ferias) : ''}
    </dl>`;
}

const dias = (n) => `${String(n).replace('.', ',')} ${n === 1 ? 'dia' : 'dias'}`;

/** Dias de férias do ano: disponíveis, usados e marcados (a APJM marca-os na folha). */
function cartaoFerias(f) {
  const marcados = f.marcados.length;
  const proximos = f.marcados.slice(0, 5).map((data) => formatar(data, { day: 'numeric', month: 'short' }).replace(/\./g, ''));
  const detalhe = [
    f.total === null ? null : `de ${dias(f.total)} em ${f.ano}`,
    `${dias(f.usados)} ${f.usados === 1 ? 'usado' : 'usados'}`,
    `${dias(marcados)} ${marcados === 1 ? 'marcado' : 'marcados'}`,
  ].filter(Boolean).join(' · ');
  return `
      <div class="saldo cartao">
        <dt>Saldo de férias</dt>
        <dd>${f.disponiveis === null
          ? `<strong>—</strong><span>A APJM ainda não indicou quantos dias de férias tem em ${f.ano}.</span>`
          : `<strong>${dias(f.disponiveis)}</strong><span>${f.disponiveis === 1 ? 'disponível' : 'disponíveis'}</span>`}
          <span class="saldo-previsto">${detalhe}</span>
          ${proximos.length ? `<span class="saldo-previsto">Marcados: ${proximos.join(', ')}${marcados > proximos.length ? '…' : ''}</span>` : ''}</dd>
      </div>`;
}

/** Avisos do art. 2.º: perto ou fora dos limites, e o resultado do último fecho de mês. */
function avisosLimites(r) {
  const l = r.limites;
  const avisos = [];
  const fecho = diaMes(l.proximoFecho);
  if (l.estado === 'acima') {
    avisos.push(['erro', `<strong>Acima do limite.</strong> Tem ${horas(l.perdidasNoFecho, { sinal: false })} acima de ${horas(l.positivo)}. Se não as gozar até ${fecho}, essas horas perdem-se.`]);
  } else if (l.estado === 'abaixo') {
    avisos.push(['erro', `<strong>Abaixo do limite.</strong> Tem ${horas(l.aDescontarNoFecho, { sinal: false })} abaixo de ${horas(l.negativo)}. Se não as compensar até ${fecho}, serão descontadas no salário.`]);
  } else if (l.estado === 'perto') {
    const limite = l.previsto > 0 ? l.positivo : l.negativo;
    avisos.push(['', `<strong>Perto do limite.</strong> O saldo com limites está em ${horas(l.previsto)}, perto de ${horas(limite)}. Tente aproximá-lo de zero.`]);
  }
  const f = r.ultimoFecho;
  if (f && (f.perdidas || f.aDescontar)) {
    const mes = nomeDoMes(f.data);
    avisos.push(['', f.perdidas
      ? `No fecho de ${mes} perderam-se ${horas(f.perdidas, { sinal: false })} acima do limite de ${horas(l.positivo)}.`
      : `No fecho de ${mes}, ${horas(f.aDescontar, { sinal: false })} abaixo do limite de ${horas(l.negativo)} foram para desconto no salário.`]);
  }
  return avisos
    .map(([tipo, texto]) => `<div class="aviso${tipo ? ' aviso-erro' : ''}" role="${tipo ? 'alert' : 'status'}"><p>${texto}</p></div>`)
    .join('');
}

/** Na lista, a APJM vê as horas perdidas ou a descontar no último fecho de mês. */
function fechoNaLista(r) {
  const f = r.ultimoFecho;
  if (!f || !(f.perdidas || f.aDescontar)) return '';
  const mes = nomeDoMes(f.data);
  return `<span class="saldo-previsto">${f.perdidas
    ? `${horas(f.perdidas, { sinal: false })} perdidas em ${mes}`
    : `${horas(f.aDescontar, { sinal: false })} a descontar em ${mes}`}</span>`;
}

/** Etiqueta curta para a lista da equipa. */
function etiquetaLimites(r) {
  const textos = { acima: `Acima de ${horas(r.limites.positivo)}`, abaixo: `Abaixo de ${horas(r.limites.negativo)}`, perto: 'Perto do limite' };
  const texto = textos[r.limites.estado];
  if (!texto) return '';
  return ` <span class="etiqueta${r.limites.estado === 'perto' ? ' etiqueta-suave' : ''}">${texto}</span>`;
}

// ---------------------------------------------------------------- página: equipa

async function paginaEquipa() {
  document.title = 'Horas · Jardim da Mata';
  app.innerHTML = A_CARREGAR;
  const minha = visita;
  let dados;
  try {
    dados = await api('funcionarios');
  } catch (e) {
    if (mudouDePagina(minha)) return;
    return erro(e.message);
  }
  if (mudouDePagina(minha)) return;

  const linhas = dados.funcionarios.map(({ id, nome, resumo: r }) => `
    <li>
      <a class="pessoa cartao" href="/${esc(id)}">
        <span class="pessoa-nome">${esc(nome)}${etiquetaLimites(r)}</span>
        <span class="pessoa-valor"><small>Saldo total</small>${horas(r.saldoTotal)}${comPlaneadas(r, 'planeado')}</span>
        <span class="pessoa-valor"><small>Com limites</small>${horas(r.limites.saldo)}${fechoNaLista(r)}</span>
      </a>
    </li>`).join('');

  app.innerHTML = `
    <section class="band hero">
      <h1>Equipa</h1>
      <p class="lead">Hoje é ${diaLongo(dados.hoje)}.</p>
    </section>
    <section class="band band--surface" aria-labelledby="titulo-saldos">
      <h2 id="titulo-saldos">Saldos</h2>
      <p class="intro">Valores positivos são horas a mais; negativos, horas em falta. No fecho de cada mês, o saldo com limites fica entre −30h e +50h. Escolha o seu nome para registar horas.</p>
      ${dados.funcionarios.length ? `<ul class="equipa">${linhas}</ul>` : '<p>Ainda não há funcionários na folha.</p>'}
    </section>`;
}

// ---------------------------------------------------------------- página: regras

function paginaRegras() {
  document.title = 'Regras · Horas';
  const seccoes = [
    ['Saldo flexível', [
      'O saldo flexível é a diferença acumulada entre as horas de trabalho realizadas e o horário previsto (art. 1.º).',
      'O horário previsto é de segunda a sexta-feira, com 8 horas por dia. Os feriados indicados na folha não contam como dias de trabalho.',
      'Valores positivos são horas a mais; negativos, horas em falta.',
    ]],
    ['Limites do saldo', [
      'Pode acumular até <strong>50 horas positivas</strong> e até <strong>30 horas negativas</strong> sem impacto no processamento salarial (art. 2.º).',
      'Os saldos transitam de mês para mês, dentro destes limites.',
      'No fecho de cada mês, se o saldo for superior a +50h, fica em +50h e <strong>as horas a mais perdem-se</strong>.',
      'No fecho de cada mês, se o saldo for inferior a −30h, <strong>as horas abaixo desse limite são descontadas no salário</strong> desse mês.',
      'Os limites aplicam-se a partir de 1 de novembro de 2026. O saldo acumulado antes dessa data é <strong>saldo transitado</strong>: não tem limite e vai diminuindo à medida que é compensado.',
    ]],
    ['Gestão do saldo', [
      'Cada pessoa gere o seu saldo de forma autónoma e consciente, procurando mantê-lo tão perto de zero quanto possível (art. 3.º).',
      'Se sair mais tarde num dia, sempre que possível entre mais tarde no dia seguinte para compensar.',
      'Como regra, as horas positivas gozam-se em períodos de horas distribuídos ao longo do tempo, e não em dias completos.',
      'Na app, regista a <strong>hora de entrada e de saída</strong> de cada dia útil, em intervalos de 15 minutos. Pode registar a semana passada e planear até duas semanas à frente.',
      'Tirando a pausa, cada dia pode ter <strong>até 2 horas a mais ou a menos</strong> do que as 8 horas (entre 6h e 10h de trabalho).',
      'O saldo total é atualizado no fim de cada dia. As horas de hoje e dos próximos dias aparecem como planeadas.',
    ]],
    ['Gozo de horas positivas', [
      'Se gozar horas positivas afetar os horários dos períodos não letivos, peça <strong>autorização prévia à APJM</strong>, com antecedência suficiente para organizar uma substituição (art. 4.º).',
      'O pedido deve ter em conta a continuidade do funcionamento e a cobertura dos períodos em causa.',
    ]],
    ['Ausência de dia completo', [
      'Gozar um dia completo com o saldo positivo é excecional, tem de ser justificado e precisa sempre de <strong>aprovação prévia da APJM</strong> (art. 5.º).',
      'Podem justificar uma exceção: doença da própria ou de familiares próximos; ter trabalhado um dia completo num fim de semana ou feriado; ou outras situações pessoais excecionais, avaliadas pela APJM.',
      'Os dias completos de ausência e o trabalho ao fim de semana ou feriado são registados pela APJM na folha. Na app aparecem como "Registado pela APJM" e não podem ser alterados.',
    ]],
  ];
  app.innerHTML = `
    <section class="band hero">
      <h1>Regras</h1>
      <p class="lead">Regulamento interno de utilização do saldo flexível.</p>
    </section>
    ${seccoes.map(([titulo, itens], i) => `
    <section class="band${i % 2 ? '' : ' band--surface'}" aria-labelledby="regra-${i + 1}">
      <h2 id="regra-${i + 1}">${titulo}</h2>
      <div class="prose">
        <ul class="lista">${itens.map((t) => `<li>${t}</li>`).join('')}</ul>
      </div>
    </section>`).join('')}`;
}

// ---------------------------------------------------------------- página: funcionário

async function paginaFuncionario(id) {
  app.innerHTML = A_CARREGAR;
  const minha = visita;
  let pessoa;
  try {
    pessoa = await api(`funcionarios/${encodeURIComponent(id)}`);
  } catch (e) {
    if (mudouDePagina(minha)) return;
    return erro(e.estado === 404 ? 'Não encontrámos este funcionário.' : e.message);
  }
  if (mudouDePagina(minha)) return;
  document.title = `${pessoa.nome} · Horas`;

  const pin = pinGuardado.ler(id);
  if (pin) {
    try {
      const detalhe = await api(`funcionarios/${id}/sessao`, { pin });
      if (mudouDePagina(minha)) return;
      return mostrarFuncionario(detalhe, pin);
    } catch (e) {
      if (mudouDePagina(minha)) return;
      pinGuardado.apagar(id);
      if (e.estado !== 401) return erro(e.message);
    }
  }
  pedirPin(pessoa);
}

function pedirPin(pessoa, mensagem = '') {
  app.innerHTML = `
    <section class="band hero">
    <h1>${esc(pessoa.nome)}</h1>
    <p class="lead">Introduza o seu PIN para ver e registar as suas horas.</p>
    <form class="pin" novalidate>
      <label for="pin">PIN de acesso</label>
      <div class="pin-linha">
        <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required autofocus>
        <button type="submit" class="button sem-seta">Entrar</button>
      </div>
      <p class="pin-erro" role="alert">${esc(mensagem)}</p>
    </form>
    </section>`;

  const form = app.querySelector('form');
  form.pin.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = form.pin.value.trim();
    if (!pin) return;
    form.querySelector('button').disabled = true;
    const minha = visita;
    try {
      const detalhe = await api(`funcionarios/${pessoa.id}/sessao`, { pin });
      pinGuardado.gravar(pessoa.id, pin);
      if (mudouDePagina(minha)) return;
      mostrarFuncionario(detalhe, pin);
    } catch (erro) {
      if (mudouDePagina(minha)) return;
      pedirPin(pessoa, erro.message);
    }
  });
}

// "09:30" ⇄ 570
const paraMinutos = (hora) => { const [h, m] = hora.split(':').map(Number); return h * 60 + m; };
const paraHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Horas do dia de 15 em 15 minutos, das 6:00 às 23:00 (e a atual, se estiver fora). */
function opcoesDeHora(atual, regras) {
  const valores = [];
  for (let m = 6 * 60; m <= 23 * 60; m += regras.passoMinutos) valores.push(m);
  const a = paraMinutos(atual);
  if (!valores.includes(a)) {
    valores.push(a);
    valores.sort((x, y) => x - y);
  }
  return valores.map((m) => `<option value="${paraHora(m)}"${m === a ? ' selected' : ''}>${paraHora(m)}</option>`).join('');
}

function semana(s, d) {
  const total = s.dias.reduce((t, dia) => t + dia.minutos, 0);
  const dias = s.dias.map((dia) => {
    const quando = dia.data < d.hoje ? 'passado' : dia.data === d.hoje ? 'hoje' : 'futuro';
    const longo = diaLongo(dia.data);
    let valor;
    if (dia.ferias) {
      // Férias marcadas pela APJM na folha: dia sem trabalho, que não se pode alterar
      valor = '<span class="dia-feriado">Férias</span>';
    } else if (dia.feriado) {
      // Feriado: dia sem trabalho, que não se pode alterar (só a APJM pode registar trabalho na folha)
      valor = `<span class="dia-feriado">Feriado${dia.nomeFeriado ? `<small>${esc(dia.nomeFeriado)}</small>` : ''}${
        dia.minutos ? `<small>${horas(dia.minutos)} registadas pela APJM</small>` : ''}</span>`;
    } else if (dia.apjm) {
      valor = `<span class="dia-apjm">${dia.registado && dia.minutos > -d.regras.minutosPorDia ? `${dia.entrada}–${dia.saida} · ` : ''}${horas(dia.minutos)}<small>APJM</small></span>`;
    } else if (dia.editavel) {
      valor = `
        <span class="dia-campos" data-dia="${dia.data}">
          <select data-campo="entrada" aria-label="Entrada em ${longo}">${opcoesDeHora(dia.entrada, d.regras)}</select>
          <span aria-hidden="true">–</span>
          <select data-campo="saida" aria-label="Saída em ${longo}">${opcoesDeHora(dia.saida, d.regras)}</select>
          <span class="dia-desvio">${horas(dia.minutos)}</span>
        </span>`;
    } else valor = `<span class="dia-fixo">${dia.entrada}–${dia.saida} · ${horas(dia.minutos)}</span>`;
    return `
      <li class="dia dia-${quando}${dia.feriado || dia.ferias ? ' dia-inativo' : ''}"${dia.feriado || dia.ferias ? ' aria-disabled="true"' : ''}>
        <span class="dia-nome">${diaCurto(dia.data)}${quando === 'hoje' ? ' <span class="etiqueta etiqueta-suave">hoje</span>' : ''}</span>
        ${valor}
        <span class="dia-estado" data-estado="${dia.data}" aria-live="polite"></span>
      </li>`;
  }).join('');

  return `
    <section class="semana cartao${s.atual ? ' semana-atual' : ''}">
      <h3>Semana de ${formatar(s.segunda, { day: 'numeric', month: 'long' })}${s.atual ? ' <span class="etiqueta etiqueta-suave">esta semana</span>' : ''}</h3>
      <ul>${dias}</ul>
      <p class="semana-total">Total da semana: <strong>${horas(total)}</strong></p>
    </section>`;
}

function tabelaHistorico(d) {
  if (!d.historico.length) return '<p>Ainda não há horas registadas.</p>';
  const estados = { confirmado: 'Confirmado', hoje: 'Hoje', planeado: 'Planeado' };
  const linhas = d.historico.map((h) => {
    const notas = h.notas.length ? `<small>${esc(h.notas.join(' · '))}</small>` : '';
    if (h.ferias || (h.feriado && !h.minutos)) {
      const motivo = h.ferias ? 'Férias' : `Feriado${h.nomeFeriado ? `<small>${esc(h.nomeFeriado)}</small>` : ''}`;
      return `
      <tr class="linha-inativa">
        <td>${diaCurto(h.data)}${notas}</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td>${motivo}</td>
      </tr>`;
    }
    return `
      <tr${h.feriado ? ' class="linha-inativa"' : ''}>
        <td>${diaCurto(h.data)}${notas}</td>
        <td class="num">${h.entrada ? `${h.entrada}–${h.saida}` : '—'}<small>${horas(h.trabalhados, { sinal: false })} trabalhadas</small></td>
        <td class="num">${horas(h.minutos)}</td>
        <td>${h.feriado ? `Feriado${h.nomeFeriado ? ` · ${esc(h.nomeFeriado)}` : ''}` : estados[h.estado]}${h.apjm ? '<small>Registado pela APJM</small>' : ''}</td>
      </tr>`;
  }).join('');
  return `
    <div class="tabela">
      <table>
        <thead><tr><th>Dia</th><th class="num">Horário</th><th class="num">Balanço</th><th>Estado</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>`;
}

function tabelaFechos(d) {
  const linhas = d.fechos.map((f) => `
      <tr>
        <td>${nomeDoMes(f.data)} ${f.data.slice(0, 4)}</td>
        <td class="num">${horas(f.antes)}</td>
        <td class="num">${horas(f.depois)}</td>
        <td>${f.perdidas ? `${horas(f.perdidas, { sinal: false })} perdidas`
          : f.aDescontar ? `${horas(f.aDescontar, { sinal: false })} a descontar no salário` : 'Dentro dos limites'}</td>
      </tr>`).join('');
  return `
    <section class="band" aria-labelledby="titulo-fechos">
      <h2 id="titulo-fechos">Fechos de mês</h2>
      <p class="intro">No fim de cada mês, o saldo com limites fica entre ${horas(d.regras.limiteNegativo)} e ${horas(d.regras.limitePositivo)}.</p>
      <div class="tabela">
        <table>
          <thead><tr><th>Mês</th><th class="num">Saldo</th><th class="num">Após fecho</th><th>Resultado</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </section>`;
}

function mostrarFuncionario(d, pin) {
  const r = d.resumo;

  app.innerHTML = `
    <section class="band hero">
      <h1>${esc(d.nome)}</h1>
      <p class="lead">O seu saldo de horas, a ${diaLongo(d.hoje)}.</p>
      <div class="actions"><button type="button" class="button sem-seta" data-sair>Sair</button></div>
    </section>

    <section class="band band--surface" aria-labelledby="titulo-saldo">
      <h2 id="titulo-saldo">Saldo</h2>
      ${avisosLimites(r)}
      ${cartoesSaldo(r, d.ferias)}
    </section>

    <section class="band" aria-labelledby="titulo-registar">
      <h2 id="titulo-registar">Registar horas</h2>
      <p class="intro">O seu horário habitual é ${d.horario.entrada}–${d.horario.saida}, com ${horas(d.horario.pausa, { sinal: false })} de pausa.
        Em cada dia, escolha a hora a que entrou e saiu (ou vai entrar e sair). Grava automaticamente.
        Pode fazer até 2 horas a mais ou a menos do que as 8 horas de trabalho.
        Se sair mais tarde, sempre que possível entre mais tarde no dia seguinte.
        Dias completos de ausência e trabalho ao fim de semana ou feriado precisam de aprovação da APJM, que os regista na folha.</p>
      <div class="semanas">${d.semanas.map((s) => semana(s, d)).join('')}</div>
    </section>

    <section class="band band--surface" aria-labelledby="titulo-historico">
      <h2 id="titulo-historico">Histórico</h2>
      ${tabelaHistorico(d)}
    </section>
    ${d.fechos.length ? tabelaFechos(d) : ''}`;

  app.querySelector('[data-sair]').addEventListener('click', () => {
    pinGuardado.apagar(d.id);
    navegar('/');
  });

  const seletores = () => app.querySelectorAll('.dia-campos select');

  app.querySelectorAll('.dia-campos').forEach((campos) => {
    const data = campos.dataset.dia;
    const campo = (nome) => campos.querySelector(`[data-campo="${nome}"]`);
    const iniciais = { entrada: campo('entrada').value, saida: campo('saida').value };

    campos.addEventListener('change', async (e) => {
      const estado = app.querySelector(`[data-estado="${data}"]`);
      estado.classList.remove('dia-estado-erro');
      const entrada = campo('entrada').value;
      const saida = campo('saida').value;

      seletores().forEach((s) => (s.disabled = true));
      estado.textContent = 'A guardar…';
      const minha = visita;
      try {
        const novo = await api(`funcionarios/${d.id}/registos`, { pin, data, entrada, saida });
        if (mudouDePagina(minha)) return; // a gravação conta, mas a pessoa já saiu desta página
        const y = window.scrollY;
        mostrarFuncionario(novo, pin);
        window.scrollTo(0, y);
        app.querySelector(`[data-estado="${data}"]`).textContent = 'Guardado';
        app.querySelector(`.dia-campos[data-dia="${data}"] [data-campo="${e.target.dataset.campo}"]`)?.focus({ preventScroll: true });
      } catch (erro) {
        if (mudouDePagina(minha)) return;
        Object.entries(iniciais).forEach(([nome, valor]) => (campo(nome).value = valor));
        estado.textContent = erro.message;
        estado.classList.add('dia-estado-erro');
        seletores().forEach((s) => (s.disabled = false));
      }
    });
  });
}

atualizarCorDaBarra();
mostrar();
