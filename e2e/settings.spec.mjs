import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBrisa } from '../server.mjs';

let app, dataDir;
test.beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brisa-settings-ui-'));
  app = await createBrisa({ dataDir, httpPort: 0, httpsPort: 0, bind: '127.0.0.1', discovery: false, addresses: ['127.0.0.1'] });
});
test.afterAll(async () => {
  await app?.close();
  if (dataDir) {
    expect(path.dirname(path.resolve(dataDir))).toBe(path.resolve(os.tmpdir()));
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
