'use strict';
/**
 * lib/crm-timeline-rows.js — the party timeline's two row shapers: a chit entry and a ledger entry (a blind reader's cost side is hidden).
 * OWNS      chitEntry · ledgerEntry (no route, no state)
 * CALLED BY routes/crm.js (GET /parties/:id/timeline)
 * FLOW      a select row -> the timeline entry { kind, at, ... } -> cost-view / dues-view hide a cost-side value from a blind reader
 * CARD      11-crm-and-marketing/crm-routes
 */
const crmLib = require('./crm');

/** a timeline chit entry from a select row; `sides` (a blind reader's chit_id → buy | sell | unknown, lib/cost-view) nulls a cost-side value (RAIL-146h) */
function chitEntry(chitRow, sides) {
  const entry = {
    kind: 'chit',
    at: crmLib.iso(chitRow.created_at),
    chit_id: chitRow.chit_id,
    direction: chitRow.direction,
    status: chitRow.current_status,
    purpose: chitRow.purpose,
    doc_kind: chitRow.doc_kind || null,
    bill_no: chitRow.bill_no || null,
    title: chitRow.manual_subject || chitRow.auto_subject || null,
    value: crmLib.num(chitRow.value),
    currency: chitRow.currency || null,
    open_disputes: Number(chitRow.open_disputes) || 0
  };
  return sides ? require('./cost-view').hideTimelineChit(entry, sides.get(String(chitRow.chit_id)) || 'unknown') : entry;
}
/** a timeline ledger entry from a party_item row; a blind reader's supplier-side amount is null (lib/dues-view R8, RAIL-146h) */
function ledgerEntry(ledgerRow, blind, roles, noMoney) {
  const entry = {
    kind: 'ledger',
    at: crmLib.iso(ledgerRow.created_at),
    ref: ledgerRow.ref,
    ledger_kind: ledgerRow.ref_kind === 'bill' ? 'bill' : 'receipt',
    source: ledgerRow.kind || null,
    amount_minor: Number(ledgerRow.amount_minor),
    currency: ledgerRow.currency,
    doc_date: ledgerRow.doc_date ? require('./books-engines').ymd(ledgerRow.doc_date) : null /* a DATE column reads as a JS Date: String(Date).slice(0,10) is "Thu Oct 08" (the web showed 2001) */
  };
  return noMoney || blind ? require('./dues-view').blindLedgerEntry(entry, roles, !!noMoney) : entry;
}

module.exports = { chitEntry, ledgerEntry };
