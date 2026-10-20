// @stage tested
// @stage-note [BOOKS · MOVE IN · MATCH PROOF] every import keeps its proof: per document, per party, per account, per tax code, what landed,
// @stage-note what was held and why, the source country and their company id (DECISIONS 2026-10-18:64; move-in W1.10 · W1.4).
'use strict';
/**
 * lib/move-in-proof.js — THE MATCH PROOF OF A MOVE-IN (MOVE-IN-GAPS-REQUIREMENT W1.10 · W1.4, 2026-10-18). Migration b765 (a FILE — Athi runs it).
 * OWNS      build(plan, applied, ctx) → the proof (pure) · store(h, entity, rec) — one insert-only row in move_in_import, on the import's own
 *           transaction (rolled back with it) · companies(h, entity, source) — their company ids already moved in (W1.4) · list(h, entity) — read back
 * CALLED BY lib/move-in.js apply() (build + store) and world() (companies) · routes/books.js GET /move-in/imports (list)
 * CARD      14-accounting/move-in-from-xero-quickbooks · 23-connectors-and-integrations/xero-quickbooks-myob
 * FLOW      plan → apply → build(plan, applied) → store → { proof, proof_stored, import_id }
 * ⭐ NOTHING HERE COMPUTES MONEY: the amounts are the plan's own minor units (lib/move-in toMinor — money.round, the one rounder); the only
 *    subtraction is THEIR value against OURS, to SHOW a sub-minor-unit rounding ("rounded 0.004"), never to change what lands (DECISIONS:65).
 * ⚠️ BEFORE b765 RUNS: build() still answers the proof in the import's reply; store() answers { stored: false } and the reply says so in words.
 */
const schema = require('./schema');
const money = require('./money');

const TABLE = 'move_in_import';
const NOT_STORED = 'The proof is shown here but not kept yet — a database update (b765) is still to run.';
const LIST_MAX = 20;
/** the hold codes a plan row may carry (FIELDS.md "move-in hold codes") */
const HOLD_CODES = ['country', 'tax_code', 'rounding', 'bill_key', 'unit'];

const count = (value) => Number(value || 0);
const orNull = (value) => (value == null ? null : value);
/** their decimal value against our minor units → the part the one rounder took away, as a decimal string ('0.004'), or null when none */
function rounded_(theirs, oursMinor, currency) {
  if (theirs === '' || theirs == null) return null;
  const places = money.decimals(currency),
    given = Number(String(theirs).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(given)) return null;
  const roundedAway = Number((given - oursMinor / Math.pow(10, places)).toFixed(6));
  return roundedAway === 0 ? null : String(roundedAway);
}
/** our signed amount for a document (Dr +), or null when it carries none */
function oursMinor_(data) {
  return data.dr_minor || data.cr_minor ? count(data.dr_minor) - count(data.cr_minor) : null;
}
/** one document row (open invoices and bills) */
function docRow_(row, currency) {
  const data = row.data || {},
    ours = count(data.dr_minor) || count(data.cr_minor);
  return {
    line: row.line,
    what: row.what,
    action: row.action,
    code: row.code || null,
    why: row.why,
    bill_ref: data.bill_ref || null,
    ref_given: orNull(data.ref_given),
    party_id: data.party_id || null,
    ours_minor: oursMinor_(data),
    rounded: data.theirs != null ? rounded_(data.theirs, Math.abs(ours), currency) : null
  };
}
/** per party: what the documents landed for each (minor, Dr +) */
function perParty_(docs) {
  const byParty = new Map();
  docs
    .filter((doc) => doc.party_id && doc.action === 'add')
    .forEach((doc) => {
      const party = byParty.get(doc.party_id) || { party_id: doc.party_id, documents: 0, net_minor: 0 };
      party.documents++;
      party.net_minor += count(doc.ours_minor);
      byParty.set(doc.party_id, party);
    });
  return Array.from(byParty.values());
}
/** per tax code seen in the file: what our pack made of it (from the plan's taxCodes) */
function perTaxCode_(plan) {
  return (plan.tax_codes || []).map((seen) => ({ code: seen.code, verdict: seen.verdict, kind: seen.kind || null, rate: orNull(seen.rate) }));
}
/** per account (chart and trial balance rows) */
function perAccount_(plan) {
  if (plan.kind !== 'accounts' && plan.kind !== 'trial_balance') return [];
  return plan.rows
    .filter((row) => row.data && (row.data.code || row.data.group_code || row.data.account_id))
    .map((row) => ({
      line: row.line,
      what: row.what,
      action: row.action,
      our_code: row.data.code || null,
      their_code: row.data.source_code || null,
      dr_minor: orNull(row.data.dr_minor),
      cr_minor: orNull(row.data.cr_minor)
    }));
}
/** per contact: their id beside the row (W1.8) */
function perContact_(plan) {
  if (plan.kind !== 'contacts') return [];
  return plan.rows.map((row) => {
    const data = row.data || {};
    return { line: row.line, what: row.what, action: row.action, source_ref: data.source_ref || (data.sets || {}).source_ref || null };
  });
}
/** the rows held, each with its code and sentence */
function held_(plan) {
  return plan.rows.filter((row) => row.action === 'hold').map((row) => ({ line: row.line, what: row.what, code: row.code, why: row.why }));
}
/** where the books came from: the source, its country and how we know it, the shop's country, their company id */
function origin_(plan) {
  const where = plan.country || {};
  return {
    source: plan.source,
    source_country: where.source || null,
    country_how: where.how || null,
    shop_country: where.shop || null,
    company_id: plan.company_id || null
  };
}

