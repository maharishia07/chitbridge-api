'use strict';
// lib/amend.js — line-level corrections, and THE LIVE SET (b138).
//
// Athi, 2026-08-11: *"just new line item, with all the amendments"* and *"old line deleted and new line is
// nothing — assume if the stock is not available the sku line will become empty."*
//
// ── ⚠️ NOTHING HERE MUTATES A CHIT ──────────────────────────────────────────────────────────────────────────────
// `chit_detail.line_items` keeps what the reader produced, forever. A correction is a NEW row carrying a whole
// replacement line, and the screen shows the old one struck through above it. Both remain true statements about
// different moments — a chit that quietly became right is indistinguishable from one that was always right, and
// only one of those can be defended six weeks into an argument.
//
// ── ⭐ THE LIVE SET IS THE POINT OF THIS FILE ───────────────────────────────────────────────────────────────────
//        live set  =  original lines  −  removed  +  latest replacement per line
// EVERY total, view and sum must compute from it. A forecast built on the original reading tells him to buy what
// the machine misheard. This is not a display concern.
//
// ── ⚠️ REMOVAL IS null, NOT ZERO ────────────────────────────────────────────────────────────────────────────────
// `line: null` says "this is not happening". `quantity: 0` says "zero crates" — a real number that leaks into
// totals. One operation covers amend and remove, so there is no second path to keep honest.
const { withEntity, onEntity } = require('../db');

const notMigrated = (e) => e && (e.code === '42P01' || e.code === '42703');
const gone = () => { const x = new Error('Amendments are not migrated on this environment (b138).'); x.status = 503; return x; };

/** The fields a replacement line may carry — the same shape chit_detail.line_items uses. */
const LINE_FIELDS = ['particulars', 'quantity', 'unit', 'unit_size', 'price', 'comment'];
/* ⚠️ `ambiguity_resolved` IS NOT `misread_by_ai`, and the difference is the whole record. "Misread" says the
   machine got it wrong; this says the machine was RIGHT to refuse — the sender's words genuinely answered to more
   than one catalogue item — and a named person chose between them. Filing a resolution as a misreading would
   blame the reader for the customer's ambiguity, and six weeks later the trail would say the AI erred when it did
   the one correct thing available to it. */
const REASONS = ['misread_by_ai', 'customer_clarified', 'rate_agreed', 'stock_unavailable', 'ambiguity_resolved', 'other'];

const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : undefined; };

/**
 * clean(line) — accept only the known shape, coerced.
 *
 * ⚠️ REJECTS A NON-NUMERIC QUANTITY RATHER THAN COERCING IT. Number("2 box") is NaN, which would store as null and
 * read on screen as "no quantity" — the correction would look applied and the line would be worse than before
 * anyone touched it.
 * ⚠️ AND IT DROPS UNKNOWN KEYS. line_items is jsonb, so whatever is handed in is what gets stored — that is
 * precisely how 45 chits on beta ended up with {description, qty, rate}, a shape no downstream reader understands.
 * Rejecting the shape in one place beats tolerating it in four.
 */
