'use strict';
/**
 * lib/price-drift.js — THE SERVER'S DRIFT CHECK AT SEND (CTR-244, CTR-212 S3). Was a price, a rate or a product out of date when the sale was rung? Says so ONCE, never touches the bill.
 *
 * OWNS      driftOf(bill, rows, currency) → { skip } | { lines[], unknown, billed_at, snapshot_at } · answeredOf(business_json) → the reason a bill is exempt, or null · DRIFT_ROWS_SQL · readRows(entity, ids, withEntity)
 * CALLED BY routes/chits.js (sendPriceDrift, after the bill is stored) · lib/money-check.js raiseDrift files the one ticket from the lines this returns
 * FLOW      carried lines + the shop's rows (ONE read, items ANY($2)) → the same three tests as the counter's own gate (till.html staleWindow / staleReason, CTR-243): the row's
 *           commercial_changed_at (b845) is at or before billed_at and after the counter's snapshot, AND the carried figure differs from the row's → one fact per line
 * CARD      09-counter/README
 *
 * ⚠️ READS ONLY: two carried numbers are compared for equality (the minor unit of both); nothing is summed, re-priced or rounded, and the stored bill is the sale (REV-02, TILL-41).
 * ⚠️ NEVER A REFUSAL: the caller runs after the store and the till retries any non-ok answer for ever. A bill already answered (the shopkeeper saw it: stale_ack, kept, stale_unchecked, an
 * offline or failed check, an owner's money_override or credit_override) is exempt; a bill from a till build that never sent price_basis is exempt (it cannot say what it checked).
 * ⚠️ THE CLOCK is the till's (billed_at). A fast till clock hides a drift (no ticket); it never invents one. The same two minutes of slack as the counter's gate lean toward a ticket.
 * ⚠️ NAMED LIMITS: a line with chosen modifiers is compared on its rate only (its shelf price is the carried price minus the choices: a sum, which this file never does); a rate that
 * comes from a slab on the shelf (the row carries no gst_rate of its own) is the counter's gate to read, not this file's; a status change is not compared.
 */
const { commercialOf } = require('./till-row');
const { toMinor } = require('./books-cashflow');
const { UUID_RE } = require('./trace');

/** the same slack the counter's gate allows (till.html STALE_SKEW_MS), toward a ticket, never toward a miss */
const SKEW_MS = 120000;
/** why a bill is already answered, by name (price_basis.reason values the counter writes when it could not check) */
const UNCHECKED_REASONS = ['offline', 'recheck_failed'];
/** the one read: the rows the bill names, with the one commercial stamp (b845); an old database answers 42703 and the read is repeated without the column */
const DRIFT_ROWS_SQL = 'SELECT item_id, item_data, is_active, commercial_changed_at FROM catalogue_items WHERE entity_id = $1 AND item_id = ANY($2::uuid[])';
const DRIFT_ROWS_OLD_SQL = 'SELECT item_id, item_data, is_active FROM catalogue_items WHERE entity_id = $1 AND item_id = ANY($2::uuid[])';

/** the rows of these product ids → Map(item_id → row); ONE query in one transaction */
async function readRows(entity, ids, withEntity) {
  const read = async (sql) => withEntity(entity, (db) => db.query(sql, [entity, ids]));
  let found;
  try {
    found = await read(DRIFT_ROWS_SQL);
  } catch (e) {
    if (!e || e.code !== '42703') throw e;
    found = await read(DRIFT_ROWS_OLD_SQL);
  }
  return new Map(found.rows.map((row) => [String(row.item_id), row]));
}

/** why a bill's own price_basis says it was already answered (the shopkeeper saw it, the check could not run and said so), or null */
function basisAnswered(basis) {
  if (basis.stale_ack) return 'stale_ack';
  if (basis.stale_unchecked) return 'stale_unchecked';
  if (Array.isArray(basis.kept) ? basis.kept.length : basis.kept) return 'kept';
  return UNCHECKED_REASONS.includes(basis.reason) ? basis.reason : null;
}

/** the reason this bill needs no ticket, or null when it is judged: the shopkeeper already saw it, the owner overrode it, or the till build never sends price_basis */
function answeredOf(business_json) {
  const bill = business_json || {};
  const basis = bill.price_basis && typeof bill.price_basis === 'object' ? bill.price_basis : null;
  if (bill.money_override) return 'money_override';
  if (bill.credit_override) return 'credit_override';
  if (!basis) return bill.till && bill.till.build ? null : 'old_till_build';
  return basisAnswered(basis);
}

