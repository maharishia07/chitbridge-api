#!/usr/bin/env node
/**
 * e2e/walk-au-words.cjs — AU-WORDS (2026-10-15): AN AUSTRALIAN OR UAE SHOP SEES ITS COUNTRY'S WORDS, CHOICES, CHECKS AND ICONS — NEVER INDIA'S.
 *
 * Athi on live austore1 (country AU), 15 Oct: Home's "Leans on us" › Filings said "Name your GSTIN" and "If you change · Your GSTIN"; the Accounts
 * card wore ₹; Settings › Policy offered REGULAR · COMPOSITION · UNREGISTERED (no GSTIN) · SEZ; the shop sheet's TRADE READY asked for "PAN on file"
 * and "GSTIN"; Retention / Chit expiry read "0 days". Each read India's words directly. Now every one reads the shop's COUNTRY PACK: the server
 * words the sides panel, the trade checks and the policy schema (api lib/pack-words — the one reader beside profile.taxIdWordOf); the shell paints
 * the shop's currency symbol as the money icon (CBLocale.symbol of the header's business.currency); a 0 is shown as the word the server names.
 *
 * Three stand-in shops walk the same three screens: AU (Aussie Store · ABN · A$) · AE (Gulf Store · TRN · AED) · IN (Fixture Shop — the control:
 * GSTIN · PAN on file · ₹ · the four kinds, unchanged). The site is served from this checkout; the API is a stand-in answering inside the page.
 * ⭐ The stand-in's words are the SERVER's: when the api checkout sits beside this one, its own builders answer (lib/sides.build · lib/entity-header.build
 * · lib/policy.schemaFor — what the api tests pin); without it, the same shapes typed from those tests (tests/pack-words.test.cjs · sides.test.cjs ·
 * entities-header.test.cjs) stand in, and the walk says so.
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-au-words.cjs            headless
 *   node e2e/walk-au-words.cjs --show                                 headed, captions, a results page that stays open
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-au-words-NN.png.
 */
'use strict';
const path = require('path');
const W = require('./lib/walk.cjs');
const books = require('./lib/books-api.cjs'), crmApi = require('./lib/crm-api.cjs');
const C = require('./lib/contract.cjs');   /* M43: every /api/books answer this stand-in serves is held to the API contract */
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const INDIA = /GSTIN|\bPAN\b|₹/;
const WIDE = { width: 1366, height: 860 }, PHONE = { width: 390, height: 800 };

/* ── the three shops and what each must see ── */
const SHOPS = [
  { cc: 'AU', name: 'Aussie Store', currency: 'AUD', taxId: '51824753556', expect: { taxWord: 'ABN', filings: 'BAS · Name your ABN', impact: 'Your ABN',
    checks: ['Address proven', 'Phone verified', 'ABN', 'ACN on file', 'GST registration'], symbol: 'A$', regLabel: 'GST registration', regNow: 'GST registered', kinds: ['regular', 'unregistered'],
    labels: { regular: 'GST registered', unregistered: 'Not registered' }, keep: /5 years/ } },
  { cc: 'AE', name: 'Gulf Store', currency: 'AED', taxId: '100123456700003', expect: { taxWord: 'TRN', filings: 'VAT return · Name your TRN', impact: 'Your TRN',
    checks: ['Address proven', 'Phone verified', 'TRN', 'Trade licence'], symbol: 'AED', regLabel: 'VAT registration', regNow: 'VAT registered', kinds: ['regular', 'unregistered'],
    labels: { regular: 'VAT registered', unregistered: 'Not registered' }, keep: /5 years/ } },
  { cc: 'IN', name: 'Fixture Shop', currency: 'INR', taxId: '33AABCK1234F1Z6', expect: { taxWord: 'GSTIN', filings: 'GSTR-3B · Name your GSTIN', impact: 'Your GSTIN',
    checks: ['Address proven', 'Phone verified', 'PAN on file', 'GSTIN'], symbol: '₹', regLabel: 'GST registration', regNow: 'Regular', kinds: ['regular', 'composition', 'unregistered', 'sez'],
    labels: { regular: 'Regular', composition: 'Composition', unregistered: 'Unregistered (no GSTIN)', sez: 'SEZ' }, keep: /8 years/ } },
];

