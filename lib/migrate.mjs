import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Copy only persistent data. Never reuse a running server's runtime/log files.
export function migrateData(source, destination) {
  source = fs.realpathSync(source);
  destination = path.resolve(destination);
  const within = (parent, child) => { const rel = path.relative(parent, child); return !rel || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
  if (within(source, destination) || within(destination, source)) throw new Error('Origen y destino deben ser carpetas separadas.');
  if (fs.existsSync(destination)) throw new Error('El destino ya existe. No se ha sobrescrito ningún dato.');
  const state = JSON.parse(fs.readFileSync(path.join(source, 'state.json'), 'utf8'));
  if (state.version !== 1 || typeof state.id !== 'string' || !Array.isArray(state.files) || !Array.isArray(state.devices)) throw new Error('Los datos de origen no son compatibles.');
  function inspect(file) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('No se pueden migrar enlaces ni archivos especiales.');
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) inspect(path.join(file, name));
  }
  const parts = ['state.json', 'files', 'uploads', 'certificates'].filter(name => fs.existsSync(path.join(source, name)));
  for (const part of parts) inspect(path.join(source, part));
  if (state.devices.length && (!fs.existsSync(path.join(source, 'certificates/root.crt')) || !fs.existsSync(path.join(source, 'certificates/root.key')))) throw new Error('Falta el certificado de los dispositivos vinculados.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  // Resolve the existing parent, so a junction cannot point the destination into source.
  if (within(source, fs.realpathSync(path.dirname(destination)))) throw new Error('El destino está dentro del origen.');
  const temporary = `${destination}.migration-${crypto.randomUUID()}`;
  fs.mkdirSync(temporary, { mode: 0o700 });
  try {
    for (const part of parts) fs.cpSync(path.join(source, part), path.join(temporary, part), { recursive: true, errorOnExist: true, force: false });
    const originalFiles = path.join(source, 'files');
    const isOriginal = value => typeof value === 'string' && path.isAbsolute(value) && path.relative(originalFiles, value) === '';
    let changed = false;
    for (const file of state.files) if (isOriginal(file.directory)) { delete file.directory; changed = true; }
    if (isOriginal(state.settings?.receiveDirectory)) { state.settings.receiveDirectory = path.join(destination, 'files'); changed = true; }
    if (changed) fs.writeFileSync(path.join(temporary, 'state.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
    const uploads = path.join(temporary, 'uploads');
    if (fs.existsSync(uploads)) for (const name of fs.readdirSync(uploads).filter(name => name.endsWith('.json'))) {
      const filename = path.join(uploads, name); const meta = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (isOriginal(meta.directory)) { delete meta.directory; fs.writeFileSync(filename, JSON.stringify(meta, null, 2), { mode: 0o600 }); }
    }
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return { files: state.files.length, devices: state.devices.length, destination };
}
