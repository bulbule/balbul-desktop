'use strict';

const { createServer } = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const QRCode = require('qrcode');

const SHARE_TTL_MS = 10 * 60 * 1000;
const TUNNEL_TIMEOUT_MS = 15 * 1000;
const MAX_BAD_REQUESTS = 30;
const BAD_REQUEST_WINDOW_MS = 60 * 1000;
const MAX_ACTIVE_GRACE_MS = 2 * 60 * 1000;
const INVALID_RESPONSE = Buffer.from('Not found');
const MAX_RECEIVE_BYTES = 95 * 1024 * 1024;
const MAX_RECEIVE_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_RECEIVE_FILES = 20;

function safeName(name) {
  return String(name).replace(/[\\/\x00-\x1f\x7f]/g, '_').replace(/^\.+$/, 'file').slice(0, 180) || 'file';
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.zip': 'application/zip', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.json': 'application/json; charset=utf-8',
  })[ext] || 'application/octet-stream';
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return false;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return false;
  return { start, end: Math.min(end, size - 1) };
}

class ShareService {
  constructor({ app, onEvent, log = () => {}, logoPath = '' }) {
    this.app = app;
    this.onEvent = onEvent;
    this.log = log;
    this.logoPath = logoPath;
    this.session = null;
    this.starting = false;
    this.generation = 0;
    this.stopping = Promise.resolve();
  }

  get active() { return !!this.session || this.starting; }

  emit(type, payload = {}) {
    try { this.onEvent(type, payload); } catch (_) { /* closing window */ }
  }

