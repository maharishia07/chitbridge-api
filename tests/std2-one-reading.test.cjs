'use strict';
/**
 * tests/std2-one-reading.test.cjs · STD2 (standards review 14 Oct) — ONE READING PER FACT, NO INDIA FOR AN UNSTATED COUNTRY.
 *   T  profile.taxIdWordOf is the one tax-ID reader: IN GSTIN · AU ABN · AE TRN · no pack null; countries()[].tax.id is its answer
 *   G  guard: no file outside lib/profile.js (api) or public/app/helpers.js (web) holds a tax-ID word table or a `pack.abn ?` reading
 *   O  country-setup.offered: each country row carries the zone the server WILL store and the source it WILL record (offerOf + sourceOf)
 *   S  tax-lines.splitsByState / stateUnder: the pack's supply rule, no literal 'IN' in the till's supplier list
 *   M  money: books-store.saveSetting refuses an unstated money/year with the ONE sentence (NO_MONEY); no `|| 'INR'` / `|| 4` left in the briefed writers
 *   W  "this ChitBridge runs in" is typed once (country-setup.RUNS_IN)
 * Offline: no database (stubbed handle), no network.
 */
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..'), WEB = path.join(API, '..', 'chitbridge-web');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  FAIL ' + what + (saw ? '\n      saw: ' + saw : '')); } };
/** comments blanked before scanning — guards in this repo have fired on their own prose */
const blank = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:\\])\/\/[^\n]*/g, (m) => m[0] + m.slice(1).replace(/[^\n]/g, ' '))
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
const read = (f) => blank(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
const walk = (dir, re, out) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name);
  if (f.isDirectory()) { if (f.name !== 'node_modules' && f.name !== 'vendor') walk(p, re, out); } else if (re.test(f.name)) out.push(p); } return out; };

