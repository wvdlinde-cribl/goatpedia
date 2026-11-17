#!/usr/bin/env node
// Validate entries/*.yaml against the schema + cross-entry rules, then build dist/.
//   node scripts/build.js          → validate + write dist/
//   node scripts/build.js --check  → validate only (CI on pull requests)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import { createLogoResolver } from './logos.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

await import('../site/parse.js');
await import('../site/stream.js');
const { parse: parseJs } = await import('acorn');
const { fingerprint } = await import('./stream-fingerprint.mjs');
const { FUNCTIONS: STREAM_FUNCTIONS } = globalThis.GoatpediaStream;
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
  // Cribl Stream functions for optimizations: real function ids, a log that exists, and
  // expressions Cribl can load (ES5 only: no arrow functions, ?., ??, template literals).
  const es5 = (where, expr) => {
    try { parseJs(`(${expr})`, { ecmaVersion: 5 }); } catch (x) { err(file, `${where}: "${String(expr).slice(0, 60)}" is not an ES5 expression Cribl can load (${x.message})`); }
  };
  for (const [i, o] of (e.optimizations || []).entries()) {
    const st = o.stream;
    if (!st) continue;
    const at = `optimizations[${i}] (${o.title})`;
    if (st.log && !(e.logs || []).some((l) => l.type === st.log)) err(file, `${at}: stream.log "${st.log}" is not a logs[].type`);
    for (const [j, fn] of (st.functions || []).entries()) {
      if (!STREAM_FUNCTIONS.includes(fn.id)) err(file, `${at}: function ${j} "${fn.id}" is not a known Cribl Stream function id`);
      if (fn.filter != null) es5(`${at} function ${j} filter`, fn.filter);
      const c = fn.conf || {};
      for (const a of c.add || []) es5(`${at} eval ${a.name}`, a.value);
      if (c.keyExpr) es5(`${at} suppress keyExpr`, c.keyExpr);
      for (const r of c.rules || []) es5(`${at} sampling rule`, r.filter);
      if (fn.id === 'suppress' && (c.allow == null || c.suppressPeriodSec == null)) err(file, `${at}: suppress needs allow and suppressPeriodSec`);
    }
    for (const r of st.routes || []) es5(`${at} route ${r.name}`, r.filter);
    if (!st.functions && !st.routes && !st.note) err(file, `${at}: stream needs functions, routes or a note`);
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
// Load only what is needed: index.json carries what browse, search and the two index pages
// use (a few hundred KB, not the whole library); e/<id>.json holds one full article, fetched
// when it is opened. library.json stays for readers that still load everything at once.
// Vendor logos (scripts/logos.mjs): one SVG per logo under dist/logos/, referenced by path.
const logoOf = createLogoResolver(ROOT);
// Cribl checks (scripts/stream-verify.mjs): attached only while the pipeline, events and
// expectations still match what was checked.
const { loadChecks } = await import('./verified-store.mjs');
const checks = loadChecks();
let checked = 0, stale = 0;
for (const e of entries) for (const [i, o] of (e.optimizations || []).entries()) {
  if (!o.stream?.functions) continue;
  const c = checks[`${e.id}#${i}`];
  if (!c) continue;
  if (c.fingerprint !== fingerprint(e, o)) { stale++; continue; }
  const { fingerprint: _f, title: _t, ...rest } = c;
  o.verified = rest;
  checked++;
}
console.log(`✓ Cribl Stream checks: ${checked} attached${stale ? `, ${stale} out of date (run npm run verify:stream)` : ''}`);
fs.mkdirSync(path.join(dist, 'logos'), { recursive: true });
let logoCount = 0;
for (const e of entries) {
  const l = logoOf(e);
  if (!l) continue;
  const file = path.join(dist, 'logos', `${l.slug}.svg`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, l.svg);
  e.logo = { src: `logos/${l.slug}.svg`, title: l.title };
  logoCount++;
}
console.log(`✓ logos for ${logoCount} of ${entries.length} entries (the rest show their category icon)`);
fs.writeFileSync(path.join(dist, 'library.json'), JSON.stringify({ built, categories, entries }));
const searchText = (e) => [...(e.howItWorks || []).map((h) => `${h.title} ${h.body}`), ...(e.detections || []).map((d) => `${d.title} ${d.signals.join(' ')}`)].join(' ');
const card = (e) => ({
  id: e.id, name: e.name, short: e.short, aka: e.aka, vendor: e.vendor, category: e.category, status: e.status,
  summary: e.summary, tags: e.tags, updated: e.updated, sourcetypes: e.sourcetypes,
  cves: e.cves && e.cves.map(({ id, cvss, kev, title, scope }) => ({ id, cvss, kev, title, scope })),
  cveIds: e.cveIds, logo: e.logo, text: searchText(e),
});
fs.writeFileSync(path.join(dist, 'index.json'), JSON.stringify({ built, categories, entries: entries.map(card) }));
fs.mkdirSync(path.join(dist, 'e'), { recursive: true });
for (const e of entries) fs.writeFileSync(path.join(dist, 'e', `${e.id}.json`), JSON.stringify(e));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
const kb = (f) => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(1);
console.log(`✓ wrote dist/ (index.json ${kb('index.json')} KB, ${entries.length} articles in e/, library.json ${kb('library.json')} KB)`);
