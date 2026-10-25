// Service worker da app instalada no ecrã principal.
// Rede primeiro, sempre: com ligação vê-se sempre a versão mais recente.
// Sem ligação, a app abre a partir da cópia guardada e mostra uma mensagem em vez da página de erro do browser.
// Os pedidos à API nunca são guardados: os saldos vêm sempre da folha.

const CACHE = 'horas-v1';
const ESSENCIAIS = [
  '/',
  '/app.js',
  '/styles.css',
  '/jm/design-system/tokens.css',
  '/jm/novo/site.css',
  '/jm/novo/themes.css',
  '/jm/novo/theme-switcher.js',
  '/jm/design-system/logo/jardim-da-mata-mark.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ESSENCIAIS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const pedido = e.request;
  const url = new URL(pedido.url);
  if (pedido.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/manifest.webmanifest') return;

  e.respondWith(
    fetch(pedido)
      .then((resposta) => {
        if (resposta.ok) {
          // Todas as páginas são o mesmo index.html, guardado como "/"
          const chave = pedido.mode === 'navigate' ? '/' : pedido;
          const copia = resposta.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(chave, copia)));
        }
        return resposta;
      })
      .catch(async () => {
        if (pedido.mode === 'navigate') return caches.match('/');
        return (await caches.match(pedido)) ?? Response.error();
      }),
  );
});
