import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { moveFile } from '../lib/file-move.mjs';

test('otra unidad: conserva bytes, recupera una copia parcial y mantiene el original si falla el destino', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'brisa-move-test-'));
  t.after(async () => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('brisa-move-test-')); await fs.rm(directory, { recursive: true, force: true }); });
  const source = path.join(directory, 'source'); const destination = path.join(directory, 'target');
  const payload = crypto.randomBytes(1024 * 1024 + 7);
  await fs.writeFile(source, payload); await fs.writeFile(`${destination}.brisa-copy`, 'copia cortada');
  const differentDrive = async () => { throw Object.assign(new Error('Different volumes'), { code: 'EXDEV' }); };
  await moveFile(source, destination, differentDrive);
  assert.deepEqual(await fs.readFile(destination), payload);
  await assert.rejects(fs.access(source), { code: 'ENOENT' });
  await fs.writeFile(source, payload);
  await assert.rejects(moveFile(source, path.join(directory, 'missing', 'target'), differentDrive));
  assert.deepEqual(await fs.readFile(source), payload);
});
