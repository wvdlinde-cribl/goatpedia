# Writing a Goatpedia entry from a request

## Sources
- **Start from the request:** vendor, format, links and notes. Treat a pasted sample only as a hint about its structure.
- **Vendor documentation:** log types, field reference, transport, typical volume and where the device is deployed. Cite these under `references`.
- **CVEs:** use NVD and the vendor advisory. If you can't confirm a fixed version, leave `fixed` out. Only set `kev: true` when the CVE is in the CISA KEV catalog.
- **Quality bar:** `entries/pan-ngfw.yaml`. Shape: `templates/entry.yaml`. Rules: `schema/entry.schema.json` and CONTRIBUTING.md.

## Data rules (the repository is public)
- **Samples are synthetic.** Use documentation IPs (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32), `example.com` hosts and mail, and fake users and serials. Never copy a requester's sample verbatim. Rebuild it with the same structure.
- **Check before you commit.** Run `node scripts/requests.mjs scan entries/<id>.yaml`, which uses the same privacy check as the popup. Every finding must be a value you chose on purpose, such as a public vendor IP in a CVE text. Otherwise replace it.

## The entry
- **Identity:** `id` is kebab-case and matches the file name. `category` is a key from `categories.yaml`. `status: full` with every section: facts, placement, howItWorks, traffic, logs, cves, detections, optimizations and references.
- **Logs:** every `logs[].sourcetype` is listed under `sourcetypes`. Each sample parses in its `format`; csv/tsv need `fields` with one name per column. `key` and `noise` only name parsed fields.
- **Detections:** KQL with generic dataset names (`dataset="<vendor>_logs"`), plus MITRE technique ids where they apply.
- **Optimizations:** typical saving ranges, the Stream function to use, and an expression.
- **Metadata:** `updated:` is today's date. Add `ai-request-<n>` to `contributors`.
- **Coverage:** if a sourcetype is in the Pack Generator catalog, map it in `coverage/pack-generator.yaml`.
- **Validate:** `npm run validate` must pass before the PR.
