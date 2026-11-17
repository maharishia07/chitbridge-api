#!/usr/bin/env node
/**
 * e2e/cx4-pack-words.cjs — CX4 (2026-10-13): the app's pack gates, proven on the REAL files (no browser, no API):
 *   P1  helpers.packHasHsn — true for India's pack and for no pack (as before), false for Australia's and the UAE's (reg-au / reg-ae carry no hsn_digits)
 *   P2  myCur's fallback — the pack's money (AUD · AED) when the session has none, INR for India
 *   P3  cap-iddocs draws only what the server lists (GET's catalogue): an AU shop's employee record has no PAN / Aadhaar, no Aadhaar note or consent;
 *       before any GET answered the full list is drawn, as before
 *   P4  STD2 · helpers.packWord / taxIdWord — IN GSTIN·PIN·State · AU ABN·Postcode·State · AE TRN·P.O. Box·Emirate · NO pack → Tax number·Postcode·Region
 *       (never India's); a screen holding the country passes it (cc) instead of writing SESSION.country
 *   P5  STD2 guard · no file under public/ outside app/helpers.js holds a tax-ID word table or a `pack.abn ? 'ABN'` reading (the till reads the server's)
 *   P6  STD2 · register-form reuses csuCountryName · monthNames (helpers.js, T2-WEBPRIMS — CSU_MONTHS is gone) and paints the server's offer; settings keeps the session via CBSignin.keepSession (never over the engine's keep); cap-shop
 *       never writes SESSION.country
 *   node e2e/cx4-pack-words.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (why ? ' — ' + why : '')); } };

function page(country, currency) {
  const ctx = { console, SESSION: { token: 't', country, currency }, CFG: { API_BASE: '' }, document: { getElementById: () => null } };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['engine/tax.js', 'engine/locale.js', 'app/helpers.js', 'app/cap-iddocs.js']) vm.runInContext(fs.readFileSync(path.join(PUB, f), 'utf8'), ctx, { filename: f });
  /* myCur as app.html defines it (the one line, read from the page so this proves the shipped text) */
  const html = fs.readFileSync(path.join(PUB, 'app.html'), 'utf8').replace(/\r\n/g, '\n');
  const fn = html.match(/^function myCur\(\) \{\n[^]*?\n\}/m); /* formatted over three lines since the mechanical pass */
  if (!fn) throw new Error('function myCur() is not in app.html');
  vm.runInContext(fn[0], ctx);
  return ctx;
}

