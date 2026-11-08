'use strict';
/**
 * OWNS      the credit or debit note an accepted price change on an issued invoice issues (ACC-192 slices 1b + 2): the changed lines only, the direction, the note chit's body, the idempotent issue, the numbered series
 * CALLED BY lib/chit-proposal.js (sellerRound prices the delta · acceptHere / receiveDecision issue it at the SELLER's installation)
 * FLOW      edits → deltaOf (changed lines only, ONE direction) → chit-proposal.priceMoney (send-money.invoiceOfLines; the rate is the line's own, issued with the invoice) → on acceptance issue() → autoraise.sendAs (the ONE send path)
 * CARD      14-accounting/README (ACC-192)
 *
 * ⭐ The note is priced over the CHANGED LINES ONLY (the changed quantity at the issued price, the changed price on the quantity that stays), per line in the pack's own half-up rule, at the rate the
 *   invoice was issued under. It is never total_new − total_old. The original chit and its invoice are never touched.
 * ⭐ ONE DIRECTION per note (CGST Act s.34: a note is a credit OR a debit): drops → credit_note; rises → the seller pack's document for a raise (debit_note for IN and AU; for AE a further tax invoice,
 *   purpose invoice + against, DL Art. 62(2)); a round that does both is refused in words. A line ADDED to an issued invoice is a new supply, refused in words (a round can only re-price the lines that exist).
 * ⭐ Idempotency key: (issuer entity, original chit_id, proposal_id) — kept as business_json.against.proposal_id; a replayed decision finds the note and issues none.
 * ⭐ The number: <PREFIX>/<period label>/<n>, the label from docnumber.periodLabel (IN: the FY 26-27; AU, AE: none), n one past the highest the issuer has issued under that prefix, over ALL years.
 */
const { withEntity } = require('../db');
const money = require('./money');
const log = require('./logger');
const docnumber = require('./docnumber');
const regulation = require('./regulation');

const NO_CHANGE_WORDS = 'Nothing in this change moves the bill, so there is no note to issue.';
const MIXED_WORDS = 'This change raises one line and lowers another. A note goes one way only, so make two changes: one that lowers, one that raises.';
const ADDED_WORDS = 'A line that is not on the invoice is a new sale, not a change to this one. Raise a new invoice for it.';
const NO_RAISE_DOCUMENT_WORDS = 'This country has no ruling here for a raised price on an issued bill, so no note was issued. Raise a new invoice for the extra amount.';
const NOT_ISSUED_WORDS = 'The note could not be issued, so the change was not applied on either side. Try again; if it repeats, tell us.';
const NOT_PAYER_WORDS = 'A raised price is accepted by the one who pays it. The seller cannot accept it.';
const refused = (status, code, message) => Object.assign(new Error(message), { status, code, refused: true });

const NUMBER_WORDS = 'The note number would not fit this country’s rule for a document number, so no note was issued. Tell us; the note prefix needs a change.';

/**
 * what each document is numbered under, called, and typed on the e-invoice (INV-01 DocDtls.Typ): credit_note CN · debit_note DN · a further tax invoice (purpose invoice) takes the issuer's
 * INVOICE series — no prefix of its own (Athi 2026-11-08, review of #990: UAE Art. 59(1)(d) lets a number be any unique sequence, but an auditor reads one invoice sequence)
 */
const DOCUMENTS = {
  credit_note: { prefix: 'CN', title: 'Credit note', typ: 'CRN' },
  debit_note: { prefix: 'DN', title: 'Debit note', typ: 'DBN' },
  invoice: { prefix: '', title: 'Additional invoice', typ: 'INV' }
};

/** a delta line: the live line's own rating fields, the changed quantity and price, its total in the one rounder; no discount of its own */
function lineOf(live, quantity, price) {
  const line = Object.assign({}, live, { quantity, price, total: money.round(quantity * price), list_price: price });
  delete line.discount;
  return line;
}

/**
 * what a replacement line (new quantity, new price) changes on the live line, as { drops, raises } of delta lines. A lower quantity drops it at the issued price; a higher one raises it (at the NEW
 * price when the price rises too, so the lines sum exactly to new − old); a price change moves the quantity that stays.
 */
function replacementDeltas(live, newQty, newPrice) {
  const oldQty = Number(live.quantity);
  const oldPrice = Number(live.price);
  const stays = Math.min(oldQty, newQty);
  const out = { drops: [], raises: [] };
  if (newQty < oldQty) out.drops.push(lineOf(live, oldQty - newQty, oldPrice));
  if (newQty > oldQty) out.raises.push(lineOf(live, newQty - oldQty, Math.max(newPrice, oldPrice)));
  if (newPrice < oldPrice && stays > 0) out.drops.push(lineOf(live, stays, oldPrice - newPrice));
  if (newPrice > oldPrice && stays > 0) out.raises.push(lineOf(live, stays, newPrice - oldPrice));
  return out;
}

