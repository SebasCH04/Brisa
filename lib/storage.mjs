import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export function writeJson(file, value) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
export function openStorage(directory) {
  for (const part of ['', 'files', 'uploads', 'certificates']) {
    fs.mkdirSync(path.join(directory, part), { recursive: true, mode: 0o700 });
  }
  const stateFile = path.join(directory, 'state.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {
    version: 1, id: crypto.randomUUID(), name: 'Mi computadora', devices: [], files: []
  };
  if (state.version !== 1 || !Array.isArray(state.devices) || !Array.isArray(state.files)) {
    throw new Error('El archivo de datos de Brisa no es compatible. No se ha modificado.');
  }
  const save = () => writeJson(stateFile, state);
  save();
  return { directory, state, save };
}
export function safeName(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 240 || /[\\/\x00-\x1f]/.test(input)) {
    throw Object.assign(new Error('El nombre de archivo no es válido.'), { status: 400 });
  }
  let result = input.normalize('NFC').replace(/[<>:"|?*]/g, '_').replace(/[. ]+$/g, '') || 'archivo';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(result)) result = `_${result}`;
  return result;
}
