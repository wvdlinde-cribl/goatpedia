#!/usr/bin/env node
// Print the field names the site parses out of each log sample of an entry.
//   node scripts/fields.js <id>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('../site/parse.js');
const { parseLog } = globalThis.SecpediaParse;
const id = process.argv[2];
if (!id) { console.error('usage: node scripts/fields.js <id>'); process.exit(2); }
const e = yaml.load(fs.readFileSync(path.join(ROOT, 'entries', `${id}.yaml`), 'utf8'));
for (const l of e.logs || []) {
  try {
    const rows = parseLog(l);
    console.log(`${l.type} [${l.format}] ${rows.length} fields`);
    for (const r of rows) console.log(`  ${r.name} = ${String(r.value).slice(0, 60)}`);
  } catch (x) { console.log(`${l.type} [${l.format}] PARSE ERROR: ${x.message}`); }
}
