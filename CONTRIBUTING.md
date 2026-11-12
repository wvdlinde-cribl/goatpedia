# Contributing to Secpedia

Every device is one YAML file in [`entries/`](entries/). Editing Secpedia means opening a pull request.

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
- `status: full` requires every section: `facts`, `placement`, `howItWorks`, `traffic`, `logs`, `cves`, `detections`, `optimizations`.
- Each log `sample` has exactly as many CSV columns as `fields`, and `key`/`noise` only name existing fields.
- `related` points to existing entries, and CVE ids look like `CVE-YYYY-NNNN`.

Full schema: [`schema/entry.schema.json`](schema/entry.schema.json).

## Content guidelines
- **No real customer data.** Samples must be synthetic. Use documentation IP ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) and fake hostnames and users.
- **Cite the vendor advisory** for CVE versions. If you are unsure, leave `fixed` out rather than guessing.
- `detect` says how a CVE shows up in *this device's logs*. `avoid` lists the signals or controls that prevent it.
- Detections use KQL. Keep the dataset names generic (`dataset="pan_logs"`).
- Give savings as typical ranges, not promises.
