#!/usr/bin/env node
// Check optimization pipelines in Cribl Stream's preview, without deploying anything.
//
//   npm run verify:stream                 every optimization with a stream block
//   node scripts/stream-verify.mjs pan-ngfw okta    only these articles
//
// For each optimization: upload the article's sample (plus its stream.test events) as a
// temporary sample in the worker group, run pipelineFor(entry, opt) in the preview, delete the
// sample, and check stream.expect (events left, fields gone, output smaller). Results, with
// events and bytes in and out, go to verified/stream/<id>.json. Each result carries a fingerprint
// of the pipeline and events; the site shows "checked in Cribl" only while they still match.
//
// Needs a Cribl API client in .env (gitignored) or the environment:
//   CRIBL_API_URL=https://<workspace>.cribl.cloud   CRIBL_CLIENT_ID=…   CRIBL_CLIENT_SECRET=…
//   CRIBL_GROUP=default (worker group used for the preview)   [CRIBL_TOKEN_URL, CRIBL_AUDIENCE]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { fingerprint } from './stream-fingerprint.mjs';
import { saveChecks } from './verified-store.mjs';
import '../site/stream.js';

const { pipelineFor, logOf } = globalThis.GoatpediaStream;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const env = { ...process.env };
  const file = path.join(ROOT, '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  for (const k of ['CRIBL_API_URL', 'CRIBL_CLIENT_ID', 'CRIBL_CLIENT_SECRET']) if (!env[k]) throw new Error(`${k} is not set (put it in .env)`);
  return env;
}

export async function connect(env) {
  const tr = await fetch(env.CRIBL_TOKEN_URL || 'https://login.cribl.cloud/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: env.CRIBL_CLIENT_ID, client_secret: env.CRIBL_CLIENT_SECRET, audience: env.CRIBL_AUDIENCE || 'https://api.cribl.cloud' }),
  });
  if (!tr.ok) throw new Error(`Cribl token request failed (${tr.status})`);
  const token = (await tr.json()).access_token;
  const base = `${env.CRIBL_API_URL.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}/api/v1`;
  return async (p, method = 'GET', body) => {
    // A dropped connection is retried twice; an HTTP error answer is returned as is.
    let r;
    for (let attempt = 0; ; attempt++) {
      try { r = await fetch(base + p, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); break; }
      catch (x) { if (attempt >= 2) throw x; await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1))); }
    }
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, ok: r.ok, json, text };
  };
}

const bytes = (s) => Buffer.byteLength(String(s ?? ''), 'utf8');
const visible = (ev) => Object.fromEntries(Object.entries(ev).filter(([k]) => !k.startsWith('__') && k !== 'cribl_pipe'));
const outSize = (ev) => (typeof ev._raw === 'string' ? bytes(ev._raw) : bytes(JSON.stringify(visible(ev))));

export async function verifyOne(api, group, entry, opt, index) {
  const s = opt.stream;
  const log = logOf(entry, s);
  const events = [log.sample, ...(s.test || [])];
  const pipeline = pipelineFor(entry, opt);
  const now = Date.now() / 1000;
  const up = await api(`/m/${group}/system/samples`, 'POST', { sampleName: `goatpedia-verify-${entry.id}-${index}`, context: { events: events.map((raw) => ({ _raw: raw, _time: now })) } });
  const sampleId = up.json?.items?.[0]?.id || up.json?.id;
  if (!sampleId) throw new Error(`sample upload failed (${up.status}): ${up.text.slice(0, 200)}`);
  let pv;
  try {
    pv = await api(`/m/${group}/preview`, 'POST', { mode: 'pipe', sampleId, pipelineId: `goatpedia-${entry.id}-${index}`, pipelineConf: pipeline, dropped: true });
  } finally {
    await api(`/m/${group}/system/samples/${encodeURIComponent(sampleId)}`, 'DELETE');
  }
  const problems = [];
  if (!pv.ok) problems.push(`preview failed (${pv.status}): ${pv.text.slice(0, 200)}`);
  const items = pv.json?.items || [];
  const kept = items.filter((x) => !x.__dropped);
  const result = {
    title: opt.title,
    checked: new Date().toISOString().slice(0, 10),
    group,
    fingerprint: fingerprint(entry, opt),
    in: { events: events.length, bytes: events.reduce((a, e) => a + bytes(e), 0) },
    out: { events: kept.length, bytes: kept.reduce((a, e) => a + outSize(e), 0) },
  };
  const ex = s.expect || {};
  if (ex.out != null && kept.length !== ex.out) problems.push(`expected ${ex.out} event(s) out, got ${kept.length}`);
  // Sampling keeps a running count across runs, so its result is a range, not one number.
  if (ex.outMin != null && kept.length < ex.outMin) problems.push(`expected at least ${ex.outMin} event(s) out, got ${kept.length}`);
  if (ex.outMax != null && kept.length > ex.outMax) problems.push(`expected at most ${ex.outMax} event(s) out, got ${kept.length}`);
  for (const f of ex.absent || []) if (kept.some((e) => Object.hasOwn(e, f))) problems.push(`field ${f} is still in the output`);
  for (const f of ex.present || []) if (!kept.some((e) => Object.hasOwn(e, f))) problems.push(`field ${f} is missing from the output`);
  if (ex.smaller && !(result.out.bytes < result.in.bytes)) problems.push(`output (${result.out.bytes} B) is not smaller than input (${result.in.bytes} B)`);
  for (const e of items) if (e.__criblError || e.cribl_error) problems.push(`function error: ${JSON.stringify(e.__criblError || e.cribl_error).slice(0, 200)}`);
  result.ok = problems.length === 0;
  if (problems.length) result.problems = problems;
  return { result, items };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const show = process.argv.includes('--show');
  const env = loadEnv();
  const group = env.CRIBL_GROUP || 'default';
  const api = await connect(env);
  const store = {};
  const dir = path.join(ROOT, 'entries');
  let ran = 0, failed = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.yaml')).sort()) {
    const entry = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (only.length && !only.includes(entry.id)) continue;
    for (const [i, opt] of (entry.optimizations || []).entries()) {
      if (!opt.stream?.functions?.length) continue;
      const key = `${entry.id}#${i}`;
      try {
        const { result, items } = await verifyOne(api, group, entry, opt, i);
        store[key] = result;
        ran++;
        if (!result.ok) failed++;
        const pct = result.in.bytes ? Math.round((1 - result.out.bytes / result.in.bytes) * 100) : 0;
        console.log(`${result.ok ? '✓' : '✗'} ${key} ${opt.title}: ${result.in.events}→${result.out.events} events, ${result.in.bytes}→${result.out.bytes} B (${pct}% smaller)${result.problems ? `\n    ${result.problems.join('\n    ')}` : ''}`);
        if (show) for (const e of items) console.log(`    ${e.__dropped ? '[dropped] ' : ''}${JSON.stringify(visible(e)).slice(0, 400)}`);
      } catch (x) {
        failed++;
        console.log(`✗ ${key} ${opt.title}: ${x.message}`);
      }
    }
  }
  saveChecks(store);
  console.log(`\n${ran} checked in Cribl (group ${group}), ${failed} failed. Results in verified/stream/<id>.json.`);
  if (failed) process.exit(1);
}


if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((x) => { console.error(`✗ ${x.message}`); process.exit(1); });
}
