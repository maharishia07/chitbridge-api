'use strict';
/**
 * CARD 13-inventory-stock-and-traceability/on-hand-and-movements
 * policy-stock.js — the shop's "selling below zero" switch (OPS-121, 22 Nov 2026), split out of lib/policy.js so that file does not grow (the books and sign-in rows did the same).
 * OWNER     cb-operations
 * RISK      money
 * OWNS      the FLAGS row negative_stock and its CARD row. 'allow' (default) = a sale goes through and the shelf figure that goes below zero is flagged (Stock "below zero", the Home card); 'block' = an ONLINE sale whose line would take on-hand below zero is refused before it posts (lib/stock-oversell).
 * CALLED BY lib/policy.js (flagsFor(owner) spread into FLAGS, CARD spread into CARD; the owner-only words stay policy.js's MONEY_TAX_OWNER, passed in, never restated here)
 * FLOW      lib/policy.js FLAGS/CARD ──▶ the one PATCH /api/entities/policy ──▶ lib/stock-oversell.refusalOf reads it server-side at the send
 * DECISION  DECISIONS.md 11 Nov 2026: a switch where practice offers two valid ways (SAP: per plant), default from practice (allow and flag), owner role changes it, audited by the one policy writer.
 * ⚠️ An OFFLINE till sale is never refused after the fact: the till has already handed the goods over, so it posts and is flagged whichever way this is set.
 */
const flagsFor = (owner) => ({ negative_stock: { type: 'enum', options: ['allow', 'block'], def: 'allow', ...owner } });

const CARD = {
  negative_stock: {
    label: 'Selling more than the shelf shows',
    level: 'entity',
    gov: 'entity',
    labels: { allow: 'Allow and flag', block: 'Refuse the sale' },
    help: 'Allow and flag — the sale goes through, and the item shows "below zero" in Stock until you count it. Refuse the sale — a bill taken online for more than the shelf shows is stopped before it is saved. A bill the counter took while offline is never refused later: it is saved and flagged either way.'
  }
};
module.exports = { flagsFor, CARD };
