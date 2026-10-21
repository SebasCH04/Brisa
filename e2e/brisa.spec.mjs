import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createBrisa } from '../server.mjs';

let app, dataDir;
const openedFolders = [];
async function expectInsideViewport(page) {
  const overflow = await page.evaluate(() => {
    const selectors = '.file-row,.file-info,.file-name,.file-meta,.file-actions,.upload-row,.upload-top,.upload-status,.upload-detail,.task-actions,.toast,.live-transfer,.notification-card';
    return [...document.querySelectorAll(selectors)].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width && box.height && (box.left < -1 || box.right > innerWidth + 1);
    }).map(element => ({ className: element.className, text: element.textContent.slice(0, 100) }));
  });
  expect(overflow).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test.beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brisa-ui-'));
  app = await createBrisa({ dataDir, httpPort: 0, httpsPort: 0, bind: '127.0.0.1', discovery: false, addresses: ['127.0.0.1'], openFolder: async folder => { openedFolders.push(folder); } });
});
test.afterAll(async () => {
  await app?.close();
  if (dataDir) {
    expect(path.dirname(path.resolve(dataDir))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dataDir).startsWith('brisa-ui-')).toBe(true);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
test('vincular, enviar en ambos sentidos, descargar y recuperar la identidad', async ({ browser }) => {
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  // Only the automated browser bypasses certificate trust. Real iPhone setup installs the local CA.
  const phoneContext = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  const desktop = await desktopContext.newPage(); const phone = await phoneContext.newPage();
  const pageErrors = []; const failedResponses = []; const nativeDialogs = [];
  for (const page of [desktop, phone]) {
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
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
  const downloadEvent = phone.waitForEvent('download');
  await phone.locator('#fileList .file-row').filter({ hasText: 'Desde Windows.zip' }).getByRole('link', { name: 'Descargar' }).click();
  const download = await downloadEvent;
  const downloadedPath = path.join(dataDir, 'downloaded.zip'); await download.saveAs(downloadedPath);
  expect(await fs.readFile(downloadedPath)).toEqual(fromPc);
  await desktop.getByRole('button', { name: /^Notificaciones/ }).click();
  await expect(desktop.locator('#notificationList')).toContainText('Archivo entregado al iPhone');
  await desktop.getByRole('button', { name: 'Cerrar notificaciones' }).click();
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
  await page.getByRole('button', { name: /^Notificaciones/ }).click();
  await expect(page.locator('#notificationList')).toContainText('Archivo entregado a tu navegador');
  await expectInsideViewport(page);
  await page.screenshot({ path: 'artifacts/brisa-notificaciones.png' });
  await page.getByRole('button', { name: 'Cerrar notificaciones' }).click();
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
  expect(nativeDialogs).toEqual([]); expect(errors).toEqual([]);
  await context.close();
});
