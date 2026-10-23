import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createBrisa } from '../server.mjs';

const temporaryRoot = await fs.realpath(os.tmpdir());

let app, dataDir;
const openedFolders = [];
async function expectInsideViewport(page) {
  const overflow = await page.evaluate(() => {
    const selectors = '.file-row,.file-info,.file-name,.file-meta,.file-actions,.upload-row,.upload-top,.upload-status,.upload-detail,.task-actions,.toast,.live-transfer,.download-inline';
    return [...document.querySelectorAll(selectors)].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width && box.height && (box.left < -1 || box.right > innerWidth + 1);
    }).map(element => ({ className: element.className, text: element.textContent.slice(0, 100) }));
  });
  expect(overflow).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test.beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(temporaryRoot, 'brisa-ui-'));
  app = await createBrisa({ dataDir, httpPort: 0, httpsPort: 0, bind: '127.0.0.1', discovery: false, addresses: ['127.0.0.1'], openFolder: async folder => { openedFolders.push(folder); } });
});
test.afterAll(async () => {
  await app?.close();
  if (dataDir) {
    expect(path.dirname(path.resolve(dataDir))).toBe(temporaryRoot);
    expect(path.basename(dataDir).startsWith('brisa-ui-')).toBe(true);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
test('vincular, enviar en ambos sentidos, descargar y recuperar la identidad', async ({ browser }) => {
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  // Only the automated browser bypasses certificate trust. Real iPhone setup installs the local CA.
  const phoneContext = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Version/27.0 Mobile/15E148 Safari/604.1' });
  // Windows cannot show the iOS share sheet. Exercise the real fetch/storage flow,
  // capturing exactly the File passed to the native boundary instead.
  await phoneContext.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    Object.defineProperty(navigator, 'canShare', { value: data => data.files?.[0] instanceof File });
    Object.defineProperty(navigator, 'share', { value: async data => {
      window.shareActivation = navigator.userActivation.isActive;
      window.sharedName = data.files[0].name;
      window.sharedHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await data.files[0].arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    } });
  });
  const desktop = await desktopContext.newPage(); const phone = await phoneContext.newPage();
  const pageErrors = []; const failedResponses = []; const nativeDialogs = []; const toastMessages = [];
  for (const page of [desktop, phone]) {
    page.on('console', message => { if (message.text().startsWith('BRISA_QA_TOAST:')) toastMessages.push(message.text().slice('BRISA_QA_TOAST:'.length)); });
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const toast = document.querySelector('#toast');
      if (toast) new MutationObserver(() => console.debug(`BRISA_QA_TOAST:${toast.textContent}`)).observe(toast, { childList: true, subtree: true, characterData: true });
    }));
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', async dialog => {
      nativeDialogs.push({ phone: page === phone, type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });
    page.on('response', response => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });
  }
  await desktop.goto(`http://127.0.0.1:${app.info.httpPort}`);
  await expect(desktop.getByRole('heading', { name: 'De un lado al otro.' })).toBeVisible();
  await desktop.getByRole('button', { name: /Conectar iPhone/ }).click();
  await expect(desktop.locator('#qrImage')).toBeVisible();
  await expect.poll(() => desktop.locator('#qrImage').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const closeOffset = await desktop.locator('#closeConnect').evaluate(button => {
    const outer = button.getBoundingClientRect(); const inner = button.querySelector('svg').getBoundingClientRect();
    return Math.abs((outer.left + outer.width / 2) - (inner.left + inner.width / 2)) + Math.abs((outer.top + outer.height / 2) - (inner.top + inner.height / 2));
  });
  expect(closeOffset).toBeLessThan(1);
  await desktop.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await phone.goto(`https://127.0.0.1:${app.info.httpsPort}`);
  await expect(phone.getByRole('heading', { name: 'Un vínculo. Muchas idas y vueltas.' })).toBeVisible();
  await phone.getByLabel('Nombre de este dispositivo').fill('iPhone de prueba');
  await phone.getByRole('button', { name: 'Conectar con mi computadora' }).click();
  await expect(phone.locator('#pairCode')).toHaveText(/\d{6}/);
  await expect(desktop.getByText('iPhone de prueba quiere conectar')).toBeVisible({ timeout: 15000 });
  expect(await desktop.locator('.verification-code').innerText()).toBe(await phone.locator('#pairCode').innerText());
  await desktop.getByRole('button', { name: 'Vincular dispositivo', exact: true }).click();
  await expect(phone.getByRole('heading', { name: 'De un lado al otro.' })).toBeVisible({ timeout: 15000 });
  const fromPc = crypto.randomBytes(5 * 1024 * 1024 + 111);
  await desktop.locator('#fileInput').setInputFiles({ name: 'Desde Windows.zip', mimeType: 'application/zip', buffer: fromPc });
  await expect(desktop.locator('#fileList .file-row').filter({ hasText: 'Desde Windows.zip' })).toBeVisible({ timeout: 30000 });
  await expect(phone.locator('#fileList .file-row').filter({ hasText: 'Desde Windows.zip' })).toBeVisible({ timeout: 15000 });
  const phoneDownload = phone.locator('#fileList .file-row').filter({ hasText: 'Desde Windows.zip' }).getByRole('button', { name: 'Descargar' });
  const phoneUrl = phone.url();
  await phoneDownload.click();
  await expect(phone.locator('#downloadDialog')).toHaveCount(0);
  await expect.poll(() => phone.evaluate(() => window.sharedHash)).toBe(crypto.createHash('sha256').update(fromPc).digest('hex'));
  const temporaryCount = () => phone.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('brisa-downloads-v1');
    let count = 0; for await (const entry of directory.values()) if (entry.kind === 'file') count++;
    return count;
  });
  await expect.poll(() => phone.evaluate(() => window.sharedHash)).toBe(crypto.createHash('sha256').update(fromPc).digest('hex'));
  expect(await phone.evaluate(() => window.sharedName)).toBe('Desde Windows.zip');
  expect(await phone.evaluate(() => window.shareActivation)).toBe(true);
  await expect.poll(temporaryCount).toBe(0);
  expect(phone.url()).toBe(phoneUrl);
  expect(phoneContext.pages()).toHaveLength(1);
  await expect(phone.locator('#appContent')).toBeVisible();
  expect(toastMessages.filter(message => /entregad|entregando|descargando/i.test(message))).toEqual([]);
  await expect(desktop.getByRole('button', { name: /^Notificaciones/ })).toHaveCount(0);
  await expect(phone.locator('#notificationsDialog')).toHaveCount(0);
  const fromPhone = crypto.randomBytes(9 * 1024 * 1024 + 201);
  const phoneName = `Respaldo_del_iPhone_${'fotos-y-videos-'.repeat(10)}2026.zip`;
  await phone.route('**/api/uploads/*/chunk?offset=*', async route => {
    await new Promise(resolve => setTimeout(resolve, 400));
    await route.continue().catch(() => {});
  });
  const firstBlock = phone.waitForResponse(response => response.url().includes('/chunk?offset=0') && response.status() === 200);
  await phone.locator('#fileInput').setInputFiles({ name: phoneName, mimeType: 'application/zip', buffer: fromPhone });
  await firstBlock;
  await phone.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(phone.locator('.upload-status')).toHaveText('En pausa');
  await expect(desktop.locator('#incomingList')).toContainText(phoneName);
  for (const width of [320, 375, 393, 430]) {
    await phone.setViewportSize({ width, height: 852 });
    await expectInsideViewport(phone);
  }
  await phone.setViewportSize({ width: 393, height: 852 });
  await phone.reload();
  await expect(phone.getByRole('button', { name: 'Elegir original', exact: true })).toBeVisible();
  const wrongOriginal = Buffer.from(fromPhone); wrongOriginal[0] ^= 255;
  await phone.getByRole('button', { name: 'Elegir original', exact: true }).click();
  await phone.locator('#resumeInput').setInputFiles({ name: phoneName, mimeType: 'application/zip', buffer: wrongOriginal });
  await expect(phone.locator('#toast')).toContainText('no coincide');
  await expectInsideViewport(phone);
  await phone.getByRole('button', { name: 'Elegir original', exact: true }).click();
  await phone.locator('#resumeInput').setInputFiles({ name: phoneName, mimeType: 'application/zip', buffer: fromPhone });
  await expect(phone.locator('#fileList .file-row').filter({ hasText: phoneName })).toBeVisible({ timeout: 30000 });
  const desktopRow = desktop.locator('#fileList .file-row').filter({ hasText: phoneName });
  await expect(desktopRow).toBeVisible({ timeout: 15000 });
  const received = app.storage.state.files.find(file => file.name === phoneName);
  expect(await fs.readFile(app.transfers.file(received.id))).toEqual(fromPhone);
  const desktopDownloadEvent = desktop.waitForEvent('download');
  await desktopRow.getByRole('link', { name: 'Descargar' }).click();
  const desktopDownload = await desktopDownloadEvent;
  const desktopPath = path.join(dataDir, 'downloaded-from-iphone.zip');
  await desktopDownload.saveAs(desktopPath);
  expect(await fs.readFile(desktopPath)).toEqual(fromPhone);
  await desktopRow.getByRole('button', { name: /Abrir carpeta/ }).click();
  await expect(desktop.locator('#toast')).toContainText('Carpeta abierta');
  expect(openedFolders.at(-1)).toBe(path.dirname(app.transfers.file(received.id)));
  await desktop.getByRole('button', { name: /^Historial/ }).click();
  await desktop.locator('#openFolder').click();
  await expect(desktop.locator('#openFolder')).toHaveText('Abrir carpeta');
  expect(openedFolders.at(-1)).toBe(path.join(dataDir, 'files'));
  await desktop.screenshot({ path: 'artifacts/brisa-historial.png', fullPage: true });
  await desktop.getByRole('button', { name: /Transferir/ }).click();
  await phone.reload();
  await expect(phone.locator('#appContent')).toBeVisible();
  await expect(phone.locator('#pairingScreen')).toBeHidden();
  for (const width of [320, 375, 393, 430]) {
    await phone.setViewportSize({ width, height: 852 });
    await expectInsideViewport(phone);
  }
  await phone.setViewportSize({ width: 393, height: 852 });
  await fs.mkdir('artifacts', { recursive: true });
  await desktop.screenshot({ path: 'artifacts/brisa-windows.png', fullPage: true });
  await phone.screenshot({ path: 'artifacts/brisa-iphone.png', fullPage: true });
  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
  expect(toastMessages.filter(message => /entregad|entregando|descargando/i.test(message))).toEqual([]);
  expect(toastMessages.some(message => message.includes('Archivo recibido'))).toBe(true);
  expect(nativeDialogs).toEqual([]);
  await desktopContext.close(); await phoneContext.close();
});

