/**
 * lib/meter.js — ONE way to record a billable event.
 *
 * Athi, 2026-08-22: *"complete the ways and means and ensure end-to-end traceability is possible in terms of
 * usage, then we will see how to monetise."*
 *
 * ⭐⭐ THE LEDGER RECORDS THE PRICE, NOT THE FACT. `chit_header` already says a chit exists; `usage_ledger`
 * says what it cost. That is why metering a chit is not duplicating a row — the two answer different
 * questions, and only one of them can be summed into an invoice.
 *
 * ⭐ b99 designed this and wired two meters (`ai.draft`, `kyb.field`). It names the rest in its own header —
 * *"the identical row later meters chit.send, network.connect, iot.task, erp.transfer, extra co-assists"* —
 * and none of them were ever written. The mechanism was never the gap; adoption was.
 *
 * ── ⚠️ IT MUST NEVER FAIL THE ACTION IT MEASURES ────────────────────────────────────────────────────────
 * A send that fails because its meter failed is a far worse outcome than a meter that is missing: one loses a
 * customer's work, the other loses a fraction of a cent that `chit_header` can still evidence. So this
 * swallows every error and returns false.
 *
 * ⚠️ AND SWALLOWING IT SILENTLY WOULD BE THE BUG THIS CODEBASE KEEPS PRODUCING. It logs `warn` — which is
 * exactly what that level was defined for an hour before this file existed: *something is wrong and the
 * request still succeeded*. Unbilled usage is revenue quietly not captured, and the only way anyone learns of
 * it is a line that says so.
 *
 * ⚠️ SO A BEST-EFFORT LEDGER IS THE COUNT OF **BILLED**, NEVER THE COUNT OF RECORD. When a summary says 1,204
 * chits and the list shows 1,210, the ledger is not wrong — it is telling you six were not billed. Any screen
 * built on this must say which of the two it is showing, or it will be read as a defect and "fixed" by making
 * the numbers agree, which throws the finding away.
 */
const { withEntity } = require('../db');
const log = require('./logger');
const rates = require('./rates');

/**
 * Record one billable event. Resolves true if it landed, false if it did not — never rejects.
 *
 * @param {string} entity_id  whose meter this is
 * @param {string} name       the meter, e.g. 'chit.send' — a closed vocabulary, see b99
 * @param {object} [opts]     detail · quantity · cost_usd · meta · rid (the correlation id)
 */
async function meter(entity_id, name, opts = {}) {
  if (!entity_id || !name) return false;
  const { detail = null, quantity = 1, meta = null, rid = null, basis = null, currency = null } = opts;

  /**
   * ⭐⭐ THE ROW CARRIES ITS OWN EXPLANATION. Athi confirmed the ledger-only design on 2026-08-23, which means
   * this row is the ONLY record of the charge — so it stamps the basis, the card and the numbers that applied,
   * not a pointer to them. `detail` already holds the chit id, so the trade is one join away and neither copy
   * restates the other.
   *
   * ⚠️ "why was this charged that?" must stay answerable after the card changes, which is exactly why the rate
   * is copied rather than referenced. See lib/rates.js.
   */
  const priced = rates.priceOf({ quantity, basis });
  const cost_usd = opts.cost_usd != null ? opts.cost_usd : priced.cost_usd;
  const stamp = Object.assign({}, meta || {}, {
    rate: priced.rate,
    ...(basis != null ? { basis: Number(basis), basis_currency: currency || null } : {}),
  });

  try {
    await withEntity(entity_id, (c) => c.query(
      `INSERT INTO usage_ledger (entity_id, meter, detail, quantity, cost_usd, meta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entity_id, name, detail, quantity, cost_usd, JSON.stringify(stamp)]));
    return true;
  } catch (e) {
    /* ⚠️ warn, not error: the request succeeded. See the taxonomy in lib/logger.js. */
    log.warn('usage not metered', { id: rid, meter: name, entity_id, err: e.message });
    return false;
  }
}

module.exports = { meter };
