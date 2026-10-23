import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBrisa } from '../server.mjs';

const temporaryRoot = await fs.realpath(os.tmpdir());

let app, dataDir;
test.beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(temporaryRoot, 'brisa-settings-ui-'));
  app = await createBrisa({ dataDir, httpPort: 0, httpsPort: 0, bind: '127.0.0.1', discovery: false, addresses: ['127.0.0.1'] });
});
test.afterAll(async () => {
  await app?.close();
  if (dataDir) {
    expect(path.dirname(path.resolve(dataDir))).toBe(temporaryRoot);
    expect(path.basename(dataDir).startsWith('brisa-settings-ui-')).toBe(true);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('ajustes: tema persistente, sistema en vivo, pestañas sincronizadas y preferencia propia del iPhone', async ({ browser }, testInfo) => {
  const desktopContext = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 1000 } });
  const phoneContext = await browser.newContext({ colorScheme: 'dark', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  const desktop = await desktopContext.newPage(); const phone = await phoneContext.newPage();
  const errors = [];
  for (const page of [desktop, phone]) page.on('pageerror', error => errors.push(error.message));
  await desktop.goto(`http://127.0.0.1:${app.info.httpPort}`);
  await expect(desktop.locator('html')).toHaveAttribute('data-theme', 'light');
  await desktop.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(desktop.getByRole('radio', { name: 'Sistema', exact: true })).toBeChecked();
  await desktop.getByRole('radio', { name: 'Oscuro', exact: true }).check();
  await expect(desktop.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(desktop.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#111b18');
  await desktop.screenshot({ path: testInfo.outputPath('settings-desktop-dark.png'), fullPage: true });
  await desktop.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(desktop.locator('#settingsDialog')).not.toBeVisible();
  await expect(desktop.getByRole('button', { name: 'Ajustes', exact: true })).toBeFocused();
  await desktop.reload();
  await expect(desktop.locator('html')).toHaveAttribute('data-theme', 'dark');
  const sibling = await desktopContext.newPage(); await sibling.goto(desktop.url());
  await expect(sibling.locator('html')).toHaveAttribute('data-theme', 'dark');
  await desktop.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await desktop.getByRole('radio', { name: 'Claro', exact: true }).check();
  await expect(sibling.locator('html')).toHaveAttribute('data-theme', 'light');
  await desktop.getByRole('radio', { name: 'Sistema', exact: true }).check();
  await desktop.emulateMedia({ colorScheme: 'dark' });
  await expect(desktop.locator('html')).toHaveAttribute('data-theme', 'dark');
  await desktop.emulateMedia({ colorScheme: 'light' });
  await expect(desktop.locator('html')).toHaveAttribute('data-theme', 'light');
  await desktop.getByRole('radio', { name: 'Oscuro', exact: true }).check();
  await desktop.keyboard.press('Escape');
  await expect(desktop.locator('#settingsDialog')).not.toBeVisible();

  await phone.goto(`https://127.0.0.1:${app.info.httpsPort}`);
  await expect(phone.locator('html')).toHaveAttribute('data-theme', 'dark');
  await phone.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await phone.screenshot({ path: testInfo.outputPath('settings-phone-dark.png'), fullPage: true });
  await phone.getByRole('radio', { name: 'Claro', exact: true }).check();
  await expect(phone.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(desktop.locator('html')).toHaveAttribute('data-theme', 'dark');
  await phone.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
  await phone.reload();
  await expect(phone.locator('html')).toHaveAttribute('data-theme', 'light');
  await phone.setViewportSize({ width: 320, height: 568 });
  await phone.getByRole('button', { name: 'Ajustes', exact: true }).click();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await phone.locator('#settingsDialog').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
  await phone.getByRole('radio', { name: 'Oscuro', exact: true }).check();
  await phone.getByRole('button', { name: 'Listo', exact: true }).click();
  await phone.goto(`https://127.0.0.1:${app.info.httpsPort}/setup`);
  await expect(phone.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
  await desktopContext.close(); await phoneContext.close();
});

test('ajustes sigue disponible si el navegador bloquea el almacenamiento local', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  await context.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${app.info.httpPort}`);
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('radio', { name: 'Oscuro', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#themeStorageWarning')).toBeVisible();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.locator('#appContent')).toBeVisible();
  await context.close();
});

test('iPhone: cabecera compacta, fondo continuo y ajustes sin textos decorativos ni aro amarillo', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, colorScheme: 'dark', ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Version/27.0 Mobile/15E148 Safari/604.1' });
  const page = await context.newPage();
  await page.goto(`https://127.0.0.1:${app.info.httpsPort}`);
  await page.getByLabel('Nombre de este dispositivo').fill('iPhone visual');
  await page.getByRole('button', { name: 'Conectar con mi computadora' }).click();
  await expect(page.locator('#pairCode')).toHaveText(/\d{6}/);
  const headers = { 'X-Brisa-Client': '1' };
  const info = await (await context.request.get(`http://127.0.0.1:${app.info.httpPort}/api/bootstrap`, { headers })).json();
  const pending = info.pending.find(item => item.name === 'iPhone visual');
  expect(pending).toBeTruthy();
  await context.request.post(`http://127.0.0.1:${app.info.httpPort}/api/pair/${pending.id}/approve`, { headers });
  await expect(page.locator('#appContent')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#connectionText')).toHaveText('Conectado con Windows');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => window.BrisaTheme.set(theme), theme);
    for (const width of [320, 375, 393, 430]) {
      await page.setViewportSize({ width, height: 852 });
      const pill = await page.locator('#connectionPill').boundingBox();
      const button = await page.locator('#settingsButton').boundingBox();
      expect(Math.abs(pill.y + pill.height / 2 - button.y - button.height / 2)).toBeLessThan(1);
      expect(pill.x + pill.width).toBeLessThan(button.x);
      expect(button.x + button.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const colors = await page.evaluate(() => ['html', 'body', '.shell', '.sidebar', 'main'].map(selector => getComputedStyle(document.querySelector(selector)).backgroundColor));
      expect(new Set(colors).size).toBe(1);
    }
    await page.setViewportSize({ width: 393, height: 852 });
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', theme === 'dark' ? '#18261f' : '#f1f4ec');
    await page.screenshot({ path: testInfo.outputPath(`iphone-transfer-${theme}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Ajustes', exact: true }).tap();
    await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).toBeFocused();
    await expect(page.locator('#settingsDialog')).not.toContainText('A TU MANERA');
    await expect(page.locator('#settingsDialog')).not.toContainText('Haz de Brisa tu espacio.');
    const close = page.getByRole('button', { name: 'Cerrar ajustes', exact: true });
    expect(await close.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
    await page.screenshot({ path: testInfo.outputPath(`iphone-settings-${theme}.png`), fullPage: true });
    await close.tap();
    await expect(page.locator('#settingsDialog')).not.toBeVisible();
  }
  await page.getByRole('button', { name: 'Ajustes', exact: true }).tap();
  // Keyboard users can still reach the close control and see a themed focus cue.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cerrar ajustes', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await context.close();
});
