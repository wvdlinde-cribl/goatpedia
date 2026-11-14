#!/usr/bin/env node
// Device requests: the open GitHub issues labelled `device-request`, made from the
// "Request a device" issue form (.github/ISSUE_TEMPLATE/device-request.yml).
//
//   npm run requests                     list open requests
//   node scripts/requests.mjs list --json
//   node scripts/requests.mjs show 12     one request, its fields and library matches
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

/** Library entries that already cover a request: same name/alias/id, or a shared sourcetype. */
export function libraryMatches(req, entries) {
  const want = norm(req.device);
  const sts = new Set([req.device, ...(req.sourcetypes || [])].map((s) => String(s || '').toLowerCase()));
  return entries.filter((e) => {
    const names = [e.id, e.name, e.short, ...(e.aka || [])].map(norm);
    if (want && names.includes(want)) return true;
    return e.sourcetypes.some((s) => sts.has(s.st.toLowerCase()));
  }).map((e) => ({ id: e.id, name: e.name }));
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
    createdAt: issue.createdAt, ...req, inLibrary: libraryMatches(req, entries), pr: prs.get(issue.number)?.url || null,
  };
}

function main() {
  const [cmd = 'list', arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const asJson = process.argv.includes('--json');
  const entries = loadEntries();
  const prs = prsByRequest();
  if (cmd === 'list') {
    const rows = openRequests().map((i) => describe(i, entries, prs)).sort((a, b) => a.number - b.number);
    if (asJson) return console.log(JSON.stringify(rows, null, 2));
    if (!rows.length) return console.log('No open device requests.');
    for (const r of rows) {
      const state = r.pr ? `PR open ${r.pr}` : r.inLibrary.length ? `already in library: ${r.inLibrary.map((m) => m.id).join(', ')}` : 'new';
      console.log(`#${r.number}  ${r.device || r.title}${r.vendor ? ` (${r.vendor})` : ''}  · by ${r.requestedBy || '?'} · ${r.createdAt.slice(0, 10)} · ${state}`);
    }
    return console.log(`\n${rows.length} open request(s). Process them with the process-device-requests skill in Claude Code.`);
  }
  if (cmd === 'show' && arg) {
    const issue = gh(['issue', 'view', String(arg), '--json', 'number,title,body,author,createdAt,url,labels,state']);
    if (!issue.labels.some((l) => l.name === LABEL)) throw new Error(`#${arg} is not labelled ${LABEL}`);
    const r = { ...describe(issue, entries, prs), state: issue.state };
    return console.log(asJson ? JSON.stringify(r, null, 2) : Object.entries(r).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n'));
  }
  throw new Error('usage: node scripts/requests.mjs list [--json] | show <number> [--json]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (x) { console.error(`✗ ${x.message}`); process.exit(1); }
}
