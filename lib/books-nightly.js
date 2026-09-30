// @stage tested
// @stage-note [BOOKS v2] The nightly check: balances recomputed from the lines, the control accounts against the parties,
// @stage-note every entry balanced, the waiting list retried, a day nobody closed posted. Mismatches NAMED, never auto-fixed.
'use strict';
/**
 * lib/books-nightly.js — THE CHECK THAT RUNS WHILE THE SHOP SLEEPS (SPEC-books-v2 §6; research §6.3, the JD Edwards /
 * ERPNext Ledger Health pattern).
 *
 * ⭐ NAMED, NEVER AUTO-FIXED: a difference is written to books_setting.last_check (GET /api/books/health, the Ledger
 *   screen's to-do) with what differs and by how much. Nothing here rewrites a balance or an entry.
 * ⭐ WHAT IT DOES POST is only what would have posted anyway: the waiting list, retried; and a walk-in day whose
 *   counter never sent its day summary (the last three days, idempotent by walkin:<counter>:<day>).
 * ⚠️ WHICH SHOPS: ops.f_books_enabled() — ids only (SECURITY DEFINER, b272), the one cross-shop read. Everything else
 *   runs as that shop, inside withEntity.
 */
const B = require('./books');
const E = require('./books-engines');
const S = require('./books-store');
const H = require('./books-hooks');

function withEntity(e, fn) { return require('../db').withEntity(e, fn); }
let log = null; function L() { if (!log) { try { log = require('./logger'); } catch (_) { log = { info() {}, warn() {} }; } } return log; }

/** check(entity) → the result stored as last_check */
async function check(entity, opt) {
  const o = opt || {};
  const today = o.today || new Date().toISOString().slice(0, 10);
  const out = { at: new Date().toISOString(), ok: true, problems: [], posted: {}, engines: E.status() };
  const s = await withEntity(entity, (h) => B.settingOf(h, entity));
  if (!s || !s.enabled) return { at: out.at, ok: true, off: true };

  /* 1 · the waiting list */
  try { out.posted.retried = await H.retryOutbox(entity, 100); } catch (e) { out.problems.push({ what: 'retry', why: String(e && e.message) }); }

  /* 2 · walk-in days nobody closed (yesterday and the two before) */
  const days = [1, 2, 3].map((k) => B.addDays(today, -k));
  out.posted.days = [];
  for (const d of days) {
    try {
      const b = H.dayBounds(d, s.country);
      const counters = await withEntity(entity, (h) => S.countersBilling(h, entity, b.from, b.to));
      for (const c of counters) { const r = await H.postDay(entity, c, d, { setting: s }); if (r && r.entry_no && !r.duplicate) out.posted.days.push(c + ' ' + d + ' → ' + r.entry_no); if (r && r.queued) out.problems.push({ what: 'walk-in day', counter: c, day: d, why: r.why }); }
    } catch (e) { out.problems.push({ what: 'walk-in day', day: d, why: String(e && e.message) }); }
  }

  /* 3 · the ledger's own arithmetic */
  await withEntity(entity, async (h) => {
    const unbalanced = await S.unbalancedEntries(h, entity);
    unbalanced.forEach((u) => out.problems.push({ what: 'entry does not balance', entry_no: u.entry_no, dr_minor: u.dr, cr_minor: u.cr }));
    const drift = await S.balanceDrift(h, entity);
    drift.forEach((d) => out.problems.push({ what: 'monthly balance differs from its lines', account_id: d.account_id, party_id: d.party_id,
      fiscal_year: d.fiscal_year, period: d.period, lines_dr_minor: d.lines_dr, lines_cr_minor: d.lines_cr, kept_dr_minor: d.kept_dr, kept_cr_minor: d.kept_cr }));
    /* the control accounts: debtors = Σ customers' open items; creditors = Σ suppliers' (SAP reconciliation account) */
    const chart = await S.accounts(h, entity);
    const rows = [];
    for (const role of ['debtors', 'creditors']) {
      const a = chart.find((x) => x.role === role); if (!a) continue;
      const net = await S.accountNet(h, entity, a.account_id);
      const control = role === 'debtors' ? net : -net;
      const parties = (await S.itemTotals(h, entity, a.account_id)).reduce((t, p) => t + p.total_minor, 0);
      rows.push({ role, code: a.code, control_minor: control, parties_minor: parties });
    }
    /* the journal's control accounts against the PARTY ITEMS (the bill-wise record) — two independent records of one thing */
    out.items_vs_control = rows.map((r) => Object.assign({ ok: r.control_minor === r.parties_minor }, r));
    out.items_vs_control.filter((c) => !c.ok).forEach((c) => out.problems.push({ what: c.role + ' control ≠ the open items', control_minor: c.control_minor, items_minor: c.parties_minor }));
    /* CBLedger.controls: control = Σ party balances (both grains of the month rows), no party missing, every day and entry balanced, TB balanced */
    try {
      const lc = await B.controls(h, entity, today);
      out.controls = { ok: lc.ok, checked: lc.checked };
      (lc.mismatches || []).forEach((m) => out.problems.push(Object.assign({ what: m.name }, m)));
    } catch (e) { out.problems.push({ what: 'controls could not run', why: String(e && e.message).slice(0, 200) }); }
    /* every party has its number (a party added since yesterday) */
    try { const n = await require('../db').trySavepoint(h, () => require('./party-fields').numberAll(h, entity), 0); if (n) out.posted.parties_numbered = n; } catch (_) {}
    const w = await S.waiting(h, entity, 20);
    out.waiting = w.map((x) => ({ id: x.id, chit_id: x.source_chit_id, ref: x.source_ref, why: x.why, tries: x.tries, since: x.created_at }));
    if (w.length) out.problems.push({ what: 'waiting to post', count: w.length });
  });
  out.ok = out.problems.length === 0;
  await withEntity(entity, (h) => S.saveCheck(h, entity, out));
  if (!out.ok) L().warn('books.check', { entity_id: entity, problems: out.problems.length });
  return out;
}

/** every shop with books on — ids only, through the ops function */
async function runAll() {
  let ids = [];
  try { const { query } = require('../db'); ids = (await query('SELECT entity_id FROM ops.f_books_enabled()')).rows.map((r) => r.entity_id); }
  catch (e) { if (!runAll.said) { runAll.said = true; L().info('books.nightly', { skipped: String(e && e.message).slice(0, 160) }); } return { shops: 0 }; }
  let bad = 0;
  for (const id of ids) { try { const r = await check(id); if (r && r.ok === false) bad++; } catch (e) { bad++; L().warn('books.nightly-failed', { entity_id: id, error: String(e && e.message) }); } }
  return { shops: ids.length, with_problems: bad };
}

let timer = null;
/** in-process, every 6 hours (first run 10 minutes after start); BOOKS_NIGHTLY=0 turns it off */
function start() {
  if (timer || process.env.BOOKS_NIGHTLY === '0' || process.env.NODE_ENV === 'test') return false;
  const kick = () => { runAll().catch(() => {}); };
  setTimeout(kick, 10 * 60000).unref();
  timer = setInterval(kick, 6 * 3600000); timer.unref();
  return true;
}

module.exports = { check, runAll, start };
