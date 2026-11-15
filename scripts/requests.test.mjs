// The device-request parser and duplicate check (scripts/requests.mjs), and the contract
// between the site's popup and the issue form: the same field ids on both sides.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { CHANGE_LABEL, FIELDS, LABEL, checkChange, checkRequest, libraryMatches, loadEntries, parseChanges, parseRequestBody } from './requests.mjs';

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

test('a change request body: article, parts, and one change per part', () => {
  const body = [
    '### Article', '', 'pan-ngfw', '',
    '### Parts', '', 'Logs › Traffic\nCVE › CVE-2024-3400', '',
    '### Changes', '', '#### Logs › Traffic\nWhat is not correct: share is 95 %\nWhat it should be: 80–90 %\n\n#### CVE › CVE-2024-3400\nWhat is not correct: fixed version missing h2', '',
    '### Sources', '', 'https://security.paloaltonetworks.com/CVE-2024-3400', '',
  ].join('\n');
  const r = parseRequestBody(body);
  assert.equal(r.article, 'pan-ngfw');
  assert.deepEqual(r.parts, ['Logs › Traffic', 'CVE › CVE-2024-3400']);
  assert.deepEqual(r.changes, [
    { part: 'Logs › Traffic', wrong: 'share is 95 %', right: '80–90 %' },
    { part: 'CVE › CVE-2024-3400', wrong: 'fixed version missing h2' },
  ]);
  assert.deepEqual(r.sources, ['https://security.paloaltonetworks.com/CVE-2024-3400']);
  assert.deepEqual(parseChanges(''), []);
});

test('a change request is checked against the article it names', () => {
  const entries = loadEntries();
  assert.equal(checkChange({ article: 'pan-ngfw', parts: ['Summary'] }, entries).verdict, 'article-found');
  assert.equal(checkChange({ article: 'https://x/#/e/pan-ngfw/logs' }, entries).id, 'pan-ngfw', 'a pasted article link works');
  assert.equal(checkChange({ article: 'no-such-thing' }, entries).verdict, 'article-missing');
  const stale = checkChange({ article: 'pan-ngfw', parts: ['CVE › CVE-1999-0001', 'Summary'] }, entries);
  assert.deepEqual(stale.stale, ['CVE › CVE-1999-0001']);
});

test('the change form, the parser and the popup agree, and Add device is gone from the top bar', () => {
  const form = yaml.load(read('.github/ISSUE_TEMPLATE/change-request.yml'));
  assert.deepEqual(form.labels, [CHANGE_LABEL]);
  const fields = form.body.filter((b) => b.id);
  for (const f of fields) assert.equal(FIELDS[f.attributes.label], f.id, `parser knows "${f.attributes.label}"`);
  const app = read('site/app.js');
  assert.match(app, /template: 'change-request\.yml'/);
  for (const id of ['article', 'parts', 'changes']) assert.match(app, new RegExp(`${id}: v\\.`), `popup sends ${id}`);
  assert.match(app, /p\.set\('sources', v\.sources\)/);
  assert.match(app, /`#### \$\{x\.part\}\\nWhat is not correct: /, 'the popup writes the format parseChanges reads');
  assert.match(app, /id="req-change">Request a change</);
  assert.ok(!read('site/index.html').includes('+ Add device'));
  assert.ok(!app.includes("$('#contrib')"));
});

test('the change skill verifies and asks before it edits', () => {
  const skill = read('.claude/skills/process-change-requests/SKILL.md');
  assert.match(skill, /Verify, then ask, then write/);
  assert.match(skill, /AskUserQuestion/);
  assert.match(skill, /never `Closes #<n>`/);
  assert.match(read('.claude/skills/process-device-requests/SKILL.md'), /check <n\|all> --devices --json/);
});

test('a request sent from inside Cribl names its requester in "Requested by"', () => {
  const body = ['### Device or sourcetype', '', 'Acme SecureGate', '', '### Requested by', '', 'Jane Doe (via SE Toolkit)'].join('\n');
  assert.deepEqual(parseRequestBody(body), { device: 'Acme SecureGate', requestedBy: 'Jane Doe (via SE Toolkit)' });
});
