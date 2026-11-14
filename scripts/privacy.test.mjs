// The request privacy check (site/privacy.js): what it refuses, and the documentation
// values, timestamps and versions it must let through.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../site/privacy.js';

const { scan, mask } = globalThis.GoatpediaPrivacy;
const kinds = (t) => scan(t).map((f) => f.kind);

test('real addresses, people and secrets are refused', () => {
  assert.deepEqual(kinds('src=10.20.30.44 dst=142.250.74.110'), ['ipv4', 'ipv4']);
  assert.deepEqual(kinds('user jane.doe@acme-bank.com logged in'), ['email']);
  assert.deepEqual(kinds('host fw01.corp and dc1.acme.internal'), ['hostname', 'hostname']);
  assert.deepEqual(kinds('mac 3c:22:fb:12:ab:9e'), ['mac']);
  assert.deepEqual(kinds('from 2a00:1450:4001:82a::200e'), ['ipv6']);
  assert.deepEqual(kinds('key AKIAIOSFODNN7EXAMPL0'), ['aws-key']);
  assert.deepEqual(kinds('-----BEGIN RSA PRIVATE KEY-----'), ['private-key']);
  assert.deepEqual(kinds('ghp_' + 'a'.repeat(36)), ['github-token']);
  assert.deepEqual(kinds('Authorization: Bearer abcdefghijklmnop1234'), ['bearer']);
  assert.deepEqual(kinds('password=Hunter2024!'), ['credential']);
  assert.deepEqual(kinds('"api_key": "9f8e7d6c5b4a"'), ['credential']);
  assert.deepEqual(kinds('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijk'), ['jwt']);
  assert.deepEqual(kinds('card 4111 1111 1111 1111'), ['card']);
});

test('documentation values, placeholders, times and versions pass', () => {
  const ok = [
    'src=192.0.2.10 dst=198.51.100.7 nat=203.0.113.5 lo=127.0.0.1 any=0.0.0.0',
    'from 2001:db8::1 and ::1',
    'user jdoe@example.com, alerts@example.org, a@b.test',
    'password=***  token=<redacted>  secret=${SECRET}  api_key=REDACTED',
    '2026/11/12 09:14:22 TRAFFIC end 7340032119 1763021132081',
    'PAN-OS 11.1.2 and CVE-2024-3400, threat id 95187, docs https://docs.paloaltonetworks.com/pan-os',
    'sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'Palo Alto Networks NGFW, pan:traffic, CSV over syslog',
  ];
  for (const t of ok) assert.deepEqual(scan(t), [], t);
});

test('one finding per value, in text order, and masks keep secrets unreadable', () => {
  const f = scan('a 10.1.2.3 then token=ghp_' + 'b'.repeat(36));
  assert.deepEqual(f.map((x) => x.kind), ['ipv4', 'github-token'], 'the specific finding wins over the generic credential');
  assert.equal(mask('ghp_' + 'b'.repeat(36)), 'ghp_…');
  assert.equal(mask('10.1.2.3'), '10…');
});

test('the popup scans every field and blocks Submit on a finding or without the tick', () => {
  const app = fs.readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
  assert.match(app, /window\.GoatpediaPrivacy\.scan\(\$\(`#rq-\$\{id\}`\)\.value\)/);
  assert.match(app, /go\.disabled = !!f\.length \|\| !ok\.checked;/);
  assert.match(app, /if \(guard\(\)\.length \|\| !ok\.checked\) return;/);
  assert.match(fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8'), /<script src="privacy\.js\?v=__BUILD__"><\/script>\n<script src="app\.js/);
});
