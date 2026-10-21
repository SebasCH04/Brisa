const $ = selector => document.querySelector(selector);
export function appConfirm({ title, message, accept = 'Confirmar' }) {
  const dialog = $('#confirmDialog');
  if (dialog.open) return Promise.resolve(false);
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmAccept').textContent = accept;
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}
const SESSION_KEY = 'brisa-session-v1';
const readSession = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (value && Number.isFinite(value.startedAt) && Array.isArray(value.files)) return value;
  } catch { /* Private browsing can disable storage. */ }
  return null;
};
export class ActivityUI {
  constructor({ api, toast, make, changed, reset }) {
    Object.assign(this, { api, toast, make, changed, reset });
    this.session = null;
    this.active = [];
    this.stream = null;
    this.latestTime = 0;
    $('#resetSession').addEventListener('click', async () => {
      if (!await appConfirm({ title: '¿Empezar una nueva sesión?', message: 'Se vaciará esta vista. Tus archivos guardados en Windows se conservarán.', accept: 'Nueva sesión' })) return;
      try {
        const info = await this.api('/api/bootstrap');
        this.stop(); this.session = null; this.latestTime = 0;
        try { sessionStorage.removeItem(SESSION_KEY); } catch { /* In-memory session still works. */ }
        this.start(info); this.reset(); this.changed();
        this.toast('Nueva sesión iniciada. Tu historial sigue guardado.');
      } catch (error) { this.toast(error.message, true); }
    });
  }
  start(info) {
    this.info = info;
    if (this.session && this.session.deviceId !== info.device.id) { this.stop(); this.session = null; }
    if (!this.session) {
      const previous = readSession();
      this.session = previous?.deviceId === info.device.id ? previous : {
        id: crypto.randomUUID(), deviceId: info.device.id, startedAt: info.serverTime,
        instance: info.activityInstance, cursor: info.activityCursor, files: []
      };
      if (this.session.instance !== info.activityInstance) { this.session.instance = info.activityInstance; this.session.cursor = 0; }
      delete this.session.notices; // Drop the former notification feed when restoring an older session.
      this.save(); this.render();
    }
    if (!this.stream && typeof EventSource !== 'undefined') {
      this.stream = new EventSource(`/api/events?instance=${encodeURIComponent(this.session.instance)}&after=${this.session.cursor}`);
      this.stream.onmessage = event => {
        try { this.ingest(JSON.parse(event.data)); } catch { /* A later snapshot or polling recovers missed data. */ }
      };
    }
  }
  stop() {
    this.stream?.close(); this.stream = null; this.active = [];
  }
  save() { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session)); } catch { /* Keep the current in-memory session. */ } }
  belongs(file) { return Boolean(this.session && (Date.parse(file.completedAt) >= this.session.startedAt || this.session.files.includes(file.id))); }
  query() { return `/api/activity?instance=${encodeURIComponent(this.session.instance)}&after=${this.session.cursor}`; }
  label(event) {
    const mine = event.actorId === this.info.device.id;
    switch (event.type) {
      case 'upload-started': return mine ? 'Enviando archivo' : this.info.admin ? 'Recibiendo archivo' : 'Preparando archivo en Windows';
      case 'upload-completed': return mine ? this.info.admin ? 'Archivo listo para tu iPhone' : 'Archivo enviado a Windows' : this.info.admin ? 'Archivo recibido' : 'Archivo disponible para descargar';
      case 'upload-cancelled': return 'Envío cancelado';
      default: return 'Actividad de transferencia';
    }
  }
  ingest(snapshot) {
    if (!this.session || snapshot.serverTime < this.latestTime) return;
    this.latestTime = snapshot.serverTime;
    if (snapshot.instance !== this.session.instance) { this.session.instance = snapshot.instance; this.session.cursor = 0; }
    for (const event of snapshot.events) {
      if (event.id <= this.session.cursor || event.at < this.session.startedAt) continue;
      if (['upload-completed', 'delivery-started', 'delivery-completed'].includes(event.type) && !this.session.files.includes(event.fileId)) this.session.files.push(event.fileId);
      if (!event.type.startsWith('delivery-')) this.toast(`${this.label(event)}: ${event.name}`);
    }
    this.session.cursor = Math.max(this.session.cursor, snapshot.cursor);
    this.active = snapshot.active;
    this.save(); this.render(); this.changed();
  }
  render() {
    if (!this.session) return;
    const incoming = this.active.filter(item => item.kind === 'delivery' || item.actorId !== this.info.device.id);
    this.renderActive($('#incomingList'), incoming);
  }
  renderActive(root, items) {
    root.replaceChildren();
    for (const item of items) {
      const card = this.make('article', 'live-transfer');
      const mine = item.actorId === this.info.device.id;
      const status = item.kind === 'delivery' ? mine ? 'Descargando' : 'Entregando al iPhone' : item.status === 'pending' ? 'Pendiente de reanudar' : item.status === 'verifying' ? 'Verificando archivo' : mine ? 'Enviando' : this.info.admin ? 'Recibiendo del iPhone' : 'Preparando desde Windows';
      card.append(this.make('strong', '', status), this.make('p', '', item.name));
      const progress = this.make('progress'); progress.max = item.total || 1; progress.value = Math.min(item.bytes, item.total);
      progress.setAttribute('aria-label', `${status}: ${item.name}`);
      const percent = item.total ? Math.min(100, Math.floor(item.bytes / item.total * 100)) : 0;
      card.append(progress, this.make('span', 'subtle', `${percent}%`)); root.append(card);
    }
  }
}
