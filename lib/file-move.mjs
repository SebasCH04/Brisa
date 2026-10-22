import fs from 'node:fs';
import fsp from 'node:fs/promises';

// A destination on another drive cannot use rename. Keep the source until the
// copied bytes are flushed and atomically placed at the final name.
export async function moveFile(source, destination, rename = fsp.rename) {
  try { await rename(source, destination); return; }
  catch (error) { if (error.code !== 'EXDEV') throw error; }
  const temporary = `${destination}.brisa-copy`;
  try {
    const stat = await fsp.lstat(temporary);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('El destino temporal no es un archivo de Brisa.');
    await fsp.unlink(temporary);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
    const handle = await fsp.open(temporary, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    await fsp.rename(temporary, destination);
    await fsp.unlink(source);
  } catch (error) {
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
}

export function recoverMove(source, destination) {
  try { fs.renameSync(source, destination); }
  catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.unlinkSync(source);
  }
}
