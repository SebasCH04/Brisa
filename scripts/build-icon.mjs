import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = fs.readFileSync(new URL('../public/icon.svg', import.meta.url));
const sizes = [16, 32, 48, 256];
const images = sizes.map(width => new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((png, index) => {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = sizes[index] % 256;
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
fs.mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../build/icon.ico', import.meta.url), Buffer.concat([header, ...images]));
