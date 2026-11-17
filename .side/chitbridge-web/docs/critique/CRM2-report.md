# CRM2 — the PR bodies (the runner's token cannot open pull requests, as IX0 found; the coordinator opens them with these)

## chitbridge-web · round/CRM2-38344202665 → main

**VERDICT: BUILD WITH CHANGES** (docs/critique/CRM2.md): `paintDetail` is NOT extracted — it recomputes money, is workshop state (~40 app.html-only painters/actions) and M53 names it as the pane to be replaced; the chit page is the chit sheet mounted full-page (one painter, two hosts).
**Landed:** `crm.html#/chit/<id>` = `CBSheet.mount` (chit-sheet.js widened: a page host, the history from `state_log`, the CBPage note, no "Open page" icon) · route in cap-crm.js → `chitPage` (cap-crm-chits.js) · `CB_HOMES.chit` + `chitPageHref` (accounts-shell.js) · the three `openChitPage` repointed (accounts/finance new tab, crm same tab) · pages.json base script → `crm.html` (page.js BUILTIN mirrors it; crm.html loads page.js). Guard `e2e/index-not-app.cjs`: ALLOW 11 → 8 rows, green; INDEX-NOT-APP.md §1 row struck, §2/§3 marked landed.
**Reuse:** CBSheet painters + `moneyFor` (the one reader, no arithmetic), CBThread/CBAttach (R10), `CBPage.noteHTML`, `crmBar`/`crmNav`, e2e/lib/theme-measure.cjs. New paths, why: `CBSheet.mount` (the popup had no page host), `historyHTML` (no state_log painter outside app.html), `chitPage` (no route), `chitPageHref` (one place for the address). Flow: O2C step 5 · invoice names both (flows.json; O2C.md + MODULES.md regenerated — MODULES also absorbed prior drift).
**Walk (this runner):** `e2e/walk-chit-page.cjs` 15/15 — figures equal `CBTax.moneyOf(invoice)` to the paisa, history, rail, AA measured in light AND dark at 1366 and 390 px, no clipped text / inner scroll / fixed cover, no app.html link, text budget, the popup still offers Open page and it lands here, Back returns. It found `--blue #2F74C9` at 4.37:1/4.01:1 under the thread's External · Send → `#2468BD` (5.1:1) on crm/accounts/finance.
**Checks green:** index-not-app · guard-static · token-guard · dup-functions · contract · check-syntax · check-app-parses · docs-guard · process-map · missing-functions · ep-aliases · html-syntax · markup-balance · skeleton-guard · api-envelope · screen-reads · lazy-screen-guard · detail-page 14/14. e2e/chit-sheet: the Open page pin moved to the new door (passes); its one remaining failure (`cs-gst-none` on an order) is identical on main.
**Better than Zoho/Tally's "invoice view"** because it is the one record both parties hold, read from the frozen figures with the server's may/why on the rail — no second computation, no print-only clone.
**Landing:** IX0 #166 first (the guard and the doc live there; this branch is based on it), then this and the api twin `round/CRM2-38344202665` (data/pages.json byte copy) in either order. No engines change, no SQL, no new route or dependency.
🤖 Generated with [Claude Code](https://claude.com/claude-code)

## chitbridge-api · round/CRM2-38344202665 → main

**VERDICT: BUILD WITH CHANGES** (web docs/critique/CRM2.md) — api twin of web `round/CRM2-38344202665`: the chit page now lives in CB CRM (`crm.html#/chit/<id>`), so the detail-page registry's base row names `crm.html` as its script.
**Change:** `data/pages.json` is the byte copy of the web master `public/app/pages.json` (one row changed: `chit.base.detail@1.0` script `app.html` → `crm.html`, its `says` updated). No route, no SQL, no engines, no trips.
**Checks:** `CB_WEB=../chitbridge-web node tests/page-name.test.cjs` 34/34 (byte copy, grammar, mint stamps once). `node scripts/guards.cjs`: 5005 checks, 2 failing files (`pages-parse`, `till-vendor`) — both the till vendored copy on the web's IX0 branch vs this master, IX0's pending api twin; identical without this change.
**Landing:** web IX0 #166 first; then this and the web CRM2 PR in either order (CI's twin check pairs the branch names).
🤖 Generated with [Claude Code](https://claude.com/claude-code)