/** the deltas of ONE edit against the line's live form: a removal drops it all */
function editDeltas(live, edit) {
  if (edit.line === null) return { drops: [lineOf(live, Number(live.quantity), Number(live.price))], raises: [] };
  return replacementDeltas(live, Number(edit.line.quantity), Number(edit.line.price));
}

/** every edit's deltas from the copy's live set → { drops, raises } */
function deltasOf(copy, edits) {
  const all = { drops: [], raises: [] };
  for (const edit of edits || []) {
    const entry = copy.live[edit.line_index];
    if (!entry || !entry.live) continue;
    const changed = editDeltas(Object.assign({}, copy.lines[edit.line_index], entry.live), edit);
    all.drops.push(...changed.drops);
    all.raises.push(...changed.raises);
  }
  return all;
}

/**
 * deltaOf(copy, edits) → { direction: 'credit' | 'debit', lines } — the changed lines of a priced round, from the copy's live set. Throws in words: a round that lowers AND raises
 * (INVOICE_MIXED_ROUND), or one that changes nothing (INVOICE_INCREASE_REFUSED).
 */
function deltaOf(copy, edits) {
  const { drops, raises } = deltasOf(copy, edits);
  if (drops.length && raises.length) throw refused(409, 'INVOICE_MIXED_ROUND', MIXED_WORDS);
  if (!drops.length && !raises.length) throw refused(409, 'INVOICE_INCREASE_REFUSED', NO_CHANGE_WORDS);
  return raises.length ? { direction: 'debit', lines: raises } : { direction: 'credit', lines: drops };
}

/** deltaLines(copy, edits) — the changed lines of a priced round (either direction) */
const deltaLines = (copy, edits) => deltaOf(copy, edits).lines;

/** does a seller's override name a line the invoice does not have? (an unknown line id, a position past the end, or neither given) */
function namesNoLine(copy, override) {
  if (!override || override.remove || override.line === null) return false;
  if (override.line_id) return !copy.lines.some((line) => String(line.line_id) === String(override.line_id));
  const index = Number(override.line_index);
  return !Number.isInteger(index) || index < 0 || index >= copy.lines.length;
}

/** refuseAddedLines(copy, overrides) — a round on an issued invoice may only re-price lines it has; a line it names that is not there is a new sale (INVOICE_LINE_ADDED) */
function refuseAddedLines(copy, overrides) {
  if ((overrides || []).some((item) => namesNoLine(copy, item))) throw refused(409, 'INVOICE_LINE_ADDED', ADDED_WORDS);
}

/**
 * documentFor(country) → the purpose a RAISE on an issued invoice is issued under, read from the SELLER's pack, never defaulted: a pack with a debit note (IN's DBN) or an adjustment note (AU)
 * → 'debit_note'; a pack that says it has no debit note (AE: creditNote.debit_note null) → 'invoice' (a further tax invoice); a country with no pack or no statement is refused in words.
 */
function documentFor(country) {
  const pack = country ? regulation.lookup(country) : null;
  if (!pack || pack.fallback || pack.unknown) throw refused(409, 'INVOICE_NOTE_NO_RULE', NO_RAISE_DOCUMENT_WORDS);
  if (hasDebitNote(pack)) return 'debit_note';
  if (pack.creditNote && pack.creditNote.debit_note === null) return 'invoice';
  throw refused(409, 'INVOICE_NOTE_NO_RULE', NO_RAISE_DOCUMENT_WORDS);
}

/** does the pack have a document for a raised price: IN's e-invoice debit note type (DBN) or AU's adjustment note */
function hasDebitNote(pack) {
  const rules = pack.tax || {};
  const einvoiceTypes = (rules.einvoice && rules.einvoice.doc_types) || {};
  return !!(rules.adjustmentNote || einvoiceTypes.debit_note);
}

/** purposeOf(direction, country) — the purpose of the note a round issues: a lowering is the credit note; a raise is the seller pack's document */
const purposeOf = (direction, country) => (direction === 'credit' ? 'credit_note' : documentFor(country));

/** refuseNotPayer(direction, buyerId, deciderId) — a raised price is accepted by the one who pays it (the buyer), never by the seller */
function refuseNotPayer(direction, buyerId, deciderId) {
  if (direction === 'debit' && String(buyerId) !== String(deciderId)) throw refused(403, 'PROPOSAL_NOT_YOURS', NOT_PAYER_WORDS);
}

/** the date the original invoice was issued on, as the engine's `at` (its DocDtls.Dt, else the chit's billed_at); null when it carries none */
const issuedAtOf = (original) => (original && ((original.invoice && original.invoice.DocDtls && original.invoice.DocDtls.Dt) || original.billed_at)) || null;

