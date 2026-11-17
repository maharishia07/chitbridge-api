# Retired pages

One line per thing retired: date · what → what replaced it · why · how to get it back. Nothing here is deleted from
history — every removal carries a tag or a commit to restore from.

- 2026-10-01 · `src/` (the frozen React app, 90 files) → `index.html` (the index page at `/`) · retired from `/` the same
  day by Athi's decision; nothing imported it any more (checked: no page, build or test referred to it; `npm run build`
  green without it) · restore: `git checkout frozen-react-app-2026-10-01 -- src`.

- 2026-10-01 · `public/offer-lab.html` → `public/offer-lab-next.html` · Athi found live: "offer lab opens the previous offer lab, which we have to discontinue — the new offer lab only has to be connected, retire the existing one." · `offer-lab.html` now only forwards to `offer-lab-next.html` (carrying the query string and hash); every real link (the index tile, app.html, cap-catsetup.js, cap-legend.js, combo-lab.html, till.html, conversion-lab.html) already pointed to, or now points to, `offer-lab-next.html` — the Offer Lab built on the real offers engine.

- 2026-10-07 · npm advisories in dev-only build tooling (`tailwindcss` 3.x and its `braces`/`micromatch`/`fast-glob`/`chokidar`
  chain, `vite` 5 and its `esbuild`/`postcss` chain) → not fixed, listed here · none ship: `tailwindcss` is unused by the app
  (no Tailwind class in `public/`; the React app under `src/` was retired 2026-10-01), `vite` only builds. The fixes are major
  bumps (`tailwindcss@4`, `vite@8`) that would touch the build for no runtime gain; `npm audit fix` (non-breaking) was applied.
  CI (`web-ci` job `scan`) gates `npm audit --omit=dev --audit-level=high`, so a high advisory in anything that ships turns it
  red; this dev-only set is re-checked by hand. `e2e/` (Playwright toolchain, 9 high, dev-only) is not audited in CI for the
  same reason · restore/re-check: `npm audit` in the repo root and `e2e/`; drop `tailwindcss`, `autoprefixer` and
  `tailwind.config.js` when Athi confirms nothing needs them.
- 2026-10-17 · `public/app/roadmap.js` (CBRoadmap, Home's roadmap and fit diagram) → the Sign-in Lab Roadmap tab (`public/signin-lab.html`, every manifest entry by state with its `fits` line); the comparison claims live in Standards › Compared with (`public/data/compare.json`) · Athi approved the regroup (docs/walks/ROADMAP-REGROUP-2026-10-17.md): it was our own self-declaration and two of its claims disagreed with the sourced table · restore: `git log --diff-filter=D -- public/app/roadmap.js`, then `git checkout <commit>^ -- public/app/roadmap.js`.
