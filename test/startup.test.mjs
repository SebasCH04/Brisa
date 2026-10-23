import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createStartup } from '../desktop/startup.mjs';

const temporaryRoot = fs.realpathSync(os.tmpdir());

test('inicio con Windows: ruta estable con espacios, segundo plano y activación solo bajo petición', () => {
  const calls = []; let enabled = false;
  const app = { isPackaged: true, getLoginItemSettings: options => { calls.push(['get', options]); return { openAtLogin: enabled, executableWillLaunchAtLogin: enabled }; }, setLoginItemSettings: options => { calls.push(['set', options]); enabled = options.openAtLogin; } };
  const startup = createStartup(app, { executable: 'C:\\Mis programas\\Brisa.exe', platform: 'win32' });
  assert.equal(startup.get().enabled, false); assert.equal(calls.filter(([kind]) => kind === 'set').length, 0);
  assert.equal(startup.set(true).enabled, true);
  const written = calls.find(([kind]) => kind === 'set')[1];
  assert.equal(written.path, 'C:\\Mis programas\\Brisa.exe'); assert.deepEqual(written.args, ['--background']); assert.equal(written.enabled, true);
  assert.equal(startup.set(false).enabled, false);
  const smoke = createStartup(app, { smoke: true, platform: 'win32' });
  assert.equal(smoke.get().supported, false); assert.throws(() => smoke.set(true), /ejecutable/);
});

test('actualizar el portátil conserva la autorización y respeta el inicio desactivado desde Windows', t => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'brisa-startup-test-'));
  t.after(() => { assert.equal(path.dirname(directory), temporaryRoot); assert.ok(path.basename(directory).startsWith('brisa-startup-test-')); fs.rmSync(directory, { recursive: true, force: true }); });
  const settingsFile = path.join(directory, 'startup.json');
  const old = path.join(directory, 'Brisa antigua.exe'); const current = path.join(directory, 'Brisa nueva.exe');
  fs.writeFileSync(settingsFile, JSON.stringify({ executable: old }));
  let approved = true; const writes = [];
  const app = { isPackaged: true,
    getLoginItemSettings: options => ({ openAtLogin: options.path === old, executableWillLaunchAtLogin: options.path === old && approved }),
    setLoginItemSettings: options => writes.push(options)
  };
  createStartup(app, { settingsFile, executable: current, platform: 'win32' }).reconcile();
  assert.equal(writes.length, 1); assert.equal(writes[0].path, current); assert.equal(writes[0].openAtLogin, true);
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).executable, current);
  fs.writeFileSync(settingsFile, JSON.stringify({ executable: old })); approved = false;
  createStartup(app, { settingsFile, executable: current, platform: 'win32' }).reconcile();
  assert.equal(writes.length, 1);
});
