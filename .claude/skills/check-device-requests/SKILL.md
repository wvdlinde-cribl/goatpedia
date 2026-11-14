---
name: check-device-requests
description: Report on Goatpedia device requests (GitHub issues labelled device-request) without changing anything — for each open request, or one by number, say whether the device already EXISTS in the library, POSSIBLY exists (a near spelling or variant), or is NEW, with the reason, plus open PRs and privacy flags. Use when the admin asks to check, review, triage or list device requests, or asks whether a requested device already exists.
---

# Check device requests (read-only)

This skill only reports. It writes no files, opens no PRs, and never comments on, labels or closes issues.

## Steps
1. **Go to the repository root.** Run `git rev-parse --show-toplevel` and confirm `scripts/requests.mjs` exists there. If this skill was loaded through a link from elsewhere, use the repository that contains this SKILL.md (`realpath` it, then go up three levels). If neither works, ask the admin for the goatpedia checkout path.
2. **Run the check.**
   - For one request: `node scripts/requests.mjs check <n> --json`.
   - For all open requests: `node scripts/requests.mjs check all --json`.
   - If `gh` isn't signed in, say so and stop.
3. **Report a table:** request number, device (vendor), requester and verdict.
   - **EXISTS:** the entry id and why (same name, alias, id or sourcetype).
   - **POSSIBLE:** each candidate entry id and the reason, e.g. `"ice" is close to "ise" in "Cisco Ise"`. Say plainly that it may be a typo or a variant.
   - **NEW:** nothing close in the library.
   - **PR-OPEN:** a processing PR already exists. Link it.
   - **⚠ privacy:** the request contains data the form would have refused. Name the kinds, never the values.
4. **For EXISTS and POSSIBLE,** open the candidate entry (`entries/<id>.yaml`) and add one line on its quality: complete, or thin (a summary only, few sourcetypes, aliases like "Elastic integrations"). That helps the admin choose between improving the entry and skipping.
5. **End with the next step:** *"process device request #n"* or *"process all device requests"* (the process-device-requests skill). That skill will ask about every EXISTS and POSSIBLE request before it writes anything.
