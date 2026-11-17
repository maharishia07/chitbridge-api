#!/usr/bin/env node
/**
 * e2e/walk-consent.cjs — CONSENT + PRIVACY, WALKED (T3-P3-CONSENT, 2026-10-14). Black box: what a shop's owner, a view-only login and a storefront
 * SHOPPER press, and what the screen says back. Three jobs:
 *   (b) CB CRM › a party › Consent: the chip per channel × purpose from the server's code; Yes / No → ONE POST; a withdrawal is a new row and
 *       the history says "By them, online" / "Noted by you"; a viewer sees every button greyed WITH its sentence; before b306 the block says so.
 *   (b) CB CRM › Privacy (#/privacy): the register (CBList, the server's total · page · limit), Log a request, Answer (owner; greyed otherwise
 *       with the server's `why`), the late chip; before b307 the screen says so in words.
 *   (c) shop.html › Privacy (the shopper, on the order's session): what the shop holds (a null said as "Not held"), the shop's country's law in
 *       words (IN → DPDP Act; AU → Privacy Act; no pack → said), offers Yes/No per channel, "A copy of my data" / "Erase my data" RECORDED
 *       (never a delete), the request then listed; before the migrations the buttons are greyed with the server's sentence.
 *   Then RULE 13 on each new screen: Cream and Dark at 1366 and 390 px — AA contrast, no clipping, no inner sideways scroll, nothing over a
 *   control, no link to app.html, copy within budget (e2e/lib/rule13.cjs).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-consent.cjs           the fixture stand-in (e2e/lib/standin.cjs privState — the api's rules in the page)
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-consent.cjs --real    chitbridge-api as a child on the loader's Postgres (e2e/lib/real-api.cjs):
 *                                                                        the CRM jobs on the loader's shop; the storefront job needs an order's
 *                                                                        token and is said as skipped in real mode (the storefront order flow mints it)
 * Reuse: e2e/lib/walk.cjs · standin.cjs (widened, not copied) · rule13.cjs · contract.cjs (every /api/crm answer held to the contract).
 */
