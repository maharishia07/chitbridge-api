/**
 * tests/books-backfill.test.cjs - A LATE SWITCH-ON NEVER LEAVES AN EARLIER BILL OUT OF THE BOOKS (walks P-F-02, S2-F-07; batch 1129).
 *
 * OWNS      the proof of lib/books-backfill.js: bills on or after the owner's start date post once, through the one posting path (postChit);
 *           bills before it are counted as in the opening balances, never posted; a re-run posts nothing new; the start date only moves earlier.
 * CALLED BY the test library (api T1). Needs the books engines: BOOKS_ENGINES_SRC=C:/dev/chitbridge-engines/src. Run: node tests/books-backfill.test.cjs
 * HAND CASE (paise, IN pack, 18% GST each): three bills of 11800 = 10000 + 1800 tax, one before the start date. After the backfill: 2 bills posted,
 *   sales 20000, tax 3600, debtors/cash 23600; the trial balance carries debits 23600 = credits 23600; a second press posts 0 and the totals are the same.
 * CARD      14-accounting/books-health-to-do-outbox
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111';
const MALA = '22222222-2222-4222-8222-222222222222';
const DAY = 86400000;
const inv = (taxable, tax) => ({ currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: taxable, CgstAmt: tax / 2, SgstAmt: tax / 2, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: taxable + tax } });
let seq = 0;
const cid = () => 'e0000000-0000-4000-8000-' + String(++seq).padStart(12, '0');

(async () => {
  console.log('\n== books-backfill: a late switch-on posts the earlier bills once ==');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }
  const X = H.load({});
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 });
  await X.B.enable(X.db, SHOP, { by: SHOP });
  X.T.setting.get(SHOP).enabled_at = new Date().toISOString(); /* switched on today (the memory store keeps its own clock) */
  const K = require(path.join(H.API, 'lib', 'books-hooks')); K.forget(SHOP);
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const BF = require(path.join(H.API, 'lib', 'books-backfill'));
  const chits = new Map();
  TC.copyOf = async (id) => chits.get(String(id)) || null;
  TC.entryFor = async () => ({ sells: true, invoice: inv(100, 18) });
  const now = Date.now();
  const ago = (days) => new Date(now - days * DAY).toISOString();
  const bill = (days) => { const c = { chit_id: cid(), purpose: 'order', created_at: ago(days), currency_code: 'INR', business_json: { bill_no: 'P-' + seq, till: { id: 'C1' }, billed_at: ago(days), customer: { party_id: MALA }, payment: { parts: [{ how: 'Cash', amount: 118 }] } } }; chits.set(c.chit_id, c); return c; };
  const old = bill(20), c5 = bill(3), c6 = bill(2);
  const pred = (e, from, to, o) => Array.from(chits.values()).filter((c) => c.created_at >= from && c.created_at < to
    && !X.T.entries.some((x) => x.source_ref === 'chit:' + c.chit_id || x.source_ref === 'bill:' + c.chit_id || (x.source_chit_ids || []).indexOf(c.chit_id) >= 0)
    && !((o || {}).skipIds || []).includes(c.chit_id)).sort((p, q) => p.created_at.localeCompare(q.created_at));
  X.store.unpostedInWindow = async (db, e, from, to, limit, o) => pred(e, from, to, o).slice(0, limit).map((c) => ({ chit_id: c.chit_id }));
  X.store.unpostedCount = async (db, e, from, to, o) => ({ count: pred(e, from, to, o).length, oldest: null });
  const entries = () => X.T.entries.filter((x) => /^(chit|bill):/.test(String(x.source_ref)));
  const startDay = K.dayOf(ago(3), X.T.setting.get(SHOP));

  ok('before: the three bills are not in the books', entries().length === 0);
  const r = await BF.run(SHOP, { start_date: startDay, by: SHOP });
  ok('the two bills on or after the start date are posted, in the books once each', r.posted === 2 && entries().length === 2, JSON.stringify(r));
  ok('the bill before the start date is NOT posted and is counted as in the opening balances', r.before_start === 1 && !entries().some((x) => x.source_ref.indexOf(old.chit_id) >= 0), JSON.stringify(r));
  ok('the words say both, nothing silently left out', /1 bill before your start date is in the opening balances/.test(r.words) && /2 bills posted from /.test(r.words), r.words);
  const tb = await X.B.trialBalance(X.db, SHOP, K.dayOf(new Date().toISOString(), X.T.setting.get(SHOP)));
  ok('HAND: 2 bills x 11800 = the trial balance carries debits 23600 = credits 23600, balanced', tb.balanced === true && tb.total_dr_minor === 23600 && tb.total_cr_minor === 23600, JSON.stringify([tb.balanced, tb.total_dr_minor, tb.total_cr_minor]));
  const again = await BF.run(SHOP, { start_date: startDay, by: SHOP });
  ok('a second press posts nothing new, the same two entries', again.posted === 0 && entries().length === 2, JSON.stringify(again));
  ok('the start date only moves earlier: a later date leaves it where it is', (await BF.run(SHOP, { start_date: K.dayOf(ago(1), X.T.setting.get(SHOP)), by: SHOP })) && K.dayOf(X.T.setting.get(SHOP).enabled_at, X.T.setting.get(SHOP)) === startDay);
  let refused = null; try { await BF.run(SHOP, { start_date: '2999-01-01' }); } catch (e) { refused = e; }
  ok('a future start date is refused in words', refused && refused.refused && /future/.test(refused.message), String(refused && refused.message));
  refused = null; try { await BF.run(SHOP, { start_date: 'last week' }); } catch (e) { refused = e; }
  ok('a start date that is not a day is refused in words', refused && refused.refused && /Choose the day/.test(refused.message));
  const mw = require('fs').readFileSync(path.join(H.API, 'middleware', 'books-grant.js'), 'utf8');
  ok('S2-F-09: no role named + no grant says "Choose the adviser or auditor view for this client." under the SAME code BOOKS_GRANT_NONE (SEC-117 resolveRole untouched)',
    /Choose the adviser or auditor view for this client\./.test(mw) && /roleUnnamed && verdict\.code === 'BOOKS_GRANT_NONE'/.test(mw) && /resolveRole/.test(mw));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
