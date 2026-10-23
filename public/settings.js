import { appConfirm } from './activity.js';
const $ = selector => document.querySelector(selector);
const dialog = $('#settingsDialog');
const choices = [...document.querySelectorAll('input[name="themePreference"]')];
let admin = false, settings = null, busy = false, sequence = 0;
function updateTheme() {
  for (const input of choices) input.checked = input.value === window.BrisaTheme.preference;
  $('#themeStorageWarning').hidden = window.BrisaTheme.persistent;
}
function feedback(text = '', error = false) {
  const target = $('#settingsStatus'); target.textContent = text; target.hidden = !text;
  target.classList.toggle('settings-error', error);
  if (text && error && dialog.open) target.scrollIntoView({ block: 'nearest' });
}
function size(amount) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = amount > 0 ? Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1) : 0;
  return `${new Intl.NumberFormat('es', { maximumFractionDigits: index > 1 ? 1 : 0 }).format(amount / 1024 ** index)} ${units[index]}`;
}
async function request(url, method = 'GET', data) {
  const response = await fetch(url, { method, cache: 'no-store', headers: { 'X-Brisa-Client': '1', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No pudimos guardar el ajuste.');
  return result;
}
function controls() {
  $('#chooseDirectory').disabled = busy || !settings?.storage.canChooseDirectory;
  $('#resetDirectory').disabled = busy || !settings || settings.storage.directory === settings.storage.defaultDirectory;
  $('#startWithWindows').disabled = busy || !settings?.startup.supported;
  $('#refreshStorage').disabled = busy;
  for (const button of document.querySelectorAll('[data-delete-file]')) button.disabled = busy;
}
function render() {
  if (!settings) { controls(); return; }
  const { storage, startup } = settings;
  $('#receiveDirectory').textContent = storage.directory;
  $('#folderPickerHint').hidden = storage.canChooseDirectory;
  $('#startWithWindows').checked = startup.enabled;
  $('#startupHint').hidden = startup.supported;
  $('#portableStartupHint').hidden = !startup.portable;
  $('#storageSummary').textContent = `${storage.files.length} ${storage.files.length === 1 ? 'archivo' : 'archivos'} · ${size(storage.usedBytes)} en archivos${storage.pendingBytes ? ` · ${size(storage.pendingBytes)} en envíos pendientes` : ''}`;
  $('#storageFree').textContent = storage.freeBytes === null ? 'La carpeta de destino no está disponible. Comprueba que la unidad esté conectada.' : `${size(storage.freeBytes)} disponibles en la unidad de destino.`;
  $('#deleteDescription').textContent = storage.deleteMode === 'trash' ? 'Eliminar mueve el archivo a la papelera de Windows y lo retira de Brisa en todos tus dispositivos.' : 'En el modo de navegador, eliminar borra el archivo definitivamente de Windows y lo retira de Brisa.';
  $('#storageEmpty').hidden = storage.files.length > 0;
  const list = $('#storageFiles'); list.replaceChildren();
  for (const file of storage.files) {
    const row = document.createElement('article'); row.className = 'storage-file';
    const info = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = file.name;
    const detail = document.createElement('p'); detail.textContent = file.available ? size(file.actualSize) : 'Archivo no disponible';
    info.append(name, detail);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'delete-file'; button.dataset.deleteFile = file.id;
    button.textContent = file.available ? 'Eliminar' : 'Quitar registro';
    button.setAttribute('aria-label', `${button.textContent} ${file.name}`);
    button.addEventListener('click', () => removeFile(file));
    row.append(info, button); list.append(row);
  }
  controls();
}
async function load() {
  const current = ++sequence;
  const result = await request('/api/settings');
  if (current !== sequence) return;
  settings = result; render();
}
async function action(work) {
  if (busy) return;
  busy = true; controls(); feedback();
  try { await work(); }
  catch (error) { feedback(error.message, true); render(); }
  finally { busy = false; controls(); }
}
async function removeFile(file) {
  if (busy) return;
  const message = !file.available ? 'El archivo no está disponible. Se quitará su registro de Brisa; no se borrará ningún archivo de una unidad desconectada.'
    : settings.storage.deleteMode === 'trash' ? 'Se moverá a la papelera de Windows y dejará de estar disponible en todos tus dispositivos. Las copias que hayas guardado aparte se conservan.'
      : 'Se borrará definitivamente de Windows y dejará de estar disponible en todos tus dispositivos. Esta acción no se puede deshacer desde Brisa.';
  if (!await appConfirm({ title: `¿${file.available ? 'Eliminar' : 'Quitar'} ${file.name}?`, message, accept: file.available ? 'Eliminar archivo' : 'Quitar registro' })) return;
  await action(async () => {
    await request(`/api/files/${file.id}`, 'DELETE');
    dispatchEvent(new Event('brisa-library-changed'));
    await load(); feedback(file.available ? 'Archivo eliminado de Brisa.' : 'Registro eliminado.');
  });
}
export function configureSettings(info) {
  const changed = admin !== info.admin; admin = info.admin;
  $('#desktopSettings').hidden = !admin;
  $('#phoneSettingsNote').hidden = admin || !info.authenticated;
  if (changed && admin && dialog.open) action(load);
}
$('#settingsButton').addEventListener('click', () => {
  updateTheme(); feedback(); dialog.showModal();
  $('#settingsTitle').focus({ preventScroll: true });
  if (admin) action(load);
});
$('#chooseDirectory').addEventListener('click', () => action(async () => {
  const result = await request('/api/settings/folder', 'POST');
  await load();
  if (!result.cancelled) feedback('La carpeta se usará para los nuevos archivos.');
}));
$('#resetDirectory').addEventListener('click', () => action(async () => {
  await request('/api/settings/folder/reset', 'POST'); await load(); feedback('Se usará la carpeta predeterminada para los nuevos archivos.');
}));
$('#startWithWindows').addEventListener('change', () => {
  const enabled = $('#startWithWindows').checked;
  action(async () => {
    settings.startup = await request('/api/settings/startup', 'PUT', { enabled }); render();
    feedback(settings.startup.enabled ? 'Brisa se iniciará en la bandeja con Windows.' : 'Inicio automático desactivado.');
  });
});
$('#refreshStorage').addEventListener('click', () => action(load));
for (const input of choices) input.addEventListener('change', () => { if (input.checked) window.BrisaTheme.set(input.value); });
addEventListener('brisa-theme-change', updateTheme);
updateTheme(); controls();
