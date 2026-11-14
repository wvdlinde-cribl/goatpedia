---
name: process-device-requests
description: Process Goatpedia device requests (GitHub issues labelled device-request) — one by number, or all open ones — by writing a complete, validated entries/<id>.yaml for each and opening one pull request per device. Use when the admin asks to process, handle, work through or fill device requests, or names a request number.
---

# Process device requests

Requests come from the site's **Request a device** popup and the issue form
`.github/ISSUE_TEMPLATE/device-request.yml`. Each one is an open GitHub issue labelled `device-request`.
You turn a request into a full article and open a PR. The admin reviews it, merges it and closes the issue.

## Hard rules
- **Never close, comment on, or relabel issues.** In the PR body, refer to the request with `Requested in #<n>`, not `Closes #<n>`. The admin closes requests.
- **The repo is public.** Samples must be synthetic: documentation IPs (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), fake hosts, users and serials. Never copy a requester's pasted sample verbatim if it might be real. Rebuild it synthetically with the same structure.
- **One PR per request,** on branch `request/<n>-<id>`, so each one can be reviewed and merged on its own.
- **Facts must be sourced.** Take field names and formats from vendor documentation. Take CVEs from the vendor advisory or NVD. If you can't confirm a CVE's fixed version, leave `fixed` out (see CONTRIBUTING.md).

## Steps

1. **Pick the requests.**
   - `npm run requests` lists the open ones, with their state: `new`, `already in library: <id>` or `PR open`.
   - For one request: `node scripts/requests.mjs show <n> --json`.
   - For "all", take every request whose state is `new`. Say which ones you skip and why: PR already open, or already in the library.
2. **Request matches an existing entry.** Don't create a duplicate. If the request names sourcetypes the entry lacks, add them to that entry instead. Branch `request/<n>-<existing-id>`, PR title "Add <sourcetypes> to <name> (request #<n>)". Otherwise report "already covered by <id>" and move on.
3. **Research the device.**
   - Use the request's vendor, format, links and notes as the starting point, then the vendor documentation: log types, field reference, transport, typical volume, deployment.
   - Use NVD or vendor advisories for the CVEs.
   - Read `entries/pan-ngfw.yaml` as the quality bar, `templates/entry.yaml` for the shape, and `schema/entry.schema.json` and CONTRIBUTING.md for the rules.
4. **Write `entries/<id>.yaml`** with `status: full` and every section: facts, placement, howItWorks, traffic, logs (with synthetic samples that parse in their format), cves, detections (KQL, generic dataset names, MITRE ids), optimizations and references.
   - The `id` is kebab-case and matches the file name.
   - `category` is a key from `categories.yaml`.
   - Every `logs[].sourcetype` is listed under `sourcetypes`.
   - Set `updated:` to today, and add `contributors: [ai-request-<n>]`.
5. **Validate.** Run `npm run validate` and fix every reported problem until it passes. If a sourcetype is in the Pack Generator catalog, also add it to `coverage/pack-generator.yaml`.
6. **Open the PR.**
   - `git switch -c request/<n>-<id>` from an up-to-date `main`.
   - Commit only that entry, plus coverage if changed.
   - Push, then `gh pr create --base main --title "Add <name> (request #<n>)"`.
   - The body has `Requested in #<n>` (with the requester's GitHub name), the sources you used, and anything you could not confirm.
7. **Report back.** List each request with its PR link, and any you skipped, with the reason. Return to `main` between requests.

## When the request is too thin
When there is only a vague name and you can't identify the product with confidence, don't guess. Report the request as "needs more detail" and list exactly what is missing (vendor, product or sourcetype). The admin can ask the requester for it.
