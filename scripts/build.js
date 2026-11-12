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

await import('../site/parse.js');
const { parseLog } = globalThis.SecpediaParse;

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
    const at = `logs[${i}] (${l.type})`;
    if ((l.format === 'csv' || l.format === 'tsv') && !l.fields) { err(file, `${at}: format ${l.format} needs fields`); continue; }
    let rows;
    try { rows = parseLog(l); } catch (x) { err(file, `${at}: sample does not parse as ${l.format}: ${x.message}`); continue; }
    if (l.fields && (l.format === 'csv' || l.format === 'tsv') && rows.length !== l.fields.length) err(file, `${at}: sample has ${rows.length} columns but ${l.fields.length} field names`);
    const names = new Set(rows.map((r) => r.name));
    for (const k of [...(l.key || []), ...(l.noise || [])]) if (!names.has(k)) err(file, `${at}: key/noise field "${k}" is not in the parsed sample`);
  }
  const sts = new Set(e.sourcetypes.map((s) => s.st));
  for (const [i, l] of (e.logs || []).entries()) if (!sts.has(l.sourcetype)) err(file, `logs[${i}] sourcetype "${l.sourcetype}" is not listed under sourcetypes`);
  entries.push(e);
}
const ids = new Set(entries.map((e) => e.id));
for (const e of entries) for (const r of e.related || []) if (!ids.has(r)) err(`entries/${e.id}.yaml`, `related "${r}" does not exist`);

// Coverage: every Pack Generator sourcetype maps to an entry that lists it, or is skipped with a reason.
const cov = yaml.load(fs.readFileSync(path.join(ROOT, 'coverage/pack-generator.yaml'), 'utf8'));
const byEntry = new Map(entries.map((e) => [e.id, new Set(e.sourcetypes.map((s) => s.st))]));
for (const [st, target] of Object.entries(cov.sourcetypes)) {
  if (target && typeof target === 'object' && target.skip) continue;
  if (!byEntry.has(target)) err('coverage/pack-generator.yaml', `${st} → "${target}" is not an entry`);
  else if (!byEntry.get(target).has(st)) err(`entries/${target}.yaml`, `does not list Pack Generator sourcetype "${st}" (see coverage/pack-generator.yaml)`);
}

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
const covered = Object.values(cov.sourcetypes).filter((t) => typeof t === 'string').length;
console.log(`✓ Pack Generator coverage: ${covered} sourcetypes mapped, ${Object.keys(cov.sourcetypes).length - covered} skipped`);
const built = new Date().toISOString();
const stamp = built.replace(/\D/g, '');
for (const rel of ['index.html', 'app.js']) {
  const p = path.join(dist, rel);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('__BUILD__', stamp));
}
fs.writeFileSync(path.join(dist, 'library.json'), JSON.stringify({ built, categories, entries }));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log(`✓ wrote dist/ (library.json ${(fs.statSync(path.join(dist, 'library.json')).size / 1024).toFixed(1)} KB)`);