'use strict';
const W = require('./lib/walk.cjs');
const TD = require('./lib/today.cjs');   /* QW1-TODAY: the one injected today (CB_TODAY) */
const C = require('./lib/contract.cjs');
const { rule13, audit } = require('./lib/rule13.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const REAL = process.argv.includes('--real');
const T = (id) => '[data-testid="' + id + '"]';

W.run(REAL ? 'consent-real' : 'consent', async (w) => {
  const { page, ctx, base } = w;
  let api = null, SI = null, S = null;
  const settle = (ms) => page.waitForTimeout(ms || 300);
  const txt = async (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const tc = async (sel) => page.locator(sel).first().evaluate((n) => n.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');   /* inside a closed <details>: innerText is '' */
  const body = async () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const has = (sel) => page.locator(sel).count().then((n) => n > 0);
  const posts = (re) => (S ? S.calls.filter((c) => re.test(c)).length : -1);
  const toast = () => txt('#toast');
  const KEY = 'P-0002';   /* Chola Auto Care — the golden fixture's customer + supplier */

  async function signIn(p, id, code) {
    await p.goto(base + '/crm.html#/parties');
    await p.waitForSelector(T('signin-id'), { timeout: 20000 });
    await p.fill(T('signin-id'), id); await p.click(T('signin-go'));
    await p.waitForSelector(T('signin-code') + ', ' + T('signin-pin'), { timeout: 20000 });
    if (await p.locator(T('signin-code')).count()) await p.fill(T('signin-code'), code); else await p.fill(T('signin-pin'), code);
    await p.click(T('signin-verify'));
    await p.waitForSelector(T('shop-name') + ', ' + T('signin-pin1'), { timeout: 20000 });
    if (await p.locator(T('signin-pin1')).count()) { await p.fill(T('signin-pin1'), '2749'); await p.fill(T('signin-pin2'), '2749'); await p.click(T('signin-pinsave')); await p.waitForSelector(T('shop-name'), { timeout: 20000 }); }
  }
  const openRecord = async (key) => {
    await page.goto(base + '/crm.html#/party/' + encodeURIComponent(key));
    await page.waitForSelector(T('crm-record'), { timeout: 20000 }); await settle(400);
  };
  const openConsent = async () => {
    const d = page.locator(T('crm-sec-consent'));
    if (!(await d.evaluate((n) => n.open).catch(() => false))) await page.click(T('crm-sec-consent') + ' > summary');
    await page.waitForSelector(T('crm-consent-law'), { timeout: 10000 }); await settle(500);
  };

  try {
    if (REAL) {
      api = await require('./lib/real-api.cjs').start({ origin: base });
      await ctx.addInitScript((b) => { try { localStorage.setItem('cb_api_base', b); } catch (_) {} }, api.base);
      await signIn(page, api.shop, api.otp);
    } else {
      SI = require('./lib/standin.cjs');
      S = SI.standIn({ priv: SI.privState({ country: 'IN', seed: true }) });
      await ctx.route('**/api/**', (r) => SI.route(S, r));
      await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Mayur Bhavan'));
    }
    await page.setViewportSize({ width: 1366, height: 900 });

    /* ═══ (b) the record's Consent block ═══ */
    let key = KEY;
    if (REAL) {   /* the loader's shop: the first party on its list */
      await page.goto(base + '/crm.html#/parties'); await page.waitForSelector('[data-row][data-testid^="crm-party-"]', { timeout: 30000 });
      key = await page.$eval('[data-row][data-testid^="crm-party-"]', (n) => n.getAttribute('data-testid').replace('crm-party-', ''));
    }
    await openRecord(key);
    await w.step('C1', 'CRM › a party → Consent section: one row per channel, Offers "Not asked" (the server’s NO_CONSENT) with a Yes, Their orders "Allowed"', async () => {
      const rows = await page.locator('[data-testid^="crm-consent-row-"]').count();
      const wa = await tc(T('crm-consent-whatsapp-marketing')), svc = await tc(T('crm-consent-whatsapp-service')), code = await page.getAttribute(T('crm-consent-whatsapp-marketing'), 'data-code');
      const fact = await tc(T('crm-sec-fact-consent'));
      return { ok: rows === 5 && /Not asked|Agreed|Said no|Withdrawn/.test(wa) && !!code && /Allowed|Stopped/.test(svc) && !!fact, saw: rows + ' channel rows · WhatsApp offers "' + wa + '" (' + code + ') · their orders "' + svc + '" · fact "' + fact + '"' };
    });
    await w.step('C2', 'Open Consent → the law line in the SHOP’s country’s words (never a default) and the history (or "Nothing noted yet")', async () => {
      await openConsent();
      const law = await txt(T('crm-consent-law')), h = await txt(T('crm-consent-hist'));
      return { ok: (/DPDP|Privacy Act|PDPL|No privacy pack|no country/.test(law)) && /History/.test(h), saw: 'law "' + law.slice(0, 80) + '" · history: ' + h.slice(0, 60) };
    });
    await w.step('C3', 'Yes to offers on WhatsApp → ONE POST { whatsapp · marketing · true } → chip "Agreed", the button is now No; the history says who noted it', async () => {
      const before = posts(/POST \/api\/crm\/parties\/[^/]+\/contact-prefs/);
      if (!(await has(T('crm-consent-yes-whatsapp')))) { await page.click(T('crm-consent-no-whatsapp')); await page.waitForSelector(T('crm-consent-yes-whatsapp'), { timeout: 15000 }); }
      await page.click(T('crm-consent-yes-whatsapp'));
      await page.fill(T('crm-consent-note'), 'Said yes at the counter on Monday'); await page.click(T('crm-consent-note-save'));
      await page.waitForSelector(T('crm-consent-no-whatsapp'), { timeout: 15000 }); await settle(600);
      const chip = await txt(T('crm-consent-whatsapp-marketing')), code = await page.getAttribute(T('crm-consent-whatsapp-marketing'), 'data-code'), fact = await txt(T('crm-sec-fact-consent'));
      await openConsent(); const hist = await txt(T('crm-consent-hist'));
      const n = posts(/POST \/api\/crm\/parties\/[^/]+\/contact-prefs/) - before;
      return { ok: /Agreed/.test(chip) && code === 'CONSENT' && /WhatsApp/.test(fact) && /Noted/.test(hist) && (REAL || n === 1), saw: 'chip "' + chip + '" (' + code + ') · fact "' + fact + '" · ' + (REAL ? 'real' : n + ' POST') + ' · history: ' + hist.slice(0, 80) };
    });
    await w.step('C4', 'No → a WITHDRAWAL: chip "Withdrawn" (CONSENT_WITHDRAWN); the yes stays in the history as proof (two rows)', async () => {
      await page.click(T('crm-consent-no-whatsapp'));
      await page.waitForSelector(T('crm-consent-yes-whatsapp'), { timeout: 15000 }); await settle(600);
      const chip = await txt(T('crm-consent-whatsapp-marketing')), code = await page.getAttribute(T('crm-consent-whatsapp-marketing'), 'data-code');
      await openConsent(); const rows = await page.locator('[data-testid^="crm-consent-h-"]').count(), hist = await txt(T('crm-consent-hist'));
      return { ok: /Withdrawn/.test(chip) && code === 'CONSENT_WITHDRAWN' && rows >= 2 && /Withdrawn/.test(hist), saw: 'chip "' + chip + '" (' + code + ') · ' + rows + ' history rows' };
    });
    await w.step('C5', 'Stop their-orders messages on SMS → "Stopped" (OPTED_OUT), the button is now Allow — the gate the WhatsApp sender asks', async () => {
      await page.click(T('crm-consent-stop-sms'));
      await page.waitForSelector(T('crm-consent-allow-sms'), { timeout: 15000 }); await settle(400);
      const chip = await txt(T('crm-consent-sms-service')), code = await page.getAttribute(T('crm-consent-sms-service'), 'data-code');
      return { ok: /Stopped/.test(chip) && code === 'OPTED_OUT', saw: 'SMS their orders "' + chip + '" (' + code + ')' };
    });
    await w.step('C5a', 'Yes needs its reason: under 3 characters → the sentence on the field, NO POST; the api’s own 400 words show on the field too', async () => {
      const RT = /contact-prefs$/;
      const re = /POST [/]api[/]crm[/]parties[/][^/]+[/]contact-prefs/, before = posts(re);
      await openConsent(); await page.click(T('crm-consent-yes-whatsapp'));
      await page.fill(T('crm-consent-note'), 'ok'); await page.click(T('crm-consent-note-save')); await settle(300);
      const short = await txt(T('crm-consent-note-err')), none = posts(re) - before;
      let seen = null;
      await page.route(RT, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        seen = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({ status: 400, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Bad request', status: 400, code: 'BAD_REQUEST', detail: 'To note a yes to offers, say it came from staff (source: staff) and add a note of what the customer said, and when.' }) });
      });
      await page.fill(T('crm-consent-note'), 'Asked on the phone'); await page.click(T('crm-consent-note-save')); await settle(500);
      await page.unroute(RT);
      const words = await txt(T('crm-consent-note-err')), open = await has(T('crm-consent-note'));
      await page.click(T('crm-consent-note-cancel')); const closed = !(await has(T('crm-consent-note')));
      return { ok: /at least 3/.test(short) && (REAL || none === 0) && seen && seen.source === 'staff' && seen.note === 'Asked on the phone' && seen.allowed === true && /source: staff/.test(words) && open && closed, saw: 'short "' + short + '" · POSTs ' + none + ' · body ' + JSON.stringify(seen) + ' · api words "' + words.slice(0, 60) + '" · field kept ' + open + ' · cancel closes ' + closed };
    });
    if (S) await w.step('C5b', 'the customer’s own no stands: the line says so beside the toggle; a staff Yes with a reason is noted but does not lift it', async () => {
      S.priv.prefs.unshift({ pref_id: 'cust-no-1', party_id: S.priv.prefs[0].party_id, channel: 'email', purpose: 'marketing', allowed: false, basis: 'consent', notice_version: null, noted_at: new Date(TD.nowMs() - 86400e3).toISOString(), noted_by: S.priv.prefs[0].party_id, source: 'self', withdrawn_at: null });
      await page.reload(); await openRecord(key); await openConsent();
      const line = await tc(T('crm-consent-standing-email')), other = await tc(T('crm-consent-standing-whatsapp'));
      await page.click(T('crm-consent-yes-email')); await page.fill(T('crm-consent-note'), 'Rang to ask, said yes'); await page.click(T('crm-consent-note-save'));
      await page.waitForFunction(() => !document.querySelector('[data-testid="crm-consent-note"]'), null, { timeout: 15000 }); await settle(700);
      const code = await page.getAttribute(T('crm-consent-email-marketing'), 'data-code'); await openConsent(); const again = await tc(T('crm-consent-standing-email'));
      return { ok: /The customer said no themselves[.] Only their own yes lifts it[.]/.test(line) && other === '' && code !== 'CONSENT' && /said no themselves/.test(again), saw: 'line "' + line + '" · whatsapp line "' + other + '" · chip code after the staff yes ' + code };
    });
    /* rule 13 on the record: with CB Accounts OFF in the stand-in. With it on, the record's Ledger block (cap-books.js: the dues fact and the statement
       table) already overflows 390 px before this round — a CB Accounts finding, reported, not hidden; the Consent block itself is measured here. */
    if (S) { S.ledgerOff = true; await page.evaluate(() => { try { localStorage.setItem('cb_crm_ledger', '0'); } catch (_) {} }); await page.reload(); await openRecord(key); await openConsent(); await page.click(T('crm-consent-yes-email'), { timeout: 3000 }).catch(() => {}); }   /* the reason field open and the standing line shown, measured below; a reload: the same hash would not reboot the page */
    await rule13(w, 'R13a', 'the record with Consent open (Ledger off)', 'screen');
    if (S) S.ledgerOff = false;

    /* ═══ (b) the register ═══ */
    await page.goto(base + '/crm.html#/privacy'); await page.waitForSelector(T('crm-prv-list'), { timeout: 20000 }); await settle(800);
    await w.step('P1', 'CRM › Privacy: the register as a CBList — Who · Asked for · Due; a late request wears "Late"; the nav shows the late count', async () => {
      const b = await body(), rows = await page.locator('[data-row][data-testid^="crm-prv-"]').count(), nav = await txt(T('crm-nav-n-privacy'));
      const late = REAL ? true : /Late/.test(b) && nav === '1';
      return { ok: /Privacy requests/.test(b) && (REAL || rows === 1) && late, saw: rows + ' rows · nav late "' + nav + '" · ' + (/Late/.test(b) ? 'a Late chip' : 'no late') };
    });
    await w.step('P2', '+ Log a request → who · asked for · received on → POST → the row appears; the due date is the server’s', async () => {
      const before = posts(/POST \/api\/crm\/privacy-requests$/);
      await page.click(T('crm-prv-add')); await page.waitForSelector(T('crm-prv-sheet'), { timeout: 10000 });
      await page.fill(T('crm-prv-who'), 'Selvi · 98400 11111'); await page.selectOption(T('crm-prv-kind'), 'erase');
      await page.click(T('crm-prv-save')); await page.waitForSelector(T('crm-prv-sheet'), { state: 'detached', timeout: 15000 }); await settle(800);
      const b = await body(), n = posts(/POST \/api\/crm\/privacy-requests$/) - before;
      return { ok: /Selvi/.test(b) && /Erase/.test(b) && (REAL || n === 1), saw: (REAL ? 'real' : n + ' POST') + ' · ' + (/Selvi/.test(b) ? 'row "Selvi · Erase" listed' : 'row missing') };
    });
    await w.step('P3', 'Answer (the owner): the erase row’s sheet says erasure runs through the lifecycle path → outcome + words → the row says Done; answered once', async () => {
      const row = page.locator('[data-row][data-testid^="crm-prv-"]', { hasText: 'Selvi' }).first();
      await row.click(); await settle(300);
      const act = page.locator(T('crm-prv-answer')).first();
      if (!(await act.count())) { await row.hover(); await settle(200); }
      await page.locator(T('crm-prv-answer')).first().click();
      await page.waitForSelector(T('crm-prv-answer-sheet'), { timeout: 10000 });
      const note = await txt(T('crm-prv-erase-note'));
      await page.selectOption(T('crm-prv-out'), 'done'); await page.fill(T('crm-prv-ans'), 'Erased through the platform; the bills stay as the law requires.');
      await page.click(T('crm-prv-answer-save')); await page.waitForSelector(T('crm-prv-answer-sheet'), { state: 'detached', timeout: 15000 }); await settle(800);
      const b = await body();
      return { ok: /lifecycle/.test(note) && /Done/.test(b), saw: 'note "' + note.slice(0, 60) + '" · ' + (/Done/.test(b) ? 'row says Done' : 'no Done') };
    });
    await rule13(w, 'R13b', 'the privacy register', 'screen');

    if (!REAL) {
      /* a view-only login: every action shown, greyed, with its sentence */
      const ctx2 = await ctx.browser().newContext({ viewport: { width: 1366, height: 900 } });
      S.viewer = true;
      await ctx2.route('**/api/**', (r) => SI.route(S, r));
      await ctx2.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, SI.viewerSession());
      const p2 = await ctx2.newPage();
      await w.step('V1', 'A view-only login on the record: Yes / No / Privacy request are SHOWN, greyed, with "Your login can only view"', async () => {
        await p2.goto(base + '/crm.html#/party/' + KEY); await p2.waitForSelector(T('crm-record'), { timeout: 20000 }); await p2.waitForTimeout(400);
        const yes = p2.locator(T('crm-consent-yes-email')).first(), dis = await yes.getAttribute('disabled'), why = await yes.getAttribute('title');
        const req = await p2.locator(T('crm-consent-request')).first().getAttribute('disabled');
        return { ok: dis !== null && /only view/.test(why || '') && req !== null, saw: 'Yes disabled=' + (dis !== null) + ' title "' + why + '" · Privacy request disabled=' + (req !== null) };
      });
      await w.step('V2', 'A view-only login on Privacy: Log greyed with its sentence; Answer carries the SERVER’s why ("Only the owner answers…")', async () => {
        await p2.goto(base + '/crm.html#/privacy'); await p2.waitForSelector(T('crm-prv-list'), { timeout: 20000 }); await p2.waitForTimeout(800);
        const add = await p2.locator(T('crm-prv-add')).first().getAttribute('disabled'), why = await p2.locator(T('crm-prv-add-why')).first().innerText().catch(() => '');
        const row = p2.locator('[data-row][data-testid^="crm-prv-"]').first(); await row.click(); await p2.waitForTimeout(300);
        const b = await p2.evaluate(() => document.body.innerText);
        return { ok: add !== null && /only view/.test(why) && /Only the owner answers/.test(b), saw: 'Log disabled=' + (add !== null) + ' "' + why + '" · ' + (/Only the owner answers/.test(b) ? 'Answer says the server’s why' : 'no why') };
      });
      S.viewer = false; await ctx2.close();

      /* before the migrations */
      await w.step('M1', 'Before b306 / b307: the Consent block and the register say so in words — never "nothing here", never a 500', async () => {
        S.priv.migrated = false; S.priv.reqsMigrated = false;
        await openRecord(KEY);
        const note = await tc(T('crm-consent-notyet')), yes = await page.locator(T('crm-consent-yes-email')).first().getAttribute('disabled'), fact = await tc(T('crm-sec-fact-consent'));
        await page.goto(base + '/crm.html#/privacy'); await page.waitForSelector(T('crm-prv-list'), { timeout: 20000 }); await settle(800);
        const b = await body();
        S.priv.migrated = true; S.priv.reqsMigrated = true;
        return { ok: /after an update/.test(note) && yes !== null && /Not set up yet/.test(fact) && /start after an update/.test(b), saw: 'block "' + note + '" · fact "' + fact + '" · register: ' + (/start after an update/.test(b) ? 'said in words' : b.slice(0, 60)) };
      });

      /* ═══ (c) the shopper, on the storefront ═══ */
      S.priv.shopper = '20000000-0000-4000-8000-000000000555';
      const openSheet = async () => {
        await page.goto(base + '/shop.html?s=CBWALK0001'); await settle(600);
        await page.evaluate(() => { _MYTOK = 'walk-shopper-token'; shopPrivacy(); });
        await page.waitForSelector(T('shop-priv-held'), { timeout: 15000 }); await settle(300);
      };
      await openSheet();
      await w.step('S1', 'shop.html › Privacy (the order’s session): what the shop holds — a missing value says "Not held"; the law in the shop’s words (IN → DPDP Act)', async () => {
        const held = await txt(T('shop-priv-held')), law = await txt(T('shop-priv-law')), title = await txt(T('shop-priv-title'));
        return { ok: /Kumar/.test(held) && /Not held/.test(held) && /DPDP/.test(law) && /Your privacy/.test(title), saw: '"' + title + '" · law "' + law.slice(0, 60) + '" · held: ' + held.slice(0, 90) };
      });
      await w.step('S2', 'Offers on WhatsApp → Yes → POST /api/privacy/me/consent → chip "Yes"; the CRM’s record would now say "By them, online"', async () => {
        const before = posts(/POST \/api\/privacy\/me\/consent/);
        await page.click(T('shop-priv-yes-whatsapp')); await page.waitForSelector(T('shop-priv-no-whatsapp'), { timeout: 15000 }); await settle(300);
        const chip = await txt(T('shop-priv-chip-whatsapp')), code = await page.getAttribute(T('shop-priv-chip-whatsapp'), 'data-code'), msg = await txt(T('shop-priv-msg'));
        const byThem = S.priv.prefs.some((r) => r.party_id === S.priv.shopper && r.noted_by === S.priv.shopper && r.channel === 'whatsapp' && r.allowed);
        return { ok: chip === 'Yes' && code === 'CONSENT' && posts(/POST \/api\/privacy\/me\/consent/) - before === 1 && byThem && /Noted/.test(msg), saw: 'chip "' + chip + '" (' + code + ') · noted_by = the shopper: ' + byThem + ' · "' + msg + '"' };
      });
      await w.step('S3', 'Ask the shop: the buttons are the LAW’s kinds (IN: six); "Erase my data" → POST /me/requests → recorded, listed under Your requests with its due date — nothing deleted', async () => {
        const kinds = await page.locator('[data-testid^="shop-priv-ask-"]').count(), before = posts(/POST \/api\/privacy\/me\/requests/);
        await page.click(T('shop-priv-ask-erase')); await page.waitForSelector(T('shop-priv-made'), { timeout: 15000 }); await settle(300);
        const made = await txt(T('shop-priv-made')), msg = await txt(T('shop-priv-msg')), b = await body();
        const recorded = S.priv.reqs.some((r) => r.party_id === S.priv.shopper && r.kind === 'erase' && !r.answered_at);
        return { ok: kinds === 6 && posts(/POST \/api\/privacy\/me\/requests/) - before === 1 && recorded && /Erase my data/.test(made) && /Due/.test(made) && /lifecycle/.test(b), saw: kinds + ' kinds · recorded=' + recorded + ' · "' + msg + '" · ' + made.slice(0, 60) };
      });
      await w.step('S4', 'An AU shop: the law line says Privacy Act and offers only the kinds that law gives (no Erase); a country with no pack says so', async () => {
        S.priv.country = 'AU'; await openSheet();
        const law = await txt(T('shop-priv-law')), kinds = await page.locator('[data-testid^="shop-priv-ask-"]').count(), erase = await has(T('shop-priv-ask-erase'));
        S.priv.country = 'NZ'; await openSheet(); const law2 = await txt(T('shop-priv-law'));
        S.priv.country = 'IN';
        return { ok: /Privacy Act/.test(law) && kinds === 4 && !erase && /No privacy pack for NZ/.test(law2) && !/DPDP|India/.test(law2), saw: 'AU "' + law.slice(0, 50) + '" · ' + kinds + ' kinds, erase=' + erase + ' · NZ "' + law2.slice(0, 60) + '"' };
      });
      await w.step('S5', 'Before the migrations: Yes/No and Ask are shown, greyed, with the server’s sentence', async () => {
        S.priv.migrated = false; S.priv.reqsMigrated = false; await openSheet();
        const yes = await page.locator(T('shop-priv-yes-whatsapp')).first().getAttribute('disabled'), why = await txt(T('shop-priv-consent-why')), ask = await page.locator(T('shop-priv-ask-access')).first().getAttribute('disabled'), whyR = await txt(T('shop-priv-ask-why'));
        S.priv.migrated = true; S.priv.reqsMigrated = true;
        return { ok: yes !== null && /Not set up yet/.test(why) && ask !== null && /Not set up yet/.test(whyR), saw: 'Yes disabled=' + (yes !== null) + ' "' + why + '" · Ask disabled=' + (ask !== null) };
      });
      /* the storefront wears the SHOP's template, not the avatar's two themes (no CBAvatar there): rule 13's same eyes at 1366 and 390, in the shop's look */
      for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: width > 500 ? 900 : 844 }); await openSheet();
        await w.step('R13c\u00b7' + width, 'the shopper\u2019s privacy sheet \u00b7 ' + width + ' px -> AA contrast, no clipping, no inner sideways scroll, nothing over a control, no app.html link, copy in budget', async () => {
          /* the sheet's own texts: the storefront's catalogue under the backdrop is the shop template's (its empty-state line measures 2.91 — a storefront finding, reported) */
          const hostHTML = await page.$eval('#ohost', (n) => n.innerHTML);
          const pairs = (await page.evaluate(measure)).filter((x) => hostHTML.indexOf(x.html) >= 0), bad = pairs.filter((x) => !x.grad && x.ratio < x.need), a = await audit(page, 'ohost');
          const fails = [].concat(bad.map((x) => 'contrast ' + x.ratio + ' "' + x.text + '"'), a.clip.map((x) => 'clipped "' + x + '"'), a.scroll.map((x) => 'scroll ' + x), a.cover.map((x) => 'covered ' + x), a.app.map((x) => 'app.html ' + x), a.budget.map((x) => 'budget ' + x));
          return { ok: !fails.length && pairs.length > 5, saw: pairs.length + ' texts measured, lowest ' + Math.min.apply(null, pairs.map((x) => x.ratio)) + (fails.length ? ' \u00b7 ' + fails.slice(0, 4).join(' \u00b7 ') : ' \u00b7 clean') };
        });
      }
      await page.setViewportSize({ width: 1366, height: 900 });
      await w.step('X1', 'Every /api/crm answer the stand-in served matched the API contract (web-api.contract.json)', async () => { const [ok, m] = C.finish(); return { ok, saw: m }; });
    } else {
      await w.step('S0', 'Storefront job in real mode: SKIPPED here — the shopper’s token is minted by a storefront order (DEV_OTP); the fixture walk covers the sheet', async () => ({ ok: true, saw: 'skipped, said' }));
    }
  } finally {
    if (api) await api.stop();
  }
});
