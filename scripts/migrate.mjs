import path from 'node:path';
import { migrateData } from '../lib/migrate.mjs';
const args = process.argv.slice(2);
const from = args.indexOf('--from'); const to = args.indexOf('--to');
if (from < 0 || !args[from + 1]) throw new Error('Cierra Brisa y usa: npm run migrate -- --from "ruta\\.brisa" [--to "ruta\\Data"]');
const destination = to >= 0 ? args[to + 1] : process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Brisa', 'Data');
if (!destination) throw new Error('Indica --to o ejecuta la migración desde Windows.');
try {
  const response = await fetch('http://127.0.0.1:3210/api/health', { signal: AbortSignal.timeout(1500) });
  if (response.ok) throw new Error('Cierra Brisa antes de migrar para conservar una copia consistente.');
} catch (error) { if (error.message.startsWith('Cierra Brisa')) throw error; }
console.log(migrateData(args[from + 1], destination));
