# Goatpedia

**The security log library.** A searchable wiki of security devices and software: what they are, how they work, where they sit in the network, what traffic they handle, which logs they produce and what those logs look like, known CVEs and how to spot them, detections, and how to optimise the data.

🌐 **Site:** https://wvdlinde-cribl.github.io/goatpedia/

## What each article covers
| Section | Contents |
|---|---|
| Overview | Vendor, category, sourcetypes, key facts, how it works technically |
| Network & traffic | Placement diagram, numbered deployment positions, traffic handled, packet flow |
| Logs | Each log type with an annotated sample: key fields, droppable noise, field-by-field breakdown |
| Vulnerabilities | CVEs on the device **and** on the traffic it protects, with how to identify them and signals to avoid them |
| Detect | Detections with the signals to use, plus copy-paste KQL |
| Optimize | Volume-reduction techniques, with typical savings and the pipeline function to use |

## How it works
```
entries/*.yaml ──► scripts/build.js (validate + merge) ──► dist/index.json + dist/e/<id>.json + site/ ──► GitHub Pages
```
- **Published files:** `index.json` holds what browse, search and the Sourcetype and CVE indexes need. `e/<id>.json` holds one full article, which is fetched only when that article opens. Browse shows 24 cards per page, and the index tables show 100 rows per page. `library.json` (everything in one file) is still published for readers that load it all at once.
- **Content:** one YAML file per device in `entries/`, with categories in `categories.yaml`.
- **Validation:** JSON Schema (`schema/entry.schema.json`) plus cross-checks. The checks run on every PR.
- **Site:** a static single-page app in `site/`. Search, routing and the diagrams all run in the browser, with no backend.
- **Deploy:** `.github/workflows/pages.yml` builds and publishes on every push to `main`.

## Run locally
```bash
npm ci
npm run dev        # → http://localhost:8080
```

## Contribute
See [CONTRIBUTING.md](CONTRIBUTING.md). Most entries are still **stubs**, so picking one and completing it is the most useful contribution.