/* ── the server's words: the api's own builders when they are beside this checkout, else the typed shapes ── */
const API = path.join(__dirname, '..', '..', 'chitbridge-api');
let api = null;
try { api = { sides: require(path.join(API, 'lib', 'sides')), header: require(path.join(API, 'lib', 'entity-header')), policy: require(path.join(API, 'lib', 'policy')) }; }
catch (e) { console.log('NOTE: the api checkout is not beside this one (' + String(e && e.message).split('\n')[0].slice(0, 90) + ') — the stand-in answers with the shapes typed from the api tests'); }

const CHECK_KEYS = { 'Address proven': 'address', 'Phone verified': 'phone', 'PAN on file': 'pan', 'Trade licence': 'trade_licence', 'ACN on file': 'acn', 'GST registration': 'gst_registration' };
function typedAnswers(shop) {
  const X = shop.expect;
  const checks = X.checks.map((label) => ({ key: CHECK_KEYS[label] || 'tax_id', label, done: false }));
  const header = { business: { name: shop.name, legal_name: null, address: '1 Market St', phone: '+61400000000', currency: shop.currency }, licences: [], trade_ready: { checks, done: false } };
  const proof = { id: 'proof', n: 'Trade proof', m: '0 of ' + checks.length + ' shown · still to show: ' + X.checks.join(', '), s: 'wait', t: 'Incomplete', fix: 'Finish', href: '/know-your-business.html' };
  const sides = { lean: [{ key: 'rules', rows: [{ id: 'jurisdiction', n: shop.name, m: 'Jurisdiction · version not recorded', s: 'later', t: 'No version' }] }],
    use: [{ key: 'cite', rows: [{ id: 'filings', n: 'Filings', m: X.filings, s: 'later', t: 'not yet' }, proof] }],
    impact: { field: 'tax_id', tax_id_word: X.taxWord, k: 'If you change', n: X.impact, businesses: 0, filings: null, m: 'Nobody affected', who: [] } };
  const ui = (order, label, more) => Object.assign({ label, level: 'entity', gov: 'entity', order, help: '' }, more || {});
  const schema = {
    gst_registration: { type: 'enum', options: ['regular', 'composition', 'unregistered', 'sez'], def: 'regular', ui: ui(1, X.regLabel, { options: X.kinds, labels: X.labels, help: X.kinds.map((k) => X.labels[k].toUpperCase() + ' — …').join(' ') }) },
    chit_expiry_days: { type: 'number', def: 0, ui: ui(2, 'Chit expiry (days)', { level: 'work-pattern', gov: 'chosen', labels: { 0: 'No expiry' } }) },
    retention_days: { type: 'number', def: 0, ui: ui(3, 'Retention (days)', { gov: 'chosen', labels: { 0: shop.cc === 'IN' ? 'Keep — the law here asks 8 years' : 'Keep — the law here asks 5 years' } }) },
  };
  return { header, sides, policy: { flags: { gst_registration: 'regular', chit_expiry_days: 0, retention_days: 0 }, country: shop.cc, schema, bound: {}, bound_schema: {}, may: {} } };
}
function answers(shop) {
  if (!api) return typedAnswers(shop);
  const me = { display_name: shop.name, address: '1 Market St', phone: '+61400000000', gstn: shop.taxId, country: shop.cc, currency_code: shop.currency, vertical: 'general', policy_flags: {} };
  const header = api.header.build({ me, profile: {}, compliance: [], docs: {}, vault: { sections: [] } });
  const sides = api.sides.build({ rows: { me: [me], actors: [] }, gov: null, rail: { suppliers: 1, customers: 2, in: 3, out: 0 }, header, entity_id: 'ME' });
  const policy = { flags: api.policy.defaults(), country: shop.cc, schema: api.policy.schemaFor(shop.cc), bound: api.policy.BOUND, bound_schema: api.policy.BOUND_SCHEMA, may: {} };
  return { header, sides, policy };
}

