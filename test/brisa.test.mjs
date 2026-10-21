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
async function fixture(t, options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brisa-test-'));
  let app = await createBrisa({ dataDir, httpPort: 0, httpsPort: 0, bind: '127.0.0.1', discovery: false, addresses: ['127.0.0.1'], ...options });
  t.after(async () => {
    await app.close();
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('brisa-test-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { get app() { return app; }, dataDir, async restart() { await app.close(); app = await createBrisa({ dataDir, httpPort: 0, httpsPort: 0, bind: '127.0.0.1', discovery: false, addresses: ['127.0.0.1'], ...options }); return app; } };
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

test('borrar historial conserva archivos, se comparte y persiste al reiniciar', async t => {
  const f = await fixture(t); const device = await pair(f.app);
  const first = (await request(f.app, '/api/uploads', { method: 'POST', data: { name: 'antes.zip', size: 0 } })).json;
  await request(f.app, `/api/uploads/${first.id}/complete`, { method: 'POST' });
  assert.equal((await request(f.app, '/api/files')).json.history.length, 1);
  assert.equal((await request(f.app, '/api/history', { method: 'DELETE', secure: true })).status, 401);
  assert.equal((await request(f.app, '/api/history', { method: 'DELETE', secure: true, token: device.token })).status, 200);
  for (const options of [{}, { secure: true, token: device.token }]) {
    const list = (await request(f.app, '/api/files', options)).json;
    assert.equal(list.history.length, 0); assert.equal(list.files.length, 1);
    assert.equal((await request(f.app, `/api/files/${first.id}/download`, options)).status, 200);
  }
  assert.equal((await fs.stat(f.app.transfers.file(first.id))).size, 0);
  await f.restart();
  assert.equal((await request(f.app, '/api/files')).json.history.length, 0);
  assert.equal((await request(f.app, '/api/files')).json.files.length, 1);
  const next = (await request(f.app, '/api/uploads', { method: 'POST', data: { name: 'despues.zip', size: 0 } })).json;
  await request(f.app, `/api/uploads/${next.id}/complete`, { method: 'POST' });
  const list = (await request(f.app, '/api/files')).json;
  assert.equal(list.files.length, 2); assert.deepEqual(list.history.map(file => file.id), [next.id]);
  await request(f.app, '/api/history', { method: 'DELETE' });
  assert.equal((await request(f.app, '/api/files')).json.history.length, 0);
  assert.equal(f.app.storage.state.files.length, 2);
});

test('abrir carpetas usa solo destinos de Brisa y devuelve un error visible si Windows falla', async t => {
  const opened = []; let failOpen = false;
  const f = await fixture(t, { openFolder: async folder => { if (failOpen) throw new Error('No interactive shell'); opened.push(folder); } });
  const device = await pair(f.app);
  assert.equal((await request(f.app, '/api/storage/reveal', { secure: true, token: device.token, method: 'POST', data: {} })).status, 403);
  assert.equal(opened.length, 0);
  assert.equal((await request(f.app, '/api/storage/reveal', { method: 'POST', data: {} })).status, 200);
  assert.equal(opened[0], path.join(f.dataDir, 'files'));
  const created = await request(f.app, '/api/uploads', { method: 'POST', data: { name: "Foto de mamá & prueba's.zip", size: 0 } });
  const id = created.json.id;
  await request(f.app, `/api/uploads/${id}/complete`, { method: 'POST' });
  assert.equal((await request(f.app, '/api/storage/reveal', { method: 'POST', data: { id } })).status, 200);
  assert.equal(opened[1], path.dirname(f.app.transfers.file(id)));
  assert.equal((await request(f.app, '/api/storage/reveal', { method: 'POST', data: { id: '../state.json' } })).status, 404);
  assert.equal(opened.length, 2);
  failOpen = true;
  const failed = await request(f.app, '/api/storage/reveal', { method: 'POST', data: {} });
  assert.equal(failed.status, 502); assert.match(failed.json.error, /Descargar/);
  assert.equal((await request(f.app, `/api/files/${id}/download`)).status, 200);
});

async function waitUntil(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('No llegó el evento esperado.');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function eventStream(app, { secure = false, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const transport = secure ? https : http;
    const result = { packets: [], ended: false };
    result.request = transport.get({ hostname: '127.0.0.1', port: secure ? app.info.httpsPort : app.info.httpPort, path: '/api/events', ...(secure ? { ca: app.ca } : {}), headers: cookie ? { Cookie: cookie } : {} }, response => {
      result.response = response;
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`SSE ${response.statusCode}`)); return; }
      let buffer = '';
      response.on('data', chunk => {
        buffer += chunk.toString();
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const packet = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = packet.split('\n').find(line => line.startsWith('data: '));
          if (data) { result.packets.push(JSON.parse(data.slice(6))); resolve(result); }
        }
      });
      response.on('end', () => { result.ended = true; });
    });
    result.request.on('error', reject);
  });
}
test('avisos en vivo: inicio, progreso, entrega, aislamiento entre teléfonos y revocación', async t => {
  const f = await fixture(t);
  const phone = await pair(f.app, 'iPhone A'); const other = await pair(f.app, 'iPhone B');
  const options = { secure: true, token: phone.token };
  const desktopEvents = await eventStream(f.app);
  const phoneEvents = await eventStream(f.app, { secure: true, cookie: phone.cookie });
  t.after(() => { desktopEvents.request.destroy(); phoneEvents.request.destroy(); });
  const initialCursor = f.app.activity.cursor;
  const created = await request(f.app, '/api/uploads', { ...options, method: 'POST', data: { name: 'aviso.zip', size: 7 } });
  const id = created.json.id;
  await waitUntil(() => desktopEvents.packets.some(packet => packet.events.some(event => event.type === 'upload-started' && event.fileId === id)));
  const active = await request(f.app, '/api/activity', options);
  assert.equal(active.json.active[0].fileId, id);
  assert.equal((await request(f.app, '/api/activity', { secure: true, token: other.token })).json.events.length, 0);
  const payload = Buffer.from('1234567');
  await request(f.app, `/api/uploads/${id}/chunk?offset=0`, { ...options, method: 'PUT', data: payload, headers: { 'X-Content-SHA256': hash(payload) } });
  assert.equal((await request(f.app, '/api/activity', options)).json.active[0].bytes, 7);
  await request(f.app, `/api/uploads/${id}/complete`, { ...options, method: 'POST' });
  await request(f.app, `/api/uploads/${id}/complete`, { ...options, method: 'POST' });
  const beforeDownload = f.app.activity.cursor;
  assert.equal(beforeDownload, initialCursor + 2);
  await request(f.app, `/api/files/${id}/download`, { ...options, method: 'HEAD' });
  assert.equal(f.app.activity.cursor, beforeDownload, 'HEAD no debe anunciar una entrega');
  const downloaded = await request(f.app, `/api/files/${id}/download`, options); assert.deepEqual(downloaded.bytes, payload);
  await waitUntil(() => desktopEvents.packets.some(packet => packet.events.some(event => event.type === 'delivery-completed' && event.fileId === id)));
  const activity = (await request(f.app, `/api/activity?instance=${f.app.activity.instance}&after=${beforeDownload}`, options)).json;
  assert.deepEqual(activity.events.map(event => event.type), ['delivery-started', 'delivery-completed']);
  assert.equal(activity.events[1].partial, false);
  assert.equal(activity.active.length, 0);
  await request(f.app, `/api/files/${id}/download`, { ...options, headers: { Range: 'bytes=0-1' } });
  assert.equal(f.app.activity.events.at(-1).partial, true, 'un rango no equivale a guardar el archivo completo');
  assert.equal((await request(f.app, '/api/events', { headers: { Origin: 'https://evil.example' } })).status, 403);
  await request(f.app, `/api/devices/${phone.id}`, { method: 'DELETE' });
  await waitUntil(() => phoneEvents.ended);
  desktopEvents.request.destroy();
  await f.restart();
  assert.equal((await request(f.app, '/api/files')).json.files.length, 1, 'el historial de archivos sobrevive al reinicio');
});
test('una descarga cortada genera aviso de interrupción y nunca de entrega completada', async t => {
  const f = await fixture(t);
  const payload = crypto.randomBytes(CHUNK_SIZE);
  const created = await request(f.app, '/api/uploads', { method: 'POST', data: { name: 'descarga-interrumpida.zip', size: CHUNK_SIZE * 4 } });
  const id = created.json.id;
  for (let index = 0; index < 4; index++) await request(f.app, `/api/uploads/${id}/chunk?offset=${index * CHUNK_SIZE}`, { method: 'PUT', data: payload, headers: { 'X-Content-SHA256': hash(payload) } });
  await request(f.app, `/api/uploads/${id}/complete`, { method: 'POST' });
  await new Promise((resolve, reject) => {
    const download = http.get(`http://127.0.0.1:${f.app.info.httpPort}/api/files/${id}/download`, response => {
      response.once('data', () => { download.destroy(); resolve(); });
      response.on('error', () => {});
    });
    download.on('error', caught => { if (caught.code !== 'ECONNRESET') reject(caught); });
  });
  await waitUntil(() => f.app.activity.events.some(event => event.type === 'delivery-interrupted'));
  assert.ok(!f.app.activity.events.some(event => event.type === 'delivery-completed'));
  assert.equal(f.app.activity.deliveries.size, 0);
});
