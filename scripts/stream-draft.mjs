#!/usr/bin/env node
// Draft the Cribl Stream blocks for optimizations with Claude, then keep only what Cribl's
// preview confirms.
//
//   node scripts/stream-draft.mjs --category ngfw              every article in a category
//   node scripts/stream-draft.mjs fortigate cisco-asa           only these articles
//   options: --limit N  --dry-run (print, write nothing)
//
// Per article: one request with only that article's logs, samples and optimizations; the
// rules and three worked examples (the pilot articles) are a cached system prompt shared by
// every request. Each returned block is checked (function ids, ES5 expressions) and run in
// Cribl's preview (scripts/stream-verify.mjs). Failures go back once with the exact errors;
// what still fails is left out of the article and listed in verified/review/<id>.json.
// Only passing blocks are written to entries/<id>.yaml, with their checks in
// verified/stream/<id>.json.
//
// AI: Cribl's Aperture gateway (Tailscale), Claude Messages API. APERTURE_URL (default
// http://ai), AI_MODEL (default anthropic.claude-opus-5-5), AI_EFFORT (default low).
// Cribl: the same .env as npm run verify:stream.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { parse as parseJs } from 'acorn';
import { connect, loadEnv, verifyOne } from './stream-verify.mjs';
import { saveChecks, setReview } from './verified-store.mjs';
import '../site/stream.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = path.join(ROOT, 'entries');
const { FUNCTIONS } = globalThis.GoatpediaStream;
const PILOTS = ['pan-ngfw', 'cisco-ise', 'okta'];

// ---------- what the model returns ----------
const Fn = z.object({
  id: z.string(),
  filter: z.string(),
  description: z.string(),
  conf_json: z.string().describe('The function conf object as a JSON string, exactly as Cribl Stream stores it'),
});
const Route = z.object({ name: z.string(), filter: z.string(), to: z.string(), final: z.boolean() });
const Expect = z.object({
  out: z.number().int().nullable(),
  outMin: z.number().int().nullable(),
  outMax: z.number().int().nullable(),
  absent: z.array(z.string()),
  present: z.array(z.string()),
  smaller: z.boolean(),
});
const Block = z.object({
  index: z.number().int(),
  kind: z.enum(['functions', 'routes', 'note']),
  log: z.string().nullable(),
  parse: z.boolean(),
  serialize: z.boolean(),
  functions: z.array(Fn),
  routes: z.array(Route),
  note: z.string().nullable(),
  test: z.array(z.string()),
  expect: Expect,
});
const Output = z.object({ blocks: z.array(Block) });