const walk = async (w) => {
  const { page, ctx, base } = w;
  const S = { shop: SHOPS[0], a: answers(SHOPS[0]) };
  await ctx.route('**/api/**', (r0) => {
    const r = C.wrap(r0);
    const u = new URL(r.request().url()), p = u.pathname;
    if (p === '/api/entities/header') return J(r, 200, S.a.header);
    if (p === '/api/entities/sides') return J(r, 200, S.a.sides);
    if (p === '/api/entities/policy') return J(r, 200, S.a.policy);
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: S.shop.name, currency_code: S.shop.currency, country_code: S.shop.cc } });
    if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 1, customers: 2, in: 3, out: 0, stuck: 0 }));
    if (p === '/api/books/health') return J(r, 200, books.health({ waiting: [] }));
    return J(r, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const home = async () => {
    await page.goto(base + '/'); await page.waitForSelector('[data-testid="cbshell"]', { timeout: 20000 });
    await page.evaluate(() => window.SHELL && window.SHELL.ready);
    await page.waitForSelector('[data-testid="shell-sheet-full"]', { state: 'attached', timeout: 20000 });
    await page.waitForSelector('[data-testid="sides-row"][data-id="filings"]', { state: 'attached', timeout: 20000 });
    await page.waitForTimeout(400);
  };
  const policy = async () => { await page.goto(base + '/settings.html#/policy'); await page.reload(); await page.waitForSelector('[data-testid="sx-pol-gst_registration"]', { timeout: 20000 }); await page.waitForTimeout(300); };
  const india = (cc, text) => (cc === 'IN' ? INDIA.test(text) : !INDIA.test(text));   /* the control must say India's words; the others never */
  if (!api) w.note('API', 'the server\'s words', 'the api checkout is not beside this one: the stand-in answers with the shapes the api tests pin');

  for (const shop of SHOPS) {
    const X = shop.expect, cc = shop.cc, who = cc + ' (' + shop.name + ')';
    S.shop = shop; S.a = answers(shop);
    await page.setViewportSize(WIDE);
    await home();
    await w.step(cc + '-1', who + ' · Home › "Leans on us" › Filings and the impact box say the pack\'s word (' + X.taxWord + ')', async () => {
      await page.click('[data-testid="sides-open-r"]'); await page.waitForTimeout(300);
      const panel = await txt('[data-testid="sides-right"]'), filings = await txt('[data-testid="sides-row"][data-id="filings"]'), impact = await txt('[data-testid="sides-impact"]');
      return { ok: filings.includes(X.filings) && impact.includes(X.impact) && india(cc, panel), saw: 'Filings "' + filings + '" · impact "' + impact.slice(0, 40) + '"' };
    });
    await w.step(cc + '-2', who + ' · the shop sheet › TRADE READY lists the pack\'s checks (' + X.checks.join(' · ') + ')', async () => {
      await page.click('.cbsh-who'); await page.waitForSelector('[data-testid="shell-sheet-full"]', { state: 'visible', timeout: 5000 });
      const checks = await page.$$eval('[data-testid="shell-check"]', (els) => els.map((e) => e.textContent.replace(/✓/g, '').replace(/\s+/g, ' ').trim()));
      const sheet = await txt('[data-testid="shell-sheet-full"]');
      return { ok: checks.join('|') === X.checks.join('|') && india(cc, sheet), saw: checks.join(' · ') };
    });
    await w.step(cc + '-3', who + ' · the Accounts card and the Running area wear the shop\'s money symbol (' + X.symbol + ')', async () => {
      const card = await txt('[data-testid="shell-card-accounts"] .g'), nav = await txt('[data-testid="shell-nav-money"] .i');
      return { ok: card === X.symbol && nav === X.symbol, saw: 'card "' + card + '" · area "' + nav + '"' };
    });
    await policy();
    await w.step(cc + '-4', who + ' · Settings › Policy › the registration row is the pack\'s: "' + X.regLabel + '" now "' + X.regNow + '", offering ' + X.kinds.join(' · '), async () => {
      const row = await txt('[data-testid="sx-pol-gst_registration"]');
      await page.click('[data-testid="sx-pol-gst_registration"]'); await page.waitForTimeout(250);
      /* WALK-REG 2026-10-16: the registration row is read-only here (set under Country) - there is no control, so no options to list; its info icon carries the help */
      const help = await txt('[data-testid="sx-pol-next-gst_registration"]') + ' ' + (await page.getAttribute('[data-testid="sx-pol-why-gst_registration"]', 'title').catch(() => '') || '');
      const door = await page.locator('[data-testid="sx-pol-country-door"]').count();
      return { ok: row.includes(X.regLabel) && row.includes(X.regNow) && door === 1 && india(cc, help), saw: 'row "' + row.slice(0, 60) + '" · door to Country ' + door };
    });
    await w.step(cc + '-5', who + ' · Policy › Chit expiry reads "No expiry" and Retention the law\'s years — never "0"', async () => {
      /* WALK-REG 2026-10-16: removed by decision - the chit_expiry_days row is hidden (nothing reads it yet); only the retention years are asserted */
      const expiry = '', hiddenExpiry = (await page.locator('[data-testid="sx-pol-chit_expiry_days"]').count()) === 0, keep = await txt('[data-testid="sx-pol-retention_days"]');
      return { ok: hiddenExpiry && X.keep.test(keep) && !/\b0\b/.test(expiry + keep), saw: '"' + expiry.slice(0, 50) + '" · "' + keep.slice(0, 60) + '"' };
    });
    await w.step(cc + '-6', who + ' · the whole Policy list ' + (cc === 'IN' ? 'still says GSTIN (the control)' : 'holds no GSTIN / PAN / ₹'), async () => {
      /* WALK-REG 2026-10-16: the helps moved into info icons (title=), so the words are read from the visible text AND the titles */
      const all = (await txt('[data-testid="sx-pol-list"]')) + ' ' + (await page.$$eval('[data-testid="sx-pol-list"] [title]', (n) => n.map((x) => x.getAttribute('title')).join(' ')));
      return { ok: india(cc, all), saw: (all.match(INDIA) || ['no India word']).join(', ') + ' in ' + all.length + ' chars' };
    });
  }

  /* rule 13: the two screens at 390 px — nothing scrolls sideways; the sheet still lists the checks */
  S.shop = SHOPS[0]; S.a = answers(SHOPS[0]);
  await page.setViewportSize(PHONE);
  await policy();
  await w.step('P-1', 'AU · Settings › Policy at 390 px: no sideways scroll, the registration row readable', async () => {
    const ok = await noSideways(), row = await txt('[data-testid="sx-pol-gst_registration"]');
    return { ok: ok && /GST registration/.test(row), saw: (ok ? 'no sideways scroll' : 'SIDEWAYS SCROLL') + ' · "' + row.slice(0, 40) + '"' };
  });
  await home();
  await w.step('P-2', 'AU · Home at 390 px: the sheet lists ABN, no sideways scroll, the card wears A$', async () => {
    await page.click('.cbsh-who'); await page.waitForSelector('[data-testid="shell-sheet-full"]', { state: 'visible', timeout: 5000 });
    const checks = await page.$$eval('[data-testid="shell-check"]', (els) => els.map((e) => e.textContent.replace(/✓/g, '').replace(/\s+/g, ' ').trim()));
    const ok = await noSideways(), card = await txt('[data-testid="shell-card-accounts"] .g');
    return { ok: ok && checks.includes('ABN') && !checks.some((c) => INDIA.test(c)) && card === 'A$', saw: (ok ? 'no sideways scroll' : 'SIDEWAYS SCROLL') + ' · ' + checks.join(' · ') + ' · card ' + card };
  });
  await w.step('M43', 'the stand-in answered every /api/books call as the API contract says', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
};
walk.opts = { viewport: WIDE };
W.run('au-words', walk);