function clean(line) {
  if (line === null || line === undefined) return null;              // removal
  const out = {};
  for (const f of LINE_FIELDS) {
    if (line[f] === undefined) continue;
    if (f === 'quantity' || f === 'price') {
      const n = num(line[f]);
      if (n === undefined) { const e = new Error('"' + f + '" must be a number — got "' + line[f] + '"'); e.status = 400; throw e; }
      if (n !== null) out[f] = n;
      continue;
    }
    const s = String(line[f]).trim();
    if (s) out[f] = s;
  }
  /**
   * ⚠️ `ref` IS HANDLED SEPARATELY BECAUSE THE LOOP ABOVE WOULD DESTROY IT. Every other field is coerced with
   * String(), and String({item_id:…}) is "[object Object]" — the correction would save, the line would look
   * amended, and the reference would be a five-word string that matches nothing forever. Exactly the class of
   * silent shape damage this function's own comment was written about.
   *
   * ⚠️ AND ONLY THE THREE KNOWN KEYS TRAVEL. A picker posting the whole catalogue row would put a price object,
   * a status and a synonym list inside the reference, where nothing reads them and everything must keep them.
   */
  /**
   * ⭐ THE LOT — which consignment this line actually is. GS1 (10) batch · (17) expiry · (21) serial.
   *
   * ⚠️ IT IS ON THE LINE, NOT THE CATALOGUE ITEM, and that is the whole correction. A batch on the product means a
   * new product per lot; a batch on the movement means one product with many consignments, which is what is
   * actually true. gs1.lotOf() decides the shape — one definition, so a lot recorded by a person and a lot read
   * off a delivery note cannot disagree about what a batch is.
   */
  if (line.lot !== undefined) {
    const lot = require('./gs1').lotOf(line.lot);
    if (lot) out.lot = lot;
  }
  if (line.ref && typeof line.ref === 'object' && !Array.isArray(line.ref)) {
    const r = {};
    if (line.ref.item_id) r.item_id = String(line.ref.item_id).slice(0, 64);
    if (line.ref.sku) r.sku = String(line.ref.sku).slice(0, 64);
    /* ⚠️ THE MOMENT TRAVELS TOO. Whitelisting only the ids would have quietly dropped as_of and hash on the one
       path where a PERSON fixed the base — leaving the strongest resolution as the only one that could not say
       what the item was when it was chosen. */
    if (line.ref.as_of) r.as_of = String(line.ref.as_of).slice(0, 40);
    if (line.ref.hash) r.hash = String(line.ref.hash).slice(0, 64);
    /* Defaulted, not inferred: an amendment that carries a reference got it from a person choosing. */
    r.how = ['exact', 'synonym', 'contains', 'fuzzy', 'picked', 'human'].includes(line.ref.how) ? line.ref.how : 'human';
    if (r.item_id || r.sku) out.ref = r;
  }
  if (!out.particulars) { const e = new Error('A replacement line needs an item. To remove the line, send line: null.'); e.status = 400; throw e; }
  if (out.quantity != null && out.price != null) out.total = Math.round((out.quantity * out.price + Number.EPSILON) * 100) / 100;
  return out;
}

/**
 * record(entity_id, chit_id, edits, who) — append corrections.
 *
 * `edits` = [{ line_index, line: {...} | null, reason_code, reason }]
 *
 * ⚠️ seq IS COMPUTED INSIDE THE TRANSACTION, from what is already stored. Taking it from the client would let two
 * taps in a bad-signal market produce two rows claiming to be the same step, and the "latest" would then depend on
 * row order rather than on what happened.
 */
async function record(entity_id, chit_id, edits, who = {}) {
  const rows = (Array.isArray(edits) ? edits : [edits]).filter(Boolean);
  if (!rows.length) { const e = new Error('Nothing to amend'); e.status = 400; throw e; }
  const prepared = rows.map((r) => {
    const idx = Number(r.line_index);
    if (!Number.isInteger(idx) || idx < 0) { const e = new Error('line_index must be a line number'); e.status = 400; throw e; }
    return { idx,
             /* b142: a correction names the LINE, not a position. line_index is still accepted and still stored,
                because every pre-b142 amendment is addressed that way and dropping it would strand them. */
             line_id: r.line_id || null,
             line: clean(r.line === null ? null : r.line),
             reason_code: REASONS.includes(r.reason_code) ? r.reason_code : 'other',
             reason: r.reason ? String(r.reason).slice(0, 300) : null };
  });
  try {
    return await withEntity(entity_id, async (db) => {
      const out = [];
      for (const p of prepared) {
        const q = await db.query(
          `INSERT INTO chit_line_amendment (chit_id, entity_id, line_index, line_id, seq, line, reason_code, reason, actor_id, actor_name)
           SELECT $1,$2,$3,$4::uuid,
                  COALESCE((SELECT MAX(seq) FROM chit_line_amendment
                             WHERE entity_id=$2 AND chit_id=$1 AND line_index=$3), 0) + 1,
                  $5::jsonb,$6,$7,$8,$9
           RETURNING amendment_id, line_index, line_id, seq, line, reason_code, reason, actor_name, created_at`,
          [chit_id, entity_id, p.idx, p.line_id, p.line === null ? null : JSON.stringify(p.line),
           p.reason_code, p.reason, who.actor_id || null, who.actor_name || null]);
        out.push(q.rows[0]);
        /* ⚠️ THE LIVE ROW FOLLOWS, IN THE SAME TRANSACTION. Audit and state land together or not at all — a
           correction that logged but did not apply would read as done and change nothing. Silent no-op before
           b142, which is correct: with no chit_line there is no live row to move, and liveSet() still computes
           the same answer by replaying the audit over the frozen payload. */
        await writeLine(db, entity_id, chit_id, p.line_id, p.line, p.reason_code);
      }
      return { amendments: out };
    });
  } catch (e) { if (e.status) throw e; if (notMigrated(e)) throw gone(); throw e; }
}

