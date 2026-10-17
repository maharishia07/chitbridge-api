/**
 * neutral-core.test.cjs — NEUTRAL CORE (2026-10-17): a record states its own country, currency, zone; a reader that finds none says so.
 * N0: a shop with no country or no money issues no document (documentGate — NO_COUNTRY / NO_MONEY, one sentence); an India shop is unchanged.
 * Run: node tests/neutral-core.test.cjs   (no database, no network)
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const CS = require(path.join(API, 'lib/country-setup'));
const readOf = (row) => async () => ({ rows: row ? [row] : [] });

(async () => {
  const none = await CS.documentGate(readOf({ country: null, currency_code: 'INR' }), 'e1');
  ok('no country → refused 422 NO_COUNTRY with the one sentence', none && none.status === 422 && none.code === 'NO_COUNTRY' && none.message === CS.DOC_UNSTATED);
  const blank = await CS.documentGate(readOf({ country: '  ', currency_code: 'INR' }), 'e1');
  ok('a blank country is no country', blank && blank.code === 'NO_COUNTRY');
  const nomoney = await CS.documentGate(readOf({ country: 'ZZ', currency_code: null }), 'e1');
  ok('a country with no pack and no currency → NO_MONEY', nomoney && nomoney.code === 'NO_MONEY' && nomoney.message === CS.DOC_UNSTATED);
  ok('India with its own currency passes unchanged', (await CS.documentGate(readOf({ country: 'IN', currency_code: 'INR' }), 'e1')) === null);
  ok('India with no stored currency passes on the pack\u2019s own money (an India shop is unchanged)', (await CS.documentGate(readOf({ country: 'IN', currency_code: null }), 'e1')) === null);
  ok('Australia passes', (await CS.documentGate(readOf({ country: 'AU', currency_code: 'AUD' }), 'e1')) === null);
  ok('a read that throws leaves the gate open (a blip is no evidence)', (await CS.documentGate(async () => { throw new Error('db down'); }, 'e1')) === null);
  ok('the sentence says where to set it', /Country setup/.test(CS.DOC_UNSTATED));
  const kept = CS.clean({ country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false }, source: { country: 'backfill b299 (today’s facts)', currency: 'typed' } });
  ok('saving an assumed (b299) country is the one-tap confirm: its source stops saying backfill', kept.source.country === 'confirmed by the owner' && kept.source.currency === 'typed');
  const src = require('fs').readFileSync(path.join(API, 'routes/chits.js'), 'utf8');
  ok('the send route asks the gate right after the sender is known, and lets a draft through', /sendSender, sendMoneyStated,/.test(src) && /if \(req\.body\.is_draft\) return false;\s*\n\s*const refusal/.test(src));
const fs = require('fs');
  /* ── N1: one reader per fact returns null + a reason, never India ── */
  const regional = require(path.join(API, 'lib/regional'));
  const unread = await regional.currencyRead(null);
  ok('N1: regional.currencyRead(no entity) -> null + the one sentence, not INR', unread.code === null && unread.why === CS.MONEY_UNSTATED && regional.FALLBACK_CURRENCY === undefined);
  ok('N1: regional.currencyFor with nothing readable -> null', (await regional.currencyFor('00000000-0000-4000-8000-000000000000')) === null);
  const gov = require(path.join(API, 'lib/tax-governance'));
  ok('N1: tax-governance: no country -> no jurisdiction whatever the currency (was INR/empty -> IN)', gov.jurisdictionOf({ country: null, currency_code: 'INR' }) === null && gov.jurisdictionOf({ country: null, currency_code: null }) === null);
  ok('N1: tax-governance: a stated country is still its own (India unchanged)', gov.jurisdictionOf({ country: 'in' }) === 'IN' && gov.jurisdictionOf({ country: 'AE' }) === 'AE');
  ok('N1: tax-governance: no country -> the sentence, not silence', /country/i.test(gov.NO_COUNTRY_SLABS_SAY) && /Country setup/.test(gov.NO_COUNTRY_SLABS_SAY));


/* ── N1 · THE RATCHET: no NEW 'INR' / ₹ / Asia/Kolkata / en-IN literal outside an India-pack path ─────────────────────────────────────────
   Athi, 2026-10-17: "a record states its own country/currency/zone/language; a reader that finds none says so - never guesses India."
   Every code literal of those four (comments stripped) in lib/ routes/ middleware/ is counted. A file NOT in ALLOW may hold none; a file in ALLOW
   may hold at most the count below, with its reason (the ceiling only ever goes DOWN). Adopted engine copies (engines.lock.json, or a file that
   says "ADOPTED ... DO NOT EDIT" in its first lines) are the engines' own and are not read here. */
