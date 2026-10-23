import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBrisa } from '../server.mjs';

const temporaryRoot = await fs.realpath(os.tmpdir());

let app, directory, selected, enabled = false, failTrash = false;
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(temporaryRoot, 'brisa-storage-ui-'));
  selected = path.join(directory, 'Recibidos con espacios'); await fs.mkdir(selected);
  app = await createBrisa({ dataDir: path.join(directory, 'Data'), httpPort: 0, httpsPort: 0, bind: '127.0.0.1', discovery: false, addresses: ['127.0.0.1'],
    chooseDirectory: async () => selected,
    startup: { get: () => ({ supported: true, enabled }), set: value => ({ supported: true, enabled: enabled = value }) },
    trashFile: async filename => { if (failTrash) throw new Error('Trash failure'); await fs.rename(filename, path.join(directory, `${path.basename(path.dirname(filename))}.trash`)); }
  });
});
test.afterAll(async () => {
  await app?.close();
  if (directory) {
    expect(path.dirname(directory)).toBe(temporaryRoot); expect(path.basename(directory).startsWith('brisa-storage-ui-')).toBe(true);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test('Windows: elegir carpeta, recordar inicio, cancelar y confirmar eliminación con papelera', async ({ page }, testInfo) => {
  const errors = [], dialogs = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.goto(`http://127.0.0.1:${app.info.httpPort}`);
  await expect(page.locator('#appContent')).toBeVisible();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir carpeta', exact: true }).click();
  await expect(page.locator('#receiveDirectory')).toHaveText(selected);
  await page.getByRole('checkbox', { name: 'Iniciar con Windows', exact: true }).check();
  await expect(page.locator('#settingsStatus')).toContainText('se iniciará');
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Iniciar con Windows', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Iniciar con Windows', exact: true }).uncheck();
  await expect(page.locator('#settingsStatus')).toContainText('desactivado');
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  const filename = 'Un archivo para gestionar desde Ajustes.txt';
  const payload = Buffer.from('Conservar hasta confirmar la eliminación.');
  await page.locator('#fileInput').setInputFiles({ name: filename, mimeType: 'text/plain', buffer: payload });
  await expect(page.locator('#fileList')).toContainText(filename);
  const file = app.storage.state.files.find(file => file.name === filename);
  expect(await fs.readFile(path.join(selected, file.id, filename))).toEqual(payload);
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.locator('#storageSummary')).toContainText('1 archivo');
  await expect(page.locator('#storageFiles')).toContainText(filename);
  await page.locator(`[data-delete-file="${file.id}"]`).click();
  await expect(page.locator('#confirmMessage')).toContainText('papelera');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(await fs.readFile(app.transfers.file(file.id))).toEqual(payload);
  await expect(page.locator('#settingsDialog')).toBeVisible();
  failTrash = true;
  await page.locator(`[data-delete-file="${file.id}"]`).click();
  await page.getByRole('button', { name: 'Eliminar archivo', exact: true }).click();
  await expect(page.locator('#settingsStatus')).toHaveClass(/settings-error/);
  await expect(page.locator('#storageFiles')).toContainText(filename);
  failTrash = false;
  await page.screenshot({ path: testInfo.outputPath('storage-settings.png'), fullPage: true });
  await page.locator(`[data-delete-file="${file.id}"]`).click();
  await page.getByRole('button', { name: 'Eliminar archivo', exact: true }).click();
  await expect(page.locator('#storageEmpty')).toBeVisible();
  expect(await fs.readFile(path.join(directory, `${file.id}.trash`))).toEqual(payload);
  await page.getByRole('button', { name: 'Usar predeterminada', exact: true }).click();
  await expect(page.locator('#receiveDirectory')).toHaveText(path.join(directory, 'Data', 'files'));
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.locator('#fileList .file-row')).toHaveCount(0);
  expect(errors).toEqual([]); expect(dialogs).toEqual([]);
});
