import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migrateData } from '../lib/migrate.mjs';

test('migrar conserva identidad, certificados y bytes sin modificar el origen ni sobrescribir datos', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brisa-migration-test-'));
  t.after(() => { assert.equal(path.dirname(temporary), fs.realpathSync(os.tmpdir())); fs.rmSync(temporary, { recursive: true, force: true }); });
  const source = path.join(temporary, 'source'); const destination = path.join(temporary, 'Data');
  fs.mkdirSync(path.join(source, 'certificates'), { recursive: true });
  fs.mkdirSync(path.join(source, 'files', 'example'), { recursive: true });
  const state = { version: 1, id: 'same-identity', files: [{ id: 'example' }], devices: [{ id: 'phone' }] };
  fs.writeFileSync(path.join(source, 'state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(source, 'certificates/root.crt'), 'original certificate');
  fs.writeFileSync(path.join(source, 'certificates/root.key'), 'original key');
  fs.writeFileSync(path.join(source, 'files/example/file.zip'), Buffer.from([0, 255, 42]));
  fs.writeFileSync(path.join(source, 'runtime.json'), '{"pid":1}');
  assert.equal(migrateData(source, destination).files, 1);
  for (const file of ['state.json', 'certificates/root.crt', 'certificates/root.key', 'files/example/file.zip']) assert.deepEqual(fs.readFileSync(path.join(source, file)), fs.readFileSync(path.join(destination, file)));
  assert.equal(fs.existsSync(path.join(destination, 'runtime.json')), false);
  assert.throws(() => migrateData(source, destination), /ya existe/);
  assert.throws(() => migrateData(source, path.join(source, 'nested')), /separadas/);
  const linked = path.join(source, 'files', 'junction');
  fs.symlinkSync(path.join(source, 'certificates'), linked, 'junction');
  assert.throws(() => migrateData(source, path.join(temporary, 'Other')), /enlaces/);
  fs.unlinkSync(linked);
});

test('migración actualiza el destino predeterminado y conserva referencias a carpetas externas', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brisa-migration-test-'));
  t.after(() => { assert.equal(path.dirname(temporary), fs.realpathSync(os.tmpdir())); fs.rmSync(temporary, { recursive: true, force: true }); });
  const source = path.join(temporary, 'source'); const destination = path.join(temporary, 'Data');
  const external = path.join(temporary, 'external');
  fs.mkdirSync(path.join(source, 'files'), { recursive: true }); fs.mkdirSync(path.join(source, 'uploads'));
  fs.writeFileSync(path.join(source, 'state.json'), JSON.stringify({ version: 1, id: 'identity', devices: [], files: [{ id: 'default', directory: path.join(source, 'files') }, { id: 'external', directory: external }], settings: { receiveDirectory: path.join(source, 'files') } }));
  fs.writeFileSync(path.join(source, 'uploads', 'pending.json'), JSON.stringify({ directory: path.join(source, 'files') }));
  migrateData(source, destination);
  const state = JSON.parse(fs.readFileSync(path.join(destination, 'state.json'), 'utf8'));
  assert.equal(state.settings.receiveDirectory, path.join(destination, 'files'));
  assert.equal(state.files[0].directory, undefined); assert.equal(state.files[1].directory, external);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'uploads', 'pending.json'), 'utf8')).directory, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(source, 'state.json'), 'utf8')).files[0].directory, path.join(source, 'files'));
});
