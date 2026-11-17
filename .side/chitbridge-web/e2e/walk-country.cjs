#!/usr/bin/env node
/**
 * e2e/walk-country.cjs - COUNTRY SETUP, WALKED (CS1, 2026-10-12): the step after registration, before the books open.
 * Black box: the real Register screen, the real Country setup screen, the real CB Accounts door; the API is a stand-in answering inside the
 * page (no account is created anywhere). Three browsers: an Indian one (Asia/Kolkata), a Japanese one (Asia/Tokyo — no pack ships for Japan)
 * and an Australian one (Australia/Sydney — AU1, engines v1.36.0: Australia HAS its pack, so it opens books with AUD and a July year).
 *   C1  register -> verify -> lands on Country setup, prefilled India - INR - April from the time zone, each with its source
 *   C2  Change -> the country picker opens; Done closes it
 *   C3  Continue -> ONE PUT with { country, currency, fy_start_month, tax, source } -> the app opens
 *   C4  a Japanese browser -> the step says the sentence (no books for Japan yet - selling and the rail still work)
 *   C5  CB Accounts for that shop -> the same sentence on the card, with the Country setup button, not the quiet "not switched on"
 *   C6  an Indian shop whose server says the setup is still to do -> CB Accounts says "Country setup first"
 *   C7  an Australian browser -> the step prefills Australia - AUD - July from the AU pack, no sentence, and Continue PUTs AU / AUD / 7
 *       CS2: Australia has several zones, so the step ASKS, the browser's (Australia/Sydney) preselected, and the PUT carries it
 *   C8  CS2: the picker offers EXACTLY the server's registered packs (IN - AU - AE), whatever the browser's locale (CL1's finding)
 *   C9  CS2: an Indian shop NOT yet constituted corrects the country to Australia -> AUD, July and the zone ask are painted from the pack
 *       (the Indian browser's zone is not one of Australia's, so the picker is open with nothing preselected); pick Perth -> ONE PUT
 *       { AU, AUD, 7, timezone: Australia/Perth } -> the server's `rederived` -> the app opens
 *   C10 CS2: a CONSTITUTED shop (it has products) -> Country and Money are greyed with the reason, no Change; the rule says "never change"
 *   C11 CS2: ... and a PUT the server refuses (409 COUNTRY_CHANGE_IS_NEW_ENTITY) -> its sentence is painted in the form, the step stays
 *   ── CL3: "Where ChitBridge is for <country>" on the step (the same CBCountryReady rows the Country lab paints, in the step's own gov-panel rows) ──
 *   C12  the step shows "Where ChitBridge is for India": the pack line, one row per product area (✅ ⚠️ ❌), Payroll "—" — the file's rows
 *   C13  Change the country -> the UAE: the block follows the CHOSEN country; Japan (no pack — the picker no longer offers it, CS2 C8): the block says so, never a made-up row
 *   C15 FX-AU1: a Sydney browser's register call CARRIES the guess; Settings > Country then says Australia "your time zone" (the server's source)
 *   C16 FX-AU1: a country that is only the column default (no source, not done) is "not confirmed yet", never "your registration"
 *   C14 rule 13 on the step, Cream and Dark at 1366 and 390: AA on every text, nothing clipped, no sideways scroll, nothing floating over the
 *       block, the copy within budget. (The step is signed in by nature — it follows registration; signed out it is the sign-in screen.)
 *
 * ⚠️ THE STAND-IN'S ORDER (CS1b, 2026-10-12): Playwright tries the LAST registered route first, so the catch-all for every /api path is registered
 * FIRST and the specific answers after it — registered the other way round, the catch-all swallowed the country-setup PUT and C3 saw `{}`.
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-country.cjs         headless, fast
 *   node e2e/walk-country.cjs --show                              watch it
 */
