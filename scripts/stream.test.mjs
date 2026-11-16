// Cribl Stream pipelines for optimizations (site/stream.js), the build's checks on them, and
// the fingerprint that ties a Cribl check to exactly what was checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { parse as parseJs } from 'acorn';
import { fingerprint } from './stream-fingerprint.mjs';
import '../site/stream.js';

const S = globalThis.GoatpediaStream;
const entry = (id) => yaml.load(fs.readFileSync(new URL(`../entries/${id}.yaml`, import.meta.url), 'utf8'));

test('the parse step follows the log format and its own field list or pattern', () => {
  const csv = S.parseStep({ type: 'T', format: 'csv', fields: ['a', 'b'] })[0];
  assert.deepEqual(csv.conf, { mode: 'extract', type: 'csv', srcField: '_raw', fields: ['a', 'b'] });
  assert.equal(S.parseStep({ type: 'T', format: 'tsv', fields: ['a'] })[0].conf.delimChar, '\t');
  assert.equal(S.parseStep({ type: 'T', format: 'json' })[0].conf.type, 'json');
  assert.equal(S.parseStep({ type: 'T', format: 'kv' })[0].conf.type, 'kvp');
  assert.deepEqual(S.parseStep({ type: 'T', format: 'text', pattern: '(?<a>\\w+)' })[0].conf, { source: '_raw', regex: '/(?<a>\\w+)/' });
  assert.deepEqual(S.parseStep({ type: 'T', format: 'cef' }), []);
});

test('CSV is written back with every column in place; removed fields become empty columns', () => {
  const e = entry('pan-ngfw');
  const o = e.optimizations.find((x) => x.title.startsWith('Strip future_use'));
  const p = S.pipelineFor(e, o);
  assert.deepEqual(p.functions.map((f) => f.id), ['serde', 'eval', 'serialize']);
  const ser = p.functions[2].conf;
  assert.equal(ser.type, 'csv');
  assert.deepEqual(ser.fields, e.logs.find((l) => l.type === 'Traffic').fields, 'same columns, same order');
});

test('pipelines for the pilot articles: parse, then the optimization', () => {
  const pan = entry('pan-ngfw');
  assert.deepEqual(S.pipelineFor(pan, pan.optimizations[0]).functions.map((f) => f.id), ['serde', 'drop']);
  const ise = entry('cisco-ise');
  const strip = ise.optimizations.find((x) => x.title === 'Strip the Step= trail');
  assert.deepEqual(S.pipelineFor(ise, strip).functions.map((f) => f.id), ['eval'], 'parse: false works on _raw only');
  assert.equal(S.pipelineFor(ise, ise.optimizations[0]), null, 'a note-only optimization has no pipeline');
  const okta = entry('okta');
  assert.deepEqual(S.pipelineFor(okta, okta.optimizations[0]).functions.map((f) => f.id), ['serde', 'eval', 'eval', 'serialize']);
});

test('every expression in the pilot is ES5, which is all Cribl loads', () => {
  for (const id of ['pan-ngfw', 'cisco-ise', 'okta']) {
    for (const o of entry(id).optimizations) {
      const st = o.stream || {};
      for (const f of st.functions || []) {
        const exprs = [f.filter, ...(f.conf?.add || []).map((a) => a.value), f.conf?.keyExpr, ...(f.conf?.rules || []).map((r) => r.filter)].filter(Boolean);
        for (const x of exprs) assert.doesNotThrow(() => parseJs(`(${x})`, { ecmaVersion: 5 }), `${id}: ${x}`);
      }
      for (const r of st.routes || []) assert.doesNotThrow(() => parseJs(`(${r.filter})`, { ecmaVersion: 5 }));
    }
  }
  for (const bad of ['(x) => x', 'a?.b', 'a ?? b', '`${a}`']) assert.throws(() => parseJs(`(${bad})`, { ecmaVersion: 5 }), bad);
});

test('a Cribl check is tied to exactly what was checked', () => {
  const e = entry('pan-ngfw');
  const o = e.optimizations[0];
  const f = fingerprint(e, o);
  assert.equal(fingerprint(e, o), f, 'stable');
  const changed = { ...o, stream: { ...o.stream, functions: [{ ...o.stream.functions[0], filter: "subtype == 'start'" }] } };
  assert.notEqual(fingerprint(e, changed), f, 'a different filter is a different check');
  const v = JSON.parse(fs.readFileSync(new URL('../verified/stream.json', import.meta.url), 'utf8'));
  for (const id of ['pan-ngfw', 'cisco-ise', 'okta']) {
    const en = entry(id);
    for (const [i, op] of en.optimizations.entries()) {
      if (!op.stream?.functions) continue;
      const c = v[`${id}#${i}`];
      assert.ok(c, `${id}#${i} was checked in Cribl`);
      assert.equal(c.fingerprint, fingerprint(en, op), `${id}#${i} check matches the article`);
      assert.equal(c.ok, true, `${id}#${i} passed`);
    }
  }
});

test('function names and one-line descriptions for the article', () => {
  assert.equal(S.NAMES.serde, 'Parser');
  assert.match(S.describe({ id: 'suppress', filter: "action == 'deny'", conf: { keyExpr: 'k', allow: 1, suppressPeriodSec: 60 } }), /keep 1 per 60 s for each k/);
  assert.match(S.describe({ id: 'sampling', conf: { rules: [{ filter: 'x', rate: 10 }] } }), /keep 1 in 10 when x/);
});
