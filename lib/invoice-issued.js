'use strict';
/**
 * OWNS      "is this chit's invoice already ISSUED on this copy?" and the one refusal a money change on an issued invoice gets (ACC-192 slice 1a)
 * CALLED BY lib/chit-proposal (a priced round is refused; an accepted one never rewrites the invoice) · routes/chits.js POST /:chit_id/amend (a money edit is refused)
 * FLOW      copy → issuedOn(db) → { posted | frozen | tax invoice } → refuse(409 INVOICE_MONEY_LOCKED) · movesMoney(edits vs the live lines) decides which amend edits count
 * CARD      14-accounting/README (ACC-192)
 *
 * ⭐ WHAT "ISSUED" MEANS — no new marker, the three that already exist, any one of them:
 *   1. the books hold an entry for the chit (journal_entry.source_ref chit:<id>; a sent invoice posts at send — books-hooks) — the strongest: it is in the books and in the returns;
 *   2. business_json.invoice.frozen_at — tax-copy.freezeOnComplete stamped the invoice when the copy completed;
 *   3. business_json.invoice carried and jurisdiction.document is not quotation / pro_forma — sendIssued carries the invoice at send (never on a draft); a round-made
 *      pro-forma (chit-proposal writeAgreedMoney sets document pro_forma) is NOT yet a tax invoice, so it may still be re-issued.
 * A quotation, a pro-forma and an RFQ round are not issued: re-issue is right there (Athi 2026-10-02: "recomputation can be done, but cannot rewrite what has been already wrote").
 */
const schema = require('./schema');
const amend = require('./amend');
const { onEntity } = require('../db');

const WORDS = 'This bill is already invoiced. A change in price needs a credit or debit note.';
const NOT_AN_INVOICE_YET = ['quotation', 'pro_forma'];

const HEAD = `SELECT jsonb_typeof(business_json -> 'invoice') = 'object' AS has_invoice,
       business_json -> 'invoice' ->> 'frozen_at' AS frozen_at,
       business_json #>> '{jurisdiction,document}' AS document`;
const WITH_BOOKS = HEAD + ", EXISTS (SELECT 1 FROM journal_entry j WHERE j.entity_id = $1 AND j.source_ref = 'chit:' || $2::text) AS posted FROM chit_header WHERE entity_id = $1 AND chit_id = $2 LIMIT 1";
const NO_BOOKS = HEAD + ', false AS posted FROM chit_header WHERE entity_id = $1 AND chit_id = $2 LIMIT 1';

/** the three markers in one row → true when any says issued */
const isIssuedRow = (row) => !!row && (row.posted === true || !!row.frozen_at || (row.has_invoice === true && !NOT_AN_INVOICE_YET.includes(row.document)));

/** issuedOn(db, entity_id, chit_id) — is the invoice on THIS entity's copy already issued? One statement; no copy → false */
async function issuedOn(db, entity_id, chit_id) {
  const booksExist = await schema.hasTable('journal_entry');
  const found = await db.query(booksExist ? WITH_BOOKS : NO_BOOKS, [entity_id, String(chit_id)]);
  return isIssuedRow(found.rows[0]);
}

/** the refusal, in words and under its registered code (409): thrown; the routes and lib/chit-proposal answer it as the one problem shape */
const refusal = () => Object.assign(new Error(WORDS), { status: 409, code: 'INVOICE_MONEY_LOCKED', refused: true });

/** isIssued(entity_id, chit_id) — the ONE "is this an issued invoice" answer for callers that hold no connection (ACC-192 1b: the credit-note path asks it too) */
const isIssued = (entity_id, chit_id) => onEntity(entity_id, null, (db) => issuedOn(db, entity_id, chit_id));

/** refuseIfIssued(entity_id, chit_id) — throws the refusal when this copy's invoice is issued */
async function refuseIfIssued(entity_id, chit_id) {
  if (await isIssued(entity_id, chit_id)) throw refusal();
}

const same = (left, right) => (left == null ? null : Number(left)) === (right == null ? null : Number(right));

/** does ONE cleaned edit change what the line is worth? (a removal of a live line, a line put back, a different quantity or price) */
function editMovesMoney(edit, entry) {
  const now = entry && entry.live;
  if (edit.line === null) return !!now;
  if (!now) return true;
  return !same(edit.line.quantity, now.quantity) || !same(edit.line.price, now.price);
}

/** movesMoney(entity_id, chit_id, edits) — do these amend edits change a quantity, a price, or add or remove a line, against the LIVE set? (a comment or a description fix does not) */
async function movesMoney(entity_id, chit_id, edits) {
  const prepared = amend.prepare(edits);
  const items = await onEntity(entity_id, null, (db) => db.query('SELECT line_items FROM chit_detail WHERE entity_id = $1 AND chit_id = $2 LIMIT 1', [entity_id, chit_id]));
  const { amendments } = await amend.list(entity_id, chit_id);
  const live = amend.liveSet((items.rows[0] && items.rows[0].line_items) || [], amendments);
  return prepared.some((edit) => editMovesMoney(edit, live[edit.idx]));
}

/** refuseMoneyAmend(entity_id, chit_id, edits) — a plain amend: throws the refusal only when the invoice is issued AND an edit moves money. Anything else passes untouched */
async function refuseMoneyAmend(entity_id, chit_id, edits) {
  const sent = (Array.isArray(edits) ? edits : [edits]).filter(Boolean);
  if (!sent.length) return;
  const issued = await onEntity(entity_id, null, (db) => issuedOn(db, entity_id, chit_id));
  if (issued && (await movesMoney(entity_id, chit_id, sent))) throw refusal();
}

module.exports = { issuedOn, isIssued, isIssuedRow, refuseIfIssued, refuseMoneyAmend, movesMoney, refusal, WORDS };
