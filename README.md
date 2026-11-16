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

## Cribl Stream functions for optimizations
An optimization can include the exact Cribl Stream functions that apply it, in a `stream` block. On the site's Optimize tab these show as numbered steps, with **Copy pipeline JSON** to paste into Stream (Processing › Pipelines › Manage as JSON).
- **The parse step comes from the article's own log** (built by [`site/stream.js`](site/stream.js)): CSV with the article's column list, key=value, JSON, or the text log's regex. `serialize: true` writes the event back in its original format afterwards. CSV keeps every column in place, and removed fields become empty columns.
- **Checked in Cribl:** `npm run verify:stream` runs each pipeline in Cribl Stream's preview on the article's sample, plus any `test` events. Nothing is deployed. It checks `expect` (events left, fields gone, smaller output) and records the events and bytes before and after in [`verified/stream.json`](verified/stream.json). The site shows "Checked in Cribl Stream" and a measured saving only while the article still matches what was checked. It needs a Cribl API client in `.env` (gitignored): `CRIBL_API_URL`, `CRIBL_CLIENT_ID`, `CRIBL_CLIENT_SECRET`, and optionally `CRIBL_GROUP`.
- **The build checks every block:** function ids exist, the log exists, and every filter and expression is ES5, because Cribl does not load arrow functions, `?.`, `??` or template literals.
- **Pilot:** `pan-ngfw` (CSV), `cisco-ise` (key=value) and `okta` (JSON).
- **Drafting the rest:** `node scripts/stream-draft.mjs --category <key>` (or article ids) asks Claude, through Cribl's Aperture gateway, for each article's blocks. Each request carries only that article's logs, samples and optimization text; the rules and the pilot articles are a cached system prompt. Every block is checked (function ids, ES5) and run in Cribl's preview, and failures go back once with the exact errors. Only passing blocks are written. What still fails is listed in `verified/needs-review.json`, and the token use is printed at the end. Settings: `APERTURE_URL` (default `http://ai`), `AI_MODEL` (default `anthropic.claude-opus-5-5`), `AI_EFFORT` (default `low`).

## Vendor logos
Cards and articles show the vendor's logo when one is available. Otherwise they show the category icon.
- **Where they come from:** the [Simple Icons](https://simpleicons.org) set (CC0), matched to the vendor name at build time by [`scripts/logos.mjs`](scripts/logos.mjs). The build copies only the logos that are used to `dist/logos/`, so the site loads them from GitHub Pages and never calls a third party.
- **Fix a wrong or missing match:** edit [`logos.yaml`](logos.yaml). Map a vendor or an entry id to a Simple Icons slug, or to `null` for no logo.
- **Add a vendor Simple Icons doesn't have** (for example Microsoft, AWS, CrowdStrike, Zscaler): add its SVG as `logos/<slug>.svg` and map the vendor to that slug in `logos.yaml`.
- Logos are trademarks of their owners and are shown only to identify the product. See the [Simple Icons disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md).

## Request a device
Something missing? Click **Request a device** in the site's top bar (or **Request this device** when a search finds nothing). Fill in what you know, then **Continue on GitHub** opens the [device request form](https://github.com/wvdlinde-cribl/goatpedia/issues/new?template=device-request.yml) with your answers already in it. Sign in and click *Create*. Your GitHub name shows on the request, and that sign-in also keeps robots out. The site never asks for an email address.

### For admins: the request queue
- **See every request:** the [open `device-request` issues](https://github.com/wvdlinde-cribl/goatpedia/issues?q=is%3Aissue+is%3Aopen+label%3Adevice-request). Locally, `npm run requests` (uses your `gh` login) lists each one with its state: new, already in the library, or PR open. `node scripts/requests.mjs show <n>` prints one request's fields.
- **Check them:** `node scripts/requests.mjs check all`, or in Claude Code *"check device requests"* ([`check-device-requests`](.claude/skills/check-device-requests/SKILL.md), read-only). Each request is marked **EXISTS** (same name, alias, id or sourcetype), **POSSIBLE** (a near spelling or variant: "Cisco ICE" → `cisco-ise`) or **NEW**, with the reason.
- **Process them:** open Claude Code in this repository and ask *"process device request #12"* or *"process all device requests"* ([`process-device-requests`](.claude/skills/process-device-requests/SKILL.md)). It always runs the check first. For every EXISTS or POSSIBLE request it stops and asks you: improve the existing entry, create a new one anyway, or skip. New requests go ahead. It writes complete `entries/<id>.yaml` files, runs `npm run validate`, and opens one PR per device on `request/<n>-<id>`. It never comments on or closes issues: review the PR, merge it, then close the request.
### Request a change
Every article has a **Request a change** button next to *Edit on GitHub*. In the popup, the requester ticks one or more parts that are wrong. The list is built from that article: summary, names, category, logo, sourcetypes, facts, how it works, placement, traffic, each log type, CVE, detection and optimization by name, references, or something else. For each part they say what is not correct and, optionally, what it should be, and they can add sources. The same privacy check applies. **Continue on GitHub** opens the [change request form](https://github.com/wvdlinde-cribl/goatpedia/issues/new?template=change-request.yml) pre-filled, with the label `change-request`.

- **See them:** the [open `change-request` issues](https://github.com/wvdlinde-cribl/goatpedia/issues?q=is%3Aissue+is%3Aopen+label%3Achange-request), or `npm run requests` (both kinds). `node scripts/requests.mjs check all --changes` says whether each article still exists and whether the parts named are still in it.
- **Process them:** in Claude Code, *"process change request #12"* or *"process all change requests"* ([`process-change-requests`](.claude/skills/process-change-requests/SKILL.md)). It checks every claim against sources (confirmed / partly / not confirmed / can't verify) and shows you the proposed edits. It asks before it changes anything, then opens one PR per request on `change/<n>-<id>`.

- **From inside Cribl** (SE Toolkit): the member's Cribl sign-in identifies them. With a bot token saved in the app's Settings, the app creates the issue directly in the same layout as the forms, so the member never visits GitHub. The GitHub author is then the bot, and the issue's *Requested by* section names the member (a name, never an email). `npm run requests` and the skills use that name.
- **Other front ends** (SE Toolkit, Pack Generator) can reuse the same form. Link to `issues/new?template=device-request.yml` and pass the fields by id as query parameters: `device`, `vendor`, `category`, `sourcetypes`, `format`, `links`, `sample`, `notes`.

## Contribute
See [CONTRIBUTING.md](CONTRIBUTING.md). Most entries are still **stubs**, so picking one and completing it is the most useful contribution.
