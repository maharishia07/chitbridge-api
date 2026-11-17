#!/usr/bin/env node
/**
 * fin-70-bank-rec-log.test.cjs — FIN-70: the bank reconciliation record, round trip (append → read) with no database.
 *
 * OWNS      the proof that lib/bank-rec-log.js appends marks and signed statements as the engine's step took them, hands them back oldest first with who and when
 *           stamped by the server, refuses a body that names `by` / `at`, a note with no text, an attach with no reference, a statement in another currency or in
 *           fractions; names a posted bank line no live accept mark covers (and clears it again by an accept, then names it again after an undo); and that
 *           migrations/b864_bank_rec_log.sql is insert-only (SELECT and INSERT for the app role, a trigger refusing UPDATE and DELETE). Before the migration every door
 *           says the shared record is not set up yet, without a migration id.
 * CALLED BY CI (tests/*.test.cjs). No database, no network: a stand-in handle answers the four statements the lib sends.
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const schema = require(path.join(HERE, 'lib', 'schema'));
const BRL = require(path.join(HERE, 'lib', 'bank-rec-log'));

let passed = 0;
let failed = 0;
const check = (label, condition, info) => {
  if (condition) passed++;
  else failed++;
  if (!condition) console.log('  FAIL  ' + label + (info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 500)));
};
async function refusal(run) {
  try {
    await run();
    return null;
  } catch (err) {
    return err;
  }
}

const SHOP = '11111111-1111-4111-8111-111111111111';
const BANK = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = { account_id: BANK, code: '1510', name: 'Bank', role: 'bank', is_group: false };

/** the stand-in handle: the rows of bank_rec_log in order, and the posted bank entries the cross-check reads */
function standIn(posted) {
  const rows = [];
  return {
    rows,
    async query(sql, args) {
      if (/^\s*INSERT INTO bank_rec_log/.test(sql)) {
        const made = [];
        if (/'statement'/.test(sql)) {
          const [entity, account, hash, from, to, opening, closingBank, closingBooks, difference, currency, tied, by] = args;
          made.push({ entity_id: entity, account_id: account, kind: 'statement', file_hash: hash, period_from: from, period_to: to, opening_minor: String(opening), closing_bank_minor: String(closingBank), closing_books_minor: String(closingBooks), difference_minor: String(difference), currency, tied, made_by: by });
        } else {
          for (let first = 0; first < args.length; first += 12) {
            const [entity, account, kind, key, act, how, entries, chits, note, ref, hash, by] = args.slice(first, first + 12);
            made.push({ entity_id: entity, account_id: account, kind, line_key: key, act, how, entry_ids: entries, chit_ids: chits, note, attach_ref: ref, file_hash: hash, made_by: by });
          }
        }
        made.forEach((row) => rows.push(Object.assign(row, { seq: String(rows.length + 1), made_at: '2026-11-14T10:00:00.000Z' })));
        return { rows: made };
      }
      if (/FROM bank_rec_log/.test(sql)) {
        const kind = /kind = 'mark'/.test(sql) ? 'mark' : 'statement';
        const mine = rows.filter((row) => row.kind === kind && row.entity_id === args[0] && row.account_id === args[1]);
        return { rows: kind === 'mark' ? mine : mine.slice().reverse() };
      }
      if (/FROM journal_entry/.test(sql)) return { rows: posted };
      throw new Error('unexpected statement: ' + sql.slice(0, 80));
    }
  };
}
const POSTED = [
  { entry_id: 'e-7', entry_no: 'JV-7', source_ref: 'manual:bank:abc123:3', posting_date: '2026-09-30', total_minor: '5000', currency: 'INR' },
  { entry_id: 'e-8', entry_no: 'JV-8', source_ref: 'manual:bank:abc123:4', posting_date: '2026-10-02', total_minor: '12000', currency: 'INR' }
];