/**
 * build(plan, applied, ctx) → the proof of ONE import (one file, one kind): { source, source_country, country_how, shop_country, company_id, kind, side,
 * as_at, currency, counts, landed, held[], documents[], parties[], accounts[], tax_codes[], contacts[], differences }. `differences` = rows that did not
 * land as planned (held + skipped): 0 when everything that belongs landed and every held item says why.
 */
function build(plan, applied, ctx) {
  const context = ctx || {},
    landed = applied || {},
    currency = context.currency || null;
  const docs = plan.kind === 'open_bills' ? plan.rows.map((row) => docRow_(row, currency)) : [];
  return Object.assign(origin_(plan), {
    kind: plan.kind,
    side: plan.side || null,
    as_at: context.as_at || null,
    currency,
    counts: plan.counts,
    landed: { added: count(landed.added), merged: count(landed.merged), skipped: count(landed.skipped), held: count(landed.held) },
    held: held_(plan),
    documents: docs,
    parties: perParty_(docs),
    accounts: perAccount_(plan),
    tax_codes: perTaxCode_(plan),
    contacts: perContact_(plan),
    differences: count(landed.skipped) + count(landed.held)
  });
}

/** store(conn, entity, rec) — one row on the import's transaction → { stored, import_id, why } (before b765: stored false, said) */
async function store(conn, entity, rec) {
  if (!(await schema.hasTable(TABLE))) return { stored: false, import_id: null, why: NOT_STORED };
  const proof = rec.proof;
  const inserted = await conn.query(
    `INSERT INTO move_in_import (entity_id, source, company_id, source_country, country_how, kind, side, as_at, counts, proof, created_by)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11) RETURNING import_id`,
    [
      entity,
      proof.source,
      proof.company_id,
      proof.source_country,
      proof.country_how,
      proof.kind,
      proof.side,
      proof.as_at,
      JSON.stringify(proof.landed),
      JSON.stringify(proof),
      rec.by || null
    ]
  );
  return { stored: true, import_id: inserted.rows[0].import_id, why: null };
}
/** their company ids already moved in for this shop and system (W1.4) — [] before b765 */
async function companies(conn, entity, source) {
  if (!(await schema.hasTable(TABLE))) return [];
  const found = await conn.query(`SELECT DISTINCT company_id FROM move_in_import WHERE entity_id = $1 AND source = $2 AND company_id IS NOT NULL`, [
    entity,
    source
  ]);
  return found.rows.map((row) => row.company_id);
}
/** the latest imports with their proofs → { ready, why, imports[] } */
async function list(conn, entity) {
  if (!(await schema.hasTable(TABLE))) return { ready: false, why: NOT_STORED, imports: [] };
  const found = await conn.query(
    `SELECT import_id, source, company_id, source_country, country_how, kind, side, as_at, counts, proof, created_at FROM move_in_import
                           WHERE entity_id = $1 ORDER BY created_at DESC LIMIT ${LIST_MAX}`,
    [entity]
  );
  return { ready: true, why: null, imports: found.rows };
}

module.exports = { build, store, companies, list, HOLD_CODES, NOT_STORED, TABLE };
