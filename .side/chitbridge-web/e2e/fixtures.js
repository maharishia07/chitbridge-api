// fixtures.js — Shared helpers for the e2e specs. Kept tiny so each MODULE spec stays self-describing.
const { expect } = require('@playwright/test');   // composeChit asserts the wizard actually advanced
/**
 * ⭐ SEC1 (Athi, 2026-10-14: "do not keep the code in the logic, i can share the password to the testers") — THE SIGN-IN CODE the suite
 * types. Against a DEPLOYED api it is the testers' code, env E2E_TESTER_CODE (a GitHub secret Athi sets) — never a fallback: unset →
 * null, and needCode() / mintEntity SKIP with a CI warning naming the secret (a skip, never a silent pass). Against a LOCAL api
 * (CB_API_BASE / CB_API on localhost, or the web served from localhost with no api named) it is the local stack's fixed code — the api
 * accepts those on a local stack only (chitbridge-api lib/dev-otp.js). `kind` 'customer' = the storefront's own local code.
 */
const { signinCode, warnNoCode, NO_CODE } = require('./lib/signin-code.cjs');   // the one rule — shared with the standalone scripts
/** needCode(test) — at the top of a spec that signs in through the api: skips the whole file, loudly, when there is no code to type */
function needCode(test) {
  if (signinCode()) return;
  warnNoCode();
  test.skip(true, NO_CODE);
}
const DEV_OTP = signinCode();   // the name the specs already import — now the code for THIS target (null → needCode skips)

// a fresh identity per run so specs never collide on an existing entity/email.
function uniqueEmail(prefix) {
  return (prefix || 'e2e') + '.' + Date.now() + '.' + Math.floor(Math.random() * 1e4) + '@test.example';
}
/**
 * ⭐⭐ A USER ID, NOT A DISPLAY NAME — the registration screen changed under this fixture and it took the whole
 * suite down without saying so.
 *
 * ⚠⚠ `reg-name` USED TO BE THE BUSINESS NAME AND IS NOW THE USER ID. Athi, 2026-08-19: *"the user id
 * registered cannot be changed — through IAM they can change the display name."* So the field now runs through
 * lib/handle.checkRoot: 8+ characters, lowercase letters, numbers and dashes, and no `@` or `.` because those
 * separators mean an EMPLOYEE and a NETWORK STORE. `uniqueName()` returns 'E2E Co 341383' — spaces and
 * capitals — so registration was refused, the form never advanced, and every spec in the suite failed at
 * auth.setup with "still on #/register".
 *
 * ⚠️ THE SUITE REPORTED IT AS A TIMEOUT, which is why it went undiagnosed for days: `toHaveURL(/#/app/)`
 * polled 23 times and gave up. A screen that refuses your input looks exactly like a screen that is slow.
 *
 * ⚠️ AND IT MUST BE UNIQUE PLATFORM-WIDE, not merely per run — user_id carries a UNIQUE index across ALL
 * identities and is SET ONCE, so a fixed handle works exactly once and 409s forever after.
 */
function uniqueHandle(prefix) {
  return ((prefix || 'e2eco') + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1e3))
    .toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function uniqueName(prefix) {
  return (prefix || 'E2E Co') + ' ' + Date.now().toString().slice(-6);
}

/**
 * ⭐ WHICH API THE BROWSER TALKS TO — and why the suite needs to be able to say.
 *
 * Served from localhost, app.html resolves API_BASE to `http://localhost:3000`, and vite proxies /api there too.
 * That is the right default for development, but it silently couples the whole suite to one local process: the
 * moment it is down, EVERY spec fails at registration with "You're offline", which reads like a broken app rather
 * than a missing server. app.html already honours `localStorage.cb_api_base` for exactly this; the suite just
 * never used it.
 *
 *   CB_API_BASE=https://chitbridge-api-production.up.railway.app npx playwright test …
 *
 * ⚠️ Unset, nothing changes — the local API stays the default, so this cannot quietly start pointing a developer's
 * run at production.
 */
async function useApiBase(page) {
  const base = process.env.CB_API_BASE;
  if (!base) return;
  await page.addInitScript((b) => { try { localStorage.setItem('cb_api_base', b); } catch (e) {} }, base);
}