/** the ids a bill names that are this shop's own catalogue products (a free line, a network line and a mistyped id are none of them) → { ids, other } (other = ids that are not uuids, counted) */
function catalogueIdsOf(lines) {
  const ids = [];
  let other = 0;
  for (const line of Array.isArray(lines) ? lines : []) {
    const id = line && line.item_id != null ? String(line.item_id) : '';
    if (!id || /^src:/.test(id)) continue;
    if (!UUID_RE.test(id)) {
      other += 1;
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids, other };
}

/** rules a and b for one change moment (ISO): at or before the sale (plus the slack) and after the counter's snapshot → true, false, or null when a moment cannot be read */
function changedInWindow(changedAt, billedMs, snapMs) {
  const changed = Date.parse(changedAt);
  if (Number.isNaN(changed) || Number.isNaN(billedMs)) return null;
  return changed <= billedMs + SKEW_MS && (Number.isNaN(snapMs) || changed > snapMs);
}

/** do two carried figures name the same amount? (equality of the minor unit of each; a missing figure is not a difference) */
function sameAmount(carried, current, currency) {
  if (carried == null || current == null) return true;
  return toMinor(carried, currency) === toMinor(current, currency);
}

/** the shelf price a line was rung from and its rate, as the counter carried them: { price, gst_rate } (a rate left blank is null: nobody said) */
function carriedOf(line) {
  return { price: line.list_price != null ? line.list_price : line.price, gst_rate: line.gst_rate != null && line.gst_rate !== '' ? Number(line.gst_rate) : null };
}

/** which figure of the line moved against the row now → { reason, priceMoved, rateMoved } or null. A line with chosen modifiers is compared on its rate only (named limit). */
function movedOf(line, current, currency) {
  const carried = carriedOf(line);
  const priceMoved = !(line.mods && line.mods.length) && !sameAmount(carried.price, current.price, currency);
  const rateMoved = carried.gst_rate !== null && current.gst_rate !== null && carried.gst_rate !== current.gst_rate;
  return priceMoved || rateMoved ? { reason: rateMoved ? 'rate_moved' : 'price_moved', priceMoved } : null;
}

/** the fact one moved line becomes: both carried figures side by side, in minor units for the price (never a total) */
function factOf(line, row, current, moved, currency) {
  const carried = carriedOf(line);
  return {
    item_id: String(line.item_id),
    name: line.name || null,
    reason: moved.reason,
    carried: { price_minor: moved.priceMoved ? toMinor(carried.price, currency) : null, gst_rate: carried.gst_rate },
    row: { price_minor: moved.priceMoved && current.price != null ? toMinor(current.price, currency) : null, gst_rate: current.gst_rate },
    changed_at: new Date(row.commercial_changed_at).toISOString()
  };
}

/** one line against its row → null (nothing to say), { unknown } (no stamp can say when), or the fact: { item_id, name, reason, carried, row, changed_at, date_unknown? } */
function lineFact(line, row, ctx) {
  if (!row) return { item_id: String(line.item_id), name: line.name || null, reason: 'not_found', carried: null, row: null, changed_at: null, date_unknown: true };
  if (row.is_active === false) return null;
  const inWindow = row.commercial_changed_at ? changedInWindow(row.commercial_changed_at, ctx.billedMs, ctx.snapMs) : null;
  if (inWindow === null) return { unknown: true };
  if (!inWindow) return null;
  const current = commercialOf(row.item_data);
  const moved = movedOf(line, current, ctx.currency);
  return moved ? factOf(line, row, current, moved, ctx.currency) : null;
}

/** every line of a bill that names a catalogue product, judged against its row → { lines: [facts], unknown: number } */
function judgeLines(lines, rows, ctx) {
  const out = { lines: [], unknown: 0 };
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!line || !catalogueIdsOf([line]).ids.length) continue;
    const fact = lineFact(line, rows.get(String(line.item_id)), ctx);
    if (fact && fact.unknown) out.unknown += 1;
    else if (fact) out.lines.push(fact);
  }
  return out;
}

/**
 * a whole bill against its rows → { skip } when nothing is judged, else { lines: [facts], unknown: number }. `bill` = { lines, business_json }; `rows` = Map(item_id → row).
 * A product the shop's catalogue no longer holds (hard-deleted: no date, b845 stamps an UPDATE only) is a fact with date_unknown, for ids that ARE catalogue ids (uuid), never a free line.
 */
function driftOf(bill, rows, currency) {
  const business = bill.business_json || {};
  const answered = answeredOf(business);
  if (answered) return { skip: answered };
  const billedMs = Date.parse(business.billed_at);
  if (Number.isNaN(billedMs)) return { skip: 'no_billed_at' };
  const basis = business.price_basis && typeof business.price_basis === 'object' ? business.price_basis : {};
  return judgeLines(bill.lines, rows, { billedMs, snapMs: Date.parse(basis.snapshot_at), currency });
}

/** the minor unit of the shelf price a line carried, or null when it carried none (CTR-245 names a withdrawn line by it) */
function carriedPriceMinor(line, currency) {
  const price = carriedOf(line).price;
  return price == null ? null : toMinor(price, currency);
}

module.exports = { lineFact, carriedPriceMinor, driftOf, answeredOf, catalogueIdsOf, readRows, changedInWindow, DRIFT_ROWS_SQL, SKEW_MS };
