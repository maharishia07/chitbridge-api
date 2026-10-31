# Retired / deferred

One line per thing: date · what · why · how to get it back.

- 2026-10-07 · npm advisory in dev-only tooling (`nodemon` 3 → `chokidar` → `braces`, stack-exhaustion DoS, high) → not fixed,
  listed here · it never ships (devDependency, used only for local `npm run dev`); npm's only offered fix is a downgrade to
  `nodemon@1.14.10`. `npm audit fix` (non-breaking) cleared the production set (`compression`, `proxy-addr`, `brace-expansion`,
  `browserslist`). CI (`scan` job) gates `npm audit --omit=dev --audit-level=high` · re-check: `npm audit` in the repo root.
- 2026-10-08 · `tests/units-alias.test.js` "AN ENTITY MAY TEACH A WORD, NEVER REDEFINE ONE" → marked `todo` (M43) · it fails by
  design: per-entity taught vocabulary (`normUnit(word, entityMap)`) was dropped in a rewrite and restoring it is Athi's call
  (BACKLOG "THE PER-ENTITY TAUGHT VOCABULARY"). Node still prints it as TODO on every run · to bring it back: restore the map in
  `lib/units.js`, delete the `todo` option.
- 2026-10-31 · `GET /api/entities/lookup` (exact `user_id` match on `identities`, entities.js) → retired (M4) · replacement: `GET /api/entities/search?q=<user_id>`, which matches user_id first (a miss answers 200 `{results:[],count:0}`, not 404); the only caller was `scripts/prove-network-mint.js`, repointed · Athi decision 31 Oct 2026 (a)+(a), PM/ATHI-DECISIONS.md, API-RATIONALISATION-ASSESSMENT.md M4 · to bring it back: `git show retired/2026-10-31-entities-lookup` (tag pushed after merge) and restore the handler, the `GET /lookup` contract entry and the two words.
