#!/usr/bin/env node
// Device requests: the open GitHub issues labelled `device-request`, made from the
// "Request a device" issue form (.github/ISSUE_TEMPLATE/device-request.yml).
//
//   npm run requests                     list open requests
//   node scripts/requests.mjs list --json
//   node scripts/requests.mjs check all   existence check: exists / possible / new, with reasons
//   node scripts/requests.mjs check 12 --json
//   node scripts/requests.mjs show 12     one request, its fields and library matches
//   node scripts/requests.mjs scan entries/x.yaml   privacy check of a file (exit 1 on findings)
//   node scripts/requests.mjs show 12 --json
//
// Reads GitHub through the `gh` CLI, so it uses the admin's own login. It never writes to
// GitHub: no comments, labels or closing. Processing (writing the entry and opening a PR)
// is the process-device-requests Claude Code skill in .claude/skills/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import '../site/privacy.js';

const { scan } = globalThis.GoatpediaPrivacy;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LABEL = 'device-request';

/** Issue-form headings → field ids (the same ids as the form and the site's popup). */
export const FIELDS = {
  'Device or sourcetype': 'device',
  Vendor: 'vendor',
  Category: 'category',
  Sourcetypes: 'sourcetypes',
  'Log format and transport': 'format',
  'Vendor documentation': 'links',
  'Sample event': 'sample',
  'Anything else': 'notes',
  'Public repository': 'public',
};

/** An issue-form body ("### Heading\n\nvalue") → { device, vendor, … }. Empty answers are left out. */
export function parseRequestBody(body) {
  const out = {};
  const parts = String(body || '').replace(/\r\n/g, '\n').split(/^### /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
    const id = FIELDS[heading];
    if (!id) continue;
    let value = (nl < 0 ? '' : part.slice(nl + 1)).trim();
    const fence = value.match(/^```[\w-]*\n([\s\S]*?)\n?```$/);
    if (fence) value = fence[1].trim();
    if (!value || value === '_No response_') continue;
    out[id] = value;
  }
  if (out.sourcetypes) out.sourcetypes = out.sourcetypes.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (out.links) out.links = out.links.split(/\s+/).filter((s) => /^https?:\/\//.test(s));
  delete out.public;
  return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// Words that say nothing about which product it is.
const NOISE = new Set(['the', 'and', 'of', 'for', 'inc', 'ltd', 'llc', 'corp', 'co', 'networks', 'network', 'technologies',
  'software', 'systems', 'security', 'secure', 'logs', 'log', 'audit', 'events', 'event', 'elastic', 'integrations', 'datadog',
  'platform', 'cloud', 'service', 'services', 'enterprise', 'edition']);
const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !NOISE.has(w));

/** Edit distance, capped: enough to tell "ICE" from "ISE" and "Fortigate" from "Fortigte". */
function distance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const near = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && distance(a, b) <= (Math.max(a.length, b.length) >= 7 ? 2 : 1));

/**
 * Is a request already covered? Every request is checked before anything is written.
 *   exists   same name, alias, id or sourcetype as an entry
 *   possible a near spelling of a product word (ICE ~ ISE) within the same vendor, most of
 *            the product words shared, or a sourcetype that extends or prefixes an entry's
 *   new      nothing close
 * Each match carries the reason, so the admin can decide to proceed, extend or skip.
 */
export function checkRequest(req, entries) {
  const asked = [req.device, ...(req.sourcetypes || [])].map((s) => String(s || '').trim().toLowerCase()).filter(Boolean);
  const want = norm(req.device);
  const exists = [], possible = [];
  const reqVendor = words(req.vendor);
  for (const e of entries) {
    const names = [e.id, e.name, e.short, ...(e.aka || [])];
    const sts = e.sourcetypes.map((x) => x.st.toLowerCase());
    if (want && names.map(norm).includes(want)) { exists.push({ id: e.id, name: e.name, reason: `same name as "${e.name}"` }); continue; }
    const sameSt = asked.find((a) => sts.includes(a));
    if (sameSt) { exists.push({ id: e.id, name: e.name, reason: `already lists sourcetype ${sameSt}` }); continue; }
    const vendorWords = words(e.vendor);
    const vendorHit = vendorWords.some((v) => (reqVendor.length ? reqVendor : words(req.device)).includes(v));
    const product = (s) => words(s).filter((w) => !vendorWords.includes(w) && !reqVendor.includes(w));
    const reqWords = product(req.device);
    // The strongest reason per entry: a sourcetype variant (3), shared product words (2),
    // a near spelling (1). A near spelling of a short word only counts when no entry name
    // shares a product word outright, so "asa" does not drag in ESA and ASR.
    let best = null;
    const offer = (score, reason) => { if (!best || score > best.score) best = { score, reason }; };
    const st = asked.find((a) => a.includes(':') && sts.some((x) => x.startsWith(`${a}:`) || a.startsWith(`${x}:`)));
    if (st) offer(3, `sourcetype ${st} is a variant of one "${e.name}" lists`);
    if (vendorHit && reqWords.length) {
      for (const n of names) {
        const ew = product(String(n).replace(/[-_]/g, ' '));
        const shared = reqWords.filter((w) => ew.includes(w));
        if (shared.length && shared.length >= Math.ceil(Math.max(reqWords.length, ew.length) * 0.6)) offer(2, `same vendor and product words (${shared.join(', ')}) as "${e.name}"`);
        if (shared.length) continue;
        const pair = reqWords.map((w) => [w, ew.find((x) => near(w, x))]).find(([, x]) => x);
        if (pair) offer(1, `same vendor, "${pair[0]}" is close to "${pair[1]}" in "${e.name}"`);
      }
    }
    if (best) possible.push({ id: e.id, name: e.name, reason: best.reason, score: best.score });
  }
  possible.sort((a, b) => b.score - a.score);
  // Near spellings are a last resort: drop them when a stronger match exists.
  const top = possible.length && possible[0].score > 1 ? possible.filter((m) => m.score > 1) : possible;
  const verdict = exists.length ? 'exists' : top.length ? 'possible' : 'new';
  return { verdict, matches: [...exists, ...top].slice(0, 5).map(({ score, ...m }) => m) };
}

