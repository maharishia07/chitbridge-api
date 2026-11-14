'use strict';
/**
 * lib/money-check.js — A MISMATCH IS OUR DEFECT, AND IT REACHES US (ACC-206 B · §2d · Athi 2026-10-30).
 * "if they disagree, raise it in any place wherever it is, find the mistake and say this is coming from this place" · "this is mostly the problem of
 * the logic … the shopper should know that the system didn't receive the right value and ask them to call the helpdesk" · "in fact it should reach us directly".
 *
 * OWNS    the COMPARE-and-RAISE for a chit's stored money: billTotalOf (the pick, plus the shop's sentence), billTotalWire (the `bill_total` key a chit list and detail carry) and raise (the support ticket to the platform desk,
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

/** the shop's plain sentence when a bill's figures disagree (written once: a screen paints it, never composes it) */
function mismatchSays(helpDesk) {
  const call = helpDesk ? ' Urgent? Call ' + helpDesk + '.' : ' Urgent? Call the help desk.';
  return 'The system did not get the right value for this figure. We have been told and are on it.' + call;
}

/**
 * billTotalOf(header) → the pick, with the shop's plain sentence when its copies disagree. header = { summary_json, business_json } of one copy.
 * { total, source, agree, legacy_net?, differs?, copies, says? } — a screen paints `agree: false` as NOT CONFIRMED and shows `says`; it never compares itself.
 */
function billTotalOf(header, helpDesk) {
  const picked = counterBill.pickOf(header);
  return picked.agree ? picked : Object.assign({}, picked, { says: mismatchSays(helpDesk) });
}

/** the currency codes the stored copies name (upper-case, de-duplicated): the header's, the money block's and the engine invoice's */
function currenciesOf(header) {
  const summary = (header && header.summary_json) || {};
  const invoice = header && header.business_json && header.business_json.invoice;
  const named = [summary.currency_code, summary.money && summary.money.currency_code, invoice && invoice.currency];
  return [...new Set(named.filter((code) => typeof code === 'string' && code).map((code) => code.toUpperCase()))];
}

/**
 * billTotalWire(header) → the per-row key a chit list and the chit detail carry as `bill_total` (ACC-348a): { total, agree, source, currency_code, says? }.
 * The pick is the ONE pick (counter-bill.pickOf); the stored copies themselves are never shipped. Two different currency codes among the copies are a disagreement
 * too (equal numbers in two currencies are not equal). It READS: nothing is raised here (never behind a GET, see the header), a screen only paints it.
 */
function billTotalWire(header, helpDesk) {
  const picked = counterBill.pickOf(header);
  const codes = currenciesOf(header);
  const agree = picked.agree && codes.length <= 1;
  const wire = { total: picked.total, agree, source: picked.source, currency_code: picked.source === 'withheld' ? null : codes[0] || null };
  return agree ? wire : Object.assign(wire, { says: mismatchSays(helpDesk) });
}

/** a chit LIST row's stored figures (the select carries summary_json + invoice_total + invoice_currency, no business_json) as the header pickOf reads: the credit-cap.totalOf pattern */
function headerOfListRow(row) {
  return { summary_json: row.summary_json, business_json: { invoice: { ValDtls: { TotInvVal: row.invoice_total }, currency: row.invoice_currency } } };
}

/** the list select's two invoice columns, beside the row's summary_json (sql fragment; `alias` = the chit_header alias) */
const listInvoiceColumnsSql = (alias) => `${alias}.business_json #> '{invoice,ValDtls,TotInvVal}' AS invoice_total, ${alias}.business_json #>> '{invoice,currency}' AS invoice_currency`;

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
  return fileTicket(entity, header.chit_id, subjectOf(header, facts), 'A stored money figure disagrees with another copy of the same engine figure. Values and writers are on the ticket (money_mismatch). The other party has not been told.', facts);
}

/**
 * raisePair(entity, pair, facts) — CTR-211: at SEND, the carried invoice's bridge step and its figure disagree (nothing is stored; there is no chit yet).
 * Same ticket path as raise (platform desk, key = hash of shop + bill + pair + both minor values, client_ref only a fact, /health counter, one mail per new ticket); the facts carry the shop,
 * the bill reference, the pair with both values and the engine version.
 */
async function raisePair(entity, pair, facts) {
  const bill = String(facts.bill || 'unnumbered');
  const unique = require('crypto').createHash('sha1').update([entity, bill, pair.pair, pair.bridge_minor, pair.carried_minor].join('|')).digest('hex').slice(0, 16); /* the bill's own figures, never the till's client_ref: a retry under a new ref is the same bill (client_ref rides the ticket as a fact) */
  const record = { ...facts, shop: entity, pair: pair.pair, bridge_field: pair.bridge_field, carried_field: pair.carried_field, bridge_minor: pair.bridge_minor, carried_minor: pair.carried_minor, at: new Date().toISOString(), key: 'mismatch:send:' + entity + ':' + bill + ':' + unique + ':' + pair.pair };
  log.warn('money.mismatch.send', record);
  const subject = 'Send refused, ' + pair.pair + (pair.missing ? ' ' + pair.missing + ' missing' : ' disagrees') + ' on bill ' + bill + ': ' + pair.bridge_field + ' ' + pair.bridge_minor + ' vs ' + pair.carried_field + ' ' + pair.carried_minor + ' (minor units)';
  return fileTicket(entity, null, subject, 'The invoice the counter sent carries the same engine figure twice and the copies differ, so the bill was refused before it was stored. Facts are on the ticket (money_mismatch).', record);
}

