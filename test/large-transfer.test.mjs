import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import { createBrisa } from '../server.mjs';
import { CHUNK_SIZE } from '../lib/transfers.mjs';

const temporaryRoot = await fs.realpath(os.tmpdir());

test('128 MiB: envío por bloques y descarga en streaming sin acumular el archivo completo', async t => {
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'brisa-large-'));
  const app = await createBrisa({ dataDir: directory, httpPort: 0, httpsPort: 0, bind: '127.0.0.1', discovery: false, addresses: ['127.0.0.1'] });
  t.after(async () => {
    await app.close();
    assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
    assert.ok(path.basename(directory).startsWith('brisa-large-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.info.httpPort}`;
  const headers = { 'X-Brisa-Client': '1' };
  const chunk = crypto.randomBytes(CHUNK_SIZE);
  const checksum = crypto.createHash('sha256').update(chunk).digest('hex');
  const expected = crypto.createHash('sha256');
  const created = await fetch(`${base}/api/uploads`, { method: 'POST', headers, body: JSON.stringify({ name: 'prueba-128MiB.zip', size: CHUNK_SIZE * 32 }) });
  assert.equal(created.status, 201); const { id } = await created.json();
  for (let block = 0; block < 32; block++) {
    const sent = await fetch(`${base}/api/uploads/${id}/chunk?offset=${block * CHUNK_SIZE}`, { method: 'PUT', headers: { ...headers, 'X-Content-SHA256': checksum }, body: chunk });
    assert.equal(sent.status, 200); assert.equal((await sent.json()).offset, (block + 1) * CHUNK_SIZE); expected.update(chunk);
  }
  const complete = await fetch(`${base}/api/uploads/${id}/complete`, { method: 'POST', headers });
  const metadata = await complete.json(); assert.equal(metadata.sha256, expected.digest('hex'));
  const received = crypto.createHash('sha256'); let length = 0;
  await new Promise((resolve, reject) => {
    http.get(`${base}/api/files/${id}/download`, response => {
      assert.equal(response.statusCode, 200);
      response.on('data', bytes => { length += bytes.length; received.update(bytes); });
      response.on('end', resolve); response.on('error', reject);
    }).on('error', reject);
  });
  assert.equal(length, CHUNK_SIZE * 32); assert.equal(received.digest('hex'), metadata.sha256);
});