/**
 * ⭐ readLines(entity_id, chit_id) — the LIVE lines, as rows (b142).
 *
 * ⚠️ RETURNS null WHEN b142 IS NOT APPLIED, and that is the contract: callers fall back to replaying amendments
 * over `chit_detail.line_items`. The same answer, computed two ways, so the feature works on both sides of the
 * migration and neither path is a special case that only runs once.
 *
 * ⚠️ ORDERED BY seq, THEN line_id. Two lines sharing a seq would otherwise come back in whatever order the planner
 * chose — "the one you selected comes as the last record", in a new coat.
 */
async function readLines(entity_id, chit_id, _db, _rows) {
  if (_rows) return _shapeLines(_rows);
  try {
    const r = await onEntity(entity_id, _db, (db) => db.query(
      `SELECT line_id, seq, particulars, quantity, unit, unit_size, price, comment,
              asked_as, asked_unit, raw_phrase, removed, removed_reason, needs_human, flags
         FROM chit_line WHERE entity_id = $1 AND chit_id = $2 ORDER BY seq, line_id`, [entity_id, chit_id]));
    return _shapeLines(r.rows);
  } catch (e) { if (notMigrated(e)) return null; throw e; }
}

/**
 * ⚠️ EXTRACTED SO THE PRE-FETCHED PATH CANNOT DRIFT FROM THE QUERY PATH. The caller may now read every row-set in
 * a single statement (~250ms each on this link, so six statements is a second and a half of pure waiting) and hand
 * the rows in. If the shaping were duplicated at the call site, the two would diverge the first time a field was
 * added — and a line rendered from one path would silently differ from the same line rendered by the other.
 */
function _shapeLines(rows) {
  return (rows || []).map((x) => Object.assign({
    line_id: x.line_id, seq: x.seq, particulars: x.particulars,
    quantity: x.quantity === null || x.quantity === undefined ? null : Number(x.quantity),
    price: x.price === null || x.price === undefined ? null : Number(x.price),
    removed: x.removed, needs_human: x.needs_human,
  },
    x.unit ? { unit: x.unit } : {}, x.unit_size ? { unit_size: x.unit_size } : {},
    x.comment ? { comment: x.comment } : {}, x.asked_as ? { asked_as: x.asked_as } : {},
    x.asked_unit ? { asked_unit: x.asked_unit } : {}, x.raw_phrase ? { raw_phrase: x.raw_phrase } : {},
    x.removed_reason ? { removed_reason: x.removed_reason } : {}, x.flags || {}));
}

