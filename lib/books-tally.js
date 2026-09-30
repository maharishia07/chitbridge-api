// @stage tested
// @stage-note [BOOKS v2] The ledger pack's Tally files, written through the connector's Tally adapter (its builders) — never a
// @stage-note second Tally writer. Masters for every ledger and party a voucher names; one voucher per journal entry.
'use strict';
/**
 * lib/books-tally.js — THE PACK'S TALLY FILES, THROUGH THE ONE TALLY WRITER (critic review M7, 2026-09-29).
 *
 * ⭐ STAY IN THE CONSTRUCT: tools/tally-connector/adapters/tally.js is what has actually been imported into TallyPrime.
 *   This file only MAPS journal entries onto its builders (accountingVoucherBody, ledgerMasterXML, partyLedgerXML,
 *   the two envelopes); it writes no Tally XML of its own.
 * ⭐ ONE VOUCHER PER JOURNAL ENTRY, typed by what happened: Sales · Purchase · Receipt · Payment · Credit Note ·
 *   Debit Note · Journal. A party line carries its bill-wise references from the entry's own party items
 *   (New Ref for a bill, Agst Ref when it settles one, On Account for money not yet matched).
 * ⭐ MASTERS FIRST: every ledger a voucher names, under its Tally group (GST ledgers with their duty head), and every
 *   party under Sundry Debtors / Sundry Creditors, bill-wise on. Import tally-masters.xml, then tally-vouchers.xml.
 * ⚠️ SAID, NOT HIDDEN (the manifest carries all of it):
 *   · only the Receipt voucher has been imported into a real TallyPrime; the other types share its structure and are
 *     unproven there — `proven` names which;
 *   · a Journal that touches cash or a bank (an opening entry, a manual entry, a reversal) is one Tally refuses by
 *     default — each is listed in `needs_review`;
 *   · a payment matched to bills AFTER it was recorded has no journal entry, so Tally sees it On Account — the
 *     bill-wise truth is in the pack's open-items file.
 */
const path = require('path');

function builders() { return require(path.join(__dirname, '..', 'tools', 'tally-connector', 'adapters', 'tally.js')).builders; }

const TYPE = { walkin_day: 'Sales', sale_bill: 'Sales', purchase_bill: 'Purchase', payment_received: 'Receipt', other_income: 'Receipt',
  payment_made: 'Payment', credit_given: 'Payment', return: 'Credit Note', credit_note: 'Credit Note', purchase_return: 'Debit Note',
  write_off: 'Journal', opening: 'Journal', manual: 'Journal', reversal: 'Journal' };
