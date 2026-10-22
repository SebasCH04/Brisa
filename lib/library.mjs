import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export class Library {
  constructor(storage, transfers, options = {}) {
    Object.assign(this, { storage, transfers, options });
    this.readers = new Map(); this.deleting = new Set(); this.selecting = false;
  }
  lock(id) {
    if (this.deleting.has(id)) throw fail('Este archivo se está eliminando. Actualiza la lista.', 409);
    this.readers.set(id, (this.readers.get(id) || 0) + 1);
    let released = false;
    return () => {
      if (released) return; released = true;
      const count = this.readers.get(id) - 1;
      if (count) this.readers.set(id, count); else this.readers.delete(id);
    };
  }
  async summary() {
    let usedBytes = 0, pendingBytes = 0;
    const files = [];
    for (const file of this.storage.state.files) {
      let available = false, actualSize = 0;
      try {
        const stat = await fsp.lstat(this.transfers.file(file.id));
        available = stat.isFile() && !stat.isSymbolicLink();
        if (available) actualSize = stat.size;
      } catch (error) { if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
      usedBytes += actualSize;
      files.push({ id: file.id, name: file.name, size: file.size, actualSize, available, completedAt: file.completedAt });
    }
    for (const upload of this.transfers.uploads.values()) {
      try { pendingBytes += (await fsp.stat(this.transfers.part(upload.id))).size; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let freeBytes = null;
    try { const stats = await fsp.statfs(this.storage.filesDirectory); freeBytes = stats.bavail * stats.bsize; }
    catch { /* An external drive may currently be disconnected. */ }
    return { directory: this.storage.filesDirectory, defaultDirectory: path.join(this.storage.directory, 'files'), usedBytes, pendingBytes, freeBytes, files,
      canChooseDirectory: Boolean(this.options.chooseDirectory), deleteMode: this.options.trashFile ? 'trash' : 'permanent' };
  }
  async choose(reset = false) {
    if (this.selecting) throw fail('Ya hay una selección de carpeta abierta.', 409);
    if (!reset && !this.options.chooseDirectory) throw fail('Abre el programa de Windows para elegir la carpeta.', 409);
    this.selecting = true;
    try {
      const chosen = reset ? path.join(this.storage.directory, 'files') : await this.options.chooseDirectory(this.storage.filesDirectory);
      if (!chosen) return { cancelled: true, directory: this.storage.filesDirectory };
      if (typeof chosen !== 'string' || !path.isAbsolute(chosen)) throw fail('Elige una carpeta válida.');
      const destination = await fsp.realpath(chosen);
      const data = await fsp.realpath(this.storage.directory);
      const relative = path.relative(data, destination);
      if (relative !== 'files' && (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)))) throw fail('Elige una carpeta fuera de los datos internos de Brisa.');
      if (!(await fsp.stat(destination)).isDirectory()) throw fail('El destino no es una carpeta.');
      const probe = path.join(destination, `.brisa-write-test-${crypto.randomUUID()}`);
      try {
        const handle = await fsp.open(probe, 'wx', 0o600); await handle.close(); await fsp.unlink(probe);
      } catch { throw fail('Brisa no puede escribir en esa carpeta. Revisa sus permisos.', 409); }
      const previous = this.storage.state.settings;
      this.storage.state.settings = { ...previous, receiveDirectory: destination };
      try { this.storage.save(); } catch (error) { this.storage.state.settings = previous; throw error; }
      return { cancelled: false, directory: destination };
    } finally { this.selecting = false; }
  }
  async remove(id) {
    const file = this.storage.state.files.find(item => item.id === id);
    if (!file) throw fail('No encontramos ese archivo.', 404);
    if (this.deleting.has(id) || this.readers.has(id) || this.transfers.busy.has(id)) throw fail('El archivo está en uso. Espera a que termine la transferencia.', 409);
    this.deleting.add(id);
    try {
      const filename = this.transfers.file(id);
      let exists = true;
      try {
        const parent = await fsp.lstat(path.dirname(filename));
        if (!parent.isDirectory() || parent.isSymbolicLink()) throw fail('La ubicación cambió. No se ha eliminado ningún archivo.', 409);
        const stat = await fsp.lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink()) throw fail('La ubicación cambió. No se ha eliminado ningún archivo.', 409);
      } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
      if (exists) {
        if (this.options.trashFile) await this.options.trashFile(filename);
        else await fsp.unlink(filename);
      }
      const previousFiles = this.storage.state.files;
      const previousHidden = this.storage.state.historyHiddenIds;
      this.storage.state.files = previousFiles.filter(item => item.id !== id);
      if (previousHidden) this.storage.state.historyHiddenIds = previousHidden.filter(item => item !== id);
      try { this.storage.save(); }
      catch (error) { this.storage.state.files = previousFiles; this.storage.state.historyHiddenIds = previousHidden; throw error; }
      // Only remove the now-empty UUID directory; never recurse into a chosen folder.
      await fsp.rmdir(path.dirname(filename)).catch(() => {});
      return { ok: true, missing: !exists };
    } finally { this.deleting.delete(id); }
  }
}
