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
const sexta = (data) => `sexta, ${formatar(data, { day: 'numeric', month: 'short' }).replace(/\./g, '')}`;

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
  const ocupada = app.querySelector('select[data-dia]:disabled, form.pin');
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

function cartoesSaldo(r) {
  return `
    <dl class="saldos">
      <div class="saldo saldo-total cartao">
        <dt>Saldo total</dt>
        <dd><strong>${horas(r.saldoTotal)}</strong><span>${explicar(r.saldoTotal)}</span></dd>
      </div>
      <div class="saldo cartao">
        <dt>A compensar até ${sexta(r.semanaCorrente.ate)}</dt>
        <dd><strong>${horas(r.semanaCorrente.minutos)}</strong><span>${explicar(r.semanaCorrente.minutos)}</span></dd>
      </div>
      <div class="saldo cartao">
        <dt>A compensar até ${sexta(r.semanaSeguinte.ate)}</dt>
        <dd><strong>${horas(r.semanaSeguinte.minutos)}</strong><span>${explicar(r.semanaSeguinte.minutos)}</span></dd>
      </div>
    </dl>`;
}

function avisoIncumprimento(r) {
  if (!r.emIncumprimento) return '';
  const itens = r.emAtraso
    .map((p) => `<li>${horas(p.minutos)} de ${diaLongo(p.data)}, a compensar até ${diaLongo(p.prazo)}</li>`)
    .join('');
  return `
    <div class="aviso aviso-erro" role="alert">
      <p><strong>Em incumprimento.</strong> Estas horas não foram compensadas a tempo:</p>
      <ul>${itens}</ul>
      <p>Compense-as o mais depressa possível.</p>
    </div>`;
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
        <span class="pessoa-nome">${esc(nome)}${r.emIncumprimento ? ' <span class="etiqueta">Em incumprimento</span>' : ''}</span>
        <span class="pessoa-valor"><small>Saldo total</small>${horas(r.saldoTotal)}</span>
        <span class="pessoa-valor"><small>Até ${sexta(r.semanaCorrente.ate)}</small>${horas(r.semanaCorrente.minutos)}</span>
        <span class="pessoa-valor"><small>Até ${sexta(r.semanaSeguinte.ate)}</small>${horas(r.semanaSeguinte.minutos)}</span>
      </a>
    </li>`).join('');

  app.innerHTML = `
    <section class="band hero">
      <h1>Equipa</h1>
      <p class="lead">Hoje é ${diaLongo(dados.hoje)}.</p>
    </section>
    <section class="band band--surface" aria-labelledby="titulo-saldos">
      <h2 id="titulo-saldos">Saldos</h2>
      <p class="intro">Valores positivos são horas a mais; negativos, horas em falta. Escolha o seu nome para registar horas.</p>
      ${dados.funcionarios.length ? `<ul class="equipa">${linhas}</ul>` : '<p>Ainda não há funcionários na folha.</p>'}
    </section>`;
}

// ---------------------------------------------------------------- página: regras

function paginaRegras() {
  document.title = 'Regras · Horas';
  app.innerHTML = `
    <section class="band hero">
      <h1>Regras</h1>
      <p class="lead">Como funciona a gestão e compensação das horas de trabalho.</p>
    </section>
    <section class="band band--surface" aria-labelledby="regra-1">
      <h2 id="regra-1">Horário</h2>
      <div class="prose">
        <ul class="lista">
        <li>O horário de trabalho é de segunda a sexta-feira, com 8 horas por dia.</li>
        <li>Os feriados indicados na folha não contam como dias úteis.</li>
        </ul>
      </div>
    </section>
    <section class="band" aria-labelledby="regra-2">
      <h2 id="regra-2">Acrescentar ou retirar horas</h2>
      <div class="prose">
        <ul class="lista">
        <li>Em cada dia útil pode trabalhar mais ou menos do que as 8 horas. A diferença conta para o seu balanço.</li>
        <li>O balanço não pode mudar mais de <strong>2 horas por dia</strong>, para mais ou para menos (entre 6h e 10h de trabalho).</li>
        <li>As horas registam-se em intervalos de 15 minutos.</li>
        <li>Pode registar a semana passada e planear até duas semanas à frente.</li>
        <li>O saldo total é atualizado no fim de cada dia útil. As horas de hoje e dos próximos dias aparecem como planeadas.</li>
        </ul>
      </div>
    </section>
    <section class="band band--surface" aria-labelledby="regra-3">
      <h2 id="regra-3">Compensação</h2>
      <div class="prose">
        <ul class="lista">
        <li>As horas acrescentadas ou retiradas têm de ser compensadas nos <strong>5 dias úteis seguintes</strong>.</li>
        <li>Exemplo: se trabalhar mais 2 horas numa quarta-feira, tem de trabalhar menos 2 horas até à quarta-feira da semana seguinte.</li>
        <li>Pode compensar em qualquer combinação de dias e horas, desde que o total fique compensado dentro do prazo.</li>
        <li>As compensações abatem primeiro as horas mais antigas.</li>
        <li>Se o prazo terminar sem as horas compensadas, a app mostra que está <strong>em incumprimento</strong> até as compensar.</li>
        <li>Cada pessoa é responsável por manter o seu balanço a zero no fim de cada semana.</li>
        </ul>
      </div>
    </section>
    <section class="band" aria-labelledby="regra-4">
      <h2 id="regra-4">Saldo transitado</h2>
      <div class="prose">
        <ul class="lista">
        <li>O saldo que já existia antes da app (por exemplo, horas acumuladas) não tem prazo de compensação.</li>
        <li>Vai sendo reduzido sempre que regista horas no sentido contrário e não há outras horas por compensar.</li>
        </ul>
      </div>
    </section>
    <section class="band band--surface" aria-labelledby="regra-5">
      <h2 id="regra-5">O que significam os valores</h2>
      <div class="prose">
        <ul class="lista">
        <li><strong>Saldo total:</strong> todas as horas a mais (+) ou em falta (−), incluindo o saldo transitado.</li>
        <li><strong>A compensar até sexta:</strong> horas cujo prazo termina até ao fim da semana corrente ou da seguinte, já contando com as horas que planeou.</li>
        </ul>
      </div>
    </section>`;
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

function opcoesDoDia(minutos, regras) {
  const opcoes = [];
  for (let m = -regras.maxMinutosPorDia; m <= regras.maxMinutosPorDia; m += regras.passoMinutos) {
    opcoes.push(`<option value="${m}"${m === minutos ? ' selected' : ''}>${horas(m)}</option>`);
  }
  return opcoes.join('');
}

function semana(s, d) {
  const total = s.dias.reduce((t, dia) => t + dia.minutos, 0);
  const dias = s.dias.map((dia) => {
    const quando = dia.data < d.hoje ? 'passado' : dia.data === d.hoje ? 'hoje' : 'futuro';
    let valor;
    if (dia.feriado) valor = '<span class="dia-nota">Feriado</span>';
    else if (dia.editavel) {
      valor = `<select data-dia="${dia.data}" aria-label="Horas em ${diaLongo(dia.data)}">${opcoesDoDia(dia.minutos, d.regras)}</select>`;
    } else valor = `<span>${horas(dia.minutos)}</span>`;
    return `
      <li class="dia dia-${quando}">
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
    let compensacao = '';
    if (h.porCompensar) {
      compensacao = `${horas(h.porCompensar)} por compensar até ${diaCurto(h.prazo)}`;
    } else if (h.atrasado) {
      compensacao = 'Compensação planeada fora do prazo';
    }
    return `
      <tr${h.atrasado ? ' class="atrasado"' : ''}>
        <td>${diaCurto(h.data)}${h.notas.length ? `<small>${esc(h.notas.join(' · '))}</small>` : ''}</td>
        <td class="num">${horas(h.minutos)}</td>
        <td class="num">${horas(h.trabalhados, { sinal: false })}</td>
        <td>${estados[h.estado]}${compensacao ? `<small>${compensacao}</small>` : ''}</td>
      </tr>`;
  }).join('');
  return `
    <div class="tabela">
      <table>
        <thead><tr><th>Dia</th><th class="num">Balanço</th><th class="num">Trabalhadas</th><th>Estado</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>`;
}