/**
 * passCountryStep(page, country) — answer the COUNTRY SETUP step the way an owner does (CS1, 2026-10-12; round W2).
 *
 * ⭐⭐ A NEW SHOP LANDS ON #/country, NOT #/app. Since CS1 (web #137) verify goes to Country setup — country · money · financial
 * year · tax registration, prefilled from the time zone, each with its source — and the app opens only after ONE Continue
 * (one PUT /api/governance/country-setup). mintEntity waited for #/app, swallowed the miss, and the next nav click then waited
 * 30 s for `nav-catalogue` (till-demo red on main). The same lesson as reg-name and reg-agree above: a step the product added
 * reads as a slow screen. Answered HERE, once, so no spec and no harness answers it its own way.
 *
 * `country` — the ISO code to pick when the prefill is not it. The suite's shop is Indian (GST specs, ₹ prices, the India pack),
 * while a GitHub runner sits in UTC with an en-US browser and is prefilled US — so mintEntity passes 'IN' by default. Falsy →
 * accept the prefill, as a person who agrees with it does. Picked through the row's own Change → select, never by poking state.
 *
 * ⚠️ BEFORE b299 RUNS ON THE SERVER the PUT answers 503, the step says so and offers "Open the app" (cs-open) — pressed here, so
 * the shop still opens. Any other refusal is thrown IN WORDS (the server's sentence), not left as a timeout three steps later.
 * Returns true when the step was there and answered, false when it never showed (a returning owner boots straight to #/app).
 */
