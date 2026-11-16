/* Cribl Stream pipelines for Goatpedia optimizations, shared by the site (browser),
   scripts/build.js (validation) and scripts/stream-verify.mjs (checks in Cribl's preview).

   An optimization may carry a `stream` block:
     stream:
       log: Traffic            # which logs[].type it works on; its format and fields give the parse step
       functions: [...]        # the optimization itself, as Cribl Stream function configs
       serialize: true         # write the event back in the log's original format afterwards
       routes: [...]           # or, for routing advice: route filters (shown, not run)
       test: [raw events]      # extra synthetic events for the check (the log's sample is always used)
       expect: { out: 2 | outMin/outMax, absent: [field], present: [field], smaller: true }

   pipelineFor(entry, opt) → { functions } — parse step + the optimization + optional serialize,
   ready to paste into a Stream pipeline (Manage as JSON) or to send to the preview API.     */
(function (root) {
  // Function ids the library may use, so a typo fails the build instead of loading nothing in Stream.
  const FUNCTIONS = ['serde', 'regex_extract', 'eval', 'drop', 'suppress', 'aggregation', 'sampling', 'dynamic_sampling', 'serialize', 'mask', 'rename', 'lookup', 'unroll', 'flatten', 'numerify', 'comment'];
  const NAMES = {
    serde: 'Parser', regex_extract: 'Regex Extract', eval: 'Eval', drop: 'Drop', suppress: 'Suppress', aggregation: 'Aggregations',
    sampling: 'Sampling', dynamic_sampling: 'Dynamic Sampling', serialize: 'Serialize', mask: 'Mask', rename: 'Rename', lookup: 'Lookup',
    unroll: 'Unroll', flatten: 'Flatten', numerify: 'Numerify', comment: 'Comment',
  };
  const FORMATS = { csv: 'CSV', tsv: 'TSV', kv: 'key=value', json: 'JSON', cef: 'CEF', leef: 'LEEF', xml: 'XML', text: 'text' };

  const logOf = (entry, stream) => (entry.logs || []).find((l) => l.type === stream.log) || (entry.logs || [])[0];

  /** Turn the article's text pattern (JavaScript named groups) into a Cribl regex literal. */
  const regexLiteral = (pattern) => (/^\/.*\/[a-z]*$/.test(pattern) ? pattern : `/${pattern}/`);

  /** How Stream reads this log's format, using the article's own field list or pattern. */
  function parseStep(log) {
    const d = (text) => `Parse the ${log.type} log (${FORMATS[log.format] || log.format})${text ? ` ${text}` : ''}`;
    switch (log.format) {
      case 'csv':
        return [{ id: 'serde', filter: 'true', description: d(`into its ${log.fields.length} columns`), conf: { mode: 'extract', type: 'csv', srcField: '_raw', fields: log.fields } }];
      case 'tsv':
        return [{ id: 'serde', filter: 'true', description: d(`into its ${log.fields.length} columns`), conf: { mode: 'extract', type: 'delim', srcField: '_raw', delimChar: '\t', fields: log.fields } }];
      case 'json':
        return [{ id: 'serde', filter: 'true', description: d('into fields'), conf: { mode: 'extract', type: 'json', srcField: '_raw' } }];
      case 'kv':
        return [{ id: 'serde', filter: 'true', description: d('into fields'), conf: { mode: 'extract', type: 'kvp', srcField: '_raw' } }];
      case 'text':
        return log.pattern ? [{ id: 'regex_extract', filter: 'true', description: d('with its pattern'), conf: { source: '_raw', regex: regexLiteral(log.pattern) } }] : [];
      default:
        return []; // cef, leef, xml: the optimization's own functions read _raw directly
    }
  }

  /** Write the event back in its original format, so the destination still gets what it expects. */
  function serializeStep(log, opt) {
    const removed = new Set();
    for (const f of opt.stream.functions || []) if (f.id === 'eval') for (const r of (f.conf && f.conf.remove) || []) removed.add(r);
    switch (log.format) {
      case 'csv':
      case 'tsv':
        // Same columns in the same order; a removed field becomes an empty column, so parsers keyed on position keep working.
        return [{ id: 'serialize', filter: 'true', description: `Write the ${log.type} log back as ${FORMATS[log.format]}, same column order (removed fields stay as empty columns)`, conf: { type: log.format === 'csv' ? 'csv' : 'delim', delimChar: log.format === 'tsv' ? '\t' : undefined, dstField: '_raw', fields: log.fields } }];
      case 'json':
        return [{ id: 'serialize', filter: 'true', description: `Write the ${log.type} log back as JSON`, conf: { type: 'json', dstField: '_raw', fields: ['!_*', '!cribl_*', '!__*', '*'] } }];
      case 'kv':
        return [{ id: 'serialize', filter: 'true', description: `Write the ${log.type} log back as key=value`, conf: { type: 'kvp', dstField: '_raw', fields: ['!_*', '!cribl_*', '!__*', '*'] } }];
      default:
        return [];
    }
  }

  function clean(fn) {
    const out = { id: fn.id, filter: fn.filter == null ? 'true' : fn.filter };
    if (fn.description) out.description = fn.description;
    if (fn.final) out.final = true;
    const conf = {};
    for (const [k, v] of Object.entries(fn.conf || {})) if (v !== undefined) conf[k] = v;
    out.conf = conf;
    return out;
  }

  /** The full pipeline for one optimization: parse, the optimization, and (optionally) serialize. */
  function pipelineFor(entry, opt) {
    const s = opt.stream;
    if (!s || !s.functions || !s.functions.length) return null;
    const log = logOf(entry, s);
    const fns = [...(s.parse === false ? [] : parseStep(log)), ...s.functions, ...(s.serialize ? serializeStep(log, opt) : [])];
    return { functions: fns.map(clean) };
  }

  /** One line per step, for the article. */
  function describe(fn) {
    const c = fn.conf || {};
    const name = NAMES[fn.id] || fn.id;
    const when = fn.filter && fn.filter !== 'true' ? ` when ${fn.filter}` : '';
    switch (fn.id) {
      case 'drop': return `${name}${when}`;
      case 'eval': return `${name}${when}: ${[...(c.add || []).map((a) => `set ${a.name}`), ...(c.remove || []).length ? [`remove ${c.remove.join(', ')}`] : []].join('; ')}`;
      case 'suppress': return `${name}${when}: keep ${c.allow} per ${c.suppressPeriodSec} s for each ${c.keyExpr}`;
      case 'aggregation': return `${name}${when}: ${(c.aggregations || []).join(', ')} by ${(c.groupbys || []).join(', ')} every ${c.timeWindow}`;
      case 'sampling': return `${name}: ${(c.rules || []).map((r) => `keep 1 in ${r.rate} when ${r.filter}`).join('; ')}`;
      default: return fn.description || `${name}${when}`;
    }
  }

  const api = { FUNCTIONS, NAMES, parseStep, serializeStep, pipelineFor, describe, logOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GoatpediaStream = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
