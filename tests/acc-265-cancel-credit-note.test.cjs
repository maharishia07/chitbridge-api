/**
 * acc-265-cancel-credit-note.test.cjs — ACC-265: THE SALE WITH A LIVE CREDIT NOTE IS NOT CANCELLED (offline; the real-Postgres run is acc-265-cancel-credit-note.realstack.cjs).
 *
 * The refusal lives in the ONE writer path (lib/rail-status statusGate → sideRefusal → creditNoteRefusal), so every door that cancels through statusGate meets it: PUT /void,
 * PUT /status (lib/chit-move readThenWriteMove, cancelSentCopy). It reads the notes with the credit cap's own reader (lib/credit-cap earlierNotes, via liveNotesAgainst) under the
 * cap's own lock (credit-cap|<bill>), and it is asked AFTER the older paid refusal.
 * Hand figures (IN): sale 118000 minor (100000 + 9000 + 9000), note 35400 (30000 + 2700 + 2700); the statusGate carries the note ids, never a figure.
 * Cases: live note refuses · no note passes · the lock is taken on the BILL · paid + note says paid · a move that is no cancel never asks · a no-op (already cancelled) never asks · a chit that is
 *   no bill of mine (a credit note, the buyer's copy) is never asked and takes no lock · the reader gets the bill's own id, number and till (so a note struck on another till is not read) ·
 *   the status door's words and stop (chit-move gateStop/refusalOf) · the void door's spec and code · the register row · every door source-pinned.
 * Run: node tests/acc-265-cancel-credit-note.test.cjs
 * CARD 01-rail-core-the-chit/status-the-one-status-writer (ACC-265)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const railStatus = require('../lib/rail-status');
const chitPaid = require('../lib/chit-paid');
const lock = require('../lib/xact-lock');
const chitMove = require('../lib/chit-move');
const CF = require('../tools/chits-files.cjs'); /* the ONE list of chits files (tools/chits-files.cjs) */

