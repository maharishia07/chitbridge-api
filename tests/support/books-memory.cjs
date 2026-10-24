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

/* the real store's TODO_SQL / NAME_SQL, read the same way over one in-memory row */
const todoOf = (o) => { const ev = o.event || {}; if (ev.todo) return ev.todo;
  return ev.waiting === 'acceptance' ? 'accept' : ev.waiting === 'party' && /^Who is /.test(String(o.why || '')) ? 'add_supplier' : 'record'; };
const nameOf = (o) => { if (todoOf(o) !== 'add_supplier') return null; const ev = o.event || {}; if (ev.name) return ev.name;
  const m = /^Who is (.+)\? Add them as a supplier/.exec(String(o.why || '')); return m ? m[1] : null; };
function create() {
  const T = { setting: new Map(), accounts: [], periods: [], counters: new Map(), entries: [], lines: [], balances: new Map(), items: [], payments: [],
              outbox: [], changes: [], parties: [], packs: [], chits: [], disputes: [], identities: [], compare: [], fxRates: [], fxReady: true, fxLines: true };
  fakeDb.T = T;   /* the terms reads (finance-terms.customerTerms) answer from THIS store's parties + T.shopTerms */
  let itemSeq = 0, lineSeq = 0, clock = Date.parse('2026-09-29T10:00:00Z');
  const now = () => new Date(clock += 1000).toISOString();
  /* the whole range's lines (the real query without a page) — entryLines, entryPage and pageSums read it */
  async function allLines(e, from, to, account_id, party_id) {
      return T.lines.filter((l) => l.entity_id === e && (!account_id || l.account_id === account_id) && (!party_id || l.party_id === party_id)).map((l) => {
        const h = T.entries.find((x) => x.entry_id === l.entry_id), a = T.accounts.find((x) => x.account_id === l.account_id);
        const rvOf = (ent, x) => T.entries.filter((y) => y.entity_id === ent && y.reverses_entry_id === x.entry_id).sort((p, q) => String(p.created_at).localeCompare(String(q.created_at)))[0] || null;
        /* the real query's entity-scoped LEFT JOIN onto the shop's own chit (one copy) and the writer's identity */
        const c = h.source_chit_id ? T.chits.find((x) => x.chit_id === h.source_chit_id && x.entity_id === e) : null, bj = (c && c.business_json) || {};
        const who = h.created_by ? T.identities.find((x) => x.identity_id === h.created_by) : null;
        return Object.assign({}, l, { entry_no: h.entry_no, posting_date: h.posting_date, doc_date: h.doc_date, period: h.period, event_type: h.event_type, narration: h.narration, source_chit_id: h.source_chit_id,
          reverses_entry_id: h.reverses_entry_id, code: a.code, account_name: a.name, source_ref: h.source_ref || null,
          reversed_by: (rvOf(e, h) || {}).entry_no || null, reversed_by_id: (rvOf(e, h) || {}).entry_id || null, account_role: a.role,
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
  }
  const S = {
    TODO_SQL: "'record'", NAME_SQL: 'NULL', waitOfChitSql: () => 'NULL',   /* STD1: the SQL fragments (no database here) */
    ZERO, BILL_EVENTS: ['sale_bill', 'credit_given'], T, PAGE_MAX: 500, PAGE_DEFAULT: 100,
    async setting(db, e) { const s = T.setting.get(String(e)); return s ? clone(s) : null; },
    async saveSetting(db, e, s) { const cur = T.setting.get(String(e)) || {}; T.setting.set(String(e), Object.assign({}, cur, { entity_id: e, enabled: !!s.enabled, walkin_grain: s.walkin_grain || 'day',
      fy_start_month: s.fy_start_month || 4, functional_currency: s.functional_currency || 'INR', country: s.country || 'IN', pack_version: s.pack_version || cur.pack_version || null,
      enabled_at: cur.enabled_at || (s.enabled ? now() : null) /* the FIRST time it was switched on, kept (the real upsert's COALESCE) */ })); },
    async saveCheck(db, e, r) { const s = T.setting.get(String(e)); if (s) s.last_check = clone(r); },
    async accounts(db, e) { return clone(T.accounts.filter((a) => a.entity_id === e)).sort((a, b) => String(a.code).localeCompare(String(b.code))); },
    async setSourceCode(db, e, id, code) { const a = T.accounts.find((x) => x.entity_id === e && x.account_id === id); if (!a) return false; a.source_code = String(code).trim().slice(0, 20); return true; },
    async insertAccount(db, e, a) {
      if (T.accounts.some((x) => x.entity_id === e && x.code === a.code)) return null;
      if (a.role && T.accounts.some((x) => x.entity_id === e && x.role === a.role)) throw Object.assign(new Error('dup role'), { code: '23505' });
      const r = { account_id: id(), entity_id: e, code: a.code, name: a.name, parent_id: a.parent_id || null, is_group: !!a.is_group, nature: a.nature, role: a.role || null,
                  tally_group: a.tally_group || null, sch3_line: a.sch3_line || null, saft_grouping: a.saft_grouping || null, currency: null, active: true, source_code: a.source_code ? String(a.source_code).trim().slice(0, 20) : null };
      T.accounts.push(r); return r.account_id;
    },
    async periods(db, e, fy) { return clone(T.periods.filter((p) => p.entity_id === e && (!fy || p.fiscal_year === fy))).sort((a, b) => a.fiscal_year.localeCompare(b.fiscal_year) || a.period - b.period); },
    async periodFigures(db, e, fy) {
      const m = new Map();
      T.entries.filter((x) => x.entity_id === e && (!fy || x.fiscal_year === fy)).forEach((x) => {
        const k = x.fiscal_year + '|' + x.period, r = m.get(k) || { fiscal_year: x.fiscal_year, period: Number(x.period), entries: 0, sales_minor: 0 };
        r.entries += 1; if (x.series === 'SV') r.sales_minor += Number(x.total_minor) || 0; m.set(k, r);
      });
      return Array.from(m.values());
    },
    async insertPeriod(db, e, p) { if (!T.periods.some((x) => x.entity_id === e && x.fiscal_year === p.fiscal_year && x.period === p.period)) T.periods.push(Object.assign({ entity_id: e, status: 'open' }, p)); },
    async setPeriodStatus(db, e, fy, p, status, by, reason) { const r = T.periods.find((x) => x.entity_id === e && x.fiscal_year === fy && Number(x.period) === Number(p)); if (!r) return null; Object.assign(r, { status, locked_by: by, reason }); return { status }; },
    async nextNo(db, e, series, fy) { const k = e + '|' + series + '|' + (fy || '-'); const n = (T.counters.get(k) || 1); T.counters.set(k, n + 1); return n; },
    async entryBySource(db, e, ref) { const h = T.entries.find((x) => x.entity_id === e && x.source_ref === ref); return h ? clone(h) : null; },
    async taxEntryLines(db, e, from, to, types) {
      return T.entries.filter((x) => x.entity_id === e && String(x.posting_date).slice(0, 10) >= from && String(x.posting_date).slice(0, 10) <= to && (types || []).indexOf(x.event_type) >= 0)
        .flatMap((h) => T.lines.filter((l) => l.entry_id === h.entry_id && !l.party_id).map((l) => ({ entry_id: h.entry_id, event_type: h.event_type, code: (T.accounts.find((a) => a.account_id === l.account_id) || {}).code, dr_minor: l.dr_minor, cr_minor: l.cr_minor })));
    },
    async unreversedForChit(db, e, chit_id) {
      const mine = T.entries.filter((x) => x.entity_id === e && x.source_ref && x.source_ref.indexOf('chit:' + chit_id) === 0 && !x.reverses_entry_id);
      return mine.filter((x) => !T.entries.some((y) => y.entity_id === e && y.reverses_entry_id === x.entry_id)).map((x) => x.entry_id);
    },
    async postedSources(db, e, refs) { return T.entries.filter((x) => x.entity_id === e && x.source_ref && (refs || []).indexOf(x.source_ref) >= 0).map((x) => x.source_ref); },
    async entry(db, e, eid) {
      const h = T.entries.find((x) => x.entity_id === e && x.entry_id === eid); if (!h) return null;
      return Object.assign(clone(h), { lines: clone(T.lines.filter((l) => l.entry_id === eid)), items: clone(T.items.filter((i) => i.entry_id === eid)) });
    },
    /* PERF1: pg = { entries } | { limit, after, noOpening } — the real query's page (books-store pageSql): one entry more than asked, keyset (date, no) */
    async entryLines(db, e, from, to, account_id, party_id, pg) {
      const all = await allLines(e, from, to, account_id, party_id);
      if (!pg) return all;
      if (Array.isArray(pg.entries)) return all.filter((l) => pg.entries.indexOf(l.entry_id) >= 0);
      const ids = [];
      all.forEach((l) => { if (pg.noOpening && Number(l.period) === 0) return; if (pg.after && (l.posting_date < pg.after.date || (l.posting_date === pg.after.date && l.entry_no <= pg.after.no))) return; if (ids.indexOf(l.entry_id) < 0) ids.push(l.entry_id); });
      const keep = ids.slice(0, Number(pg.limit || S.PAGE_DEFAULT) + 1);
      return all.filter((l) => keep.indexOf(l.entry_id) >= 0);
    },
    async entryPage(db, e, from, to, account_id, party_id, pg) {
      const lim = Math.min(S.PAGE_MAX, Math.max(1, Math.floor(Number(pg.limit) || S.PAGE_DEFAULT)));
      const rows = await S.entryLines(db, e, from, to, account_id, party_id, Object.assign({}, pg, { limit: lim, entries: null }));
      const ids = []; rows.forEach((l) => { if (ids[ids.length - 1] !== l.entry_id) ids.push(l.entry_id); });
      if (ids.length <= lim) return { rows, next: null, limit: lim };
      const keep = rows.filter((l) => l.entry_id !== ids[lim]), last = keep[keep.length - 1];
      return { rows: keep, next: last ? { date: last.posting_date, no: last.entry_no } : null, limit: lim };
    },
    async pageSums(db, e, from, to, account_id, party_id, after, noOpening) {
      const all = (await allLines(e, from, to, account_id, party_id)).filter((l) => !(noOpening && Number(l.period) === 0));
      const before = (l) => after && after.date && (l.posting_date < after.date || (l.posting_date === after.date && l.entry_no <= String(after.no)));
      const sum = (rows, k) => rows.reduce((t, l) => t + Number(l[k] || 0), 0), b = all.filter(before);
      return { entries: new Set(all.map((l) => l.entry_id)).size, dr: sum(all, 'dr_minor'), cr: sum(all, 'cr_minor'), before_dr: sum(b, 'dr_minor'), before_cr: sum(b, 'cr_minor'), by_line: !!(account_id || party_id) };
    },
    async entries(db, e, from, to) { return clone(T.entries.filter((h) => h.entity_id === e && h.posting_date >= from && h.posting_date <= to)); },
    async yearRows(db, e, fy) {
      const want = Array.isArray(fy) ? fy : [fy];   /* PERF1: one read for many years */
      return Array.from(T.balances.values()).filter((b) => b.entity_id === e && want.indexOf(b.fiscal_year) >= 0)
        .map((b) => ({ fiscal_year: b.fiscal_year, period: b.period, code: T.accounts.find((a) => a.account_id === b.account_id).code, party_key: b.party_key, dr_minor: b.dr_minor, cr_minor: b.cr_minor }));
    },
    async ledgerLines(db, e, from, to, party) {
      return T.lines.filter((l) => l.entity_id === e && (!party || l.party_id === party)).map((l) => {
        const h = T.entries.find((x) => x.entry_id === l.entry_id), a = T.accounts.find((x) => x.account_id === l.account_id);
        /* M29: the first entry that reverses this one (the real query's LEFT JOIN LATERAL … ORDER BY created_at LIMIT 1) */
        const rv = T.entries.filter((x) => x.entity_id === e && x.reverses_entry_id === h.entry_id).sort((p, q) => String(p.created_at).localeCompare(String(q.created_at)))[0] || null;
        return { entry_id: h.entry_id, entry_no: h.entry_no, posting_date: h.posting_date, fiscal_year: h.fiscal_year, period: h.period, is_opening: h.is_opening, source_ref: h.source_ref,
                 narration: h.narration, source_chit_id: h.source_chit_id, event_type: h.event_type, reverses_entry_id: h.reverses_entry_id || null, line_no: l.line_no, code: a.code, party_id: l.party_id,
                 dr_minor: l.dr_minor, cr_minor: l.cr_minor, currency: l.currency, reversed_by: rv ? rv.entry_no : null, reversed_narration: rv ? rv.narration : null };
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
    /* ── FX1: the rate table (b391) and the foreign balance (b392) — T.fxReady / T.fxLines say whether each migration "ran" ── */
    async fxLinesReady() { return !!T.fxLines; },
    async fxRatesReady() { return !!T.fxReady; },
    async fxRates(db, e, q) {
      const o = q || {};
      return clone(T.fxRates.filter((r) => r.entity_id === e && (!o.from || r.from_ccy === o.from)).sort((a, b) => b.rate_date.localeCompare(a.rate_date) || b.rate_id - a.rate_id).slice(0, o.limit || 500));
    },
    async insertFxRates(db, e, rows, by) {
      return rows.map((x) => { const r = Object.assign({ rate_id: T.fxRates.length + 1, entity_id: e, entered_by: by || null, created_at: now() }, clone(x)); T.fxRates.push(r); return clone(r); });
    },
    async fxRateOn(db, e, from, to, date, since) {
      const hit = T.fxRates.filter((r) => r.entity_id === e && r.from_ccy === from && r.to_ccy === to && (since ? r.rate_date >= since && r.rate_date <= date : r.rate_date === date))
        .sort((a, b) => b.rate_date.localeCompare(a.rate_date) || b.rate_id - a.rate_id)[0];
      return hit ? clone(hit) : null;
    },
    async foreignBalances(db, e, q) {
      const o = q || {}, m = new Map();
      for (const l of T.lines) {
        const h = T.entries.find((x) => x.entry_id === l.entry_id);
        if (l.entity_id !== e || !h || ymd(h.posting_date) > (o.asOf || '9999-12-31') || !l.txn_currency || l.txn_currency === o.functional) continue;
        if (o.party && l.party_id !== o.party) continue;
        if (o.account_ids && o.account_ids.length && o.account_ids.indexOf(l.account_id) < 0) continue;
        if (o.currency && l.txn_currency !== o.currency) continue;
        const k = [l.account_id, l.party_id || '', l.txn_currency].join('|');
        const r = m.get(k) || { account_id: l.account_id, party_id: l.party_id || null, txn_currency: l.txn_currency, fn_minor: 0, txn_minor: 0 };
        r.fn_minor += l.dr_minor - l.cr_minor; r.txn_minor += (l.dr_minor > 0 ? 1 : -1) * (l.amount_txn_minor || 0); m.set(k, r);
      }
      return Array.from(m.values()).filter((r) => r.txn_minor !== 0);
    },
    async partyNames(db, e, ids) { const out = {}; (ids || []).forEach((i) => { const p = T.parties.find((x) => x.party_id === i); if (p) out[i] = p.name; }); return out; },
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
    /* CS2: a never-posted ledger is RE-CHARTED in place (no DELETE on the setup tables): parked, the new pack laid over the codes that exist, the year's periods re-labelled by number */
    async parkChart(db, e) { T.accounts.forEach((a) => { if (a.entity_id === e) { a.role = null; a.active = false; } }); },
    async rechart(db, e, rows, o) {
      const byCode = new Map(T.accounts.filter((a) => a.entity_id === e).map((a) => [String(a.code), a]));
      (rows || []).forEach((r) => { const a = byCode.get(String(r.code)); if (!a) return; const p = r.parent_code ? byCode.get(String(r.parent_code)) : null;
        Object.assign(a, { name: r.name, is_group: !!r.is_group, nature: r.nature, role: r.role || null, tally_group: r.tally_group || null, sch3_line: r.sch3_line || null, saft_grouping: r.saft_grouping || null, active: true, parent_id: p ? p.account_id : null }); });
    },
    async relabelPeriods(db, e, fromFy, rows) {
      (rows || []).forEach((r) => { const p = T.periods.find((x) => x.entity_id === e && x.fiscal_year === fromFy && Number(x.period) === Number(r.period)); if (p) Object.assign(p, { fiscal_year: r.fiscal_year, start_date: r.start_date, end_date: r.end_date }); });
    },
    async periodSums() { return []; }, async lineSums() { return []; }, async firstYear() { return null; },
    async balanceDrift() { return []; }, async unbalancedEntries() { return []; },
    async items(db, e, party, account) { const many = Array.isArray(party); return clone(T.items.filter((i) => i.entity_id === e && (many ? party.indexOf(i.party_id) >= 0 : (!party || i.party_id === party)) && (!account || i.account_id === account))); },
    async itemOwners(db, e, account, refs) { const seen = new Set(), out = []; T.items.filter((i) => i.entity_id === e && i.account_id === account && i.ref === i.against_ref && (refs || []).indexOf(i.ref) >= 0)
      .forEach((i) => { const k = i.ref + '|' + i.party_id; if (!seen.has(k)) { seen.add(k); out.push({ ref: i.ref, party_id: i.party_id }); } }); return out; },
    async itemTotals(db, e, account) { const m = {}; T.items.filter((i) => i.entity_id === e && i.account_id === account).forEach((i) => { m[i.party_id] = (m[i.party_id] || 0) + i.amount_minor; }); return Object.keys(m).map((k) => ({ party_id: k, total_minor: m[k] })); },
    async accountNet(db, e, account) { let n = 0; T.balances.forEach((b) => { if (b.entity_id === e && b.account_id === account && b.party_key === ZERO) n += b.dr_minor - b.cr_minor; }); return n; },
    async insertPayment(db, e, p) {
      const seen = p.client_ref ? T.payments.find((x) => x.entity_id === e && x.client_ref === p.client_ref) : null;
      if (seen) return { payment_id: seen.payment_id, duplicate: true };
      const r = Object.assign({ payment_id: id(), entity_id: e, created_at: now() }, clone(p)); T.payments.push(r); return { payment_id: r.payment_id, duplicate: false };
    },
    async paymentsSince(db, e, party, direction, since) { return clone(T.payments.filter((p) => p.entity_id === e && p.party_id === party && p.direction === direction && String(p.created_at || '') >= String(since)).reverse()); },
    /* C3: the advisory lock has no memory shape — a test that needs the race stands in its own (tests/pay-fix twoClients) */
    async lockParty() {},
    async paymentsOfChit(db, e, chit) { const key = 'chitpay:' + chit; return T.payments.filter((x) => x.entity_id === e && (x.client_ref === key || String(x.client_ref || '').indexOf(key + ':') === 0)).map((p) => ({ payment_id: p.payment_id, amount_minor: p.amount_minor, currency: p.currency, client_ref: p.client_ref })); },
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
    /* STD1: `todo` · `name` as the real store reads them — the row's data, else TODO_SQL's reading of a row parked before they existed */
    async waiting(db, e, limit) { return clone(T.outbox.filter((o) => o.entity_id === e && !o.done_at).sort((a, b) => a.tries - b.tries || a.id - b.id).slice(0, limit || 100))
      .map((o) => Object.assign(o, { todo: todoOf(o), name: nameOf(o) })); },
    async waitingCount(db, e) { const out = { total: 0, accept: 0, add_supplier: 0, record: 0 };
      T.outbox.filter((o) => o.entity_id === e && !o.done_at).forEach((o) => { out[todoOf(o)]++; out.total++; }); return out; },
    async backfillTodo(db, e) { let n = 0; T.outbox.filter((o) => o.entity_id === e && !o.done_at && !(o.event && 'todo' in o.event)).forEach((o) => {
      o.event = Object.assign({}, o.event || {}, { todo: todoOf(o) }, nameOf(o) ? { name: nameOf(o) } : {}); n++; }); return n; },
    /* STD1: the one supplier-by-name resolver, over the parties table (supplier rows): exactly one by name / nickname; else ≤ 3 near */
    async supplierByName(db, e, P) {
      const no = P && P.party_no != null ? String(P.party_no).trim() : '', nm = P && P.name != null ? String(P.name).trim().toLowerCase() : '';
      if (!no && !nm) return { one: null, near: [] };
      const sup = T.parties.filter((x) => x.owner === e && x.supplier), low = (v) => String(v || '').trim().toLowerCase();
      const exact = no ? sup.filter((x) => x.party_no === no) : sup.filter((x) => low(x.name) === nm || low(x.nickname) === nm);
      const one = exact.length === 1 ? { party_id: String(exact[0].party_id), name: String(exact[0].name || ''), party_no: exact[0].party_no || null } : null;
      const near = one || no ? [] : sup.filter((x) => low(x.name).indexOf(nm) >= 0 || low(x.nickname).indexOf(nm) >= 0)
        .sort((a, b) => (low(b.name).startsWith(nm) - low(a.name).startsWith(nm)) || String(a.name).localeCompare(String(b.name))).slice(0, 3).map((x) => ({ name: String(x.name), party_no: x.party_no || null }));
      return { one, near };
    },
    async outboxClose(db, e, ids, why) { const l = (ids || []).map(String); let n = 0; T.outbox.forEach((o) => { if (o.entity_id === e && !o.done_at && l.indexOf(String(o.source_chit_id)) >= 0) { o.done_at = now(); o.why = why; n++; } }); return n; },
    async outboxDone(db, e, oid, ok, why, ev) { const o = T.outbox.find((x) => x.id === oid); if (!o) return; o.tries++; if (ok) o.done_at = now(); else { o.why = why; if (ev && typeof ev === 'object') o.event = Object.assign({}, o.event || {}, clone(ev)); } },
    async logChange(db, e, c) { T.changes.push(Object.assign({ entity_id: e, at: now() }, clone(c))); },
    async changes(db, e) { return clone(T.changes.filter((c) => c.entity_id === e)); },
    async terms(db, e, party, side) { const p = T.parties.find((x) => x.owner === e && x.party_id === party && x[side]); return p ? { credit_days: p.credit_days == null ? null : p.credit_days, credit_limit_minor: null, party_no: p.party_no } : null; },
    async parties(db, e, ids) { return clone(T.parties.filter((p) => p.owner === e && (!Array.isArray(ids) || ids.map(String).indexOf(String(p.party_id)) >= 0))).map((p) => Object.assign(p, { on_rail: p.on_rail === true })); },
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
    /* ── M30 · the payment advice (b285): T.adviceReady = false stands in for "the migration has not run" ── */
    async adviceReady() { return T.adviceReady !== false; },
    async paymentsAdvice(db, e, ids) { return T.payments.filter((p) => p.entity_id === e && (ids || []).indexOf(p.payment_id) >= 0).map((p) => ({ payment_id: p.payment_id, advice_chit_id: p.advice_chit_id || null, advice_shared_at: p.advice_shared_at || null })); },
    async setAdvice(db, e, pid, patch) {
      const p = T.payments.find((x) => x.entity_id === e && x.payment_id === pid), q = patch || {}; if (!p) return null;
      const pick = () => ({ payment_id: p.payment_id, advice_chit_id: p.advice_chit_id || null, advice_shared_at: p.advice_shared_at || null });
      if (q.advice_chit_id && p.advice_chit_id && p.advice_chit_id !== q.advice_chit_id) return Object.assign({ conflict: true }, pick());
      if (q.advice_chit_id && !p.advice_chit_id) p.advice_chit_id = q.advice_chit_id;
      if (q.advice_shared_at && !p.advice_shared_at) p.advice_shared_at = q.advice_shared_at;
      return pick();
    },
    async adviceStates(db, e, ids) { const o = {}; (ids || []).forEach((id) => { const c = T.chits.find((x) => x.chit_id === id && x.entity_id === e); if (c) o[id] = { status: c.status || 'delivered', disputed: T.disputes.some((d) => d.entity_id === e && d.chit_id === id && d.status === 'open') }; }); return o; },
    async paymentsNeedingAdvice(db, e, limit) {
      return T.payments.filter((p) => p.entity_id === e && !p.advice_chit_id && !p.advice_shared_at).filter((p) => {
        const party = T.parties.find((x) => x.owner === e && x.party_id === p.party_id); if (!party || party.on_rail !== true) return false;
        const o = T.entries.find((h) => h.entity_id === e && h.source_ref === 'pay:' + p.payment_id); if (!o) return false;
        if (T.entries.some((h) => h.entity_id === e && h.reverses_entry_id === o.entry_id)) return false;
        if (p.mode === 'cheque' && !T.items.some((i) => i.entity_id === e && i.payment_id === p.payment_id && i.ref_kind === 'status' && i.status === 'cleared')) return false;
        return true;
      }).map((p) => ({ payment_id: p.payment_id, party_id: p.party_id, name: (T.parties.find((x) => x.owner === e && x.party_id === p.party_id) || {}).name || null, direction: p.direction, amount_minor: p.amount_minor, currency: p.currency, mode: p.mode, received_at: p.received_at }))
        .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at))).slice(0, limit || 50);
    },
    /* PR1: the parallel-run snapshots (b309 stood in; insert-only, one row per snapshot part) */
    async compareReady() { return T.compareReady !== false; },
    async compareSnapshots(db, e) {
      const m = new Map();
      T.compare.filter((x) => x.entity_id === e).forEach((x) => { const s = m.get(x.snapshot_id) || { snapshot_id: x.snapshot_id, label: x.label, source: x.source, period_from: x.period_from, period_to: x.period_to, currency: x.currency, parts: [], lines: 0, created_at: x.created_at };
        s.parts.push(x.part); s.parts.sort(); s.lines += x.rows.length; m.set(x.snapshot_id, s); });
      return clone(Array.from(m.values()).reverse());
    },
    async compareParts(db, e, sid) { return clone(T.compare.filter((x) => x.entity_id === e && x.snapshot_id === sid).sort((a, b) => a.part.localeCompare(b.part))); },
    async insertComparePart(db, e, p) {
      if (T.compare.some((x) => x.entity_id === e && x.snapshot_id === p.snapshot_id && x.part === p.part)) return null;
      const r = { part_id: id(), entity_id: e, snapshot_id: p.snapshot_id, label: p.label, source: p.source, part: p.part, period_from: p.period_from || null, period_to: p.period_to, currency: p.currency,
        file_name: p.file_name || null, rows: clone(p.rows || []), created_by: p.by || null, created_at: now() };
      T.compare.push(r); return r.part_id;
    },
    async shopName(db, e) { const i = T.identities.find((x) => x.identity_id === e); return i ? i.display_name || null : null; },
    /* BR1 · the rail leg of the bank reconciliation: my advice + bank-question copies, as the SQL answers them */
    async bankRailChits(db, e, from, to, limit) {
      return clone(T.chits.filter((c) => c.entity_id === e && c.business_json && /^(payment_advice|bank_query)$/.test(c.business_json.kind) && c.direction))
        .map((c) => ({ chit_id: c.chit_id, direction: c.direction, business_json: c.business_json, line_items: c.line_items || [], status: c.status || null, created_at: c.created_at || null,
          party_id: c.party_id || null, party_name: c.party_name || null })).slice(0, limit || 500);
    },
  };
  return S;
}
/** a db handle that accepts the savepoint chatter and nothing else */
/** ⭐ CS1: the country gate's two reads (lib/country-setup, marked country-setup) — this rig's shop is an INDIAN shop whose setup is done;
 *  tests/country-setup.test.cjs stands in its own rows for the other countries. Reassign fakeDb.countryRow to change the answer. */
const fakeDb = {
  countryRow: { country: 'IN', currency_code: 'INR', gstn: '33AAAAA0000A1Z5', timezone: 'Asia/Kolkata', policy_flags: { gst_registration: 'regular' } },
  query: async (text, v) => {
    const t = String(text);
    if (t.includes('country-setup') && t.includes('FROM identities')) return { rows: fakeDb.countryRow ? [fakeDb.countryRow] : [] };
    if (t.includes('country-setup') && t.includes('FROM entity_governance')) return { rows: [] };
    if (/^\s*(SAVEPOINT|RELEASE|ROLLBACK)/i.test(t) || /FROM identities WHERE identity_id = \$1$/.test(t.trim())) return { rows: [] };
    /* "is table X there?" (lib/crm-followups.migrated — F3's promise dates ask it): in memory the CRM tables are NOT; the reader takes that answer and goes on */
    if (/to_regclass\(/.test(t)) return { rows: [{ i: false, f: false }] };
    /* the repeating entries (b281, lib/books-recurring): in memory the table is NOT there unless a test hands R.use() its own store — the reader takes 42P01 as "not migrated" */
    if (/FROM recurring_entry/.test(t)) { const e = new Error('relation "recurring_entry" does not exist'); e.code = '42P01'; throw e; }
    /* FIN-R1: the shop's default terms and every customer's own (lib/finance-terms.customerTerms) — T.shopTerms · T.parties[].terms */
    const T = fakeDb.T || { parties: [] };
    if (/^SELECT terms FROM books_setting/.test(t.trim())) return { rows: [{ terms: T.shopTerms || null }] };
    if (/FROM customer_list WHERE owner_entity_id = \$1$/.test(t.trim()) && /customer_identity_id AS party_id/.test(t)) {
      return { rows: T.parties.filter((p) => p.customer && p.owner === (v || [])[0]).map((p) => ({ party_id: p.party_id, credit_days: p.credit_days == null ? null : p.credit_days,
        credit_limit_minor: p.credit_limit_minor == null ? null : String(p.credit_limit_minor), terms: p.terms || null })) };
    }
    throw new Error('the in-memory tests ran real SQL: ' + t.slice(0, 80));
  },
};

module.exports = { create, fakeDb, ZERO, ymd };