const MONEY_GROUPS = { 'Cash-in-Hand': 1, 'Bank Accounts': 1, 'Bank OD A/c': 1 };
const DUTY = { output_cgst: 'CGST', input_cgst: 'CGST', output_sgst: 'SGST/UTGST', input_sgst: 'SGST/UTGST', output_igst: 'IGST', input_igst: 'IGST' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** a bill's name in Tally: the customer's own bill number when known, else the connector's CB-<first 8> for a chit id */
function billName(ref, nos) { const r = String(ref); return (nos && nos[r]) || (UUID.test(r) ? 'CB-' + r.slice(0, 8) : r.slice(0, 60)); }

/**
 * build({ entries: [{ entry_id, entry_no, posting_date, event_type, narration, lines: [{ code, party_id, dr_minor, cr_minor }] }],
 *         accounts: [{ code, name, tally_group, role, is_group }], parties: [{ party_id, name, legal_name, gstin, state_code, customer, supplier }],
 *         items: [{ entry_id, party (id), account code?, ref, against_ref, ref_kind, amount_minor }], bill_nos?, company?, dec(minor) })
 *   → { files: [{ name, data, rows }], summary: { status: 'adapter', vouchers, by_type, masters, proven, needs_review, notes } }
 */
function build(inp) {
  const B = builders(), x = inp || {}, dec = x.dec;
  if (typeof dec !== 'function') throw new Error('books-tally needs the exact-decimal function (CBBookPack.dec).');
  const acct = new Map((x.accounts || []).map((a) => [String(a.code), a]));
  const party = new Map((x.parties || []).map((p) => [String(p.party_id), p]));
  const itemsBy = new Map();
  (x.items || []).forEach((it) => { if (it.entry_id == null || it.ref_kind === 'status') return; const k = it.entry_id + '|' + it.party; if (!itemsBy.has(k)) itemsBy.set(k, []); itemsBy.get(k).push(it); });
  const usedLedgers = new Map(), usedParties = new Map(), bodies = [], byType = {}, review = [];
  const partyLedger = (p) => B.partyLedgerName({ name: p.legal_name || p.name, gstin: p.gstin });

  for (const e of x.entries || []) {
    let vtype = TYPE[e.event_type] || 'Journal';
    const money = (e.lines || []).some((l) => MONEY_GROUPS[(acct.get(String(l.code)) || {}).tally_group]);
    if (e.event_type === 'expense') vtype = money ? 'Payment' : 'Journal';          /* an expense on credit has no cash line */
    if (vtype === 'Journal' && money) review.push({ entry_no: e.entry_no, why: 'a Journal with a cash or bank line (' + e.event_type + ') — Tally refuses these unless the company allows it' });
    let head = null;
    const entries = (e.lines || []).map((l) => {
      const a = acct.get(String(l.code));
      if (!a) throw new Error('Entry ' + e.entry_no + ' names ledger ' + l.code + ', which is not in the chart.');
      const dr = Number(l.dr_minor) > 0, amt = dec(dr ? Number(l.dr_minor) : Number(l.cr_minor));
      const p = l.party_id ? party.get(String(l.party_id)) : null;
      if (l.party_id && !p) throw new Error('Entry ' + e.entry_no + ' names a party that is on neither list (' + l.party_id + ').');
      if (!p) { usedLedgers.set(a.name, a); return dr ? { ledger: a.name, dr: amt } : { ledger: a.name, cr: amt }; }
      const name = partyLedger(p); head = head || name;
      usedParties.set(String(l.party_id) + '|' + (a.role === 'creditors' ? 'Sundry Creditors' : 'Sundry Debtors'), { p, parent: a.role === 'creditors' ? 'Sundry Creditors' : 'Sundry Debtors' });
      /* the bill-wise references: this entry's own party items for this party, netted per document */
      const net = new Map();
      (itemsBy.get(e.entry_id + '|' + l.party_id) || []).forEach((it) => net.set(String(it.against_ref), (net.get(String(it.against_ref)) || 0) + Number(it.amount_minor)));
      const lineMinor = dr ? Number(l.dr_minor) : Number(l.cr_minor);
      let bills = [];
      net.forEach((m, ref) => {
        if (!m) return;
        const own = (itemsBy.get(e.entry_id + '|' + l.party_id) || []).some((it) => String(it.ref) === ref && it.ref_kind === 'bill');
        bills.push({ name: billName(ref, x.bill_nos), type: own ? 'New Ref' : ((itemsBy.get(e.entry_id + '|' + l.party_id) || []).some((it) => String(it.ref) === ref) ? 'On Account' : 'Agst Ref'), minor: Math.abs(m) });
      });
      /* ⚠️ the references must add up to the line, or Tally refuses the voucher: when they do not, one On Account row */
      if (!bills.length || bills.reduce((t, b) => t + b.minor, 0) !== lineMinor) bills = [{ name: billName(e.entry_no), type: 'On Account', minor: lineMinor }];
      const o = { ledger: name, is_party: true, bills: bills.map((b) => ({ name: b.name, type: b.type, amount: dec(b.minor) })) };
      if (dr) o.dr = amt; else o.cr = amt;
      return o;
    });
    bodies.push(B.accountingVoucherBody({ vtype, date: String(e.posting_date).slice(0, 10).replace(/-/g, ''), ref: e.entry_no,
      narration: (e.narration || e.event_type || '') + ' · ChitBridge ' + e.entry_no, party: head, entries }));
    byType[vtype] = (byType[vtype] || 0) + 1;
  }
  const masters = [];
  Array.from(usedLedgers.values()).sort((a, b) => String(a.code).localeCompare(String(b.code)))
    .forEach((a) => masters.push(B.ledgerMasterXML(a.name, a.tally_group || 'Suspense A/c', DUTY[a.role] || undefined)));
  const seen = new Set();
  usedParties.forEach(({ p, parent }) => {
    const name = partyLedger(p); if (seen.has(name.toLowerCase())) return; seen.add(name.toLowerCase());
    masters.push(B.partyLedgerXML({ name: p.legal_name || p.name, gstin: p.gstin || null, state_code: p.state_code || (p.gstin ? String(p.gstin).slice(0, 2) : ''), reg_type: 'Regular' }, parent));
  });
  const opt = { company: x.company || null };
  return {
    files: [{ name: 'tally-masters.xml', data: B.mastersEnvelope(masters, opt) + '\n', rows: masters.length },
            { name: 'tally-vouchers.xml', data: B.vouchersEnvelope(bodies, opt) + '\n', rows: bodies.length }],
    summary: { status: 'adapter', vouchers: bodies.length, by_type: byType, masters: masters.length,
      proven: 'Only the Receipt voucher has been imported into a real TallyPrime. Sales, Purchase, Payment, Credit Note, Debit Note and Journal here use the same structure and are not yet proven there — import into a TEST company first.',
      needs_review: review,
      notes: ['Import tally-masters.xml first, then tally-vouchers.xml.',
              'A payment matched to bills after it was recorded shows On Account here; the bill-wise record is open-items in this pack.',
              'Stock is not carried: every voucher is a ledger-only voucher (no inventory lines).'] },
  };
}

module.exports = { build, billName, TYPE };
