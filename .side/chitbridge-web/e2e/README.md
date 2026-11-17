# e2e — walks and guards

Every walk is `NODE_PATH=$PWD/e2e/node_modules node e2e/<walk>.cjs [--real] [--show]` from the repo root (first time:
`cd e2e && npm ci && npx playwright install --with-deps chromium`). `--real` runs the local api (`e2e/lib/real-stack.cjs`:
`../chitbridge-api/server.js` on `CB_REAL_DB`, DEV_OTP `123456`); default is a stand-in answering inside the page.

**Signing in against a DEPLOYED api (SEC1, 2026-10-14):** the fixed codes work on a local stack only. Specs and scripts that sign in
to a deployed api type env `E2E_TESTER_CODE` (the api's `TESTER_CODE`; in CI the GitHub secret of that name) through
`e2e/lib/signin-code.cjs` — unset, they SKIP with a `::warning` naming the secret. Never write the code into a file.

## Testing another country from one PC (GOV-SPIN, 2026-10-14)

A country reaches registration from TWO sides; a walk can set both.

- **The installation side** — which ChitBridge this is. The api reads `INSTALLATION_KEY` (default `platform-0`, which states no
  country). `real-stack.cjs` passes the walk's environment through, so `INSTALLATION_KEY=au-test node e2e/<walk>.cjs --real`
  makes this PC an Australian spin. The test rows `au-test` (AU · AUD · Australia/Sydney · en-AU), `ae-test` (AE · AED · Asia/Dubai ·
  en-AE, ar-AE) and `in-test` (IN · INR · Asia/Kolkata · en-IN) come from the api's `scripts/seed-local-installations.sql` — local
  databases only, never production: `psql -X -v ON_ERROR_STOP=1 -d "$CB_REAL_DB" -f ../chitbridge-api/scripts/seed-local-installations.sql`
  (needs migration b382). A cloud spin sets it with `CB_SPIN_COUNTRY=AU` (api `deploy/spin-lib.sh`).
- **The browser side** — where the browser says it is. Playwright's `timezoneId` + `locale` (+ `geolocation`) per browser context:
  `W.run(name, walk)` with `walk.opts = { timezoneId, locale, geolocation }` for the whole walk (default Asia/Kolkata · en-IN), or
  `await w.contextAt({ timezoneId: 'Australia/Sydney', locale: 'en-AU', geolocation: { latitude: -33.87, longitude: 151.21 } })` for one
  more browser in the same walk (`e2e/lib/walk.cjs`). The register panel reads the time zone first (app/govcontext.js `countryOf`).

`e2e/walk-spin-country.cjs` runs the matrix — installation {au, ae, in, none} × browser {Sydney, Dubai, Kolkata} → the panel's line,
the ticked country, and (`--real`) the stored country + its source; one api per installation in turn. Screenshots go to `e2e/out/`
(never committed).

## The visual tour (VTOUR, 2026-10-14)

`e2e/visual-tour.cjs` walks the whole product on the LOCAL stack: Part A signed out (every page top → bottom, every box that does not
write/pay/send clicked, Sign in and New shop with the local code), Part B signed in as the simulated shop (each tab, random safe
operations). Codes come from `public/app/screens.js`; a page with none is UNNUMBERED. `--report` merges `e2e/out/tour/run-*.json` into
`tour.json` + `TOUR-FINDINGS.md` (ranked broken · inconsistent · cosmetic + the inventory). On GitHub: Actions → visual-tour (on demand,
artifact `visual-tour`). The last run's findings: `docs/testing/TOUR-FINDINGS.md`.

## Shared pieces

- `lib/walk.cjs` — the walk skeleton (steps, shots, show mode, `contextAt`).
- `lib/rule13.cjs` — brief rule 13 on a screen: Cream + Dark × 1366 + 390 px, AA contrast, no clipping, no inner sideways scroll,
  nothing over a control, no app.html link, copy within budget.
- `lib/real-stack.cjs` — the local api under a walk.