test('historial, sesión que sobrevive a recargas y confirmaciones dentro de Brisa', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const base = `http://127.0.0.1:${app.info.httpPort}`;
  const headers = { 'X-Brisa-Client': '1' };
  const pairingContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const proposalResponse = await pairingContext.request.post(`https://127.0.0.1:${app.info.httpsPort}/api/pair`, { headers, data: { token: crypto.randomBytes(32).toString('base64url'), name: 'iPhone de avisos' } });
  const proposal = await proposalResponse.json();
  await context.request.post(`${base}/api/pair/${proposal.id}/approve`, { headers });
  await pairingContext.close();
  const create = await context.request.post(`${base}/api/uploads`, { headers, data: { name: 'Archivo-de-una-sesion-anterior.zip', size: 0 } });
  const file = await create.json();
  await context.request.post(`${base}/api/uploads/${file.id}/complete`, { headers });
  const page = await context.newPage(); const nativeDialogs = []; const errors = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await expect(page.locator('#appContent')).toBeVisible();
  await expect(page.locator('#fileList .file-row')).toHaveCount(0);
  await page.getByRole('button', { name: /^Historial/ }).click();
  const historicalRow = page.locator('#historyList .file-row').filter({ hasText: 'Archivo-de-una-sesion-anterior.zip' });
  await expect(historicalRow).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await historicalRow.getByRole('link', { name: 'Descargar' }).click();
  await (await downloadEvent).saveAs(path.join(dataDir, 'historical-download.zip'));
  await page.getByRole('button', { name: /Transferir/ }).click();
  await expect(page.locator('#fileList .file-row')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#fileList .file-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Notificaciones/ })).toHaveCount(0);
  await expect(page.locator('#notificationsDialog')).toHaveCount(0);
  await expectInsideViewport(page);
  await page.getByRole('button', { name: 'Nueva sesión', exact: true }).click();
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await page.locator('#confirmDialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('#fileList .file-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Nueva sesión', exact: true }).click();
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#fileList .file-row')).toHaveCount(0);
  await page.getByRole('button', { name: /^Historial/ }).click();
  await expect(historicalRow).toBeVisible();
  await page.getByRole('button', { name: /Mis dispositivos/ }).click();
  const deviceCount = app.storage.state.devices.length;
  if (deviceCount) {
    await page.getByRole('button', { name: 'Olvidar dispositivo', exact: true }).first().click();
    await expect(page.locator('#confirmDialog')).toBeVisible();
    await page.locator('#confirmDialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    expect(app.storage.state.devices.length).toBe(deviceCount);
  }
  for (const width of [320, 375, 393, 430]) {
    await page.setViewportSize({ width, height: 852 }); await expectInsideViewport(page);
  }
  const current = await (await context.request.post(`${base}/api/uploads`, { headers, data: { name: 'Archivo-de-esta-sesion.zip', size: 0 } })).json();
  await context.request.post(`${base}/api/uploads/${current.id}/complete`, { headers });
  await page.getByRole('button', { name: /Transferir/ }).click();
  await expect(page.locator('#fileList .file-row')).toHaveCount(1);
  await page.getByRole('button', { name: /^Historial/ }).click();
  const historyBefore = await page.locator('#historyList .file-row').count();
  await page.getByRole('button', { name: 'Borrar historial', exact: true }).click();
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await page.locator('#confirmDialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('#historyList .file-row')).toHaveCount(historyBefore);
  await page.getByRole('button', { name: 'Borrar historial', exact: true }).click();
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#historyList .file-row')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /^Historial/ }).click();
  await expect(page.locator('#historyList .file-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Borrar historial', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Transferir/ }).click();
  await expect(page.locator('#fileList .file-row')).toHaveCount(1);
  expect(app.storage.state.files.length).toBeGreaterThan(0);
  expect(nativeDialogs).toEqual([]); expect(errors).toEqual([]);
  await context.close();
});

test('descarga desde Home Screen: cancelar, reintentar y errores conservan Brisa', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  const base = `https://127.0.0.1:${app.info.httpsPort}`, admin = `http://127.0.0.1:${app.info.httpPort}`;
  const headers = { 'X-Brisa-Client': '1' };
  const token = crypto.randomBytes(32).toString('base64url');
  const proposal = await (await context.request.post(`${base}/api/pair`, { headers, data: { token, name: 'iPhone Home Screen' } })).json();
  await context.request.post(`${admin}/api/pair/${proposal.id}/approve`, { headers });
  await context.request.post(`${base}/api/pair/status`, { headers, data: { token } });
  const payload = crypto.randomBytes(1024 * 1024 + 17);
  const name = `Foto_del_iPhone_${'nombre-largo-'.repeat(9)}áé.jpg`;
  const upload = await (await context.request.post(`${admin}/api/uploads`, { headers, data: { name, size: payload.length } })).json();
  await context.request.put(`${admin}/api/uploads/${upload.id}/chunk?offset=0`, { headers: { ...headers, 'X-Content-SHA256': crypto.createHash('sha256').update(payload).digest('hex') }, data: payload });
  await context.request.post(`${admin}/api/uploads/${upload.id}/complete`, { headers });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    window.canShareFile = true; window.shareMode = 'abort'; window.shareCalls = 0;
    Object.defineProperty(navigator, 'userActivation', { value: { isActive: false } });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => window.canShareFile && data.files?.[0] instanceof File });
    Object.defineProperty(navigator, 'share', { configurable: true, value: data => {
      window.shareCalls++; window.sharedMime = data.files[0].type;
      if (window.shareMode === 'abort') return Promise.reject(new DOMException('Cancelled', 'AbortError'));
      if (window.shareMode === 'error') return Promise.reject(new DOMException('Denied', 'NotAllowedError'));
      return Promise.resolve();
    } });
    window.originalGetDirectory = navigator.storage.getDirectory.bind(navigator.storage);
  });
  const page = await context.newPage(); const nativeDialogs = [], errors = [], navigations = [], downloads = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', download => downloads.push(download.url()));
  await page.goto(base);
  await expect(page.locator('#appContent')).toBeVisible();
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  await page.getByRole('button', { name: /^Historial/ }).click();
  const row = page.locator('#historyList .file-row').filter({ hasText: name });
  const button = row.locator('[data-download-id]');
  const status = row.locator('.download-inline');
  let mode = 'slow', requests = 0;
  await page.route(`**/api/files/${upload.id}/download`, async route => {
    requests++;
    if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 400));
    if (mode === 'network') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Windows no está disponible. Reintenta.' }) });
    if (mode === 'short') return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: payload.subarray(0, 20) });
    await route.continue().catch(() => {});
  });
  await button.click();
  await expect(row.locator('progress')).toBeVisible();
  await status.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(status).toBeHidden();
  await page.waitForTimeout(500); // Let the deliberately delayed, aborted request unwind.
  mode = 'network'; await button.click();
  await expect(status).toContainText('Windows no está disponible');
  await expect(button).toHaveText(/Reintentar/);
  mode = 'ok'; await button.click();
  await expect(button).toHaveText('Guardar ↓');
  const preparedRequests = requests;
  await button.click();
  await expect(status).toContainText('Guardado cancelado');
  expect(await page.evaluate(() => window.sharedMime)).toBe('image/jpeg');
  await page.evaluate(() => { window.shareMode = 'error'; });
  await button.click();
  await expect(status).toContainText('No se pudo abrir el guardado');
  for (const width of [320, 375, 393, 430]) {
    await page.setViewportSize({ width, height: 852 }); await expectInsideViewport(page);
  }
  await page.screenshot({ path: 'artifacts/brisa-guardar-en-fila.png', fullPage: true });
  await page.evaluate(() => { window.shareMode = 'success'; });
  await button.click();
  await expect(status).toBeHidden();
  expect(requests).toBe(preparedRequests);
  expect(await page.evaluate(() => window.shareCalls)).toBe(3);
  await page.evaluate(() => { window.canShareFile = false; });
  await button.click();
  await expect(status).toContainText('iOS no permite guardar');
  await status.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.evaluate(() => {
    window.canShareFile = true;
    Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: () => Promise.reject(new DOMException('Full', 'QuotaExceededError')) });
  });
  await button.click();
  await expect(status).toContainText('No hay espacio temporal');
  await status.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.evaluate(() => { Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: undefined }); });
  mode = 'short'; await button.click();
  await expect(status).toContainText('se interrumpió antes de terminar');
  mode = 'ok'; await button.click();
  await expect(button).toHaveText('Guardar ↓');
  await button.click(); // Memory fallback shares the file too.
  await expect(status).toBeHidden();
  await expect(page.locator('#downloadDialog')).toHaveCount(0);
  await page.getByRole('button', { name: /Transferir/ }).click();
  await expect(page.locator('#dropzone')).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  expect(page.url()).toBe(`${base}/`);
  expect(navigations).toEqual([]); expect(downloads).toEqual([]);
  expect(nativeDialogs).toEqual([]); expect(errors).toEqual([]);
  await context.close();
});
