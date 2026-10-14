# INT6b critique — `integrate/1014b` (api + web): T2 rest · SEC4 · T3 wave 1, stacked on INT6a, written before any merge

**(a) What the brief assumes, checked**
- Base = origin/integrate/1014a (INT6a not on main yet) — TRUE; `origin/main` has 0 commits not in 1014a in both repos → the main merge is a no-op.
- Every PR branch exists — TRUE except api #197 T2-SPLIT: MERGED to main already (branch deleted) → it is in the base; step 4 is a no-op.
- Engines #29 (CBOffers.overlaps/covers) on main, tag v1.46.0 — TRUE (`git tag` highest = v1.46.0). No engines change this round.
- No migrations in any of the 20 PRs (`git diff --name-only … migrations/` empty) → b541–b543 unused.
- Conflicts (merge-tree vs the base, each alone): web LABS → combo-lab.html · offer-lab-next.html; ENGONCE → cx4-pack-words · guard-static;
  PAGING → contract fixture; SEC4 → shop.html. api HONEST (99 behind) → 12 files (ai · books-period · catalogue-view · events · offers-live ·
  profile · books · chits · crm · ctp · network-design · till); PAGING → guards.cjs; SEC4/TAX-SRV1/DISPUTES → FIELDS.md; TAX-SRV1 → invoice.js.
- C:/dev area homes (../chitbridge-docs) — EMPTY checkout on this runner; DISCIPLINES.md taken from the brief inline.

**(b) Rule conflicts** — ENGONCE makes public/engine the one home and DELETES public/app/{offers,locale,…}.js; LABS (before it) edits
public/app/offers.js (the v1.46 copy) → resolve as the delete, the v1.46 bytes live in public/engine/offers.js. T3-OPS (based on a main
without ENGONCE) adds `<script src="/app/locale.js">` → re-point to /engine/locale.js (ENGONCE's guard would be red otherwise).
HONEST (loud failures, safeErr, no silent catch) × INT6a's rewrites of the same handlers → keep both intents: INT6a's one writer/one reader,
HONEST's logged catch around it. Contract: api master `--write`, web fixture a byte copy. FIELDS/flows/guards/budget: union.

**(c) Simpler way** — none; merge order as briefed, web half first.

**(d) Risks** — HONEST is 99 behind: a stale side could resurrect a silent catch or an old code path INT6a removed (SEC2 code leak) →
grep `code` in otp/signin answers after it. ENGONCE twin: api tests read web public/engine — guards must run with web integrate/1014b beside.
Till vendor drift (re-vendor if any master change). Landing: AFTER integrate/1014a; web → api.

**(e) VERDICT: BUILD WITH CHANGES** — (1) skip #197 (already on main); (2) re-point T3 rounds' /app/<engine>.js loads to /engine/.

**Found while building**
