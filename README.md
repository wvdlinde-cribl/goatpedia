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

## Request a device
Something missing? Click **Request a device** in the site's top bar (or **Request this device** when a search finds nothing). Fill in what you know, then **Continue on GitHub** opens the [device request form](https://github.com/wvdlinde-cribl/goatpedia/issues/new?template=device-request.yml) with your answers already in it. Sign in and click *Create*. Your GitHub name shows on the request, and that sign-in also keeps robots out. The site never asks for an email address.

### For admins: the request queue
- **See every request:** the [open `device-request` issues](https://github.com/wvdlinde-cribl/goatpedia/issues?q=is%3Aissue+is%3Aopen+label%3Adevice-request). Locally, `npm run requests` (uses your `gh` login) lists each one with its state: new, already in the library, or PR open. `node scripts/requests.mjs show <n>` prints one request's fields.
- **Process them:** open Claude Code in this repository and ask it to *process device request #12*, or to *process all device requests*. The [`process-device-requests`](.claude/skills/process-device-requests/SKILL.md) skill researches each device and writes a complete `entries/<id>.yaml`. It runs `npm run validate`, then opens one PR per device on `request/<n>-<id>`. It never comments on or closes issues: review the PR, merge it, then close the request.
- **Other front ends** (SE Toolkit, Pack Generator) can reuse the same form. Link to `issues/new?template=device-request.yml` and pass the fields by id as query parameters: `device`, `vendor`, `category`, `sourcetypes`, `format`, `links`, `sample`, `notes`.

## Contribute
See [CONTRIBUTING.md](CONTRIBUTING.md). Most entries are still **stubs**, so picking one and completing it is the most useful contribution.