  binaryPath() {
    const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
    if (!arch) throw new Error('unsupported-platform');
    const platform = process.platform === 'win32' ? 'win-x64' : process.platform === 'darwin' ? `mac-${arch}` : null;
    if (!platform) throw new Error('unsupported-platform');
    const filename = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    const root = this.app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'resources');
    const binary = path.join(root, 'cloudflared', platform, filename);
    if (!fs.existsSync(binary)) throw new Error('binary-missing');
    return binary;
  }

  async validate(filePath) {
    if (typeof filePath !== 'string' || !filePath || filePath.length > 32768) throw new Error('bad-path');
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) throw new Error('folder');
    if (!stat.isFile()) throw new Error('bad-file');
    if (!stat.size) throw new Error('empty');
    await fs.promises.access(filePath, fs.constants.R_OK);
    const handle = await fs.promises.open(filePath, 'r');
    await handle.close();
    return { path: filePath, name: safeName(path.basename(filePath)), size: stat.size };
  }

  async start(filePath) {
    await this.stop('replaced', false);
    const generation = ++this.generation;
    this.starting = true;
    let file;
    try {
      file = await this.validate(filePath);
      if (generation !== this.generation) return { ok: false, code: 'stopped' };
      const server = createServer();
      const session = {
        mode: 'download', file, server, child: null, token: crypto.randomBytes(16).toString('hex'),
        startedAt: null, expiresAt: null,
        badRequests: [], activeDownloads: 0, expiring: false, stopped: false,
        timer: null, graceTimer: null, sockets: new Set(), stopPromise: null,
      };
      this.session = session;
      server.on('connection', (socket) => {
        session.sockets.add(socket);
        socket.on('close', () => session.sockets.delete(socket));
      });
      server.on('request', (request, response) => this.serve(session, request, response));
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      if (session.stopped || generation !== this.generation) throw new Error('stopped');
      const address = server.address();
      const tunnelUrl = await this.openTunnel(session, address.port);
      if (session.stopped || generation !== this.generation) throw new Error('stopped');
      const url = `${tunnelUrl}/d/${session.token}`;
      const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, width: 192, color: { dark: '#000000', light: '#ffffff' } });
      if (session.stopped || generation !== this.generation) throw new Error('stopped');
      session.startedAt = Date.now();
      session.expiresAt = session.startedAt + SHARE_TTL_MS;
      session.timer = setTimeout(() => this.expire(session), SHARE_TTL_MS);
      this.starting = false;
      this.emit('share:ready', { name: file.name, size: file.size, qr, url, expiresAt: session.expiresAt });
      return { ok: true };
    } catch (error) {
      if (generation !== this.generation) return { ok: false, code: 'stopped' };
      this.starting = false;
      const code = error.message || 'failed';
      this.log(`Share start failed (${code})${error.diagnostic ? `: ${error.diagnostic}` : ''}`);
      const userMessage = ({ folder: 'Belum bisa kirim folder', empty: 'File-nya kosong', locked: 'File-nya lagi dipakai app lain', offline: 'Butuh internet buat bikin link', 'binary-missing': 'Fitur share belum bisa jalan', 'tunnel-timeout': 'Link belum siap. Coba lagi ya.', 'unsupported-platform': 'Fitur share belum tersedia di perangkat ini.' })[code] || 'File-nya lagi dipakai app lain';
      await this.stop('error', false);
      this.emit('share:error', { message: userMessage, code: ['binary-missing', 'unsupported-platform'].includes(code) ? 'unavailable' : 'failed' });
      return { ok: false, code };
    }
  }

  async startReceive() {
    await this.stop('replaced', false);
    const generation = ++this.generation;
    this.starting = true;
    try {
      const directory = path.join(this.app.getPath('downloads'), 'BalBul Drop');
      await fs.promises.mkdir(directory, { recursive: true });
      if (generation !== this.generation) return { ok: false, code: 'stopped' };
      const server = createServer();
      const session = {
        mode: 'receive', directory, server, child: null, logoPath: this.logoPath, token: crypto.randomBytes(16).toString('hex'),
        startedAt: null, expiresAt: null, maxBytes: MAX_RECEIVE_BYTES, maxTotalBytes: MAX_RECEIVE_TOTAL_BYTES,
        badRequests: [], activeDownloads: 0, activeUploads: 0, receivedFiles: 0, totalReceivedBytes: 0, uploading: false,
        expiring: false, stopped: false, timer: null, graceTimer: null, sockets: new Set(), stopPromise: null,
      };
      this.session = session;
      server.on('connection', (socket) => {
        session.sockets.add(socket);
        socket.on('close', () => session.sockets.delete(socket));
      });
      server.on('request', (request, response) => this.serve(session, request, response));
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      if (session.stopped || generation !== this.generation) throw new Error('stopped');
      const tunnelUrl = await this.openTunnel(session, server.address().port);
      if (session.stopped || generation !== this.generation) throw new Error('stopped');
      const url = `${tunnelUrl}/upload/${session.token}`;
      const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, width: 240, color: { dark: '#000000', light: '#ffffff' } });
      if (session.stopped || generation !== this.generation) throw new Error('stopped');
      session.startedAt = Date.now();
      session.expiresAt = session.startedAt + SHARE_TTL_MS;
      session.timer = setTimeout(() => this.expire(session), SHARE_TTL_MS);
      this.starting = false;
      this.emit('receive:ready', { url, qr, expiresAt: session.expiresAt, maxBytes: MAX_RECEIVE_BYTES, maxTotalBytes: MAX_RECEIVE_TOTAL_BYTES, maxFiles: MAX_RECEIVE_FILES, folderName: 'BalBul Drop' });
      return { ok: true };
    } catch (error) {
      if (generation !== this.generation) return { ok: false, code: 'stopped' };
      this.starting = false;
      const code = error.message || 'failed';
      this.log(`Receive start failed (${code})${error.diagnostic ? `: ${error.diagnostic}` : ''}`);
      const userMessage = ({ offline: 'Butuh internet untuk menerima file', 'binary-missing': 'Fitur share belum bisa jalan', 'tunnel-timeout': 'QR belum siap. Coba lagi ya.', 'unsupported-platform': 'Fitur share belum tersedia di perangkat ini.' })[code] || 'Gagal menyiapkan penerimaan file';
      await this.stop('error', false);
      this.emit('receive:error', { message: userMessage, code });
      return { ok: false, code };
    }
  }

  serve(session, request, response) {
    if (session.mode === 'receive') return this.serveReceive(session, request, response);
    const pathMatch = /^\/d\/([a-f0-9]{32})$/.exec(request.url || '');
    if (request.method !== 'GET' || !pathMatch || pathMatch[1] !== session.token || session.expiring || session.stopped) {
      session.badRequests = session.badRequests.filter((time) => Date.now() - time < BAD_REQUEST_WINDOW_MS);
      session.badRequests.push(Date.now());
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': INVALID_RESPONSE.length, 'Cache-Control': 'no-store' });
      response.end(INVALID_RESPONSE);
      if (session.badRequests.length > MAX_BAD_REQUESTS) {
        this.stop('rate-limit', false).finally(() => this.emit('share:error', { message: 'Link dinonaktifkan untuk keamanan. Coba lagi ya.', code: 'rate-limit' }));
      }
      return;
    }
    const range = parseRange(request.headers.range, session.file.size);
    if (range === false) {
      response.writeHead(416, { 'Content-Range': `bytes */${session.file.size}`, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : session.file.size - 1;
    const dispositionName = encodeURIComponent(session.file.name).replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    const headers = {
      'Content-Type': contentType(session.file.path),
      'Content-Length': String(end - start + 1),
      'Content-Disposition': `attachment; filename*=UTF-8''${dispositionName}`,
      'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    };
    if (range) { headers['Content-Range'] = `bytes ${start}-${end}/${session.file.size}`; response.writeHead(206, headers); }
    else response.writeHead(200, headers);
    session.activeDownloads += 1;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      session.activeDownloads = Math.max(0, session.activeDownloads - 1);
      if (session.expiring && session.activeDownloads === 0) this.stop('expired');
    };
    response.once('finish', finish);
    response.once('close', finish);
    const stream = fs.createReadStream(session.file.path, { start, end });
    stream.once('error', (error) => {
      this.log(`Shared file read failed (${error.code || 'read error'})`);
      if (!response.destroyed) response.destroy();
      finish();
      if (!session.stopped) {
        this.stop('read-error', false).finally(() => this.emit('share:error', { message: 'File-nya lagi dipakai app lain', code: 'failed' }));
      }
    });
    stream.pipe(response);
  }

  serveReceive(session, request, response) {
    const logoRoute = /^\/upload\/([a-f0-9]{32})\/logo$/.exec(request.url || '');
    if (logoRoute && logoRoute[1] === session.token && request.method === 'GET' && !session.expiring && !session.stopped && session.logoPath && fs.existsSync(session.logoPath)) {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(session.logoPath).pipe(response);
      return;
    }
    const route = /^\/upload\/([a-f0-9]{32})$/.exec(request.url || '');
    if (!route || route[1] !== session.token || session.expiring || session.stopped) { request.resume(); return this.reject(session, response); }
    if (request.method === 'GET') {
      const html = receivePage(session.maxBytes, session.token);
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html),
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(html);
      return;
    }
    if (request.method !== 'POST') return this.reject(session, response);
    this.receiveUpload(session, request, response).catch((error) => {
      this.log(`Incoming upload failed (${error.code || error.message || 'unknown'})`);
      if (!response.headersSent) response.writeHead(500, { 'Cache-Control': 'no-store' });
      if (!response.destroyed) response.end('Upload gagal. Coba lagi.');
    });
  }

  reject(session, response) {
    session.badRequests = session.badRequests.filter((time) => Date.now() - time < BAD_REQUEST_WINDOW_MS);
    session.badRequests.push(Date.now());
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': INVALID_RESPONSE.length, 'Cache-Control': 'no-store' });
    response.end(INVALID_RESPONSE);
    if (session.badRequests.length > MAX_BAD_REQUESTS) {
      this.stop('rate-limit', false).finally(() => this.emit('receive:error', { message: 'QR dinonaktifkan untuk keamanan. Buat QR baru ya.', code: 'rate-limit' }));
    }
  }

  async receiveUpload(session, request, response) {
    const rawName = request.headers['x-balbul-filename'];
    let name = '';
    try { name = safeName(decodeURIComponent(String(rawName || ''))); } catch (_) { name = ''; }
    const announced = Number(request.headers['content-length']);
    if (request.headers['content-type'] !== 'application/octet-stream' || !rawName || !name || (request.headers['content-length'] && (!Number.isSafeInteger(announced) || announced <= 0 || announced > session.maxBytes || announced > session.maxTotalBytes-session.totalReceivedBytes))) {
      request.resume(); response.writeHead(413, { 'Cache-Control': 'no-store' }); response.end('File tidak valid atau batas ukuran sesi tercapai.'); return;
    }
    if(session.receivedFiles>=MAX_RECEIVE_FILES){request.resume();response.writeHead(429,{'Cache-Control':'no-store'});response.end('Batas 20 file per sesi sudah tercapai.');return;}
    if (session.uploading) { request.resume(); response.writeHead(429, { 'Retry-After': '2', 'Cache-Control': 'no-store' }); response.end('Satu file sedang diunggah. Coba lagi sebentar.'); return; }
    session.uploading = true;
    session.activeUploads += 1;
    let outputPath = '';
    let outputCreated = false;
    let received = 0;
    let tooLarge = false;
    try {
      const ext = path.extname(name);
      const stem = path.basename(name, ext);
      for (let suffix = 0; suffix < 1000; suffix += 1) {
        const candidate = path.join(session.directory, suffix ? `${stem} (${suffix})${ext}` : name);
        try { await fs.promises.access(candidate); }
        catch (_) { outputPath = candidate; break; }
      }
      if (!outputPath) throw new Error('name-conflict');
      const limiter = new Transform({ transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > session.maxBytes || received + session.totalReceivedBytes > session.maxTotalBytes) { tooLarge = true; callback(Object.assign(new Error('too-large'), { code: 'TOO_LARGE' })); }
        else callback(null, chunk);
      } });
      const output = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
      output.once('open', () => { outputCreated = true; });
      await pipeline(request, limiter, output);
      if (!received) throw new Error('empty-file');
      session.receivedFiles += 1;
      session.totalReceivedBytes += received;
      const file = { name: path.basename(outputPath), size: received, count: session.receivedFiles };
      this.emit('receive:file', file);
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': '2', 'Cache-Control': 'no-store' });
      response.end('OK');
    } catch (error) {
      if (outputPath && outputCreated) await fs.promises.unlink(outputPath).catch(() => {});
      if (!response.headersSent) {
        const status = tooLarge || error.code === 'TOO_LARGE' ? 413 : 400;
        const body = status === 413 ? 'Batas ukuran file atau sesi tercapai.' : 'Upload terputus. Coba lagi.';
        response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': String(Buffer.byteLength(body)), 'Cache-Control': 'no-store' });
        response.end(body);
      }
    } finally {
      session.uploading = false;
      session.activeUploads = Math.max(0, session.activeUploads - 1);
      if (session.expiring && session.activeUploads === 0 && session.activeDownloads === 0) this.stop('expired');
    }
  }

  openTunnel(session, port) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let output = '';
      let timer;
      const finish = (error, url) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(url);
      };
      let binary;
      try { binary = this.binaryPath(); }
      catch (error) { finish(error); return; }
      const child = spawn(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      session.child = child;
      const inspect = (chunk) => {
        output = (output + chunk.toString('utf8')).slice(-8192);
        const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(output);
        if (match) finish(null, match[0]);
      };
      const diagnostic = () => output
        .replace(/https:\/\/[a-z0-9-]+\.trycloudflare\.com[^\s]*/ig, '[tunnel-url]')
        .replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').slice(-1200);
      child.stdout.on('data', inspect);
      child.stderr.on('data', inspect);
      const reportFailure = (failure) => {
        failure.diagnostic = failure.diagnostic || diagnostic();
        if (!settled) { finish(failure); return; }
        if (session.stopped || session.expiring) return;
        this.log(`cloudflared stopped after link was ready (${failure.message}): ${failure.diagnostic}`);
        this.stop('tunnel-failed', false).finally(() => this.emit('share:error', { message: 'Koneksi link terputus. Coba lagi ya.', code: 'failed' }));
      };
      child.once('error', (error) => {
        const failure = new Error(error.code === 'ENOENT' ? 'binary-missing' : 'failed');
        failure.diagnostic = `${error.code || 'spawn error'} ${diagnostic()}`.trim(); reportFailure(failure);
      });
      child.once('exit', (code) => {
        if (!session.stopped) { const failure = new Error('offline'); failure.diagnostic = `cloudflared exited ${code}; ${diagnostic()}`; reportFailure(failure); }
      });
      timer = setTimeout(() => { const failure = new Error('tunnel-timeout'); failure.diagnostic = diagnostic(); finish(failure); }, TUNNEL_TIMEOUT_MS);
    });
  }

  expire(session) {
    if (session.stopped) return;
    session.expiring = true;
    session.server.close(); // no new requests; active streams can finish
    this.emit(session.mode === 'receive' ? 'receive:expired' : 'share:expired', {});
    if (session.activeDownloads === 0 && session.activeUploads === 0) { this.stop('expired'); return; }
    session.graceTimer = setTimeout(() => this.stop('expired'), MAX_ACTIVE_GRACE_MS);
  }

  stop(reason = 'closed', notify = true) {
    this.generation += 1;
    const session = this.session;
    if (!session) { this.starting = false; return this.stopping; }
    if (session.stopPromise) return session.stopPromise;
    session.stopped = true;
    clearTimeout(session.timer);
    clearTimeout(session.graceTimer);
    session.stopPromise = (async () => {
      try { session.server.close(); } catch (_) { /* not listening */ }
      for (const socket of session.sockets) socket.destroy();
      if (typeof session.server.closeAllConnections === 'function') session.server.closeAllConnections();
      const child = session.child;
      if (child && child.exitCode == null && !child.killed) {
        if (process.platform === 'win32' && child.pid) {
          await new Promise((resolve) => execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => resolve()));
        } else {
          try { child.kill('SIGTERM'); } catch (_) { /* already gone */ }
          await new Promise((resolve) => {
            const timeout = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} resolve(); }, 1500);
            child.once('exit', () => { clearTimeout(timeout); resolve(); });
          });
        }
      }
      if (this.session === session) this.session = null;
      this.starting = false;
      if (notify) this.emit(session.mode === 'receive' ? 'receive:closed' : 'share:closed', { reason });
    })();
    return session.stopPromise;
  }

  emergencyKill() {
    const child = this.session?.child;
    if (!child || child.exitCode != null) return;
    try { child.kill(); } catch (_) { /* quit fallback */ }
    if (process.platform === 'win32' && child.pid) {
      try { spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch (_) { /* quit fallback */ }
    }
  }
}