/** the note already issued for this round (the idempotency key), or null — any purpose a note can take */
async function existingNote(issuer, chit_id, proposal_id) {
  const found = await withEntity(issuer, (db) =>
    db.query("SELECT chit_id FROM chit_header WHERE entity_id = $1 AND purpose IN ('credit_note', 'debit_note', 'invoice') AND business_json -> 'against' ->> 'chit_id' = $2 AND business_json -> 'against' ->> 'proposal_id' = $3 LIMIT 1", [issuer, String(chit_id), String(proposal_id)])
  );
  return found.rows[0] ? String(found.rows[0].chit_id) : null;
}

/** the server's own counter of the issuer's INVOICE series (books-store nextNo: one atomic row per issuer, ACC-192 §10) */
const INVOICE_SERIES = 'invoice';

/**
 * the next number of the issuer's own series for this document. A note (CN, DN) is one past the highest it has issued under its prefix, over every year (the sequence never resets).
 * A document with NO prefix is the invoice series itself: the SERVER-OWNED counter row of the issuer (never a scan of invoice numbers, never the till's), reserved under the series lock and
 * given back when the send is refused (giveBackNumber), so a refused issue leaves no gap.
 */
async function nextSequence(issuer, purpose, prefix) {
  if (!prefix) return withEntity(issuer, (db) => require('./books-store').nextNo(db, issuer, INVOICE_SERIES, '-'));
  const found = await withEntity(issuer, (db) =>
    db.query("SELECT coalesce(max(substring(business_json ->> 'printed_as' from '[0-9]+$')::int), 0) + 1 AS next FROM chit_header WHERE entity_id = $1 AND purpose = $2 AND sender_entity_id = $1 AND business_json ->> 'printed_as' LIKE $3", [issuer, purpose, prefix + '/%'])
  );
  return Number((found.rows[0] && found.rows[0].next) || 1);
}

/** giveBackNumber(issuer, prefix, sequence) — a number reserved from the invoice counter whose send was refused goes back (only while nothing was taken after it, which the series lock guarantees); a note series reserves nothing */
async function giveBackNumber(issuer, prefix, sequence) {
  if (prefix) return;
  await withEntity(issuer, (db) => require('./books-store').giveBackNo(db, issuer, INVOICE_SERIES, '-', sequence));
}

/** numberOf({ country, purpose, prefix, sequence }) → the number as the seller's country writes it, CHECKED against that country's rule (docnumber.check: 16 characters and the charset for IN); a number that breaks it is refused, never printed */
function numberOf({ country, purpose, prefix, sequence }) {
  const number = docnumber.compose({ country, at: new Date(), kind: 'sale', prefix, seq: sequence });
  const verdict = docnumber.check(number, country);
  if (!verdict.ok) throw refused(409, 'NOTE_NUMBER_INVALID', NUMBER_WORDS + ' (' + verdict.reason + ')');
  return number;
}

/** the next number as the seller's country writes it: CN/26-27/0001 (IN: the FY label), DN/0001 (AU, AE: no label), the further invoice 0043 (the invoice series) — docnumber.compose, the one series builder, then docnumber.check */
async function nextNumber(issuer, purpose, country) {
  const sequence = await nextSequence(issuer, purpose, DOCUMENTS[purpose].prefix);
  return numberOf({ country, purpose, prefix: DOCUMENTS[purpose].prefix, sequence });
}

/** the original invoice, named: { chit_id, invoice_no, invoice_date, issuer } (+ the round that made the note) */
function againstOf(chit_id, original, issuerBridge, proposal_id) {
  const doc = (original.invoice && original.invoice.DocDtls) || {};
  return {
    chit_id: String(chit_id),
    invoice_no: original.bill_no || original.printed_as || original.invoice_no || doc.No || null,
    invoice_date: issuedAtOf(original),
    issuer: issuerBridge || null,
    proposal_id: String(proposal_id)
  };
}

