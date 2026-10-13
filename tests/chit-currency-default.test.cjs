/**
 * chit-currency-default.test.cjs — ⭐ A CHIT WITH NO CURRENCY IS IN THE SENDER'S MONEY, AND THE LEDGER OPENS ON THE COUNTRY SETUP (WX-R2R, 2026-10-13).
 *
 * Found walking R2R on a real stack with the three-year AU shop (tools/sim-load.cjs --country AU): the counter sends no currency, so
 * routes/chits.js minted every AU bill as INR; lib/books-hooks then refused each one ("an entry in INR needs its rate to AUD") and
 * 1,683 bills and day roll-ups sat in books_outbox — no sale ever reached the ledger. And lib/books.enable() opened that shop's
 * ledger in INR on an April year although its Country setup said AUD and July, so every AUD purchase was refused for an fx rate.
 *
 * Offline; no database. Fails when:
 *   1. routes/chits.js goes back to `|| 'INR'` for a chit that names no currency — it must read the sender's identities.currency_code
 *      (on the self-copy row it already reads: one query, not two) and fall back to lib/regional.currencyFor, the one resolver;
 *   2. lib/books.enable() stops reading the Country setup (lib/country-setup.profile) for country · currency · year start;
 *   3. enable() takes the year from the UTC date instead of the shop's day (books-hooks.dayOf);
 *   4. lib/books-hooks COUNTRY_ZONE loses AU (an AU day closed on India's clock);
 *   6. GET /api/books/health stops naming the shop's year (the web would go back to assuming April);
 *   5. books-hooks.byRateOf stops reading an AU line's TaxAmt as the scheme's one head `gst` (every AU bill queued as "a non-GST tax").
 * Run: node tests/chit-currency-default.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

console.log('\n══ a chit is in the sender\'s money · the ledger opens on the Country setup ══\n');

const chits = read('routes/chits.js');
ok('routes/chits.js no longer defaults a chit\'s currency to INR at the door', !/const currency_code = \(business_json && business_json\.currency\) \|\| 'INR'/.test(chits));
ok('…the sender\'s row the self-copy read already fetches carries currency_code (one query)', /SELECT self_copy_pref, currency_code FROM identities WHERE identity_id = \$1/.test(chits));
ok('…and a row without one asks lib/regional.currencyFor (the one resolver), never a literal', /currency_code = String\(currency_code \|\| \(prefRow\.rows\[0\] && prefRow\.rows\[0\]\.currency_code\) \|\| await require\('\.\.\/lib\/regional'\)\.currencyFor\(sender_id\)\)\.toUpperCase\(\)/.test(chits));
ok('…decided before the invoice is computed and the money block is written', chits.indexOf('currency_code = String(currency_code ||') < chits.indexOf('currency: currency_code, at: invAt'));

const books = read('lib/books.js');
ok('lib/books.enable() reads the Country setup (lib/country-setup.profile)', /const cs = await CS\.profile\(h, entity, \{ constitution: false \}\)/.test(books) && /const CS = require\('\.\/country-setup'\)/.test(books));
/* INT5b: main's CX0 order kept — the caller's, then a ledger already open (its country is fixed), then the setup's */
ok('…the country comes from the setup when the caller names none', /o\.country \|\| \(cur && cur\.country\) \|\| \(cs\.country && cs\.country\.code\) \|\| 'IN'/.test(books));
/* INT5b: the year is the pack's before a stored month (CS2 — a stored month may be the old country's); the money is this country's setup's before the pack's */
ok('…and the money is the setup\'s before the pack\'s; the year the pack\'s (CS2)', /fy_start_month: Number\(o\.fy_start_month\) \|\| pack0\.fy_start_month \|\| Number\(own\.fy_start_month\)/.test(books) && /currency: o\.currency \|\| own\.currency \|\| pack0\.currency/.test(books));
ok('…the opening year is the SHOP\'s day (books-hooks.dayOf), not the UTC date', /fiscalYearOf\(o\.today \|\| require\('\.\/books-hooks'\)\.dayOf\(CLOCK\.now\(\), \{ country, timezone: cs && cs\.timezone \}\), pack\)/.test(books) && !/fiscalYearOf\(o\.today \|\| CLOCK\.now\(\)\.toISOString\(\)/.test(books));
ok('…the setting saved is the merged pack\'s (fy_start_month · functional_currency)', /fy_start_month: pack\.fy_start_month,\n\s*functional_currency: pack\.currency, country/.test(books));

const hooks = read('lib/books-hooks.js');
ok('lib/books-hooks COUNTRY_ZONE names AU (Australia/Sydney)', /AU: 'Australia\/Sydney'/.test(hooks));
const Z = require(path.join(ROOT, 'lib', 'books-hooks'));
ok('zoneOf(\'AU\') answers Australia/Sydney, not India\'s clock', Z.zoneOf('AU') === 'Australia/Sydney');

/* 5 · an AU bill's GST (engines v1.34 freezes it as the line's TaxAmt, _cb.scheme 'GST') is the AU pack's ONE head `gst`, never "a non-GST tax" —
   found on this runner after main's v1.34 adopt: all 3,256 AU bills sat in books_outbox. A real invoice from the one tax path (tax-lines.invoiceFor). */
const TL = require(path.join(ROOT, 'lib', 'tax-lines'));
const au = TL.invoiceFor({ lines: [{ particulars: 'Milk', quantity: 1, price: 110, total: 110, gst_rate: 10 }], seller: { Country: 'AU', LglNm: 'AU Shop' }, buyer: { Country: 'AU' },
  currency: 'AUD', priceIncludesTax: true }).invoice;
const br = Z.byRateOf(au);
ok('byRateOf(AU invoice) puts the line\'s TaxAmt on the scheme\'s head `gst` (10.00 on 100.00), nothing left as "other"', br.other === 0 && br.rows.length === 1 && br.rows[0].gst === 10 && br.rows[0].taxable === 100 && br.total === 110,
  JSON.stringify(br));
const k = Z.classify({ chit: { chit_id: 'au1', purpose: 'order', currency_code: 'AUD', business_json: { bill_no: 'C1/26-27/0001', till: { id: 'C1' }, billed_at: '2026-07-02T01:00:00Z',
  payment: { parts: [{ how: 'Cash', amount: 110 }] } } }, entry: { sells: true, invoice: au }, setting: { enabled: true, walkin_grain: 'bill', country: 'AU', functional_currency: 'AUD' } });
/* the api's adopted accounts-packs (v1.20.0) opens an AU ledger on India's chart: posting would DROP the gst head and still balance — so it waits, in words */
const auPackCountry = require(path.join(ROOT, 'lib', 'books')).packOf({ country: 'AU' }).country;
if (auPackCountry === 'AU') ok('…and the AU counter bill posts with by_rate[10].gst = 10 (the books are on the AU pack)', k.kind === 'post' && k.event && k.event.by_rate && k.event.by_rate[0].gst === 10, JSON.stringify(k).slice(0, 200));
else ok('…and while AU books open on India\'s chart (accounts-packs v1.20 fallback), the AU bill WAITS — its GST is never dropped', k.kind === 'queue' && /GST \(10\) but these books were opened on a chart with no GST ledger/.test(k.why), JSON.stringify(k).slice(0, 220));
const inr = Z.byRateOf({ ItemList: [{ GstRt: 18, AssAmt: 100, CgstAmt: 9, SgstAmt: 9, IgstAmt: 0, CesAmt: 0 }] });
ok('…an India slab keeps its shape (no `gst` key, total 118)', !('gst' in inr.rows[0]) && inr.total === 118 && inr.other === 0);
const bare = Z.byRateOf({ ItemList: [{ GstRt: 0, AssAmt: 100, TaxAmt: 5 }] });
ok('…a TaxAmt on an invoice that names no scheme is still "other" (queued, never guessed)', bare.other === 5);

/* 6 · GET /api/books/health names the shop's year (the web paints it — an AU July year was asked as April and the P&L refused) */
const routes = read('routes/books.js');
ok('GET /books/health answers year { fiscal_year, from, start_month } from the setting\'s pack (fyStart — the reads\' own default)',
  /year: \{ fiscal_year: fy, from: fyStart\(req, today\(\)\), start_month: Number\(pack\.fy_start_month\) \|\| null \}/.test(routes) && /const pack = B\.packOf\(req\.books\), A = E\.packs\(\), fy = A\.fiscalYearOf\(today\(\), pack\)/.test(routes));
const AP = require(path.join(ROOT, 'lib', 'books-engines')).packs(), BK = require(path.join(ROOT, 'lib', 'books'));
const auPack = BK.packOf({ country: 'AU', fy_start_month: 7 });
ok('…an AU shop on 13 Oct 2026 is in 2026-27, from 1 July', AP.fiscalYearOf('2026-10-13', auPack) === '2026-27' && AP.fyRange('2026-27', auPack).start === '2026-07-01');

console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
