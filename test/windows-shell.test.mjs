import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openWindowsFolder } from '../lib/windows-shell.mjs';

test('el auxiliar de Windows recibe la carpeta como argumento literal y espera su resultado', async () => {
  const folder = "C:\\Brisa\\recibidos de mamá & prueba's";
  let call;
  await openWindowsFolder(folder, (executable, args, options) => {
    call = { executable, args, options };
    const child = new EventEmitter(); child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0)); return child;
  });
  assert.match(call.executable, /WindowsPowerShell.*powershell\.exe$/);
  assert.equal(call.args.at(-1), folder);
  assert.equal(call.args.at(-2), '-Folder');
  assert.ok(call.args.includes('-File')); assert.ok(!call.args.includes('-Command'));
  assert.equal(call.options.windowsHide, true);
  await assert.rejects(openWindowsFolder(folder, () => {
    const child = new EventEmitter(); child.stderr = new EventEmitter();
    queueMicrotask(() => { child.stderr.emit('data', Buffer.from('No se pudo abrir')); child.emit('close', 1); });
    return child;
  }), /No se pudo abrir/);
});
