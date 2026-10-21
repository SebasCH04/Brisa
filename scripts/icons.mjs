import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'public', 'icon.svg'));
for (const width of [192, 512]) {
  fs.writeFileSync(path.join(root, 'public', `icon-${width}.png`), new Resvg(source, { fitTo: { mode: 'width', value: width } }).render().asPng());
}
console.log('Iconos de Brisa generados.');
