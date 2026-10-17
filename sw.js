// ERGS Live: lets phones install the page as an app. Always goes to the network, so scores are never stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
