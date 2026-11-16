# Contributing to Goatpedia

Every device is one YAML file in [`entries/`](entries/). Editing Goatpedia means opening a pull request.

## Quick edit (browser)
1. On any article, click **✎ Edit on GitHub**. Or use **+ Add device**, then paste [`templates/entry.yaml`](templates/entry.yaml).
2. Commit to a new branch and open a pull request.
3. CI validates the entry. Fix anything it reports. Once the PR is merged, the site redeploys automatically.

## Local edit
```bash
npm ci
npm run validate   # schema + cross-checks
npm run dev        # build and preview at http://localhost:8080
```

## Rules the validator enforces
- `id` matches the file name, and `category` exists in [`categories.yaml`](categories.yaml).
- `status: full` requires every section: `facts`, `placement`, `howItWorks`, `traffic`, `logs`, `cves`, `detections`, `optimizations`, `references`.
- Each log `sample` must parse in its `format`, using the same parser the site uses ([`site/parse.js`](site/parse.js)):
  - `csv` and `tsv` need `fields` with exactly one name per column.
  - `kv`, `json`, `cef`, `leef` and `xml` take field names from the sample itself. JSON is flattened to dotted paths, e.g. `actor.id`.
  - `text` needs a `pattern`: a JavaScript regex with named groups that matches the sample.
  - `key` and `noise` may only name fields that the parsed sample contains.
- Each log's `sourcetype` must be listed under `sourcetypes`.
- Detections may carry `mitre:` ATT&CK technique ids (`T1110`, `T1059.001`).
- `related` points to existing entries, and CVE ids look like `CVE-YYYY-NNNN`.
- [`coverage/pack-generator.yaml`](coverage/pack-generator.yaml) maps every sourcetype in the Cribl Pack Generator catalog to an entry. That entry must list it under `sourcetypes`.

Full schema: [`schema/entry.schema.json`](schema/entry.schema.json).

## Cribl Stream functions (optional, per optimization)
Add a `stream:` block to an optimization to give the exact Stream functions; see `entries/pan-ngfw.yaml` for an example.
- `log` names the `logs[].type` it works on. The parse step is generated from that log's format, fields or pattern.
- `functions` holds the Cribl function configs (`id`, `filter`, `conf`), written as Stream stores them.
- `serialize: true` writes the event back in its original format.
- Routing advice uses `routes`, and source settings use `note`.
- Add `test` events and an `expect` so `npm run verify:stream` can check the pipeline in Cribl's preview. Expressions must be ES5: no arrow functions, `?.`, `??` or template literals. Write fields with a dash as `__e['Field-Name']`.

## Content guidelines
- **No real customer data.** Samples must be synthetic. Use documentation IP ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) and fake hostnames and users.
- **Cite the vendor advisory** for CVE versions. If you are unsure, leave `fixed` out rather than guessing.
- `detect` says how a CVE shows up in *this device's logs*. `avoid` lists the signals or controls that prevent it.
- Detections use KQL. Keep the dataset names generic (`dataset="pan_logs"`).
- Give savings as typical ranges, not promises.
