import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/open-folder.ps1', import.meta.url));
export function openWindowsFolder(folder, launch = spawn) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Esta función requiere Windows.'));
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    // Hide the helper console; the folder is opened separately with ShellExecute and a normal window.
    const child = launch(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Folder', folder], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']
    });
    let detail = '';
    child.stderr?.on('data', chunk => { if (detail.length < 4096) detail += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill(); reject(new Error('Windows no respondió al abrir la carpeta.'));
    }, 12000);
    timer.unref();
    child.once('error', caught => { clearTimeout(timer); reject(caught); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(detail.trim() || 'Windows no pudo abrir la carpeta.'));
    });
  });
}
