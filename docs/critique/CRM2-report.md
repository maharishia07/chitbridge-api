# CRM2 (api twin) — the PR body (the runner's token cannot open pull requests; the coordinator opens it with this)

## chitbridge-api · round/CRM2-38344202665 → main

**VERDICT: BUILD WITH CHANGES** (web docs/critique/CRM2.md) — api twin of web `round/CRM2-38344202665`: the chit page now lives in CB CRM (`crm.html#/chit/<id>`), so the detail-page registry's base row names `crm.html` as its script.
**Change:** `data/pages.json` is the byte copy of the web master `public/app/pages.json` (one row changed: `chit.base.detail@1.0` script `app.html` → `crm.html`, its `says` updated). No route, no SQL, no engines, no trips.
**Checks:** `CB_WEB=../chitbridge-web node tests/page-name.test.cjs` 34/34 (byte copy, grammar, mint stamps once). `node scripts/guards.cjs`: 5005 checks, 2 failing files (`pages-parse`, `till-vendor`) — both the till vendored copy on the web's IX0 branch vs this master, IX0's pending api twin; identical without this change.
**Landing:** web IX0 #166 first; then this and the web CRM2 PR in either order (CI's twin check pairs the branch names).
🤖 Generated with [Claude Code](https://claude.com/claude-code)