// ---------- the shared, cached instructions ----------
const RULES = `You write exact Cribl Stream pipeline configurations for the optimization advice in Goatpedia articles.

For each optimization (by index) return one block:
- kind "functions": Cribl Stream functions that apply the advice. A parse step for the log is added automatically from the log's format (csv/tsv with its field list, kv, json, or the text pattern), so do not add one; set parse=false only when every function works on _raw alone. Set serialize=true when fields are removed or changed and the event must be written back in its original format (CSV keeps every column in place; removed fields become empty columns).
- kind "routes": routing advice. Route filters run before any pipeline, so they must match the raw event (_raw), e.g. a regex on the log-type column or on a JSON key. Give them in order.
- kind "note": advice that is not a pipeline function (device or source settings, licensing, collection schedules, lookups that need a file the user must supply). One or two plain sentences on how to apply it.

Function confs (copy these shapes exactly; conf_json is the conf object as a JSON string):
- drop: filter is the condition; conf {}.
- eval: {"remove":["field","nested.field"]} and/or {"add":[{"name":"field","value":"<expression>"}]}. Setting a field to undefined removes it, nested too: value "(client || {}).device === null ? undefined : (client || {}).device". Rewriting _raw: name "_raw", value "_raw.replace(/re/g, '')".
- suppress: {"keyExpr":"a + ':' + b","allow":1,"suppressPeriodSec":60,"dropEventsMode":true,"maxCacheSize":50000,"cacheIdleTimeoutPeriods":2,"numEventsIdleTimeoutTrigger":10000}; put the condition in filter.
- aggregation: {"passthrough":false,"preserveGroupBys":false,"sufficientStatsOnly":false,"metricsMode":false,"timeWindow":"60s","aggregations":["count().as(events)","sum(bytes).as(bytes)"],"cumulative":false,"flushOnInputClose":true,"groupbys":["src","dst"]}; put the condition in filter. Events matching the filter are replaced by one event per group; others pass.
- sampling: {"rules":[{"filter":"<condition>","rate":10}]} keeps 1 in rate of the matching events; filter "true".
- mask: {"rules":[{"matchRegex":"/re/g","replaceExpr":"'***'"}],"fields":["_raw"],"depth":5}.
- Allowed function ids: ${FUNCTIONS.join(', ')}.

Expressions are JavaScript that Cribl evaluates. ES5 only: no arrow functions, no ?. or ??, no template literals, no let/const, no function declarations. Fields with characters other than letters, digits and _ are written __e['Field-Name']. Guard nested reads: (a || {}).b. Use only field names that the parsed log really has: for csv/tsv the "fields" list, for kv and json the keys in the sample (json nests with dots), for text the named groups of the pattern. Compare values as strings unless the sample shows numbers in json.

Checks (the pipeline is run in Cribl's preview on the log's sample plus your "test" events):
- test: raw events made from the log's sample by changing only the values that matter, so the check exercises the advice (an event that must be dropped and one that must stay; several identical events for suppress; several same-group events for aggregation; ten matching events for 1:10 sampling). Keep the exact format of the sample. Synthetic values only: documentation IPs 192.0.2.x, 198.51.100.x, 203.0.113.x, example.com names; never real data.
- expect: out = events left after the pipeline (the sample plus test events, minus dropped/suppressed/sampled/aggregated, plus one event per aggregation group); for sampling use outMin/outMax instead and out null. absent = top-level fields that must be gone; present = fields that must remain; smaller = true when the output must be smaller than the input. Use null and [] for what does not apply.
- log: the exact "type" of the log the advice works on (one of the article's logs). For routes and notes use null.
- Fill every field; use [] or null when it does not apply. Return one block for every index in the request, in order. Stay faithful to the advice text; do not invent a different optimization.`;

export const strip = (e) => ({
  id: e.id, name: e.name, vendor: e.vendor,
  logs: (e.logs || []).map((l) => ({ type: l.type, format: l.format, ...(l.fields ? { fields: l.fields } : {}), ...(l.pattern ? { pattern: l.pattern } : {}), sample: l.sample })),
  optimizations: (e.optimizations || []).map((o, index) => ({ index, title: o.title, fn: o.fn, how: o.how, ...(o.expr ? { expr: o.expr } : {}) })),
});

/** A stored stream block back in the model's output shape, for the worked examples. */
function toBlock(index, st) {
  const kind = st.functions ? 'functions' : st.routes ? 'routes' : 'note';
  const ex = st.expect || {};
  return {
    index, kind, log: st.log ?? null, parse: st.parse !== false, serialize: !!st.serialize,
    functions: (st.functions || []).map((f) => ({ id: f.id, filter: f.filter ?? 'true', description: f.description || '', conf_json: JSON.stringify(f.conf || {}) })),
    routes: st.routes || [], note: st.note ?? null, test: st.test || [],
    expect: { out: ex.out ?? null, outMin: ex.outMin ?? null, outMax: ex.outMax ?? null, absent: ex.absent || [], present: ex.present || [], smaller: !!ex.smaller },
  };
}

function examples() {
  return PILOTS.map((id) => {
    const e = loadEntry(id);
    const blocks = (e.optimizations || []).map((o, i) => (o.stream ? toBlock(i, o.stream) : null)).filter(Boolean);
    return `<example>\n<article>\n${JSON.stringify(strip(e))}\n</article>\n<answer>\n${JSON.stringify({ blocks })}\n</answer>\n</example>`;
  }).join('\n');
}

// ---------- blocks back into the article ----------
export function toStream(b) {
  if (b.kind === 'note') return { note: b.note || '' };
  if (b.kind === 'routes') return { routes: b.routes.map((r) => ({ name: r.name, filter: r.filter, to: r.to, final: r.final })), ...(b.note ? { note: b.note } : {}) };
  const st = { log: b.log };
  if (b.parse === false) st.parse = false;
  st.functions = b.functions.map((f) => {
    const out = { id: f.id, filter: f.filter || 'true' };
    if (f.description) out.description = f.description;
    out.conf = JSON.parse(f.conf_json || '{}');
    return out;
  });
  if (b.serialize) st.serialize = true;
  if (b.test.length) st.test = b.test;
  const ex = {};
  for (const k of ['out', 'outMin', 'outMax']) if (b.expect[k] != null) ex[k] = b.expect[k];
  if (b.expect.absent.length) ex.absent = b.expect.absent;
  if (b.expect.present.length) ex.present = b.expect.present;
  if (b.expect.smaller) ex.smaller = true;
  if (Object.keys(ex).length) st.expect = ex;
  return st;
}

