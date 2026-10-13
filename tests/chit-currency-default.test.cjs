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
 *   4. lib/books-hooks COUNTRY_ZONE loses AU (an AU day closed on India's clock).
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
ok('lib/books.enable() reads the Country setup (lib/country-setup.profile)', /const cs = await CS\.profile\(h, entity\)\.catch\(\(\) => null\)/.test(books) && /const CS = require\('\.\/country-setup'\)/.test(books));
ok('…the country comes from the setup when the caller names none', /o\.country \|\| \(cs && cs\.country && cs\.country\.code\) \|\| \(cur && cur\.country\) \|\| 'IN'/.test(books));
ok('…and the year start and the money are the setup\'s before the pack\'s', /fy_start_month: Number\(o\.fy_start_month \|\| \(cs && cs\.fy_start_month\) \|\| pack0\.fy_start_month\)/.test(books) && /currency: String\(o\.currency \|\| \(cs && cs\.currency\) \|\| pack0\.currency\)\.toUpperCase\(\)/.test(books));
ok('…the opening year is the SHOP\'s day (books-hooks.dayOf), not the UTC date', /fiscalYearOf\(o\.today \|\| require\('\.\/books-hooks'\)\.dayOf\(CLOCK\.now\(\), \{ country, timezone: cs && cs\.timezone \}\), pack\)/.test(books) && !/fiscalYearOf\(o\.today \|\| CLOCK\.now\(\)\.toISOString\(\)/.test(books));
ok('…the setting saved is the merged pack\'s (fy_start_month · functional_currency)', /fy_start_month: pack\.fy_start_month,\n\s*functional_currency: pack\.currency, country/.test(books));

const hooks = read('lib/books-hooks.js');
ok('lib/books-hooks COUNTRY_ZONE names AU (Australia/Sydney)', /AU: 'Australia\/Sydney'/.test(hooks));
const Z = require(path.join(ROOT, 'lib', 'books-hooks'));
ok('zoneOf(\'AU\') answers Australia/Sydney, not India\'s clock', Z.zoneOf('AU') === 'Australia/Sydney');

console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