let pass = 0, fail = 0;
const t = (name, ok, why) => { if (ok) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-265265265265', SALE = 'a0000000-0000-4000-8000-000000000265', NOTE = 'b0000000-0000-4000-8000-000000000265';
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

/** the world one statusGate asks: the copy's status, the bill row (or none), the notes the reader finds; every query is recorded */
function world({ status, bill, notes }) {
  const log = [];
  const db = {
    log,
    query: async (sql, params) => {
      const one = String(sql).replace(/\s+/g, ' ').trim();
      log.push({ sql: one, params });
      if (/^SELECT current_status FROM chit_status/.test(one)) return { rows: status ? [{ current_status: status }] : [] };
      if (one === lock.LOCK_SQL) return { rows: [] };
      if (/WHERE h\.chit_id = \$1 AND h\.entity_id = \$2 AND h\.sender_entity_id = \$2 AND h\.purpose = ANY/.test(one)) return { rows: bill ? [bill] : [] };
      if (/DISTINCT ON \(h\.chit_id\)/.test(one)) return { rows: (notes || []).map((id) => ({ chit_id: id })) };
      throw new Error('unexpected sql ' + one.slice(0, 90));
    }
  };
  return db;
}
const BILL = { chit_id: SALE, bill_no: 'C1/26-27/1', till_id: 'C1' };
const asked = (db, re) => db.log.filter((entry) => re.test(entry.sql));
const gate = (db, to, opts) => railStatus.statusGate(db, SHOP, SALE, to, railStatus.SYSTEM, opts || { copy: 'sent' });

(async () => {
  console.log('\n══ ACC-265 · a live credit note blocks the cancel of its sale ══');
  const realPaid = chitPaid.paidFactsOf;
  try {
    chitPaid.paidFactsOf = async () => false; /* the paid fact has its own test (rail-216-void-paid.test.cjs); here it is switched, so only the order is asked */
    /* 1 · a live note refuses, in the rail's own shape, and nothing can be saved past it */
    let db = world({ status: 'pending', bill: BILL, notes: [NOTE] });
    let g = await gate(db, 'cancelled');
    t('a live note: statusGate refuses has_credit_note, names the note, keeps the status it was in', g.ok === false && g.why === 'has_credit_note' && g.notes.length === 1 && g.notes[0] === NOTE && g.from === 'pending', JSON.stringify({ ok: g.ok, why: g.why, notes: g.notes, from: g.from }));
    let threw = false; try { await g.write(); } catch (e) { threw = /credit note against it/.test(e.message); }
    t('write() of the refused verdict throws: no door can save the cancel past it', threw);
    t('nothing was written (no UPDATE / INSERT ran)', !db.log.some((entry) => /^(UPDATE|INSERT)/.test(entry.sql)));
    t('the lock is the credit cap\'s own, on the BILL (credit-cap|<chit>), taken before the notes are read', (() => { const i = db.log.findIndex((e) => e.sql === lock.LOCK_SQL); const j = db.log.findIndex((e) => /DISTINCT ON/.test(e.sql)); return i >= 0 && j > i && db.log[i].params[1] === 'credit-cap|' + SALE && db.log[i].params[0] === SHOP; })());
    const readerCall = asked(db, /DISTINCT ON/)[0];
    t('the reader is the cap\'s earlierNotes with THIS bill: its id, its number, its till (upper), and no "this note" (so every live note counts, a note of another till is scoped out by the SQL)',
      readerCall && readerCall.params[0] === SHOP && readerCall.params[1] === SALE && readerCall.params[2] === 'C1/26-27/1' && readerCall.params[3] === null && readerCall.params[4] === null && readerCall.params[5] === 'C1', JSON.stringify(readerCall && readerCall.params));
    t('the reader keeps its till scope and its not-withdrawn and not-draft filters (one reader, not a copy)', /upper\(COALESCE\(h\.business_json -> 'till' ->> 'id', ''\)\) = \$6::text/.test(readerCall.sql) && /role <> 'Draft'/.test(readerCall.sql) && /purpose = 'credit_note'/.test(readerCall.sql) && /cancelled/.test(readerCall.sql));

    /* 2 · no note, or the other moves, never refuse */
    db = world({ status: 'pending', bill: BILL, notes: [] });
    g = await gate(db, 'cancelled');
    t('no live note: the cancel goes through (ok, and write() would save)', g.ok === true && !g.noop);
    db = world({ status: 'pending', bill: BILL, notes: [NOTE] });
    g = await gate(db, 'accepted', { copy: 'sent' });
    t('a move that is not a cancel never asks for notes', !asked(db, /DISTINCT ON/).length && g.why !== 'has_credit_note');
    db = world({ status: 'cancelled', bill: BILL, notes: [NOTE] });
    g = await gate(db, 'cancelled');
    t('a copy that is already cancelled (no-op, a retry) is not asked and is not refused', g.noop === true && g.ok === true && !asked(db, /DISTINCT ON/).length);

    /* 3 · who is asked: a chit that is no bill of mine */
    db = world({ status: 'pending', bill: null, notes: [NOTE] });
    g = await gate(db, 'cancelled');
    t('a credit note itself / the buyer\'s copy / an order that is no bill: not a bill of mine, no lock, no read, no refusal', g.ok === true && !db.log.some((e) => e.sql === lock.LOCK_SQL) && !asked(db, /DISTINCT ON/).length);

    /* 4 · the order of the refusals: paid first */
    chitPaid.paidFactsOf = async () => true;
    db = world({ status: 'pending', bill: BILL, notes: [NOTE] });
    g = await gate(db, 'cancelled');
    t('paid AND a note: the older refusal wins (why paid), the notes are not even read', g.ok === false && g.why === 'paid' && !asked(db, /DISTINCT ON/).length, g.why);
    chitPaid.paidFactsOf = async () => false;
    g = await gate(world({ status: 'pending', bill: BILL, notes: [NOTE] }), 'cancelled');
    t('unpaid AND a note: has_credit_note', g.why === 'has_credit_note');

    /* 5 · the words, on the doors that answer them */
    const said = railStatus.creditNoteSaid([NOTE]);
    t('the words: what happened · what it means · what to do, the note ids, a code to branch on', /credit note against it/.test(said.message) && /Cancel the credit note first/.test(said.message) && said.why === 'has_credit_note' && said.notes[0] === NOTE, JSON.stringify(said));
    const pre = { stop: 'has_credit_note', previous_status: 'pending', notes: [NOTE] };
    const answered = chitMove.refusalOf(pre, SALE, 'cancelled');
    t('the status door (chit-move refusalOf): 409 with the words and the notes, never a bare 403', answered.code === 409 && answered.body.why === 'has_credit_note' && answered.body.notes[0] === NOTE && answered.body.from === 'pending' && /credit note/.test(answered.body.message), JSON.stringify(answered));
    const moveSrc = CF.read(path.join(__dirname, '..'));
    t('the status door turns the rail verdict into that stop (STOPS_WITH_STATUS names it, the notes ride along)', /STOPS_WITH_STATUS = \[[^\]]*'has_credit_note'/.test(moveSrc) && /stop: verdict\.why, previous_status, notes: verdict\.notes/.test(moveSrc));
    const chitsSrc = moveSrc; /* the route and the lifted move, one text */
    t('the void door (withdrawRefusalSpec) answers it 409 CHIT_HAS_CREDIT_NOTE before the 403 fall-through', /refusal\.why === 'has_credit_note'\) return \{ status: 409, \.\.\.said\(\{ \.\.\.railStatus\.creditNoteSaid\(refusal\.notes\), from: refusal\.from \}, 'CHIT_HAS_CREDIT_NOTE'\) \}/.test(chitsSrc)
      && chitsSrc.indexOf("refusal.why === 'has_credit_note'") < chitsSrc.indexOf("if (refusal.why !== 'wrong_step') return railSaid(railActions.refusalOf(refusal, 403"));
    t('the status PUT door (answerMoved) carries the same registered code', /moved\.body\.why === 'has_credit_note' \? 'CHIT_HAS_CREDIT_NOTE'/.test(chitsSrc));

    /* 6 · the register and the one reader */
    const rows = JSON.parse(read('docs/error-codes.json')).codes.filter((row) => row.code === 'CHIT_HAS_CREDIT_NOTE');
    t('CHIT_HAS_CREDIT_NOTE is registered once (409, a sentence, a hint) in docs/error-codes.json and docs/ERROR-CODES.md', rows.length === 1 && rows[0].status === '409' && rows[0].shopkeeper !== 'PENDING' && /CHIT_HAS_CREDIT_NOTE \| 409/.test(read('docs/ERROR-CODES.md')));
    t('there is ONE reader of the notes against a bill: lib/credit-cap.earlierNotes (no second credit_note query was added)', (read('lib/rail-status.js') + read('lib/chit-paid.js')).indexOf("purpose = 'credit_note'") === -1 && /earlierNotes\(client, entity, read\.rows\[0\], null\)/.test(read('lib/credit-cap.js')));
  } finally { chitPaid.paidFactsOf = realPaid; }
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL ' + e.stack); process.exit(1); });
