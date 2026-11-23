const APP_SCOPE = self.registration.scope;
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = payload.title || 'balBul Reminder';
  const rawData = payload.data || {};
  // Support both chat and reminder payload formats from the push sender.
  const chatId = rawData.chat || rawData.conversation_id || rawData.conversationId ||
    payload.chat || payload.conversation_id || payload.conversationId || null;
  const panel = rawData.panel || payload.panel || (chatId ? 'chats' : null);
  const fallbackUrl = chatId
    ? './?panel=chats&chat=' + encodeURIComponent(chatId)
    : (panel ? './?panel=' + encodeURIComponent(panel) : './');
  const options = {
    body: payload.body || 'Ada pengingat untuk kamu.',
    icon: new URL('./apple-touch-icon.png', APP_SCOPE).href,
    badge: new URL('./apple-touch-icon.png', APP_SCOPE).href,
    tag: payload.tag || (chatId ? 'balbul-chat-' + chatId : 'balbul-reminder'),
    renotify: true,
    data: { ...rawData, chat: chatId, panel, url: rawData.url || fallbackUrl }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const chat = data.chat || data.conversation_id || data.conversationId || null;
  const panel = data.panel || (chat ? 'chats' : null);
  const targetUrl = chat
    ? './?panel=chats&chat=' + encodeURIComponent(chat)
    : (panel ? './?panel=' + encodeURIComponent(panel) : (data.url || './'));
  const target = new URL(targetUrl, APP_SCOPE).href;
  event.waitUntil((async () => {
    const clickData = { chat, panel, t: Date.now() };
    try { const c = await caches.open('balbul-click'); await c.put('click', new Response(JSON.stringify(clickData))); } catch (_) {}
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client && client.url.startsWith(APP_SCOPE)) {
        await client.focus();
        client.postMessage(chat
          ? { type: 'open-chat', chat }
          : { type: 'open-panel', panel });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
