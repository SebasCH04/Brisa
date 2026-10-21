import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const address = 'http://127.0.0.1:3210';
async function ready() {
  try {
    const response = await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    return (await response.json()).app === 'brisa';
  } catch { return false; }
}
try {
  if (!await ready()) {
    const folder = path.join(root, '.brisa'); fs.mkdirSync(folder, { recursive: true });
    const log = fs.openSync(path.join(folder, 'brisa.log'), 'a');
    const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    child.on('error', error => { console.error('No se pudo iniciar Brisa:', error.message); process.exitCode = 1; });
    child.unref(); fs.closeSync(log);
    let online = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await ready()) { online = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!online) throw new Error('No pudo iniciar. Revisa .brisa/brisa.log y comprueba que los puertos 3210 y 3211 estén disponibles.');
  }
  if (!process.argv.includes('--no-open')) {
    const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const browser = spawn(command, [address], { detached: true, windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.log(`Abre ${address} en tu navegador.`));
    browser.unref();
  }
  console.log(`Brisa está lista: ${address}`);
  console.log('Para detenerla, abre Detener-Brisa.cmd.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