/** isShopOwnSend(req) — is this send the shop's own loopback (lib/autoraise.sendAs: a 60-second token the server signs, kind auto)? The bearer is verified here again, never just decoded */
function isShopOwnSend(req) {
  const bearer = String((req && req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  try {
    const claims = require('jsonwebtoken').verify(bearer, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return !!claims && claims.kind === 'auto' && claims.auto === true;
  } catch (e) {
    return log.orElse('price-note: a bearer that is no valid token is not the shop own loopback; the send is judged as any other caller', false)(e);
  }
}

let sender = null;
/** tests: stand in for lib/autoraise.sendAs (null puts the real loopback back) */
function useSender(fn) {
  sender = fn || null;
}

/** the send's own words for a refusal, in brackets, or nothing */
const whyOf = (sent) => {
  const said = sent.body ? sent.body.message || sent.body.error : null;
  return said ? ' (' + said + ')' : '';
};

/**
 * the round's invoice as the NOTE's own e-invoice (INV-01): DocDtls is THIS document's type (CRN · DBN · INV), number and issue date; the original invoice goes in PrecDocDtls (InvNo, InvDt).
 * The money is carried byte for byte. ⚠️ the field names are from the GSTN e-invoice schema as remembered, NOT checked against the current schema PDF (unverified).
 */
function noteInvoice(invoice, purpose, printed_as, against, issuedOn) {
  return Object.assign({}, invoice, {
    DocDtls: { Typ: DOCUMENTS[purpose].typ, No: printed_as, Dt: issuedOn },
    PrecDocDtls: [{ InvNo: against.invoice_no, InvDt: against.invoice_date }]
  });
}

/** the send body of the note: the delta lines, the round's own invoice carried (restamped as the note's), the original named, the series number */
function bodyOf(args, purpose, printed_as, lines) {
  const { buyer, chit_id, row, original } = args;
  const against = againstOf(chit_id, original, args.issuerBridge, row.proposal_id);
  return {
    recipients: [{ entity_id: buyer, role: 'to' }],
    purpose,
    manual_subject: DOCUMENTS[purpose].title + ' ' + printed_as + (against.invoice_no ? ' against ' + against.invoice_no : ''),
    line_items: lines,
    business_json: { invoice: noteInvoice(row.invoice, purpose, printed_as, against, new Date().toISOString()), against, printed_as, currency: row.currency_code, customer: { entity_id: buyer } }
  };
}

/**
 * issue({ issuer, buyer, chit_id, row, copy, original, issuerBridge, country }) → { chit_id, duplicate } — ONE note chit at the seller's installation through the ONE send path: a credit note for a
 * lowering, the seller pack's document for a raise. The note carries the round's invoice (the delta the engine priced when it was proposed, byte for byte) so the send copies its money and prices
 * nothing again. A refused send is a refusal in words; nothing is applied by the caller then.
 */
async function issue(args) {
  const replay = await existingNote(args.issuer, args.chit_id, args.row.proposal_id); /* a replay finds its note BEFORE anything is priced: the live lines may have moved since */
  if (replay) return { chit_id: replay, duplicate: true };
  const delta = deltaOf(args.copy, args.row.edits);
  const purpose = purposeOf(delta.direction, args.country);
  return underSeriesLock(purpose, args.issuer, () => issueLocked(args, purpose, delta.lines));
}

/** the note under the series lock: the replay check, the number and the send are ONE critical section, so two notes cannot take the same number and a replay finds the first */
async function issueLocked(args, purpose, lines) {
  const { issuer, chit_id, row } = args;
  const found = await existingNote(issuer, chit_id, row.proposal_id);
  if (found) return { chit_id: found, duplicate: true };
  const prefix = DOCUMENTS[purpose].prefix;
  const sequence = await nextSequence(issuer, purpose, prefix);
  try {
    const body = bodyOf(args, purpose, numberOf({ country: args.country, purpose, prefix, sequence }), lines);
    const sent = await (sender || require('./autoraise').sendAs)(issuer, body, { idempotency_key: 'acc192-note:' + chit_id + ':' + row.proposal_id });
    if (!sent.ok) throw refused(409, 'CREDIT_NOTE_NOT_ISSUED', NOT_ISSUED_WORDS + whyOf(sent));
    return { chit_id: sent.body.chit_id, duplicate: false };
  } catch (e) {
    await giveBackNumber(issuer, prefix, sequence);
    throw e;
  }
}

/**
 * Hold ONE Postgres advisory lock per (document purpose, issuer) while a note takes its number AND is sent (the number is max+1 and the send is a loopback request in its own transaction, so a
 * transaction lock cannot span both). A session lock on a dedicated connection does, across processes; released in finally, and a dropped connection releases it. No migration; with no pool (tests) it runs plain.
 */
async function underSeriesLock(purpose, issuer, fn) {
  const pool = require('../db').pool;
  if (!pool || typeof pool.connect !== 'function') return fn();
  const client = await pool.connect();
  const key = 'note-series|' + purpose + '|' + issuer;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
    return await fn();
  } finally {
    const freed = await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).then(() => true, log.orElse('price-note: the series lock could not be released by name; the connection is closed instead, which frees it', false));
    client.release(!freed);
  }
}

module.exports = { isShopOwnSend, numberOf, noteInvoice, deltaLines, deltaOf, refuseAddedLines, refuseNotPayer, purposeOf, documentFor, issuedAtOf, existingNote, nextNumber, issue, underSeriesLock, againstOf, useSender };