(async () => {
  const IN = page('IN', undefined), AU = page('AU', undefined), AE = page('AE', undefined), NONE = page('', undefined);
  ok('P1 packHasHsn: IN true · AU false · AE false · no pack false (N2: no pack is not assumed to be India)', IN.packHasHsn() === true && AU.packHasHsn() === false && AE.packHasHsn() === false && NONE.packHasHsn() === false);
  ok('P2 myCur with no session money: IN INR · AU AUD · AE AED · no pack null (N1: never a guessed currency)', IN.myCur() === 'INR' && AU.myCur() === 'AUD' && AE.myCur() === 'AED' && NONE.myCur() === null, [IN.myCur(), AU.myCur(), AE.myCur()].join(' '));
  ok('P2 myCur: the session\'s money still wins', page('AU', 'INR').myCur() === 'INR');

  const ID = AU.CBIdDocs;
  const before = ID.html([], 'owner', { noButton: true });
  ok('P3 before a GET answered: the full list, as before (PAN · Aadhaar)', /PAN/.test(before) && /Aadhaar/.test(before));
  AU.fetch = async () => ({ ok: true, json: async () => ({ documents: [], catalogue: [{ scheme: 'PHONE' }, { scheme: 'EMAIL' }] }) });
  await ID.load();
  const owner = ID.html([], 'owner', { noButton: true }), self = ID.html([], 'self', { noButton: true });
  ok('P3 an AU shop (the server lists phone · email): no PAN, no Aadhaar, no consent box', !/PAN|Aadhaar|idoc_consent/.test(owner) && /Mobile/.test(owner) && /Email/.test(owner), owner.slice(0, 200));
  ok('P3 the employee\'s own record: no PAN / Aadhaar either', !/PAN|Aadhaar/.test(self));
  IN.fetch = async () => ({ ok: true, json: async () => ({ documents: [], catalogue: ['PHONE', 'EMAIL', 'PAN', 'VOTER_ID', 'DL', 'AADHAAR'].map((s) => ({ scheme: s })) }) });
  await IN.CBIdDocs.load();
  const inOwner = IN.CBIdDocs.html([], 'owner', { noButton: true });
  ok('P3 an Indian shop: PAN · Aadhaar · the Aadhaar note and consent, as before', /PAN/.test(inOwner) && /never stored/.test(inOwner) && /idoc_consent/.test(inOwner));

  /* P4 — the pack's words, and neutral words with no pack (STD2) */
  const words = (c) => ['taxId', 'postcode', 'region'].map((k) => c.packWord(k)).join('·');
  ok('P4 packWord: IN GSTIN·PIN·State · AU ABN·Postcode·State · AE TRN·P.O. Box·Emirate', words(IN) === 'GSTIN·PIN·State' && words(AU) === 'ABN·Postcode·State' && words(AE) === 'TRN·P.O. Box·Emirate', [words(IN), words(AU), words(AE)].join(' | '));
  ok('P4 no pack → neutral words, never India\'s: Tax number·Postcode·Region (and a country with no pack: ZZ); US has a pack now and says its own words (EIN·ZIP code·State)', words(NONE) === 'Tax number·Postcode·Region' && words(page('ZZ')) === 'Tax number·Postcode·Region' && words(page('US')) === 'EIN·ZIP code·State', words(NONE));
  ok('P4 a screen passes the country it holds: taxIdWord(\'AU\') on a page whose session names none → ABN; packSplitsByState(\'AU\') false', NONE.taxIdWord('AU') === 'ABN' && NONE.packSplitsByState('AU') === false && NONE.taxIdWord() === 'Tax number');

  /* P5 — the guard: one tax-ID word table on the web (helpers.js PACK_WORDS) */
  const blank = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1').replace(/<!--[\s\S]*?-->/g, ' ');
  const TABLE = [/\.(abn|trn)\s*\?\s*\[?\s*['"](an? )?(ABN|TRN|GSTIN)['"]/, /\b(IN|AU|AE)\s*:\s*['"](GSTIN|ABN|TRN)['"]/];
  const all = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, f.name);
    if (f.isDirectory()) { if (!/^(engine|vendor|node_modules)$/.test(f.name)) walk(q); } else if (/\.(js|html)$/.test(f.name)) all.push(q); } })(PUB);
  const tables = all.filter((f) => path.relative(PUB, f).replace(/\\/g, '/') !== 'app/helpers.js' && !/^app\/(tax|locale|regulation)[^/]*\.js$/.test(path.relative(PUB, f).replace(/\\/g, '/')))
    .filter((f) => TABLE.some((re) => re.test(blank(fs.readFileSync(f, 'utf8'))))).map((f) => path.relative(PUB, f));
  ok('P5 no tax-ID word table outside app/helpers.js (cap-shop\'s CBLocale table, cap-books\' and the till\'s copies gone)', tables.length === 0, tables.join(' · '));

  /* P6 — the register panel paints, the session is kept by its one writer */
  const src = (f) => blank(fs.readFileSync(path.join(PUB, f), 'utf8'));
  const rf = src('app/register-form.js');
  ok('P6 register-form: no regZoneFor / regSourceOf / own months / RTL list / .in address / dev copy; reads csuCountryName · monthNames · countries[].offer',
    !/regZoneFor|regSourceOf|'January','February'|\(ar\|ur\|fa\|he\)|@business\.in|check endpoint/.test(rf) && /csuCountryName\(/.test(rf) && /monthNames\('long'\)\[/.test(rf) && /pk\.offer/.test(rf) && /query:\s*\{\s*tz:\s*tz\s*\}/.test(rf) /* spaced since the mechanical pass */);
  ok('P6 settings.html registered() keeps the session through CBSignin.keepSession (with duty); signin-ui exports it WITHOUT replacing the engine\'s keep (the counter\'s)', /CBSignin\.keepSession\(\{\}, CBSignin\.sessionOf\(r\)\)/.test(src('settings.html')) && !/setItem\('cb_sess'/.test(src('settings.html')) && /E\.keepSession = keep;/.test(src('app/signin-ui.js')) && !/E\.keep = /.test(src('app/signin-ui.js')));
  ok('P6 cap-shop never writes the global SESSION.country', !/SESSION\.country\s*=/.test(src('app/cap-shop.js')));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
