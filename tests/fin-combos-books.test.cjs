/**
 * fin-combos-books.test.cjs — the proven defects of docs/walks/FIN-COMBOS-2026-11-20.md and RACE-2026-11-20.md on the books doors, through real express and the in-memory store.
 *   B6-12  a refund OUT to a customer clears Debtors (not Creditors); a supplier refund IN touches Creditors; the choice is lib/books-pay-side, the one helper
 *   B6-14  a debit note names a booked bill of that supplier and is not above what the bill still owes (422 DEBIT_NOTE_NO_BILL / DEBIT_NOTE_TOO_BIG)
 *   C4     a foreign line shows { currency, rate, foreign_minor } on the Day book line (books-daybook.fxOf); a local line shows null
 *   4a/4b  an amount sent as text is refused 422; a figure finer than the currency's minor unit (0.005) is refused 422, never rounded
 *   R12a   the same client_ref with ANOTHER body is 409 EVENT_REF_REUSED naming the entry_no; the same body replays (duplicate: true)
 *   R4     the same journal under ANOTHER client_ref still posts and carries warnings[0].code LOOKS_LIKE_EARLIER naming the first entry
 * Hand-worked figures: advance 20.00 = 2000 minor; refund 2000; debit-note lines are rupees at 0 % so the note total equals the typed amount.
 * Run: node tests/fin-combos-books.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const { rig, counter, CUST, SUPP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n══ FIN-COMBOS · books doors: refund side, debit note, fx on the line, strict amounts, client_ref ══\n');
  const R = await rig(); if (!R) return;
  const { X, q, SHOP } = R, T = X.T;
  T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 });
  const D = '2026-10-05';
  const roleOf = (id) => (T.accounts.find((a) => a.account_id === id) || {}).role;
  const net = (role) => T.lines.filter((l) => roleOf(l.account_id) === role).reduce((t, l) => t + (Number(l.dr_minor) - Number(l.cr_minor)), 0);
  const entryOf = (ref) => T.entries.find((e) => e.source_ref === ref);

  console.log('── B6-12 · a refund out to a customer');
  const adv = await q('POST', '/payments', { party_id: CUST, direction: 'in', currency: 'INR', mode: 'cash', received_at: D, amount_minor: 2000, allocate: 'none', client_ref: 'adv-1' });
  ok('customer advance 20.00 recorded', adv.status === 200, JSON.stringify(adv.body));
  eq('Debtors holds the advance (Cr 20.00)', net('debtors'), -2000);
  const before = net('creditors');
  const refund = await q('POST', '/payments', { party_id: CUST, direction: 'out', currency: 'INR', mode: 'cash', received_at: D, amount_minor: 2000, allocate: 'none', acknowledge: ['nothing_owed'], client_ref: 'ref-1' });
  ok('refund out 20.00 recorded', refund.status === 200, JSON.stringify(refund.body));
  eq('Debtors back to 0', net('debtors'), 0);
  eq('Creditors untouched', net('creditors'), before);
  const sup = await q('POST', '/payments', { party_id: SUPP, direction: 'in', currency: 'INR', mode: 'cash', received_at: D, amount_minor: 500, allocate: 'none', acknowledge: ['nothing_owed'], client_ref: 'sup-in-1' });
  ok('supplier refund in recorded', sup.status === 200, JSON.stringify(sup.body));
  eq('a supplier refund in lands on Creditors (Cr 5.00 → -500)', net('creditors') - before, -500);
  eq('Debtors still 0 after the supplier refund', net('debtors'), 0);
  const side = require('../lib/books-pay-side').sideOf;
  eq('side: in/customer · out/supplier · out/customer-only · in/supplier-only · both lists keep the usual side',
    [side({ customer: true }, 'in'), side({ supplier: true }, 'out'), side({ customer: true }, 'out'), side({ supplier: true }, 'in'), side({ customer: true, supplier: true }, 'out')],
    ['customer', 'supplier', 'customer', 'supplier', 'supplier']);

  console.log('\n── B6-14 · a debit note against a bill');
  const bill = await q('POST', '/events', { kind: 'expense', class: 'electricity', supplier: SUPP, amount: 1800, date: D, client_ref: 'bill-1' });
  ok('a bill of 1,800.00 on credit', bill.status === 200, JSON.stringify(bill.body));
  const DN = (ref, over) => Object.assign({ kind: 'debit_note', supplier: SUPP, against_ref: 'ev:expense:bill-1', reason: 'rate', date: D, client_ref: ref, lines: [{ name: 'Rate difference', qty: 1, unit_price: 200, gst_rate: 0 }] }, over || {});
  const none = await q('POST', '/events', DN('dn-0', { against_ref: 'NOBILL-1' }));
  ok('against a bill that does not exist → 422 DEBIT_NOTE_NO_BILL, nothing posted', none.status === 422 && none.body.code === 'DEBIT_NOTE_NO_BILL' && !entryOf('ev:debit_note:dn-0'), JSON.stringify(none.body));
  const big = await q('POST', '/events', DN('dn-1', { lines: [{ name: 'Too much', qty: 1, unit_price: 1801, gst_rate: 0 }] }));
  ok('above the bill (1,801.00 on 1,800.00) → 422 DEBIT_NOTE_TOO_BIG', big.status === 422 && big.body.code === 'DEBIT_NOTE_TOO_BIG' && !entryOf('ev:debit_note:dn-1'), JSON.stringify(big.body));
  const prev = await q('POST', '/preview', DN('dn-p', { against_ref: 'NOBILL-1' }));
  ok('the preview says it in words too', prev.body && prev.body.ok === false && /no booked bill/i.test(JSON.stringify(prev.body.refusals)), JSON.stringify(prev.body));
  const good = await q('POST', '/events', DN('dn-2'));
  ok('200.00 against the 1,800.00 bill posts', good.status === 200 && !!entryOf('ev:debit_note:dn-2'), JSON.stringify(good.body));
  const rest = await q('POST', '/events', DN('dn-3', { lines: [{ name: 'Rest', qty: 1, unit_price: 1600, gst_rate: 0 }] }));
  ok('exactly the open 1,600.00 posts (not above)', rest.status === 200, JSON.stringify(rest.body));
  const gone = await q('POST', '/events', DN('dn-4', { lines: [{ name: 'More', qty: 1, unit_price: 1, gst_rate: 0 }] }));
  ok('the bill is now used up: another note is refused', gone.status === 422 && gone.body.code === 'DEBIT_NOTE_TOO_BIG', JSON.stringify(gone.body));
  /* AW-F-05: a bill keyed by hand is named by the reference it was keyed with (client_ref), not only by its stored form ev:expense:<ref> */
  const keyed = await q('POST', '/events', { kind: 'expense', class: 'electricity', supplier: SUPP, amount: 1000, date: D, client_ref: 'bill-2' });
  ok('a second keyed bill of 1,000.00', keyed.status === 200, JSON.stringify(keyed.body));
  const typed = await q('POST', '/events', DN('dn-5', { against_ref: 'bill-2', lines: [{ name: 'Rate difference', qty: 1, unit_price: 300, gst_rate: 0 }] }));
  ok('AW-F-05 a debit note against the bill by the reference it was keyed with (bill-2) posts, set against that bill', typed.status === 200 && !!entryOf('ev:debit_note:dn-5'), JSON.stringify(typed.body));
  const typedBig = await q('POST', '/events', DN('dn-6', { against_ref: 'bill-2', lines: [{ name: 'Too much', qty: 1, unit_price: 701, gst_rate: 0 }] }));
  ok('AW-F-05 …and it counted against bill-2: 701.00 on the 700.00 still open is DEBIT_NOTE_TOO_BIG', typedBig.status === 422 && typedBig.body.code === 'DEBIT_NOTE_TOO_BIG', JSON.stringify(typedBig.body));
  const unknown = await q('POST', '/events', DN('dn-7', { against_ref: 'NOPE-9' }));
  ok('AW-F-05 a reference no bill holds is still DEBIT_NOTE_NO_BILL, and the words say which references count', unknown.status === 422 && unknown.body.code === 'DEBIT_NOTE_NO_BILL' && /keyed with/.test(JSON.stringify(unknown.body)), JSON.stringify(unknown.body));

  console.log('\n── C4 · the rate on the line');
  const day = require('../lib/books-daybook');
  const lineOf = (extra) => Object.assign({ code: '5000', account_name: 'Purchases', dr_minor: '19110', cr_minor: '0', currency: 'INR', tax_rate: null }, extra);
  const entries = day.entriesOf ? day.entriesOf([Object.assign({ entry_id: 'e1', entry_no: 'MJ/1', posting_date: D, doc_date: D }, lineOf({ txn_currency: 'AUD', amount_txn_minor: '35000', fx_rate: '54.6' })), Object.assign({ entry_id: 'e2', entry_no: 'MJ/2', posting_date: D, doc_date: D }, lineOf({ txn_currency: 'INR', amount_txn_minor: '19110', fx_rate: '1' })), Object.assign({ entry_id: 'e3', entry_no: 'MJ/3', posting_date: D, doc_date: D }, lineOf({}))], new Map()) : [];
  eq('a foreign line carries { currency, rate, foreign_minor } (AUD 350.00 @ 54.6)', entries[0] && entries[0].lines[0].fx, { currency: 'AUD', rate: 54.6, foreign_minor: 35000 });
  eq('a line in the books\' own currency carries fx null', entries[1] && entries[1].lines[0].fx, null);
  eq('a line with no foreign columns (before b392) carries fx null', entries[2] && entries[2].lines[0].fx, null);

  console.log('\n── 4a/4b · strict amounts');
  const str = await q('POST', '/events', { kind: 'capital', into: 'cash', amount: '2500', date: D, client_ref: 'str-1' });
  ok('"2500" as the amount → 422, nothing posted', str.status === 422 && !entryOf('ev:capital:str-1'), JSON.stringify(str.body));
  const strMinor = await q('POST', '/events', { kind: 'capital', into: 'cash', amount_minor: '250000', date: D, client_ref: 'str-2' });
  ok('"250000" as amount_minor → refused too', strMinor.status >= 400 && !entryOf('ev:capital:str-2'), JSON.stringify(strMinor.body));
  const fine = await q('POST', '/events', { kind: 'capital', into: 'cash', amount: 0.005, date: D, client_ref: 'fine-1' });
  ok('0.005 (finer than a paisa) → 422, never rounded to 0.01', fine.status === 422 && /finer than the smallest unit/.test(JSON.stringify(fine.body)) && !entryOf('ev:capital:fine-1'), JSON.stringify(fine.body));
  const dr = await q('POST', '/entries', { date: D, narration: 'fine', lines: [{ code: '1400', dr: 0.005 }, { code: '3000', cr: 0.005 }] });
  ok('0.005 typed as a journal dr/cr → 422', dr.status === 422 && /finer than the smallest unit/.test(JSON.stringify(dr.body)), JSON.stringify(dr.body));
  const drStr = await q('POST', '/entries', { date: D, narration: 'text', lines: [{ code: '1400', dr: '100' }, { code: '3000', cr: '100' }] });
  ok('"100" typed as a journal dr/cr → 422', drStr.status === 422, JSON.stringify(drStr.body));
  const okAmount = await q('POST', '/events', { kind: 'capital', into: 'cash', amount: 12.34, date: D, client_ref: 'ok-1' });
  ok('12.34 (two decimals) still posts', okAmount.status === 200, JSON.stringify(okAmount.body));

  console.log('\n── R12a · the same client_ref with another body');
  const a = await q('POST', '/events', { kind: 'capital', into: 'cash', amount: 100, date: D, client_ref: 'r12' });
  ok('the first posts', a.status === 200 && !!a.body.entry_no, JSON.stringify(a.body));
  const same = await q('POST', '/events', { kind: 'capital', into: 'cash', amount: 100, date: D, client_ref: 'r12' });
  ok('the same body replays: 200 duplicate:true, the same entry_no', same.status === 200 && same.body.duplicate === true && same.body.entry_no === a.body.entry_no, JSON.stringify(same.body));
  const other = await q('POST', '/events', { kind: 'capital', into: 'cash', amount: 999, date: D, client_ref: 'r12' });
  ok('another amount under that client_ref → 409 EVENT_REF_REUSED naming ' + a.body.entry_no, other.status === 409 && other.body.code === 'EVENT_REF_REUSED' && JSON.stringify(other.body).includes(a.body.entry_no), JSON.stringify(other.body));
  eq('and only one entry exists for it', T.entries.filter((e) => e.source_ref === 'ev:capital:r12').length, 1);
  const spelled = await q('POST', '/events', { date: D, client_ref: 'r12', amount_minor: 10000, into: 'cash', kind: 'capital' });
  ok('the same journal spelled in minor units, keys in another order → still a replay', spelled.status === 200 && spelled.body.duplicate === true, JSON.stringify(spelled.body));

  console.log('\n── GOR-03 · POST /entries: the same client_ref with another journal');
  const jl = (amt) => [{ code: '1400', dr: amt }, { code: '3000', cr: amt }];
  const ea = await q('POST', '/entries', { date: D, narration: 'gor', client_ref: 'g3', lines: jl(10) });
  ok('the first journal posts', ea.status === 200 && !!ea.body.entry_no, JSON.stringify(ea.body));
  const eSame = await q('POST', '/entries', { date: D, narration: 'gor', client_ref: 'g3', lines: jl(10) });
  ok('the same body replays: 200 duplicate:true, the same entry_no', eSame.status === 200 && eSame.body.duplicate === true && eSame.body.entry_no === ea.body.entry_no, JSON.stringify(eSame.body));
  const eOther = await q('POST', '/entries', { date: D, narration: 'gor', client_ref: 'g3', lines: jl(77) });
  ok('another body under that client_ref → 409 EVENT_REF_REUSED naming ' + ea.body.entry_no, eOther.status === 409 && eOther.body.code === 'EVENT_REF_REUSED' && JSON.stringify(eOther.body).includes(ea.body.entry_no), JSON.stringify(eOther.body));
  eq('and only one entry exists for it', T.entries.filter((e) => e.source_ref === 'manual:g3').length, 1);
  const eLong = await q('POST', '/entries', { date: D, narration: 'gor', client_ref: 'x'.repeat(81), lines: jl(10) });
  ok('a client_ref of 81 characters → 422, nothing posted (never cut to 80)', eLong.status === 422 && !T.entries.some((e) => String(e.source_ref).startsWith('manual:xxxx')), JSON.stringify(eLong.body));
  const eOk80 = await q('POST', '/entries', { date: D, narration: 'gor', client_ref: 'y'.repeat(80), lines: jl(10) });
  ok('exactly 80 characters still posts', eOk80.status === 200, JSON.stringify(eOk80.body));
  const nObj = await q('POST', '/entries', { date: D, narration: { a: 1 }, lines: jl(10) });
  ok('a narration that is an object → 422 (was stored as "[object Object]")', nObj.status === 422, JSON.stringify(nObj.body));
  const nArr = await q('POST', '/entries', { date: D, narration: ['a'], lines: jl(10) });
  ok('a narration that is an array → 422', nArr.status === 422, JSON.stringify(nArr.body));
  const nNum = await q('POST', '/entries', { date: D, narration: 5, lines: jl(10) });
  ok('a narration that is a number → 422', nNum.status === 422, JSON.stringify(nNum.body));
  const evLong = await q('POST', '/events', { kind: 'capital', into: 'cash', amount: 5, date: D, narration: 'n'.repeat(301), client_ref: 'g3-nar' });
  ok('an event narration over 300 → 422, nothing posted (was cut)', evLong.status === 422 && !entryOf('ev:capital:g3-nar'), JSON.stringify(evLong.body));
  const dtEv = await q('POST', '/entries', { date: D + 'T23:30:00+05:30', narration: 'gor', lines: jl(10) });
  ok('a date-time on a journal → refused: send the date only', dtEv.status >= 400 && dtEv.status < 500 && /date only/.test(JSON.stringify(dtEv.body)), JSON.stringify(dtEv.body));

  console.log('\n── R4 · a look-alike under another client_ref');
  const first = await q('POST', '/events', { kind: 'drawings', from: 'cash', amount: 321, date: D, client_ref: 'la-1' });
  ok('the first posts with no warning', first.status === 200 && !first.body.warnings, JSON.stringify(first.body));
  const again = await q('POST', '/events', { kind: 'drawings', from: 'cash', amount: 321, date: D, client_ref: 'la-2' });
  ok('the same day, accounts and amount under another ref STILL posts (200, a new entry)', again.status === 200 && !again.body.duplicate && again.body.entry_no !== first.body.entry_no, JSON.stringify(again.body));
  ok('…with warnings[0] LOOKS_LIKE_EARLIER naming ' + first.body.entry_no, again.body.warnings && again.body.warnings[0].code === 'LOOKS_LIKE_EARLIER' && again.body.warnings[0].entry_no === first.body.entry_no, JSON.stringify(again.body));
  const different = await q('POST', '/events', { kind: 'drawings', from: 'cash', amount: 322, date: D, client_ref: 'la-3' });
  ok('another amount: no warning', different.status === 200 && !different.body.warnings, JSON.stringify(different.body));
  const replay = await q('POST', '/events', { kind: 'drawings', from: 'cash', amount: 321, date: D, client_ref: 'la-2' });
  ok('a replay of the warned entry is a plain duplicate, no new warning', replay.status === 200 && replay.body.duplicate === true && !replay.body.warnings, JSON.stringify(replay.body));

  console.log('\n── R12a · the race: the guard pre-read saw nothing, the winner commits before the writer reads');
  const books = require('../lib/books'), realPreview = books.previewEntry;
  await q('POST', '/events', { kind: 'capital', into: 'cash', amount: 100, date: D, client_ref: 'race-1' });
  let stale = 0;
  books.previewEntry = async function (...a) { const r = await realPreview.apply(this, a); if (!stale++ && r && r.duplicate) r.duplicate = null; return r; }; /* the pre-read before the winner was visible */
  const raced = await q('POST', '/events', { kind: 'capital', into: 'cash', amount: 777, date: D, client_ref: 'race-1' });
  books.previewEntry = realPreview;
  ok('a different body that read before the winner committed is STILL 409 EVENT_REF_REUSED (compared after the lock, in postEntry)', raced.status === 409 && raced.body.code === 'EVENT_REF_REUSED', JSON.stringify(raced.body));
  eq('and only one entry exists for it', T.entries.filter((e) => e.source_ref === 'ev:capital:race-1').length, 1);
  books.previewEntry = async function (...a) { const r = await realPreview.apply(this, a); if (r && r.duplicate) r.duplicate = null; return r; };
  const racedSame = await q('POST', '/events', { kind: 'capital', into: 'cash', amount: 100, date: D, client_ref: 'race-1' });
  books.previewEntry = realPreview;
  ok('the SAME body in that race replays (200 duplicate:true)', racedSame.status === 200 && racedSame.body.duplicate === true, JSON.stringify(racedSame.body));

  R.close();
  done();
})().catch((e) => { console.error('threw:', e && e.stack || e); process.exit(1); });
