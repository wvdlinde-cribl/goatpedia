// Vendor logos for Goatpedia entries, resolved at build time (scripts/build.js).
// Order: logos.yaml entry override → logos.yaml vendor override → the vendor name (and
// variants without "(…)", "Inc", "Networks", …) → the entry's own name or short name,
// matched against Simple Icons. A hand-added logos/<slug>.svg wins over Simple Icons.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import * as simpleIcons from 'simple-icons';

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const STRIP = /\b(inc|ltd|llc|corp|corporation|co|networks?|software|security|technologies|technology|foundation|systems|labs|group|holdings|cloud)\b/gi;

export function vendorKeys(vendor) {
  const v = String(vendor || '');
  const base = v.replace(/\(.*?\)/g, ' ').trim();
  const inner = (v.match(/\((.*?)\)/) || [])[1];
  return [...new Set([v, base, base.replace(STRIP, ' '), `${base} networks`, inner].filter(Boolean).map(norm))].filter((k) => k.length > 2);
}

/** Very light brand colours are drawn in the site's ink so they stay visible on white. */
export function displayColor(hex) {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.72 ? '#14212b' : `#${hex}`;
}

export function createLogoResolver(root) {
  const conf = yaml.load(fs.readFileSync(path.join(root, 'logos.yaml'), 'utf8')) || {};
  const vendorOverride = conf.vendors || {};
  const entryOverride = conf.entries || {};
  const icons = Object.values(simpleIcons).filter((x) => x && x.slug);
  const bySlug = new Map(icons.map((i) => [i.slug, i]));
  const byKey = new Map();
  for (const i of icons) { byKey.set(i.slug, i); if (!byKey.has(norm(i.title))) byKey.set(norm(i.title), i); }
  const handDir = path.join(root, 'logos');

  const fromSlug = (slug) => {
    const file = path.join(handDir, `${slug}.svg`);
    if (fs.existsSync(file)) return { slug, title: slug, svg: fs.readFileSync(file, 'utf8'), source: 'logos/' };
    const i = bySlug.get(slug);
    return i ? { slug, title: i.title, svg: i.svg.replace('<svg ', `<svg fill="${displayColor(i.hex)}" `), source: 'simple-icons' } : null;
  };

  /** The logo for one entry, or null (the site then shows the category icon). */
  return function resolve(e) {
    if (Object.hasOwn(entryOverride, e.id)) return entryOverride[e.id] ? fromSlug(entryOverride[e.id]) : null;
    if (Object.hasOwn(vendorOverride, e.vendor)) return vendorOverride[e.vendor] ? fromSlug(vendorOverride[e.vendor]) : null;
    for (const k of vendorKeys(e.vendor)) if (byKey.has(k)) return fromSlug(byKey.get(k).slug);
    for (const k of [norm(e.name), norm(e.short)]) if (k.length > 2 && byKey.has(k)) return fromSlug(byKey.get(k).slug);
    return null;
  };
}
