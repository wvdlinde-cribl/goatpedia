// Vendor logo resolution (scripts/logos.mjs): Simple Icons by vendor or product name, the
// overrides in logos.yaml, and the contrast rule for very light brand colours.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogoResolver, displayColor, vendorKeys } from './logos.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logo = createLogoResolver(ROOT);
const e = (vendor, name = vendor, id = 'x') => ({ id, vendor, name, short: name });

test('a vendor gets its Simple Icons logo, also through name variants', () => {
  assert.equal(logo(e('Cisco'))?.slug, 'cisco');
  assert.equal(logo(e('Splunk (Cisco)'))?.slug, 'splunk', 'the part before "(…)"');
  assert.equal(logo(e('Juniper'))?.slug, 'junipernetworks', 'with "networks" added');
  assert.equal(logo(e('Unknown Vendor', 'NGINX Plus', 'nginx'))?.slug ?? null, null);
  assert.match(logo(e('Cisco')).svg, /^<svg fill="#[0-9A-F]{6}" /i);
});

test('logos.yaml fixes wrong matches and turns logos off', () => {
  assert.equal(logo(e('Prisma', 'Prisma Cloud'))?.slug, 'paloaltonetworks', 'Palo Alto Prisma, not the Prisma ORM');
  assert.equal(logo(e('Hive'))?.slug, 'apachehive');
  assert.equal(logo(e('CrowdStrike', 'Falcon')), null, 'Simple Icons "Falcon" is another project');
  assert.equal(logo(e('Neon', 'Neon Cyber')), null);
});

test('light brand colours are drawn dark enough to see on white', () => {
  assert.equal(displayColor('FDEE21'), '#14212b');
  assert.equal(displayColor('1BA0D7'), '#1BA0D7');
});

test('vendor name variants', () => {
  assert.deepEqual(vendorKeys('Palo Alto Networks'), ['paloaltonetworks', 'paloalto', 'paloaltonetworksnetworks']);
  assert.ok(vendorKeys('Imperva (Thales)').includes('thales'));
});
