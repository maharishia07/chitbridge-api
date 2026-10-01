/**
 * tests/support/books-memory.cjs — an IN-MEMORY lib/books-store.js, for proving the ledger's logic with no database.
 *
 * ⚠️ It has EXACTLY the real store's exports (tests/books-post.test.cjs fails when the two drift), and it keeps the
 * tables' own rules that the logic leans on: the journal is insert-only, a source_ref posts once, a party number is
 * never reused, the counter row moves by one. It is not a second implementation of Postgres — enough to hold rows.
 */
'use strict';
const ZERO = '00000000-0000-0000-0000-000000000000';
let uid = 0; const id = () => '00000000-0000-4000-8000-' + String(++uid).padStart(12, '0');
const clone = (x) => JSON.parse(JSON.stringify(x));
const ymd = (v) => (v ? String(v).slice(0, 10) : null);

function create() {
  const T = { setting: new Map(), accounts: [], periods: [], counters: new Map(), entries: [], lines: [], balances: new Map(), items: [], payments: [],
              outbox: [], changes: [], parties: [], packs: [], chits: [], disputes: [], identities: [] };
  let itemSeq = 0, lineSeq = 0, clock = Date.parse('2026-09-29T10:00:00Z');
  const now = () => new Date(clock += 1000).toISOString();
  const S = {
    ZERO, T,
    async setting(db, e) { const s = T.setting.get(String(e)); return s ? clone(s) : null; },
    async saveSetting(db, e, s) { const cur = T.setting.get(String(e)) || {}; T.setting.set(String(e), Object.assign({}, cur, { entity_id: e, enabled: !!s.enabled, walkin_grain: s.walkin_grain || 'day',
      fy_start_month: s.fy_start_month || 4, functional_currency: s.functional_currency || 'INR', country: s.country || 'IN', pack_version: s.pack_version || cur.pack_version || null,
      enabled_at: cur.enabled_at || (s.enabled ? now() : null) /* the FIRST time it was switched on, kept (the real upsert's COALESCE) */ })); },
    async saveCheck(db, e, r) { const s = T.setting.get(String(e)); if (s) s.last_check = clone(r); },
    async accounts(db, e) { return clone(T.accounts.filter((a) => a.entity_id === e)).sort((a, b) => String(a.code).localeCompare(String(b.code))); },
    async insertAccount(db, e, a) {
      if (T.accounts.some((x) => x.entity_id === e && x.code === a.code)) return null;
      if (a.role && T.accounts.some((x) => x.entity_id === e && x.role === a.role)) throw Object.assign(new Error('dup role'), { code: '23505' });
      const r = { account_id: id(), entity_id: e, code: a.code, name: a.name, parent_id: a.parent_id || null, is_group: !!a.is_group, nature: a.nature, role: a.role || null,
                  tally_group: a.tally_group || null, sch3_line: a.sch3_line || null, saft_grouping: a.saft_grouping || null, currency: null, active: true };
      T.accounts.push(r); return r.account_id;
    },
    async periods(db, e, fy) { return clone(T.periods.filter((p) => p.entity_id === e && (!fy || p.fiscal_year === fy))).sort((a, b) => a.fiscal_year.localeCompare(b.fiscal_year) || a.period - b.period); },
    async insertPeriod(db, e, p) { if (!T.periods.some((x) => x.entity_id === e && x.fiscal_year === p.fiscal_year && x.period === p.period)) T.periods.push(Object.assign({ entity_id: e, status: 'open' }, p)); },
    async setPeriodStatus(db, e, fy, p, status, by, reason) { const r = T.periods.find((x) => x.entity_id === e && x.fiscal_year === fy && Number(x.period) === Number(p)); if (!r) return null; Object.assign(r, { status, locked_by: by, reason }); return { status }; },
    async nextNo(db, e, series, fy) { const k = e + '|' + series + '|' + (fy || '-'); const n = (T.counters.get(k) || 1); T.counters.set(k, n + 1); return n; },
    async entryBySource(db, e, ref) { const h = T.entries.find((x) => x.entity_id === e && x.source_ref === ref); return h ? clone(h) : null; },
    async postedSources(db, e, refs) { return T.entries.filter((x) => x.entity_id === e && x.source_ref && (refs || []).indexOf(x.source_ref) >= 0).map((x) => x.source_ref); },
    async entry(db, e, eid) {
      const h = T.entries.find((x) => x.entity_id === e && x.entry_id === eid); if (!h) return null;
      return Object.assign(clone(h), { lines: clone(T.lines.filter((l) => l.entry_id === eid)), items: clone(T.items.filter((i) => i.entry_id === eid)) });
    },
    async entryLines(db, e, from, to, account_id, party_id) {
      return T.lines.filter((l) => l.entity_id === e && (!account_id || l.account_id === account_id) && (!party_id || l.party_id === party_id)).map((l) => {
        const h = T.entries.find((x) => x.entry_id === l.entry_id), a = T.accounts.find((x) => x.account_id === l.account_id);
        /* the real query's entity-scoped LEFT JOIN onto the shop's own chit (one copy) and the writer's identity */
        const c = h.source_chit_id ? T.chits.find((x) => x.chit_id === h.source_chit_id && x.entity_id === e) : null, bj = (c && c.business_json) || {};
        const who = h.created_by ? T.identities.find((x) => x.identity_id === h.created_by) : null;
        return Object.assign({}, l, { entry_no: h.entry_no, posting_date: h.posting_date, doc_date: h.doc_date, event_type: h.event_type, narration: h.narration, source_chit_id: h.source_chit_id,
          reverses_entry_id: h.reverses_entry_id, code: a.code, account_name: a.name, source_ref: h.source_ref || null,
          covers: Array.isArray(h.source_chit_ids) ? h.source_chit_ids.length : null, src_chit_id: c ? c.chit_id : null, src_purpose: c ? c.purpose || null : null,
          src_ref: c ? (bj.printed_as || bj.bill_no || (bj.payment_received && bj.payment_received.no) || null) : null,
          src_till: c ? ((bj.till && bj.till.id) || (bj.summary && bj.summary.till && bj.summary.till.id) || null) : null,
          src_by: c && bj.till && bj.till.by !== undefined ? clone(bj.till.by) : null, by_name: who ? who.display_name : null,
          src_parts: c ? clone((bj.payment && bj.payment.parts) || (bj.refund && bj.refund.parts) || null) : null,
          recorded_at: h.created_at || null, src_created_at: c ? c.created_at || null : null,
          src_billed_at: c ? (bj.billed_at || (bj.payment_received && bj.payment_received.at) || null) : null,
          src_mode: c && bj.payment_received ? bj.payment_received.mode || null : null, src_cheque: c && bj.payment_received ? clone(bj.payment_received.cheque || null) : null,
          tenders: Array.isArray(h.source_chit_ids) ? (() => { const t = T.lines.filter((x) => x.entry_id === h.entry_id && x.dr_minor > 0).sort((p, q) => p.line_no - q.line_no)
            .map((x) => ({ role: (T.accounts.find((y) => y.account_id === x.account_id) || {}).role, dr_minor: x.dr_minor })).filter((x) => ['cash', 'upi', 'card', 'bank'].indexOf(x.role) >= 0); return t.length ? t : null; })() : null });
      }).filter((l) => l.posting_date >= from && l.posting_date <= to).sort((x, y) => x.posting_date.localeCompare(y.posting_date) || x.entry_no.localeCompare(y.entry_no) || x.line_no - y.line_no);
    },
    async entries(db, e, from, to) { return clone(T.entries.filter((h) => h.entity_id === e && h.posting_date >= from && h.posting_date <= to)); },
    async yearRows(db, e, fy) {
      return Array.from(T.balances.values()).filter((b) => b.entity_id === e && b.fiscal_year === fy)
        .map((b) => ({ fiscal_year: b.fiscal_year, period: b.period, code: T.accounts.find((a) => a.account_id === b.account_id).code, party_key: b.party_key, dr_minor: b.dr_minor, cr_minor: b.cr_minor }));
    },
    async ledgerLines(db, e, from, to, party) {
      return T.lines.filter((l) => l.entity_id === e && (!party || l.party_id === party)).map((l) => {
        const h = T.entries.find((x) => x.entry_id === l.entry_id), a = T.accounts.find((x) => x.account_id === l.account_id);
        return { entry_id: h.entry_id, entry_no: h.entry_no, posting_date: h.posting_date, fiscal_year: h.fiscal_year, period: h.period, is_opening: h.is_opening, source_ref: h.source_ref,
                 narration: h.narration, source_chit_id: h.source_chit_id, event_type: h.event_type, line_no: l.line_no, code: a.code, party_id: l.party_id, dr_minor: l.dr_minor, cr_minor: l.cr_minor, currency: l.currency };
      }).filter((l) => l.posting_date >= from && l.posting_date <= to);
    },
    async years(db, e) { return Array.from(new Set(Array.from(T.balances.values()).filter((b) => b.entity_id === e).map((b) => b.fiscal_year))).sort(); },
    /* ── the four writes ── */
    async insertEntry(db, e, h) {
      if (h.source_ref && T.entries.some((x) => x.entity_id === e && x.source_ref === h.source_ref)) throw Object.assign(new Error('duplicate source_ref'), { code: '23505' });
      if (T.entries.some((x) => x.entity_id === e && x.entry_no === h.entry_no)) throw Object.assign(new Error('duplicate entry_no'), { code: '23505' });
      const r = Object.assign({ entry_id: id(), entity_id: e, created_at: now() }, clone(h)); T.entries.push(r); return { entry_id: r.entry_id, created_at: r.created_at };
    },
    async insertLines(db, e, entry_id, lines) {
      for (const l of lines) { if (!((l.dr_minor > 0 && !l.cr_minor) || (l.cr_minor > 0 && !l.dr_minor))) throw new Error('journal_line_side_chk'); T.lines.push(Object.assign({ line_id: ++lineSeq, entry_id, entity_id: e }, clone(l))); }
    },
    async addBalances(db, e, rows) {
      for (const b of rows) {
        const k = [e, b.account_id, b.party_key || ZERO, b.currency, b.fiscal_year, b.period].join('|');
        const r = T.balances.get(k) || { entity_id: e, account_id: b.account_id, party_key: b.party_key || ZERO, currency: b.currency, fiscal_year: b.fiscal_year, period: b.period, dr_minor: 0, cr_minor: 0, line_count: 0 };
        r.dr_minor += b.dr_minor; r.cr_minor += b.cr_minor; r.line_count += b.line_count; T.balances.set(k, r);
      }
    },
    async insertItems(db, e, items) {
      for (const it of items) {
        if (['bill', 'advance', 'on_account', 'allocation', 'reversal', 'status'].indexOf(it.ref_kind) < 0) throw new Error('party_item_kind_chk');
        if (['receivable', 'payable'].indexOf(it.side) < 0) throw new Error('party_item_side_chk');
        if (!it.ref || !it.against_ref || !it.party_id || !it.account_id || !it.currency) throw new Error('party_item not null: ' + JSON.stringify(it));
        T.items.push(Object.assign({ item_id: ++itemSeq, entity_id: e, created_at: now() }, clone(it)));
      }
    },
    async periodSums() { return []; }, async lineSums() { return []; }, async firstYear() { return null; },
    async balanceDrift() { return []; }, async unbalancedEntries() { return []; },
    async items(db, e, party, account) { return clone(T.items.filter((i) => i.entity_id === e && (!party || i.party_id === party) && (!account || i.account_id === account))); },
    async itemOwners(db, e, account, refs) { const seen = new Set(), out = []; T.items.filter((i) => i.entity_id === e && i.account_id === account && i.ref === i.against_ref && (refs || []).indexOf(i.ref) >= 0)
      .forEach((i) => { const k = i.ref + '|' + i.party_id; if (!seen.has(k)) { seen.add(k); out.push({ ref: i.ref, party_id: i.party_id }); } }); return out; },
    async itemTotals(db, e, account) { const m = {}; T.items.filter((i) => i.entity_id === e && i.account_id === account).forEach((i) => { m[i.party_id] = (m[i.party_id] || 0) + i.amount_minor; }); return Object.keys(m).map((k) => ({ party_id: k, total_minor: m[k] })); },
    async accountNet(db, e, account) { let n = 0; T.balances.forEach((b) => { if (b.entity_id === e && b.account_id === account && b.party_key === ZERO) n += b.dr_minor - b.cr_minor; }); return n; },
    async insertPayment(db, e, p) {
      const seen = p.client_ref ? T.payments.find((x) => x.entity_id === e && x.client_ref === p.client_ref) : null;
      if (seen) return { payment_id: seen.payment_id, duplicate: true };
      const r = Object.assign({ payment_id: id(), entity_id: e }, clone(p)); T.payments.push(r); return { payment_id: r.payment_id, duplicate: false };
    },
    async paymentByRef(db, e, ref) { const p = T.payments.find((x) => x.entity_id === e && x.client_ref === String(ref)); return p ? { payment_id: p.payment_id, mode: p.mode } : null; },
    async cheques(db, e, all, limit) {
      const steps = ['received', 'deposited', 'cleared', 'bounced'];
      return clone(T.payments.filter((p) => p.entity_id === e && p.mode === 'cheque')).map((p) => {
        const st = T.items.filter((i) => i.payment_id === p.payment_id && i.ref_kind === 'status' && steps.indexOf(i.status) >= 0).slice(-1)[0];
        return Object.assign(p, { status: st ? st.status : null });
      }).filter((p) => all || !p.status || p.status === 'received' || p.status === 'deposited')
        .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at))).slice(0, limit || 200);
    },
    async payment(db, e, pid) { const p = T.payments.find((x) => x.entity_id === e && x.payment_id === pid); return p ? clone(p) : null; },
    async queue(db, e, o) { T.outbox.push(Object.assign({ id: T.outbox.length + 1, entity_id: e, tries: 0, created_at: now(), done_at: null }, clone(o))); },
    async waiting(db, e, limit) { return clone(T.outbox.filter((o) => o.entity_id === e && !o.done_at).sort((a, b) => a.tries - b.tries || a.id - b.id).slice(0, limit || 100)); },
    async outboxDone(db, e, oid, ok, why) { const o = T.outbox.find((x) => x.id === oid); if (!o) return; o.tries++; if (ok) o.done_at = now(); else o.why = why; },
    async logChange(db, e, c) { T.changes.push(Object.assign({ entity_id: e, at: now() }, clone(c))); },
    async changes(db, e) { return clone(T.changes.filter((c) => c.entity_id === e)); },
    async terms(db, e, party, side) { const p = T.parties.find((x) => x.owner === e && x.party_id === party && x[side]); return p ? { credit_days: p.credit_days == null ? null : p.credit_days, credit_limit_minor: null, party_no: p.party_no } : null; },
    async parties(db, e) { return clone(T.parties.filter((p) => p.owner === e)); },
    async partyOn(db, e, party) { const p = T.parties.find((x) => x.owner === e && x.party_id === party); return { customer: !!(p && p.customer), supplier: !!(p && p.supplier) }; },
    async partyNoOf(db, e, party) { const p = T.parties.find((x) => x.owner === e && x.party_id === party); return p ? p.party_no || null : null; },
    async setPartyNo(db, e, party, no) { const p = T.parties.find((x) => x.owner === e && x.party_id === party); if (p && !p.party_no) p.party_no = no; },
    async billNos(db, e, ids) { const o = {}; (ids || []).forEach((i) => { const c = T.chits.find((x) => x.chit_id === i); if (c) o[i] = c.bill_no; }); return o; },
    async lastPack(db, e) { const p = T.packs.filter((x) => x.entity_id === e).slice(-1)[0]; return p ? clone(p) : null; },
    async insertPack(db, e, p) { const r = Object.assign({ entity_id: e, created_at: now() }, clone(p)); T.packs.push(r); return { pack_id: r.pack_id, created_at: r.created_at }; },
    async packs(db, e) { return clone(T.packs.filter((x) => x.entity_id === e)); },
    async pack(db, e, pid) { const p = T.packs.find((x) => x.entity_id === e && x.pack_id === pid); return p ? clone(p) : null; },
    async ackPack(db, e, pid) { const p = T.packs.find((x) => x.entity_id === e && x.pack_id === pid); if (!p) return null; p.acknowledged_at = p.acknowledged_at || now(); return { acknowledged_at: p.acknowledged_at }; },
    async counterBills() { return []; }, async countersBilling() { return []; }, async unpostedChits() { return []; },
    async openDisputes(db, e, chit) { return T.disputes.filter((d) => d.entity_id === e && d.chit_id === chit && d.status === 'open').length; },
  };
  return S;
}
/** a db handle that accepts the savepoint chatter and nothing else */
const fakeDb = { query: async (text) => { if (/^\s*(SAVEPOINT|RELEASE|ROLLBACK)/i.test(text) || /FROM identities WHERE identity_id = \$1$/.test(String(text).trim())) return { rows: [] }; throw new Error('the in-memory tests ran real SQL: ' + String(text).slice(0, 80)); } };

module.exports = { create, fakeDb, ZERO, ymd };
