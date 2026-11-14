---
name: process-device-requests
description: Process Goatpedia device requests (GitHub issues labelled device-request) — one by number or all open ones — into complete, validated library entries with one pull request per device. Always runs the existence check first, and for any request that already exists or possibly exists it stops and asks the admin whether to improve the existing entry, create a new one anyway, or skip. Use when the admin asks to process, handle, fill or work through device requests, or names a request number to process.
---

# Process device requests

Input: a request number (`9`, `#9`), several numbers, or `all`. If none is given, ask: one request, or all open ones?
Requests come from the site's **Request a device** popup through `.github/ISSUE_TEMPLATE/device-request.yml`.

## Hard rules
- **Check before you write. Ask about every match.** Never write or change an entry for a request whose verdict is EXISTS or POSSIBLE until the admin has chosen what to do with that request. If you can't ask (a non-interactive run), report the matches and stop for those requests.
- **Never close, comment on, or relabel issues.** In the PR body, refer to the request with `Requested in #<n>`, never `Closes #<n>`. The admin closes requests.
- **The repo is public:** follow the data rules in [references/writing-an-entry.md](references/writing-an-entry.md). For a request flagged `⚠ privacy`, use only the device facts. Copy none of its data, and tell the admin so they can redact or delete the issue.
- **One branch and one PR per request** (`request/<n>-<id>`), so each one can be reviewed and merged on its own.

## Step 1 — Repository and queue
1. Go to the repository root. Run `git rev-parse --show-toplevel`, and confirm `scripts/requests.mjs` is there. If this skill was loaded through a link, use the repository that contains this SKILL.md (`realpath`, up three levels). Otherwise ask the admin for the path.
2. Run `git switch main && git pull --ff-only`, and make sure `gh auth status` succeeds.

## Step 2 — Existence check (always)
Run `node scripts/requests.mjs check <n|all> --json`. Sort the requests by verdict:
- **pr-open:** skip it and link the PR.
- **new:** go ahead (Step 4).
- **exists / possible:** needs a decision (Step 3).

Show the admin this plan as a short table before going further: request, device, verdict, candidate entries and reason.

## Step 3 — Ask about each EXISTS / POSSIBLE request
1. Open each candidate entry and judge its quality, e.g. "complete", or "thin: summary only, 1 sourcetype".
2. Ask with **AskUserQuestion**, one question per request and up to 4 per call. Batch when processing all.
   - Put the request, the candidate and the reason in the question, e.g. *"#9 'Cisco ICE' looks like existing 'Cisco Ise' (cisco-ise): "ice" is close to "ise". The entry is thin. What should I do?"*
   - Options:
     - **Improve <id>:** complete or correct the existing entry. Add the requested sourcetypes and aliases, and fill the missing sections. When there are two candidates, offer one option for each.
     - **Create a new article:** it's a different product.
     - **Skip:** nothing is written. Report it so the admin can close the request.
   - Recommend one option: usually **Improve** when the candidate is thin or the match is a typo, **Skip** when the existing entry is complete and covers everything requested.
3. Carry out exactly what was chosen. A request with no answer is not processed.

## Step 4 — Write the entry
Follow [references/writing-an-entry.md](references/writing-an-entry.md).
- **New article:** `entries/<id>.yaml` with `status: full`.
- **Improve:** edit `entries/<id>.yaml` in place. Keep the `id`, and keep existing correct content. Add the requested sourcetypes and aliases, replace weak placeholder text (such as aliases like "Elastic integrations" or "… is logged by the … package" summaries) with real descriptions, and complete every section.

Run `npm run validate` and fix every reported problem until it passes.

## Step 5 — Pull request
1. Branch `request/<n>-<id>` from up-to-date `main`. Commit only that entry, plus `coverage/pack-generator.yaml` if it changed. Push.
2. Run `gh pr create --base main`:
   - Title: "Add <name> (request #<n>)", or "Improve <name> (request #<n>)".
   - Body: `Requested in #<n> by @<requester>`, which decision was taken, the sources used, and anything that could not be confirmed.
3. Return to `main` before the next request.

## Step 6 — Report
Give one line per request:
- PR link and whether it was new or an improvement
- **skipped:** the reason (admin's choice, PR already open, or already complete)
- **needs more detail:** what is missing

Also list the requests the admin can now close.
