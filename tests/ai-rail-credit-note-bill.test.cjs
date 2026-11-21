/**
 * ai-rail-credit-note-bill.test.cjs - AI-F-02 (walk AI, 21 Nov 2026): A RAIL CREDIT NOTE MUST NAME A BILL OF THE SENDER'S, AND CANNOT TAKE BACK MORE THAN IT.
 * Hand figures (cents): bill WAI-D1 A$1,100.00 = 110000. Notes: 110.00 (11000) ok; 550.00 (55000) ok (11000 + 55000 = 66000 <= 110000); 2,200.00 (220000) refused CREDIT_NOTE_OVER_BILL;
 * with no against: 422 CREDIT_NOTE_NEEDS_BILL; against a bill that does not exist: 422 CREDIT_NOTE_NEEDS_BILL. The seller's debtors: 110000 - 11000 - 55000 = 44000 stays above nil.
 * Decided door: ACC-284 (docs/14-accounting/ACCOUNTING-BACKLOG.md) "refuse a credit_note whose against is a rail invoice in a named 422"; the on-account alternative is NOT built (no decision names it).
 * Run: node tests/ai-rail-credit-note-bill.test.cjs
 */
'use strict';
const cap = require('../lib/credit-cap');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-aaaaaaaaaaaa', BILL = 'b0000000-0000-4000-8000-0000000000a1', UNKNOWN = 'b0000000-0000-4000-8000-0000000000ff';
let committed = [];
const client = { query: async (sql, params) => {
  if (/pg_advisory/i.test(sql) || /xact/i.test(sql) && !/chit_header/.test(sql)) return { rows: [] };
  if (/ANY\(\$4::text\[\]\)/.test(sql)) return { rows: params[1] === BILL ? [{ chit_id: BILL, currency_code: 'AUD', till_id: '', withdrawn: false, invoice_total: 1100, money_total: 1100, legacy_total: null, refund_total: null, bill_no: 'WAI-D1' }] : [] };
  if (/AS withdrawn FROM chit_header h WHERE/.test(sql)) return { rows: [{ withdrawn: false }] };
  if (/DISTINCT ON/.test(sql)) return { rows: committed.map((total, i) => ({ chit_id: 'n' + i, invoice_total: null, money_total: total, legacy_total: null, refund_total: null, bill_no: null })) };
  return { rows: [] };
} };
const lock = require('../lib/xact-lock');
const realQuery = client.query; client.query = async (sql, params) => (sql === lock.LOCK_SQL ? { rows: [] } : realQuery(sql, params));
const send = async (total, business) => {
  const state = { sender_id: SHOP, chit_id: 'c' + Math.random().toString(16).slice(2), purpose: 'credit_note', currency_code: 'AUD', is_draft: false, business_json: business, moneyBlock: { total } };
  try { await cap.holdUnderLock(client, state); committed.push(total); return 'ok'; } catch (e) { return e.code + ':' + e.status; }
};
(async () => {
  const ag = { chit_id: BILL, invoice_no: 'WAI-D1' };
  const answers = [await send(110, { against: ag }), await send(550, { against: ag }), await send(2200, { against: ag })];
  ok('AI-C22 · 110.00 and 550.00 are taken, 2,200.00 is refused 409 CREDIT_NOTE_OVER_BILL', answers.join() === 'ok,ok,CREDIT_NOTE_OVER_BILL:409', answers.join());
  ok('no against: refused 422 CREDIT_NOTE_NEEDS_BILL', (await send(10, {})) === 'CREDIT_NOTE_NEEDS_BILL:422');
  ok('against a bill that does not exist: refused 422 CREDIT_NOTE_NEEDS_BILL', (await send(10, { against: { chit_id: UNKNOWN } })) === 'CREDIT_NOTE_NEEDS_BILL:422');
  ok('against text that is no bill number: refused 422', (await send(10, { against: 'NOPE-1' })) === 'CREDIT_NOTE_NEEDS_BILL:422');
  const debtors = 110000 - committed.reduce((t, n) => t + Math.round(n * 100), 0);
  ok('the seller debtors never go to a credit: 110000 - 11000 - 55000 = 44000 (cents)', committed.length === 2 && debtors === 44000, String(debtors));
  const words = await (async () => { try { await cap.holdUnderLock(client, { sender_id: SHOP, purpose: 'credit_note', business_json: {} }); } catch (e) { return e.message; } })();
  ok('the sentence says what to do, no code word', /which bill/.test(words) && !/[A-Z_]{8,}/.test(words), words);
  ok('a counter note with no against and a till is as it was (not this door)', cap.needsBillRefusal({ purpose: 'credit_note', business_json: { till: { id: 'C1' } } }) === null);
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
