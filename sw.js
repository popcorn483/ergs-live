// ERGS Live: lets phones install the page as an app. Always goes to the network, so scores are never stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// only page loads go through here (always fresh from the network); scores and everything else are untouched
self.addEventListener('fetch', e => { if (e.request.mode !== 'navigate') return; e.respondWith(fetch(e.request).catch(() => new Response('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="font:16px system-ui;background:#0F1530;color:#F1F0EC;display:grid;place-items:center;min-height:90vh;text-align:center"><div><h1>ERGS Live</h1><p>No connection. Live scores will appear when you are back online.</p></div>', {headers:{'Content-Type':'text/html'}}))); });

// kick-off reminders for coaches: show the notification, and open the match when it is pressed
self.addEventListener('push', e => { let d = {}; try { d = e.data ? e.data.json() : {}; } catch(x){}
  e.waitUntil(self.registration.showNotification(d.title || 'ERGS Live', {body:d.body || '', icon:'icons/icon-192.png', badge:'icons/icon-192.png', tag:d.tag || 'ergs-kickoff', renotify:true, requireInteraction:true, data:{url:d.url || './'}})); });
self.addEventListener('notificationclick', e => { e.notification.close(); const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(list => { const c = list.find(x => x.url.startsWith(self.registration.scope) && !/\/app\//.test(x.url)); if (c && c.navigate) return c.navigate(url).then(w => (w || c).focus()).catch(() => self.clients.openWindow(url)); return self.clients.openWindow(url); })); });
