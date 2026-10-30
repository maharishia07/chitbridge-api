'use strict';
/**
 * lib/money-check.js — A MISMATCH IS OUR DEFECT, AND IT REACHES US (ACC-206 B · §2d · Athi 2026-10-30).
 * "if they disagree, raise it in any place wherever it is, find the mistake and say this is coming from this place" · "this is mostly the problem of
 * the logic … the shopper should know that the system didn't receive the right value and ask them to call the helpdesk" · "in fact it should reach us directly".
 *
 * OWNS    the COMPARE-and-RAISE for a chit's stored money: billTotalOf (the pick, plus the shop's sentence) and raise (the support ticket to the platform desk,
 *         the process counter /health reads, the one log line, the e-mail we already send). It COMPARES stored copies for equality — it never adds,
 *         subtracts or recomputes anything (tests/money-no-arithmetic.test.cjs scans this file for it).
 * CALLED BY lib/books-hooks.js (classify before a post, postChit raises), lib/books-nightly.js (the 6-hourly compare), routes/chits.js (send reads nothing: it writes the figures)
 * FLOW    header → counter-bill.pickOf (pure) → agree? nothing happens : raise → raiseticket.raise(audience 'platform', client_ref 'mismatch:<chit>:<field>')
 *         → the database refuses a second one (23505 → duplicate) → counter + log + mail (one per NEW ticket; a digest past 5 an hour)
 * ⚠️ The other party is NEVER involved: a mismatch is raised with US, from the shop to our support desk — not a dispute on the chit (DECISIONS 2026-10-30, plan Q9).
 * ⚠️ NEVER BEHIND A GET: raise is called on write paths and by the 6-hourly check; a screen paints "not confirmed" from the pick and writes nothing (critic C4).
 * CARD 14-accounting/README
 */
const counterBill = require('./counter-bill');
const log = require('./logger');

/** per process, since boot: tickets this process raised for a mismatch — GET /health carries it (cb-health reads it daily); a restart resets it, the log line is the durable record */
let raised = 0;
/** the mails sent in the current hour and whether the hour's digest has gone (no flood: 5 mails, then ONE digest, then silence until the hour turns) */
const MAIL = { hour: null, sent: 0, digested: false, overflow: [] };
const MAIL_PER_HOUR = 5;

/** the count /health reads */
function count() {
  return raised;
}

/**
 * billTotalOf(header) → the pick, with the shop's plain sentence when its copies disagree. header = { summary_json, business_json } of one copy.
 * { total, source, agree, legacy_net?, differs?, copies, says? } — a screen paints `agree: false` as NOT CONFIRMED and shows `says`; it never compares itself.
 */
function billTotalOf(header, helpDesk) {
  const picked = counterBill.pickOf(header);
  if (picked.agree) return picked;
  const call = helpDesk ? ' Urgent? Call ' + helpDesk + '.' : ' Urgent? Call the help desk.';
  return Object.assign({}, picked, { says: 'The system did not get the right value for this figure. We have been told and are on it.' + call });
}

/** the writer a stored copy names (summary_json.stamps), or the honest word for a chit written before stamps existed — never guessed */
function writerOf(header, field) {
  const stamps = (header.summary_json && header.summary_json.stamps) || null;
  const key = field === 'invoice' ? 'money' : field;
  if (!stamps || !stamps[key]) return { by: 'unstamped, before 30 Oct 2026' };
  return field === 'invoice' ? { by: 'tax engine', at: 'billing', via: stamps.money.where || null, engine: stamps.money.engine || null } : stamps[key];
}

/** the facts a support ticket carries: chit, field, each disagreeing value with its field and writer, the reader that saw it */
function factsOf(header, picked, reader) {
  const names = [picked.source].concat(picked.differs || []);
  const fieldOf = { invoice: 'business_json.invoice.ValDtls.TotInvVal', money: 'summary_json.money.total', total_value: 'summary_json.total_value' };
  return {
    chit_id: header.chit_id,
    field: 'total',
    values: names.map((name) => ({ value: picked.copies[name], field: fieldOf[name], writer: writerOf(header, name) })),
    reader: reader || 'unknown',
    at: new Date().toISOString(),
    key: 'mismatch:' + header.chit_id + ':total'
  };
}

/** the shop's identity for the raiser (the ticket is a chit FROM the shop to our desk) */
async function raiserOf(entity) {
  const { query } = require('../db');
  const found = await query('SELECT bridge_id, display_name, population FROM identities WHERE identity_id = $1', [entity]);
  const row = (found && found.rows && found.rows[0]) || {};
  return { entity_id: entity, bridge_id: row.bridge_id, display_name: row.display_name, population: row.population };
}

/** the sentence a ticket's subject carries: the two values, each with the place that wrote it */
function subjectOf(header, facts) {
  const text = facts.values.map((item) => item.field.split('.').pop() + ' ' + item.value + ' (' + (item.writer.by || '?') + ')').join(' ≠ ');
  return 'Figures disagree on chit ' + String(header.chit_id).slice(0, 8) + ': ' + text;
}

