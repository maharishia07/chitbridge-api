// Playwright config — drives the LIVE app (Vercel web + Railway API). Trace ON (the reviewer wants the filmstrip).
// THREE projects: `setup` mints a shared session once → `authed` flows start signed-in (fast re-runs, no re-onboarding);
// `noauth` runs the flows that must start LOGGED OUT (onboarding/flow/redproof). Multi-party flows spin up their own
// fresh contexts, so they're unaffected by the saved session. Override the web host with CB_WEB_BASE.
const { defineConfig, devices } = require('@playwright/test');
const fs = require('fs');
const AUTH_FILE = '.auth/user.json';
// Reuse the saved session if `setup` has run; otherwise leave it unset so each authed flow mints its OWN entity
// (mintEntity self-detects). This is what lets ANY single flow run standalone — e.g. `npx playwright test -g CAT-01`.
const SAVED_SESSION = fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined;
// The shop COUNTER runs at 1366×768 (Athi, 2026-07-18) — test at the operator's real screen, not a generic desktop.
const COUNTER = { width: 1366, height: 768 };
const LAPTOP  = { width: 1920, height: 1080 };   // a normal 14" laptop (FHD) — Athi wants it to hold up here too
// Counter-critical flows that get the cross-browser + size sweep — where a browser/size break actually hurts the operator.
/* ⚠️ anchored to the file name — unanchored, /storefront\.spec\.js/ also ran network-storefront.spec.js in four more browsers */
const COUNTER_FLOWS = [/[\\/]keyboard\.spec\.js$/, /[\\/]storefront\.spec\.js$/, /[\\/]chits\.spec\.js$/];

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,        // stateful flows — keep order deterministic
  /**
   * ⚠️ ONE WORKER, AND IT IS NOT ABOUT SPEED.
   *
   * `fullyParallel:false` only serialises tests WITHIN a file; separate FILES still ran across two workers. Every
   * `authed` spec signs in from ONE shared session (auth.setup.js → .auth/user.json), so those parallel files are
   * not different tenants — they are the SAME entity, and they assert on relative counts inside it
   * (`const before = …count(); expect(…).toHaveCount(before + 1)`). One file adding an intake row while another
   * is counting is a guaranteed, timing-dependent failure.
   *
   * ⚠️ IT IS NOT AN ISOLATION PROBLEM AND MUST NOT BE READ AS ONE. Cross-entity isolation is proven separately and
   * hard: prove-channels 17/17 ("A did NOT receive B's — one webhook, many entities, no leakage"), and variants
   * runs Alpha against Beta's catalogue. The bug was two tests wearing the same account.
   *
   * On 2026-08-10 this produced three red specs that every one of them passed alone — the most expensive kind of
   * failure, because it reads as a regression in whatever was last changed.
   */
  workers: 1,
  retries: 0,                  // a real break must show RED, not be retried away
  /* ⭐ JUnit XML is the ADOPTED standard, not a format of ours: Playwright writes it, every CI reads it, and
     Kiwi TCMS / TestRail / Allure all import it. `node post-results.cjs <token>` pushes this file to the test
     board, so an automated run and a person tapping Pass on a phone land on the same board. ⚠ A spec's case
     key must be in its title in brackets — `[CTR-05] a single click chooses` — which is the convention the
     specs already follow; the ingest REPORTS any test whose name carries no key rather than dropping it. */
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }],
             ['junit', { outputFile: 'test-results/junit.xml' }]],
  use: {
    baseURL: process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app',
    viewport: COUNTER,         // the counter's real screen size
    /* ⚠️ NOT for the tour. 27 narrated cases × a 16-row product page × framed storefronts = DOM snapshots the worker
       holds in memory until the test ends: the tour's node worker died with 'JavaScript heap out of memory' at 8.8 min
       (2026-09-04) and the headed run froze on a caption. The tour runs with trace and video off, 4 GB heap. */
    trace: process.env.TOUR ? 'off' : 'retain-on-failure',   // a full trace per test held ~1.3 GB in one browser (2026-09-06); failures keep theirs
    screenshot: 'only-on-failure',
    video: process.env.TOUR ? 'off' : 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    // 1 · mint the shared logged-in session once
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    // 1b · provision the STABLE ENTITY POOL (run on demand: `npm run pool`) — reusable entities for parallel/swarm runs
    { name: 'pool', testMatch: /pool\.setup\.js/, use: { ...devices['Desktop Chrome'] } },
    // 1c · SWARM — concurrent global-load simulation over the whole pool (loads pool sessions itself; needs `npm run pool` first)
    { name: 'swarm', testMatch: /swarm\.spec\.js/, use: { ...devices['Desktop Chrome'], viewport: COUNTER } },
    // 2 · flows that reuse the saved session (start signed-in; re-run any one instantly)
    {
      name: 'authed',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: SAVED_SESSION },
      testMatch: /.*\.spec\.js/,
      // ⚠️ ANCHORED TO THE FILENAME. These were bare substrings, so `/flow\.spec\.js/` also matched
      // step-flow.spec.js — a brand-new spec was silently excluded from every project and reported as
      // "No tests found". A test that is skipped because of a name collision is worse than a failing one:
      // it looks like it passed. Any future `<something>-flow.spec.js` would have hit the same wall.
      /**
       * ⚠️⚠️ EVERY noauth SPEC MUST BE IGNORED HERE, not just the first four. `testMatch` is `.*\.spec\.js`, so
       * anything absent from this list runs in BOTH projects — and the noauth specs then run WITH a saved
       * session, which is the wrong context for every one of them by definition.
       *
       * Found 2026-08-17 running `--project=authed` as a regression: signed-out failed because a signed-in tab
       * correctly stays at `#/` rather than redirecting to login, and currency-matrix's empty-shop cases failed
       * because they are CUSTOMER views that must arrive with no session. Three failures, none of them real,
       * against a change set that had nothing to do with any of it — which is the expensive kind of false
       * negative: it sends you looking for a regression that was never there.
       *
       * ⚠️ KEEP THIS IN SYNC WITH THE noauth testMatch BELOW. Two lists describing one fact is the flaw; until
       * they are derived from one another, adding a spec to noauth means adding it here in the same commit.
       */
      /* ⚠️ THE TWO LISTS ARE NOT INTERCHANGEABLE, so they were NOT merged. `swarm` appears here and NOT in the
         noauth testMatch below — it is opt-in and must run in neither project by default. Deriving one list from
         the other would quietly start running it. The duplication is real and is the lesser problem; adding a
         noauth spec still means editing both, in the same commit. */
      testIgnore: [/[\\/]onboarding\.spec\.js$/, /[\\/]flow\.spec\.js$/, /[\\/]redproof\.spec\.js$/, /[\\/]swarm\.spec\.js$/,
        /[\\/]signed-out\.spec\.js$/, /[\\/]currency-matrix\.spec\.js$/, /[\\/]mode-survives-order\.spec\.js$/,
        /[\\/]variants\.spec\.js$/, /[\\/]network-cascade\.spec\.js$/, /[\\/]render-smoke\.spec\.js$/,
        /[\\/]enquiry\.spec\.js$/, /[\\/]message-privacy\.spec\.js$/, /[\\/]dispute-privacy\.spec\.js$/,
        /[\\/]shop-publish\.spec\.js$/, /[\\/]notif-clear\.spec\.js$/,
        /* iam.spec.js writes its own cb_sess for a FRESH entity — a saved session would be the wrong one, and
           its assertions are about the entity it just created. Added to the noauth testMatch in the same
           commit, per the warning above. */
        /[\\/]iam\.spec\.js$/],
    },
    // 3 · flows that must start LOGGED OUT (they test onboarding itself / the welcome screen)
    {
      name: 'noauth',
      use: { ...devices['Desktop Chrome'] },
      // currency-matrix belongs here: it is a CUSTOMER view. It authenticates to the API itself to arrange each
      // combination, then loads the storefront with no session — which is how a real buyer arrives.
      // Anchored for the same reason as the ignore list above — an unanchored /flow\.spec\.js/ would pull any
      // future `<x>-flow.spec.js` into the logged-out project, where a signed-in flow would fail for no real reason.
      testMatch: [/[\\/]onboarding\.spec\.js$/, /[\\/]flow\.spec\.js$/, /[\\/]redproof\.spec\.js$/,
        /currency-matrix\.spec\.js/, /mode-survives-order\.spec\.js/, /variants\.spec\.js/,
        // the cascade is a CUSTOMER view too: it arranges every combination through the API, then arrives at the
        // storefront with no session — which is how a buyer actually gets there.
        /network-cascade\.spec\.js/,
        // signed-out is the definition of a noauth test: it asserts that no session means no app, over time
        /signed-out\.spec\.js/,
        // IAM arranges a FRESH entity through the API and writes its own cb_sess — it must not inherit a saved
        // one, because every assertion is about the entity it just created. See the ignore list above.
        /[\\/]iam\.spec\.js$/,
        // ⚠️ THE PRE-PUSH GATE. Seconds, no login, no data: did the page BOOT without throwing? Five defects in the
        // 2026-08-09 cart integration were invisible to node -c and to the unit tests, and twice took the public
        // storefront down. Run before pushing anything touching app.html, shop.html or app/*.js.
        /render-smoke\.spec\.js/,
        // ⭐ Product enquiry is an API-level, multi-party test: it signs in three parties itself and never wants a
        // saved session. It proves the question reaches the SELLER and that an unrelated entity sees nothing.
        /enquiry\.spec\.js/,
        // ⭐⭐ The internal/external boundary, proven across TWO entities. messages.spec.js carried this as a
        // test.skip('needs a 2nd entity') — an intention where the proof should be, on the single most
        // consequential claim the messaging layer makes.
        /message-privacy\.spec\.js/,
        // ⭐⭐ THE USP ITSELF: A disputes with B only, and C — on the same chit — never learns of it. Two
        // separate skipped tests claimed this and proved nothing; one of their titles literally ends "(the USP)".
        /dispute-privacy\.spec\.js/,
        // ⭐⭐ Can a NEW business open its shop? Until 2026-08-18 the answer was NO, and every storefront spec
        // here passed anyway — because they all used alpha and gamma, two shops that were already open. A
        // fixture already in the end state cannot test the transition into it.
        /shop-publish\.spec\.js/,
        // ⚠️ Activity clear is TWO-PARTY of necessity: the feed excludes your OWN actions by design, so a single
        // entity can do anything it likes and its Activity list stays empty.
        /notif-clear\.spec\.js/],
    },
    // 4 · CROSS-BROWSER + SIZE sweep of the COUNTER flows (keyboard/storefront/chits). Opt-in — run e.g.
    //     `npx playwright test --project=counter-firefox`. The default run stays Chromium@counter for speed.
    { name: 'counter-firefox', dependencies: ['setup'], testMatch: COUNTER_FLOWS,
      use: { ...devices['Desktop Firefox'], viewport: COUNTER, storageState: SAVED_SESSION } },
    { name: 'counter-webkit',  dependencies: ['setup'], testMatch: COUNTER_FLOWS,
      use: { ...devices['Desktop Safari'],  viewport: COUNTER, storageState: SAVED_SESSION } },
    { name: 'laptop',          dependencies: ['setup'], testMatch: COUNTER_FLOWS,
      use: { ...devices['Desktop Chrome'],  viewport: LAPTOP,  storageState: SAVED_SESSION } },
    { name: 'mobile',          dependencies: ['setup'], testMatch: COUNTER_FLOWS,
      use: { ...devices['Pixel 5'],         storageState: SAVED_SESSION } },
  ],
});
