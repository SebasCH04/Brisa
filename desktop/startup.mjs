import fs from 'node:fs';
import path from 'node:path';
import { writeJson } from '../lib/storage.mjs';

export function createStartup(app, { smoke = false, executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, platform = process.platform, settingsFile } = {}) {
  const supported = !smoke && app.isPackaged && platform === 'win32';
  const options = { path: executable, args: ['--background'] };
  let previousPath = executable;
  if (settingsFile) {
    try {
      const value = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (typeof value.executable === 'string' && path.isAbsolute(value.executable)) previousPath = value.executable;
    } catch { /* A new profile has no previous executable. */ }
  }
  return {
    get() {
      if (!supported) return { supported: false, enabled: false };
      const state = app.getLoginItemSettings({ ...options, path: previousPath });
      return { supported: true, enabled: state.openAtLogin && state.executableWillLaunchAtLogin, portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE) };
    },
    set(enabled) {
      if (!supported) throw Object.assign(new Error('Usa el ejecutable de Windows para configurar el inicio automático.'), { status: 409 });
      app.setLoginItemSettings({ ...options, name: 'com.sebasch04.brisa', openAtLogin: enabled, enabled });
      previousPath = executable;
      if (settingsFile) writeJson(settingsFile, { executable });
      return this.get();
    },
    reconcile() {
      // Keep an existing opt-in working after replacing/moving a portable build.
      // An entry disabled by Windows is deliberately left disabled.
      if (supported && previousPath !== executable && this.get().enabled) this.set(true);
    }
  };
}
