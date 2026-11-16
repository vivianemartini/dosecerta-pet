// Service worker mínimo: permite instalar o app na tela inicial.
// Não guarda cache, para ninguém ficar com versão antiga dos dados.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
