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

/**
 * Record one billable event. Resolves true if it landed, false if it did not — never rejects.
 *
 * @param {string} entity_id  whose meter this is
 * @param {string} name       the meter, e.g. 'chit.send' — a closed vocabulary, see b99
 * @param {object} [opts]     detail · quantity · cost_usd · meta · rid (the correlation id)
 */
async function meter(entity_id, name, opts = {}) {
  if (!entity_id || !name) return false;
  const { detail = null, quantity = 1, cost_usd = 0, meta = null, rid = null } = opts;
  try {
    await withEntity(entity_id, (c) => c.query(
      `INSERT INTO usage_ledger (entity_id, meter, detail, quantity, cost_usd, meta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entity_id, name, detail, quantity, cost_usd, meta ? JSON.stringify(meta) : null]));
    return true;
  } catch (e) {
    /* ⚠️ warn, not error: the request succeeded. See the taxonomy in lib/logger.js. */
    log.warn('usage not metered', { id: rid, meter: name, entity_id, err: e.message });
    return false;
  }
}

module.exports = { meter };
