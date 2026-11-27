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
  const ocupada = app.querySelector('details.dia-editar[open], dialog[open], form.pin');
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
      'Na app, cada dia útil tem <strong>dois blocos de trabalho</strong>: o da manhã e o da tarde, com a hora de entrada e de saída de cada um, em intervalos de 15 minutos. A pausa é o intervalo entre os dois blocos. Pode registar a semana passada e planear até duas semanas à frente.',
      'Cada dia pode ter <strong>até 7 horas a mais ou a menos</strong> do que as 8 horas (entre 1h e 15h de trabalho).',
      'Se trabalhou fora dos blocos, ou se ausentou durante um bloco, use o <strong>ajuste extraordinário</strong>, em intervalos de 15 minutos. Conta para o mesmo limite de 7 horas por dia.',
      'Em cada dia pode deixar uma <strong>observação</strong> com até 300 caracteres (ex.: o motivo de um ajuste).',
      'O saldo total é atualizado no fim de cada dia. As horas de hoje e dos próximos dias aparecem como planeadas.',
    ]],
    ['Gozo de horas positivas', [
      'Se gozar horas positivas afetar os horários dos períodos não letivos, peça <strong>autorização prévia à APJM</strong>, com antecedência suficiente para organizar uma substituição (art. 4.º).',
      'O pedido deve ter em conta a continuidade do funcionamento e a cobertura dos períodos em causa.',
    ]],
    ['Tirar o dia', [
      'Pode usar 8 horas do saldo flexível para <strong>tirar o dia</strong>, de folga ou de greve, sempre com <strong>aprovação prévia do executivo</strong>.',
      'Na app, use o botão "Tirar o dia" no dia em causa. Antes de confirmar, a app mostra o efeito no saldo e pede que confirme que tem a aprovação prévia.',
      'O dia conta −8h no saldo. Enquanto o dia estiver aberto na app, pode anular e voltar ao horário habitual.',
    ]],
    ['Ausência de dia completo', [
      'Gozar um dia completo com o saldo positivo é excecional, tem de ser justificado e precisa sempre de <strong>aprovação prévia</strong> (art. 5.º).',
      'Podem justificar uma exceção: doença da própria ou de familiares próximos; ter trabalhado um dia completo num fim de semana ou feriado; ou outras situações pessoais excecionais, avaliadas pela APJM.',
      'O trabalho ao fim de semana ou feriado e as ausências que não passem pelo botão "Tirar o dia" são registados pela APJM na folha. Na app aparecem como "Registado pela APJM" e não podem ser alterados.',
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

const MOTIVOS = { folga: 'Folga', greve: 'Greve' };

/** Horas do dia de 15 em 15 minutos, das 6:00 às 23:00 (e a atual, se estiver fora), com "—" para sem bloco. */
function opcoesDeHora(atual, regras) {
  const valores = [];
  for (let m = 6 * 60; m <= 23 * 60; m += regras.passoMinutos) valores.push(m);
  const a = atual ? paraMinutos(atual) : null;
  if (a !== null && !valores.includes(a)) {
    valores.push(a);
    valores.sort((x, y) => x - y);
  }
  return `<option value=""${a === null ? ' selected' : ''}>—</option>`
    + valores.map((m) => `<option value="${paraHora(m)}"${m === a ? ' selected' : ''}>${paraHora(m)}</option>`).join('');
}

/** Ajuste extraordinário: de −7h a +7h, de 15 em 15 minutos. */
function opcoesDeAjuste(atual, regras) {
  const opcoes = [];
  for (let m = -regras.maxMinutosPorDia; m <= regras.maxMinutosPorDia; m += regras.passoMinutos) {
    opcoes.push(`<option value="${m}"${m === atual ? ' selected' : ''}>${m === 0 ? 'Sem ajuste' : horas(m)}</option>`);
  }
  return opcoes.join('');
}

const textoBloco = (b) => (b ? `${b.entrada}–${b.saida}` : '—');

function editorDoDia(dia, d) {
  const longo = diaLongo(dia.data);
  const id = `dia-${dia.data}`;
  const observacao = `
          <label class="campo campo-largo" for="${id}-obs">Observação <small class="contador" data-contador>${dia.observacao.length}/${d.regras.maxCaracteresObservacao}</small></label>
          <textarea id="${id}-obs" data-campo="observacao" maxlength="${d.regras.maxCaracteresObservacao}" rows="2" placeholder="Opcional">${esc(dia.observacao)}</textarea>`;
  if (dia.diaTirado) {
    return `
        <form class="dia-form" data-dia="${dia.data}" data-dia-tirado="${dia.diaTirado}" novalidate>
          <p class="dia-tirado-info">Dia tirado (${MOTIVOS[dia.diaTirado].toLowerCase()}) com 8 horas do saldo flexível.</p>
          ${observacao}
          <div class="dia-acoes">
            <button type="submit" class="button sem-seta">Guardar observação</button>
            <button type="button" class="button button-secundario sem-seta" data-anular>Anular e voltar ao horário habitual</button>
          </div>
        </form>`;
  }
  return `
        <form class="dia-form" data-dia="${dia.data}" novalidate>
          <fieldset class="bloco">
            <legend>Manhã</legend>
            <select data-campo="manha-entrada" aria-label="Entrada da manhã em ${longo}">${opcoesDeHora(dia.manha?.entrada, d.regras)}</select>
            <span aria-hidden="true">–</span>
            <select data-campo="manha-saida" aria-label="Saída da manhã em ${longo}">${opcoesDeHora(dia.manha?.saida, d.regras)}</select>
          </fieldset>
          <fieldset class="bloco">
            <legend>Tarde</legend>
            <select data-campo="tarde-entrada" aria-label="Entrada da tarde em ${longo}">${opcoesDeHora(dia.tarde?.entrada, d.regras)}</select>
            <span aria-hidden="true">–</span>
            <select data-campo="tarde-saida" aria-label="Saída da tarde em ${longo}">${opcoesDeHora(dia.tarde?.saida, d.regras)}</select>
          </fieldset>
          <div class="bloco bloco-ajuste">
            <label class="campo" for="${id}-ajuste">Ajuste extraordinário</label>
            <select id="${id}-ajuste" data-campo="ajuste">${opcoesDeAjuste(dia.ajuste, d.regras)}</select>
          </div>
          ${observacao}
          <p class="dia-calculo" data-calculo aria-live="polite"></p>
          <div class="dia-acoes">
            <button type="submit" class="button sem-seta">Guardar</button>
            <button type="button" class="button button-secundario sem-seta" data-tirar-dia>Tirar o dia</button>
          </div>
        </form>`;
}

const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Célula de um bloco na tabela da semana: entrada e saída em colunas separadas. */
function celulaBloco(nome, b) {
  const rotulo = `<span class="visually-hidden">${nome}: </span>`;
  if (!b) return `<span class="c c-bloco c-${nome.toLowerCase()}">${rotulo}<span class="c-vazio">—</span></span>`;
  return `<span class="c c-bloco c-${nome.toLowerCase()}">${rotulo}<span>${b.entrada}</span><span class="visually-hidden"> a </span><span>${b.saida}</span></span>`;
}

/** Cabeçalho da tabela da semana (os leitores de ecrã leem os rótulos escondidos em cada célula). */
const CABECALHO_SEMANA = `
      <div class="linha linha-cab" aria-hidden="true">
        <span class="c c-dia">Dia</span>
        <span class="c c-bloco c-manha"><span class="c-bloco-nome">Manhã</span><span>Entrada</span><span>Saída</span></span>
        <span class="c c-bloco c-tarde"><span class="c-bloco-nome">Tarde</span><span>Entrada</span><span>Saída</span></span>
        <span class="c c-ajuste">Ajuste</span>
        <span class="c c-trabalho">Trabalho</span>
        <span class="c c-balanco">Balanço</span>
        <span class="c c-obs">Observação</span>
      </div>`;

/** Uma linha da tabela da semana: o dia, os dois blocos, o ajuste, o trabalho, o balanço e a observação. */
function linhaDoDia(dia, d, quando) {
  const data = paraDate(dia.data);
  const etiquetas = [
    quando === 'hoje' ? '<span class="etiqueta etiqueta-suave">hoje</span>' : '',
    dia.apjm ? '<span class="etiqueta etiqueta-suave">APJM</span>' : '',
  ].join('');
  const celulaDia = `<span class="c c-dia"><b>${DIAS_DA_SEMANA[data.getUTCDay()]}</b> ${data.getUTCDate()} ${MESES[data.getUTCMonth()]}${etiquetas}</span>`;
  const balanco = (texto) => `<span class="c c-balanco"><span class="visually-hidden">Balanço: </span>${texto}</span>`;
  const obs = dia.observacao ? `<span class="c c-obs"><span class="visually-hidden">Observação: </span>${esc(dia.observacao)}</span>` : '';
  const especial = (texto) => `<span class="c c-especial">${texto}</span>`;

  if (dia.ferias) return celulaDia + especial('Férias') + balanco('—') + obs;
  if (dia.feriado) {
    const nome = dia.nomeFeriado ? ` · ${esc(dia.nomeFeriado)}` : '';
    const apjm = dia.minutos ? ` · ${horas(dia.minutos, { sinal: false })} registadas pela APJM` : '';
    return celulaDia + especial(`Feriado${nome}${apjm}`) + balanco(dia.minutos ? horas(dia.minutos) : '—') + obs;
  }
  if (dia.diaTirado) {
    return celulaDia + especial(`<b>${MOTIVOS[dia.diaTirado]}</b> · dia tirado com 8h do saldo`) + balanco(`<b>${horas(dia.minutos)}</b>`) + obs;
  }
  if (dia.apjm && !(dia.registado && dia.minutos > -d.regras.minutosPorDia)) {
    return celulaDia + especial('Ausência registada pela APJM') + balanco(`<b>${horas(dia.minutos)}</b>`) + obs;
  }
  const blocos = dia.entrada && !dia.manha && !dia.tarde
    ? especial(`${dia.entrada}–${dia.saida} <small>registo antigo</small>`)
    : celulaBloco('Manhã', dia.manha) + celulaBloco('Tarde', dia.tarde)
      + `<span class="c c-ajuste${dia.ajuste ? '' : ' c-zero'}"><span class="c-rotulo">Ajuste </span>${dia.ajuste ? horas(dia.ajuste) : '—'}</span>`
      + `<span class="c c-trabalho"><span class="visually-hidden">Trabalho: </span>${horas(d.regras.minutosPorDia + dia.minutos, { sinal: false })}</span>`;
  return celulaDia + blocos + balanco(`<b>${horas(dia.minutos)}</b>`) + obs;
}

function semana(s, d) {
  const total = s.dias.reduce((t, dia) => t + dia.minutos, 0);
  const dias = s.dias.map((dia) => {
    const quando = dia.data < d.hoje ? 'passado' : dia.data === d.hoje ? 'hoje' : 'futuro';
    const inativo = dia.feriado || dia.ferias;
    const classes = `dia dia-${quando}${inativo ? ' dia-inativo' : ''}${dia.diaTirado ? ' dia-tirado' : ''}`;
    const estado = `<span class="dia-estado" data-estado="${dia.data}" aria-live="polite"></span>`;
    if (dia.editavel) {
      return `
      <li class="${classes}">
        <details class="dia-editar" data-dia="${dia.data}">
          <summary class="linha">${linhaDoDia(dia, d, quando)}<span class="c-seta" aria-hidden="true">›</span></summary>
          ${editorDoDia(dia, d)}
        </details>
        ${estado}
      </li>`;
    }
    return `
      <li class="${classes}"${inativo ? ' aria-disabled="true"' : ''}>
        <div class="linha">${linhaDoDia(dia, d, quando)}</div>
        ${estado}
      </li>`;
  }).join('');

  return `
    <section class="semana cartao${s.atual ? ' semana-atual' : ''}">
      <h3>Semana de ${formatar(s.segunda, { day: 'numeric', month: 'long' })}${s.atual ? ' <span class="etiqueta etiqueta-suave">esta semana</span>' : ''}</h3>
      <div class="semana-tabela">
        ${CABECALHO_SEMANA}
        <ul>${dias}</ul>
        <p class="linha linha-total"><span class="c c-total-rotulo">Total da semana</span><span class="c c-balanco"><strong>${horas(total)}</strong></span></p>
      </div>
    </section>`;
}

function horarioNoHistorico(h) {
  if (h.manha || h.tarde) {
    const blocos = [h.manha, h.tarde].filter(Boolean).map(textoBloco).join('<br>');
    return h.ajuste ? `${blocos}<br>ajuste ${horas(h.ajuste)}` : blocos;
  }
  return h.entrada ? `${h.entrada}–${h.saida}` : '—';
}

function tabelaHistorico(d) {
  if (!d.historico.length) return '<p>Ainda não há horas registadas.</p>';
  const estados = { confirmado: 'Confirmado', hoje: 'Hoje', planeado: 'Planeado' };
  const linhas = d.historico.map((h) => {
    const textos = [...h.notas, h.observacao].filter(Boolean);
    const notas = textos.length ? `<small>${esc(textos.join(' · '))}</small>` : '';
    if (h.diaTirado) {
      return `
      <tr>
        <td>${diaCurto(h.data)}${notas}</td>
        <td class="num">—<small>Dia tirado</small></td>
        <td class="num">${horas(h.minutos)}</td>
        <td>${MOTIVOS[h.diaTirado]}<small>${estados[h.estado]}</small></td>
      </tr>`;
    }
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
        <td class="num">${horarioNoHistorico(h)}<small>${horas(h.trabalhados, { sinal: false })} trabalhadas</small></td>
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

/** Lê o formulário de um dia: os dois blocos, o ajuste e a observação. */
function lerFormulario(form) {
  const valor = (campo) => form.querySelector(`[data-campo="${campo}"]`)?.value ?? '';
  return {
    manha: { entrada: valor('manha-entrada'), saida: valor('manha-saida') },
    tarde: { entrada: valor('tarde-entrada'), saida: valor('tarde-saida') },
    ajuste: Number(valor('ajuste') || 0),
    observacao: valor('observacao'),
  };
}

/** Total de trabalho e balanço do dia, calculados no browser enquanto a pessoa escolhe as horas. */
function calcularNoFormulario(form, regras) {
  const { manha, tarde, ajuste } = lerFormulario(form);
  let trabalho = ajuste;
  for (const [nome, b] of [['da manhã', manha], ['da tarde', tarde]]) {
    if (!b.entrada && !b.saida) continue;
    if (!b.entrada || !b.saida) return { erro: `Escolha a entrada e a saída ${nome}.` };
    const duracao = paraMinutos(b.saida) - paraMinutos(b.entrada);
    if (duracao <= 0) return { erro: `A saída ${nome} tem de ser depois da entrada.` };
    trabalho += duracao;
  }
  if (manha.saida && tarde.entrada && paraMinutos(tarde.entrada) < paraMinutos(manha.saida)) {
    return { erro: 'O bloco da tarde tem de começar depois de acabar o da manhã.' };
  }
  const balanco = trabalho - regras.minutosPorDia;
  if (Math.abs(balanco) > regras.maxMinutosPorDia) {
    return { erro: `${horas(trabalho, { sinal: false })} de trabalho: o balanço (${horas(balanco)}) passa o limite de ${horas(regras.maxMinutosPorDia, { sinal: false })} por dia. Para não trabalhar o dia inteiro, use "Tirar o dia".` };
  }
  return { texto: `${horas(trabalho, { sinal: false })} de trabalho · balanço <b>${horas(balanco)}</b>` };
}

/**
 * Janela de confirmação de "Tirar o dia": mostra o efeito no saldo e a necessidade de aprovação
 * prévia do executivo. Devolve "folga" ou "greve", ou null se a pessoa cancelar.
 */
function confirmarTirarDia(d, dia) {
  const saldoDepois = d.resumo.saldoPrevisto - dia.minutos - d.regras.minutosPorDia;
  const dialogo = document.createElement('dialog');
  dialogo.className = 'dialogo cartao';
  dialogo.setAttribute('aria-labelledby', 'dialogo-titulo');
  dialogo.innerHTML = `
    <form method="dialog" class="dialogo-form">
      <h2 id="dialogo-titulo">Tirar o dia</h2>
      <p>Vai tirar <strong>${diaLongo(dia.data)}</strong> usando <strong>${horas(d.regras.minutosPorDia, { sinal: false })} do seu saldo flexível</strong>.</p>
      <ul class="lista">
        <li>O dia conta <strong>${horas(-d.regras.minutosPorDia)}</strong> no saldo${dia.minutos ? `, em vez de ${horas(dia.minutos)}` : ''}.</li>
        <li>Saldo total com as horas planeadas: <strong>${horas(d.resumo.saldoPrevisto)}</strong> → <strong>${horas(saldoDepois)}</strong>.</li>
        <li>Só pode tirar o dia (de folga ou de greve) com <strong>aprovação prévia do executivo</strong>.</li>
        <li>Enquanto o dia estiver aberto na app, pode anular e voltar ao horário habitual.</li>
      </ul>
      <fieldset class="dialogo-motivo">
        <legend>Motivo</legend>
        <label><input type="radio" name="motivo" value="folga" checked> Folga</label>
        <label><input type="radio" name="motivo" value="greve"> Greve</label>
      </fieldset>
      <label class="dialogo-confirmo"><input type="checkbox" name="confirmo"> Confirmo que tenho aprovação prévia do executivo para tirar este dia.</label>
      <div class="dia-acoes">
        <button type="submit" class="button sem-seta" value="confirmar" disabled>Tirar o dia</button>
        <button type="submit" class="button button-secundario sem-seta" value="cancelar" formnovalidate>Cancelar</button>
      </div>
    </form>`;
  document.body.append(dialogo);
  const form = dialogo.querySelector('form');
  const confirmar = form.querySelector('[value="confirmar"]');
  form.confirmo.addEventListener('change', () => (confirmar.disabled = !form.confirmo.checked));
  return new Promise((resolver) => {
    dialogo.addEventListener('close', () => {
      const ok = dialogo.returnValue === 'confirmar' && form.confirmo.checked;
      const motivo = form.motivo.value;
      dialogo.remove();
      resolver(ok ? motivo : null);
    });
    dialogo.showModal();
  });
}

function mostrarFuncionario(d, pin) {
  const r = d.resumo;
  const h = d.horario;

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
      <p class="intro">O seu horário habitual é ${textoBloco(h.manha)} de manhã e ${textoBloco(h.tarde)} à tarde.
        Toque num dia para escolher a hora de entrada e de saída de cada bloco (a que entrou e saiu, ou vai entrar e sair) e carregue em <strong>Guardar</strong>.
        Pode fazer até ${horas(d.regras.maxMinutosPorDia, { sinal: false })} a mais ou a menos do que as 8 horas de trabalho.
        Use o <strong>ajuste extraordinário</strong> para trabalho fora dos blocos ou ausências curtas, e a <strong>observação</strong> para explicar.
        Com aprovação prévia do executivo, pode <strong>tirar o dia</strong> (folga ou greve) com 8 horas do saldo.
        Trabalho ao fim de semana ou feriado precisa de aprovação da APJM, que o regista na folha.</p>
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

  const diasPorData = new Map(d.semanas.flatMap((s) => s.dias).map((dia) => [dia.data, dia]));
  const botoes = () => app.querySelectorAll('.dia-form button');

  /** Envia um dia para a folha e volta a mostrar a página, com o dia gravado assinalado. */
  async function gravar(data, corpo, form) {
    const estado = app.querySelector(`[data-estado="${data}"]`);
    estado.classList.remove('dia-estado-erro');
    estado.textContent = 'A guardar…';
    botoes().forEach((b) => (b.disabled = true));
    const minha = visita;
    try {
      const novo = await api(`funcionarios/${d.id}/registos`, { pin, data, ...corpo });
      if (mudouDePagina(minha)) return; // a gravação conta, mas a pessoa já saiu desta página
      const y = window.scrollY;
      mostrarFuncionario(novo, pin);
      window.scrollTo(0, y);
      app.querySelector(`[data-estado="${data}"]`).textContent = 'Guardado';
      app.querySelector(`details[data-dia="${data}"] summary`)?.focus({ preventScroll: true });
    } catch (erro) {
      if (mudouDePagina(minha)) return;
      estado.textContent = erro.message;
      estado.classList.add('dia-estado-erro');
      botoes().forEach((b) => (b.disabled = false));
      form?.querySelector('[data-calculo]') && atualizarCalculo(form);
    }
  }

  function atualizarCalculo(form) {
    const saida = form.querySelector('[data-calculo]');
    if (!saida) return;
    const { erro, texto } = calcularNoFormulario(form, d.regras);
    saida.innerHTML = erro ? esc(erro) : texto;
    saida.classList.toggle('dia-estado-erro', Boolean(erro));
    form.querySelector('[type="submit"]').disabled = Boolean(erro);
  }

  app.querySelectorAll('.dia-form').forEach((form) => {
    const data = form.dataset.dia;
    const dia = diasPorData.get(data);
    atualizarCalculo(form);
    form.addEventListener('change', () => atualizarCalculo(form));

    const textarea = form.querySelector('[data-campo="observacao"]');
    const contador = form.querySelector('[data-contador]');
    textarea.addEventListener('input', () => (contador.textContent = `${textarea.value.length}/${d.regras.maxCaracteresObservacao}`));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const corpo = lerFormulario(form);
      // Num dia tirado só se altera a observação (o dia continua tirado)
      if (form.dataset.diaTirado) return gravar(data, { tirarDia: form.dataset.diaTirado, observacao: corpo.observacao }, form);
      gravar(data, corpo, form);
    });

    form.querySelector('[data-tirar-dia]')?.addEventListener('click', async () => {
      const motivo = await confirmarTirarDia(d, dia);
      if (motivo) gravar(data, { tirarDia: motivo, observacao: textarea.value }, form);
    });

    form.querySelector('[data-anular]')?.addEventListener('click', () => {
      // Volta ao horário habitual, sem ajuste, e mantém a observação
      const bloco = (b) => b ?? { entrada: '', saida: '' };
      gravar(data, { manha: bloco(d.horario.manha), tarde: bloco(d.horario.tarde), ajuste: 0, observacao: textarea.value }, form);
    });
  });
}

atualizarCorDaBarra();
mostrar();
