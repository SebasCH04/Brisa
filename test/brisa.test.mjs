import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createBrisa } from '../server.mjs';
import { CHUNK_SIZE } from '../lib/transfers.mjs';

const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
function request(app, route, { secure = false, token, method = 'GET', data, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = data === undefined ? undefined : Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
    const transport = secure ? https : http;
    const req = transport.request({ hostname: '127.0.0.1', port: secure ? app.info.httpsPort : app.info.httpPort, path: route, method,
      ...(secure ? { ca: app.ca } : {}),
      headers: { 'X-Brisa-Client': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Length': payload.length, 'Content-Type': Buffer.isBuffer(data) ? 'application/octet-stream' : 'application/json' } : {}), ...headers }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        let json; try { json = JSON.parse(bytes.toString()); } catch { /* A binary or static response. */ }
        resolve({ status: response.statusCode, headers: response.headers, bytes, json });
      });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
async function pair(app, name = 'iPhone de prueba') {
  const token = crypto.randomBytes(32).toString('base64url');
  const proposal = await request(app, '/api/pair', { secure: true, method: 'POST', data: { token, name } });
  assert.equal(proposal.status, 201);
  const before = await request(app, '/api/files', { secure: true, token }); assert.equal(before.status, 401);
  const approved = await request(app, `/api/pair/${proposal.json.id}/approve`, { method: 'POST' }); assert.equal(approved.status, 200);
  const status = await request(app, '/api/pair/status', { secure: true, method: 'POST', data: { token } });
  assert.equal(status.json.approved, true);
  assert.match(status.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/);
  return { token, id: proposal.json.id, cookie: status.headers['set-cookie'][0].split(';')[0] };
}
async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brisa-test-'));
  let app = await createBrisa({ dataDir, httpPort: 0, httpsPort: 0, bind: '127.0.0.1', discovery: false, addresses: ['127.0.0.1'] });
  t.after(async () => {
    await app.close();
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('brisa-test-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { get app() { return app; }, dataDir, async restart() { await app.close(); app = await createBrisa({ dataDir, httpPort: 0, httpsPort: 0, bind: '127.0.0.1', discovery: false, addresses: ['127.0.0.1'] }); return app; } };
}
test('vinculación persistente, cookie de pantalla de inicio, revocación y control de acceso', async t => {
  const f = await fixture(t);
  const device = await pair(f.app);
  const oldHost = f.app.info.hostname;
  const originalCa = f.app.ca;
  await f.restart();
  assert.equal(f.app.info.hostname, oldHost);
  assert.deepEqual(f.app.ca, originalCa);
  const authenticated = await request(f.app, '/api/bootstrap', { secure: true, token: device.token });
  assert.equal(authenticated.json.authenticated, true);
  assert.equal(authenticated.json.admin, false);
  const cookieOnly = await request(f.app, '/api/bootstrap', { secure: true, headers: { Cookie: device.cookie } });
  assert.equal(cookieOnly.json.authenticated, true);
  assert.equal((await request(f.app, '/api/bootstrap', { secure: true })).json.authenticated, false);
  assert.equal((await request(f.app, '/api/files', { secure: true })).status, 401);
  assert.equal((await request(f.app, `/api/devices/${device.id}`, { secure: true, token: device.token, method: 'DELETE' })).status, 403);
  await request(f.app, `/api/devices/${device.id}`, { method: 'DELETE' });
  assert.equal((await request(f.app, '/api/files', { secure: true, token: device.token })).status, 401);
  assert.equal((await request(f.app, '/api/bootstrap', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(f.app, '/api/bootstrap', { headers: { Host: `evil.example:${f.app.info.httpPort}` } })).status, 403);
  assert.equal((await request(f.app, '/api/bootstrap', { headers: { 'X-Brisa-Client': '' } })).status, 403);
});
test('archivo multibloque: checksum, corte, reinicio, reanudación y descarga exacta con rangos', async t => {
  const f = await fixture(t);
  const device = await pair(f.app);
  const payload = crypto.randomBytes(CHUNK_SIZE + 32781);
  const options = { secure: true, token: device.token };
  const created = await request(f.app, '/api/uploads', { ...options, method: 'POST', data: { name: 'Vídeo de prueba.zip', size: payload.length, mime: 'application/zip', lastModified: 123 } });
  assert.equal(created.status, 201); const id = created.json.id;
  const first = payload.subarray(0, CHUNK_SIZE);
  const invalid = await request(f.app, `/api/uploads/${id}/chunk?offset=0`, { ...options, method: 'PUT', data: first, headers: { 'X-Content-SHA256': '0'.repeat(64) } });
  assert.equal(invalid.status, 422);
  assert.equal((await request(f.app, `/api/uploads/${id}`, options)).json.offset, 0);
  assert.equal((await request(f.app, `/api/uploads/${id}/chunk?offset=0`, { ...options, method: 'PUT', data: first, headers: { 'X-Content-SHA256': hash(first) } })).json.offset, CHUNK_SIZE);
  assert.equal((await request(f.app, `/api/uploads/${id}/complete`, { ...options, method: 'POST' })).status, 409);
  // Simulate a crash after bytes were written but before the next checkpoint.
  await fs.appendFile(f.app.transfers.part(id), Buffer.from('uncommitted'));
  await f.restart();
  assert.equal((await fs.stat(f.app.transfers.part(id))).size, CHUNK_SIZE);
  const resumed = await request(f.app, `/api/uploads/${id}`, options);
  assert.equal(resumed.json.offset, CHUNK_SIZE); assert.equal(resumed.json.chunks[0].sha256, hash(first));
  assert.equal((await request(f.app, `/api/uploads/${id}/chunk?offset=0`, { ...options, method: 'PUT', data: first, headers: { 'X-Content-SHA256': hash(first) } })).status, 409);
  const second = payload.subarray(CHUNK_SIZE);
  assert.equal((await request(f.app, `/api/uploads/${id}/chunk?offset=${CHUNK_SIZE}`, { ...options, method: 'PUT', data: second, headers: { 'X-Content-SHA256': hash(second) } })).status, 200);
  const complete = await request(f.app, `/api/uploads/${id}/complete`, { ...options, method: 'POST' });
  assert.equal(complete.json.sha256, hash(payload));
  assert.equal((await request(f.app, `/api/uploads/${id}/complete`, { ...options, method: 'POST' })).status, 200);
  const downloaded = await request(f.app, `/api/files/${id}/download`, { secure: true, headers: { Cookie: device.cookie } });
  assert.equal(downloaded.status, 200); assert.deepEqual(downloaded.bytes, payload);
  assert.match(downloaded.headers['content-disposition'], /filename\*=UTF-8/);
  const range = await request(f.app, `/api/files/${id}/download`, { ...options, headers: { Range: 'bytes=100-400' } });
  assert.equal(range.status, 206); assert.deepEqual(range.bytes, payload.subarray(100, 401));
  const suffix = await request(f.app, `/api/files/${id}/download`, { ...options, headers: { Range: 'bytes=-12' } });
  assert.deepEqual(suffix.bytes, payload.subarray(-12));
  assert.equal((await request(f.app, `/api/files/${id}/download`, { ...options, headers: { Range: `bytes=${payload.length}-` } })).status, 416);
  assert.equal((await request(f.app, `/api/files/${id}/download`, { ...options, headers: { Range: 'bytes=-0' } })).status, 416);
  const desktopDownload = await request(f.app, `/api/files/${id}/download`); assert.deepEqual(desktopDownload.bytes, payload);
  await f.restart();
  assert.equal((await request(f.app, '/api/files', options)).json.files[0].sha256, hash(payload));
});
test('Windows envía un archivo vacío o duplicado de nombre sin sobrescribir archivos', async t => {
  const f = await fixture(t);
  const device = await pair(f.app);
  const ids = [];
  for (let index = 0; index < 2; index++) {
    const create = await request(f.app, '/api/uploads', { method: 'POST', data: { name: 'documento.txt', size: 0 } });
    const complete = await request(f.app, `/api/uploads/${create.json.id}/complete`, { method: 'POST' });
    assert.equal(complete.json.sha256, hash(Buffer.alloc(0))); ids.push(create.json.id);
  }
  assert.notEqual(ids[0], ids[1]);
  assert.equal((await request(f.app, `/api/files/${ids[0]}/download`, { secure: true, token: device.token })).bytes.length, 0);
  assert.equal((await request(f.app, '/api/uploads', { method: 'POST', data: { name: '../escape.txt', size: 10 } })).status, 400);
  assert.equal((await request(f.app, '/api/uploads', { method: 'POST', data: { name: 'a', size: -1 } })).status, 400);
  const create = await request(f.app, '/api/uploads', { method: 'POST', data: { name: 'pendiente.txt', size: 10 } });
  assert.equal((await request(f.app, `/api/uploads/${create.json.id}`, { secure: true, token: device.token })).status, 404);
  assert.equal((await request(f.app, `/api/uploads/${create.json.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(f.app, '/api/uploads')).json.uploads.length, 0);
});
test('configuración pública, QR local y certificados privados inaccesibles', async t => {
  const f = await fixture(t);
  const certificate = await request(f.app, '/brisa-root.crt'); assert.equal(certificate.status, 200); assert.deepEqual(certificate.bytes, f.app.ca);
  assert.equal((await request(f.app, '/.brisa/certificates/root.key')).status, 404);
  assert.equal((await request(f.app, '/setup')).status, 200);
  assert.equal((await request(f.app, '/icon-192.png')).status, 200);
  const target = `http://${f.app.info.hostname}:${f.app.info.httpPort}/setup`;
  const qr = await request(f.app, `/api/qr?url=${encodeURIComponent(target)}`, { headers: { 'X-Brisa-Client': '' } });
  assert.equal(qr.status, 200); assert.match(qr.bytes.toString(), /<svg/);
  assert.equal((await request(f.app, '/api/qr?url=https%3A%2F%2Fevil.example')).status, 400);
});
