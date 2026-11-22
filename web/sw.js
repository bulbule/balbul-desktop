const APP_SCOPE = self.registration.scope;
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = payload.title || 'balBul Reminder';
  const options = {
    body: payload.body || 'Ada pengingat untuk kamu.',
    icon: new URL('./apple-touch-icon.png', APP_SCOPE).href,
    badge: new URL('./apple-touch-icon.png', APP_SCOPE).href,
    tag: payload.tag || 'balbul-reminder',
    renotify: true,
    data: payload.data || { url: './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || './', APP_SCOPE).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client && client.url.startsWith(APP_SCOPE)) {
        await client.focus();
        if (data.chat) client.postMessage({ type: 'open-chat', chat: data.chat });
        if (data.panel) client.postMessage({ type: 'open-panel', panel: data.panel });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
