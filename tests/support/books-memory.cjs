/**
 * tests/support/books-memory.cjs — an IN-MEMORY lib/books-store.js, for proving the ledger's logic with no database.
 * ⚠️ It has EXACTLY the real store's exports (tests/books-post.test.cjs fails when the two drift), and it keeps the tables' own rules that the logic leans on: the journal is insert-only, a source_ref posts once, a party number is never reused, the counter row moves by one. It is not a second implementation of Postgres — enough to hold rows.
 */
'use strict';
const ZERO = '00000000-0000-0000-0000-000000000000';
let uid = 0; const id = () => '00000000-0000-4000-8000-' + String(++uid).padStart(12, '0');
const clone = (x) => JSON.parse(JSON.stringify(x)), ymd = (v) => (v ? String(v).slice(0, 10) : null);
const { todoOf, nameOf, openRowsOf } = require('./books-memory-outbox.cjs'); /* the outbox reads of the twin: the real store's TODO / NAME / OPEN_ROWS SQL */
function create() {
  const T = { loanLocks: new Map(), setting: new Map(), accounts: [], periods: [], counters: new Map(), entries: [], lines: [], balances: new Map(), items: [], payments: [],
              outbox: [], changes: [], parties: [], packs: [], chits: [], disputes: [], identities: [], compare: [], fxRates: [], fxReady: true, fxLines: true };
  fakeDb.T = T;   /* the terms reads (finance-terms.customerTerms) answer from THIS store's parties + T.shopTerms */
  let itemSeq = 0, lineSeq = 0, clock = Date.parse('2026-09-29T10:00:00Z');
  const now = () => new Date(clock += 1000).toISOString();
  /* the whole range's lines (the real query without a page) — entryLines, entryPage and pageSums read it */ async function allLines(e, from, to, account_id, party_id) {
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
    async lowerStart(db, e, ts) { const s = T.setting.get(String(e)); if (!s || !s.enabled_at || new Date(s.enabled_at) <= new Date(ts)) return false; s.enabled_at = new Date(ts).toISOString(); return true; },
    async saveCheck(db, e, r) { const s = T.setting.get(String(e)); if (s) s.last_check = clone(r); },
    async accounts(db, e) { return clone(T.accounts.filter((a) => a.entity_id === e)).sort((a, b) => String(a.code).localeCompare(String(b.code))); },
    async freeRetiredRoles(db, e, codes) { return T.accounts.filter((x) => x.entity_id === e && x.role && codes.indexOf(String(x.code)) >= 0).map((x) => { const r = { account_id: x.account_id, code: x.code, role: x.role }; x.role = null; return r; }); }, async setSourceCode(db, e, id, code) { const a = T.accounts.find((x) => x.entity_id === e && x.account_id === id); if (!a) return false; a.source_code = String(code).trim().slice(0, 20); return true; },
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
      const days = new Map();
      T.entries.filter((x) => x.entity_id === e && (!fy || x.fiscal_year === fy) && Number(x.period) === 0).forEach((x) => { const k = x.fiscal_year + '|' + String(x.posting_date).slice(0, 10); days.set(k, (days.get(k) || 0) + 1); });
      const months = T.periods.filter((p) => p.entity_id === e).map((p) => ({ fiscal_year: p.fiscal_year, period: p.period, start_date: String(p.start_date).slice(0, 10), end_date: String(p.end_date).slice(0, 10) }));
      return require('../../lib/books-opening-count').foldOpening(Array.from(m.values()), Array.from(days, ([k, n]) => ({ fiscal_year: k.split('|')[0], day: k.split('|')[1], n })), months); /* same fold as the real read (P1-1) */
    },
    async hasTrading(db, e) { return T.entries.some((x) => x.entity_id === e && Number(x.period) > 0); }, async insertPeriod(db, e, p) { if (!T.periods.some((x) => x.entity_id === e && x.fiscal_year === p.fiscal_year && x.period === p.period)) T.periods.push(Object.assign({ entity_id: e, status: 'open' }, p)); },
    async setPeriodStatus(db, e, fy, p, status, by, reason) { const r = T.periods.find((x) => x.entity_id === e && x.fiscal_year === fy && Number(x.period) === Number(p)); if (!r) return null; Object.assign(r, { status, locked_by: by, reason }); return { status }; },
    async giveBackNo(db, e, series, fy, n) { const k = e + '|' + series + '|' + (fy || '-'); if (T.counters.get(k) === n + 1) T.counters.set(k, n); },
    async nextNo(db, e, series, fy) { const k = e + '|' + series + '|' + (fy || '-'); const n = (T.counters.get(k) || 1); T.counters.set(k, n + 1); return n; },
    async chitPosted(db, e, chit_id) { const ref = 'chit:' + chit_id; return T.entries.some((x) => x.entity_id === e && (x.source_ref === ref || String(x.source_ref).startsWith(ref + ':') || x.source_ref === 'walkin-late:' + chit_id || (Array.isArray(x.source_chit_ids) && x.source_chit_ids.map(String).indexOf(String(chit_id)) >= 0))); },
    async entriesBySourceBase(db, e, base) {
      return T.entries.filter((x) => x.entity_id === e && (x.source_ref === base || String(x.source_ref || '').indexOf(base + ':r') === 0))
        .map((x) => Object.assign(clone(x), { reversed: T.entries.some((y) => y.entity_id === e && y.reverses_entry_id === x.entry_id) }));
    },
    async entryBySource(db, e, ref) { const h = T.entries.find((x) => x.entity_id === e && x.source_ref === ref); return h ? clone(h) : null; },
    async taxEntryLines(db, e, from, to, types, shape) {
      /* the real query's two doors: the event word, or the SHAPE (every line on a tax or money role, one on a tax role; never an opening) */
      const day = (x) => String(x.posting_date).slice(0, 10), roleOf = (l) => (T.accounts.find((a) => a.account_id === l.account_id) || {}).role;
      const tax = (shape && shape.tax) || [], money = (shape && shape.money) || [];
      const shaped = (h) => { const ls = T.lines.filter((l) => l.entry_id === h.entry_id); return !h.is_opening && ls.some((l) => tax.indexOf(roleOf(l)) >= 0) && ls.every((l) => tax.concat(money).indexOf(roleOf(l)) >= 0); };
      return T.entries.filter((x) => x.entity_id === e && day(x) >= from && day(x) <= to && ((types || []).indexOf(x.event_type) >= 0 || shaped(x)))
        .flatMap((h) => T.lines.filter((l) => l.entry_id === h.entry_id && !l.party_id).map((l) => ({ entry_id: h.entry_id, event_type: h.event_type, code: (T.accounts.find((a) => a.account_id === l.account_id) || {}).code, dr_minor: l.dr_minor, cr_minor: l.cr_minor })));
    },
    async taxedIncomeLines(db, e, from, to, outputRole, skipRoles) {
      const day = (x) => String(x.posting_date).slice(0, 10), acct = (l) => T.accounts.find((a) => a.account_id === l.account_id) || {}, out = new Map();
      T.entries.filter((x) => x.entity_id === e && day(x) >= from && day(x) <= to && !x.is_opening).forEach((h) => {
        const ls = T.lines.filter((l) => l.entry_id === h.entry_id);
        if (!ls.some((l) => acct(l).role === outputRole)) return;
        ls.filter((l) => !l.party_id && acct(l).nature === 'income' && (skipRoles || []).indexOf(acct(l).role) < 0).forEach((l) => { const r = out.get(acct(l).code) || { code: acct(l).code, dr_minor: 0, cr_minor: 0 }; r.dr_minor += Number(l.dr_minor || 0); r.cr_minor += Number(l.cr_minor || 0); out.set(r.code, r); });
      });
      return Array.from(out.values());
    },
    async taxedOnlyLines(db, e, from, to, taxRole, roles) {
      const day = (x) => String(x.posting_date).slice(0, 10), acct = (l) => T.accounts.find((a) => a.account_id === l.account_id) || {}, out = new Map();
      T.entries.filter((x) => x.entity_id === e && day(x) >= from && day(x) <= to && !x.is_opening).forEach((h) => {
        const ls = T.lines.filter((l) => l.entry_id === h.entry_id);
        if (!ls.some((l) => acct(l).role === taxRole)) return;
        ls.filter((l) => (roles || []).indexOf(acct(l).role) >= 0 && !/^0+([.]0+)?$/.test(String(l.tax_rate == null ? '' : l.tax_rate))).forEach((l) => { const r = out.get(acct(l).code) || { code: acct(l).code, dr_minor: 0, cr_minor: 0 }; r.dr_minor += Number(l.dr_minor || 0); r.cr_minor += Number(l.cr_minor || 0); out.set(r.code, r); });
      });
      return Array.from(out.values());
    },
    async taxOfEntriesWith(db, e, from, to, taxRole, roles) { const day = (x) => String(x.posting_date).slice(0, 10), role = (l) => (T.accounts.find((a) => a.account_id === l.account_id) || {}).role; let net = 0; T.entries.filter((x) => x.entity_id === e && day(x) >= from && day(x) <= to && !x.is_opening).forEach((h) => { const ls = T.lines.filter((l) => l.entry_id === h.entry_id); if (ls.some((l) => roles.indexOf(role(l)) >= 0)) ls.filter((l) => role(l) === taxRole).forEach((l) => { net += Number(l.dr_minor || 0) - Number(l.cr_minor || 0); }); }); return { net_minor: net }; },
    async zeroRateSales(db, e, from, to, role, currency) {
      const day = (x) => String(x.posting_date).slice(0, 10);
      const live = (x) => !x.reverses_entry_id && !T.entries.some((r) => r.entity_id === e && r.reverses_entry_id === x.entry_id);
      const got = T.entries.filter((x) => x.entity_id === e && day(x) >= from && day(x) <= to && live(x))
        .flatMap((h) => T.lines.filter((l) => l.entry_id === h.entry_id && l.currency === currency && /^0+([.]0+)?$/.test(String(l.tax_rate == null ? '' : l.tax_rate))
          && (T.accounts.find((a) => a.account_id === l.account_id) || {}).role === role));
      return { lines: got.length, total_minor: got.reduce((sum, l) => sum + Number(l.cr_minor || 0) - Number(l.dr_minor || 0), 0) };
    },
    /* supply kind: the catalogue's 0% slabs with no kind and the items with a bare 0% (a test stands rows in: T.kindless = { slabs: [{ id, name }], items: n }) */
    async zeroRateKindless(db, e) {
      const held = (T.kindless && T.kindless[e]) || { slabs: [], items: 0 };
      return { slabs: held.slabs.slice(0, 50), slab_count: held.slabs.length, item_count: held.items };
    },
    /* OPS-81: my receipts of their bill against these chits — none unless a test stands rows in (T.receiptBills) */
    async receiptBillsAgainst(db, e, ids) {
      const live = (r) => T.entries.find((x) => x.entity_id === e && x.source_ref === 'chit:' + r.chit_id && !x.reverses_entry_id && !T.entries.some((y) => y.entity_id === e && y.reverses_entry_id === x.entry_id));
      return (T.receiptBills || []).filter((r) => (ids || []).indexOf(r.on) >= 0 && live(r)).map((r) => ({ chit_id: r.chit_id, no: r.no, total: r.total, entry_id: live(r).entry_id, entry_no: live(r).entry_no }));
    },
    async unreversedForChit(db, e, chit_id) {
      const mine = T.entries.filter((x) => x.entity_id === e && x.source_ref && x.source_ref.indexOf('chit:' + chit_id) === 0 && !x.reverses_entry_id);
      return mine.filter((x) => !T.entries.some((y) => y.entity_id === e && y.reverses_entry_id === x.entry_id)).map((x) => x.entry_id);
    },
    async inputTaxOfChits(db, e, chitIds, roles, from, to) {
      const out = {}, day = (x) => String(x.posting_date).slice(0, 10);
      const chitOf = (x) => { const m = /^chit:([0-9a-f-]{36})/.exec(x.source_ref || ''); return m ? m[1] : null; };
      const live = (x) => !x.reverses_entry_id && !T.entries.some((r) => r.entity_id === e && r.reverses_entry_id === x.entry_id && day(r) < to);
      for (const x of T.entries.filter((y) => y.entity_id === e && chitIds.map(String).indexOf(chitOf(y)) >= 0 && day(y) >= from && day(y) < to && live(y))) {
        for (const l of T.lines.filter((z) => z.entry_id === x.entry_id)) {
          const a = T.accounts.find((acc) => acc.account_id === l.account_id);
          if (a && roles.indexOf(a.role) >= 0) { const m = (out[chitOf(x)] = out[chitOf(x)] || {}); m[a.role] = (m[a.role] || 0) + Number(l.dr_minor || 0) - Number(l.cr_minor || 0); }
        }
      }
      return out;
    },
    async markedRows(db, e, table, field, ids) { return T.changes.filter((c) => c.entity_id === e && c.table_name === table && c.field === field && (ids || []).indexOf(String(c.row_id)) >= 0).map((c) => String(c.row_id)); },
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
    /* l16-scale: what each year's month rows add up to (the carry key's stamp); dr and cr as text, as Postgres sums a bigint */
    async yearStamps(db, e) {
      const by = new Map();
      T.balances.forEach((b) => {
        if (b.entity_id !== e) return;
        const y = by.get(b.fiscal_year) || { fiscal_year: b.fiscal_year, n: 0, dr: 0, cr: 0, lines: 0 };
        y.n += 1; y.dr += b.dr_minor; y.cr += b.cr_minor; y.lines += b.line_count; by.set(b.fiscal_year, y);
      });
      return [...by.values()].sort((a, b) => String(a.fiscal_year).localeCompare(String(b.fiscal_year))).map((y) => Object.assign(y, { dr: String(y.dr), cr: String(y.cr), lines: String(y.lines) }));
    },
    /* b873 year_carry is a cache the memory store does not keep: nothing kept, nothing written, the books recompute (the real table is proved in the l16-scale realstack) */
    async carryRead() { return null; },
    async carryWrite() { return false; },
    async years(db, e) { return Array.from(new Set(Array.from(T.balances.values()).filter((b) => b.entity_id === e).map((b) => b.fiscal_year))).sort(); },
    /* ── the four writes ── */
    async insertEntry(db, e, h) {
      if (h.source_ref && T.entries.some((x) => x.entity_id === e && x.source_ref === h.source_ref)) throw Object.assign(new Error('duplicate key value violates unique constraint "journal_entry_src_uq"'), { code: '23505', constraint: 'journal_entry_src_uq' });
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
    /* FIN-63: ONE moment per list, as Postgres stamps one transaction (now() is the transaction start); item_id is a string, as pg returns a bigint */
    async insertItems(db, e, items) {
      const at = now();
      for (const it of items) {
        if (['bill', 'advance', 'on_account', 'allocation', 'reversal', 'status'].indexOf(it.ref_kind) < 0) throw new Error('party_item_kind_chk');
        if (['receivable', 'payable'].indexOf(it.side) < 0) throw new Error('party_item_side_chk');
        if (!it.ref || !it.against_ref || !it.party_id || !it.account_id || !it.currency) throw new Error('party_item not null: ' + JSON.stringify(it));
        T.items.push(Object.assign({ item_id: String(++itemSeq), entity_id: e, created_at: at }, clone(it)));
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
    /* REP-48: the in-memory twin of soldByDay (same shape, bounds, mixed rule) — held to the real SQL by tests/sold-one-rule.test.cjs; the kinds and roles are written here as plain lists so no other file names the real constants */
    async soldByDay(db, e, bound) {
      const kinds = ['walkin_day', 'sale_bill', 'credit_given', 'return'], tenders = ['cash', 'upi', 'card', 'bank'], soldRoles = tenders.concat('debtors');
      const days = new Map(), acct = (l) => T.accounts.find((a) => a.account_id === l.account_id) || {};
      T.entries.filter((h) => h.entity_id === e && kinds.indexOf(h.event_type) >= 0 && !h.reverses_entry_id && !T.entries.some((r) => r.entity_id === e && r.reverses_entry_id === h.entry_id)).forEach((h) => {
        const day = ymd(h.posting_date);
        if ((bound && bound.from && day < bound.from) || (bound && bound.to && day > bound.to)) return;
        const lines = T.lines.filter((l) => l.entry_id === h.entry_id && soldRoles.indexOf(acct(l).role) >= 0);
        const d = days.get(day) || { day, sold: 0, taken: 0, bills: 0, cur: new Set() };
        lines.forEach((l) => { const net = (l.dr_minor || 0) - (l.cr_minor || 0); d.sold += net; if (tenders.indexOf(acct(l).role) >= 0) d.taken += net; d.cur.add(l.currency || 'INR'); });
        d.bills += Array.isArray(h.source_chit_ids) ? h.source_chit_ids.length : h.event_type === 'return' ? 0 : 1; days.set(day, d);
      });
      const money = (d, k) => (d.cur.size > 1 ? { minor: null, currency: '*mixed*' } : { minor: d[k], currency: [...d.cur][0] || null });
      return [...days.values()].sort((p, q) => p.day.localeCompare(q.day)).map((d) => ({ day: d.day, sold: money(d, 'sold'), taken: money(d, 'taken'), bills: d.bills }));
    },
    soldEntriesSql: require('../../lib/books-store').soldEntriesSql,
    LOAN_HAS_INSTALMENTS_WORDS: require('../../lib/books-store').LOAN_HAS_INSTALMENTS_WORDS,
    loanRefSql: require('../../lib/books-store').loanRefSql,
    YOY_STATEMENT: require('../../lib/books-store').YOY_STATEMENT,
    /* MIS A1: the in-memory twin of soldTotals (the SUM of this twin's soldByDay over each range; the real statement is held to soldByDay by tests/books-sold-totals.realstack.cjs) */
    async soldTotals(db, e, ranges) {
      const out = [];
      for (const r of ranges || []) {
        const days = await this.soldByDay(db, e, { from: r.from, to: r.to }), cur = new Set(days.map((d) => d.sold.currency).filter(Boolean)), mixed = cur.size > 1 || cur.has('*mixed*');
        const sum = (k) => (mixed ? null : days.reduce((t, d) => t + d[k].minor, 0)), currency = mixed ? '*mixed*' : [...cur][0] || null;
        out.push({ from: r.from, to: r.to, sold: { minor: sum('sold'), currency }, taken: { minor: sum('taken'), currency }, bills: days.reduce((t, d) => t + d.bills, 0), entries: days.length, through: days.length ? days[days.length - 1].day : null, first: days.length ? days[0].day : null });
      }
      return out;
    },
    async soldFrom(db, e) { const k = ['walkin_day', 'sale_bill', 'credit_given', 'return']; const d = T.entries.filter((h) => h.entity_id === e && k.indexOf(h.event_type) >= 0).map((h) => ymd(h.posting_date)).sort(); return d[0] || null; },
    async periodSums() { return []; }, async lineSums() { return []; }, async firstYear() { return null; },
    async balanceDrift() { return []; }, async unbalancedEntries() { return []; },
    async items(db, e, party, account) { const many = Array.isArray(party); return clone(T.items.filter((i) => i.entity_id === e && (many ? party.indexOf(i.party_id) >= 0 : (!party || i.party_id === party)) && (!account || i.account_id === account))); },
    /* the same rule as lib/books-store openItems (= lib/books-open-items.rowsSql, scoped): the rows of a document that does not net to nothing or has a status row, closed over the allocation links both ways */
    async openItems(db, e, account, asOf) {
      const rows = T.items.filter((i) => i.entity_id === e && i.account_id === account && (!i.doc_date || (!asOf || String(i.doc_date).slice(0, 10) <= asOf))), sum = {}, status = new Set(), links = new Map();
      const link = (a, b) => { if (!links.has(a)) links.set(a, new Set()); links.get(a).add(b); };
      rows.forEach((i) => { sum[i.against_ref] = (sum[i.against_ref] || 0) + i.amount_minor; if (i.ref_kind === 'status') status.add(i.against_ref); if (i.ref !== i.against_ref) { link(i.ref, i.against_ref); link(i.against_ref, i.ref); } });
      const live = new Set(Object.keys(sum).filter((k) => sum[k] !== 0 || status.has(k))), queue = [...live];
      while (queue.length) for (const next of links.get(queue.pop()) || []) if (!live.has(next)) { live.add(next); queue.push(next); }
      return clone(rows.filter((i) => live.has(i.against_ref)));
    },
    async billParties(db, e, ref) { return [...new Set(T.items.filter((i) => i.entity_id === e && i.ref === i.against_ref && i.ref === String(ref)).map((i) => i.party_id))]; },
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
    async lockParty() {}, async lockSourceRef() {} /* R12a: the race is proved on the SIT box */,
    async lockOpening() {} /* ACC-328: the same — the race is proved on real Postgres (tests/acc-328-opening-twice.realstack.cjs) */,
    /* FIN-92: a per-loan queue; the holder lets go when its withEntity (books-harness) ends — what a Postgres advisory xact lock does at commit */
    async lockLoan(db, e, ref) {
      const key = e + '|loan|' + ref, before = T.loanLocks.get(key) || Promise.resolve();
      let release; const mine = new Promise((resolve) => { release = resolve; });
      T.loanLocks.set(key, before.then(() => mine));
      await before;
      if (db && db.heldLocks) db.heldLocks.push(release); else release();
    },
    async lockTaxHeads() {} /* ACC-275: the same — the race is proved on real Postgres (tests/acc-275-gst-replay-truth.realstack.cjs) */,
    async loanOutstanding(db, e, ref, roles) {
      const mine = T.entries.filter((x) => x.entity_id === e && (x.source_ref === 'loan:' + ref || (String(x.source_ref || '').indexOf('emi:' + ref + ':') === 0 && String(x.source_ref).slice(('emi:' + ref + ':').length).indexOf(':') < 0)) && !T.entries.some((y) => y.entity_id === e && y.reverses_entry_id === x.entry_id));
      const lines = T.lines.filter((l) => mine.some((x) => x.entry_id === l.entry_id) && roles.indexOf((T.accounts.find((a) => a.account_id === l.account_id) || {}).role) >= 0);
      const currencies = Array.from(new Set(lines.map((l) => l.currency)));
      return { minor: lines.reduce((total, l) => total + Number(l.cr_minor || 0) - Number(l.dr_minor || 0), 0), currency: currencies.length > 1 ? '*mixed*' : currencies[0] || null };
    },
    /* the in-memory twin of loanEntriesWithRepayments (the SQL, with loanRefSql, is proved on real Postgres): a loan: entry nobody reversed that holds a live emi:<ref>:<its ref> */
    async loanEntriesWithRepayments(db, e, entryIds) {
      const live = (x) => !T.entries.some((r) => r.reverses_entry_id === x.entry_id);
      const out = new Set();
      (entryIds || []).forEach((id) => {
        const loan = T.entries.find((x) => x.entity_id === e && String(x.entry_id) === String(id) && String(x.source_ref || '').indexOf('loan:') === 0 && live(x));
        if (!loan) return;
        const head = 'emi:' + String(loan.source_ref).slice(5) + ':';
        if (T.entries.some((x) => x.entity_id === e && !x.reverses_entry_id && String(x.source_ref || '').indexOf(head) === 0 && String(x.source_ref).slice(head.length).indexOf(':') < 0 && live(x))) out.add(String(id));
      });
      return out;
    },
    /* GET /loans: the same read as loanOutstanding, per loan entry (the SQL itself is proved on real Postgres) */
    async loanBalances(db, e, roles, opt) {
      const live = (x) => !T.entries.some((r) => r.reverses_entry_id === x.entry_id);
      const loans = T.entries.filter((x) => x.entity_id === e && String(x.source_ref || '').indexOf('loan:') === 0 && live(x));
      const one = opt && opt.ref != null ? String(opt.ref) : null;
      const rows = [];
      for (const loan of loans) {
        const ref = String(loan.source_ref).slice(5);
        if (one !== null && one !== ref) continue;
        const own = T.lines.filter((l) => l.entry_id === loan.entry_id && roles.indexOf((T.accounts.find((a) => a.account_id === l.account_id) || {}).role) >= 0);
        const left = await this.loanOutstanding(db, e, ref, roles);
        rows.push({ ref, narration: loan.narration || '', opening_minor: own.reduce((total, l) => total + Number(l.cr_minor || 0) - Number(l.dr_minor || 0), 0), outstanding_minor: left.minor, currency: left.currency, taken_on: String(loan.posting_date || '').slice(0, 10) || null });
      }
      rows.sort((first, second) => (first.taken_on < second.taken_on ? 1 : first.taken_on > second.taken_on ? -1 : first.ref < second.ref ? -1 : 1));
      const page = opt && opt.page;
      return { total: rows.length, rows: page ? rows.slice(page.offset, page.offset + page.limit) : rows };
    },
    async taxClosesOf(db, e, refs) {
      return T.entries.filter((x) => x.entity_id === e && refs.indexOf(x.source_ref) >= 0 && !T.entries.some((r) => r.reverses_entry_id === x.entry_id)).map((x) => ({ source_ref: x.source_ref, created_at: x.created_at, tax_close: x.tax_close || null }));
    },
    async entryDebitsByRole(db, e, entryId) {
      const rows = T.lines.filter((l) => l.entry_id === entryId && l.dr_minor > 0), by = {};
      rows.forEach((l) => { const role = (T.accounts.find((a) => a.account_id === l.account_id) || {}).role; by[role] = by[role] || { role, dr_minor: 0, currency: l.currency }; by[role].dr_minor += l.dr_minor; });
      return Object.values(by);
    },
    /* ACC-336: b849 tax_period and b854 tax_close "ran" in the stand-in (T.noTaxColumns turns them off for the column-absent case) */
    async taxColumnsReady() { return { period: !T.noTaxColumns, close: !T.noTaxColumns }; },
    async taxPaymentsNaming(db, e, taxPeriod, roles) {
      const reversed = (h) => T.entries.some((x) => x.entity_id === e && x.reverses_entry_id === h.entry_id);
      const out = [];
      T.entries.filter((h) => h.entity_id === e && h.tax_period === taxPeriod && !h.reverses_entry_id && !reversed(h)).forEach((h) => {
        T.lines.filter((l) => l.entry_id === h.entry_id && l.dr_minor > 0).forEach((l) => {
          const role = (T.accounts.find((x) => x.account_id === l.account_id) || {}).role;
          if (roles.indexOf(role) >= 0) out.push({ entry_id: h.entry_id, entry_no: h.entry_no, posting_date: ymd(h.posting_date), created_at: h.created_at, role, dr_minor: l.dr_minor, currency: l.currency });
        });
      });
      return out.sort((p, q) => String(p.created_at).localeCompare(String(q.created_at)) || String(p.entry_id).localeCompare(String(q.entry_id)));
    },
    async taxPaymentsWithoutPeriod(db, e, from) {
      const reversed = (h) => T.entries.some((x) => x.entity_id === e && x.reverses_entry_id === h.entry_id);
      return T.entries.filter((h) => h.entity_id === e && /^(tax_payment|gst_payment)$/.test(h.event_type) && !h.tax_period && !h.reverses_entry_id && !reversed(h) && ymd(h.posting_date) >= from).length;
    },
    async taxCloseOf(db, e, ref, closeColumn) {
      const h = T.entries.find((x) => x.entity_id === e && x.source_ref === ref);
      return h ? { entry_id: h.entry_id, entry_no: h.entry_no, created_at: h.created_at, tax_close: closeColumn ? clone(h.tax_close || null) : null } : null;
    },
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
    /* M-F-05: ONE open row per bill — the key is the chit, else the source_ref; a second park renews the open row (event, why), keeps tries and place */
    async queue(db, e, o) {
      const open = o.source_chit_id ? T.outbox.find((x) => x.entity_id === e && !x.done_at && x.source_chit_id === o.source_chit_id)
        : o.source_ref ? T.outbox.find((x) => x.entity_id === e && !x.done_at && x.source_ref === o.source_ref) : null;
      if (open) { open.event = clone(o.event || {}); open.why = String(o.why || '').slice(0, 500); return; }
      T.outbox.push(Object.assign({ id: T.outbox.length + 1, entity_id: e, tries: 0, created_at: now(), done_at: null }, clone(o)));
    },
    /* STD1: `todo` · `name` as the real store reads them — the row's data, else TODO_SQL's reading of a row parked before they existed; one row per bill (OPEN_ROWS_SQL: the newest) */
    async waiting(db, e, limit) { return clone(openRowsOf(T, e).sort((a, b) => a.tries - b.tries || a.id - b.id).slice(0, limit || 100))
      .map((o) => Object.assign(o, { todo: todoOf(o), name: nameOf(o) })); },
    async waitingCount(db, e) { const out = { total: 0, accept: 0, add_supplier: 0, record: 0 };
      openRowsOf(T, e).forEach((o) => { out[todoOf(o)]++; out.total++; }); return out; },
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
    async outboxClose(db, e, ids, why, only) { const l = (ids || []).map(String); let n = 0; T.outbox.forEach((o) => { if (o.entity_id === e && !o.done_at && l.indexOf(String(o.source_chit_id)) >= 0 && (!(only && only.press) || (o.event && o.event.press === only.press))) { o.done_at = now(); o.why = why; n++; } }); return n; },
    async outboxDone(db, e, oid, ok, why, ev) { const o = T.outbox.find((x) => x.id === oid); if (!o) return; o.tries++; if (ok) { o.done_at = now(); T.outbox.filter((x) => x.entity_id === e && !x.done_at && o.source_chit_id && x.source_chit_id === o.source_chit_id).forEach((x) => { x.done_at = now(); }); } else { o.why = why; if (ev && typeof ev === 'object') o.event = Object.assign({}, o.event || {}, clone(ev)); } },
    async logChange(db, e, c) { T.changes.push(Object.assign({ entity_id: e, at: now() }, clone(c))); },
    async yearLastEvent(db, e, fy) { const rows = T.changes.filter((c) => c.entity_id === e && c.table_name === 'fiscal_period' && String(c.row_id) === String(fy) && (c.field === 'year_closed' || c.field === 'year_reopened')); return rows.length ? clone(rows[rows.length - 1]) : null; },
    async yearCloseEvent(db, e, fy) { const rows = T.changes.filter((c) => c.entity_id === e && c.table_name === 'fiscal_period' && String(c.row_id) === String(fy) && c.field === 'year_closed'); if (!rows.length) return null; const last = rows[rows.length - 1]; const who = T.identities.find((x) => x.identity_id === last.by); return { at: last.at, by: last.by, by_name: who ? who.display_name || null : null }; }, /* YE-F-06: who closed the year and when, as the real store reads it */
    async changes(db, e) { return clone(T.changes.filter((c) => c.entity_id === e)); },
    async lockTrail(db, e, fy) { return clone(T.changes.filter((c) => c.entity_id === e && c.table_name === 'fiscal_period' && c.field === 'status' && (!fy || String(c.row_id).startsWith(fy + '/')))).map((c) => { const i = T.identities.find((x) => x.identity_id === c.by); return Object.assign({}, c, { by_name: i ? i.display_name || null : null }); }); },
    async terms(db, e, party, side) { const p = T.parties.find((x) => x.owner === e && x.party_id === party && x[side]); return p ? { credit_days: p.credit_days == null ? null : p.credit_days, credit_limit_minor: null, party_no: p.party_no } : null; },
    async parties(db, e, ids) { return clone(T.parties.filter((p) => p.owner === e && (!Array.isArray(ids) || ids.map(String).indexOf(String(p.party_id)) >= 0))).map((p) => Object.assign(p, { on_rail: p.on_rail === true })); },
    async partyOn(db, e, party) { if (require('../../lib/upi-waiting').isWaitingParty(e, party)) return { customer: true, supplier: false, ledgered: true, system: 'upi_waiting' }; const p = T.parties.find((x) => x.owner === e && x.party_id === party); return { customer: !!(p && p.customer), supplier: !!(p && p.supplier) }; },
    /* FIN-58: the flip reads my bill's parts and stamps one of them */
    async chitForFlip(db, e, id) { const c = T.chits.find((x) => x.chit_id === id && x.entity_id === e); return c ? clone({ business_json: c.business_json, currency_code: c.currency_code }) : null; },
    async stampConfirmed(db, e, id, index, at) { const c = T.chits.find((x) => x.chit_id === id && x.entity_id === e), part = c && c.business_json && c.business_json.payment && c.business_json.payment.parts[index]; if (part) { part.confirmed = true; part.confirmed_at = at; } },
    /* RAIL-146: partyOn for many ids at once, as lib/books-store partiesOn answers it (Map id → { customer, supplier }; an unknown id → both false) */
    async partiesOn(db, e, ids) { const out = new Map(); for (const id of ids || []) out.set(String(id), await this.partyOn(db, e, id)); return out; },
    async partyNoOf(db, e, party) { const p = T.parties.find((x) => x.owner === e && x.party_id === party); return p ? p.party_no || null : null; },
    async setPartyNo(db, e, party, no) { const p = T.parties.find((x) => x.owner === e && x.party_id === party); if (p && !p.party_no) p.party_no = no; },
    async billNos(db, e, ids) { const o = {}; (ids || []).forEach((i) => { const c = T.chits.find((x) => x.chit_id === i); if (c) o[i] = c.bill_no; }); return o; },
    async lastPack(db, e) { const p = T.packs.filter((x) => x.entity_id === e).slice(-1)[0]; return p ? clone(p) : null; },
    async insertPack(db, e, p) { const r = Object.assign({ entity_id: e, created_at: now() }, clone(p)); T.packs.push(r); return { pack_id: r.pack_id, created_at: r.created_at }; },
    async packs(db, e) { return clone(T.packs.filter((x) => x.entity_id === e)); },
    async pack(db, e, pid) { const p = T.packs.find((x) => x.entity_id === e && x.pack_id === pid); return p ? clone(p) : null; },
    async ackPack(db, e, pid) { const p = T.packs.find((x) => x.entity_id === e && x.pack_id === pid); if (!p) return null; p.acknowledged_at = p.acknowledged_at || now(); return { acknowledged_at: p.acknowledged_at }; },
    async counterBills() { return []; }, async countersBilling() { return []; }, async unpostedChits() { return []; }, async unpostedInWindow() { return []; }, async unpostedCount() { return { count: 0, oldest: null }; }, async cancelledStillPosted() { return []; },
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
    async openingDays(db, e) { return Array.from(new Set(T.entries.filter((h) => h.entity_id === e && h.is_opening && !h.reverses_entry_id && !T.entries.some((r) => r.reverses_entry_id === h.entry_id)).map((h) => String(h.posting_date).slice(0, 10)))).sort(); }, async hasEntries(db, e) { return T.entries.some((h) => h.entity_id === e); }, async hasPostings(db, e) { return T.entries.some((h) => h.entity_id === e && !h.reverses_entry_id); }, /* E-F-03 */ /* A-F-59: has the ledger ANY entry (Home Accounts card) */
    async namesOf(db, e, ids) { return new Map((ids || []).map((id) => { const i = T.identities.find((x) => String(x.identity_id) === String(id) && (String(x.identity_id) === String(e) || String(x.parent_entity_id) === String(e) || (T.grants || []).some((g) => String(g.grantor_entity) === String(e) && [String(x.identity_id), String(x.parent_entity_id)].includes(String(g.grantee_entity))))); return i ? [String(id), i.display_name || null] : null; }).filter(Boolean)); }, /* the real namesOf fences to the shop and its own people */
    async shopName(db, e) { const i = T.identities.find((x) => x.identity_id === e); return i ? i.display_name || null : null; },
    /* F5 A1 · the shop's registration facts (identities gstn · country · policy_flags.gst_registration), as the SQL answers them */
    async taxRegistration(db, e) { const i = T.identities.find((x) => x.identity_id === e) || {}; const flags = i.policy_flags || {};
      return { gstin: i.gstn || null, country: i.country || null, reg_type: flags.gst_registration || null }; },
    /* ACC-206 B · the sales let through unbalanced and not yet resolved (a filter on the stored chits and the change log), and the state of one */
    async moneyOverrides(db, e) { return clone(T.chits.filter((c) => c.entity_id === e && c.business_json && c.business_json.money_override
      && !T.changes.some((x) => x.entity_id === e && x.table_name === 'money_override' && x.field === 'resolved' && x.row_id === String(c.chit_id)))
      .map((c) => ({ chit_id: c.chit_id, ref: c.business_json.bill_no || null, by: c.business_json.money_override.by, at: c.business_json.money_override.at, why: c.business_json.money_override.why,
        step: c.business_json.money_override.step, unexplained_minor: c.business_json.money_override.unexplained_minor, words: null }))); },
    async movedByLock() { return []; }, /* AC-F-02: no locked month in memory, so no entry was moved by one */
    async chitExists(db, e, id) { return T.chits.some((c) => c.entity_id === e && String(c.chit_id) === String(id)); },
    async moneyOverrideState(db, e, chit_id) { return { held: T.chits.some((c) => c.entity_id === e && String(c.chit_id) === String(chit_id) && c.business_json && c.business_json.money_override),
      resolved: T.changes.some((x) => x.entity_id === e && x.table_name === 'money_override' && x.field === 'resolved' && x.row_id === String(chit_id)) }; },
    /* F5 A1 · the sale bills the books hold (an unreversed sale_bill or walk-in day entry) whose chit has a line with no rate — read only, newest first */
    async unratedSaleBills(db, e, from, to, limit) {
      const noRate = (l) => (l.gst_rate === undefined || l.gst_rate === null) && (l.rate === undefined || l.rate === null);
      const homed = T.entries.filter((h) => h.entity_id === e && /^(sale_bill|walkin_day)$/.test(String(h.event_type)) && !h.reverses_entry_id
        && h.posting_date >= from && h.posting_date <= to && !T.entries.some((r) => r.entity_id === e && r.reverses_entry_id === h.entry_id));
      const out = new Map(); /* one row per bill, however many entries name it (the SQL groups by chit) */
      for (const h of homed) for (const chit_id of h.source_chit_id ? [h.source_chit_id] : h.source_chit_ids || []) {
        /* ACC-203: the shop's one header row whichever direction ('received' first, as ORDER BY direction reads) */
        const c = T.chits.filter((x) => x.chit_id === chit_id && x.entity_id === e).sort((p, q) => String(p.direction || '').localeCompare(String(q.direction || '')))[0]; if (!c) continue;
        const lines = c.line_items || [], bj = c.business_json || {}, unrated = lines.filter(noRate).length; if (!unrated) continue;
        const seen = out.get(chit_id);
        if (seen && seen.posting_date >= ymd(h.posting_date)) continue;
        out.set(chit_id, { chit_id, entry_no: h.entry_no, posting_date: ymd(h.posting_date), printed_as: bj.printed_as || null, bill_no: bj.bill_no || null, billed_at: bj.billed_at || null, unrated, lines: lines.length,
          items: lines.filter(noRate).map((l) => l.name || l.particulars).filter(Boolean).slice(0, 5) });
      }
      return [...out.values()].sort((p, q) => (p.posting_date < q.posting_date ? 1 : p.posting_date > q.posting_date ? -1 : q.entry_no - p.entry_no)).slice(0, limit || 50);
    },
    /* BR1 · the rail leg of the bank reconciliation: my advice + bank-question copies, as the SQL answers them */
    async bankRailChits(db, e, from, to, limit) {
      return clone(T.chits.filter((c) => c.entity_id === e && c.business_json && /^(payment_advice|bank_query)$/.test(c.business_json.kind) && c.direction))
        .map((c) => ({ chit_id: c.chit_id, direction: c.direction, business_json: c.business_json, line_items: c.line_items || [], status: c.status || null, created_at: c.created_at || null,
          party_id: c.party_id || null, party_name: c.party_name || null })).slice(0, limit || 500);
    },
    SETTING_SQL: require('../../lib/books-store').SETTING_SQL /* the real constant: readBatch rides it, the memory store has no batch */
  };
  return S;
}
/** a db handle that accepts the savepoint chatter and nothing else. ⭐ CS1: the country gate's two reads (lib/country-setup, marked country-setup) — this rig's shop is an INDIAN shop whose setup is done;
 *  tests/country-setup.test.cjs stands in its own rows for the other countries. Reassign fakeDb.countryRow to change the answer. */
const fakeDb = {
  countryRow: { country: 'IN', currency_code: 'INR', gstn: '33AAAAA0000A1Z5', timezone: 'Asia/Kolkata', policy_flags: { gst_registration: 'regular' } },
  query: async (text, v) => {
    const t = String(text);
    if (t.includes('country-setup') && t.includes('FROM identities')) return { rows: fakeDb.countryRow ? [fakeDb.countryRow] : [] };
    if ((t.includes('country-setup') || /^SELECT tax_registration FROM entity_governance/.test(t.trim())) && t.includes('FROM entity_governance')) return { rows: [] }; /* AE-F-03 heldAnswersInto reads tax_registration too: in memory none is held, so a value sent is the only one */
    if (/^\s*(SAVEPOINT|RELEASE|ROLLBACK)/i.test(t) || /FROM identities WHERE identity_id = \$1$/.test(t.trim())) return { rows: [] };
    if (/FROM journal_entry WHERE entity_id = \$1 AND created_at >/.test(t)) return { rows: (fakeDb.T ? fakeDb.T.entries : []).filter((x) => x.entity_id === v[0]).slice().reverse().slice(0, 25).map((x) => ({ entry_id: x.entry_id, entry_no: x.entry_no, source_ref: x.source_ref || null })) }; /* R4 (lib/books-event-guard.recent): in memory every entry is 'recent' */
    if (/to_regclass\(/.test(t)) return { rows: [{ i: false, f: false }] }; /* "is table X there?" (lib/crm-followups.migrated — F3's promise dates ask it): in memory the CRM tables are NOT; the reader takes that answer and goes on */
    if (/FROM cb_attachment WHERE chit_id = ANY/.test(t)) return { rows: [] }; /* the evidence behind a books row (lib/books-evidence.attach): no file is held in memory */
    /* the repeating entries (b281, lib/books-recurring): in memory the table is NOT there unless a test hands R.use() its own store — the reader takes 42P01 as "not migrated" */
    if (/FROM recurring_entry/.test(t)) { const e = new Error('relation "recurring_entry" does not exist'); e.code = '42P01'; throw e; } if (t.includes('/* ledger-months */') && fakeDb.T) return require('./ledger-months-memory.cjs')(fakeDb.T, t, v); /* ACC-381 */
    /* FIN-R1: the shop's default terms and every customer's own (lib/finance-terms.customerTerms) — T.shopTerms · T.parties[].terms */
    const T = fakeDb.T || { parties: [] };
    if (/^SELECT terms FROM books_setting/.test(t.trim())) return { rows: [{ terms: T.shopTerms || null }] };
    if (/FROM customer_list WHERE owner_entity_id = \$1$/.test(t.trim()) && /customer_identity_id AS party_id/.test(t)) {
      return { rows: T.parties.filter((p) => p.customer && p.owner === (v || [])[0]).map((p) => ({ party_id: p.party_id, credit_days: p.credit_days == null ? null : p.credit_days,
        credit_limit_minor: p.credit_limit_minor == null ? null : String(p.credit_limit_minor), terms: p.terms || null })) };
    }
    /* R1-03 (lib/books-live-bill liveBillEntries): which of the asked entries are a live bill (sale_bill / purchase_bill, source chit:<id>, not reversed). The chit's own status is NOT modelled here: the real read is proved on Postgres (tests/r103-reverse-live-bill.realstack.cjs) */
    if (/^SELECT x.entry_id FROM journal_entry x/.test(t.trim())) {
      const asked = (v || [])[1] || [], mine = (T.entries || []).filter((h) => h.entity_id === (v || [])[0] && asked.indexOf(h.entry_id) >= 0);
      const live = (h) => (h.event_type === 'sale_bill' || h.event_type === 'purchase_bill') && /^chit:[0-9a-f-]{36}(:asset|:use)?$/.test(String(h.source_ref)) && !(T.entries || []).some((r) => r.reverses_entry_id === h.entry_id);
      return { rows: mine.filter(live).map((h) => ({ entry_id: h.entry_id })) };
    }
    /* AZ-F-03 (lib/books-bill-ref): the entry numbers of some entries; the rail bills' own numbers (books-store.billNos): no chit is held in memory */
    if (/^SELECT entry_id, entry_no FROM journal_entry WHERE entity_id = \$1 AND entry_id = ANY/.test(t.trim())) return { rows: (T.entries || []).filter((x) => x.entity_id === v[0] && v[1].indexOf(x.entry_id) >= 0).map((x) => ({ entry_id: x.entry_id, entry_no: x.entry_no })) };
    if (/^SELECT h\.chit_id, COALESCE\(h\.business_json/.test(t.trim())) return { rows: [] };
    /* F3 (year close asks the asset register): no register is migrated in the memory store — the same answer Postgres gives before b280 (42P01), which books-assets.exists reads as "no assets" */
    if (/FROM fixed_asset WHERE entity_id = \$1 LIMIT 1/.test(t)) throw Object.assign(new Error('relation "fixed_asset" does not exist'), { code: '42P01' });
    { const off = require('./books-offrail-memory.cjs').answer(fakeDb.T, t, v); if (off) return off; } /* V-F-07: lib/offrail-itc's read */
    /* 1129: lib/books-evidence (the bill a ledger row came from) and lib/tax-copy (the bill's tax copy) read chit_header; no chit is held in memory */
    if (/^SELECT chit_id, sent_at, business_json->'invoice' AS invoice FROM chit_header/.test(t.trim()) || /^SELECT h.chit_id, h.sender_entity_id, h.all_recipients, h.business_json/.test(t.trim())) return { rows: [] };
    throw new Error('the in-memory tests ran real SQL: ' + t.slice(0, 80));
  },
};
module.exports = { create, fakeDb, ZERO, ymd };