/** Insert stream blocks under their optimizations, keeping the rest of the YAML text as it is. */
export function insertBlocks(text, streams) {
  const lines = text.split('\n');
  const start = lines.indexOf('optimizations:');
  let end = lines.findIndex((l, i) => i > start && l && !l.startsWith(' '));
  if (end < 0) end = lines.length;
  const items = [];
  for (const l of lines.slice(start + 1, end)) {
    if (l.startsWith('  - ') && !l.startsWith('  - - ')) items.push([]);
    items[items.length - 1].push(l);
  }
  const out = [...lines.slice(0, start + 1)];
  items.forEach((it, i) => {
    while (it.length && it[it.length - 1] === '') it.pop();
    out.push(...it);
    if (streams.has(i)) {
      const dumped = yaml.dump(streams.get(i), { indent: 2, lineWidth: -1, noRefs: true }).trimEnd().split('\n');
      out.push('    stream:', ...dumped.map((l) => `      ${l}`));
    }
  });
  out.push(...lines.slice(end));
  return out.join('\n');
}

function loadEntry(id) { return yaml.load(fs.readFileSync(path.join(ENTRIES, `${id}.yaml`), 'utf8')); }

// ---------- checks ----------
export function staticProblems(entry, st) {
  const p = [];
  const es5 = (where, x) => { try { parseJs(`(${x})`, { ecmaVersion: 5 }); } catch (err) { p.push(`${where}: "${x}" is not ES5 (${err.message})`); } };
  if (st.functions) {
    if (!(entry.logs || []).some((l) => l.type === st.log)) p.push(`log "${st.log}" is not one of the article's logs`);
    for (const f of st.functions) {
      if (!FUNCTIONS.includes(f.id)) p.push(`function id "${f.id}" is not allowed`);
      es5(`${f.id} filter`, f.filter);
      for (const a of f.conf.add || []) es5(`eval ${a.name}`, a.value);
      if (f.conf.keyExpr) es5('suppress keyExpr', f.conf.keyExpr);
      for (const r of f.conf.rules || []) if (r.filter) es5('sampling rule', r.filter);
      if (f.id === 'suppress' && (f.conf.allow == null || f.conf.suppressPeriodSec == null)) p.push('suppress needs allow and suppressPeriodSec');
    }
  }
  for (const r of st.routes || []) es5(`route ${r.name}`, r.filter);
  return p;
}

