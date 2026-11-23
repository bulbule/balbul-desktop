'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createServer } = require('node:http');
const { ShareService, MAX_RECEIVE_BYTES, MAX_RECEIVE_TOTAL_BYTES, parseRange, safeName } = require('../src/main/share-service');
const ShareCard = require('../web/share-card');

test('share message cards round-trip safely within the chat message limit', async () => {
  const url = `https://${'optional-occasionally-filling'}.trycloudflare.com/d/${'a'.repeat(32)}`;
  const qr = await require('qrcode').toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, width: 192 });
  const payload = { sender: 'A'.repeat(60), name: `${'Laporan-'.repeat(14)}-final.pdf`.slice(0, 120), size: 32800000, url, qr, expiresAt: Date.now() + 600000 };
  const body = ShareCard.encode(payload);
  assert.ok(body.length <= 3900);
  assert.deepEqual(ShareCard.parse(body), { version: 1, ...payload });
  assert.equal(ShareCard.parse(`${ShareCard.PREFIX}{"version":1,"url":"https://evil.example"}`), null);
  assert.deepEqual(ShareCard.links('lihat https://example.com/path?q=1. dan javascript:alert(1)').map((item) => item.host), ['example.com']);
});

test('phone receive route serves BalBul Drop page and streams files into the receive folder', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'balbul-receive-'));
  const logo = path.join(directory, 'logo.png');fs.writeFileSync(logo, Buffer.from('png'));
  const token = 'c'.repeat(32), received = [];
  const service = new ShareService({ app: {}, onEvent: (channel, payload) => { if (channel === 'receive:file') received.push(payload); } });
  const session = { mode:'receive', directory, logoPath:logo, token, stopped:false, expiring:false, maxBytes:MAX_RECEIVE_BYTES, maxTotalBytes:MAX_RECEIVE_TOTAL_BYTES, badRequests:[], activeUploads:0, activeDownloads:0, receivedFiles:0, totalReceivedBytes:0, uploading:false, sockets:new Set() };
  const server = createServer((request, response) => service.serve(session, request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve));fs.rmSync(directory,{recursive:true,force:true}); });
  const base=`http://127.0.0.1:${server.address().port}/upload/${token}`;
  const page=await request(`${base}`);
  assert.equal(page.status,200);assert.match(page.body,/BalBul Drop/);assert.match(page.body,/KIRIM FILE KE KOMPUTER/);
  const script=page.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert.ok(script);assert.doesNotThrow(()=>new vm.Script(script));
  const icon=await request(`${base}/logo`);assert.equal(icon.status,200);assert.equal(icon.body,'png');
  const data=Buffer.from('foto dari hp');
  const upload=await request(`${base}`,{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':String(data.length),'X-Balbul-Filename':encodeURIComponent('Foto HP.txt')},body:data});
  assert.equal(upload.status,200);assert.equal(fs.readFileSync(path.join(directory,'Foto HP.txt'),'utf8'),'foto dari hp');
  assert.equal(received[0].name,'Foto HP.txt');assert.equal(received[0].size,data.length);
  const invalid=await request(`http://127.0.0.1:${server.address().port}/upload/${'d'.repeat(32)}`);
  assert.equal(invalid.status,404);
});

test('range parsing and filename sanitizing reject unsafe input', () => {
  assert.deepEqual(parseRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.equal(parseRange('bytes=12-13', 10), false);
  assert.equal(safeName('../x' + String.fromCharCode(0) + '.pdf'), '.._x_.pdf');
});

test('file validation rejects folders and zero-byte files', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'balbul-validate-'));
  const emptyFile = path.join(directory, 'kosong.txt');
  fs.writeFileSync(emptyFile, '');
  const service = new ShareService({ app: {}, onEvent: () => {} });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(service.validate(directory), (error) => error.message === 'folder');
  await assert.rejects(service.validate(emptyFile), (error) => error.message === 'empty');
});

test('only the random-token GET route streams the file and range requests resume', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'balbul-share-'));
  const filename = 'Laporan (uji) é.txt';
  const file = path.join(directory, filename);
  fs.writeFileSync(file, 'hello world');
  const service = new ShareService({ app: {}, onEvent: () => {} });
  const session = {
    file: { path: file, name: filename, size: 11 }, token: 'a'.repeat(32), expiring: false,
    stopped: false, badRequests: [], activeDownloads: 0, sockets: new Set(),
  };
  const server = createServer((request, response) => service.serve(session, request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.equal(address.address, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  const full = await request(`${base}/d/${session.token}`);
  assert.equal(full.status, 200);
  assert.equal(full.body, 'hello world');
  assert.match(full.headers['content-disposition'], /filename\*=UTF-8''Laporan%20%28uji%29%20%C3%A9.txt/);
  assert.equal(full.headers['content-length'], '11');
  const partial = await request(`${base}/d/${session.token}`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.body, 'llo ');
  assert.equal(partial.headers['content-range'], 'bytes 2-5/11');
  const unknown = await request(`${base}/wrong/path`);
  const wrongToken = await request(`${base}/d/${'b'.repeat(32)}`);
  assert.equal(unknown.status, 404);
  assert.equal(wrongToken.status, unknown.status);
  assert.equal(wrongToken.body, unknown.body);
  assert.equal(unknown.body.includes(file), false);
});

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { ...options, method: options.method || 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