/** the one filing: the ticket from the shop to the platform desk, the counter, the mail — shared by raise (stored copies) and raisePair (at send). Never throws. */
async function fileTicket(entity, ref, subject, detail, facts) {
  try {
    const out = await require('./raiseticket').raise(await raiserOf(entity), { id: null, name: 'system' }, {
      kind: 'incident',
      audience: 'platform',
      ref,
      subject,
      detail,
      severity: 'Sev-2',
      client_ref: facts.key,
      money_mismatch: facts
    });
    if (out.duplicate) return { raised: false, duplicate: true };
    if (!out.raised) {
      log.error('money.mismatch.raise-failed', { ref, why: out.why });
      return { raised: false, why: out.why };
    }
    raised += 1;
    const ticket = { ticket_id: out.chit_id, shop: entity, chit_id: ref, facts };
    await mail(ticket).catch(log.orElse('money-check: the alert mail failed — the ticket and the counter still stand', null));
    return { raised: true, ticket: out.chit_id };
  } catch (e) {
    log.error('money.mismatch.raise-failed', { ref, err: String(e && e.message) });
    return { raised: false, why: String(e && e.message) };
  }
}

/**
 * raiseMissingBridge(entity, found, facts) — CTR-246: at SEND a till build that always sends the bridge sent an invoice without it (nothing is stored). The SAME filing as raisePair
 * (one fileTicket); a bill cannot raise both (the pair check needs a bridge, this one needs none). Key = shop + bill + build, so a retry under a new client_ref is one ticket.
 */
async function raiseMissingBridge(entity, found, facts) {
  const bill = String(facts.bill || 'unnumbered');
  const record = { ...facts, shop: entity, build: found.build, at: new Date().toISOString(), key: 'bridge:send:' + entity + ':' + require('crypto').createHash('sha1').update([entity, bill, 'bridge', found.build].join('|')).digest('hex').slice(0, 16) };
  log.warn('money.bridge_missing.send', record);
  return fileTicket(entity, null, 'Send refused, bridge missing on bill ' + bill + ' from till build ' + found.build, 'The counter sent an invoice without its _cb.bridge although its build always sends one, so the bill was refused before it was stored. Facts are on the ticket (money_mismatch).', record);
}

/**
 * raiseDrift(entity, drift, facts) — CTR-244 (CTR-212 S3): at SEND a bill's prices were out of date when the sale was rung (the row's commercial_changed_at is before the sale and the carried
 * figure differs from the row's). The bill is STORED as sold; this is the ONE ticket that says so, filed AFTER the store (the till retries any non-ok answer for ever, so this never refuses and
 * never throws: fileTicket swallows). `drift` = { lines: [{ item_id, name, reason, carried, row, changed_at, date_unknown? }], billed_at, snapshot_at }; the facts ride as money_mismatch.price_drift.
 * Key = shop + bill + each line's item, carried price and the row's stamp (never client_ref: a retry gets a new one), so a replay is the same ticket and a second bill is a second ticket.
 */
async function raiseDrift(entity, drift, facts) {
  const bill = String(facts.bill || 'unnumbered');
  const lines = Array.isArray(drift.lines) ? drift.lines : [];
  const parts = lines.map((line) => [line.item_id, line.carried && line.carried.price_minor, line.carried && line.carried.gst_rate, line.changed_at].join(':')).sort();
  const unique = require('crypto').createHash('sha1').update([entity, bill].concat(parts).join('|')).digest('hex').slice(0, 16);
  const record = { ...facts, shop: entity, price_drift: { lines, billed_at: drift.billed_at || null, snapshot_at: drift.snapshot_at || null }, at: new Date().toISOString(), key: 'drift:send:' + entity + ':' + bill + ':' + unique };
  log.warn('money.price_drift.send', { entity_id: entity, bill, lines: lines.length });
  const unknown = lines.some((line) => line.date_unknown);
  const subject = 'Prices out of date on bill ' + bill + ': ' + lines.length + (lines.length === 1 ? ' item' : ' items');
  const detail = 'The counter rang this bill at prices or tax rates the shop had already changed. The bill is stored as sold and nothing was re-priced. Items and both figures are on the ticket (money_mismatch.price_drift).' + (unknown ? ' A product the shop no longer holds has no change date, so it is listed either way (date unknown).' : '');
  return fileTicket(entity, null, subject, detail, record);
}

/** the ways an overridden sale is resolved: it is right as issued (the person says why), or a credit note / a corrected bill (a chit) answers it */
const RESOLVE_WAYS = /^(confirmed|credit_note:[0-9a-f-]{36}|reissued:[0-9a-f-]{36})$/i;
/** a refusal the books route maps (lib/books-contract refusalOf): BOOKS_BAD_REQUEST → 400, BOOKS_NOT_FOUND → 404 */
function refusal(kind, message) {
  const problem = new Error(message);
  problem.code = kind;
  return problem;
}

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

module.exports = { billTotalOf, billTotalWire, headerOfListRow, listInvoiceColumnsSql, raise, raisePair, raiseMissingBridge, raiseDrift, count, factsOf, subjectOf, resolve, raiserOf };