function receivePage(maxBytes, token) {
  const maxMb = Math.floor(maxBytes / (1024 * 1024));
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f4f8ff"><title>BalBul Drop</title><style>
*{box-sizing:border-box}body{margin:0;padding:28px 16px;background:#f4f7fc;color:#18243a;font:16px system-ui,-apple-system,Segoe UI,sans-serif}.card{width:min(100%,540px);margin:24px auto;padding:30px 24px 26px;background:#fff;border:1px solid #e4e9f1;border-radius:24px;box-shadow:0 12px 34px #132c5010;text-align:center}.brand{display:flex;justify-content:center;align-items:center;gap:10px;margin:0 0 8px}.logo{width:42px;height:42px;border-radius:14px;background:#27d4e8;display:grid;place-items:center;overflow:hidden}.logo img{width:100%;height:100%;object-fit:contain}.brand-name{font-weight:850;font-size:26px;letter-spacing:-.7px}.subtitle{margin:0 0 24px;color:#3063cb;font-size:14px;font-weight:800;letter-spacing:1.2px}.drop{display:block;padding:28px 16px;border:2px dashed #cbd5e1;border-radius:18px;background:#f8fafc;cursor:pointer}.drop svg{width:48px;height:48px;fill:#70819a}.drop strong{display:block;margin:12px 0 4px;font-size:18px}.drop span{display:block;color:#64748b}.chosen{margin:14px 0 0;color:#334155;font-size:13px;overflow-wrap:anywhere}button{width:100%;margin-top:18px;padding:15px;border:0;border-radius:13px;background:#2863e8;color:#fff;font:700 17px system-ui;cursor:pointer}button:disabled{opacity:.6;cursor:wait}.hint{margin:14px 0 0;color:#718096;font-size:12px}.status{min-height:24px;margin-top:18px;color:#334155;font-weight:650}.progress{width:100%;height:8px;margin-top:9px;accent-color:#2863e8}.brandline{margin-top:22px;color:#718096;font-size:11px}@media(max-width:430px){body{padding:12px}.card{margin:20px auto;padding:24px 17px;border-radius:20px}.subtitle{font-size:13px}}
</style></head><body><main class="card"><div class="brand"><span class="logo"><img src="/upload/${token}/logo" alt=""></span><span class="brand-name">BalBul Drop</span></div><p class="subtitle">KIRIM FILE KE KOMPUTER</p><label class="drop" for="files"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.35 10.04A7.49 7.49 0 0 0 5 8a6 6 0 0 0 .5 12H19a5 5 0 0 0 .35-9.96ZM13 16v3h-2v-3H8l4-4 4 4Z"/></svg><strong>Tap di sini untuk memilih file</strong><span>Dokumen, foto, dan format file lain</span><div id="chosen" class="chosen">Maksimal ${maxMb} MB per file · total 500 MB / maksimal 20 file per sesi</div></label><input id="files" type="file" multiple hidden><button id="send" type="button" disabled>Kirim ke Komputer</button><div id="status" class="status" role="status" aria-live="polite"></div><progress id="progress" class="progress" max="100" value="0" hidden></progress><p class="hint">Pastikan BalBul tetap terbuka sampai file selesai dikirim. Siapa pun yang memindai QR ini bisa mengirim file selama sesi aktif.</p><div class="brandline">Terhubung langsung ke BalBul Drop · Link berakhir dalam 10 menit</div></main><script>
const max=${maxBytes},input=document.getElementById('files'),chosen=document.getElementById('chosen'),button=document.getElementById('send'),status=document.getElementById('status'),progress=document.getElementById('progress');let selected=[];const size=n=>n<1048576?(n/1024).toLocaleString('id-ID',{maximumFractionDigits:1})+' KB':(n/1048576).toLocaleString('id-ID',{maximumFractionDigits:1})+' MB';input.addEventListener('change',()=>{selected=[...input.files];chosen.textContent=selected.length?selected.map(f=>f.name+' · '+size(f.size)).join(' • '):'Maksimal ${maxMb} MB per file';button.disabled=!selected.length;progress.value=0;status.textContent='';});button.addEventListener('click',async()=>{if(!selected.length)return;button.disabled=true;progress.hidden=false;let sent=0;const files=[...selected],total=files.reduce((a,f)=>a+f.size,0);for(const file of files){if(file.size>max){status.textContent=file.name+' melebihi batas ${maxMb} MB.';continue}status.textContent='Mengirim '+file.name+'…';try{await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',location.pathname);xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('X-Balbul-Filename',encodeURIComponent(file.name));xhr.upload.onprogress=e=>{if(e.lengthComputable)progress.value=Math.round((sent+e.loaded)/(total||1)*100)};xhr.onload=()=>xhr.status===200?resolve():reject(new Error(xhr.responseText||'Upload gagal'));xhr.onerror=()=>reject(new Error('Koneksi terputus'));xhr.send(file)});sent+=file.size;selected=selected.filter(item=>item!==file);chosen.textContent=selected.length?selected.map(f=>f.name+' · '+size(f.size)).join(' • '):'File terkirim. Pilih file lagi untuk mengirim berikutnya.';status.textContent='Terkirim: '+file.name;progress.value=total?Math.round(sent/total*100):100;}catch(error){status.textContent=error.message;break}}if(!selected.length)input.value='';button.disabled=!selected.length;});
</script></body></html>`;
}

module.exports = { ShareService, SHARE_TTL_MS, MAX_RECEIVE_BYTES, MAX_RECEIVE_TOTAL_BYTES, MAX_RECEIVE_FILES, parseRange, safeName };
