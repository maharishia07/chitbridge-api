# Critique · VTOUR — the visual tour, before and after sign-in (written before any code, 2026-10-14)

(a) What the brief assumes — checked
- A local stack in the runner (Postgres + api main + seed-local) — TRUE: e2e/lib/stack-local.cjs `up` + api tools/sim-load.cjs `--schema-only` on
  `docker run postgres:16` + api scripts/seed-local.cjs (Mayur Restaurant, 20 products, a supplier, a customer). Proved in this round; ~17 old
  migrations error on an empty DB (roles cb_metrics, register_*, data fix-ups b292/b293) — the chain still yields the tables the shop needs.
- walk.cjs contextAt + production guard — TRUE (e2e/lib/walk.cjs:57-75; opts.base turns the guard on). rule13.cjs — TRUE, but its `rule13()` emits
  4 PASS/FAIL steps per call; the tour reuses its `audit()` + theme-measure `measure()` per state instead (same eyes, one record per state).
- "Screen code from the chip / registry" — PARTLY FALSE: public/app/screens.js (CBSCREENS) numbers app.html's screens + Counter (OWN001) +
  Storefront (OWN002) only. No small app (accounts, finance, crm, tasks, employees, network, settings, standards, labs) and no pre-sign-in page has
  a code, and no page paints a code chip. Those states are recorded UNNUMBERED — itself a top finding for the SCREEN-ID round.
- "Every door" from public/app/manifest.json — TRUE (35 entries; 23 with a route, the rest coming/workshop = no door, recorded as such).
- docs/SEAMS.md / ../chitbridge-docs (area home, DISCIPLINES.md) — the docs checkout is EMPTY in this runner; the brief's inline copy is used.

(b) Conflicts with rules / constructs
- "Click EVERY box" vs never submit/pay/send: the clicker skips submit buttons, anything matching pay/send/delete/remove/sign out/print/publish,
  and forms; it clicks in a fresh page per element (no state leak), never on production (guard), and only fills the sign-in/register forms.
- Index-not-app: a link to app.html found on any page is a finding (rule13 audit), not followed.
- One copy: no new contrast or clip logic — theme-measure.measure + rule13.audit are reused; stack-local.serveWeb is the web.

(c) Simpler way: a per-page list of hand-written steps (tour.cjs style) — rejected, it is the drift the brief complains about. The tour DISCOVERS
  pages (index links + manifest routes) and controls at run time, so a new page is toured without an edit.

(d) Risks: runtime (every element × reload) — capped per page (TOUR_MAX_CLICKS, default 40) and split into commands (`--part a|b`, `--theme`,
  `--width`) each under 10 min. Seeded data is written only on the local DB. No migration, no api change, no engines change, no new dependency.
  Other rounds touching e2e/: new files only (visual-tour.cjs, workflow, docs/testing/TOUR-FINDINGS.md) — no merge conflicts.

(e) VERDICT: BUILD WITH CHANGES — codes come from CBSCREENS where they exist, else UNNUMBERED (finding); rule13 reused as audit() not as steps;
  clicks capped per page; screenshots go to the artifact only.
