import { app, BrowserWindow, Menu, Tray, dialog, shell, nativeImage, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createBrisa } from '../server.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const smoke = process.argv.includes('--self-test');
const reportPath = process.argv.find(arg => arg.startsWith('--self-test-report='))?.slice('--self-test-report='.length);
const home = smoke ? fs.mkdtempSync(path.join(os.tmpdir(), 'brisa-desktop-test-')) : path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Brisa');
for (const name of ['Profile', 'Logs']) fs.mkdirSync(path.join(home, name), { recursive: true });
app.setPath('userData', path.join(home, 'Profile'));
app.setAppUserModelId('com.sebasch04.brisa');
const logFile = path.join(home, 'Logs', 'desktop.log');
if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.old`);
function log(error) { fs.appendFileSync(logFile, `${new Date().toISOString()} ${error.stack || error}\n`); }
let runtime, window, tray, origin, quitting = false, restarting = false;
const openedFolders = [];
const show = () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } };
async function openFolder(folder) { const message = await shell.openPath(folder); if (message) throw new Error(message); }
function fail(error) {
  log(error);
  if (smoke) {
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ ok: false, error: error.message, temporaryDirectory: home }, null, 2));
    app.exit(1); return;
  }
  dialog.showErrorBox('Brisa', error.code === 'EADDRINUSE'
    ? 'Ya hay otra copia de Brisa usando la conexión. Cierra la versión anterior (Detener-Brisa.cmd si la abriste desde el repositorio) y vuelve a abrir Brisa.'
    : `No pudimos completar la operación.\n${error.message}\n\nRegistro: ${logFile}`);
}
async function start() {
  runtime = await createBrisa({ dataDir: path.join(home, 'Data'), openFolder: smoke ? async folder => { openedFolders.push(folder); } : openFolder,
    onShutdown: () => app.quit(), ...(smoke ? { httpPort: 0, httpsPort: 0, bind: '127.0.0.1', addresses: ['127.0.0.1'], discovery: false } : {}) });
  origin = `http://127.0.0.1:${runtime.info.httpPort}`;
}
function isDownload(value) {
  try { const url = new URL(value); return url.origin === origin && /^\/api\/files\/[a-f0-9-]{36}\/download$/.test(url.pathname) && !url.search && !url.username && !url.password; } catch { return false; }
}
function isSetup(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && [runtime.info.hostname, ...runtime.info.addresses, '127.0.0.1'].includes(url.hostname)
      && url.port === String(runtime.info.httpPort) && url.pathname === '/setup' && !url.search && !url.username && !url.password;
  } catch { return false; }
}
function external(value) { if (isSetup(value)) shell.openExternal(value).catch(fail); }
async function restart() {
  if (restarting || quitting) return;
  restarting = true;
  try { await runtime.close(); await start(); await window.loadURL(origin); show(); } catch (error) { fail(error); }
  finally { restarting = false; }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.on('activate', show);
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    Promise.resolve(runtime?.close()).catch(log).finally(() => { tray?.destroy(); app.quit(); });
  });
  app.whenReady().then(async () => {
    await start();
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', (event, item) => {
      if (!isDownload(item.getURL())) { event.preventDefault(); return; }
      item.setSaveDialogOptions({ title: 'Guardar archivo de Brisa' });
    });
    window = new BrowserWindow({ title: 'Brisa', width: 1180, height: 850, minWidth: 720, minHeight: 600,
      show: false, backgroundColor: '#101b21', icon: path.join(root, 'public', 'icon-512.png'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, navigateOnDragDrop: false } });
    window.on('close', event => { if (!quitting && !smoke) { event.preventDefault(); window.hide(); } });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('will-navigate', (event, value) => {
      if (value === `${origin}/` || isDownload(value)) return;
      event.preventDefault(); external(value);
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isDownload(url)) window.webContents.downloadURL(url); else external(url);
      return { action: 'deny' };
    });
    window.webContents.on('render-process-gone', (_event, details) => log(`Renderer: ${details.reason}`));
    if (!smoke) {
      tray = new Tray(nativeImage.createFromPath(path.join(root, 'public', 'icon-192.png')).resize({ width: 20, height: 20 }));
      tray.setToolTip('Brisa · lista para transferir');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Abrir Brisa', click: show },
        { label: 'Abrir archivos recibidos', click: () => openFolder(path.join(home, 'Data', 'files')).catch(fail) },
        { label: 'Reiniciar conexión', click: restart },
        { type: 'separator' },
        { label: `Brisa ${app.getVersion()}`, enabled: false },
        { label: 'Abrir registros', click: () => openFolder(path.join(home, 'Logs')).catch(fail) },
        { label: 'Salir de Brisa', click: () => app.quit() }
      ]));
      tray.on('double-click', show);
      window.once('ready-to-show', show);
    }
    await window.loadURL(origin);
    if (smoke) {
      const { runSmoke } = await import('./smoke.mjs');
      const result = await runSmoke({ runtime, window, origin, reportPath, openedFolders });
      if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ ok: true, version: app.getVersion(), packaged: app.isPackaged, platform: process.arch, electron: process.versions.electron, temporaryDirectory: home, ...result }, null, 2));
      app.quit();
    }
  }).catch(error => { fail(error); if (!smoke) app.quit(); });
}