const ALLOW = {
  'lib/bill-privacy.js': [4, 'money(): the rupee branch (INR -> the rupee sign and en-IN grouping); every other currency reads its own code'],
  'lib/books-hooks.js': [2, 'oneUnit() names "a rupee" for INR only; COUNTRY_ZONE maps a country CODE to its zone (IN is one row of eight)'],
  'lib/csv-preflight.js': [2, 'the amount cleaner strips every currency mark (rupee, dollar, euro, pound, yen) from an imported cell'],
  'lib/dev-otp.js': [2, 'the daily TESTER code follows India\'s clock (TESTER_CODE_TZ) - a developer tool, not a shop record'],
  'lib/parallel-run.js': [1, 'the GSTR-3B parallel run prints India\'s return in rupees'],
  'lib/points.js': [1, 'the points line groups with the caller\'s locale, en-IN only when the caller passed none - N3 backlog'],
  'lib/tax-governance.js': [2, 'an INR sub-region (TN, HI) with no tax block inherits India\'s GST slabs - an IN-only branch'],
  'routes/chits.js': [2, 'N3 pending in this run: the subject date locale (line 187) and the day-filter zone (line 2076)'],
  'routes/catalogue.js': [1, 'N3 pending in this run: the storefront order\'s subject date locale'],
  'routes/connectors.js': [1, 'the connector SAMPLE document (a test payload: amount random, currency named)'],
  'routes/products.js': [1, 'dropForeignListPrices: the starter lists\' figures ARE rupees - kept for a rupee shop only; an IN-only branch'],
  'routes/relationships.js': [2, 'offerMoney(): the rupee branch for a rupee supplier; every other currency reads its own code'],
};
const API_LITERAL = /'INR'|"INR"|`INR`|₹|Asia\/Kolkata|en-IN/g;
function stripComments(text) { return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' ')).replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1'); }
function adoptedFiles() {
  const names = new Set();
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'engines.lock.json'), 'utf8'));
  (function walk(node) { if (typeof node === 'string') { if (/^(lib|routes)\/.*\.js$/.test(node)) names.add(node); } else if (node && typeof node === 'object') Object.values(node).forEach(walk); })(lock);
  return names;
}
function sourceFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!/node_modules|vendor/.test(entry.name)) sourceFiles(full, out); } else if (/\.(js|cjs|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const adopted = adoptedFiles();
const found = {};
for (const dir of ['lib', 'routes', 'middleware']) {
  for (const full of sourceFiles(path.join(__dirname, '..', dir), [])) {
    const rel = path.relative(path.join(__dirname, '..'), full).split(path.sep).join('/');
    const raw = fs.readFileSync(full, 'utf8');
    if (adopted.has(rel) || /ADOPTED from|DO NOT EDIT/.test(raw.slice(0, 400))) continue;
    const hits = (stripComments(raw).match(API_LITERAL) || []).length;
    if (hits) found[rel] = hits;
  }
}
for (const rel of Object.keys(found)) {
  const entry = ALLOW[rel];
  if (!entry) ok('N1: ' + rel + ' guesses India (' + found[rel] + ' literal(s)) - read lib/regional.currencyRead, the shop zone, or the pack; or add it to ALLOW with its reason', false);
  else if (found[rel] > entry[0]) ok('N1: ' + rel + ' holds ' + found[rel] + ' India literals, ceiling ' + entry[0] + ' - a NEW one landed', false);
}
const allowedTotal = Object.keys(found).reduce((sum, rel) => sum + (ALLOW[rel] ? found[rel] : 0), 0);
ok('N1: no new India literal - ' + allowedTotal + ' allowed literal(s) in ' + Object.keys(found).length + ' files, each with its reason', !Object.keys(found).some((rel) => !ALLOW[rel] || found[rel] > ALLOW[rel][0]));
for (const rel of Object.keys(ALLOW)) if (!found[rel]) console.log('   note ' + rel + ' holds no India literal any more - drop it from ALLOW');
for (const rel of Object.keys(found)) if (ALLOW[rel] && found[rel] < ALLOW[rel][0]) console.log('   note ' + rel + ' is down to ' + found[rel] + ' (ceiling ' + ALLOW[rel][0] + ') - lower the ceiling');
console.log('   guard allow-list: ' + allowedTotal + ' literal(s) in ' + Object.keys(found).length + ' files');

  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
