export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const MEMORY_LIMIT = 128 * 1024 * 1024;
const TEMP_DIRECTORY = 'brisa-downloads-v1';
const MIME = { zip: 'application/zip', pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', webp: 'image/webp', mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v', mp3: 'audio/mpeg', m4a: 'audio/mp4', txt: 'text/plain', csv: 'text/csv', json: 'application/json' };
const mimeFor = file => file.mime && file.mime !== 'application/octet-stream' ? file.mime : MIME[file.name.split('.').pop().toLowerCase()] || '';
const aborted = () => new DOMException('Descarga cancelada', 'AbortError');

// iOS Home Screen apps must never navigate to the attachment or a blob URL.
// Fetch in place and use the iOS sheet, with an inline Save action if activation expired.
export class DownloadsUI {
  constructor({ headers, bytes }) {
    Object.assign(this, { headers, bytes }); this.job = null;
    addEventListener('pagehide', () => this.close());
  }
  attach(button, info, meta) {
    button.dataset.downloadId = meta.id;
    button.addEventListener('click', () => this.open(meta));
    const status = document.createElement('div');
    status.className = 'download-inline'; status.dataset.downloadStatus = meta.id; status.hidden = true;
    const message = document.createElement('span'); message.className = 'download-message'; message.setAttribute('role', 'status');
    const progress = document.createElement('progress'); progress.setAttribute('aria-label', `Descargando ${meta.name}`);
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'cancel-download'; cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => this.close());
    status.append(message, progress, cancel); info.append(status);
  }
  open(meta) {
    if (this.job?.state === 'sharing') return;
    if (this.job?.meta.id === meta.id && this.job.file) { this.share(); return; }
    if (this.job?.meta.id === meta.id && this.job.state === 'preparing') return;
    this.close();
    const job = { meta, state: 'preparing', controller: new AbortController(), file: null };
    this.job = job;
    this.render(job, 'Preparando para guardar…'); this.prepare(job);
  }
  close() {
    const job = this.job;
    if (job?.state === 'sharing') return;
    this.job = null; this.render(null);
    if (!job) return;
    job.controller.abort();
    if (job.state !== 'preparing') this.cleanup(job);
  }
  render(job, message, failure = false) {
    if (this.job !== job) return;
    if (job && message !== undefined) { job.message = message; job.failure = failure; }
    for (const button of document.querySelectorAll('[data-download-id]')) {
      const current = job?.meta.id === button.dataset.downloadId ? job : null;
      button.disabled = current?.state === 'preparing' || current?.state === 'sharing';
      button.textContent = current?.state === 'preparing' ? 'Preparando…' : current?.state === 'sharing' ? 'Guardando…' : current?.file ? 'Guardar ↓' : current?.state === 'error' ? 'Reintentar ↓' : 'Descargar ↓';
    }
    for (const status of document.querySelectorAll('[data-download-status]')) {
      const current = job?.meta.id === status.dataset.downloadStatus ? job : null;
      status.hidden = !current || current.state === 'sharing';
      if (!current) continue;
      status.querySelector('.download-message').textContent = current.state === 'preparing' ? `${this.bytes(current.received || 0)} de ${this.bytes(current.meta.size)}` : current.message;
      status.classList.toggle('download-error', Boolean(current.failure));
      const progress = status.querySelector('progress'); progress.hidden = current.state !== 'preparing';
      progress.max = current.meta.size || 1; progress.value = current.received || 0;
      const cancel = status.querySelector('.cancel-download'); cancel.hidden = current.state === 'sharing';
      cancel.textContent = current.state === 'preparing' ? 'Cancelar' : 'Cerrar';
    }
  }
  async disk(job) {
    if (!navigator.storage?.getDirectory) return false;
    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(TEMP_DIRECTORY, { create: true });
      // Only expired files in Brisa's own temporary directory can be removed.
      for await (const [name, entry] of directory.entries()) {
        const match = /^(\d+)-[a-f0-9-]+\.part$/.exec(name);
        if (entry.kind === 'file' && match && Date.now() - Number(match[1]) > 86400000) await directory.removeEntry(name).catch(() => {});
      }
      if (job.controller.signal.aborted) throw aborted();
      job.directory = directory; job.tempName = `${Date.now()}-${crypto.randomUUID()}.part`;
      job.handle = await directory.getFileHandle(job.tempName, { create: true });
      if (!job.handle.createWritable) { await this.cleanup(job); return false; }
      job.writer = await job.handle.createWritable();
      return true;
    } catch (error) {
      await this.cleanup(job);
      if (job.controller.signal.aborted || error.name === 'QuotaExceededError') throw error;
      return false;
    }
  }
  async prepare(job) {
    try {
      if (!navigator.share || !navigator.canShare) throw new Error('iOS no ofrece el guardado de archivos en esta ventana. Abre Brisa con Safari actualizado y vuelve a intentarlo.');
      const disk = await this.disk(job);
      if (job.controller.signal.aborted) throw aborted();
      if (!disk && job.meta.size > MEMORY_LIMIT) throw new Error('El almacenamiento temporal no está disponible para este archivo grande. Libera espacio en el iPhone y vuelve a intentarlo.');
      const response = await fetch(`/api/files/${job.meta.id}/download`, { headers: this.headers(), credentials: 'same-origin', cache: 'no-store', signal: job.controller.signal });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || 'No pudimos recibir el archivo. Comprueba la conexión con Windows.');
      }
      if (!response.body) throw new Error('El navegador no pudo iniciar la recepción. Vuelve a intentarlo.');
      const reader = response.body.getReader(); const parts = []; job.received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (job.controller.signal.aborted) throw aborted();
          if (done) break;
          job.received += value.byteLength;
          if (job.received > job.meta.size) throw new Error('El tamaño recibido no coincide. Vuelve a descargar el archivo.');
          if (disk) await job.writer.write(value); else parts.push(value);
          if (!job.progressAt || performance.now() - job.progressAt > 120) {
            job.progressAt = performance.now();
            this.render(job, 'Recibiendo el archivo. Mantén Brisa abierta hasta que aparezca el botón para guardar.');
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (job.received !== job.meta.size) throw new Error('La descarga se interrumpió antes de terminar. Vuelve a intentarlo.');
      let blob;
      if (disk) {
        await job.writer.close(); job.writer = null;
        blob = await job.handle.getFile();
      } else blob = new Blob(parts);
      if (job.controller.signal.aborted) throw aborted();
      let file = new File([blob], job.meta.name, { type: mimeFor(job.meta) });
      if (!navigator.canShare({ files: [file] })) {
        // Some iOS file types are shareable only without a MIME hint.
        file = new File([blob], job.meta.name);
        if (!navigator.canShare({ files: [file] })) throw new Error('iOS no permite guardar este tipo o tamaño de archivo desde la app. Puedes enviarlo como ZIP e intentarlo de nuevo.');
      }
      job.file = file; job.state = 'ready';
      this.render(job, 'Listo. Toca Guardar para abrir las opciones de iOS.');
      if (navigator.userActivation?.isActive) this.share(true);
    } catch (error) {
      if (this.job === job && !job.controller.signal.aborted) {
        job.state = 'error';
        this.render(job, error.name === 'QuotaExceededError' ? 'No hay espacio temporal suficiente en el iPhone. Libera espacio y vuelve a intentarlo.' : error.message || 'La descarga se interrumpió. Comprueba la conexión y vuelve a intentarlo.', true);
      }
    } finally {
      if (this.job !== job || job.state === 'error') await this.cleanup(job);
    }
  }
  async share(automatic = false) {
    const job = this.job;
    if (!job?.file || job.state === 'sharing') return;
    job.state = 'sharing';
    try {
      // Run directly from the tap (or while its activation is still valid).
      const result = navigator.share({ files: [job.file] });
      this.render(job); await result;
      job.state = 'ready'; this.close();
    } catch (error) {
      job.state = 'ready';
      this.render(job, error.name === 'AbortError' ? 'Guardado cancelado. Toca Guardar para volver a intentarlo.' : automatic && error.name === 'NotAllowedError' ? 'Listo. Toca Guardar para abrir las opciones de iOS.' : 'No se pudo abrir el guardado. Toca Guardar para reintentar.', error.name !== 'AbortError' && !(automatic && error.name === 'NotAllowedError'));
    }
  }
  async cleanup(job) {
    if (job.writer) { await job.writer.abort().catch(() => {}); job.writer = null; }
    job.file = null;
    if (job.directory && job.tempName) await job.directory.removeEntry(job.tempName).catch(() => {});
    job.handle = null; job.tempName = null; job.directory = null;
  }
}