(async () => {
  /* before the migration: every door says so in words, no migration id */
  schema.hasTable = async () => false;
  const waiting = await refusal(() => BRL.appendMarks(standIn([]), SHOP, ACCOUNT, { marks: [{ act: 'undo', key: 'k' }] }, STAFF));
  check('before b864 a mark is refused as not set up yet', waiting && waiting.code === 'BOOKS_NOT_MIGRATED', waiting && waiting.code);
  check('…in words with no migration id', waiting && /after the next update/.test(waiting.message) && !/\bb\d{3}\b/.test(waiting.message), waiting && waiting.message);
  const waitingRead = await refusal(() => BRL.read(standIn([]), SHOP, ACCOUNT, null, null));
  check('before b864 the read is refused the same way', waitingRead && waitingRead.code === 'BOOKS_NOT_MIGRATED', waitingRead && waitingRead.code);

  schema.hasTable = async () => true;
  const db = standIn(POSTED);

  /* marks: appended as sent, read back oldest first, who and when from the server */
  const accept = { act: 'accept', key: '2026-09-30|D|5000|CHQ7', how: 'ledger', ledger: ['JV-7#0'], chits: ['c-1'] };
  const first = await BRL.appendMarks(db, SHOP, ACCOUNT, { file_hash: 'abc123', marks: [accept, { act: 'note', key: accept.key, text: ' paid by cheque ' }] }, STAFF);
  check('two marks in one batch come back as two rows', first.length === 2);
  check('the accept keeps its step fields', first[0].act === 'accept' && first[0].line_key === accept.key && first[0].entry_ids[0] === 'JV-7#0' && first[0].chit_ids[0] === 'c-1' && first[0].file_hash === 'abc123', first[0]);
  check('the note is trimmed', first[1].act === 'note' && first[1].note === 'paid by cheque', first[1]);
  check('who is the session and when is the server clock (by / at)', first.every((row) => row.by === STAFF && row.at === '2026-11-14T10:00:00.000Z'), first.map((row) => [row.by, row.at]));
  await BRL.appendMarks(db, SHOP, ACCOUNT, { marks: [{ act: 'undo', key: accept.key }] }, STAFF);
  const undone = await BRL.read(db, SHOP, ACCOUNT, null, null);
  check('the read lists every mark oldest first; the undo is a new row and the accept is still there', undone.marks.map((row) => row.act).join() === 'accept,note,undo', undone.marks.map((row) => row.act));

  /* refusals: a bad fixture each */
  const byGiven = await refusal(() => BRL.appendMarks(db, SHOP, ACCOUNT, { marks: [{ act: 'accept', key: 'k', by: 'someone', at: '2020-01-01' }] }, STAFF));
  check('a mark that names by or at is refused UNKNOWN_FIELD, not ignored', byGiven && byGiven.code === 'UNKNOWN_FIELD', byGiven && byGiven.code);
  const noText = await refusal(() => BRL.appendMarks(db, SHOP, ACCOUNT, { marks: [{ act: 'note', key: 'k', text: '   ' }] }, STAFF));
  check('a note with no text is refused', noText && noText.refused === true, noText && noText.message);
  const longNote = await refusal(() => BRL.appendMarks(db, SHOP, ACCOUNT, { marks: [{ act: 'note', key: 'k', text: 'x'.repeat(501) }] }, STAFF));
  check('a note over 500 characters is refused', longNote && longNote.refused === true);
  const noRef = await refusal(() => BRL.appendMarks(db, SHOP, ACCOUNT, { marks: [{ act: 'attach', key: 'k', name: 'statement.pdf' }] }, STAFF));
  check('an attach that sends the file name instead of its reference is refused', noRef && noRef.code === 'UNKNOWN_FIELD', noRef && noRef.code);
  const badAct = await refusal(() => BRL.appendMarks(db, SHOP, ACCOUNT, { marks: [{ act: 'delete', key: 'k' }] }, STAFF));
  check('an action that is not accept, undo, note or attach is refused', badAct && badAct.refused === true);
  const none = await refusal(() => BRL.appendMarks(db, SHOP, ACCOUNT, { marks: [] }, STAFF));
  check('an empty batch is refused', none && none.refused === true);
  check('nothing refused was stored', db.rows.length === 3, db.rows.length);

  /* statements: the carried figures with their currency; a re-sign is a new row */
  const sheet = { period_from: '2026-09-01', period_to: '2026-09-30', opening_minor: 100000, closing_bank_minor: 150000, closing_books_minor: 150000, difference_minor: 0, currency: 'INR', file_hash: 'abc123' };
  const wrongCurrency = await refusal(() => BRL.appendStatement(db, SHOP, ACCOUNT, 'INR', Object.assign({}, sheet, { currency: 'USD' }), STAFF));
  check('a statement in another currency than the account is refused CURRENCY_MISMATCH (409)', wrongCurrency && wrongCurrency.code === 'CURRENCY_MISMATCH' && wrongCurrency.status === 409, wrongCurrency && wrongCurrency.code);
  const fraction = await refusal(() => BRL.appendStatement(db, SHOP, ACCOUNT, 'INR', Object.assign({}, sheet, { closing_bank_minor: 1500.5 }), STAFF));
  check('a figure that is not whole minor units is refused', fraction && fraction.refused === true, fraction && fraction.message);
  const noHash = await refusal(() => BRL.appendStatement(db, SHOP, ACCOUNT, 'INR', Object.assign({}, sheet, { file_hash: '' }), STAFF));
  check('a statement with no file hash is refused', noHash && noHash.refused === true);
  const backwards = await refusal(() => BRL.appendStatement(db, SHOP, ACCOUNT, 'INR', Object.assign({}, sheet, { period_from: '2026-10-01' }), STAFF));
  check('a period that ends before it starts is refused', backwards && backwards.refused === true);
  const signed = await BRL.appendStatement(db, SHOP, ACCOUNT, 'INR', sheet, STAFF);
  check('a signed statement carries its currency, whole figures, tied and who', signed.currency === 'INR' && signed.opening_minor === 100000 && signed.closing_bank_minor === 150000 && signed.difference_minor === 0 && signed.tied === true && signed.by === STAFF, signed);
  const untied = await BRL.appendStatement(db, SHOP, ACCOUNT, 'INR', Object.assign({}, sheet, { closing_books_minor: 149000, difference_minor: 1000 }), STAFF);
  check('a difference that is not nil is stored as not tied', untied.tied === false && untied.difference_minor === 1000, untied);
  const reread = await BRL.read(db, SHOP, ACCOUNT, null, null);
  check('the read gives the statements newest first, the re-sign beside the first', reread.statements.length === 2 && reread.statements[0].difference_minor === 1000, reread.statements.map((row) => row.difference_minor));

  /* the cross-check: a posted bank line with no live accept mark is a named exception, with its amount and currency */
  check('after the undo both posted lines are named exceptions', reread.exceptions.map((item) => item.entry_no).join() === 'JV-7,JV-8', reread.exceptions);
  check('an exception carries its amount, currency, file hash and line', reread.exceptions[0].amount_minor === 5000 && reread.exceptions[0].currency === 'INR' && reread.exceptions[0].file_hash === 'abc123' && reread.exceptions[0].line_no === 3 && reread.exceptions[0].code === 'POSTED_NOT_ACCEPTED', reread.exceptions[0]);
  await BRL.appendMarks(db, SHOP, ACCOUNT, { marks: [accept] }, STAFF);
  const accepted = await BRL.read(db, SHOP, ACCOUNT, null, null);
  check('a later accept naming JV-7 clears it, JV-8 stays named (newest wins)', accepted.exceptions.map((item) => item.entry_no).join() === 'JV-8', accepted.exceptions);
  check('exceptionsOf over no marks names every posted line', BRL.exceptionsOf(POSTED, []).length === 2);

  /* the account key: code, role or id; a group is no account */
  const chart = [ACCOUNT, { account_id: '44444444-4444-4444-8444-444444444444', code: '1500', name: 'Cash and bank', role: null, is_group: true }];
  check('an account is found by code, role and id', [BRL.accountIn(chart, '1510'), BRL.accountIn(chart, 'bank'), BRL.accountIn(chart, BANK)].every((found) => found === ACCOUNT));
  check('a group ledger and an unknown key are no account', BRL.accountIn(chart, '1500') === null && BRL.accountIn(chart, 'nope') === null && BRL.accountIn(chart, undefined) === null);

  /* the migration is insert-only */
  const sql = fs.readFileSync(path.join(HERE, 'migrations', 'b864_bank_rec_log.sql'), 'utf8');
  check('the migration grants the app role SELECT and INSERT only', /GRANT SELECT, INSERT ON bank_rec_log TO cb_app/.test(sql) && !/^GRANT[^;]*\b(UPDATE|DELETE)\b/im.test(sql));
  check('…and a trigger refuses UPDATE and DELETE', /BEFORE UPDATE OR DELETE ON bank_rec_log[^;]*books_insert_only/.test(sql));
  check('…with RLS on and forced', /ENABLE ROW LEVEL SECURITY/.test(sql) && /FORCE ROW LEVEL SECURITY/.test(sql) && /CREATE POLICY rls_entity ON bank_rec_log/.test(sql));

  console.log('fin-70-bank-rec-log: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