/** Entries that already cover a request exactly (kept for older callers). */
export function libraryMatches(req, entries) {
  return checkRequest(req, entries).matches.filter((m) => !/close to|product words|variant/.test(m.reason)).map(({ id, name }) => ({ id, name }));
}

export function loadEntries(root = ROOT) {
  const dir = path.join(root, 'entries');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')));
}

const gh = (args) => JSON.parse(execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }));

function openRequests() {
  return gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--limit', '500', '--json', 'number,title,body,author,createdAt,url']);
}

/** Open PRs made by the skill, by request number (branch request/<n>-<id>). */
function prsByRequest() {
  const map = new Map();
  for (const pr of gh(['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,headRefName,url'])) {
    const m = pr.headRefName.match(/^request\/(\d+)-/);
    if (m) map.set(Number(m[1]), pr);
  }
  return map;
}

function describe(issue, entries, prs) {
  const req = parseRequestBody(issue.body);
  return {
    number: issue.number, url: issue.url, title: issue.title, requestedBy: issue.author?.login || null,
    createdAt: issue.createdAt, ...req, check: checkRequest(req, entries), pr: prs.get(issue.number)?.url || null,
    // Requests made on GitHub directly skip the popup's check: flag what it would have refused.
    privacy: [...new Set(scan(issue.body).map((f) => f.kind))],
  };
}

function main() {
  const [cmd = 'list', arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const label = (r) => r.pr ? `PR open ${r.pr}` : r.check.verdict === 'new' ? 'new' : `${r.check.verdict}: ${r.check.matches.map((m) => m.id).join(', ')}`;
  const asJson = process.argv.includes('--json');
  if (cmd === 'scan' && arg) {
    // The popup's privacy check over a file (an entry before it is committed). Exit 1 on findings.
    const found = scan(fs.readFileSync(arg, 'utf8'));
    for (const f of found) console.log(`${f.kind}: ${f.match}`);
    console.log(found.length ? `\n${found.length} finding(s) in ${arg}: replace each unless it is a public value on purpose.` : `✓ no private data found in ${arg}`);
    process.exit(found.length ? 1 : 0);
  }
  const entries = loadEntries();
  const prs = prsByRequest();
  if (cmd === 'list') {
    const rows = openRequests().map((i) => describe(i, entries, prs)).sort((a, b) => a.number - b.number);
    if (asJson) return console.log(JSON.stringify(rows, null, 2));
    if (!rows.length) return console.log('No open device requests.');
    for (const r of rows) {
      const state = label(r);
      console.log(`#${r.number}  ${r.device || r.title}${r.vendor ? ` (${r.vendor})` : ''}  · by ${r.requestedBy || '?'} · ${r.createdAt.slice(0, 10)} · ${state}${r.privacy.length ? ` · ⚠ privacy: ${r.privacy.join(', ')}` : ''}`);
    }
    return console.log(`\n${rows.length} open request(s). Process them with the process-device-requests skill in Claude Code.`);
  }
  if (cmd === 'check') {
    // The existence check the skills run before anything is written: one request, or all open ones.
    const issues = arg && arg !== 'all'
      ? [gh(['issue', 'view', String(arg), '--json', 'number,title,body,author,createdAt,url,labels'])]
      : openRequests();
    const rows = issues.map((i) => describe(i, entries, prs)).sort((a, b) => a.number - b.number);
    if (asJson) return console.log(JSON.stringify(rows.map(({ number, url, device, vendor, requestedBy, check, pr, privacy }) => ({ number, url, device, vendor, requestedBy, verdict: pr ? 'pr-open' : check.verdict, matches: check.matches, pr, privacy })), null, 2));
    for (const r of rows) {
      console.log(`#${r.number}  ${r.device || r.title}${r.vendor ? ` (${r.vendor})` : ''} → ${r.pr ? `PR open ${r.pr}` : r.check.verdict.toUpperCase()}${r.privacy.length ? `  ⚠ privacy: ${r.privacy.join(', ')}` : ''}`);
      for (const m of r.check.matches) console.log(`      ${m.id}  ${m.reason}`);
    }
    return;
  }
  if (cmd === 'show' && arg) {
    const issue = gh(['issue', 'view', String(arg), '--json', 'number,title,body,author,createdAt,url,labels,state']);
    if (!issue.labels.some((l) => l.name === LABEL)) throw new Error(`#${arg} is not labelled ${LABEL}`);
    const r = { ...describe(issue, entries, prs), state: issue.state };
    return console.log(asJson ? JSON.stringify(r, null, 2) : Object.entries(r).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n'));
  }
  throw new Error('usage: node scripts/requests.mjs list [--json] | check <number|all> [--json] | show <number> [--json] | scan <file>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (x) { console.error(`✗ ${x.message}`); process.exit(1); }
}
