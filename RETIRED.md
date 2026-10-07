# Retired / deferred

One line per thing: date · what · why · how to get it back.

- 2026-10-07 · npm advisory in dev-only tooling (`nodemon` 3 → `chokidar` → `braces`, stack-exhaustion DoS, high) → not fixed,
  listed here · it never ships (devDependency, used only for local `npm run dev`); npm's only offered fix is a downgrade to
  `nodemon@1.14.10`. `npm audit fix` (non-breaking) cleared the production set (`compression`, `proxy-addr`, `brace-expansion`,
  `browserslist`). CI (`scan` job) gates `npm audit --omit=dev --audit-level=high` · re-check: `npm audit` in the repo root.
