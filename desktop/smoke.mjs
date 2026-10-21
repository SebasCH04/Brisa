import assert from 'node:assert/strict';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export async function runSmoke({ runtime, window, origin, reportPath, openedFolders }) {
  const headers = { 'X-Brisa-Client': '1', 'Content-Type': 'application/json' };
  const request = async (route, method = 'GET', data) => {
    const response = await fetch(`${origin}${route}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
    assert.ok(response.ok, `${method} ${route}: ${response.status}`); return response.json();
  };
  const token = crypto.randomBytes(32).toString('base64url');
  const phone = (route, method = 'GET', data) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: runtime.info.httpsPort, path: route, method, ca: runtime.ca,
      headers: { ...headers, Authorization: `Bearer ${token}` } }, res => {
      const chunks = []; res.on('data', part => chunks.push(part));
      res.on('end', () => { if (res.statusCode >= 400) reject(new Error(`HTTPS ${route}: ${res.statusCode}`)); else resolve(Buffer.concat(chunks)); });
    });
    req.on('error', reject); req.end(data === undefined ? undefined : JSON.stringify(data));
  });
  assert.equal((await request('/api/bootstrap')).admin, true);
  const proposal = JSON.parse(await phone('/api/pair', 'POST', { token, name: 'Prueba del paquete' }));
  await request(`/api/pair/${proposal.id}/approve`, 'POST');
  assert.equal(JSON.parse(await phone('/api/bootstrap')).authenticated, true);
  const bytes = crypto.randomBytes(131101);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const upload = await request('/api/uploads', 'POST', { name: 'prueba.zip', size: bytes.length, mime: 'application/zip' });
  const chunk = await fetch(`${origin}/api/uploads/${upload.id}/chunk?offset=0`, { method: 'PUT', headers: { 'X-Brisa-Client': '1', 'X-Content-SHA256': sha256 }, body: bytes });
  assert.ok(chunk.ok);
  assert.equal((await request(`/api/uploads/${upload.id}/complete`, 'POST')).sha256, sha256);
  assert.deepEqual(await phone(`/api/files/${upload.id}/download`), bytes);
  await request('/api/storage/reveal', 'POST', { id: upload.id });
  assert.equal(openedFolders.at(-1), path.dirname(runtime.transfers.file(upload.id)));
  const deadline = Date.now() + 15000;
  while (true) {
    const visible = await window.webContents.executeJavaScript('Boolean(document.querySelector("#appContent") && !document.querySelector("#appContent").hidden)');
    if (visible) break;
    if (Date.now() > deadline) throw new Error('La interfaz no inició.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await window.webContents.executeJavaScript('typeof require + ":" + typeof process'), 'undefined:undefined');
  const saved = path.join(runtime.storage.directory, 'saved-test.zip');
  const nativeDownload = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No se completó la descarga de escritorio.')), 15000);
    window.webContents.session.once('will-download', (_event, item) => {
      item.setSavePath(saved);
      item.once('done', (_done, state) => { clearTimeout(timeout); state === 'completed' ? resolve() : reject(new Error(`Descarga: ${state}`)); });
    });
  });
  await window.webContents.executeJavaScript(`(() => { const a = document.createElement('a'); a.href = '/api/files/${upload.id}/download'; a.download = 'prueba.zip'; document.body.append(a); a.click(); a.remove(); })()`);
  await nativeDownload;
  assert.deepEqual(fs.readFileSync(saved), bytes);
  assert.equal(window.webContents.getURL(), `${origin}/`);
  if (reportPath) fs.writeFileSync(`${reportPath}.png`, (await window.webContents.capturePage()).toPNG());
  return { checks: ['interfaz real', 'renderer aislado', 'certificado HTTPS validado', 'vinculación', 'envío y descarga con SHA-256', 'descarga nativa de Windows sin navegar', 'ruta de Abrir carpeta'] };
}
