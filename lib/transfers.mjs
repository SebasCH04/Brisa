import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeName, writeJson } from './storage.mjs';
import { moveFile, recoverMove } from './file-move.mjs';

export const CHUNK_SIZE = 4 * 1024 * 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export class Transfers {
  constructor(storage) {
    this.storage = storage;
    this.uploads = new Map();
    this.busy = new Set();
    const folder = path.join(storage.directory, 'uploads');
    for (const entry of fs.readdirSync(folder).filter(name => name.endsWith('.json'))) {
      const meta = JSON.parse(fs.readFileSync(path.join(folder, entry), 'utf8'));
      if (!/^[a-f0-9-]{36}$/.test(meta.id)) throw new Error('Identificador de transferencia inválido.');
      if (safeName(meta.name) !== meta.name || (meta.directory && !path.isAbsolute(meta.directory))) throw new Error('Ubicación de transferencia inválida.');
      if (storage.state.files.some(file => file.id === meta.id)) {
        fs.rmSync(path.join(folder, entry), { force: true });
        continue;
      }
      const part = this.part(meta.id);
      if (fs.existsSync(part)) {
        const length = fs.statSync(part).size;
        // An interrupted metadata write must never create gaps or duplicated bytes.
        meta.offset = Math.min(meta.offset, length);
        fs.truncateSync(part, meta.offset);
        this.uploads.set(meta.id, meta);
      } else if (fs.existsSync(this.file(meta.id, meta.name, meta.directory)) && meta.offset === meta.size) {
        // Recover a crash between the final rename and saving the file index.
        meta.offset = 0;
        recoverMove(this.file(meta.id, meta.name, meta.directory), part);
        meta.offset = meta.size;
        this.uploads.set(meta.id, meta);
      }
    }
  }
  part(id) { return path.join(this.storage.directory, 'uploads', `${id}.part`); }
  meta(id) { return path.join(this.storage.directory, 'uploads', `${id}.json`); }
  file(id, name, directory) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw fail('Identificador de archivo inválido.');
    const item = this.storage.state.files.find(item => item.id === id) || this.uploads.get(id);
    name ||= item?.name;
    directory ||= item?.directory || path.join(this.storage.directory, 'files');
    if (!name) throw new Error('El archivo no tiene un nombre registrado.');
    if (safeName(name) !== name || !path.isAbsolute(directory)) throw fail('Ubicación de archivo inválida.');
    return path.join(directory, id, name);
  }
  persist(meta) { writeJson(this.meta(meta.id), meta); }
  create(input, owner) {
    if (!Number.isSafeInteger(input.size) || input.size < 0) throw fail('El tamaño no es válido.');
    if ([...this.uploads.values()].filter(upload => upload.owner === owner).length >= 100) {
      throw fail('Hay demasiados archivos pendientes. Cancela algunos antes de continuar.', 409);
    }
    const meta = {
      id: crypto.randomUUID(), name: safeName(input.name), size: input.size,
      mime: typeof input.mime === 'string' ? input.mime.slice(0, 150) : '',
      lastModified: Number.isFinite(input.lastModified) ? input.lastModified : 0,
      owner, ...(path.relative(path.join(this.storage.directory, 'files'), this.storage.filesDirectory) ? { directory: this.storage.filesDirectory } : {}),
      offset: 0, chunks: [], createdAt: new Date().toISOString()
    };
    fs.writeFileSync(this.part(meta.id), Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    this.persist(meta); this.uploads.set(meta.id, meta);
    return meta;
  }
  get(id, owner) {
    const item = this.uploads.get(id);
    if (!item || item.owner !== owner) throw fail('No encontramos esa transferencia.', 404);
    return item;
  }
  async chunk(id, owner, offset, request, expectedHash) {
    const meta = this.get(id, owner);
    if (this.busy.has(id)) throw fail('Ese archivo ya se está procesando.', 409);
    if (!Number.isSafeInteger(offset) || offset !== meta.offset) throw fail('El progreso cambió. Actualiza y reintenta.', 409);
    if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) throw fail('Falta la verificación del bloque.');
    this.busy.add(id);
    try {
      const chunks = []; let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > CHUNK_SIZE || length > meta.size - meta.offset) throw fail('El bloque supera el tamaño permitido.', 413);
        chunks.push(chunk);
      }
      if (!length) throw fail('El bloque está vacío.');
      const bytes = Buffer.concat(chunks, length);
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (digest !== expectedHash) throw fail('El bloque llegó incompleto o alterado. Reintenta.', 422);
      const handle = await fsp.open(this.part(id), 'r+');
      try {
        let written = 0;
        while (written < bytes.length) {
          const result = await handle.write(bytes, written, bytes.length - written, meta.offset + written);
          if (!result.bytesWritten) throw new Error('No se pudo escribir el archivo.');
          written += result.bytesWritten;
        }
        await handle.sync();
      } finally { await handle.close(); }
      meta.offset += length;
      meta.chunks.push({ size: length, sha256: digest });
      this.persist(meta);
      return meta;
    } finally { this.busy.delete(id); }
  }
  async complete(id, owner) {
    const existing = this.storage.state.files.find(item => item.id === id && item.owner === owner);
    if (existing) return existing;
    const meta = this.get(id, owner);
    if (this.busy.has(id)) throw fail('Ese archivo ya se está procesando.', 409);
    if (meta.offset !== meta.size) throw fail('Todavía faltan partes del archivo.', 409);
    this.busy.add(id);
    try {
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(this.part(id))) hash.update(chunk);
      const file = { ...meta, sha256: hash.digest('hex'), completedAt: new Date().toISOString() };
      delete file.offset;
      delete file.chunks;
      fs.mkdirSync(path.dirname(this.file(id)), { recursive: true, mode: 0o700 });
      await moveFile(this.part(id), this.file(id));
      this.storage.state.files.unshift(file);
      try { this.storage.save(); } catch (error) {
        this.storage.state.files.shift(); await moveFile(this.file(id), this.part(id)); throw error;
      }
      this.uploads.delete(id);
      fs.rmSync(this.meta(id), { force: true });
      return file;
    } finally { this.busy.delete(id); }
  }
  cancel(id, owner) {
    this.get(id, owner);
    if (this.busy.has(id)) throw fail('Espera a que termine el bloque actual.', 409);
    fs.rmSync(this.part(id), { force: true });
    fs.rmSync(this.meta(id), { force: true });
    this.uploads.delete(id);
  }
}