/**
 * mail(ticket) — one mail per NEW ticket; more than MAIL_PER_HOUR in an hour (any shop) → ONE digest listing them, then silence until the hour turns.
 * SUPPORT_ALERT_TO unset → the ticket and the /health counter still fire, and the log says the mail was skipped.
 */
async function mail(ticket) {
  const to = process.env.SUPPORT_ALERT_TO;
  if (!to) return log.warn('money.mismatch.mail-skipped', { why: 'SUPPORT_ALERT_TO is not set', ticket: ticket.ticket_id });
  const hour = new Date().toISOString().slice(0, 13);
  if (MAIL.hour !== hour) Object.assign(MAIL, { hour, sent: 0, digested: false, overflow: [] });
  if (MAIL.sent < MAIL_PER_HOUR) {
    MAIL.sent += 1;
    return require('./notify').sendSupportAlert(to, ticket);
  }
  MAIL.overflow.push(ticket);
  if (MAIL.digested) return null;
  MAIL.digested = true;
  return require('./notify').sendSupportAlert(to, { digest: true, tickets: MAIL.overflow });
}

/**
 * raise(entity, header, picked, reader) → { raised: true, ticket } | { raised: false, duplicate: true } | { raised: false, why }
 * Never throws: a failed raise is logged loud (money.mismatch.raise-failed) and the posting still waits in words — but a mismatch is never swallowed.
 */
async function raise(entity, header, picked, reader) {
  const facts = factsOf(header, picked, reader);
  log.warn('money.mismatch', { chit_id: header.chit_id, field: facts.field, values: facts.values, reader: facts.reader, entity_id: entity });
  try {
    const out = await require('./raiseticket').raise(await raiserOf(entity), { id: null, name: 'system' }, {
      kind: 'incident',
      audience: 'platform',
      ref: header.chit_id,
      subject: subjectOf(header, facts),
      detail: 'A stored money figure disagrees with another copy of the same engine figure. Values and writers are on the ticket (money_mismatch). The other party has not been told.',
      severity: 'Sev-2',
      client_ref: facts.key,
      money_mismatch: facts
    });
    if (out.duplicate) return { raised: false, duplicate: true };
    if (!out.raised) {
      log.error('money.mismatch.raise-failed', { chit_id: header.chit_id, why: out.why });
      return { raised: false, why: out.why };
    }
    raised += 1;
    const ticket = { ticket_id: out.chit_id, shop: header.shop || entity, chit_id: header.chit_id, facts };
    await mail(ticket).catch(log.orElse('money-check: the alert mail failed — the ticket and the counter still stand', null));
    return { raised: true, ticket: out.chit_id };
  } catch (e) {
    log.error('money.mismatch.raise-failed', { chit_id: header.chit_id, err: String(e && e.message) });
    return { raised: false, why: String(e && e.message) };
  }
}

/** the ways an overridden sale is resolved: it is right as issued (the person says why), or a credit note / a corrected bill (a chit) answers it */
const RESOLVE_WAYS = /^(confirmed|credit_note:[0-9a-f-]{36}|reissued:[0-9a-f-]{36})$/i;
const refusal = (code, message) => Object.assign(new Error(message), { code });

/**
 * resolve(entity, chit_id, body, by) → { resolved: true, how, duplicate } — closes the books to-do item of a sale the owner let through unbalanced.
 * An INSERT into the insert-only books_change_log (table 'money_override', field 'resolved', old = how, new = note); the chit is never rewritten and the
 * to-do drops it (one NOT EXISTS). Who may: the owner or an editor — the ROUTE's gate. A second resolve is a no-op that says so.
 */
async function resolve(entity, chit_id, body, by) {
  const settledHow = String((body && body.how) || '').trim();
  const note = String((body && body.note) || '').trim().slice(0, 500);
  if (!RESOLVE_WAYS.test(settledHow)) throw refusal('BOOKS_BAD_REQUEST', 'Say how it was settled: confirmed, or the credit note or corrected bill that answers it.');
  if (/^confirmed$/i.test(settledHow) && !note) throw refusal('BOOKS_BAD_REQUEST', 'Say why the sale is right as issued.');
  const store = require('./books-store');
  return require('../db').withEntity(entity, async (db) => {
    const state = await store.moneyOverrideState(db, entity, chit_id);
    if (!state || !state.held) throw refusal('BOOKS_NOT_FOUND', 'No sale let through unbalanced has that id.');
    if (state.resolved) return { resolved: true, how: settledHow, duplicate: true };
    await store.logChange(db, entity, { by, table_name: 'money_override', row_id: chit_id, field: 'resolved', old: settledHow, new: note });
    return { resolved: true, how: settledHow, duplicate: false };
  });
}

module.exports = { billTotalOf, raise, count, factsOf, subjectOf, resolve };