'use strict';
const TD = require('./lib/today.cjs');
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');   /* the contrast measurement, one copy */
const J = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
const JP_WHY = 'ChitBridge does not keep books for Japan yet — selling and the rail still work; books arrive when its pack ships.';
/* CS2: the server's `countries[]` = exactly the registered packs (regulation.list()), with what each derives — the picker reads THIS, never the browser's locale */
const AU_ZONES = ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Hobart'];
const COUNTRIES = [
  { code: 'IN', name: 'India', currency: 'INR', fy_start_month: 4, zones: ['Asia/Kolkata'], locale: 'en-IN', books: true },
  { code: 'AU', name: 'Australia', currency: 'AUD', fy_start_month: 7, zones: AU_ZONES, locale: 'en-AU', books: true },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', fy_start_month: 1, zones: ['Asia/Dubai'], locale: 'ar-AE', books: true },
];
const profile = (over) => Object.assign({ migrated: true, done: false, required: true, country: { code: 'IN', name: 'India' }, currency: 'INR', fy_start_month: 4,
  tax: { registered: false, number: null, scheme: null }, timezone: 'Asia/Kolkata', zones: ['Asia/Kolkata'], constituted: false, constituted_by: { products: false, chits: false, entries: false },
  countries: COUNTRIES, source: {}, pack: { id: 'IN', version: '1.0.0', books: true, code: null, why: null } }, over || {});
const FIXED_WHY = 'This shop is set up for India and INR and already has products — country and money never change. Register a new business for Australia.';
/** the stand-in API for a fresh registration: register -> OTP -> verify -> the step */
async function stubRegistration(ctx, prof, sent) {
  await ctx.route('**/api/**', (r) => r.fulfill(J({ ok: true })));   /* the catch-all FIRST — the last registered handler is tried first */
  await ctx.route('**/api/entities/register', (r) => { sent.register = JSON.parse(r.request().postData() || '{}'); return r.fulfill(J({ email: 'shop@example.in' })); });
  await ctx.route('**/api/entities/constitutions', (r) => r.fulfill(J({ constitutions: [{ key: 'base', label: 'Base', is_default: true }] })));
  await ctx.route('**/api/entities/verify', (r) => r.fulfill(J({ token: JSON.parse(W.session('Walk Owner', 'Walk Shop')).token, entity: { identity_id: 'ent-walk', bridge_id: 'CBWALK0001', display_name: 'Walk Shop', email: 'shop@example.in' }, identity: { identity_id: 'ent-walk', identity_type: 'entity', display_name: 'Walk Shop' } })));
  await ctx.route('**/api/governance/country-setup', (r) => {
    if (r.request().method() === 'PUT') {
      sent.put = JSON.parse(r.request().postData() || '{}');
      /* CS2: a constituted shop refuses a change with the server's sentence; a correction before it answers `rederived` */
      if (prof.constituted && (sent.put.country !== prof.country.code || sent.put.currency !== prof.currency))
        return r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'COUNTRY_CHANGE_IS_NEW_ENTITY', error: FIXED_WHY, message: FIXED_WHY }) });
      const changed = sent.put.country !== prof.country.code;
      const row = COUNTRIES.find((c) => c.code === sent.put.country) || {};
      return r.fulfill(J(Object.assign({}, prof, { done: true, required: false, country: { code: sent.put.country, name: row.name || sent.put.country }, currency: sent.put.currency,
        fy_start_month: sent.put.fy_start_month, timezone: sent.put.timezone || prof.timezone },
        changed ? { rederived: { from: prof.country.code, to: sent.put.country, chart: 0, by: 'ent-walk', at: TD.nowIso() } } : {})));
    }
    return r.fulfill(J(prof));
  });
}
async function register(page, base) {
  await page.goto(base + '/app.html#/register');
  await page.waitForSelector('[data-testid="reg-name"]', { timeout: 15000 });
  await page.fill('[data-testid="reg-name"]', 'walkshop');
  await page.fill('[data-testid="reg-email"]', 'shop@example.in');
  await page.click('[data-testid="reg-submit"]');
  await page.waitForSelector('[data-testid="reg-gov"]', { timeout: 8000 });
  await page.click('[data-testid="reg-agree"]');
  await page.fill('[data-testid="reg-otp"]', '123456');
  await page.click('[data-testid="reg-submit"]');
  await page.waitForSelector('[data-testid="cs-rows"]', { timeout: 10000 });
}
const text = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : ''; }, sel);