// ---------- one article ----------
async function draftArticle({ client, model, effort, system, cribl, group, id, usage, dryRun }) {
  const file = path.join(ENTRIES, `${id}.yaml`);
  const text = fs.readFileSync(file, 'utf8');
  const entry = yaml.load(text);
  const todo = (entry.optimizations || []).map((o, i) => (o.stream ? null : i)).filter((i) => i != null);
  if (!todo.length) return { id, skipped: 'already has stream blocks' };
  const article = strip(entry);
  article.optimizations = article.optimizations.filter((o) => todo.includes(o.index));
  const messages = [{ role: 'user', content: `<article>\n${JSON.stringify(article)}\n</article>\nReturn the blocks for indices ${todo.join(', ')}.` }];

  const ask = async () => {
    const r = await client.messages.parse({
      model, max_tokens: 16000, system, messages,
      output_config: { effort, format: zodOutputFormat(Output) },
    });
    const u = r.usage || {};
    usage.calls++; usage.input += u.input_tokens || 0; usage.output += u.output_tokens || 0;
    usage.cacheRead += u.cache_read_input_tokens || 0; usage.cacheWrite += u.cache_creation_input_tokens || 0;
    if (r.stop_reason === 'refusal') throw new Error(`model declined (${r.stop_details?.category || 'no category'})`);
    if (!r.parsed_output) throw new Error(`no parsable answer (stop_reason ${r.stop_reason})`);
    messages.push({ role: 'assistant', content: r.content.filter((c) => c.type === 'text') });
    return r.parsed_output.blocks;
  };

  const accepted = new Map(), results = {}, problems = {};
  let pending = await ask();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const failed = [];
    for (const b of pending) {
      if (!todo.includes(b.index) || accepted.has(b.index)) continue;
      let st;
      try { st = toStream(b); } catch (err) { failed.push([b.index, [`conf_json is not valid JSON (${err.message})`]]); continue; }
      const probs = staticProblems(entry, st);
      if (!probs.length && st.functions) {
        const opt = { ...entry.optimizations[b.index], stream: st };
        try {
          const { result } = await verifyOne(cribl, group, entry, opt, b.index);
          if (result.ok) results[`${id}#${b.index}`] = result; else probs.push(...result.problems);
        } catch (err) { probs.push(`Cribl check failed: ${err.message}`); }
      }
      if (probs.length) failed.push([b.index, probs]); else accepted.set(b.index, st);
    }
    const missing = todo.filter((i) => !accepted.has(i) && !failed.some(([j]) => j === i));
    for (const i of missing) failed.push([i, ['no block was returned for this index']]);
    if (!failed.length || attempt === 2) { for (const [i, p] of failed) problems[i] = p; break; }
    messages.push({ role: 'user', content: `These blocks failed. Return corrected blocks for these indices only.\n${failed.map(([i, p]) => `index ${i} (${entry.optimizations[i].title}):\n- ${p.join('\n- ')}`).join('\n')}` });
    pending = await ask();
  }

  if (!dryRun && accepted.size) {
    const updated = insertBlocks(text, accepted);
    yaml.load(updated); // still valid YAML
    fs.writeFileSync(file, updated);
    saveChecks(results);
  }
  const review = Object.fromEntries(Object.entries(problems).map(([i, p]) => [i, { title: entry.optimizations[i].title, problems: p }]));
  if (!dryRun) setReview(id, review);
  return { id, done: accepted.size, failed: Object.keys(problems).length, review };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const dryRun = args.includes('--dry-run');
  const limit = Number(opt('--limit')) || Infinity;
  const category = opt('--category');
  const named = args.filter((a, i) => !a.startsWith('--') && !['--category', '--limit'].includes(args[i - 1]));
  let ids = named;
  if (category) {
    ids = fs.readdirSync(ENTRIES).filter((f) => f.endsWith('.yaml')).map((f) => f.slice(0, -5)).filter((id) => {
      const e = loadEntry(id);
      return e.category === category && (e.optimizations || []).some((o) => !o.stream) && !PILOTS.includes(id);
    }).sort();
  }
  ids = ids.slice(0, limit);
  if (!ids.length) throw new Error('nothing to do: name articles or --category <key>');

  const env = loadEnv();
  const cribl = await connect(env);
  const group = env.CRIBL_GROUP || 'default';
  const model = process.env.AI_MODEL || 'anthropic.claude-opus-5-5';
  const effort = process.env.AI_EFFORT || 'low';
  // Aperture authenticates on the tailnet; the SDK still wants a key value.
  const client = new Anthropic({ baseURL: process.env.APERTURE_URL || 'http://ai', apiKey: process.env.APERTURE_API_KEY || 'aperture', maxRetries: 3, timeout: 10 * 60 * 1000 });
  const system = [{ type: 'text', text: `${RULES}\n\nWorked examples (articles already done and checked in Cribl):\n${examples()}`, cache_control: { type: 'ephemeral' } }];
  const usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let done = 0, failed = 0;
  console.log(`${ids.length} article(s) · model ${model} · effort ${effort} · Cribl group ${group}${dryRun ? ' · dry run' : ''}`);
  for (const id of ids) {
    try {
      const r = await draftArticle({ client, model, effort, system, cribl, group, id, usage, dryRun });
      if (r.skipped) { console.log(`- ${id}: ${r.skipped}`); continue; }
      done += r.done; failed += r.failed;
      console.log(`${r.failed ? '◐' : '✓'} ${id}: ${r.done} written${r.failed ? `, ${r.failed} need review` : ''}`);
    } catch (err) {
      console.log(`✗ ${id}: ${err.message}`);
    }
  }
  console.log(`\n${done} block(s) written and checked, ${failed} need review (verified/review/<id>.json).`);
  console.log(`Tokens: ${usage.calls} calls · input ${usage.input} · cache write ${usage.cacheWrite} · cache read ${usage.cacheRead} · output ${usage.output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((x) => { console.error(`✗ ${x.message}`); process.exit(1); });
}
