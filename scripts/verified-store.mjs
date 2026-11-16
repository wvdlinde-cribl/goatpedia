// Cribl check results and the review list, one file per article, so batches for different
// articles never touch the same file (and their PRs never conflict):
//   verified/stream/<id>.json   { "<optimization index>": result }   scripts/stream-verify.mjs
//   verified/review/<id>.json   { "<optimization index>": { title, problems } }   stream-draft.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKS = path.join(ROOT, 'verified', 'stream');
const REVIEW = path.join(ROOT, 'verified', 'review');
const write = (file, obj) => {
  const keys = Object.keys(obj).sort((a, b) => Number(a) - Number(b));
  if (!keys.length) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(Object.fromEntries(keys.map((k) => [k, obj[k]])), null, 2)}\n`);
};
const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});

/** Every check, keyed "<id>#<index>". */
export function loadChecks() {
  const all = {};
  if (!fs.existsSync(CHECKS)) return all;
  for (const f of fs.readdirSync(CHECKS).filter((x) => x.endsWith('.json'))) {
    const id = f.slice(0, -5);
    for (const [i, r] of Object.entries(read(path.join(CHECKS, f)))) all[`${id}#${i}`] = r;
  }
  return all;
}

/** Merge results keyed "<id>#<index>" into their articles' files. */
export function saveChecks(results) {
  const byId = {};
  for (const [key, r] of Object.entries(results)) {
    const [id, i] = key.split('#');
    (byId[id] ||= {})[i] = r;
  }
  for (const [id, rs] of Object.entries(byId)) {
    const file = path.join(CHECKS, `${id}.json`);
    write(file, { ...read(file), ...rs });
  }
}

/** Replace one article's review list ({ index: { title, problems } }); empty removes the file. */
export function setReview(id, items) { write(path.join(REVIEW, `${id}.json`), items); }
