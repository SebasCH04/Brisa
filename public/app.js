import { ActivityUI, appConfirm } from './activity.js';
const $ = selector => document.querySelector(selector);
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const stored = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* The server cookie remains available. */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* No persistent storage. */ } }
};
let identity = stored.get('brisa-identity');
let state = null;
let tasks = [];
let pumping = false;
let loading = false;
let initialized = false;
let pendingPair = false;
let resumeTarget = null;
let toastTimer;
let fileSignature = '';
let deviceSignature = '';
let wakeLock;
let allFiles = [];
const bytes = amount => {
  if (!amount) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat('es', { maximumFractionDigits: index > 1 ? 1 : 0 }).format(amount / 1024 ** index)} ${units[index]}`;
};
function toast(message, failure = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').className = `toast${failure ? ' error' : ''}`;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, failure ? 10000 : 5500);
}
const authHeaders = () => ({ 'X-Brisa-Client': '1', ...(identity ? { Authorization: `Bearer ${identity}` } : {}) });
async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options, headers: { ...authHeaders(), ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'No pudimos completar la operación.'), { status: response.status });
  return result;
}
const activityUI = new ActivityUI({ api, toast, make,
  changed: () => { renderFiles(allFiles); renderTasks(); },
  reset: () => { tasks = tasks.filter(task => !['complete', 'cancelled'].includes(task.status)); renderTasks(); }
});
function showView(view) {
  $('#transferView').hidden = view !== 'transfer';
  $('#historyView').hidden = view !== 'history';
  $('#devicesView').hidden = view !== 'devices';
  $('#breadcrumb').textContent = `Mi espacio / ${{ transfer: 'Transferir', history: 'Historial', devices: 'Mis dispositivos' }[view]}`;
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
}
function configure(info) {
  state = info;
  $('#version').textContent = info.version;
  $('#connectionPill').classList.remove('offline');
  $('#connectionText').textContent = info.admin ? 'Tu espacio local' : info.authenticated ? 'Conectado con Windows' : 'Conexión cifrada';
  $('#pairingScreen').hidden = info.authenticated;
  $('#appContent').hidden = !info.authenticated;
  document.querySelectorAll('.desktop-only').forEach(element => { element.hidden = !info.admin; });
  $('#computerLabel').textContent = info.name;
  if (!info.authenticated) { activityUI.stop(); return; }
  activityUI.start(info);
  $('#phoneLabel').textContent = info.admin ? (info.devices?.find(device => device.online)?.name || info.devices?.[0]?.name || 'Tu iPhone') : info.device.name;
  $('#bridgeText').textContent = info.admin && !info.devices?.length ? 'El primer vínculo' : 'Todo queda en tu red';
  $('#dropTitle').textContent = info.admin ? 'De Windows a tu iPhone.' : 'De tu iPhone a Windows.';
  $('#dropHint').textContent = info.admin ? 'Arrastra o selecciona archivos. Después podrás descargarlos desde Brisa en tu iPhone.' : 'Selecciona fotos, videos o documentos. Se guardarán en tu computadora.';
  $('#chooseFiles').firstChild.textContent = info.admin ? 'Enviar al iPhone ' : 'Enviar a Windows ';
  $('#filesDescription').textContent = 'Archivos enviados o descargados desde que abriste Brisa. Recargar conserva esta sesión; los anteriores están en Historial.';
  $('#deviceCount').textContent = String(info.admin ? info.devices.length : 1);
  renderDevices();
  if (info.admin) {
    const select = $('#addressSelect');
    const urls = info.setupUrls;
    if (select.options.length !== urls.length || [...select.options].some((option, index) => option.value !== urls[index])) {
      select.replaceChildren(...urls.map((url, index) => {
        const option = make('option', '', index === 0 ? `Nombre estable · ${info.hostname}` : `Red local · ${new URL(url).hostname}`);
        option.value = url;
        return option;
      }));
      // An IP QR reaches initial setup even on routers that suppress mDNS.
      if (urls.length > 1) select.selectedIndex = 1;
      updateQr();
    }
  }
}
function renderDevices() {
  const signature = JSON.stringify([state.admin, state.devices, state.pending]);
  if (signature === deviceSignature) return;
  deviceSignature = signature;
  const list = $('#devicesList'); list.replaceChildren();
  const computer = make('article', 'device-card');
  computer.append(make('span', 'device-symbol', '▣'), make('strong', '', state.name), make('p', '', state.admin ? 'Esta computadora · Windows' : 'Computadora vinculada · Disponible'));
  list.append(computer);
  for (const device of state.devices || []) {
    const card = make('article', 'device-card');
    card.append(make('span', 'device-symbol', '▯'), make('strong', '', device.name), make('p', '', device.online ? 'Conectado ahora' : 'Vinculado · Sin conexión ahora'));
    const revoke = make('button', 'text-button', 'Olvidar dispositivo');
    revoke.addEventListener('click', async () => {
      if (!await appConfirm({ title: `¿Olvidar ${device.name}?`, message: 'Este dispositivo perderá el acceso. Para volver a conectar tendrá que solicitar autorización desde Brisa.', accept: 'Olvidar dispositivo' })) return;
      try { await api(`/api/devices/${device.id}`, { method: 'DELETE' }); await refresh(); toast('Dispositivo desvinculado.'); }
      catch (error) { toast(error.message, true); }
    });
    card.append(revoke); list.append(card);
  }
  const requests = $('#pendingList'); requests.replaceChildren();
  for (const item of state.pending || []) {
    const card = make('article', 'pending-card');
    card.append(make('strong', '', `${item.name} quiere conectar`), make('p', '', 'Aprueba solo si este código coincide con el que ves en tu iPhone.'), make('span', 'verification-code', item.code));
    const buttons = make('div', 'pending-actions');
    for (const [action, label, style] of [['approve', 'Vincular dispositivo', 'primary'], ['reject', 'Rechazar', 'secondary']]) {
      const button = make('button', style, label);
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await api(`/api/pair/${item.id}/${action}`, { method: 'POST' }); await refresh(); if (action === 'approve') toast('Vinculación guardada. No tendrás que repetirla en cada transferencia.'); }
        catch (error) { toast(error.message, true); button.disabled = false; }
      });
      buttons.append(button);
    }
    card.append(buttons); requests.append(card);
  }
}
function updateQr() {
  const target = $('#addressSelect').value;
  if (!target) return;
  $('#qrImage').src = `/api/qr?url=${encodeURIComponent(target)}`;
  // Images cannot carry the custom API header; the server authorizes loopback admin requests.
  $('#setupLink').href = target; $('#setupLink').textContent = target;
}
function renderFiles(files) {
  allFiles = files;
  const signature = JSON.stringify([files, activityUI.session?.id, activityUI.session?.files]);
  if (signature === fileSignature) return;
  fileSignature = signature;
  const sessionFiles = files.filter(file => activityUI.belongs(file));
  $('#emptyState').hidden = sessionFiles.length > 0;
  $('#historyEmpty').hidden = files.length > 0;
  $('#historyCount').textContent = String(files.length);
  $('#sessionCount').textContent = String(sessionFiles.length);
  renderFileList($('#fileList'), sessionFiles);
  renderFileList($('#historyList'), files);
}
function renderFileList(list, files) {
  list.replaceChildren();
  for (const file of files) {
    const row = make('article', 'file-row');
    row.append(fileIcon(file));
    const info = make('div', 'file-info');
    const name = make('span', 'file-name', file.name); name.title = file.name;
    const date = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(file.completedAt));
    const meta = make('p', 'file-meta', `${bytes(file.size)} · ${file.source === 'windows' ? 'Desde Windows' : 'Recibido en Windows'} · ${date}`);
    meta.title = `SHA-256: ${file.sha256}`;
    info.append(name, meta); row.append(info);
    const download = make('a', 'download-link', 'Descargar ↓');
    download.href = `/api/files/${file.id}/download`; download.download = file.name;
    download.addEventListener('click', () => toast('Tu navegador gestionará la descarga del archivo.'));
    const actions = make('div', 'file-actions');
    actions.append(download);
    if (state.admin) {
      const reveal = make('button', 'folder-link', 'Abrir carpeta ↗');
      reveal.addEventListener('click', () => revealFolder(file.id, reveal));
      actions.append(reveal);
    }
    row.append(actions);
    list.append(row);
  }
}
function fileIcon(file) {
  const extension = file.name.includes('.') ? file.name.split('.').pop().slice(0, 5).toUpperCase() : 'FILE';
  return make('span', `file-type${file.mime?.startsWith('image/') ? ' photo' : file.mime?.startsWith('video/') ? ' video' : ''}`, extension);
}
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const info = await api('/api/bootstrap');
    $('#offlineBanner').hidden = true;
    configure(info);
    if (info.authenticated) {
      renderFiles((await api('/api/files')).files);
      activityUI.ingest(await api(activityUI.query()));
      if (!initialized) {
        initialized = true;
        const result = await api('/api/uploads');
        for (const upload of result.uploads) {
          if (!tasks.some(task => task.id === upload.id)) tasks.push({ ...upload, status: 'selection', inFlight: 0, speed: 0 });
        }
        renderTasks();
        if (location.protocol === 'https:') {
          navigator.serviceWorker?.register('/sw.js').catch(() => {});
          navigator.storage?.persist?.().catch(() => {});
        }
      }
    }
  } catch {
    $('#offlineBanner').hidden = false;
    $('#connectionPill').classList.add('offline');
    $('#connectionText').textContent = 'Esperando conexión';
  } finally { loading = false; }
}
function token() {
  const array = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...array)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
async function requestPair(event) {
  event?.preventDefault();
  if (!$('#deviceName').value.trim()) { toast('Escribe un nombre para este dispositivo.', true); $('#deviceName').focus(); return; }
  if (!identity) { identity = token(); stored.set('brisa-identity', identity); }
  const button = $('#pairForm button'); button.disabled = true;
  try {
    const result = await api('/api/pair', { method: 'POST', body: JSON.stringify({ token: identity, name: $('#deviceName').value }) });
    if (result.approved) return refresh();
    pendingPair = true;
    $('#pairForm').hidden = true; $('#pairPending').hidden = false; $('#pairAgain').hidden = true;
    $('#pairCode').textContent = result.code;
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}
async function checkPair() {
  if (!pendingPair || !identity) return;
  try {
    const result = await api('/api/pair/status', { method: 'POST', body: JSON.stringify({ token: identity }) });
    if (result.approved) {
      pendingPair = false; await refresh();
      toast('Ya están conectados. Este dispositivo quedó recordado.');
    } else if (!result.pending) {
      pendingPair = false; $('#pairCode').textContent = '—'; $('#pairAgain').hidden = false;
      toast('La solicitud venció o fue rechazada. Puedes volver a solicitarla.', true);
    }
  } catch { /* Network status is displayed by refresh. */ }
}
const digest = async blob => {
  if (!crypto.subtle) throw new Error('Abre Brisa mediante su dirección HTTPS para enviar archivos.');
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
};
function renderTasks() {
  const visibleTasks = tasks.filter(task => !['complete', 'cancelled'].includes(task.status));
  $('#activitySection').hidden = !visibleTasks.length && !activityUI.active.length;
  const active = tasks.filter(task => !['complete', 'cancelled'].includes(task.status));
  $('#queueCount').textContent = active.length ? `${active.length} pendiente${active.length === 1 ? '' : 's'}` : state.admin ? 'Archivos preparados' : 'Todo guardado';
  const list = $('#uploadList'); list.replaceChildren();
  const status = { queued: 'En espera', preparing: 'Preparando', uploading: 'Enviando', paused: 'En pausa', error: 'Pendiente de reintento', selection: 'Elige el original', verifying: 'Comprobando el original', completing: 'Verificando en Windows', complete: state.admin ? 'Listo para el iPhone' : 'Guardado en Windows', cancelling: 'Cancelando' };
  for (const task of visibleTasks) {
    const row = make('article', 'upload-row'); row.append(fileIcon(task));
    const info = make('div', 'file-info'); const top = make('div', 'upload-top');
    const name = make('span', 'file-name', task.name); name.title = task.name;
    top.append(name, make('span', `upload-status${task.status === 'error' ? ' error' : ''}`, status[task.status] || task.status));
    const progress = make('progress'); progress.max = task.size || 1; progress.value = task.status === 'complete' ? task.size || 1 : task.offset + (task.inFlight || 0); progress.setAttribute('aria-label', `Progreso de ${task.name}`);
    const detail = make('div', 'upload-detail');
    const text = task.error || `${bytes(task.offset + (task.inFlight || 0))} de ${bytes(task.size)}${task.speed > 0 && task.status === 'uploading' ? ` · ${bytes(task.speed)}/s` : ''}`;
    detail.append(make('span', '', text));
    const actions = make('div', 'task-actions');
    if (['uploading', 'queued', 'preparing'].includes(task.status)) {
      const pause = make('button', '', 'Pausar'); pause.addEventListener('click', () => { task.pause = true; task.controller?.abort(); if (task.status === 'queued') { task.status = 'paused'; renderTasks(); } }); actions.append(pause);
    }
    if (['paused', 'error', 'selection'].includes(task.status)) {
      const resume = make('button', '', task.file ? 'Reintentar' : 'Elegir original');
      resume.addEventListener('click', () => {
        if (!task.file) { resumeTarget = task; $('#resumeInput').click(); }
        else { task.pause = false; task.error = ''; task.status = 'queued'; pump(); renderTasks(); }
      }); actions.append(resume);
    }
    if (!['complete', 'completing', 'cancelling'].includes(task.status)) {
      const cancel = make('button', 'cancel-task', 'Cancelar');
      cancel.addEventListener('click', () => cancelTask(task)); actions.append(cancel);
    }
    detail.append(actions); info.append(top, progress, detail); row.append(info); list.append(row);
  }
}
async function cancelTask(task) {
  task.cancel = true; task.pause = true; task.controller?.abort();
  if (['uploading', 'preparing', 'verifying'].includes(task.status)) { task.status = 'cancelling'; renderTasks(); return; }
  await finishCancel(task);
}
async function finishCancel(task) {
  try {
    if (task.id) {
      for (let attempt = 0; ; attempt++) {
        try { await api(`/api/uploads/${task.id}`, { method: 'DELETE' }); break; }
        catch (error) { if (error.status !== 409 || attempt >= 3) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
      }
    }
    task.status = 'cancelled'; task.file = null; task.error = '';
  } catch (error) { task.status = 'error'; task.error = error.message; task.cancel = false; task.pause = false; }
  renderTasks();
}
async function addFiles(files) {
  for (const file of files) tasks.push({ name: file.name, size: file.size, mime: file.type, lastModified: file.lastModified, file, offset: 0, inFlight: 0, speed: 0, status: 'queued' });
  renderTasks(); pump();
}
function sendChunk(task, blob, hash) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    task.controller = { abort: () => xhr.abort() };
    xhr.open('PUT', `/api/uploads/${task.id}/chunk?offset=${task.offset}`);
    xhr.timeout = 120000;
    for (const [key, value] of Object.entries(authHeaders())) xhr.setRequestHeader(key, value);
    xhr.setRequestHeader('X-Content-SHA256', hash);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    const started = performance.now(); let lastRender = 0;
    xhr.upload.onprogress = event => {
      task.inFlight = event.loaded;
      task.speed = event.loaded / Math.max((performance.now() - started) / 1000, .01);
      if (performance.now() - lastRender > 180) { lastRender = performance.now(); renderTasks(); }
    };
    xhr.onload = () => {
      let result; try { result = JSON.parse(xhr.responseText); } catch { return reject(new Error('Windows devolvió una respuesta incompleta.')); }
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else reject(Object.assign(new Error(result.error || 'El bloque no llegó a Windows.'), { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error('Se interrumpió la conexión. Puedes reintentar desde lo recibido.'));
    xhr.ontimeout = () => reject(new Error('La conexión tardó demasiado. Puedes reintentar.'));
    xhr.onabort = () => reject(Object.assign(new Error('Transferencia pausada.'), { name: 'AbortError' }));
    xhr.send(blob);
  });
}
async function acquireWakeLock() {
  try { if (navigator.wakeLock && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch { /* Not supported or denied by iOS. */ }
}
async function pump() {
  if (pumping) return;
  pumping = true;
  await acquireWakeLock();
  try {
    let task;
    while ((task = tasks.find(item => item.status === 'queued' && item.file))) {
      try {
        task.status = 'preparing'; renderTasks();
        if (!task.id) {
          const upload = await api('/api/uploads', { method: 'POST', body: JSON.stringify({ name: task.name, size: task.size, mime: task.mime, lastModified: task.lastModified }) });
          task.id = upload.id;
        }
        let current;
        try { current = await api(`/api/uploads/${task.id}`); }
        catch (error) {
          if (error.status === 404 && (await api('/api/files')).files.some(file => file.id === task.id)) {
            task.status = 'complete'; task.offset = task.size; task.file = null; task.error = '';
            renderTasks(); await refresh(); continue;
          }
          throw error;
        }
        task.offset = current.offset;
        if (task.cancel) { await finishCancel(task); continue; }
        let failures = 0;
        while (task.offset < task.size && !task.pause && !task.cancel) {
          task.status = 'uploading'; task.inFlight = 0; renderTasks();
          const blob = task.file.slice(task.offset, task.offset + state.chunkSize);
          const hash = await digest(blob);
          if (task.pause || task.cancel) break;
          try {
            const result = await sendChunk(task, blob, hash);
            task.offset = result.offset; task.inFlight = 0; failures = 0;
          } catch (error) {
            task.inFlight = 0;
            if (task.pause || task.cancel || error.name === 'AbortError') throw error;
            if (failures++ >= 2 || (error.status && ![409, 429, 500].includes(error.status))) throw error;
            await new Promise(resolve => setTimeout(resolve, failures * 1000));
            // The previous block may have been saved even if its response was lost.
            task.offset = (await api(`/api/uploads/${task.id}`)).offset;
          }
        }
        if (task.cancel) { await finishCancel(task); continue; }
        if (task.pause) { task.status = 'paused'; renderTasks(); continue; }
        task.status = 'completing'; renderTasks();
        await api(`/api/uploads/${task.id}/complete`, { method: 'POST', body: '{}' });
        task.status = 'complete'; task.file = null; task.error = '';
        renderTasks(); await refresh();
      } catch (error) {
        task.inFlight = 0;
        if (task.cancel) { await finishCancel(task); continue; }
        task.status = task.pause || error.name === 'AbortError' ? 'paused' : 'error';
        task.error = task.status === 'error' ? error.message : '';
        renderTasks();
      }
    }
  } finally {
    pumping = false;
    try { await wakeLock?.release(); } catch { /* Already released. */ }
    wakeLock = null;
  }
}
async function resumeFromSelection(file) {
  const task = resumeTarget; resumeTarget = null;
  if (!task || !file) return;
  if (file.size !== task.size) return toast('El tamaño no coincide. Elige el archivo original.', true);
  task.status = 'verifying'; task.file = file; task.error = ''; renderTasks();
  try {
    const current = await api(`/api/uploads/${task.id}`);
    let offset = 0;
    for (const chunk of current.chunks) {
      if (task.cancel) { await finishCancel(task); return; }
      if (await digest(file.slice(offset, offset + chunk.size)) !== chunk.sha256) throw new Error('Este archivo no coincide con las partes recibidas. Elige el original o cancela y envíalo de nuevo.');
      offset += chunk.size;
    }
    task.offset = current.offset; task.pause = false; task.status = 'queued'; renderTasks(); pump();
  } catch (error) { task.file = null; task.status = 'selection'; toast(error.message, true); renderTasks(); }
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('#chooseFiles').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', event => { addFiles([...event.target.files]); event.target.value = ''; });
$('#resumeInput').addEventListener('change', event => { resumeFromSelection(event.target.files[0]); event.target.value = ''; });
$('#pairForm').addEventListener('submit', requestPair);
$('#pairAgain').addEventListener('click', requestPair);
$('#refreshFiles').addEventListener('click', async () => { await refresh(); if ($('#offlineBanner').hidden) toast('Archivos actualizados.'); });
async function revealFolder(id, button) {
  const label = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Abriendo…'; }
  try {
    await api('/api/storage/reveal', { method: 'POST', body: JSON.stringify({ id }) });
    toast('Carpeta abierta en el Explorador de Windows.');
  }
  catch (error) { toast(error.message, true); }
  finally { if (button) { button.disabled = false; button.textContent = label; } }
}
$('#openFolder').addEventListener('click', event => revealFolder(undefined, event.currentTarget));
for (const id of ['connectButton', 'connectButtonDevices']) $( `#${id}`).addEventListener('click', () => $('#connectDialog').showModal());
$('#closeConnect').addEventListener('click', () => $('#connectDialog').close());
$('#addressSelect').addEventListener('change', updateQr);
for (const event of ['dragenter', 'dragover']) $('#dropzone').addEventListener(event, e => { e.preventDefault(); $('#dropzone').classList.add('dragover'); });
for (const event of ['dragleave', 'drop']) $('#dropzone').addEventListener(event, e => { e.preventDefault(); $('#dropzone').classList.remove('dragover'); });
$('#dropzone').addEventListener('drop', event => { if (state?.authenticated) addFiles([...event.dataTransfer.files]); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refresh(); checkPair(); if (pumping) acquireWakeLock(); } });
window.addEventListener('online', refresh);
await refresh();
setInterval(() => { refresh(); checkPair(); }, 3500);
