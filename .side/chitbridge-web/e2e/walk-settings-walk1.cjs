#!/usr/bin/env node
/**
 * e2e/walk-settings-walk1.cjs — CB SETTINGS after Athi's walk on the live AU shop (SET-WALK1, 2026-10-15; W6–W28), WALKED on an AU stand-in AND an IN one.
 * Black box: it presses what an owner presses and reads what the screen says. A FIXTURE shop; the API is a stand-in answering inside the page.
 *   W28  Country is the FIRST screen; Money confirms symbol · number format · big-number words · decimals · date, each a LIVE example (CBLocale/CBMoney);
 *        the readiness block is gone from the step and lives under Standards (?ready=<cc>) · W10 the money's reason names the SHOP's country ·
 *        W12 "you chose" · W27(a) Supplies beside the tax registration · W11 Policy shows GST registration read-only with the Country door
 *   W25  the vault Save sends a MERGE-PATCH with the version (only the row that moved); a 409 paints "Changed since you opened it — reload?" + Reload
 *   W24  leaving a screen with unsaved edits asks "Save or discard?"
 *   W21  an EMPTY list is as tall as its content (no 2,400 px of nothing); rule 13's blank-area check on every section
 *   W19/W23 the identity and licence sections offer their standard rows first, per country (AU: ABN · Postcode · BSB, no IFSC) · W22 the picker's choice is what is added
 *   W26/W14b the bill line inside the top box; the lower box "Used on forms for an authority"; the identity prefilled from the shop
 *   W27  Print setup: the signature editor + the LIVE sample bill painted by bill-print.html (AU: TAX INVOICE · ABN · GST 10 % one line; IN: CGST/SGST)
 *   W15  the "testing" key kind only when the server offers it · W16 a connector's row words from the server's code · W18 the current device listed on a legacy sign-in
 *   W6 Home's banner offers "Pair here" · W8 the edition chip is a button · W9 the screen chip says what was copied · W7 the kural band follows the owner's pref
 *   RULE 13 (Cream · Dark × 1366 · 390) on country · shop · print · account.
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-settings-walk1.cjs [--show]
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const J = C.json;
const crmApi = require('./lib/crm-api.cjs');
const { rule13 } = require('./lib/rule13.cjs');

const walk = async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], cc: 'AU', conflict: false, version: '1001', testing: false, legacy: true, paired: false };
  const ME = () => S.cc === 'AU'
    ? { display_name: 'Austore One', gstn: '51824753556', address: '12 Pitt Street, Sydney', phone: '02 9000 0000', business_status: 'active', currency_code: 'AUD', country_code: 'AU', country: 'AU', supplies: 'both' }
    : { display_name: 'Fixture Shop', gstn: '33AABCK1234F1Z6', address: '12 Bazaar Street, Madurai', phone: '044 2259 2632', business_status: 'active', currency_code: 'INR', country_code: 'IN', country: 'IN', supplies: 'goods' };
  const VAULT = () => ({ sections: [{ type: 'identity', label: '', rows: [
    { name: 'Legal name', tag: 'legal_name', value: S.cc === 'AU' ? 'Austore One Pty Ltd' : 'Fixture Shop Pvt Ltd' }, { name: 'Address', tag: 'address', value: ME().address },
    { name: 'Phone', tag: 'phone', value: ME().phone }] }] });
  S.vault = VAULT();
  const CS = () => S.cc === 'AU'
    ? { migrated: true, done: true, required: false, country: { code: 'AU', name: 'Australia' }, currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', zones: ['Australia/Sydney', 'Australia/Perth'],
        tax: { registered: false, number: null, scheme: null }, source: { country: 'your registration' }, constituted: false, countries: [{ code: 'AU', name: 'Australia', currency: 'AUD', fy_start_month: 7, zones: ['Australia/Sydney', 'Australia/Perth'] }, { code: 'IN', name: 'India', currency: 'INR', fy_start_month: 4, zones: ['Asia/Kolkata'] }], pack: { id: 'AU', version: '1.0.0', books: true, code: null, why: null } }
    : { migrated: true, done: true, required: false, country: { code: 'IN', name: 'India' }, currency: 'INR', fy_start_month: 4, timezone: 'Asia/Kolkata', zones: ['Asia/Kolkata'],
        tax: { registered: true, number: '33AABCK1234F1Z6', scheme: 'regular' }, source: { country: 'your registration' }, constituted: false, countries: [{ code: 'AU', name: 'Australia', currency: 'AUD', fy_start_month: 7, zones: ['Australia/Sydney', 'Australia/Perth'] }, { code: 'IN', name: 'India', currency: 'INR', fy_start_month: 4, zones: ['Asia/Kolkata'] }], pack: { id: 'IN', version: '1.0.0', books: true, code: null, why: null } };
  const FLAGS = { trade_side: 'sell', gst_registration: 'regular', number_words: 'pack', connectors_in_use: [] };
  const ui = (order, label, more) => Object.assign({ label, level: 'entity', gov: 'entity', order, help: '' }, more || {});
  const SCHEMA = { trade_side: { type: 'enum', options: ['sell', 'receive'], def: 'sell', ui: ui(1, 'This entity') },
    gst_registration: { type: 'enum', options: ['regular', 'unregistered'], def: 'regular', ui: ui(2, 'GST registration') }, number_words: { type: 'enum', options: ['pack', 'lakh', 'million'], def: 'pack' } };
  const ok = { ok: true, code: null, why: null };
  const CAT = () => [{ id: 'csv', name: 'File connector (CSV)', does: 'Files.', adapters: ['csv'], may: ok },
    { id: 'zoho', name: 'Zoho Books connector', does: 'Invoices both ways.', adapters: ['zoho'], may: S.cc === 'AU' ? { ok: false, code: 'NOT_YET_FOR_COUNTRY', why: 'Our Zoho Books kit is built for India\'s GST so far — not yet for a Australia shop.' } : ok },
    { id: 'tally', name: 'Tally connector', does: 'Vouchers.', adapters: ['tally'], may: S.cc === 'AU' ? { ok: false, code: 'NOT_FOR_COUNTRY', why: 'The Tally connector is built on Tally\'s Indian GST books, so it is not offered for a Australia shop.' } : ok }]
    .concat(S.cc === 'AU' ? [{ id: 'xero', name: 'Xero connector', does: 'Items from Xero.', adapters: [], may: { ok: false, code: 'NOT_YET', why: 'A Xero kit is not built yet.' } }] : []);

  await ctx.route('**/api/**', async (r) => {
    const q = r.request(), p = new URL(q.url()).pathname, m = q.method();
    let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
    if (m !== 'GET') S.calls.push({ m, p, body });
    if (p === '/api/entities/me') return J(r, 200, { entity: ME() });
    if (p === '/api/entities/profile' && m === 'PATCH') { Object.assign(ME(), body); return J(r, 200, { ok: true }); }
    if (p === '/api/governance/profile' && m === 'GET') return J(r, 200, { vault: S.vault, vault_version: S.version, vault_encrypted: true });
    if (p === '/api/governance/profile/vault' && m === 'PUT') {
      if (S.conflict) { S.conflict = false; return J(r, 409, { code: 'VAULT_CHANGED', error: 'Changed since you opened it — reload?', message: 'Changed since you opened it — reload?' }); }
      S.version = String(Number(S.version) + 1); return J(r, 200, { vault: S.vault, version: S.version });
    }
    if (p === '/api/governance/country-setup') return J(r, 200, CS());
    if (p === '/api/entities/policy' && m === 'GET') return J(r, 200, { flags: FLAGS, schema: SCHEMA, bound: {}, bound_schema: {}, may: { trade_side: ok, gst_registration: ok, number_words: ok, connectors_in_use: ok } });
    if (p === '/api/entities/policy' && m === 'PATCH') { Object.assign(FLAGS, body); return J(r, 200, { flags: FLAGS }); }
    if (p === '/api/signin/sessions') return J(r, 200, { sessions: [], legacy: S.legacy, may: { devices: ok } });
    if (p === '/api/signin/devices') return J(r, 200, { devices: [] });
    if (p === '/api/keys' && m === 'GET') return J(r, 200, { keys: [], scopes: ['services', 'offers', 'pricing', 'tax', 'invoice', 'till', 'connector'].concat(S.testing ? ['testing'] : []) });
    if (p === '/api/integrations/catalogue') return J(r, 200, { connectors: CAT() });
    if (p === '/api/integrations/status') return J(r, 200, { connectors: [] });
    if (p === '/api/entities/entitlements') return J(r, 200, { plan: 'test', name: 'Test', enforced: false, quotas: {} });
    if (p === '/api/entities/usage') return J(r, 200, { not_enabled: true });
    if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 0, customers: 0, in: 0, out: 0, stuck: 0 }));
    return J(r, 200, {});
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_ids', '1'); localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const has = (sel) => page.locator(sel).first().count().then((n) => n > 0);
  const go = async (sec, ready) => { await page.goto(base + '/settings.html?cc=' + S.cc + '&t=' + Date.now() + '#/' + sec); await page.waitForSelector(ready, { timeout: 20000 }); await page.waitForTimeout(350); }; // clock-ok: cache-buster suffix on the URL, not a business date
  const puts = () => S.calls.filter((c) => c.m === 'PUT' && c.p === '/api/governance/profile/vault');

  /* ── W28 · W10 · W12 · W27(a): Country, on the AU shop ── */
  await page.goto(base + '/settings.html'); await page.waitForSelector('[data-testid="cs-rows"]', { timeout: 20000 }); await page.waitForTimeout(300);
  await w.step('A1', 'Settings opens on COUNTRY (the first section); the sidebar lists Country before Your shop', async () => {
    const first = await page.$$eval('[data-testid^="skel-nav-"]', (b) => b.map((x) => x.getAttribute('data-sec')));
    return { ok: /#\/country$/.test(page.url()) && first[0] === 'country' && first[1] === 'shop' && first.indexOf('print') > 0, saw: page.url().replace(base, '') + ' · ' + first.join(' › ') };
  });
  await w.step('A2', 'AU · Money confirms more than the code: symbol A$, number format A$1,234,567,890.89 (a long sample, W29), 2 decimals, the date, "1.2 billion" — each a live example; the words are not a choice (the money is million-grouped)', async () => {
    /* WALK-REG 2026-10-16: the money block is ONE line (cs-money-number · cs-money-date); the symbol and decimals rows are gone, and for a million-grouped money there is no words choice at all */
    const num = await txt('[data-testid="cs-money-number"]'), date = await txt('[data-testid="cs-money-date"]');
    const noWordsChoice = !(await has('#cs-words')), noRows = !(await has('[data-testid="cs-money-symbol"]')) && !(await has('[data-testid="cs-money-decimals"]'));
    return { ok: /A\$1,234,567,890\.89/.test(num) && noWordsChoice && noRows && date.length > 6, saw: [num, date, 'words choice ' + !noWordsChoice].join(' · ') };
  });
  await w.step('A3', 'AU · the money\'s reason names AUSTRALIA (never "the usual currency in India"); the readiness block is gone, a link to Standards › Country readiness stands instead; Supplies sits beside the tax row', async () => {
    const src = await txt('[data-testid="cs-src-currency"]'), ready = await has('[data-testid="cs-ready"]'), link = await page.getAttribute('[data-testid="cs-ready-link"]', 'href').catch(() => '');
    const sup = await txt('[data-testid="cs-val-supplies"]');
    return { ok: !/India/.test(src) && !ready && /standards\.html\?std=country&ready=AU/.test(link || '') && /Both/.test(sup), saw: 'money from "' + src + '" · readiness block ' + ready + ' · link ' + link + ' · supplies "' + sup + '"' };
  });
  await w.step('A4', 'W12 · change the year → its source reads "you chose", never "typed"', async () => {
    await page.click('[data-testid="cs-change-fy"]'); await page.selectOption('#cs-fy', '1'); await page.waitForTimeout(200);
    const src = await txt('[data-testid="cs-src-fy"]');
    return { ok: src === 'you chose', saw: '"' + src + '"' };
  });
  await w.step('A5', 'W24 · with that unsaved change, the sidebar\'s Your shop asks "Unsaved changes — Save or discard?"; Discard moves on', async () => {
    await page.click('[data-testid="skel-nav-shop"]'); await page.waitForSelector('[data-testid="confirm"]', { timeout: 5000 });
    const ask = await txt('[data-testid="confirm"]');
    await page.click('[data-testid="confirm-discard"]'); await page.waitForSelector('[data-testid="shop-card"]', { timeout: 8000 });
    return { ok: /Unsaved changes/.test(ask) && /Save or discard/.test(ask) && /#\/shop$/.test(page.url()), saw: '"' + ask.slice(0, 80) + '" → ' + page.url().replace(base, '') };
  });
  await w.step('A6', 'Standards ?ready=AU → the Country readiness sheet (the rows CBCountryReady paints), with the door back to Country setup', async () => {
    await page.goto(base + '/standards.html?std=country&ready=AU'); await page.waitForSelector('[data-testid="std-sheet-ready"]', { timeout: 20000 }); await page.waitForTimeout(600);
    const t = await txt('[data-testid="std-ready-title"]'), rows = await page.locator('[data-testid="std-ready-row"]').count(), back = await has('[data-testid="std-ready-back"]');
    return { ok: /Country readiness · Australia/.test(t) && rows > 0 && back, saw: t + ' · ' + rows + ' rows' };
  });

  /* ── W26 · W14b · W19 · W23 · W25 · W22: Your shop and the vault on AU ── */
  await go('shop', '[data-testid="vault-only-identity"]');
  await w.step('A7', 'Your shop · no bill line, no Supplies dropdown; the lower box is headed "Your identity"; no Licences / Print setup doors under the boxes', async () => {
    /* WALK-REG 2026-10-16: removed by decision — shop-why, shop-print-link, shop-licences-link; the heading "Used on forms for an authority" is now "Your identity" */
    const why = await has('[data-testid="shop-why"]');
    const sup = await has('#pf_sup'), title = await txt('[data-testid="shop-forms-title"]'), lic = await has('[data-testid="shop-licences-link"]'), pr = await has('[data-testid="shop-print-link"]');
    return { ok: !why && !sup && /Your identity/.test(title) && !lic && !pr, saw: 'bill line ' + why + ' · supplies ' + sup + ' · "' + title + '" · licences link ' + lic + ' · print link ' + pr };
  });
  await w.step('A8', 'AU · the identity rows name ABN and Postcode (never GSTIN / PIN / IFSC); the bank suggestions say BSB; the detail-name placeholder names the first suggestion', async () => {
    const sug = await page.$$eval('#vsug_identity option', (o) => o.map((x) => x.value).join(',')), bank = await page.$$eval('#vsug_bank option', (o) => o.map((x) => x.value).join(',')), ph = await page.getAttribute('[data-testid="vault-only-identity"] input[list]', 'placeholder').catch(() => '');
    return { ok: /ABN/.test(sug) && /Postcode/.test(sug) && !/GSTIN|PIN/.test(sug) && /BSB/.test(bank) && !/IFSC/.test(bank) && !/IFSC/.test(ph || ''), saw: 'identity ' + sug.split(',').slice(0, 3) + ' · bank ' + bank.split(',').slice(0, 3) + ' · placeholder "' + ph + '"' };
  });
  await w.step('A9', 'W25 · change the legal name → Save → ONE PUT carrying the version and a merge-patch of that row only (identity|, t:legal_name), nothing else', async () => {
    const before = puts().length;
    const inp = page.locator('[data-testid="vault-only-identity"] input').nth(1);   /* WALK-REG 2026-10-16: no section label input on Your shop — the legal-name row's NAME, then its VALUE */
    await inp.fill('Austore One Pty Ltd (new)'); await inp.press('Tab'); await page.waitForTimeout(1300);   /* WALK-REG 2026-10-16 R19: the field saves itself on change (no Save button) */
    const put = puts().slice(before)[0], b = (put && put.body) || {};
    const sec = b.patch && b.patch.sections && b.patch.sections['identity|'], rows = sec && sec.rows ? Object.keys(sec.rows) : [];
    return { ok: puts().length === before + 1 && b.version === '1001' && rows.length === 1 && rows[0] === 't:legal_name' && /new\)/.test(JSON.stringify(sec.rows)) && !b.vault, saw: JSON.stringify(b).slice(0, 160) };
  });
  await w.step('A10', 'W25 · the server says 409 (another screen saved first) → "Changed since you opened it — reload?" painted with a Reload button; Reload re-reads the vault', async () => {
    S.conflict = true;
    const inp = page.locator('[data-testid="vault-only-identity"] input').nth(1); await inp.fill('Austore Two'); await inp.press('Tab'); await page.waitForTimeout(1300);   /* WALK-REG 2026-10-16 R19: autosave on change */
    const said = await txt('[data-testid="vault-conflict"]'), btn = await has('[data-testid="vault-reload"]');
    await page.click('[data-testid="vault-reload"]'); await page.waitForTimeout(500);
    const after = await page.locator('[data-testid="vault-only-identity"] input').nth(1).inputValue();
    return { ok: /Changed since you opened it/.test(said) && btn && /Austore One Pty Ltd/.test(after), saw: '"' + said + '" · reload ' + btn + ' · now "' + after + '"' };
  });
  await w.step('A11', 'W14b · a shop with NO identity section opens one prefilled from the shop\'s own details (the address, the ABN) — nothing saved until Save', async () => {
    S.vault = { sections: [] }; const before = puts().length;
    await go('shop', '[data-testid="vault-only-identity"]');
    const vals = await page.$eval('[data-testid="vault-only-identity"]', (n) => [...n.querySelectorAll('input')].map((i) => i.value).join(' | '));
    S.vault = VAULT();
    return { ok: /12 Pitt Street/.test(vals) && /51824753556/.test(vals) && puts().length === before, saw: vals.slice(0, 120) };
  });

  /* ── W21 · W18 · W22 · W23: Account ── */
  await go('account', '[data-testid="sx-ses-list"]');
  await w.step('A12', 'W21 · the EMPTY sign-ins list is as tall as its content (data-cbl-fit=content, under 300 px) — the vault below it is in view, not 2,400 px down', async () => {
    await page.waitForSelector('[data-testid="cbl-empty-set-sessions"], [data-testid="sx-ses-this-device"], [data-row]', { timeout: 8000 }).catch(() => {});
    const m = await page.$eval('#sx_ses_list', (n) => ({ fit: n.getAttribute('data-cbl-fit'), h: n.getBoundingClientRect().height, vaultTop: (document.getElementById('vaulthost') || n).getBoundingClientRect().top }));
    return { ok: m.fit === 'content' && m.h < 300 && m.vaultTop < 1400, saw: 'fit ' + m.fit + ' · ' + Math.round(m.h) + ' px · vault at ' + Math.round(m.vaultTop) + ' px' };
  });
  await w.step('A13', 'W18 · a sign-in older than the list: THIS device is still listed, marked "This one", from the page\'s own session', async () => {
    const row = await txt('[data-row]'), tag = await has('[data-testid^="sx-ses-current-"]'), legacy = await txt('[data-testid="sx-ses-legacy"]');
    /* WALK-REG 2026-10-16 R43: the tag now says "without a device name" (was "older than the list - sign in again", which signing in again could not cure) */
    return { ok: tag && /This one/.test(row) && /device name/.test(legacy), saw: '"' + row.slice(0, 60) + '" · "' + legacy.slice(0, 60) + '"' };
  });
  await w.step('A14', 'W22/W23 · SET-34 (6 Nov 2026): the vault SHOWS on Account (it was hidden by the 16 Oct decision)', async () => {
    const shown = await page.locator('[data-testid="sx-vault-wrap"]:visible').count();
    return { ok: shown === 1, saw: 'vault wrap visible ' + shown };
  });

  /* ── W15 · W16 · W11 ── */
  await go('counters', '[data-testid="sx-title"]');
  await w.step('A15', 'W15 · WALK-REG 2026-10-16: removed by decision — NO key list or key-kind picker anywhere for a shop owner (Counters, even if the server offers "testing")', async () => {
    const shop = await has('[data-testid="sx-key-scope"]');
    S.testing = true; await go('counters', '[data-testid="sx-title"]'); await page.waitForTimeout(400);
    const platform = await has('[data-testid="sx-key-scope"]'); S.testing = false;
    return { ok: !shop && !platform, saw: 'key picker for a shop ' + shop + ' · with testing offered ' + platform };
  });
  await go('connectors', '[data-testid="sx-con-may-zoho"]');
  await w.step('A16', 'W16 · AU: Zoho Books "Not yet for your country" (its code), Tally "Not for your country", Xero "Not built yet" — words from the CODE, the sentence in the row\'s next level', async () => {
    const z = await txt('[data-testid="sx-con-may-zoho"]'), t = await txt('[data-testid="sx-con-may-tally"]'), x = await txt('[data-testid="sx-con-may-xero"]');
    return { ok: /Not yet for your country/.test(z) && /Not for your country/.test(t) && /Not built yet/.test(x), saw: 'zoho "' + z + '" · tally "' + t + '" · xero "' + x + '"' };
  });
  await go('policy', '[data-testid="sx-pol-gst_registration"]');
  await w.step('A17', 'W11 · Policy shows GST registration READ-ONLY: who may = "Country setup", its Save greyed with the sentence, the door to Country', async () => {
    const who = await txt('[data-testid="sx-pol-who-gst_registration"]');
    await page.click('[data-testid="sx-pol-gst_registration"]'); await page.waitForTimeout(200);
    /* WALK-REG 2026-10-16: Policy has no Save button any more (rows autosave on change) — a read-only row offers no control, only the door */
    const dis = (await page.locator('[data-act="save"]').count()) === 0 && !(await has('[data-testid="sx-pol-in-gst_registration"]')), door = await page.getAttribute('[data-testid="sx-pol-country-door"]', 'href').catch(() => '');
    return { ok: /Country setup/.test(who) && dis && /#\/country/.test(door || ''), saw: '"' + who + '" · greyed ' + dis + ' · ' + door };
  });

  /* ── W27: Print setup ── */
  await go('print', '[data-testid="pr-editor"]');
  const slip = () => page.frames().find((f) => /bill-print\.html/.test(f.url()));
  await w.step('A18', 'W27 · Print setup: the signature lines prefilled from the shop; the business name and the ABN carry no tick box (always on a tax invoice); the sample bill is painted by bill-print.html', async () => {
    const name = await page.inputValue('[data-testid="pr-in-trade_name"]'), abn = await page.inputValue('[data-testid="pr-in-tax_id"]');
    /* WALK-REG 2026-10-16: required lines (name, address, tax id) have NO tick box and no arrows; pr-locked-tax_id and a disabled pr-show-trade_name no longer exist */
    const lockedName = (await page.locator('[data-testid="pr-show-trade_name"]').count()) === 0, lockedAbn = (await page.locator('[data-testid="pr-show-tax_id"]').count()) === 0, why = await txt('[data-testid="pr-always"]');
    const addrFree = (await page.locator('[data-testid="pr-show-address"]').count()) === 0;   /* AU: the address is optional, so it keeps its tick box (!addrFree) */
    await page.waitForTimeout(800); const f = slip();
    const head = f ? await f.locator('[data-testid="slip-head-trade_name"]').innerText().catch(() => '') : '';
    return { ok: name === 'Austore One' && abn === '51824753556' && lockedName && lockedAbn && /always on a tax invoice/i.test(why) && !addrFree && /Austore One/.test(head), saw: name + ' · ' + abn + ' · locked ' + lockedName + '/' + lockedAbn + ' · "' + why.slice(0, 50) + '" · slip head "' + head + '"' };
  });
  await w.step('A19', 'W27 · AU: the sample says TAX INVOICE, ABN on the head, GST 10 % on ONE line (no CGST/SGST, no HSN table); typing a footer line shows on the paper at once', async () => {
    /* WALK-REG 2026-10-16: the footer is an optional line — it reaches the paper only once ticked ("Tick to print (optional)") */
    if (!(await page.locator('[data-testid="pr-show-footer"]').isChecked())) await page.locator('[data-testid="pr-show-footer"]').check();
    await page.fill('[data-testid="pr-in-footer"]', 'Thanks for shopping at Austore'); await page.waitForTimeout(500);
    const f = slip(), text = f ? (await f.locator('#slip').innerText().catch(() => '')).replace(/\s+/g, ' ') : '';
    return { ok: /TAX INVOICE/.test(text) && /ABN 51824753556/.test(text) && /GST 10%/.test(text) && !/CGST/.test(text) && !/HSN/.test(text) && /Thanks for shopping at Austore/.test(text), saw: text.slice(0, 160) };
  });
  await w.step('A20', 'W27 · Save → one PUT of the vault merge-patch carrying the `signature|` section (the rows by tag, the order, the paper)', async () => {
    const before = puts().length; await page.selectOption('[data-testid="pr-paper"]', '58'); await page.click('[data-testid="pr-save"]'); await page.waitForTimeout(1200);   /* PRINT-1 slice 0: Save + confirm, no autosave */
    const put = puts().slice(before)[0], b = (put && put.body) || {}, sec = b.patch && b.patch.sections && b.patch.sections['signature|'];
    const rows = sec && sec.rows ? sec.rows : {};
    return { ok: puts().length === before + 1 && !!sec && rows['t:footer'] && rows['t:footer'].value === 'Thanks for shopping at Austore' && rows['t:paper'] && rows['t:paper'].value === '58' && /trade_name/.test((rows['t:order'] || {}).value || ''), saw: JSON.stringify(b).slice(0, 180) };
  });

  /* ── the IN stand-in: lakh words, CGST/SGST, the Indian rows ── */
  S.cc = 'IN'; S.vault = VAULT();
  await go('country', '[data-testid="cs-rows"]');
  await w.step('A21', 'IN · Money: ₹1,23,45,67,890.89 (lakh grouping — the money\'s own, W29 long sample), the words a CHOICE (as the money is written · lakh · million) with "123.5 crore"; choosing million → one PATCH { number_words }', async () => {
    const chosen = () => page.$eval('#cs-words', (n) => n.options[n.selectedIndex].textContent).catch(() => '');
    const num = (await txt('[data-testid="cs-money-number"]')).replace(/[\u200b-\u200f\u00a0\u202f]/g, ''), choice = await has('#cs-words'), words = await chosen();   /* ICU may put a thin/no-break space after ₹ */
    await page.selectOption('#cs-words', 'million'); await page.waitForTimeout(200);
    const after = await chosen();
    await page.click('[data-testid="cs-save"]'); await page.waitForTimeout(800);
    const patch = S.calls.filter((c) => c.m === 'PATCH' && c.p === '/api/entities/policy').pop();
    const sp = '[\\s\\u00a0\\u202f]';   /* ICU's compact notation joins the number and the word with a narrow no-break space */
    return { ok: /₹1,23,45,67,890\.89/.test(num) && choice && new RegExp('123(\\.5)?' + sp + 'crore').test(words) && new RegExp('1\\.2' + sp + 'billion').test(after) && patch && patch.body.number_words === 'million', saw: num + ' · choice ' + choice + ' · "' + words.slice(0, 40) + '" → "' + after.slice(0, 40) + '" · ' + JSON.stringify(patch && patch.body) };
  });
  await go('print', '[data-testid="pr-editor"]');
  await w.step('A22', 'IN · the sample bill carries GSTIN, CGST/SGST and the HSN table; the address cannot be unticked (Rule 46)', async () => {
    await page.waitForTimeout(800); const f = slip(), text = f ? (await f.locator('#slip').innerText().catch(() => '')).replace(/\s+/g, ' ') : '';
    const addrLocked = (await page.locator('[data-testid="pr-show-address"]').count()) === 0;   /* WALK-REG 2026-10-16: no tick box at all on a required line */
    return { ok: /GSTIN 33AABCK1234F1Z6/.test(text) && /CGST/.test(text) && /HSN/.test(text) && addrLocked, saw: 'address locked ' + addrLocked + ' · ' + text.slice(0, 120) };
  });
  await go('shop', '[data-testid="vault-only-identity"]');
  await w.step('A23', 'IN · the identity rows still say GSTIN and PIN; the bank suggestions say IFSC', async () => {
    const sug = await page.$$eval('#vsug_identity option', (o) => o.map((x) => x.value).join(',')), bank = await page.$$eval('#vsug_bank option', (o) => o.map((x) => x.value).join(','));
    return { ok: /GSTIN/.test(sug) && /PIN/.test(sug) && /IFSC/.test(bank), saw: sug.split(',').slice(0, 3) + ' · ' + bank.split(',').slice(0, 3) };
  });

  /* ── W6 · W8 · W9 · W7: Home and the frame ── */
  await w.step('A24', 'W6 · Home: a counter in this browser paired to ANOTHER shop → the banner\'s one button is "Pair here" (the counter opened for this shop)', async () => {
    await ctx.addInitScript(() => { try { localStorage.setItem('cb_till_key', 'tk-x'); localStorage.setItem('cb_till_lastslot', 'cb-till-mayur'); localStorage.setItem('cb_till_shop@mayur', 'ent-other'); localStorage.setItem('cb_till_shopname@mayur', 'Mayur Bhavan'); localStorage.setItem('cb_till_counter_name@mayur', 'Counter 1'); } catch (_) {} });
    const p2 = await ctx.newPage(); await p2.goto(base + '/'); await p2.waitForSelector('[data-testid="till-paired"]', { timeout: 20000 }).catch(() => {});
    const row = await p2.locator('[data-testid="till-paired"]').first().innerText().catch(() => ''), href = await p2.getAttribute('[data-testid="till-paired"] a.fix', 'href').catch(() => '');
    await p2.close();
    return { ok: /Mayur Bhavan/.test(row) && /Pair here/.test(row) && /till\.html#shop=ent-walk&as=Fixture%20Shop/.test(href || ''), saw: '"' + row.replace(/\s+/g, ' ').slice(0, 80) + '" → ' + href };
  });
  await w.step('A25', 'W8 · W9 · W7 · the screen chip says "Screen code copied — paste it when you report a problem"; the avatar menu has the Thirukkural choice; the kural band is off for an English shop by default and on when chosen', async () => {
    await go('country', '[data-testid="cs-rows"]');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.click('[data-testid="screen-id"]').catch(() => {}); await page.waitForTimeout(200);
    const says = await page.getAttribute('[data-testid="screen-id"]', 'data-copied-says').catch(() => '');
    const bandOff = !(await page.$eval('[data-testid="kural-footer"]', (n) => !n.hidden && n.offsetHeight > 20).catch(() => false));
    await page.evaluate(() => { CBAvatar.set('kural', 'on'); }); await page.waitForTimeout(400);
    const bandOn = await page.$eval('[data-testid="kural-footer"]', (n) => !n.hidden && n.offsetHeight > 20).catch(() => false);
    await page.evaluate(() => { CBAvatar.set('kural', 'auto'); });
    await page.click('[data-testid="avatar"]'); await page.waitForTimeout(200); const group = await has('[data-testid="kural-group"]'); await page.keyboard.press('Escape');
    return { ok: /Screen code copied/.test(says || '') && bandOff && bandOn && group, saw: '"' + says + '" · band off ' + bandOff + ' → on ' + bandOn + ' · menu group ' + group };
  });

  /* ── RULE 13 (with W21's blank-area check): AU country · shop · print · account; IN country · print ── */
  S.cc = 'AU'; S.vault = VAULT();
  for (const [k, ready, id] of [['country', '[data-testid="cs-rows"]', 'R1'], ['shop', '[data-testid="vault-only-identity"]', 'R2'], ['print', '[data-testid="pr-editor"]', 'R3'], ['account', '[data-testid="sx-ses-list"]', 'R4']]) {
    await page.setViewportSize({ width: 1366, height: 900 }); await go(k, ready);
    await rule13(w, id, 'Settings › ' + k + ' (AU)', 'set');
  }
  S.cc = 'IN'; S.vault = VAULT();
  for (const [k, ready, id] of [['country', '[data-testid="cs-rows"]', 'R5'], ['print', '[data-testid="pr-editor"]', 'R6']]) {
    await page.setViewportSize({ width: 1366, height: 900 }); await go(k, ready);
    await rule13(w, id, 'Settings › ' + k + ' (IN)', 'set');
  }
  if (w.errs.length) w.note('T99', 'page errors seen during the walk', w.errs.slice(0, 3).join(' | '));
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('settings-walk1', walk);
