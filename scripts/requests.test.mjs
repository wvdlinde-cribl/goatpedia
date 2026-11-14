// The device-request parser and duplicate check (scripts/requests.mjs), and the contract
// between the site's popup and the issue form: the same field ids on both sides.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { FIELDS, LABEL, checkRequest, libraryMatches, loadEntries, parseRequestBody } from './requests.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('an issue-form body becomes request fields; empty answers are dropped', () => {
  const body = [
    '### Device or sourcetype', '', 'Acme Firewall', '',
    '### Vendor', '', 'Acme', '',
    '### Category', '', '_No response_', '',
    '### Sourcetypes', '', 'acme:traffic\nacme:threat', '',
    '### Vendor documentation', '', 'https://docs.example.com/logs not-a-link', '',
    '### Sample event', '', '```text', 'a=1 b=2', '```', '',
    '### Public repository', '', '- [X] This request contains no customer data, credentials or internal details.',
  ].join('\n');
  assert.deepEqual(parseRequestBody(body), {
    device: 'Acme Firewall', vendor: 'Acme', sourcetypes: ['acme:traffic', 'acme:threat'],
    links: ['https://docs.example.com/logs'], sample: 'a=1 b=2',
  });
  assert.deepEqual(parseRequestBody(''), {});
});

test('a request for something already in the library is recognised', () => {
  const entries = loadEntries();
  assert.ok(libraryMatches({ device: 'Palo Alto Networks NGFW' }, entries).some((m) => m.id === 'pan-ngfw'));
  assert.ok(libraryMatches({ device: 'pan:traffic' }, entries).some((m) => m.id === 'pan-ngfw'), 'by sourcetype');
  assert.deepEqual(libraryMatches({ device: 'zz-not-a-device-zz' }, entries), []);
});

test('the issue form, the parser and the site popup use the same fields', () => {
  const form = yaml.load(read('.github/ISSUE_TEMPLATE/device-request.yml'));
  assert.deepEqual(form.labels, [LABEL]);
  const fields = form.body.filter((b) => b.id);
  for (const f of fields) assert.equal(FIELDS[f.attributes.label], f.id, `parser knows "${f.attributes.label}"`);
  assert.equal(fields.find((f) => f.id === 'device').validations.required, true);
  const app = read('site/app.js');
  for (const f of fields.filter((x) => x.id !== 'public')) assert.match(app, new RegExp(`\\['${f.id}', '`), `popup has ${f.id}`);
  assert.match(app, /template: 'device-request\.yml'/);
});

test('the request flow never collects an email address', () => {
  const app = read('site/app.js');
  const popup = app.slice(app.indexOf('request a device ---'), app.indexOf('// ---------- boot'));
  assert.doesNotMatch(popup, /type="email"|\bemail\b.*input/i);
});

test('the existence check: exists, possible (typo or variant) or new, with a reason', () => {
  const entries = loadEntries();
  const check = (r) => checkRequest(r, entries);
  let c = check({ device: 'Palo Alto Networks NGFW' });
  assert.equal(c.verdict, 'exists'); assert.equal(c.matches[0].id, 'pan-ngfw'); assert.match(c.matches[0].reason, /same name/);
  c = check({ device: 'pan:traffic' });
  assert.equal(c.verdict, 'exists'); assert.match(c.matches[0].reason, /sourcetype pan:traffic/);
  c = check({ device: 'Cisco ICE', vendor: 'Cisco' });
  assert.equal(c.verdict, 'possible', 'a one-letter typo of an existing product');
  assert.equal(c.matches[0].id, 'cisco-ise'); assert.match(c.matches[0].reason, /"ice" is close to "ise"/);
  c = check({ device: 'Fortigte', vendor: 'Fortinet' });
  assert.equal(c.verdict, 'possible'); assert.equal(c.matches[0].id, 'fortigate');
  c = check({ device: 'cisco:asa:extra' });
  assert.deepEqual(c.matches.map((m) => m.id), ['cisco-asa'], 'a sourcetype variant beats look-alike spellings');
  assert.equal(check({ device: 'Acme SecureGate 9000', vendor: 'Acme' }).verdict, 'new');
});

test('both skills run the check first, and processing asks before touching a match', () => {
  const proc = read('.claude/skills/process-device-requests/SKILL.md');
  const chk = read('.claude/skills/check-device-requests/SKILL.md');
  assert.match(chk, /node scripts\/requests\.mjs check/);
  assert.match(chk, /only reports/);
  assert.match(proc, /## Step 2 — Existence check \(always\)/);
  assert.match(proc, /AskUserQuestion/);
  for (const opt of ['Improve <id>', 'Create a new article', 'Skip']) assert.ok(proc.includes(`**${opt}:**`), `offers ${opt}`);
  assert.match(proc, /A request with no answer is not processed/);
  assert.match(proc, /never `Closes #<n>`/);
});