W.run('country', async (w) => {
  const { page, ctx, base } = w;
  const sent = {};
  await stubRegistration(ctx, profile(), sent);

  await w.step('C1', 'Register -> verify -> Country setup, prefilled India - INR - April from the time zone, each with its source', async () => {
    await register(page, base);
    const c = await text(page, '[data-testid="cs-val-country"]'), cur = await text(page, '[data-testid="cs-val-currency"]'), fy = await text(page, '[data-testid="cs-val-fy"]');
    const src = await text(page, '[data-testid="cs-src-country"]'), title = await text(page, '[data-testid="cs-title"]');
    const ok = /India/.test(c) && /INR/.test(cur) && /April/.test(fy) && src.length > 0 && /Country setup/.test(title) && /#\/country/.test(await page.evaluate(() => location.hash));
    return { ok, saw: title + ' · ' + c + ' · ' + cur + ' · ' + fy + ' · from ' + src };
  });
  await w.step('C2', 'First setup: the country picker is INLINE (no Change tap, no Done); the edit icon appears only on an answered row', async () => {
    /* WALK-REG 2026-10-16: a not-yet-answered row shows its dropdown inline; the "Done" toggles are removed by decision */
    const open = !!(await page.$('[data-testid="cs-country"]'));
    const noChange = !(await page.$('[data-testid="cs-change-country"]'));
    return { ok: open && noChange, saw: 'picker ' + (open ? 'inline' : 'MISSING') + ', edit icon ' + (noChange ? 'absent' : 'SHOWN') };
  });
  await w.step('C3', 'Continue -> ONE PUT { country, currency, fy_start_month, tax, source } -> the app opens', async () => {
    await page.click('[data-testid="cs-save"]');
    await page.waitForFunction(() => /#\/app/.test(location.hash), null, { timeout: 8000 });
    const p = sent.put || {};
    const ok = p.country === 'IN' && p.currency === 'INR' && p.fy_start_month === 4 && p.tax && p.tax.registered === false && p.source && typeof p.source.country === 'string';
    return { ok, saw: 'sent ' + JSON.stringify({ country: p.country, currency: p.currency, fy: p.fy_start_month, tax: p.tax && p.tax.registered, src: p.source && p.source.country }) + ' · hash ' + (await page.evaluate(() => location.hash)) };
  });

  /* ── a Japanese browser: no pack ships for Japan, so the step says it (Australia had this role until AU1 shipped reg-au) ── */
  const au = await w.browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en', timezoneId: 'Asia/Tokyo', serviceWorkers: 'block' });
  const p2 = await au.newPage(); p2.on('pageerror', (e) => w.errs.push('jp: ' + String(e && e.message || e)));
  const sent2 = {};
  const jpProfile = profile({ country: { code: 'JP', name: 'Japan' }, currency: 'JPY', fy_start_month: 4, timezone: 'Asia/Tokyo', zones: [], pack: { id: null, version: null, books: false, code: 'NO_COUNTRY_PACK', why: JP_WHY } });
  await stubRegistration(au, jpProfile, sent2);
  await w.step('C4', 'A Japanese browser -> the step says: no books for Japan yet, selling and the rail still work', async () => {
    await register(p2, base);
    const why = await text(p2, '[data-testid="cs-nopack"]'), c = await text(p2, '[data-testid="cs-val-country"]');
    const stillContinues = !!(await p2.$('[data-testid="cs-save"]'));
    return { ok: why === JP_WHY && /Japan/.test(c) && stillContinues, saw: c + ' · "' + why.slice(0, 60) + '…" · Continue ' + (stillContinues ? 'offered' : 'missing') };
  });
  await w.step('C5', 'Accounts for that shop -> the same sentence on the card, with the Country setup button (not "not switched on")', async () => {
    await p2.evaluate((s) => { localStorage.setItem('cb_sess', s); }, W.session('Walk Owner', 'Walk Shop'));
    await au.route('**/api/books/health', (r) => r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'NO_COUNTRY_PACK', error: JP_WHY, message: JP_WHY }) }));
    await p2.goto(base + '/accounts.html');
    await p2.waitForSelector('[data-testid="acc-country"]', { timeout: 15000 });
    const h = await text(p2, '[data-testid="acc-country"]'), why = await text(p2, '[data-testid="acc-country-why"]');
    const btn = !!(await p2.$('[data-testid="acc-country-setup"]')), off = !!(await p2.$('[data-testid="acc-off"]'));
    return { ok: why === JP_WHY && btn && !off, saw: h + ' · ' + why.slice(0, 50) + '… · button ' + (btn ? 'there' : 'missing') };
  });
  await w.step('C6', 'An Indian shop whose setup is still to do -> Accounts says "Country setup first"', async () => {
    await au.unroute('**/api/books/health');
    await au.route('**/api/books/health', (r) => r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'COUNTRY_SETUP_PENDING', error: 'Finish the country setup first — country, money, financial year and tax registration.', message: 'Finish the country setup first — country, money, financial year and tax registration.' }) }));
    await p2.goto(base + '/accounts.html');
    await p2.waitForSelector('[data-testid="acc-country"]', { timeout: 15000 });
    const h = await text(p2, '[data-testid="acc-country"]');
    return { ok: /Country setup first/.test(h) && !!(await p2.$('[data-testid="acc-country-setup"]')), saw: h };
  });
  await au.close();

  /* ── an Australian browser (AU1): the pack is there — AUD and a July year from it, no sentence, and the PUT carries them ── */
  const au2 = await w.browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
  const p3 = await au2.newPage(); p3.on('pageerror', (e) => w.errs.push('au: ' + String(e && e.message || e)));
  const sent3 = {};
  await stubRegistration(au2, profile({ country: { code: 'AU', name: 'Australia' }, currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', zones: AU_ZONES, pack: { id: 'AU', version: '1.0.0', books: true, code: null, why: null } }), sent3);
  await w.step('C7', 'An Australian browser -> Australia - AUD - July from the AU pack, no sentence; the zone is ASKED with Australia/Sydney preselected; Continue PUTs { AU, AUD, 7, Australia/Sydney }', async () => {
    await register(p3, base);
    const c = await text(p3, '[data-testid="cs-val-country"]'), cur = await text(p3, '[data-testid="cs-val-currency"]'), fy = await text(p3, '[data-testid="cs-val-fy"]');
    const noSentence = !(await p3.$('[data-testid="cs-nopack"]'));
    /* CS2: several zones -> the row has Change; open it and the picker holds the browser's zone */
    const tz = await text(p3, '[data-testid="cs-val-timezone"]'), tzSrc = await text(p3, '[data-testid="cs-src-timezone"]');
    const askable = !!(await p3.$('[data-testid="cs-timezone"]'));   /* WALK-REG 2026-10-16: asked INLINE on first setup — no Change tap */
    const picked = await p3.$eval('[data-testid="cs-timezone"]', (el) => el.value);
    const nOpts = await p3.$$eval('[data-testid="cs-timezone"] option', (os) => os.length);
    await p3.click('[data-testid="cs-save"]');
    await p3.waitForFunction(() => /#\/app/.test(location.hash), null, { timeout: 8000 });
    const p = sent3.put || {};
    const ok = /Australia/.test(c) && /AUD/.test(cur) && /July/.test(fy) && noSentence && askable && /Sydney/.test(tz) && picked === 'Australia/Sydney' && nOpts === AU_ZONES.length
      && p.country === 'AU' && p.currency === 'AUD' && p.fy_start_month === 7 && p.timezone === 'Australia/Sydney';
    return { ok, saw: c + ' · ' + cur + ' · ' + fy + ' · zone ' + tz + ' (' + tzSrc + ', ' + nOpts + ' offered) · sentence ' + (noSentence ? 'absent' : 'SHOWN') + ' · sent ' + JSON.stringify({ country: p.country, currency: p.currency, fy: p.fy_start_month, tz: p.timezone }) };
  });
  await au2.close();

  /* ── FX-AU1 (F7): the Sydney guess the panel showed is SENT with the registration (the server stores it in the write that creates the shop);
        the owner leaves before Continue, opens Settings › Country: it says Australia, "your time zone" — the SERVER's source, not a default ── */
  const au3 = await w.browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
  const pAu3 = await au3.newPage(); pAu3.on('pageerror', (e) => w.errs.push('au3: ' + String(e && e.message || e)));
  const sentAu3 = {};
  const AU_PROF = profile({ country: { code: 'AU', name: 'Australia' }, currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', zones: AU_ZONES,
    source: { country: 'your time zone', currency: 'the usual currency in Australia', timezone: 'your device clock' }, pack: { id: 'AU', version: '1.0.0', books: true, code: null, why: null } });
  await stubRegistration(au3, AU_PROF, sentAu3);
  await w.step('C15', 'FX-AU1: a Sydney browser registers -> the register call CARRIES the guess (AU - AUD - Australia/Sydney); leave; Settings > Country says Australia "your time zone"', async () => {
    await register(pAu3, base);
    const g = (sentAu3.register && sentAu3.register.context) || {};
    await pAu3.goto(base + '/settings.html#/country');
    await pAu3.waitForSelector('[data-testid="cs-rows"]', { timeout: 10000 });
    const c = await text(pAu3, '[data-testid="cs-val-country"]'), src = await text(pAu3, '[data-testid="cs-src-country"]');
    const ok = g.country === 'AU' && g.currency_code === 'AUD' && g.timezone === 'Australia/Sydney' && /Australia/.test(c) && /your time zone/.test(src) && !/registration/.test(src);
    return { ok, saw: 'register sent ' + JSON.stringify({ country: g.country, currency: g.currency_code, tz: g.timezone }) + ' · settings: ' + c + ' from ' + src };
  });
  await au3.close();

  /* ── FX-AU1: a shop whose country is only the column default (no source stored, step not done) is never labelled "your registration" ── */
  const au4 = await w.browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
  const pAu4 = await au4.newPage(); pAu4.on('pageerror', (e) => w.errs.push('au4: ' + String(e && e.message || e)));
  await stubRegistration(au4, profile(), {});
  await w.step('C16', 'FX-AU1: Settings > Country for a shop holding only the default India (no source, not done) -> "not confirmed yet", never "your registration"', async () => {
    await register(pAu4, base);
    await pAu4.goto(base + '/settings.html#/country');
    await pAu4.waitForSelector('[data-testid="cs-rows"]', { timeout: 10000 });
    const c = await text(pAu4, '[data-testid="cs-val-country"]'), src = await text(pAu4, '[data-testid="cs-src-country"]'), csrc = await text(pAu4, '[data-testid="cs-src-currency"]');
    const ok = !/your registration/.test(src + ' ' + csrc) && src.length > 0;
    return { ok, saw: c + ' from ' + src + ' · money from ' + csrc };
  });
  await au4.close();

  /* ── CS2: an Indian browser, a shop not yet constituted — the picker is the server's list; a correction to Australia re-derives ── */
  const in2 = await w.browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
  const p4 = await in2.newPage(); p4.on('pageerror', (e) => w.errs.push('in2: ' + String(e && e.message || e)));
  const sent4 = {};
  await stubRegistration(in2, profile(), sent4);
  await w.step('C8', 'The country picker offers EXACTLY the registered packs (India - Australia - UAE), whatever the browser\'s locale', async () => {
    await register(p4, base);   /* WALK-REG 2026-10-16: the picker is inline on first setup */
    const codes = await p4.$$eval('[data-testid="cs-country"] option', (os) => os.map((o) => o.value));
    const want = COUNTRIES.map((c) => c.code);
    const ok = codes.length === want.length && want.every((c) => codes.includes(c));
    return { ok, saw: 'offered ' + codes.join(', ') + ' · served ' + want.join(', ') };
  });
  await w.step('C9', 'Not yet constituted: correct India -> Australia -> AUD, July and the zone ask painted from the pack (nothing preselected: this browser sits in Asia/Kolkata); pick Perth -> ONE PUT { AU, AUD, 7, Australia/Perth } -> rederived -> the app opens', async () => {
    await p4.selectOption('[data-testid="cs-country"]', 'AU');
    await p4.waitForSelector('[data-testid="cs-timezone"]', { timeout: 5000 });
    const cur = await text(p4, '[data-testid="cs-val-currency"]'), fy = await text(p4, '[data-testid="cs-val-fy"]'), tz = await text(p4, '[data-testid="cs-val-timezone"]');
    const curSrc = await text(p4, '[data-testid="cs-src-currency"]'), fySrc = await text(p4, '[data-testid="cs-src-fy"]');
    const preselected = await p4.$eval('[data-testid="cs-timezone"]', (el) => el.value);
    /* WALK-REG 2026-10-16: removed by decision — the cs-rule paragraph ("can still be corrected") */
    await p4.selectOption('[data-testid="cs-timezone"]', 'Australia/Perth');
    const tz2 = await text(p4, '[data-testid="cs-val-timezone"]');
    await p4.click('[data-testid="cs-save"]');
    await p4.waitForFunction(() => /#\/app/.test(location.hash), null, { timeout: 8000 });
    const p = sent4.put || {};
    const ok = /AUD/.test(cur) && /July/.test(fy) && /Pick the time zone/.test(tz) && preselected === '' && /Australia pack/.test(curSrc) && /Australia pack/.test(fySrc) && /Perth/.test(tz2)
      && p.country === 'AU' && p.currency === 'AUD' && p.fy_start_month === 7 && p.timezone === 'Australia/Perth';
    return { ok, saw: cur + ' (' + curSrc + ') · ' + fy + ' (' + fySrc + ') · zone first "' + tz + '" then ' + tz2 + ' · sent ' + JSON.stringify({ country: p.country, currency: p.currency, fy: p.fy_start_month, tz: p.timezone }) };
  });
  await in2.close();

  /* ── CS2: a CONSTITUTED shop (it has products): Country and Money are fixed on the step, and the server refuses a change in its words ── */
  const in3 = await w.browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
  const p5 = await in3.newPage(); p5.on('pageerror', (e) => w.errs.push('in3: ' + String(e && e.message || e)));
  const sent5 = {};
  const fixedProfile = profile({ done: true, required: false, constituted: true, constituted_by: { products: true, chits: false, entries: false } });
  await stubRegistration(in3, fixedProfile, sent5);
  await w.step('C10', 'A constituted shop (it has products) -> Country and Money greyed with the reason, no Change; Year and tax still open; the rule says never', async () => {
    await p5.goto(base + '/app.html#/login');   /* a page of the origin first: localStorage is unreadable on about:blank */
    await p5.waitForSelector('#root', { timeout: 15000 });
    /* the session AND the address are set without a hashchange, then ONE load reads both: a goto to #/country fired the router while the
       page had no session yet, and it went to #/login before the reload (a race - green or red by timing) */
    await p5.evaluate((s) => { localStorage.setItem('cb_sess', s); history.replaceState(null, '', '/app.html#/country'); }, W.session('Walk Owner', 'Walk Shop'));
    await p5.reload();
    await p5.waitForSelector('[data-testid="cs-rows"]', { timeout: 15000 });
    await p5.waitForSelector('[data-testid="cs-row-country"][data-locked="1"]', { timeout: 8000 });
    const noCountryChange = !(await p5.$('[data-testid="cs-change-country"]')), noMoneyChange = !(await p5.$('[data-testid="cs-change-currency"]'));
    const fyChange = !!(await p5.$('[data-testid="cs-change-fy"]')), taxChange = !!(await p5.$('[data-testid="cs-change-tax"]'));
    /* WALK-REG 2026-10-16: the reason now lives in the lock's title; cs-rule ("never change") removed by decision */
    const why = await p5.$eval('[data-testid="cs-row-country"] [data-testid="cs-lock"]', (n) => n.getAttribute('title'));
    const ok = noCountryChange && noMoneyChange && fyChange && taxChange && /Fixed/.test(why) && /products/.test(why);
    return { ok, saw: 'country "' + why + '" · Change on country ' + (noCountryChange ? 'absent' : 'SHOWN') + ', money ' + (noMoneyChange ? 'absent' : 'SHOWN') + ', year ' + (fyChange ? 'there' : 'missing') + ' · lock "' + why.slice(0, 60) + '"' };
  });
  await w.step('C11', '... and a PUT the server refuses (409 COUNTRY_CHANGE_IS_NEW_ENTITY) -> its sentence painted in the form, the step stays', async () => {
    /* the screen never offers the change; the server is the one that decides — so push the refused body the way an old tab would */
    await p5.evaluate(() => { CSU.edit.country = 'AU'; CSU.edit.currency = 'AUD'; });
    await p5.click('[data-testid="cs-save"]');
    await p5.waitForSelector('[data-testid="cs-err"]', { timeout: 8000 });
    const err = await text(p5, '[data-testid="cs-err"]'), hash = await p5.evaluate(() => location.hash);
    const ok = err === FIXED_WHY && /#\/country/.test(hash) && sent5.put && sent5.put.country === 'AU';
    return { ok, saw: '"' + err.slice(0, 70) + '…" · hash ' + hash };
  });
  await in3.close();
  /* ── CL3 · Where ChitBridge is for the chosen country, on the step itself (the first browser, signed in by its registration) ── */
  /* INT7c: SET-WALK1 W28(c) moved "Where ChitBridge is for <country>" to Standards › Country readiness — the step keeps ONE link to it, and that link follows the chosen country */
  const readyHref = () => page.$eval('[data-testid="cs-ready-link"]', (a) => a.getAttribute('href')).catch(() => '');
  await w.step('C12', 'The step is not a readiness table any more: no readiness block, ONE link to Standards › Country readiness for India', async () => {
    await page.goto(base + '/app.html#/country');
    await page.waitForSelector('[data-testid="cs-rows"]', { timeout: 15000 });
    const block = await page.$('[data-testid="cs-ready-title"]'), href = await readyHref();
    return { ok: !block && /standards\.html\?std=country&ready=IN$/.test(href), saw: (block ? 'a readiness block is still on the step' : 'no block') + ' · ' + href };
  });
  await w.step('C13', 'Change the country -> the UAE: the readiness link follows the chosen country', async () => {
    const tap = () => page.$eval('[data-testid="cs-change-country"]', (a) => a.click());   /* the workshop's fixed dev ribbon sits over the link once scrolled: a person's tap, not a pointer at a covered spot */
    if (await page.$('[data-testid="cs-change-country"]')) await tap();   /* an answered row: the edit icon opens the picker */
    await page.selectOption('[data-testid="cs-country"]', 'AE'); await page.waitForTimeout(150);
    const ae = await readyHref();
    if (await page.$('[data-testid="cs-change-country"]')) await tap();   /* WALK-REG 2026-10-16: choosing a value answers the row and folds the picker — the edit icon reopens it */
    await page.selectOption('[data-testid="cs-country"]', 'IN'); await page.waitForTimeout(150);
    return { ok: /ready=AE$/.test(ae), saw: ae };
  });
  for (const [th, wd, ht] of [['cream', 1366, 900], ['dark', 1366, 900], ['cream', 390, 844], ['dark', 390, 844]]) {
    await w.step('C14', 'Rule 13 on the step, ' + th + ' at ' + wd + ' px: AA · nothing clipped · no sideways scroll · the last row scrolls clear of the pinned buttons · the budget', async () => {
      /* loaded fresh at each width: app.html's own phone/laptop switch re-renders the app shell on a resize, whatever the route (a workshop
         behaviour outside this round — noted in the CL3 report), so a resize would walk away from the step rather than show it narrower */
      await page.setViewportSize({ width: wd, height: ht }); await page.reload(); await page.waitForSelector('[data-testid="cs-rows"]', { timeout: 15000 });
      await page.evaluate((k) => { CBAvatar.applyTheme(k); }, th); await page.waitForTimeout(250);
      const where = await page.evaluate(() => location.hash + ' · ' + (document.getElementById('root') || {}).textContent.slice(0, 80));
      if (!(await page.$('[data-testid="cs-rows"]'))) return { ok: false, saw: 'no block at ' + where };
      await page.evaluate(() => document.querySelector('[data-testid="cs-rows"]').scrollIntoView({ block: 'center' }));
      /* the step's own card is measured; the workshop's dev ribbon and Assistant button around it (app.html, localhost only) are not this screen */
      await page.evaluate(() => { const card = document.querySelector('[data-testid="cs-title"]').closest('.card'); card.setAttribute('data-walk-card', ''); for (let n = card.parentElement; n && n !== document.body; n = n.parentElement) n.setAttribute('data-walk-keep', ''); });
      await page.addStyleTag({ content: 'body *:not([data-walk-keep]):not([data-walk-card]):not([data-walk-card] *){visibility:hidden !important}' });
      const pairs = await page.evaluate(measure), bad = pairs.filter((x) => !x.grad && x.ratio < x.need);
      await page.evaluate(() => { const t = [...document.querySelectorAll('style')].pop(); if (t && /visibility:hidden !important/.test(t.textContent)) t.remove(); document.querySelectorAll('[data-walk-keep],[data-walk-card]').forEach((n) => { n.removeAttribute('data-walk-keep'); n.removeAttribute('data-walk-card'); }); });
      const r = await page.evaluate(() => {
        /* nothing floating over content = every row can be scrolled clear of the pinned controls: the pane at its END, the block's last row checked */
        const pane = document.querySelector('.auth'); pane.scrollTop = pane.scrollHeight;
        const el = document.querySelector('[data-testid="cs-rows"]'), rows = el.querySelectorAll('.govrow'), box = rows[rows.length - 1].getBoundingClientRect();
        const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const floating = [...document.querySelectorAll('body *')].filter((x) => { const cs = getComputedStyle(x); if (cs.position !== 'fixed' && cs.position !== 'sticky') return false; if (x.contains(el)) return false; const rc = x.getBoundingClientRect(); return rc.width > 0 && rc.height > 0 && hits(rc, box); }).map((x) => x.tagName + '#' + x.id + '[' + (x.getAttribute('data-testid') || '') + ']' + x.textContent.trim().slice(0, 20));
        const card = el.getBoundingClientRect();
        const clipped = [...el.querySelectorAll('.govrow > span')].filter((x) => x.scrollWidth > x.clientWidth + 1 || x.getBoundingClientRect().right > card.right + 1).length;
        return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, inner: el.scrollWidth > el.clientWidth + 1, floating, clipped,
          maxWords: Math.max(...[...el.querySelectorAll('.govrow, .hint')].map((x) => x.textContent.trim().split(/\s+/).length)) };
      });
      const ok = pairs.length > 10   /* WALK-REG 2026-10-16: fewer texts on the slimmer step */ && bad.length === 0 && r.sw <= r.iw && !r.inner && r.floating.length === 0 && r.clipped === 0 && r.maxWords <= 20;
      return { ok, saw: pairs.length + ' texts, ' + bad.length + ' below AA' + (bad.length ? ' (' + bad.slice(0, 3).map((x) => '"' + x.text + '" ' + x.ratio + '/' + x.need).join(', ') + ')' : '') + ' · scroll ' + r.sw + '/' + r.iw + ' · inner ' + r.inner + ' · floating ' + r.floating.length + (r.floating.length ? ' (' + r.floating[0] + ')' : '') + ' · clipped ' + r.clipped + ' · longest ' + r.maxWords + ' words' };
    });
  }
  await page.evaluate(() => { CBAvatar.applyTheme('cream'); }); await page.setViewportSize({ width: 1280, height: 860 });
});
