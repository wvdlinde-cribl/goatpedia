---
name: process-change-requests
description: Process Goatpedia change requests (GitHub issues labelled change-request, from the site's "Request a change" button) — one by number or all open ones. For each requested part it checks the claim against sources, shows the admin what it would change and asks for approval before editing the article, then opens one validated pull request per request. Use when the admin asks to process, review, handle or apply change requests, or names a change request number.
---

# Process change requests

Input: a request number (`12`, `#12`), several numbers, or `all`. If none is given, ask: one request, or all open ones?
Each request names one article (`article`) and one or more parts (`parts`). For each part it gives "What is not correct" and, optionally, "What it should be" (`changes`), plus optional `sources`.

## Hard rules
- **Verify, then ask, then write.** A requester can be wrong. Check every claim against sources before proposing a change. Never edit an article until the admin has approved the change for that request. If you can't ask (a non-interactive run), report your findings and stop.
- **Never close, comment on, or relabel issues.** In the PR body, refer to the request with `Requested in #<n>`, never `Closes #<n>`.
- **The repo is public:** follow [the data rules](../process-device-requests/references/writing-an-entry.md#data-rules-the-repository-is-public). If a request is flagged `⚠ privacy`, copy none of its data and tell the admin.
- **One branch and one PR per request** (`change/<n>-<id>`). Change only the parts that were approved.

## Step 1 — Repository and queue
1. Go to the repository root (`git rev-parse --show-toplevel`, with `scripts/requests.mjs` present). If this skill was loaded through a link, use the repository that contains this SKILL.md (`realpath`, up three levels).
2. Run `git switch main && git pull --ff-only`, and make sure `gh auth status` succeeds.
3. Run `node scripts/requests.mjs check <n|all> --changes --json` and act on each verdict:
   - **pr-open:** skip it and link the PR.
   - **article-missing:** report it. The article id is wrong, or the article was renamed. Don't guess which one was meant.
   - **article-found:** go on. If the reason lists *parts no longer in the article* (a log, CVE, detection or optimization that has since been renamed or removed), say so.

## Step 2 — Check each claim
For each requested part, open `entries/<id>.yaml` and find that part. Check the claim against the requester's sources, vendor documentation, NVD or the vendor's advisory for CVEs, and CISA KEV. Reach a verdict:
- **confirmed:** the article is wrong. Have the corrected text ready, with its source.
- **partly confirmed:** something is off, but not exactly as described. Say what is actually right.
- **not confirmed:** the article matches the sources. Say why.
- **can't verify:** nothing authoritative either way.

## Step 3 — Ask the admin
1. Show a table per request: part, the requester's claim, your verdict, and the proposed new text with its source.
2. Then use **AskUserQuestion**, one question per request and up to 4 per call. Options:
   - **Apply the confirmed changes** (recommended when anything is confirmed)
   - **Apply all requested changes** (including ones you couldn't confirm; only on the admin's word)
   - **Skip:** nothing is written. The admin answers or closes the request.
3. If the admin wants to pick individual parts, ask a follow-up with one option per part.
4. A request with no answer is not processed.

## Step 4 — Edit and validate
1. Edit only the approved parts of `entries/<id>.yaml`. Keep the rest unchanged.
2. Set `updated:` to today, and add `ai-change-<n>` to `contributors`. If a part was "Logo", fix it in `logos.yaml` (or add a file under `logos/`) instead of the entry.
3. Run `npm run validate` and `node scripts/requests.mjs scan entries/<id>.yaml`. Fix anything they report.

## Step 5 — Pull request
1. Branch `change/<n>-<id>` from up-to-date `main`. Commit the entry, plus `logos.yaml` / `logos/` if touched. Push.
2. Run `gh pr create --base main`:
   - Title: "Correct <name>: <parts> (change request #<n>)".
   - Body: `Requested in #<n> by <requester>` (`@<login>` for a GitHub user; for a request sent from Cribl, the name in its *Requested by* section), then a table of part / claim / verdict / what changed / source, and the parts left unchanged with the reason.
3. Return to `main` before the next request.

## Step 6 — Report
Give one line per request:
- PR link and which parts changed
- **skipped:** the reason
- **article missing**
- **nothing to change:** every claim was not confirmed. The admin can answer the requester and close the request.
