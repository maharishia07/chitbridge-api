/**
 * books-country.test.cjs — THE BOOKS SPEAK THE SHOP'S COUNTRY: IN · AU · AE (CX2, 2026-10-13). PURE, NO DATABASE.
 *
 * A1 the books core (posting · ledger · bookpack · period) is adopted at the version that reads the pack (≥ v1.42), not v1.20's India-typed code ·
 * A3 the ledger's money is the setting's, else the pack's — never 'INR' typed · A6 an AU shop with no saved zone is cut at its pack's zone, never at
 * IST midnight · A5 the depreciation note names the pack's own entity and basis · AE's calendar year '2026' is a year the books accept.
 * India's answers are the ones it gave before (the IN rows below).
 *
 * Run: node tests/books-country.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (got !== undefined ? ' — got ' + JSON.stringify(got) : '')); } };

const B = require(path.join(API, 'lib/books'));
const E = require(path.join(API, 'lib/books-engines'));
const H = require(path.join(API, 'lib/books-hooks'));

/* A1 — the books core is a pack reader */
for (const f of ['posting', 'ledger', 'bookpack', 'period']) {
  const v = (/ADOPTED from chitbridge-engines v(\d+)\.(\d+)/.exec(fs.readFileSync(path.join(API, 'lib', f + '.js'), 'utf8')) || []).slice(1).map(Number);
  ok('A1 ' + f + ' is adopted at ≥ v1.42 (reads the pack, not India typed)', v[0] > 1 || (v[0] === 1 && v[1] >= 42), v.join('.'));
}
for (const [c, ret, fy, cur] of [['IN', undefined, 4, 'INR'], ['AU', 'BAS', 7, 'AUD'], ['AE', 'VAT201', 1, 'AED']]) {
  const p = B.packOf({ country: c });
  ok(c + ' · packOf is its own pack (no fallback)', p.id === c && !p.fallback, p.id);
  ok(c + ' · its return is ' + (ret || 'read from the rail'), (p.returns && p.returns.id) === ret, p.returns && p.returns.id);
  ok(c + ' · its year starts in month ' + fy, p.fy_start_month === fy, p.fy_start_month);
  ok('A3 ' + c + ' · curOf with no saved money = the pack\'s ' + cur, B.curOf({ country: c }) === cur, B.curOf({ country: c }));
}
ok('A3 · a saved money wins over the pack', B.curOf({ country: 'AU', functional_currency: 'USD' }) === 'USD');

/* A6 — the day cut */
ok('A6 IN · Asia/Kolkata (unchanged)', H.zoneOf('IN') === 'Asia/Kolkata', H.zoneOf('IN'));
ok('A6 AE · Asia/Dubai', H.zoneOf('AE') === 'Asia/Dubai', H.zoneOf('AE'));
ok('A6 AU · the pack\'s first zone, never Kolkata', H.zoneOf('AU') === 'Australia/Sydney', H.zoneOf('AU'));
ok('A6 · a saved zone still wins', H.zoneOf({ timezone: 'Australia/Perth', country: 'AU' }) === 'Australia/Perth');
ok('A6 · a country with no pack keeps the b176 table', H.zoneOf('SG') === 'Asia/Singapore' && H.zoneOf('') === 'UTC');   /* T2-NATDEF: unstated → UTC, never India */
/* 2026-01-15T14:30Z is 01:30 on the 16th in Sydney (AEDT), 20:00 on the 15th in India */
ok('A6 AU · a sale at 01:30 Sydney lands on Sydney\'s day', H.dayOf('2026-01-15T14:30:00Z', { country: 'AU' }) === '2026-01-16', H.dayOf('2026-01-15T14:30:00Z', { country: 'AU' }));
ok('A6 IN · the same moment is India\'s 15th', H.dayOf('2026-01-15T14:30:00Z', { country: 'IN' }) === '2026-01-15');

/* AE's year label and A5's basis — through the pack, no database: the refusals run before any read */
const P = require(path.join(API, 'lib/books-period'));
(async () => {
  const why = async (s, b) => { try { await P.runDepreciation('e1', s, b, null); return null; } catch (e) { return e.message; } };
  ok('IN · a malformed year is asked in India\'s words (unchanged)', await why({ country: 'IN' }, { fy: '2026' }) === 'Which financial year? e.g. 2026-27.', await why({ country: 'IN' }, { fy: '2026' }));
  ok('AE · its year is asked as the calendar year', await why({ country: 'AE' }, { fy: '2026-27' }) === 'Which financial year? e.g. 2026.', await why({ country: 'AE' }, { fy: '2026-27' }));
  const src = fs.readFileSync(path.join(API, 'lib/books-period.js'), 'utf8');
  ok('A5 · the default entity comes from the pack\'s entity_bases', /Object\.keys\(bases\)\.find\(\((\w+)\) => \1 !== 'company'\)/.test(src));
  for (const [c, first] of [['IN', 'proprietor'], ['AU', 'sole_trader'], ['AE', 'sole_establishment']]) {
    const k = Object.keys(B.packOf({ country: c }).entity_bases).find((x) => x !== 'company');
    ok('A5 ' + c + ' · the one-owner default is ' + first, k === first, k);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
