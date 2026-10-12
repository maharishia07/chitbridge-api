# CL1 · PR body for round/CL1-38318882750 (the runner's token cannot open a PR — open it with this body)

Title: CL1: adopt engines v1.37.0 — reg-ae with the registry; the browser tax bundle carries the packs

**CL1 (api half)** — adopt engines v1.37.0: `reg-ae` beside `reg-in` · `reg-au` · `regulation`; `tax-packs` + `tax` 1.20.0 → 1.37.0 (tax reads a line's supply kind from the seller's own pack; tax-packs reads the registry). India answers unchanged (engines in-snapshot holds them to the paisa); no route, no SQL, no new dependency, no trips change.
**Why here:** the web's tax-mirror guard (`e2e/tax-slab.test.cjs`) holds both repos to ONE release of tax, so the Country lab's move (web PR `round/CL1-38318882750`) moves the api with it.
**Bundle:** `lib/tax-engine.browser.js` — what `GET /api/till/engine/tax` serves a shop PC — now carries reg-in · reg-au · reg-ae · regulation ahead of tax-packs (which throws at load without the registry); one tag on the page as before, the same shape the web's `public/engine/tax.js` took.
**Tests:** `tests/tax-vendor.test.js` — the vm sandbox's `window` is its global, as a browser's is (till-vendor's `load()` already did this; a separate `window` object hid `CBRegIN` from the registry); `tests/engine-manifest.js` lists `reg-ae.js`. `node scripts/guards.cjs`: 4898 checks · 163 files · all passed; till-vendor and tax-vendor green.
**Landing order:** this first, then the web PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