/**
 * writeLine(db, entity_id, chit_id, line_id, line) — the live row follows the correction.
 * ⚠️ CALLED INSIDE record()'s TRANSACTION, never on its own. The audit row and the live row must land together or
 * not at all; a correction that logged but did not apply would read as done and change nothing.
 * ⚠️ A null line sets removed=true rather than DELETING. A removed line stays visible as evidence that it was
 * asked for, and counts in nothing.
 */
async function writeLine(db, entity_id, chit_id, line_id, line, reason_code) {
  if (!line_id) return false;
  try {
    if (line === null) {
      await db.query(`UPDATE chit_line SET removed = true, removed_reason = $4, updated_at = now()
                       WHERE entity_id = $1 AND chit_id = $2 AND line_id = $3`, [entity_id, chit_id, line_id, reason_code || null]);
    } else {
      /**
       * ── ⚠️ THE FLAGS HAVE TO FOLLOW THE CORRECTION, AND THEY DID NOT ────────────────────────────────────────
       * This UPDATE set the columns and left `flags` untouched. The detail route reads the LIVE line from
       * chit_line whenever b142 exists, so a resolved ambiguity kept its `ambiguous` flag: the name and the price
       * would update correctly and the row would go on saying "⚠️ pick item" forever, on a line somebody had
       * already picked. A screen that cannot stop asking a question it has been answered is worse than one that
       * never asked.
       *
       * ⚠️ CLEARED ONLY WHEN THE ITEM ACTUALLY CHANGED — a pick (which carries a ref) or a different name.
       * Amending only the QUANTITY on an ambiguous line leaves it just as ambiguous, and clearing the flag there
       * would hide a real unresolved question behind an unrelated edit.
       *
       * ⚠️ AND needs_human IS RECOMPUTED, NOT SET FALSE. The same column also carries "this quantity appears
       * nowhere in their message" — blanket-clearing it here would silently dismiss a warning about a number
       * nobody has checked, from a screen that was only ever asking about the item.
       */
      const cur = await db.query(
        `SELECT COALESCE(flags,'{}'::jsonb) AS flags, particulars FROM chit_line
          WHERE entity_id = $1 AND chit_id = $2 AND line_id = $3`, [entity_id, chit_id, line_id]);
      const had = (cur.rows[0] && cur.rows[0].flags) || {};
      const itemChanged = !!line.ref || (cur.rows[0] && cur.rows[0].particulars !== line.particulars);
      const flags = Object.assign({}, had);
      if (itemChanged) { delete flags.ambiguous; delete flags.ambiguous_count;
                         delete flags.variant_candidates; delete flags.variant_unspecified; }
      if (line.ref) flags.ref = line.ref;
      /* Same reasoning as the ref: chit_line is what the detail route reads, so a lot recorded by an
         amendment has to land there or the screen keeps showing the line without it. */
      if (line.lot) flags.lot = line.lot;
      const stillNeeds = !!(flags.qty_unverified || flags.qty_rejected
        || flags.ambiguous || flags.variant_candidates);

      await db.query(
        `UPDATE chit_line SET removed = false, removed_reason = NULL, particulars = $4, quantity = $5,
                unit = $6, unit_size = $7, price = $8, comment = $9,
                flags = $10::jsonb, needs_human = $11, updated_at = now()
          WHERE entity_id = $1 AND chit_id = $2 AND line_id = $3`,
        [entity_id, chit_id, line_id, line.particulars,
         line.quantity === undefined ? null : line.quantity, line.unit || null, line.unit_size || null,
         line.price === undefined ? null : line.price, line.comment || null,
         JSON.stringify(flags), stillNeeds]);
    }
    return true;
  } catch (e) { if (notMigrated(e)) return false; throw e; }
}

