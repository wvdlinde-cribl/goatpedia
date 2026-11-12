#!/usr/bin/env node
// Validate entries/*.yaml against the schema + cross-entry rules, then build dist/.
//   node scripts/build.js          → validate + write dist/
//   node scripts/build.js --check  → validate only (CI on pull requests)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import Ajv from 'ajv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

// CSV split that respects double quotes (same logic as site/app.js)
function csv(line) {
  const out = []; let cur = ''; let q = false;
  for (const c of line) {
    if (c === '"') { q = !q; cur += c; } else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

const categories = yaml.load(fs.readFileSync(path.join(ROOT, 'categories.yaml'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/entry.schema.json'), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);

const files = fs.readdirSync(path.join(ROOT, 'entries')).filter((f) => f.endsWith('.yaml')).sort();
const entries = [];
for (const f of files) {
  const file = `entries/${f}`;
  let e;
  try { e = yaml.load(fs.readFileSync(path.join(ROOT, file), 'utf8')); }
  catch (x) { err(file, `YAML parse error: ${x.message}`); continue; }
  if (!validate(e)) {
    for (const v of validate.errors) err(file, `${v.instancePath || '(root)'} ${v.message}${v.params?.allowedValues ? ' ' + JSON.stringify(v.params.allowedValues) : ''}${v.params?.additionalProperty ? ` "${v.params.additionalProperty}"` : ''}`);
    continue;
  }
  if (e.id !== f.replace(/\.yaml$/, '')) err(file, `id "${e.id}" must match file name`);
  if (!categories[e.category]) err(file, `unknown category "${e.category}" (see categories.yaml)`);
  for (const [i, l] of (e.logs || []).entries()) {
    const n = csv(l.sample).length;
    if (n !== l.fields.length) err(file, `logs[${i}] (${l.type}): sample has ${n} columns but ${l.fields.length} field names`);
    for (const k of [...(l.key || []), ...(l.noise || [])]) if (!l.fields.includes(k)) err(file, `logs[${i}] (${l.type}): key/noise field "${k}" not in fields`);
  }
  entries.push(e);
}
const ids = new Set(entries.map((e) => e.id));
for (const e of entries) for (const r of e.related || []) if (!ids.has(r)) err(`entries/${e.id}.yaml`, `related "${r}" does not exist`);

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}
const full = entries.filter((e) => e.status === 'full').length;
console.log(`✓ ${entries.length} entries valid (${full} full, ${entries.length - full} stubs)`);
if (CHECK) process.exit(0);

const dist = path.join(ROOT, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'site'), dist, { recursive: true });
fs.mkdirSync(path.join(dist, 'schema'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'schema/entry.schema.json'), path.join(dist, 'schema/entry.schema.json'));
fs.writeFileSync(path.join(dist, 'library.json'), JSON.stringify({ built: new Date().toISOString(), categories, entries }));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log(`✓ wrote dist/ (library.json ${(fs.statSync(path.join(dist, 'library.json')).size / 1024).toFixed(1)} KB)`);
