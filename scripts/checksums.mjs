import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const directory = new URL('../dist/', import.meta.url);
const names = fs.readdirSync(directory).filter(name => /^Brisa-.*\.exe$/.test(name)).sort();
if (!names.length) throw new Error('No hay ejecutables para verificar.');
const lines = [];
for (const name of names) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(new URL(name, directory))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${path.basename(name)}`);
}
fs.writeFileSync(new URL('SHA256SUMS.txt', directory), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