async function list(entity_id, chit_id, _db, _rows) {
  /* ⚠️ PRE-FETCHED ROWS SKIP THE QUERY, NOT THE SHAPING. At ~250ms per statement the caller can read every
     row-set in ONE statement; this keeps ONE definition of what an amendment list IS. */
  if (_rows) return { amendments: _rows, migrated: true };
  try {
    const r = await onEntity(entity_id, _db, (db) => db.query(
      /* ⚠️ line_id IS NOT OPTIONAL HERE. It was missing from this SELECT, so the detail route's
         `a.line_id === row.line_id` filter compared undefined to a uuid and EVERY chain came back empty — no
         struck-through original, ever, on any amended line. It looked like a working screen: the corrected value
         was right, the removal still rendered (that reads chit_line.removed, not the chain), and only the
         evidence was silently gone. Found by Athi's first screenshot, not by 29 passing assertions — every one of
         which checked live_set from liveSet(), the pre-b142 path, never this one. */
      `SELECT amendment_id, line_index, line_id, seq, line, reason_code, reason, actor_name, created_at
         FROM chit_line_amendment WHERE entity_id = $1 AND chit_id = $2 ORDER BY line_index, seq`, [entity_id, chit_id]));
    return { amendments: r.rows, migrated: true };
  } catch (e) { if (notMigrated(e)) return { amendments: [], migrated: false, note: 'amendments not migrated (b138)' }; throw e; }
}

/** listFor(entity_id, chit_ids[]) — one query for many chits, so a group sum is not N round trips. */
async function listFor(entity_id, chit_ids) {
  if (!chit_ids || !chit_ids.length) return new Map();
  try {
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT chit_id, line_index, seq, line FROM chit_line_amendment
        WHERE entity_id = $1 AND chit_id = ANY($2::uuid[]) ORDER BY chit_id, line_index, seq`, [entity_id, chit_ids]));
    const m = new Map();
    r.rows.forEach((x) => { if (!m.has(x.chit_id)) m.set(x.chit_id, []); m.get(x.chit_id).push(x); });
    return m;
  } catch (e) { if (notMigrated(e)) return new Map(); throw e; }
}

/**
 * ⭐ liveSet(lines, amendments) — what is true NOW, plus what it used to be.
 *
 * Returns one entry per ORIGINAL line, in original order:
 *   { index, live, original, history[], removed, reason_code }
 * `live` is null when the line was removed. `history` is every superseded version, oldest first, so the screen can
 * strike them through without a second lookup.
 *
 * ⚠️ ONE ENTRY PER ORIGINAL LINE, ALWAYS — removed lines included. They must stay VISIBLE (evidence) while
 * counting NOWHERE, and dropping them here would make the chit silently disagree with the message it came from.
 * Callers that want only what counts use liveLines() below, which is the single place that exclusion happens.
 */
function liveSet(lines, amendments) {
  const byLine = new Map();
  for (const a of (amendments || [])) {
    if (!byLine.has(a.line_index)) byLine.set(a.line_index, []);
    byLine.get(a.line_index).push(a);
  }
  return (lines || []).map((orig, index) => {
    const chain = (byLine.get(index) || []).slice().sort((x, y) => x.seq - y.seq);
    if (!chain.length) return { index, live: orig, original: orig, history: [], removed: false };
    const latest = chain[chain.length - 1];
    /* Everything the line has ever been, oldest first: the original, then each superseded replacement. The last
       entry is excluded because it IS the live one. */
    const history = [orig].concat(chain.slice(0, -1).map((c) => c.line).filter((l) => l !== null));
    return { index, live: latest.line, original: orig, history,
             removed: latest.line === null, reason_code: latest.reason_code, amended_at: latest.created_at,
             amended_by: latest.actor_name, versions: chain.length };
  });
}

/**
 * liveLines(lines, amendments) — ONLY what counts. The single definition of "the live set" for arithmetic.
 * ⚠️ Every total, forecast and sum must come through here. Reading chit_detail.line_items directly means totalling
 * what the machine misheard and what the trader has already struck out.
 */
function liveLines(lines, amendments) {
  return liveSet(lines, amendments).filter((e) => !e.removed && e.live).map((e) => e.live);
}

module.exports = { record, list, listFor, readLines, liveSet, liveLines, clean, LINE_FIELDS, REASONS };