function mostrarFuncionario(d, pin) {
  const r = d.resumo;
  const notas = [];
  if (r.saldoTransitado) notas.push(`Inclui ${horas(r.saldoTransitado)} de saldo transitado, sem prazo de compensação.`);
  if (r.saldoPrevisto !== r.saldoTotal) notas.push(`Com as horas de hoje e as planeadas, o saldo fica em ${horas(r.saldoPrevisto)}.`);

  app.innerHTML = `
    <section class="band hero">
      <h1>${esc(d.nome)}</h1>
      <p class="lead">${r.emIncumprimento ? 'Tem horas por compensar fora do prazo.' : `O seu balanço de horas, a ${diaLongo(d.hoje)}.`}</p>
      <div class="actions"><button type="button" class="button sem-seta" data-sair>Sair</button></div>
    </section>

    <section class="band band--surface" aria-labelledby="titulo-saldo">
      <h2 id="titulo-saldo">Saldo</h2>
      ${avisoIncumprimento(r)}
      ${cartoesSaldo(r)}
      ${notas.map((n) => `<p class="nota">${n}</p>`).join('')}
    </section>

    <section class="band" aria-labelledby="titulo-registar">
      <h2 id="titulo-registar">Registar horas</h2>
      <p class="intro">Escolha quanto trabalhou (ou vai trabalhar) a mais ou a menos em cada dia. Grava automaticamente.</p>
      <div class="semanas">${d.semanas.map((s) => semana(s, d)).join('')}</div>
    </section>

    <section class="band band--surface" aria-labelledby="titulo-historico">
      <h2 id="titulo-historico">Histórico</h2>
      ${tabelaHistorico(d)}
    </section>`;

  app.querySelector('[data-sair]').addEventListener('click', () => {
    pinGuardado.apagar(d.id);
    navegar('/');
  });

  app.querySelectorAll('select[data-dia]').forEach((select) => {
    select.addEventListener('change', async () => {
      const data = select.dataset.dia;
      const estado = app.querySelector(`[data-estado="${data}"]`);
      const anterior = select.querySelector('option[selected]')?.value ?? '0';
      app.querySelectorAll('select[data-dia]').forEach((s) => (s.disabled = true));
      estado.textContent = 'A guardar…';
      const minha = visita;
      try {
        const novo = await api(`funcionarios/${d.id}/registos`, { pin, data, horas: Number(select.value) / 60 });
        if (mudouDePagina(minha)) return; // a gravação conta, mas a pessoa já saiu desta página
        const y = window.scrollY;
        mostrarFuncionario(novo, pin);
        window.scrollTo(0, y);
        app.querySelector(`[data-estado="${data}"]`).textContent = 'Guardado';
        app.querySelector(`select[data-dia="${data}"]`)?.focus({ preventScroll: true });
      } catch (erro) {
        if (mudouDePagina(minha)) return;
        select.value = anterior;
        estado.textContent = erro.message;
        estado.classList.add('dia-estado-erro');
        app.querySelectorAll('select[data-dia]').forEach((s) => (s.disabled = false));
      }
    });
  });
}

atualizarCorDaBarra();
mostrar();
