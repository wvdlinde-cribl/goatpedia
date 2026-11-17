// The draft script's pure parts: what the model sees, how its answer becomes a stream block,
// the checks that reject a bad draft before Cribl, and inserting blocks without touching the
// rest of the article's YAML.
import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { insertBlocks, staticProblems, strip, toStream } from './stream-draft.mjs';

const block = (over) => ({
  index: 0, kind: 'functions', log: 'Traffic', parse: true, serialize: false,
  functions: [{ id: 'drop', filter: "type == 'X'", description: 'Drop X', conf_json: '{}' }],
  routes: [], note: null, test: ['a,b'],
  expect: { out: 1, outMin: null, outMax: null, absent: [], present: [], smaller: false }, ...over,
});
const entry = { id: 't', logs: [{ type: 'Traffic', format: 'csv', fields: ['a'], sample: 'x' }], optimizations: [{ title: 'one' }, { title: 'two' }] };

test('the model sees logs and optimization text, not existing stream blocks', () => {
  const s = strip({ ...entry, optimizations: [{ title: 'one', fn: 'Drop', how: 'h', stream: { note: 'x' } }] });
  assert.deepEqual(Object.keys(s.optimizations[0]).sort(), ['fn', 'how', 'index', 'title']);
  assert.deepEqual(s.logs[0], { type: 'Traffic', format: 'csv', fields: ['a'], sample: 'x' });
});

test('an answer becomes a clean stream block', () => {
  assert.deepEqual(toStream(block({})), { log: 'Traffic', functions: [{ id: 'drop', filter: "type == 'X'", description: 'Drop X', conf: {} }], test: ['a,b'], expect: { out: 1 } });
  assert.deepEqual(toStream(block({ kind: 'note', note: 'Set it on the device.' })), { note: 'Set it on the device.' });
  const r = toStream(block({ kind: 'routes', routes: [{ name: 'n', filter: '/x/.test(_raw)', to: 'SIEM', final: true }] }));
  assert.deepEqual(r, { routes: [{ name: 'n', filter: '/x/.test(_raw)', to: 'SIEM', final: true }] });
  assert.throws(() => toStream(block({ functions: [{ id: 'eval', filter: 'true', description: '', conf_json: '{bad' }] })));
});

test('bad drafts are refused before they reach Cribl', () => {
  assert.deepEqual(staticProblems(entry, toStream(block({}))), []);
  const arrow = toStream(block({ functions: [{ id: 'drop', filter: '(e) => e.x', description: '', conf_json: '{}' }] }));
  assert.match(staticProblems(entry, arrow)[0], /not ES5/);
  const id = toStream(block({ functions: [{ id: 'dropper', filter: 'true', description: '', conf_json: '{}' }] }));
  assert.match(staticProblems(entry, id)[0], /not allowed/);
  assert.match(staticProblems(entry, toStream(block({ log: 'Nope' })))[0], /not one of the article's logs/);
  const sup = toStream(block({ functions: [{ id: 'suppress', filter: 'true', description: '', conf_json: '{"keyExpr":"a"}' }] }));
  assert.ok(staticProblems(entry, sup).some((p) => /allow and suppressPeriodSec/.test(p)));
});

test('blocks go under the right optimization and nothing else in the YAML changes', () => {
  const text = ['id: t', '# a comment', 'optimizations:', '  - title: one', '    how: "first"', '  - title: two', '    how: second', 'references: []', ''].join('\n');
  const out = insertBlocks(text, new Map([[1, { note: 'Set it on the device.' }]]));
  assert.ok(out.startsWith('id: t\n# a comment\noptimizations:\n  - title: one\n    how: "first"\n  - title: two\n'), 'earlier text unchanged');
  const y = yaml.load(out);
  assert.equal(y.optimizations[0].stream, undefined);
  assert.deepEqual(y.optimizations[1].stream, { note: 'Set it on the device.' });
  assert.deepEqual(y.references, []);
});
