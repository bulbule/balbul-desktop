(function exposeShareCard(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BalbulShareCard = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function makeShareCardApi() {
  'use strict';
  const PREFIX = 'BALBUL_SHARE_V1:';
  const MAX_MESSAGE_LENGTH = 3900;
  const URL_PATTERN = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/d\/[a-f0-9]{32}$/i;
  const QR_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

  function normalize(input) {
    if (!input || typeof input !== 'object') return null;
    const url = typeof input.url === 'string' ? input.url : '';
    const qr = typeof input.qr === 'string' ? input.qr : '';
    const size = Number(input.size);
    const expiresAt = Number(input.expiresAt);
    if (!URL_PATTERN.test(url) || qr.length > 8192 || !QR_PATTERN.test(qr)) return null;
    if (!Number.isSafeInteger(size) || size <= 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) return null;
    const name = String(input.name || '').replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 120) || 'File';
    const sender = String(input.sender || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80) || 'Teman';
    return { version: 1, sender, name, size, url, qr, expiresAt };
  }

  function encode(input) {
    const value = normalize(input);
    if (!value) throw new TypeError('Data Share tidak valid');
    const body = PREFIX + JSON.stringify(value);
    if (body.length > MAX_MESSAGE_LENGTH) throw new RangeError('Kartu Share terlalu besar untuk dikirim');
    return body;
  }

  function parse(body) {
    if (typeof body !== 'string' || body.length > 4000 || !body.startsWith(PREFIX)) return null;
    try {
      const data = JSON.parse(body.slice(PREFIX.length));
      if (data.version !== 1) return null;
      return normalize(data);
    } catch (_) { return null; }
  }

  function links(text) {
    if (typeof text !== 'string') return [];
    const found = [];
    const pattern = /https?:\/\/[^\s<>"']+/gi;
    for (const match of text.matchAll(pattern)) {
      let url = match[0];
      while (/[.,!?;:)]$/.test(url)) url = url.slice(0, -1);
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) continue;
        found.push({ url, start: match.index, end: match.index + url.length, host: parsed.hostname });
      } catch (_) { /* skip malformed URL */ }
    }
    return found;
  }

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} KB`;
    return `${(bytes / (1024 * 1024)).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;
  }

  return { PREFIX, URL_PATTERN, normalize, encode, parse, links, formatSize };
}));