async function passCountryStep(page, country) {
  const there = await page.getByTestId('cs-rows').waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  if (!there) return false;
  if (country) {
    const want = String(country).toUpperCase();
    // WALK-REG 2026-10-16: a not-yet-answered row shows its picker INLINE; only an answered row has the edit icon (cs-change-country)
    const sel = page.getByTestId('cs-country');
    if (!(await sel.isVisible().catch(() => false))) await page.getByTestId('cs-change-country').click();
    await sel.waitFor({ state: 'visible', timeout: 5000 });
    if ((await sel.inputValue()) !== want) {
      if (!(await sel.locator('option[value="' + want + '"]').count())) {
        throw new Error('passCountryStep: the country picker does not offer ' + want + ' — it offers: ' + (await sel.locator('option').allTextContents()).join(', '));
      }
      await sel.selectOption(want);                                  // fires change → the screen re-paints with that country's money
      await page.waitForFunction((w) => { const s = document.querySelector('[data-testid="cs-country"]'); return !!s && s.value === w; }, want, { timeout: 5000 });
    }
  }
  const saved = page.waitForResponse((r) => /\/api\/governance\/country-setup/.test(r.url()) && r.request().method() === 'PUT', { timeout: 30000 }).catch(() => null);
  await page.getByTestId('cs-save').click();
  const res = await saved;
  if (!res) {
    const err = await page.getByTestId('cs-err').textContent().catch(() => '');
    throw new Error('passCountryStep: Continue sent no PUT /api/governance/country-setup' + (err ? ' — the step says: ' + err : ''));
  }
  if (res.status() === 503) {
    await page.getByTestId('cs-open').click();                       // "Open the app" — the server is before b299; the shop opens unstamped
  } else if (res.status() >= 400) {
    const body = await res.text().catch(() => '');
    throw new Error('passCountryStep: PUT /api/governance/country-setup refused ' + res.status() + ': ' + body.slice(0, 300));
  }
  await page.waitForURL(/#\/app/, { timeout: 15000 });
  return true;
}

// Reusable: walk the onboarding→register→verify (mint) flow and land in the app. Returns { email, name }.
// This is the shared "arrange" step other modules (chits, catalogue) build on — and the heart of the DoD.
// `country` — the Country setup step's answer for a NEW shop (see passCountryStep); 'IN' is the shop every spec assumes.
async function mintEntity(page, { role = 'business', email, name, fresh = false, country = 'IN' } = {}) {
  /**
   * ⭐ fresh:true — A CLEAN ENTITY, WHATEVER THE BATCH RESTORED. In the `authed` project every test boots into the ONE
   * shared session, so mintEntity's "already logged in → reuse" made a spec that builds a specific shelf collide with
   * every earlier spec's leftovers (2026-09-05 regression: a reused "Basmati 25kg" carrying another spec's 18% slab —
   * invoice 1,180 not 1,000; "GST 5" already defined; the storefront's first "+" belonging to someone else's product).
   * The shared session stays the default for specs that only read; a spec that AUTHORS asks for its own entity.
   */
  if (fresh) {
    await useApiBase(page);
    await page.goto('/app.html');
    await page.evaluate(() => { try { localStorage.removeItem('cb_sess'); sessionStorage.clear(); } catch (_) {} });
    await page.context().clearCookies();
  }
  // A FIXED email makes this create-or-reuse: register() re-issues the OTP for an existing entity instead of erroring,
  // so the same email always lands in the SAME entity. Omit for a throwaway unique one.
  email = email || uniqueEmail();
  /**
   * ⚠⚠ THE NAME THIS RETURNS MUST BE THE NAME THE ENTITY ACTUALLY HAS. It used to be `uniqueName()` — a
   * pretty label ("E2E Co 089347") that was computed, returned, and NEVER TYPED ANYWHERE. Registration asks for
   * one name, the handle in `reg-name`, and that is what becomes both user_id and display_name. So every spec
   * that addressed a party by `who.name` was searching for a string no entity had ever been given, and the
   * suggestion list was correctly empty — MP-01, disputes, message-privacy and notif-clear all failed on it,
   * and every one of them looked like a broken recipient search.
   *
   * ⭐ The handle is also the RIGHT thing to address by: user_id is the public one, it is exact, and display
   * names repeat. A fixture that invents an identity teaches every spec above it a fiction.
   */
  const handle = (name && /^[a-z0-9-]+$/.test(name)) ? name : uniqueHandle();
  await useApiBase(page);
  await page.goto('/app.html');
  // SAVED SESSION: in the `authed` project a restored token boots straight into the app shell (a nav item is present) →
  // skip onboarding entirely. In `noauth` and fresh multi-party contexts there's no session → full mint below.
  const loggedIn = fresh ? false : await page.getByTestId('nav-compose')
    .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
  if (loggedIn) return { existing: true, email: null, name: null };
  /* SEC1: a new shop needs a code to type — none for this target → skip LOUDLY here, before anything is registered */
  /* inside a Playwright test → test.skip; in a STANDALONE harness (till-demo.cjs…) test.skip throws, so exit 78 = SKIP
     (run-shard prints it as SKIP — never PASS, never FAIL) */
  if (!DEV_OTP) { warnNoCode(); try { require('@playwright/test').test.skip(true, NO_CODE); } catch (_) { console.log('SKIP · ' + NO_CODE); process.exit(78); } }
  // LOGGED OUT: /app.html now defaults to the Sign-in screen → reach onboarding via "New here? Create an entity"
  // (the welcome screen at #/welcome still carries onb-getstarted). Fall back to the hash route if the link moved.
  if (!(await page.getByTestId('onb-getstarted').isVisible().catch(() => false))) {
    const create = page.getByText('Create an entity');
    if (await create.count()) await create.first().click();
    else await page.goto('/app.html#/welcome');
  }
  await page.getByTestId('onb-getstarted').waitFor({ state: 'visible', timeout: 8000 });
  await page.getByTestId('onb-getstarted').click();
  await page.getByTestId(`onb-role-${role}`).click();
  await page.locator('[data-testid^="onb-bp-"]').first().click();   // pick the first vertical/blueprint
  await page.getByTestId('onb-continue').click();
  /* ⚠️ reg-name IS THE USER ID FIELD — see uniqueHandle. Filling it with a display name is what broke the
     whole suite: spaces and capitals fail checkRoot, the form refuses, and every spec times out on #/register. */
  await page.getByTestId('reg-name').fill(handle);
  await page.getByTestId('reg-email').fill(email);
  await page.getByTestId('reg-submit').click();                     // → create → verify (OTP) step
  // Verify step: pick a vertical IF offered, enter the dev OTP, submit. Tolerant — the vertical is often already
  // carried from the onb-bp pick, and dev mode can advance quickly, so skip whatever isn't present and then just
  // confirm we've actually landed in the app. (Watching it live showed a stale reg-vertical click hanging here.)
  const otp = page.getByTestId('reg-otp');
  if (await otp.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)) {
    const vert = page.locator('[data-testid^="reg-vertical-"]');
    if (await vert.count()) await vert.first().click().catch(() => {});
    /* ⚠️ THE AGREE GATE (app.html, 2026-09-19): Verify stays disabled until reg-agree is ticked, and every spec sat on
       #/register from that day (M43, 2026-10-08). Tick it BEFORE the code — ticking re-renders the form. */
    const agree = page.getByTestId('reg-agree');
    if (await agree.count() && !(await agree.isChecked().catch(() => true))) await agree.check().catch(() => {});
    await otp.fill(DEV_OTP).catch(() => {});
    await page.getByTestId('reg-submit').click().catch(() => {});
  }
  /* ⭐ CS1: a NEW shop lands on #/country first — answer the step (passCountryStep), THEN we are in the app */
  await page.waitForURL(/#\/(app|country)/, { timeout: 15000 }).catch(() => {});
  if (/#\/country/.test(page.url())) await passCountryStep(page, country);
  return { email, name: handle, handle };
}

// Wait out the busy overlay (#busyhost .busyov) that covers the screen during a post-mutation full-list refresh —
// otherwise the next click is intercepted for the whole action timeout. 'hidden' also covers the detached case.
async function settle(page) {
  await page.locator('#busyhost .busyov').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
}

// Close any open modal (#modalhost) so it doesn't intercept the next sidebar/toolbar click. Modals (compose, dispute
// room, message center) are intentional, so we dismiss explicitly rather than auto-closing in settle().
async function dismissModal(page) {
  await page.evaluate(() => {
    try { if (window.closeModal) window.closeModal(); } catch (e) {}        // #modalhost (compose, dispute room)
    try { if (window.closeMsgCenter) window.closeMsgCenter(); } catch (e) {} // #lbhost (message center, notifications)
  }).catch(() => {});
  for (const host of ['#modalhost', '#lbhost']) {
    await page.locator(host).evaluate((el) => { if (el) el.innerHTML = ''; }).catch(() => {});
  }
}

// Drawer-aware nav click. On a MOBILE viewport (innerWidth<=820 → UI.vp='mob') the sidebar is a slide-out drawer:
// the nav items sit off-screen (translateX(-100%)) behind the ☰ (nav-drawer) button, so a direct nav click can't
// land. On desktop the ☰ is display:none. So: if ☰ is showing and the menu isn't open, tap it first, then click.
// Viewport-agnostic — a no-op on the counter/laptop projects, the drawer-opener on mobile.
/**
 * ⭐⭐ PROFILE AND SETTINGS ARE BEHIND THE AVATAR, NOT IN THE RAIL. They were *"the two least-visited screens
 * in the rail and were holding prime space in it"*, so they moved into the avatar menu — which means
 * `getByTestId('nav-settings')` finds nothing until the menu is open, and a spec written against the old route
 * fails as a 15-second TIMEOUT rather than as "that is not there any more".
 *
 * ⚠️ FOUR SPECS ALREADY CLICK `icon-avatar` INLINE (i18n, smoke, theme-picker ×2). This is the fifth caller,
 * which by the standing rule is where the helper gets written rather than copied again. The four are left
 * alone deliberately: they pass today, and rewriting green tests to tidy them is churn with a real chance of
 * breaking something for no behavioural gain. They are candidates, not debt.
 */
async function openAvatarItem(page, testid) {
  const item = page.getByTestId(testid);
  /* the menu may already be open from a previous step — opening it twice closes it */
  if (!(await item.isVisible().catch(() => false))) await page.getByTestId('icon-avatar').click();
  await item.click();
}

async function clickNav(page, key) {
  const ham = page.getByTestId('nav-drawer');
  if (await ham.isVisible().catch(() => false)) {                       // mobile mode — nav is behind the drawer
    if (!(await page.locator('.menu.open').count())) {
      await ham.click();
      await page.locator('.menu.open').waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
    }
  }
  await page.getByTestId('nav-' + key).click();
}

// Click a control inside the compose modal robustly. The modal is a fixed, scrollable overlay (.mover, overflow-y:auto)
// whose backdrop closes it on click. A normal Playwright click uses COORDINATES + auto-scroll + a stability wait, and on
// slower engines that misbehaves two ways (both reproduced via a step-through): on webkit the stability loop never
// settles though the button is present+topmost; on mobile the auto-scroll strays onto the backdrop and dismisses the
// modal. Dispatching the element's own handler directly (native .click()) sidesteps all of it — no scroll, no stability
// check, no backdrop mis-hit — and fires the exact onclick the button carries. The element is real; we just trigger it.
async function stableClick(page, testid) {
  const el = page.getByTestId(testid);
  await el.waitFor({ state: 'visible', timeout: 25000 });   // still assert it rendered (modal loads its catalogue async first)
  await el.evaluate((node) => node.click());
}

// Like stableClick, but VERIFY the handler's effect landed and re-dispatch if not. On slow engines (webkit/firefox) the
// modal renders late and a dispatched click can fire before the button's handler is wired, so the recipient/line-item
// silently doesn't register — which then fails compose validation with no send. Dispatch → check the effect → retry.
async function clickInModal(page, testid, verifyFn) {
  const el = page.getByTestId(testid);
  await el.waitFor({ state: 'visible', timeout: 25000 });
  for (let i = 0; i < 5; i++) {
    await el.evaluate((node) => node.click()).catch(() => {});
    if (!verifyFn) return;
    const ok = await page.waitForFunction(verifyFn, null, { timeout: 3000 }).then(() => true).catch(() => false);
    if (ok) return;
    await page.waitForTimeout(300);
  }
}
const HAS_RCPT = () => { const h = document.getElementById('cc_rcpts'); return !!h && h.children.length > 0; };            // a recipient chip rendered
const HAS_TOTAL = () => { const t = document.getElementById('cc_total'); return !!t && /\d/.test(t.textContent || ''); };  // a line-item total rendered

// Reusable: compose + send a self-chit with a subject + one line item. The arrange step for chits/disputes/messages.
/**
 * composeStepNext — advance the compose wizard one step, and refuse to move on quietly if it will not go.
 *
 * ⚠️ THE PRIMARY IS GUARDED. If the current step is unanswered the button is disabled and the flow simply does not
 * advance — so a spec that clicked and carried on would fail three lines later, on the next step's field, reading
 * like a rendering fault. Asserting the step actually CHANGED puts the failure where the cause is.
 */
async function composeStepNext(page, expectStep) {
  const btn = page.locator('[data-testid^="step-next-"]');
  // ⚠️ DO NOT read step-why-* to build this message. When the step is satisfied that element does not exist, so
  // `.textContent()` auto-waits the full action timeout before the catch — fifteen seconds of doing nothing inside
  // an open modal, on every step. It cost real time and it masked a real bug (a background renderApp wiping the
  // modal) as a locator failure. The guard's reason is on the button's title and in step-why when it applies.
  await expect(btn, 'compose could not leave this step — its guard is unsatisfied').toBeEnabled();
  await btn.click();
  await expect(page.locator(`[data-testid="step-${expectStep}"].now`),
    `compose did not advance to the ${expectStep} step`).toBeVisible();
}

/**
 * composeChit — author and send a chit through the FOUR-STEP compose wizard.
 *
 * Athi, 2026-08-08: *"once all the selection is over, then we show the rest in order one by one."*
 *
 * Compose became Items → To → Details → Review on 2026-08-09, so every driver has to walk it. This is the one
 * place that knows the walk: six specs used to inline "fill everything, press send" against a single screen, and
 * six copies of a wizard walk would drift the moment a step moved.
 *
 * `recipients` are added by name from the suggest list; `self: true` adds the Self recipient instead.
 */
async function composeChit(page, { subject, item = 'Widget', qty, price, items, recipients = [], self = false, send = true } = {}) {
  await clickNav(page, 'compose');

  // ── 1 · ITEMS. The line comes first now: the chit is about what is on it.
  /* `items: [{item, qty, price}, …]` authors a MULTI-LINE chit — the shape design 2 exists for, where each
     line is a separate piece of work with its own assignee, delivery and cost. `item/qty/price` stays as the
     one-line shorthand every older spec uses, so both go through the same wizard walk. */
  const lines = items && items.length ? items : [{ item, qty, price }];
  for (const ln of lines) {
    await page.getByTestId('chit-item-name').fill(ln.item);
    if (ln.qty !== undefined) await page.getByTestId('chit-item-qty').fill(String(ln.qty));
    if (ln.price !== undefined) await page.getByTestId('chit-item-price').fill(String(ln.price));
    await clickInModal(page, 'chit-item-add', HAS_TOTAL);     // add the line item (verify it registered)
  }
  await composeStepNext(page, 'to');

  // ── 2 · TO. Compose keeps this step precisely because the recipient is genuinely unknown here.
  if (self) await clickInModal(page, 'chit-add-self', HAS_RCPT);
  for (const name of recipients) await addRecipientByName(page, name);
  await composeStepNext(page, 'details');

  // ── 3 · DETAILS.
  const subj = page.locator('[data-testid="chit-field-subject"]');
  if (await subj.count()) await subj.fill(subject);
  else await page.locator('[data-testid^="chit-field-"]').first().fill(subject);
  await composeStepNext(page, 'review');

  // ── 4 · REVIEW → send.
  if (!send) return;
  const sent = page.waitForResponse((r) => /\/chits\/send/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
  await stableClick(page, 'chit-send');
  const res = await sent;   // wait for the server to confirm the send before the next step (slow engine / cold API)
  await settle(page);   // let the post-send refresh finish so the next nav click isn't intercepted
  /* ⭐ RETURNED, NOT SWALLOWED (2026-09-28). The wait ends in .catch(() => null) so a slow send cannot hang a spec —
     but that also made "no chit at all" look exactly like success. The caller now gets the answer (null = none came). */
  return res;
}

/**
 * ⚠️⚠️ A FIXTURE THAT SWALLOWS ITS OWN FAILURE (backlog, REG-04): for a freshly minted entity this produced NO chit —
 * most likely no catalogue item to pick, so the wizard never finished — and nothing said so. REG-04 then failed at
 * "no chit" three times while the lookup was changed each time; the thing never checked was whether compose had
 * produced one at all. *Assert the precondition before blaming the thing under test.* This fixture exists only to
 * MAKE a chit, so it now fails HERE, in words, when it did not.
 */
async function composeSelfChit(page, subject) {
  const res = await composeChit(page, { subject, self: true });
  let body = null;
  try { body = res ? await res.json() : null; } catch (_) { body = null; }
  const id = body && (body.chit_id || (body.data && body.data.chit_id) || (body.chit && body.chit.chit_id));
  if (!res || !res.ok() || !id) {
    throw new Error('composeSelfChit produced no chit — '
      + (!res ? 'no POST /chits/send was seen (the wizard did not finish; is there a catalogue item to pick?)'
              : 'the send answered ' + res.status() + (body && (body.message || body.error) ? ': ' + (body.message || body.error) : ' with no chit_id')));
  }
  return id;
}

// ── MULTIPARTY — the real capability. Each browser CONTEXT is an isolated logged-in party. Mint N entities in N contexts,
// drive them together, assert what EACH party sees. Run headed (`npm run test:headed`) to watch 2-3 windows side by side.
async function mintInContext(browser, opts) {
  // storageState:undefined forces a CLEAN context — otherwise the authed project's saved session leaks in and
  // mintEntity short-circuits (returns null name/email), collapsing all "parties" into one entity.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const who = await mintEntity(page, opts);
  if (!who || !who.name) throw new Error('mintInContext: expected a fresh mint but got ' + JSON.stringify(who) + ' (session leaked into the context?)');
  return { context, page, email: who.email, name: who.name };
}

// In Compose: address a recipient by typing their name and picking the live suggestion (entity search).
async function addRecipientByName(page, name) {
  await page.getByTestId('chit-recipient').fill(name);
  await page.getByTestId('chit-recipient-suggest').filter({ hasText: name }).first().click();
}

// ── STABLE ENTITY POOL — a fixed set of reusable entities so runs don't mint fresh every time, and so flows can run in
// PARALLEL (each takes a distinct pool entity → no session collision → real concurrency). Provisioned ONCE by
// pool.setup.js (create-or-reuse via the fixed email), sessions saved to .auth/pool-NN.json and reused every run.
// Bump CB_POOL_SIZE for more concurrency (e.g. the swarm/parallel simulation).
const POOL_SIZE = Number(process.env.CB_POOL_SIZE || 10);
const POOL = Array.from({ length: POOL_SIZE }, (_, i) => {
  const nn = String(i + 1).padStart(2, '0');
  return { key: `pool${nn}`, email: `e2e.pool${nn}@test.example`, name: `E2E Pool ${nn}`, session: `.auth/pool-${nn}.json` };
});

// Open a browser context ALREADY signed in as pool entity #i (loads its saved session — zero minting). The building
// block for parallel/swarm simulation: give each concurrent actor its own poolContext.
async function poolContext(browser, i) {
  const p = POOL[i % POOL.length];
  const context = await browser.newContext({ storageState: p.session });
  const page = await context.newPage();
  await page.goto('/app.html');
  await page.getByTestId('nav-compose').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  return { context, page, email: p.email, name: p.name, key: p.key };
}

const { seedDemo } = require('./seed');
/**
 * addProduct — put one thing on our own shelf, through the Catalogue screen.
 *
 * ⭐ Extracted rather than inlined a second time: `catalogue.spec.js` already walks this form, and a second
 * copy is how two specs end up disagreeing about what "add a product" means. A driver that needs materials
 * (design 2 takes parts from the catalogue) needs exactly this walk and nothing more.
 */
async function addProduct(page, { name, price, desc, unit, code } = {}) {
  /**
   * ⚠️⚠️ REUSE WHAT IS ALREADY ON THE SHELF — the `authed` project shares ONE entity across every spec and
   * every re-run, so a fixture that always creates is a fixture that grows the catalogue without bound. Nine
   * runs of the design-2 flow left eighteen products behind, and `[CAT-02]` then edited one copy and read
   * another: "expected 999, received 250". Sound alone, unsound in a batch — the shared-account drift again.
   *
   * ⭐ Asked through the app's OWN read, with the app's own session, because that is the same list the pickers
   * will offer. Matching on name is the identity a person uses when looking for a part.
   */
  /* ⚠️ A REUSED PRODUCT IS SELECTED TOO. Specs read UI.prodSel after this fixture ("const pid = await page.evaluate(() =>
     UI.prodSel)"); a reuse that returned without selecting left them with undefined (LIF-01, OM-01 red, 2026-09-04).
     Selected through the app's own selectProduct, the same path a click takes. */
  const already = await page.evaluate(async (n) => {
    try {
      const r = await api('prodList', { query: { limit: 200 } });
      const list = Array.isArray(r) ? r : ((r && (r.items || r.products)) || []);
      const hit = list.find((x) => String(((x.item_data || x).name) || '').toLowerCase() === String(n).toLowerCase());
      if (!hit) return null;
      const id = hit.item_id || hit.id || null;
      if (id && typeof selectProduct === 'function') { if (!UI.prods) { try { await loadCatalogue('fresh'); } catch (_) {} } selectProduct(id); }
      return id || true;
    } catch (e) { return false; }
  }, name).catch(() => false);
  if (already) {
    await page.waitForFunction(() => !!UI.prodSel, null, { timeout: 15000 }).catch(() => {});
    return { name, price, reused: true, id: (typeof already === 'string' ? already : null) };
  }

  await clickNav(page, 'catalogue');
  const add = page.getByTestId('cat-new-product');
  if (!(await add.isVisible().catch(() => false))) {
    // A catalogue that has never been set up offers the starter pick first.
    const setup = page.getByTestId('cat-setup');
    if (await setup.isVisible().catch(() => false)) await setup.click();
  }
  await add.waitFor({ state: 'visible', timeout: 20000 });
  await add.click();
  await page.getByTestId('cat-field-name').fill(name);
  /* unit and code were accepted and IGNORED until 2026-09-04 — every spec that passed them got '' */
  if (unit) { const u = page.getByTestId('cat-field-unit'); if (await u.count()) await u.fill(String(unit)); }
  if (code) { const c = page.getByTestId('cat-field-code'); if (await c.count()) await c.fill(String(code)); }
  if (price !== undefined) await page.getByTestId('cat-field-price').fill(String(price));
  const d = page.getByTestId('cat-field-desc');
  if (desc && await d.count()) await d.fill(desc);
  /**
   * ⚠️ WAIT FOR THE WRITE, NOT FOR THE CLICK. The first version returned as soon as it had pressed Add, so a
   * second call that silently did nothing was invisible until a LATER step failed for an unrelated-looking
   * reason ("no material matching AC gas kit" — three steps and a minute after the shelf failed to gain it).
   * A helper that does not confirm its own effect turns one broken thing into a mysterious other thing.
   */
  /* ⚠️ ANY status, then judge it — a predicate that only accepts < 400 turns a refusal into a 45-second silence
     with no reason ([OFF-02], 2026-09-04: the form was filled and nothing came back). The refusal's own message is
     the finding; hide it and the next reader chases the click. */
  const saved = page.waitForResponse(
    (r) => /\/api\/products(\?|$)/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 45000 });
  await page.getByTestId('cat-add').click();
  /* when the write never comes, say what the FORM saw — its error line, the name it held, its mode — the reason is on
     the page, not in a 45-second silence (2026-09-05: Save refused in ~half the runs) */
  const resp = await saved.catch(async (e) => {
    const why = await page.evaluate(() => ({ err: (document.getElementById('ct_err') || {}).textContent, name: (document.getElementById('ct_name') || document.querySelector('[data-testid="cat-field-name"]') || {}).value, mode: (typeof UI !== 'undefined') ? UI.prodMode : '?', addBtn: !!document.querySelector('[data-testid="cat-add"]'), toast: (document.querySelector('.toast') || {}).textContent })).catch(() => null);
    throw new Error(e.message + ' FORM ' + JSON.stringify(why));
  });
  if (resp.status() >= 400) {
    const body = await resp.text().catch(() => '');
    throw new Error('POST /api/products refused ' + resp.status() + ': ' + body.slice(0, 400));
  }
  await settle(page);
  await dismissModal(page);
  return { name, price };
}

/**
 * addCoassist — a person to give work to. Design 2's whole point is division of labour, and an empty roster
 * makes the Work tab say so honestly ("no co-assists yet") rather than assign to nobody.
 *
 * ⚠️ `key` is the login id, and it must be unique WITHIN the entity — the DB constraint is real
 * (uq_actor_key_per_entity), so a fixed key collides on the second run of the same suite.
 */
async function addCoassist(page, { name, key } = {}) {
  key = key || (String(name || 'mate').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) + Date.now().toString().slice(-5));
  await clickNav(page, 'coassists');
  await page.getByTestId('coassist-new').click();
  await page.getByTestId('coassist-type-human').click();
  await page.getByTestId('aw_name').fill(name);
  await page.getByTestId('aw_key').fill(key);
  /**
   * ⚠️ WALK THE WIZARD, DO NOT COUNT ITS STEPS. `AW_STEPS.human` was ['who','hat'] and is now
   * ['who','hat','docs'] — a driver that clicked Next exactly twice stopped on the last step with the wizard
   * still up, and then intercepted every later click in the run. Pressing Next until it is gone survives the
   * next step being added too.
   */
  for (let i = 0; i < 6; i++) {
    const next = page.getByTestId('coassist-wiz-next');
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(150);
  }
  const done = page.getByTestId('coassist-wiz-done');
  await done.waitFor({ state: 'visible', timeout: 30000 });   // the create has answered by the time this shows
  await done.click();
  await settle(page);
  await dismissModal(page);
  return { name, key };
}

/** ⭐ THE ONE TEST PICTURE AND THE ONE TEST VIDEO — every spec and the tour reuse these; never generate another. */
const MEDIA_PNG = require('path').join(__dirname, 'assets', 'test-picture.png');
const MEDIA_VIDEO = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';   /* Big Buck Bunny — Blender Foundation, CC-BY */
/** addMedia(page, itemId, { picture:true, video:true }) — through the API, as the Media row does. */
async function addMedia(page, itemId, o) {
  o = o || { picture: true, video: true };
  const b64 = o.picture ? require('fs').readFileSync(MEDIA_PNG).toString('base64') : null;
  return page.evaluate(async ({ id, b64, video }) => {
    const out = {};
    if (b64) { try { out.picture = await api('prodMediaAdd', { params: { id }, body: { name: 'test-picture.png', mime: 'image/png', data_base64: b64 } }); } catch (e) { out.pictureError = String(e && e.message); } }
    if (video) { out.video = await api('prodMediaAdd', { params: { id }, body: { url: video } }); }
    return out;
  }, { id: itemId, b64, video: o.video ? MEDIA_VIDEO : null });
}
/** storefront: press "+" on the product with this name `times` times (the list can hold other products) */
async function shopAdd(page, name, times) {
  await page.locator('text=' + name).first().waitFor({ timeout: 40000 });
  for (let i = 0; i < (times || 1); i++) {
    const ok = await page.evaluate((nm) => {
      const items = (window._SHOPDATA && _SHOPDATA.items) || [];
      const idx = items.findIndex((x) => String(((x.item_data || x).name) || '').toLowerCase() === String(nm).toLowerCase());
      const btns = document.querySelectorAll('[data-testid="cart-add"]');
      const b = (idx >= 0 && btns[idx]) ? btns[idx] : null; if (!b) return false; b.click(); return true;
    }, name);
    if (!ok) throw new Error('shopAdd: no "+" for ' + name);
    await page.waitForTimeout(150);
  }
}
module.exports = {
  shopAdd,
  MEDIA_PNG, MEDIA_VIDEO, addMedia, addProduct, addCoassist, seedDemo, DEV_OTP, signinCode, needCode, useApiBase, uniqueEmail, uniqueName, uniqueHandle, openAvatarItem, mintEntity, passCountryStep, composeSelfChit, composeChit, composeStepNext, clickNav, stableClick, clickInModal, HAS_RCPT, HAS_TOTAL, mintInContext, addRecipientByName, settle, dismissModal, POOL, poolContext };

/**
 * openTab(page, key) — click a product-page tab and WAIT for its pane. The Edit view repaints twice (once at once, once
 * when the declared columns arrive); a click that lands between the two hits a replaced element and the pane stays
 * hidden ([TAX-02] flaked on exactly this, 2026-09-05). Re-click until the pane is visible.
 */
async function openTab(page, key) {
  const pane = page.getByTestId('prod-pane-' + key);
  for (let i = 0; i < 30; i++) {
    await page.getByTestId('prod-tab-' + key).click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
    if (await pane.isVisible().catch(() => false)) return;
  }
  const why = await page.evaluate(() => ({ tab: (typeof UI !== 'undefined') ? UI.prodTab : '?', mode: (typeof UI !== 'undefined') ? UI.prodMode : '?', panes: Array.from(document.querySelectorAll('[data-testid^="prod-pane-"]')).map((e) => e.getAttribute('data-testid') + (e.style.display === 'none' ? ':hidden' : ':shown')) })).catch(() => null);
  throw new Error('openTab: pane ' + key + ' never became visible — ' + JSON.stringify(why));
}
module.exports.openTab = openTab;

/**
 * approveJoins(brandPage) — the brand approves every store that ASKED to join its network (a store asks when it adopts the
 * brand's catalogue — the network decides, src/services/network). Returns how many it approved. One helper for every spec
 * that sets up a brand and its stores.
 */
async function approveJoins(brandPage) {
  const out = await brandPage.evaluate(async () => {
    const v = await api('netOffers');
    const asks = ((v && v.brand && v.brand.members) || []).filter((m) => m.state === 'requested' && m.asked_by === 'store');
    const errs = [];
    for (const m of asks) { try { await api('netApprove', { params: { id: m.edge_id }, body: {} }); } catch (e) { errs.push(m.name + ': ' + (e && e.message)); } }
    return { n: asks.length, errs };
  });
  if (out.errs.length) throw new Error('approveJoins: ' + out.errs.join('; '));
  return out.n;
}
module.exports.approveJoins = approveJoins;
