import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import { Bonjour } from 'bonjour-service';
import { openStorage, tokenHash } from './lib/storage.mjs';
import { certificates } from './lib/tls.mjs';
import { Transfers, CHUNK_SIZE } from './lib/transfers.mjs';
import { openWindowsFolder } from './lib/windows-shell.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const PUBLIC = path.join(ROOT, 'public');
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const isLocal = request => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
function json(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function body(request, limit = 16384) {
  let length = 0; const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw error('La solicitud es demasiado grande.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error('La solicitud no contiene datos válidos.'); }
}
const publicFile = file => {
  const { owner, ...visible } = file;
  return { ...visible, source: owner === 'desktop' ? 'windows' : 'iphone' };
};
export function networkAddresses() {
  const interfaces = Object.entries(os.networkInterfaces());
  interfaces.sort(([a], [b]) => Number(/virtual|vpn|wsl|vethernet|docker/i.test(a)) - Number(/virtual|vpn|wsl|vethernet|docker/i.test(b)));
  return [...new Set(interfaces.flatMap(([, items]) => (items || []).filter(item => item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.')).map(item => item.address)))];
}
export async function createBrisa(options = {}) {
  const dataDir = options.dataDir || path.join(ROOT, '.brisa');
  const storage = openStorage(dataDir);
  const hostname = `brisa-${storage.state.id.slice(0, 8)}.local`;
  const addresses = options.addresses || networkAddresses();
  const tls = await certificates(dataDir, hostname, addresses);
  const transfers = new Transfers(storage);
  const pending = new Map();
  const attempts = new Map();
  const presence = new Map();
  const info = { name: storage.state.name, hostname, addresses, httpPort: 0, httpsPort: 0 };
  let discovery;
  let stopping = false;
  const hosts = new Set(['127.0.0.1', 'localhost', hostname, ...addresses]);
  const authenticate = (request, url) => {
    const host = url.hostname;
    if (!request.socket.encrypted && isLocal(request) && ['127.0.0.1', 'localhost'].includes(host)) return { id: 'desktop', name: 'Esta computadora', admin: true };
    if (!request.socket.encrypted) return null;
    let cookie = '';
    try { cookie = decodeURIComponent((request.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('brisa_device='))?.slice(13) || ''); } catch { /* Invalid cookie is unauthenticated. */ }
    const token = request.headers.authorization?.replace(/^Bearer /, '') || cookie;
    if (typeof token !== 'string' || token.length > 200) return null;
    const device = storage.state.devices.find(item => item.tokenHash === tokenHash(token));
    if (!device) return null;
    return { id: device.id, name: device.name, token, admin: false };
  };
  const cookie = (response, token) => response.setHeader('Set-Cookie', `brisa_device=${encodeURIComponent(token)}; Path=/; Max-Age=34560000; HttpOnly; Secure; SameSite=Strict`);
  const cleanPending = () => {
    for (const [id, item] of pending) if (Date.now() - item.created > 10 * 60000) pending.delete(id);
    for (const [ip, times] of attempts) {
      const recent = times.filter(time => Date.now() - time < 60000);
      if (recent.length) attempts.set(ip, recent); else attempts.delete(ip);
    }
  };
  async function handler(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const protocol = request.socket.encrypted ? 'https:' : 'http:';
      let url;
      try { url = new URL(`${protocol}//${request.headers.host}${request.url}`); }
      catch { throw error('Dirección no válida.', 400); }
      if (!hosts.has(url.hostname) || url.port !== String(request.socket.localPort)) throw error('Dirección no permitida.', 403);
      const origin = request.headers.origin;
      if (origin && origin !== url.origin) throw error('Esta conexión procede de otra página.', 403);
      const pathname = url.pathname;
      const actor = authenticate(request, url);
      if (actor) presence.set(actor.id, Date.now());
      if (actor && !actor.admin) cookie(response, actor.token);
      if (pathname === '/api/health' && request.method === 'GET') return json(response, { app: 'brisa', version: VERSION });
      if (pathname === '/brisa-root.crt' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="Brisa-CA-local.crt"', 'Cache-Control': 'no-store' });
        return response.end(tls.ca);
      }
      if (pathname === '/connection.json' && request.method === 'GET') {
        const direct = hosts.has(url.hostname) && /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && url.hostname !== '127.0.0.1' ? url.hostname : addresses[0] || '127.0.0.1';
        return json(response, { hostname, appUrl: `https://${hostname}:${info.httpsPort}`, fallbackUrl: `https://${direct}:${info.httpsPort}` });
      }
      if (pathname.startsWith('/api/')) {
        const download = /^\/api\/files\/[a-f0-9-]{36}\/download$/.test(pathname);
        if (!download && !(pathname === '/api/qr' && actor?.admin) && request.headers['x-brisa-client'] !== '1') throw error('Solicitud no válida.', 403);
        if (!request.socket.encrypted && !actor?.admin) throw error('Abre la conexión HTTPS de Brisa.', 403);
        cleanPending();
        if (pathname === '/api/bootstrap' && request.method === 'GET') {
          const result = { name: info.name, version: VERSION, chunkSize: CHUNK_SIZE, authenticated: Boolean(actor), admin: Boolean(actor?.admin), device: actor ? { id: actor.id, name: actor.name } : null };
          if (actor?.admin) Object.assign(result, {
            ...info, desktopUrl: `http://127.0.0.1:${info.httpPort}`,
            setupUrls: [hostname, ...addresses].map(host => `http://${host}:${info.httpPort}/setup`),
            appUrl: `https://${hostname}:${info.httpsPort}`,
            devices: storage.state.devices.map(({ tokenHash: ignored, ...device }) => ({ ...device, online: Date.now() - (presence.get(device.id) || 0) < 20000 })),
            pending: [...pending.values()].map(({ tokenHash: ignored, ...item }) => item),
            storagePath: path.join(dataDir, 'files'), projectPath: ROOT
          });
          return json(response, result);
        }
        if (pathname === '/api/pair' && request.method === 'POST') {
          if (actor?.admin) throw error('Vincula el iPhone desde su propia pantalla.');
          const input = await body(request);
          if (typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw error('La identidad del dispositivo no es válida.');
          const digest = tokenHash(input.token);
          const paired = storage.state.devices.find(item => item.tokenHash === digest);
          if (paired) { cookie(response, input.token); return json(response, { approved: true }); }
          const existing = [...pending.values()].find(item => item.tokenHash === digest);
          if (existing) return json(response, { id: existing.id, code: existing.code, approved: false });
          const ip = request.socket.remoteAddress;
          const recent = attempts.get(ip) || [];
          if (recent.length >= 5 || pending.size >= 20) throw error('Espera un minuto antes de solicitar otra vinculación.', 429);
          recent.push(Date.now()); attempts.set(ip, recent);
          const item = { id: crypto.randomUUID(), name: String(input.name || 'Mi iPhone').replace(/[\x00-\x1f]/g, '').trim().slice(0, 60) || 'Mi iPhone', tokenHash: digest, code: String(crypto.randomInt(100000, 1000000)), created: Date.now() };
          pending.set(item.id, item);
          return json(response, { id: item.id, code: item.code, approved: false }, 201);
        }
        if (pathname === '/api/pair/status' && request.method === 'POST') {
          const input = await body(request);
          if (typeof input.token !== 'string' || input.token.length > 200) throw error('Identidad no válida.');
          const digest = tokenHash(input.token);
          const device = storage.state.devices.find(item => item.tokenHash === digest);
          if (device) { cookie(response, input.token); return json(response, { approved: true }); }
          const item = [...pending.values()].find(item => item.tokenHash === digest);
          return json(response, { approved: false, pending: Boolean(item) });
        }
        if (!actor) throw error('Vincula primero este dispositivo desde tu computadora.', 401);
        const approval = pathname.match(/^\/api\/pair\/([a-f0-9-]{36})\/(approve|reject)$/);
        if (approval && request.method === 'POST') {
          if (!actor.admin) throw error('Solo puedes hacer esto desde Windows.', 403);
          const item = pending.get(approval[1]);
          if (!item) throw error('La solicitud ya no está disponible.', 404);
          if (approval[2] === 'approve') {
            if (storage.state.devices.length >= 50) throw error('Olvida un dispositivo antes de agregar otro.', 409);
            storage.state.devices.push({ id: item.id, name: item.name, tokenHash: item.tokenHash, createdAt: new Date().toISOString() });
            storage.save();
          }
          pending.delete(item.id);
          return json(response, { ok: true });
        }
        const deviceMatch = pathname.match(/^\/api\/devices\/([a-f0-9-]{36})$/);
        if (deviceMatch && request.method === 'DELETE') {
          if (!actor.admin) throw error('Solo puedes hacer esto desde Windows.', 403);
          storage.state.devices = storage.state.devices.filter(item => item.id !== deviceMatch[1]); storage.save();
          return json(response, { ok: true });
        }
        if (pathname === '/api/qr' && request.method === 'GET') {
          if (!actor.admin) throw error('Solo puedes hacer esto desde Windows.', 403);
          const target = url.searchParams.get('url');
          const allowed = [hostname, ...addresses].map(host => `http://${host}:${info.httpPort}/setup`);
          if (!allowed.includes(target)) throw error('La dirección del QR no pertenece a Brisa.');
          const svg = await QRCode.toString(target, { type: 'svg', margin: 2, width: 220, errorCorrectionLevel: 'M', color: { dark: '#153e38', light: '#ffffff' } });
          response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); return response.end(svg);
        }
        if (pathname === '/api/files' && request.method === 'GET') return json(response, { files: storage.state.files.map(publicFile) });
        if (pathname === '/api/storage/reveal' && request.method === 'POST') {
          if (!actor.admin) throw error('Solo puedes hacer esto desde Windows.', 403);
          const input = await body(request);
          const file = input.id ? storage.state.files.find(item => item.id === input.id) : null;
          if (input.id && !file) throw error('No encontramos ese archivo.', 404);
          const folder = file ? path.dirname(transfers.file(file.id)) : path.join(dataDir, 'files');
          if (!(await fsp.stat(folder)).isDirectory()) throw error('La carpeta ya no está disponible.', 404);
          try { await (options.openFolder || openWindowsFolder)(folder); }
          catch (caught) {
            console.warn('[Brisa] No se pudo abrir la carpeta:', caught.message);
            throw error('Windows no pudo abrir la carpeta. Puedes guardar el archivo con Descargar.', 502);
          }
          return json(response, { ok: true });
        }
        if (pathname === '/api/uploads' && request.method === 'GET') return json(response, { uploads: [...transfers.uploads.values()].filter(item => item.owner === actor.id).map(({ owner, ...item }) => item) });
        if (pathname === '/api/uploads' && request.method === 'POST') return json(response, transfers.create(await body(request), actor.id), 201);
        const uploadMatch = pathname.match(/^\/api\/uploads\/([a-f0-9-]{36})(?:\/(chunk|complete))?$/);
        if (uploadMatch) {
          const [, id, action] = uploadMatch;
          if (request.method === 'GET' && !action) return json(response, transfers.get(id, actor.id));
          if (request.method === 'DELETE' && !action) { transfers.cancel(id, actor.id); return json(response, { ok: true }); }
          if (request.method === 'PUT' && action === 'chunk') {
            if (!/^\d+$/.test(url.searchParams.get('offset') || '')) throw error('El progreso no es válido.');
            if (transfers.busy.size >= 4) throw error('Hay otras transferencias activas. Reintenta en un momento.', 429);
            const result = await transfers.chunk(id, actor.id, Number(url.searchParams.get('offset')), request, request.headers['x-content-sha256']);
            return json(response, { id: result.id, offset: result.offset, size: result.size });
          }
          if (request.method === 'POST' && action === 'complete') return json(response, publicFile(await transfers.complete(id, actor.id)));
        }
        const fileMatch = pathname.match(/^\/api\/files\/([a-f0-9-]{36})\/download$/);
        if (fileMatch && ['GET', 'HEAD'].includes(request.method)) {
          const file = storage.state.files.find(item => item.id === fileMatch[1]);
          if (!file) throw error('No encontramos ese archivo.', 404);
          await fsp.access(transfers.file(file.id));
          let start = 0, end = file.size - 1, partial = false;
          const range = request.headers.range;
          if (range && (!request.headers['if-range'] || request.headers['if-range'] === `"${file.sha256}"`)) {
            const match = range.match(/^bytes=(\d*)-(\d*)$/);
            if (!match || (!match[1] && !match[2]) || file.size === 0) {
              response.setHeader('Content-Range', `bytes */${file.size}`); throw error('Rango no válido.', 416);
            }
            if (!match[1]) start = Math.max(0, file.size - Number(match[2]));
            else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size) {
              response.setHeader('Content-Range', `bytes */${file.size}`); throw error('Rango no válido.', 416);
            }
            partial = true;
          }
          const ascii = file.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
          response.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`);
          response.setHeader('Content-Type', 'application/octet-stream');
          response.setHeader('Accept-Ranges', 'bytes');
          response.setHeader('Cache-Control', 'private, no-store');
          response.setHeader('ETag', `"${file.sha256}"`);
          response.setHeader('Content-Length', file.size === 0 ? 0 : end - start + 1);
          if (partial) response.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
          response.writeHead(partial ? 206 : 200);
          if (request.method === 'HEAD' || !file.size) return response.end();
          const stream = fs.createReadStream(transfers.file(file.id), { start, end });
          response.on('close', () => stream.destroy());
          stream.on('error', () => response.destroy());
          return stream.pipe(response);
        }
        if (pathname === '/api/shutdown' && request.method === 'POST') {
          if (!actor.admin) throw error('Solo puedes hacer esto desde Windows.', 403);
          json(response, { ok: true }); setTimeout(() => close(), 100).unref(); return;
        }
        throw error('No encontramos esa operación.', 404);
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw error('Método no permitido.', 405);
      const asset = pathname === '/' ? 'index.html' : pathname === '/setup' ? 'setup.html' : pathname.slice(1);
      const allowed = new Set(['index.html', 'setup.html', 'app.js', 'setup.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'sw.js']);
      if (!allowed.has(asset)) throw error('No encontramos esa página.', 404);
      if (!request.socket.encrypted && !actor?.admin && asset === 'index.html') {
        response.writeHead(302, { Location: '/setup' }); return response.end();
      }
      response.setHeader('Cache-Control', 'no-cache');
      if (asset === 'sw.js') response.setHeader('Service-Worker-Allowed', '/');
      const mime = asset.endsWith('.png') ? 'image/png' : types[path.extname(asset)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime });
      if (request.method === 'HEAD') return response.end();
      const stream = fs.createReadStream(path.join(PUBLIC, asset));
      stream.on('error', () => response.destroy()); return stream.pipe(response);
    } catch (caught) {
      if (response.headersSent || response.destroyed) { response.destroy(); return; }
      const status = caught.status || (caught.code === 'ENOSPC' ? 507 : caught.code === 'ENOENT' ? 404 : 500);
      const message = caught.status ? caught.message : status === 507 ? 'No hay espacio disponible en Windows.' : status === 404 ? 'El archivo ya no está disponible.' : 'No pudimos completar la operación. Revisa el registro local de Brisa.';
      if (status === 500) console.error('[Brisa]', caught.message);
      json(response, { error: message }, status);
    }
  }
  const localServer = http.createServer(handler);
  const secureServer = https.createServer({ ...tls, minVersion: 'TLSv1.2' }, handler);
  for (const server of [localServer, secureServer]) {
    server.requestTimeout = 0;
    server.headersTimeout = 30000;
    server.setTimeout(120000);
    server.on('clientError', (_error, socket) => socket.destroy());
  }
  const listen = (server, port) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, options.bind || '0.0.0.0', () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
  try {
    info.httpPort = await listen(localServer, options.httpPort ?? 3210);
    info.httpsPort = await listen(secureServer, options.httpsPort ?? 3211);
  } catch (caught) {
    localServer.close(); secureServer.close(); throw caught;
  }
  if (options.discovery !== false && addresses.length) {
    try {
      const discoveryError = caught => { info.discovery = 'unavailable'; console.warn('[Brisa] No se pudo anunciar el nombre local:', caught.message); };
      info.discovery = 'starting';
      discovery = new Bonjour({ interface: addresses[0], bind: '0.0.0.0' }, discoveryError);
      discovery.server.mdns.on('error', discoveryError);
      const service = discovery.publish({ name: `Brisa ${storage.state.id.slice(0, 8)}`, host: hostname, type: 'https', port: info.httpsPort, disableIPv6: true, txt: { app: 'brisa', version: '1' } });
      const records = service.records.bind(service);
      // Advertising WSL/VPN addresses makes an iPhone try unreachable interfaces.
      service.records = () => records().filter(record => record.type !== 'A' || record.data === addresses[0]);
      service.once('up', () => { info.discovery = 'available'; });
    } catch (caught) { console.warn('[Brisa] Descubrimiento local no disponible:', caught.message); }
  }
  async function close() {
    if (stopping) return; stopping = true;
    if (discovery) { discovery.unpublishAll(); discovery.destroy(); }
    await Promise.all([localServer, secureServer].map(server => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); })));
  }
  return { info, storage, transfers, ca: tls.ca, close, localServer, secureServer };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createBrisa().then(app => {
    console.log(`Brisa · http://127.0.0.1:${app.info.httpPort}`);
    console.log(`iPhone · https://${app.info.hostname}:${app.info.httpsPort}`);
    const runtime = path.join(ROOT, '.brisa', 'runtime.json');
    fs.writeFileSync(runtime, JSON.stringify({ pid: process.pid, httpPort: app.info.httpPort, httpsPort: app.info.httpsPort }));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
  }).catch(caught => { console.error('Brisa no pudo iniciar:', caught.message); process.exitCode = 1; });
}
