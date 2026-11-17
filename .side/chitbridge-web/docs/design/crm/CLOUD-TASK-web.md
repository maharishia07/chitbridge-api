# Cloud task — CB CRM, Phases 3 and 4, the SCREENS (Sonnet)

**Outcome (one):** the CB CRM page (`public/crm.html`) for Phase 3 (home, record, timeline) and Phase 4 (add party, log
sheet, follow-ups, the record's Next block), as `docs/design/crm/PLAN.md` lists, drawn from the designer handoff
`docs/design/crm/handoff/` and the REQUIREMENT-*.md files, on THIS branch (`cloud/crm-web`), in a DRAFT PR against `main`
("stacked on #30 CBList; the API is chitbridge-api PR #15"). Never push to `main`. No secrets, no live sites, no SQL.

## ⭐ The FROZEN look wins over the handoff (Athi, 2026-10-02: "follow the header rules we just finalised")
Pass mark: `docs/design/list-standard/index.html` + `docs/design/SYSTEM.md` §3a. So:
- Every list (home's party list, follow-ups, the timeline if tabular) is a **CBList mount** (`public/app/list-ctl.js`,
  `window.CBList.mount`; contract in `docs/design/list-control/PLAN.md`; see how cap-books.js / app.html mount it on this
  branch). Never draw a table header by hand: `e2e/list-standard.cjs` fails it.
- The **three-row head ≤ 20%** (title row with period/notice chips · tools row · column header), adjustable columns, only
  the rows scroll, ⚙ columns, ▤ grid / ☰ lines, ⇣/⇡.
- The avatar: leave a slot in the title row; **CBAvatar** is being built in parallel (branch feat/cbavatar) and is mounted
  at integration. Don't build an avatar.
- The record page is the ONE detail-page direction (docs/design/chit-detail/REQUIREMENT.md): same structure, only the
  action bar differs per place.
Where the handoff differs from these, follow these and list the difference in the PR.

## Data
The API (chitbridge-api PR #15, merging): `GET /api/crm/parties`, `/api/crm/parties/:id`, `/api/crm/parties/:id/timeline`,
`POST /api/crm/parties/:id/interactions`, `/api/crm/followups` (CRUD), add by name via `POST /customers {name, phone,
gstin}` (merged, api #13). Shapes: the API PR's tests and docs/design/crm/DATA.md. Money (dues) is READ from the API's
stored figures, never computed on the page (DECISIONS "compute once"). Before migration b276 runs, interactions/follow-ups
answer 503 "not migrated yet": show that state plainly ("Calls and follow-ups start after an update; nothing is lost").
Provisional answers in use (Athi to confirm): Q4 one party two roles (one row, both chips) · Q9 own page crm.html like CB
Accounts · Q10 "Remove from my parties" only with no open dues. Phase 5 (mail) and 6 (merge/import) are NOT in this task.

## Proof
`e2e/crm.cjs` (the golden-parties suite from PLAN.md §"conformance suite": seed `e2e/fixtures/golden-parties.json`, a
stand-in API on a free OS port, never localhost:3000 / 7351 / the live site), its asserts (one row for a both-roles party,
merged party never listed, local party has no Message, 390 px scrollWidth === 390, no "accounting", every alert has its fix
button, no per-row fetch, the page computes no money, a co-assist sees no Import/Export/Merge) and `e2e/crm-breaks.cjs`.
Plus `e2e/list-standard.cjs`, `e2e/list-unit.cjs`, check-syntax, app-syntax, dup-functions, missing-functions,
markup-balance, cb-build-guard (bump CB_BUILD). Playwright isn't in the cloud image: install it in a temp dir and point
NODE_PATH at it; say so. Screenshots: e2e/shots/crm-{home,record,timeline,followups,add}-{laptop,phone}.png.

**Commit and push after EACH logical step** so nothing is lost if the session stops.

## Do not touch
`public/till.html` and `public/engine/*` (vendored), the API repo, SQL, `public/app/list-ctl.js` internals (use its contract;
report a gap instead of changing it). Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
