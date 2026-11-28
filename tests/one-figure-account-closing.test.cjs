/**
 * one-figure-account-closing.test.cjs — ONE-FIGURE RC5 (Athi 28 Nov 2026, batch 1141): an account's closing is read ONE way (lib/books-closing.js closingOf).
 * Two carried totals compared: the Ledger route's closing_minor (paged and not) and the books figure a bank sign-off is checked against (closingAsAt)
 * against the trial balance's row for the account (GET /trial-balance, an independent total); a mutation (the sums drop the credits) must go red.
 * HAND (INR paise; FY from 1 Apr; the shop's day 2026-10-10): opening JV 2026-10-01 Dr 1400 Cash 1,000,000 / Cr 3000 1,000,000 (period 0) · rent 2026-10-05 Cr Cash 16,500 ·
 * second rent 2026-10-08 Cr Cash 4,000 → Cash on 31 Oct = 1,000,000 - 16,500 - 4,000 = 979,500 · on 6 Oct = 983,500 · on 30 Sep (before the opening) = 0.
 * A disagreeing figure is refused (the sign-off check throws, never reads tied) and the check fails closed: the mutation below proves the test would say so.
 * Run: node tests/one-figure-account-closing.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * OWNER cb-accounting · CALLS lib/books-closing · routes/books.js GET /ledger/:account · lib/bank-rec-log.js booksBalanceAt
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { rig, counter } = require('./support/books-manual-rig.cjs');
const H = require('./support/books-harness.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n══ ONE-FIGURE RC5 — an account closes the same on the Ledger page, the trial balance and the bank sign-off ══\n');
  const src = (f) => fs.readFileSync(path.join(H.API, f), 'utf8');
  ok('the sign-off check (booksBalanceAt) reads the ONE closing, not the trial balance', /closingAsAt/.test(src('lib/bank-rec-log.js').split('async function booksBalanceAt')[1].split('\n}\n')[0]) && !/trialBalance\(/.test(src('lib/bank-rec-log.js').split('async function booksBalanceAt')[1].split('\n}\n')[0]));
  ok('the Ledger route takes its closing from closingOf (no open + Σ in the route)', /closing_minor: await require\('\.\.\/lib\/books-closing'\)\.closingOf/.test(src('routes/books.js')) && !/open \+ t\.dr - t\.cr/.test(src('routes/books.js')));
  /* (RC5 critic 2) no second reader: no closing_minor with arithmetic, and no 'opening + Σ' sum, anywhere in lib/ or routes/ outside books-closing */
  const strayClosing = [];
  for (const dir of ['lib', 'routes']) {
    for (const f of fs.readdirSync(path.join(H.API, dir)).filter((name) => name.endsWith('.js') && name !== 'books-closing.js')) {
      src(dir + '/' + f).split('\n').forEach((line, i) => {
        const code = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '');
        if (/closing_minor\s*:[^,}]*[+-]\s*[a-z_.]*\b(dr|cr)\b/.test(code) || /opening_minor\s*\+\s*[a-z_.]*\.(dr|before_dr)\b/.test(code) || /\bopen\s*\+\s*[a-z]+\.dr\s*-/.test(code)) strayClosing.push(dir + '/' + f + ':' + (i + 1));
      });
    }
  }
  ok('no closing arithmetic outside books-closing (a second reader of the range closing)', strayClosing.length === 0, strayClosing.join(' '));
  const R = await rig(); if (!R) return;
  const { q, X, SHOP } = R;
  const Closing = require(path.join(H.API, 'lib', 'books-closing'));
  const post = async (name, p, b) => ok('(set-up) ' + name, (await q('POST', p, b)).status === 200);
  await post('opening 1 Oct', '/opening', { date: '2026-10-01', rows: [{ code: '1400', dr_minor: 1000000 }, { code: '3000', cr_minor: 1000000 }], client_ref: 'mid' });
  await post('rent 5 Oct', '/entries', { narration: 'Rent', date: '2026-10-05', client_ref: 'rent', lines: [{ code: '6010', dr_minor: 16500 }, { code: '1400', cr_minor: 16500 }] });
  await post('rent 8 Oct', '/entries', { narration: 'Rent 2', date: '2026-10-08', client_ref: 'rent2', lines: [{ code: '6010', dr_minor: 4000 }, { code: '1400', cr_minor: 4000 }] });
  const acct = ((await q('GET', '/accounts')).body.accounts || []).find((a) => String(a.code) === '1400');
  const tbNet = async (day, code) => { const r = ((await q('GET', '/trial-balance?asOf=' + day)).body.rows || []).find((x) => String(x.code) === code) || {}; return (Number(r.dr_minor) || 0) - (Number(r.cr_minor) || 0); };
  const closes = async (day, from, label) => {
    const un = (await q('GET', '/ledger/1400?from=' + from + '&to=' + day)).body.closing_minor,
      pg = (await q('GET', '/ledger/1400?from=' + from + '&to=' + day + '&limit=1')).body.closing_minor,
      so = await Closing.closingAsAt(X.db, SHOP, acct, day, 'INR'),
      tb = await tbNet(day, '1400');
    return { label, un, pg, so, tb };
  };
  for (const [day, from, hand] of [['2026-10-31', '2026-04-01', 979500], ['2026-10-31', '2026-10-01', 979500], ['2026-10-31', '2026-10-06', 979500], ['2026-10-06', '2026-04-01', 983500], ['2026-10-06', '2026-10-02', 983500], ['2026-10-08', '2026-10-08', 979500]]) {
    const c = await closes(day, from, day + ' from ' + from);
    eq(c.label + ': ledger (unpaged) · ledger (paged) · sign-off figure · trial balance = hand', [c.un, c.pg, c.so, c.tb], [hand, hand, hand, hand]);
  }
  /* mutation: the range sums drop the credits → the ledger and the sign-off figure leave the trial balance (the guard bites) */
  const S = require(path.join(H.API, 'lib', 'books-store')), real = S.pageSums;
  S.pageSums = async (...a) => Object.assign(await real(...a), { cr: 0 });
  const bad = await closes('2026-10-31', '2026-04-01', 'MUTATED');
  S.pageSums = real;
  ok('mutation (credits dropped from the range sums) is caught: the ledger, the sign-off figure and the trial balance no longer agree', !(bad.un === bad.tb && bad.so === bad.tb), JSON.stringify(bad));
  /* (RC5 critic 4) the mutation that proves THE FIX: swap the ONE reader for a sentinel: the unpaged ledger, the paged ledger and the sign-off figure must all return it
     (the old route and the old booksBalanceAt - trial-balance path - would not follow it; a pageSums stub cannot tell them apart); and the sign-off figure must not read the trial balance */
  const realClosing = Closing.closingOf;
  Closing.closingOf = async () => 424242;
  const seen = { un: (await q('GET', '/ledger/1400?from=2026-04-01&to=2026-10-31')).body.closing_minor, pg: (await q('GET', '/ledger/1400?from=2026-04-01&to=2026-10-31&limit=1')).body.closing_minor, so: await Closing.closingAsAt(X.db, SHOP, acct, '2026-10-31', 'INR') };
  Closing.closingOf = realClosing;
  eq('the ledger (unpaged, paged) and the sign-off figure all come from closingOf (sentinel swapped in)', [seen.un, seen.pg, seen.so], [424242, 424242, 424242]);
  const B = require(path.join(H.API, 'lib', 'books')), realTb = B.trialBalance;
  B.trialBalance = async () => { throw new Error('the sign-off figure read the trial balance'); };
  let tbRead = null; try { tbRead = await Closing.closingAsAt(X.db, SHOP, acct, '2026-10-31', 'INR'); } catch (err) { tbRead = String(err.message); }
  B.trialBalance = realTb;
  eq('the sign-off figure never reads the trial balance (stubbed to throw)', tbRead, 979500);
  /* the figure is a value type: no currency, no closing */
  let refused = false; try { await Closing.closingOf(X.db, SHOP, acct, null, '2026-04-01', '2026-10-31', {}); } catch (err) { refused = true; }
  ok('closingOf without a currency is refused (money carries its currency)', refused);
  R.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