(async () => {
  console.log('\n══ STD2 · one reading per fact ══\n');
  const P = require(path.join(API, 'lib', 'profile')), CS = require(path.join(API, 'lib', 'country-setup'));

  ok('T1 taxIdWordOf: IN GSTIN · AU ABN · AE TRN (code or pack)', P.taxIdWordOf('IN') === 'GSTIN' && P.taxIdWordOf('au') === 'ABN' && P.taxIdWordOf('AE') === 'TRN'
    && P.taxIdWordOf(require(path.join(API, 'lib', 'regulation')).packFor('AU')) === 'ABN');
  ok('T2 taxIdWordOf: no pack → null (never GSTIN): "" · null · US · ZZ', [ '', null, undefined, 'US', 'ZZ' ].every((c) => P.taxIdWordOf(c) === null));
  ok('T3 countries()[].tax.id IS taxIdWordOf (country-setup.taxIdOf is gone)', typeof CS.taxIdOf === 'undefined'
    && CS.countries().every((c) => c.tax.id === P.taxIdWordOf(c.code)), JSON.stringify(CS.countries().map((c) => [c.code, c.tax.id])));

  /* G — the guard: a tax-ID word TABLE (a country code or a pack key mapped to GSTIN/ABN/TRN) or a `x.abn ? 'ABN'` reading, outside the one helper */
  const TABLE = [/\.(abn|trn)\s*\?\s*\[?\s*['"](an? )?(ABN|TRN|GSTIN)['"]/, /\b(IN|AU|AE)\s*:\s*['"](GSTIN|ABN|TRN)['"]/];
  const hits = (files) => files
    .map((f) => { const src = read(f); const n = TABLE.findIndex((re) => re.test(src)); return n < 0 ? null : path.relative(path.join(API, '..'), f) + ' (' + TABLE[n] + ')'; }).filter(Boolean);
  const apiFiles = walk(path.join(API, 'lib'), /\.(c?js)$/, []).concat(walk(path.join(API, 'routes'), /\.(c?js)$/, []), [path.join(API, 'tools', 'tally-connector', 'till.html')])
    .filter((f) => f !== path.join(API, 'lib', 'profile.js') && !/\.browser\.js$/.test(f));
  const apiHits = hits(apiFiles);
  ok('G1 api: no tax-ID word table outside lib/profile.js taxIdWordOf (lib · routes · the till master)', apiHits.length === 0, apiHits.join(' · '));
  if (fs.existsSync(path.join(WEB, 'public'))) {
    const webFiles = walk(path.join(WEB, 'public'), /\.(js|html)$/, []).filter((f) => f !== path.join(WEB, 'public', 'app', 'helpers.js')
      && !/[\\/]public[\\/](engine|vendor)[\\/]/.test(f) && !/[\\/]app[\\/](tax|locale|regulation)[^\\/]*\.js$/.test(f));
    const webHits = hits(webFiles);
    ok('G2 web: no tax-ID word table outside public/app/helpers.js (PACK_WORDS) — the till reads the server\'s shop.tax_id_word', webHits.length === 0, webHits.join(' · '));
  } else ok('G2 web: checkout not beside the api — skipped (say so)', true);

  /* O — the offer the register panel paints */
  const at = { installation: { country: 'AU' }, timezone: 'Australia/Sydney', countries: CS.countries() };
  const rows = CS.offered(at, 'Australia/Perth'), au = rows.find((c) => c.code === 'AU'), ae = rows.find((c) => c.code === 'AE'), inn = rows.find((c) => c.code === 'IN');
  ok('O1 AU spin, a Perth device: AU offers Australia/Perth "your device clock", source installation', au.offer.timezone === 'Australia/Perth' && au.offer.from === 'your device clock' && au.offer.source === 'installation', JSON.stringify(au.offer));
  ok('O2 …AE (one zone) offers Asia/Dubai "the United Arab Emirates pack" (or its name), source chosen', ae.offer.timezone === 'Asia/Dubai' && /pack$/.test(ae.offer.from) && ae.offer.source === 'chosen', JSON.stringify(ae.offer));
  ok('O3 …IN offers Asia/Kolkata, source chosen', inn.offer.timezone === 'Asia/Kolkata' && inn.offer.source === 'chosen', JSON.stringify(inn.offer));
  const r2 = CS.offered(at, 'Not/AZone'), au2 = r2.find((c) => c.code === 'AU'), ae2 = CS.offered(at, 'Asia/Dubai').find((c) => c.code === 'AE');
  ok('O4 an unknown zone counts as none: AU falls back to the installation\'s Australia/Sydney', au2.offer.timezone === 'Australia/Sydney' && au2.offer.source === 'installation', JSON.stringify(au2.offer));
  ok('O5 a Dubai device on an AU spin: AE\'s source is browser (the device zone\'s country) — the same rule verify records', ae2.offer.source === 'browser' && CS.sourceOf('AE', at, 'Asia/Dubai') === 'browser');
  ok('O6 no zone sent: offered() still answers each row (the page paints "you pick it" for a several-zone country with no installation zone)',
    CS.offered({ installation: { country: null }, timezone: null, countries: CS.countries() }, undefined).find((c) => c.code === 'AU').offer.timezone === null);

  /* S — the pack's supply rule */
  const T = require(path.join(API, 'lib', 'tax-lines'));
  ok('S1 splitsByState: IN true · AU false · AE false · none true (as the till always read it)', T.splitsByState('IN') && !T.splitsByState('AU') && !T.splitsByState('AE') && T.splitsByState(null));
  ok('S2 stateUnder: a GSTIN\'s state under IN; an ABN\'s first digits are not a state under AU', T.stateUnder('33AAPFU0939F1ZV', 'IN') === '33' && T.stateUnder('51824753556', 'AU') === null);
  const till = read(path.join(API, 'routes', 'till.js'));
  ok('S3 routes/till.js: the supplier list asks stateUnder — no `=== \'IN\'` beside a GSTIN slice', !/toUpperCase\(\)\s*===\s*'IN'\)\)\s*o\.state/.test(till) && /stateUnder\(g, x\.country \|\| row\.country\)/.test(till));
  ok('S4 the snapshot sends shop.tax_id_word from profile.taxIdWordOf and money_why from MONEY_UNSTATED', /tax_id_word: cbProfile\.taxIdWordOf\(cbCountry\)/.test(till) && /MONEY_UNSTATED/.test(till));

  /* M — money and year are stated, or asked for in ONE sentence */
  const S = require(path.join(API, 'lib', 'books-store'));
  let sent = 0, refused = null;
  const db = { query: async () => { sent++; return { rows: [] }; } };
  try { await S.saveSetting(db, 'e1', { enabled: true, country: 'XX' }); } catch (e) { refused = e; }
  ok('M1 saveSetting with no money / year → refused NO_MONEY in the one sentence, nothing written', refused && refused.code === 'NO_MONEY' && refused.message === CS.MONEY_UNSTATED && sent === 0, refused && refused.message);
  await S.saveSetting(db, 'e1', { enabled: true, country: 'AU', fy_start_month: 7, functional_currency: 'AUD' });
  ok('M2 …stated → written', sent === 1);
  const src = (rel) => read(path.join(API, rel));
  ok('M3 no `|| \'INR\'` / `fy_start_month || 4` in books-store · network-design · profile.invoiceParty · till /snapshot shop.currency',
    !/\|\|\s*'INR'/.test(src('lib/books-store.js')) && !/fy_start_month \|\| 4/.test(src('lib/books-store.js')) && !/meRow\.currency_code \|\| 'INR'/.test(src('routes/network-design.js'))
    && !/currency: me\.currency_code \|\| \(pack && pack\.currency\) \|\| 'INR'/.test(src('lib/profile.js')) && !/\.currency\) \|\| 'INR'/.test(till));
  ok('M4 the sentence is typed once: books.enable and till read country-setup.MONEY_UNSTATED',
    /throw refuse\(CS\.MONEY_UNSTATED, 'NO_MONEY'\)/.test(src('lib/books.js')) && walk(path.join(API, 'lib'), /\.js$/, []).concat(walk(path.join(API, 'routes'), /\.js$/, []))
      .filter((f) => /month its year starts \(Country setup\)/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f)).join() === 'country-setup.js');
  const mig = fs.readFileSync(path.join(API, 'migrations', 'b400_currency_no_default.sql'), 'utf8');
  ok('M5 b400 drops identities.currency_code DEFAULT (and cb_entity\'s when it is a table); schema.sql has no INR default on identities',
    /ALTER TABLE identities ALTER COLUMN currency_code DROP DEFAULT/.test(mig) && /RLS:/.test(mig) && !/currency_code\s+VARCHAR\(3\) DEFAULT 'INR',\n\s+identity_type/.test(fs.readFileSync(path.join(API, 'db', 'schema.sql'), 'utf8')));

  /* W — the words typed once */
  const runsIn = walk(path.join(API, 'lib'), /\.js$/, []).concat(walk(path.join(API, 'routes'), /\.js$/, [])).filter((f) => /['"`]this ChitBridge runs in /.test(fs.readFileSync(f, 'utf8')));
  ok('W1 "this ChitBridge runs in " is typed once (country-setup.RUNS_IN)', runsIn.length === 1 && path.basename(runsIn[0]) === 'country-setup.js' && CS.RUNS_IN('Australia') === 'this ChitBridge runs in Australia', runsIn.join());

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
