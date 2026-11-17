'use strict';
/**
 * lib/entities-me.js — the two best-effort reads GET /api/entities/me adds to the profile: the governance resolve and the Ledger switch.
 * OWNS      governanceAndLedger (no route, no state)
 * CALLED BY routes/entities.js (GET /me)
 * FLOW      ONE readBatch trip (stamp + books switch) -> resolveEntityGovernance -> { governance, ledger_on }; a failed read is said (log.fellBack), never fatal
 * CARD      28-platform-and-operations/entities-routes
 */
const log = require('./logger');
const auth = require('../middleware/auth');

/** the entity's governance (null when not resolvable yet) and ledger_on (undefined = unknown, omitted from the answer) for the signed-in caller */
async function governanceAndLedger(req) {
  /* ⭐ ONE readBatch trip for the governance stamp AND the books switch (ledger_on, below): two trips before, same rows, same binding. A failed batch falls back to each read on its own. */
  let stampRows;
  let ledgerRow;
  try {
    ({ stampRows, ledgerRow } = await require('./govresolve').stampAndLedgerOf(auth.entityOf(req))); /* the reads live in the lib: this route holds no statement */
  } catch (e) {
    log.fellBack('entities GET /me: the governance + ledger batch failed — each read goes on its own', e);
  }
  let governance = null;
  try {
    governance = await require('./govresolve').resolveEntityGovernance(auth.entityOf(req), stampRows ? { stampRows } : undefined); /* by the module, so a test can make it fail */
  } catch (e) {
    log.fellBack('entities GET /me: failed — carried on without it', e);
  }
  /* ⭐ ledger_on — is the Ledger switched on for this shop? ONE answer for the boot checks (app · crm · accounts): they used to ask GET /books/health,
     which answers 404 LEDGER_OFF BY DESIGN for a shop with none, and the browser console showed a red failed request on the first screen. The SAME read
     the books gate makes (lib/books ledgerOn → settingOf; an actor reads its employer's, auth.entityOf). Unreadable = left out (unknown), never false and never a guess that it is on. */
  let ledger_on; /* undefined = UNKNOWN (omitted from the answer): the page then asks the old way — an unreadable switch is never reported "off" */
  try {
    const eidLedger = auth.entityOf(req);
    ledger_on = stampRows ? !!(ledgerRow && ledgerRow.enabled) : await require('./books').ledgerOnBatch(eidLedger); /* the books gate's own row (S.SETTING_SQL): from the batch above, else lib/books.ledgerOnBatch on its own trip; no row = false */
  } catch (e) {
    log.fellBack('entities GET /me: the ledger switch read failed — ledger_on left out (unknown, not off)', e);
  }
  return { governance, ledger_on };
}

module.exports = { governanceAndLedger };
