import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const address = 'http://127.0.0.1:3210';
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
async function ready() {
  let response;
  try {
    response = await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(1000) });
  } catch { return false; }
  if (!response.ok) throw new Error('El puerto 3210 está ocupado por otra aplicación.');
  const health = await response.json();
  if (health.app !== 'brisa') throw new Error('El puerto 3210 está ocupado por otra aplicación.');
  const info = await fetch(`${address}/api/bootstrap`, { headers: { 'X-Brisa-Client': '1' }, signal: AbortSignal.timeout(2000) }).then(result => result.json());
  const runningRoot = info.projectPath || (info.storagePath && path.resolve(info.storagePath, '..', '..'));
  if (!runningRoot || path.resolve(runningRoot).toLowerCase() !== root.toLowerCase()) {
    throw new Error('Brisa sigue abierta desde otra carpeta. Abre Detener-Brisa.cmd y luego vuelve a iniciar desde este repositorio.');
  }
  if (health.version !== version) throw new Error('Hay una versión anterior de Brisa abierta. Abre Detener-Brisa.cmd y luego Iniciar-Brisa.cmd para aplicar la actualización.');
  return true;
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
