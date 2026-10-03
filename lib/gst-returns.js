/* ADOPTED from chitbridge-engines v1.20.0 · gst-returns · sha256 3390556dca61965ed41f0431d409521c08509c74e5c2447aa936d42db4ae509e — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · gst-returns. Edited ONLY in chitbridge-engines/src/gst-returns.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note GSTR-1 and GSTR-3B read from the frozen invoices; reconcile to the Ledger; s.50 interest. Pure — no I/O, no clock.
/**
 * gst-returns.js — A MONTH'S GSTR-1 AND GSTR-3B, READ FROM THE FROZEN INVOICES. v1.17.0.
 *
 * The year journey (docs/year-book/2026-27.md §9, gap 5): "GST set-off and payment are posted from the Ledger balances;
 * nothing reconciles them to a return." Standing rule: a bill's tax is computed ONCE, at billing (tax.determine); everyone
 * else READS it. So nothing here computes a tax. Every figure comes out of `tax.moneyOf(invoice)` — the slot the invoice was
 * frozen into — and this file only SORTS and ADDS those figures into the sections of the two returns:
 *   gstr1()  B2B · B2CL · B2CS · CDNR / CDNUR · HSN summary · nil / exempt / non-GST · documents issued
 *   gstr3b() 3.1 outward · 3.2 inter-state to unregistered by POS · 4 ITC (available, reversed, net, ineligible) · 5 exempt inward
 *            · 6.1 payment — set off by posting.gstSetOff (the s.49 / 49A order; it is CALLED, never a second order here)
 *   series() a run of months, the unused ITC carried from one to the next
 *   reconcile() the return against the Ledger's output / input / paid, every difference NAMED, never forced to zero
 *   interestFor() / dueDate() s.50 interest on late payment of the net cash liability, a pure function
 *
 * ── THE INPUT: `documents` ─────────────────────────────────────────────────────────────────────────────────────────
 *   { kind, ref, date, inv, period?, party?, cancelled?, … }
 *   kind     'invoice' | 'credit_note' | 'debit_note'          — outward (issued BY the shop)
 *            'purchase' | 'purchase_return'                    — inward (a purchase_return is the debit note sent back)
 *   date     the document date, YYYY-MM-DD
 *   inv      the FROZEN invoice (tax.determine's output) — nothing else is read for money
 *   period   'YYYY-MM' the return it falls in. Default: the date's month. An inward document takes the month the books took
 *            it (ITC is claimed when booked / in GSTR-2B), which can be later than its date — the caller says so.
 *   cancelled  true → listed under documents issued, in no figure
 *   outward only:  nil_kind 'nil' (default) | 'exempt' | 'non_gst' for the rate-0 part · zero_rated (export / SEZ → 3.1(b)) ·
 *                  against_value (a note's original invoice value, for the B2CL / CDNUR test) · against (the original ref)
 *   inward only:   blocked [{ line: <index> | 'all', reason }] — s.17(5) credit, excluded from ITC with its reason ·
 *                  rcm true (reverse charge → 3.1(d) and 4A(3)) · non_gst (the rate-0 part is non-GST, for table 5)
 *
 * ── CITATIONS (checked, and to be re-checked at filing — a threshold is law, not code) ─────────────────────────────
 *   GSTR-1 JSON: the field names of the GSTN offline tool (gstin · fp · b2b/ctin/inv/inum/idt/val/pos/rchrg/inv_typ/itms/
 *     itm_det{rt,txval,iamt,camt,samt,csamt} · b2cl · b2cs · cdnr · cdnur · nil · hsn.data · doc_issue.doc_det). The file
 *     version label is the portal's to say; the caller passes `schema_version` and it is written to the JSON untouched.
 *   B2CL: Table 5 of GSTR-1 — an inter-state B2C invoice above the limit is shown invoice by invoice. The limit was ₹2,50,000;
 *     Notification No. 12/2024–Central Tax (10 Jul 2024) lowered it to ₹1,00,000 for tax periods from August 2024. Both
 *     are data (B2CL_LIMITS) and chosen by the invoice's period, so an old month still files on its own limit.
 *   ITC: CGST Act s.16 (eligibility), s.17(5) (blocked credit), s.17(1)-(2) with CGST Rules 42-43 (exempt / personal use
 *     apportionment — passed in as `itc_reversals`, not recomputed), Rule 38. Set-off: s.49 / 49A / 49(5) via posting.gstSetOff.
 *   Interest: s.50(1) — 18% p.a. (notified under s.50(1), Rule 88B) on the NET CASH liability, from the day after the due date
 *     (the 20th of the next month for a monthly GSTR-3B) to the day of payment, 365-day year.
 *   LEFT OUT, on purpose: the late fee (s.47: ₹50 / ₹20 a day, capped by turnover bands that change by notification), interest
 *     on ITC wrongly availed (s.50(3), 24%), exports and SEZ tables (6 / 6A), amendments (9 / 9A), ISD, composition and UIN
 *     rows of 3.2, e-commerce operators. A zero-rated document lands in 3.1(b) only, with a warning that Table 6 is not built.
 *
 * ── MONEY ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Every sum is taken in PAISE (integers) and handed back in rupees at 2dp, so no total drifts by a paisa. Per-rate rows use
 * `moneyOf(inv).by_rate` — the same slot the posting event takes — which is why the return and the Ledger cannot disagree
 * about one frozen invoice. Cess is read per line from `moneyOf(inv).lines` (by_rate carries none).
 */

var T_ = null, P_ = null, M_ = null;
function dep_(file, g) {
  var G = (typeof globalThis !== 'undefined' ? globalThis : root);
  if (G[g] && typeof G[g] === 'object' && Object.keys(G[g]).length) return G[g];
  if (typeof require === 'function') { try { return require(file); } catch (_) { return null; } }
  return null;
}
function tax_() { return T_ || (T_ = dep_('./tax', 'CBTax')); }
function posting_() { return P_ || (P_ = dep_('./posting', 'CBPosting')); }
function money_() { return M_ || (M_ = dep_('./money', 'CBMoney')); }
function refuse_(why) { return { ok: false, why: why }; }

var HEADS = ['igst', 'cgst', 'sgst'];
var HEADS4 = ['igst', 'cgst', 'sgst', 'cess'];

/** the B2CL limit by the month it applies from — data with its citation; the latest `from` not after the period wins */
var B2CL_LIMITS = [
  { from: '2017-07', limit: 250000, cite: 'GSTR-1 Table 5, ₹2.5 lakh' },
  { from: '2024-08', limit: 100000, cite: 'Notification 12/2024-Central Tax, 10 Jul 2024: ₹1 lakh from the August 2024 period' },
];
/** s.17(5) blocked-credit reasons the engine knows by name. Any other reason text is still excluded (never defaulted to eligible). */
var BLOCKED_REASONS = {
  motor_vehicle: 'CGST Act s.17(5)(a)/(aa): motor vehicles, vessels and aircraft not used for the permitted purposes',
  food_beverage: 'CGST Act s.17(5)(b)(i): food and beverages, outdoor catering, beauty treatment, health services, cosmetic and plastic surgery',
  club_fitness: 'CGST Act s.17(5)(b)(ii): membership of a club, health and fitness centre',
  employee_travel: 'CGST Act s.17(5)(b)(iii): travel benefits to employees on vacation',
  works_contract: 'CGST Act s.17(5)(c): works contract for immovable property (other than plant and machinery)',
  own_construction: 'CGST Act s.17(5)(d): goods or services for construction of immovable property on own account',
  composition: 'CGST Act s.17(5)(e): tax paid under the composition scheme',
  non_resident: 'CGST Act s.17(5)(f): non-resident taxable person (other than imports)',
  personal_use: 'CGST Act s.17(5)(g): goods or services for personal consumption',
  lost_gifted: 'CGST Act s.17(5)(h): goods lost, stolen, destroyed, written off or disposed of by gift or free samples',
  fraud_penalty: 'CGST Act s.17(5)(i): tax paid under s.74, 129 or 130',
};
var RATE_INTEREST = 18;   /* % p.a., s.50(1) */

/* ── small arithmetic, in paise ────────────────────────────────────────────────────────────────────────────────── */
function p_(x) { var n = Number(x); return isFinite(n) ? Math.round(Number((n * 100).toPrecision(15))) : 0; }
function r_(p) { return p / 100; }
function zero_() { return { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }; }
function add_(a, b, k) { k = k || 1; ['txval', 'igst', 'cgst', 'sgst', 'cess'].forEach(function (f) { a[f] += k * (b[f] || 0); }); return a; }
function rupees_(a) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = r_(a[k]); }); return o; }
function ym_(d) { return String(d || '').slice(0, 7); }
function ddmmyyyy_(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(d || ''); }
function fp_(month) { return month.slice(5, 7) + month.slice(0, 4); }
function periodOf_(d) { return d.period || ym_(d.date); }
function day_(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); if (!m) return null; var t = Date.UTC(+m[1], +m[2] - 1, +m[3]); return new Date(t).getUTCMonth() === +m[2] - 1 ? Math.round(t / 86400000) : null; }
function limitFor_(month) { var l = B2CL_LIMITS[0]; B2CL_LIMITS.forEach(function (x) { if (x.from <= month) l = x; }); return l; }

/* ── reading one document ──────────────────────────────────────────────────────────────────────────────────────── */
var OUTWARD = { invoice: 1, credit_note: -1, debit_note: 1 };
var INWARD = { purchase: 1, purchase_return: -1 };

/**
 * what one document says, in paise — read from tax.moneyOf, never recomputed.
 * rows: per rate { txval, igst, cgst, sgst, cess }; lines: per ItemList line { hsn, uqc, qty, rate, … }
 */
function read_(d) {
  var T = tax_(); if (!T || !T.moneyOf) throw new Error('gst-returns needs the tax engine (moneyOf).');
  var inv = d.inv, m = T.moneyOf(inv, 'INR'), items = (inv && inv.ItemList) || [];
  var cessBy = {}, lines = [];
  m.lines.forEach(function (l, i) {
    var it = items[i] || {}, rate = Number(it.GstRt) || 0;
    cessBy[rate] = (cessBy[rate] || 0) + p_(l.cess);
    lines.push({ hsn: String(it.HsnCd || ''), uqc: String(it.Unit || '') || 'OTH', qty: Number(it.Qty) || 0, rate: rate, desc: String(it.PrdDesc || ''),
      txval: p_(l.taxable), igst: p_(l.igst), cgst: p_(l.cgst), sgst: p_(l.sgst), cess: p_(l.cess), total: p_(l.total) });
  });
  var rows = {};
  Object.keys(m.by_rate).forEach(function (k) {
    var b = m.by_rate[k], rate = Number(k);
    rows[rate] = { txval: p_(b.taxable), igst: p_(b.igst), cgst: p_(b.cgst), sgst: p_(b.sgst), cess: cessBy[rate] || 0 };
  });
  Object.keys(cessBy).forEach(function (k) { if (!rows[k] && cessBy[k]) rows[k] = { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: cessBy[k] }; });
  /* v1.20.0: lines under reverse charge carry their tax in the invoice's RCM heads (moneyOf(inv).rcm.lines), never in igst / cgst / sgst */
  var rcmLines = ((m.rcm && m.rcm.lines) || []).map(function (l) { return { line: l.line, category: l.category, itc: !!l.itc, txval: p_(l.taxable), igst: p_(l.igst), cgst: p_(l.cgst), sgst: p_(l.sgst), cess: 0 }; });
  var buyer = (inv && inv.BuyerDtls) || {}, seller = (inv && inv.SellerDtls) || {};
  return { m: m, rows: rows, lines: lines, rcmLines: rcmLines, total: p_(m.total), supply: m.supply, pos: m.pos_state || buyer.Pos || buyer.State || '',
           gstin: buyer.Gstin ? String(buyer.Gstin) : '', sellerGstin: seller.Gstin ? String(seller.Gstin) : '', rcm: !!(inv && inv._cb && inv._cb.reverse_charge) };
}
/** the document, validated and read; or a refusal naming it */
function prep_(documents, wanted) {
  var out = [];
  for (var i = 0; i < (documents || []).length; i++) {
    var d = documents[i] || {}, name = 'document ' + (d.ref || (i + 1));
    if (!(d.kind in OUTWARD) && !(d.kind in INWARD)) return refuse_(name + ' has kind "' + d.kind + '" — invoice, credit_note, debit_note, purchase or purchase_return.');
    if (day_(d.date) === null) return refuse_(name + ' needs its date as YYYY-MM-DD.');
    if (!d.ref) return refuse_(name + ' needs its ref (the number it was issued under).');
    if (!d.inv && !d.cancelled) return refuse_(name + ' has no frozen invoice (inv) — a return reads the invoice, it never recomputes one.');
    out.push({ d: d, r: d.inv && !d.cancelled ? read_(d) : null });
  }
  return { ok: true, docs: out };
}
function ctx_(opts) {
  var o = opts || {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(o.month || ''))) return refuse_('A return is for a month, "YYYY-MM".');
  if (!/^\d{2}[0-9A-Z]{13}$/.test(String(o.gstin || ''))) return refuse_('A return needs the shop GSTIN (15 characters).');
  var r = prep_(o.documents); if (!r.ok) return r;
  return { ok: true, month: o.month, gstin: o.gstin, state: String(o.gstin).slice(0, 2), docs: r.docs };
}

/* ── GSTR-1 ────────────────────────────────────────────────────────────────────────────────────────────────────── */
function itms_(rowsByRate, sign) {
  var out = [], n = 0;
  Object.keys(rowsByRate).map(Number).sort(function (a, b) { return a - b; }).forEach(function (rate) {
    var b = rowsByRate[rate]; if (!rate) return;
    n++; out.push({ num: n, itm_det: { rt: rate, txval: r_(b.txval), iamt: r_(b.igst), camt: r_(b.cgst), samt: r_(b.sgst), csamt: r_(b.cess) } });
  });
  return out;
}
function seriesOf_(ref) { var m = /^([\s\S]*?)(\d+)$/.exec(String(ref)); return m ? { prefix: m[1], n: parseInt(m[2], 10), width: m[2].length } : null; }

/**
 * ⭐ gstr1({ gstin, month: 'YYYY-MM', documents, schema_version?, b2cl_limit? }) → { ok, gstin, month, json, tables, warnings, summary }
 * `json` is shaped like the GSTN offline tool's GSTR-1 file; `tables` is the same figures as simple rows (gstr1Table). Outward
 * documents of the month only (kind invoice / credit_note / debit_note); inward ones are ignored here.
 */
function gstr1(opts) {
  var c = ctx_(opts); if (!c.ok) return c;
  var o = opts, warnings = [], limit = o.b2cl_limit != null ? Number(o.b2cl_limit) : limitFor_(c.month).limit;
  var b2b = {}, b2cl = {}, b2cs = {}, cdnr = {}, cdnur = [], hsn = {}, nil = {}, issued = {};
  var summary = { invoices: 0, notes: 0, taxable: 0, tax: 0 };
  var missingHsn = 0, zeroRated = 0;
  c.docs.forEach(function (x) {
    var d = x.d; if (!(d.kind in OUTWARD)) return;
    if (periodOf_(d) !== c.month) return;
    /* documents issued counts the cancelled ones too */
    var nature = d.kind === 'invoice' ? 'Invoices for outward supply' : d.kind === 'credit_note' ? 'Credit Note' : 'Debit Note';
    var sr = seriesOf_(d.ref);
    if (sr) { var key = nature + '|' + sr.prefix; (issued[key] = issued[key] || { nature: nature, prefix: sr.prefix, docs: [] }).docs.push({ n: sr.n, ref: d.ref, cancelled: !!d.cancelled }); }
    else warnings.push('documents issued: "' + d.ref + '" does not end in a number, so it is in no series');
    if (d.cancelled) return;
    var r = x.r, sign = OUTWARD[d.kind], isNote = d.kind !== 'invoice', registered = !!r.gstin, inter = r.supply === 'inter';
    if (r.supply !== 'intra' && r.supply !== 'inter') { warnings.push(d.ref + ': the invoice carries no supply type (' + r.supply + ') — left out'); return; }
    if (d.zero_rated) { zeroRated++; return; }
    if (isNote) summary.notes++; else summary.invoices++;
    Object.keys(r.rows).forEach(function (k) { summary.taxable += sign * r.rows[k].txval; summary.tax += sign * (r.rows[k].igst + r.rows[k].cgst + r.rows[k].sgst + r.rows[k].cess); });
    /* the nil / exempt / non-GST part, by the four GSTN buckets */
    var z = r.rows[0];
    if (z && z.txval) {
      var bucket = (inter ? 'INTR' : 'INTRA') + (registered ? 'B2B' : 'B2C'), kind = d.nil_kind === 'exempt' ? 'expt' : d.nil_kind === 'non_gst' ? 'ngsup' : 'nil';
      var nb = nil[bucket] = nil[bucket] || { sply_ty: bucket, expt_amt: 0, nil_amt: 0, ngsup_amt: 0 };
      nb[kind + '_amt'] += sign * z.txval;
    }
    /* HSN summary — notes net it off */
    r.lines.forEach(function (l) {
      if (!l.hsn) missingHsn++;
      var key = l.hsn + '|' + l.uqc + '|' + l.rate, h = hsn[key] = hsn[key] || { hsn_sc: l.hsn, desc: l.desc, uqc: l.uqc, rt: l.rate, qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
      h.qty += sign * l.qty; h.val += sign * l.total; h.txval += sign * l.txval; h.iamt += sign * l.igst; h.camt += sign * l.cgst; h.samt += sign * l.sgst; h.csamt += sign * l.cess;
    });
    var taxedRows = {}; Object.keys(r.rows).forEach(function (k) { if (Number(k)) taxedRows[k] = r.rows[k]; });
    if (!Object.keys(taxedRows).length) return;          /* wholly nil / exempt: table 8 only */
    var itms = itms_(taxedRows);
    var base = { val: r_(r.total), pos: r.pos, itms: itms };
    if (!isNote) {
      var inv = { inum: d.ref, idt: ddmmyyyy_(d.date), val: base.val, pos: r.pos, rchrg: 'N', inv_typ: 'R', itms: itms };
      if (registered) (b2b[r.gstin] = b2b[r.gstin] || []).push(inv);
      else if (inter && r.total > p_(limit)) (b2cl[r.pos] = b2cl[r.pos] || []).push({ inum: d.ref, idt: ddmmyyyy_(d.date), val: base.val, itms: itms });
      else addB2cs_(b2cs, inter, r.pos, taxedRows, 1);
    } else {
      var nt = { ntty: d.kind === 'credit_note' ? 'C' : 'D', nt_num: d.ref, nt_dt: ddmmyyyy_(d.date), val: base.val, pos: r.pos, rchrg: 'N', inv_typ: 'R', itms: itms };
      if (registered) (cdnr[r.gstin] = cdnr[r.gstin] || []).push(nt);
      else if (inter && p_(d.against_value != null ? d.against_value : r.m.total) > p_(limit)) cdnur.push({ typ: 'B2CL', ntty: nt.ntty, nt_num: nt.nt_num, nt_dt: nt.nt_dt, val: nt.val, pos: r.pos, itms: itms });
      else addB2cs_(b2cs, inter, r.pos, taxedRows, sign);   /* a small B2C note nets off the B2CS it came out of */
    }
  });
  if (zeroRated) warnings.push(zeroRated + ' zero-rated (export / SEZ) document(s) left out of GSTR-1: Table 6 is not built here');
  if (missingHsn) warnings.push(missingHsn + ' line(s) carry no HSN — shown under an empty HSN in the summary');
  var json = { gstin: c.gstin, fp: fp_(c.month) };
  if (o.schema_version) json.version = o.schema_version;
  json.b2b = Object.keys(b2b).sort().map(function (ctin) { return { ctin: ctin, inv: b2b[ctin] }; });
  json.b2cl = Object.keys(b2cl).sort().map(function (pos) { return { pos: pos, inv: b2cl[pos] }; });
  json.b2cs = Object.keys(b2cs).sort().map(function (k) {
    var a = b2cs[k]; return { sply_ty: a.inter ? 'INTER' : 'INTRA', rt: a.rt, typ: 'OE', pos: a.pos, txval: r_(a.v.txval), iamt: r_(a.v.igst), camt: r_(a.v.cgst), samt: r_(a.v.sgst), csamt: r_(a.v.cess) };
  });
  json.cdnr = Object.keys(cdnr).sort().map(function (ctin) { return { ctin: ctin, nt: cdnr[ctin] }; });
  json.cdnur = cdnur;
  json.nil = { inv: Object.keys(nil).sort().map(function (k) { var n = nil[k]; return { sply_ty: n.sply_ty, expt_amt: r_(n.expt_amt), nil_amt: r_(n.nil_amt), ngsup_amt: r_(n.ngsup_amt) }; }) };
  json.hsn = { data: Object.keys(hsn).sort().map(function (k, i) { var h = hsn[k]; return { num: i + 1, hsn_sc: h.hsn_sc, desc: h.desc, uqc: h.uqc, qty: h.qty, val: r_(h.val), txval: r_(h.txval), rt: h.rt, iamt: r_(h.iamt), camt: r_(h.camt), samt: r_(h.samt), csamt: r_(h.csamt) }; }) };
  var docDet = [], num = 0;
  ['Invoices for outward supply', 'Debit Note', 'Credit Note'].forEach(function (nature) {
    var docs = [];
    Object.keys(issued).sort().forEach(function (k) {
      var s = issued[k]; if (s.nature !== nature) return;
      var ns = s.docs.map(function (x) { return x.n; }), lo = Math.min.apply(null, ns), hi = Math.max.apply(null, ns), seen = {}; ns.forEach(function (n) { seen[n] = 1; });
      var w = (seriesOf_(s.docs[0].ref) || {}).width, ref = function (n) { return s.prefix + String(n).padStart(w, '0'); };
      var cancel = s.docs.filter(function (x) { return x.cancelled; }).length, missing = [];
      for (var n = lo; n <= hi && missing.length < 50; n++) if (!seen[n]) missing.push(ref(n));
      docs.push({ num: docs.length + 1, from: ref(lo), to: ref(hi), totnum: hi - lo + 1, cancel: cancel, net_issue: hi - lo + 1 - cancel, unaccounted: missing });
      if (missing.length) warnings.push('documents issued: ' + missing.length + (missing.length === 50 ? '+' : '') + ' number(s) in ' + ref(lo) + '…' + ref(hi) + ' were not supplied (' + missing.slice(0, 3).join(', ') + (missing.length > 3 ? ', …' : '') + ') — counted as issued, neither cancelled nor listed');
    });
    if (docs.length) docDet.push({ doc_num: ++num, doc_typ: nature, docs: docs });
  });
  json.doc_issue = { doc_det: docDet };
  var sum = { invoices: summary.invoices, notes: summary.notes, taxable: r_(summary.taxable), tax: r_(summary.tax) };
  var res = { ok: true, gstin: c.gstin, month: c.month, b2cl_limit: limit, json: json, warnings: warnings, summary: sum };
  res.tables = gstr1Table(res);
  return res;
}
function addB2cs_(b2cs, inter, pos, rows, sign) {
  Object.keys(rows).forEach(function (k) {
    var key = (inter ? 'INTER' : 'INTRA') + '|' + pos + '|' + String(Number(k) + 1000).slice(1), a = b2cs[key] = b2cs[key] || { inter: inter, pos: pos, rt: Number(k), v: zero_() };
    add_(a.v, rows[k], sign);
  });
}

/** the GSTR-1 as simple tables: [{ id, title, header: [...], rows: [[...]] }] — what a screen paints and a CSV writes */
function gstr1Table(r) {
  var j = r.json, t = [];
  var tx = function (a) { return [a.rt, a.txval, a.iamt, a.camt, a.samt, a.csamt]; }, H = ['Rate %', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess'];
  var b = []; j.b2b.forEach(function (g) { g.inv.forEach(function (i) { i.itms.forEach(function (it) { b.push([g.ctin, i.inum, i.idt, i.val, i.pos].concat(tx(it.itm_det))); }); }); });
  t.push({ id: 'b2b', title: '4 · B2B invoices', header: ['GSTIN', 'Invoice', 'Date', 'Value', 'POS'].concat(H), rows: b });
  var l = []; j.b2cl.forEach(function (g) { g.inv.forEach(function (i) { i.itms.forEach(function (it) { l.push([g.pos, i.inum, i.idt, i.val].concat(tx(it.itm_det))); }); }); });
  t.push({ id: 'b2cl', title: '5 · B2C large (inter-state, over ' + r.b2cl_limit + ')', header: ['POS', 'Invoice', 'Date', 'Value'].concat(H), rows: l });
  t.push({ id: 'b2cs', title: '7 · B2C small, by place of supply and rate', header: ['Supply', 'POS'].concat(H), rows: j.b2cs.map(function (a) { return [a.sply_ty, a.pos].concat(tx({ rt: a.rt, txval: a.txval, iamt: a.iamt, camt: a.camt, samt: a.samt, csamt: a.csamt })); }) });
  var n = []; j.cdnr.forEach(function (g) { g.nt.forEach(function (i) { i.itms.forEach(function (it) { n.push([g.ctin, i.ntty, i.nt_num, i.nt_dt, i.val, i.pos].concat(tx(it.itm_det))); }); }); });
  j.cdnur.forEach(function (i) { i.itms.forEach(function (it) { n.push(['(unregistered)', i.ntty, i.nt_num, i.nt_dt, i.val, i.pos].concat(tx(it.itm_det))); }); });
  t.push({ id: 'cdn', title: '9B · Credit / debit notes (CDNR, CDNUR)', header: ['GSTIN', 'C/D', 'Note', 'Date', 'Value', 'POS'].concat(H), rows: n });
  t.push({ id: 'nil', title: '8 · Nil-rated, exempt and non-GST', header: ['Supply', 'Exempt', 'Nil rated', 'Non-GST'], rows: j.nil.inv.map(function (x) { return [x.sply_ty, x.expt_amt, x.nil_amt, x.ngsup_amt]; }) });
  t.push({ id: 'hsn', title: '12 · HSN summary', header: ['HSN', 'UQC', 'Qty', 'Value', 'Taxable', 'Rate %', 'IGST', 'CGST', 'SGST', 'Cess'], rows: j.hsn.data.map(function (h) { return [h.hsn_sc, h.uqc, h.qty, h.val, h.txval, h.rt, h.iamt, h.camt, h.samt, h.csamt]; }) });
  var d = []; j.doc_issue.doc_det.forEach(function (g) { g.docs.forEach(function (s) { d.push([g.doc_typ, s.from, s.to, s.totnum, s.cancel, s.net_issue]); }); });
  t.push({ id: 'docs', title: '13 · Documents issued', header: ['Nature', 'From', 'To', 'Total', 'Cancelled', 'Net issued'], rows: d });
  return t;
}

/* ── GSTR-3B ───────────────────────────────────────────────────────────────────────────────────────────────────── */
function heads_(src, f) { var o = {}; HEADS4.forEach(function (h) { o[h] = f ? f(src[h] || 0) : (src[h] || 0); }); return o; }
function line_(a) { return { txval: r_(a.txval), igst: r_(a.igst), cgst: r_(a.cgst), sgst: r_(a.sgst), cess: r_(a.cess) }; }

/**
 * ⭐ gstr3b({ gstin, month, documents, opening_itc?, itc_reversals?, ref? }) → { ok, s3_1, s3_2, s4, s5, s6_1, warnings, tables }
 *   opening_itc    { igst, cgst, sgst, cess } the unused ITC brought in (the electronic credit ledger's opening), rupees
 *   itc_reversals  [{ reason, rule: '38'|'42'|'43'|'17(5)'|'other', igst, cgst, sgst, cess }] — reversals worked elsewhere, as DATA
 * 6.1 sets the month's ITC off against its tax by posting.gstSetOff — the statutory order — and what is left is cash.
 * Reverse-charge tax (3.1(d)) is cash only; its ITC (4A(3)) is available the same month.
 */
function gstr3b(opts) {
  var c = ctx_(opts); if (!c.ok) return c;
  var o = opts, warnings = [], P = posting_();
  if (!P || !P.gstSetOff) return refuse_('gst-returns needs the posting engine (gstSetOff) for the s.49 order.');
  var a = zero_(), b = zero_(), cx = zero_(), d = zero_(), e = zero_(), unreg = {};
  var itcA5 = zero_(), itcA3 = zero_(), rev2 = zero_(), rev1 = zero_(), inelig = zero_(), blockedList = [];
  var in5 = { intra_exempt: 0, intra_nongst: 0, inter_exempt: 0, inter_nongst: 0 };
  c.docs.forEach(function (x) {
    var dd = x.d; if (periodOf_(dd) !== c.month || dd.cancelled) return;
    var r = x.r;
    if (r.supply !== 'intra' && r.supply !== 'inter') { warnings.push(dd.ref + ': no supply type (' + r.supply + ') — left out'); return; }
    if (dd.kind in OUTWARD) {
      var sign = OUTWARD[dd.kind];
      if (dd.zero_rated) { Object.keys(r.rows).forEach(function (k) { add_(b, r.rows[k], sign); }); warnings.push(dd.ref + ': zero-rated — in 3.1(b); GSTR-1 Table 6 is not built here'); return; }
      Object.keys(r.rows).forEach(function (k) {
        var row = r.rows[k];
        if (!Number(k)) { add_(dd.nil_kind === 'non_gst' ? e : cx, { txval: row.txval }, sign); return; }
        add_(a, row, sign);
        if (r.supply === 'inter' && !r.gstin) { var u = unreg[r.pos] = unreg[r.pos] || { txval: 0, igst: 0 }; u.txval += sign * row.txval; u.igst += sign * row.igst; }
      });
      return;
    }
    /* inward */
    var s = INWARD[dd.kind];
    if (dd.kind === 'purchase_return') { Object.keys(r.rows).forEach(function (k) { add_(rev2, r.rows[k], 1); }); return; }
    var z = r.rows[0]; if (z && z.txval) in5[(r.supply === 'inter' ? 'inter_' : 'intra_') + (dd.non_gst ? 'nongst' : 'exempt')] += z.txval;
    var blocked = {}; (dd.blocked || []).forEach(function (bk) { if (bk && bk.line === 'all') r.lines.forEach(function (_, i) { blocked[i] = bk.reason; }); else if (bk) blocked[bk.line] = bk.reason; });
    var rcm = !!dd.rcm || r.rcm;
    r.lines.forEach(function (l, i) {
      var t = { txval: l.txval, igst: l.igst, cgst: l.cgst, sgst: l.sgst, cess: l.cess };
      if (!l.igst && !l.cgst && !l.sgst && !l.cess) return;
      if (Object.prototype.hasOwnProperty.call(blocked, i)) {
        var why = blocked[i] || 'blocked'; add_(inelig, t, 1);
        blockedList.push({ ref: dd.ref, line: i, reason: why, section: BLOCKED_REASONS[why] || null, known: !!BLOCKED_REASONS[why], igst: r_(l.igst), cgst: r_(l.cgst), sgst: r_(l.sgst), cess: r_(l.cess) });
        if (!BLOCKED_REASONS[why]) warnings.push(dd.ref + ' line ' + (i + 1) + ': blocked for "' + why + '", a reason the engine has no section for — excluded all the same');
        return;
      }
      add_(rcm ? itcA3 : itcA5, t, 1);
      if (rcm) add_(d, t, 1);
    });
    /* v1.20.0 — reverse charge read from the frozen invoice's RCM heads: the liability is 3.1(d) always (cash only); the credit is 4(A)(3)
       only when the notification's rate option allows it and the line is not blocked (s.17(5)) */
    r.rcmLines.forEach(function (l) {
      var t = { txval: l.txval, igst: l.igst, cgst: l.cgst, sgst: l.sgst, cess: 0 };
      add_(d, t, 1);
      if (Object.prototype.hasOwnProperty.call(blocked, l.line)) {
        var why = blocked[l.line] || 'blocked'; add_(inelig, t, 1);
        blockedList.push({ ref: dd.ref, line: l.line, reason: why, section: BLOCKED_REASONS[why] || null, known: !!BLOCKED_REASONS[why], igst: r_(l.igst), cgst: r_(l.cgst), sgst: r_(l.sgst), cess: 0 });
        return;
      }
      if (l.itc) add_(itcA3, t, 1);
    });
  });
  for (var ri = 0; ri < (o.itc_reversals || []).length; ri++) if (!o.itc_reversals[ri] || !o.itc_reversals[ri].reason) return refuse_('itc_reversals[' + ri + '] needs its reason — a reversal is never anonymous.');
  (o.itc_reversals || []).forEach(function (rv) {
    var t = { txval: 0, igst: p_(rv.igst), cgst: p_(rv.cgst), sgst: p_(rv.sgst), cess: p_(rv.cess) };
    add_(['38', '42', '43', '17(5)'].indexOf(String(rv.rule)) >= 0 ? rev1 : rev2, t, 1);
  });
  var A = zero_(); add_(A, itcA5, 1); add_(A, itcA3, 1);
  var B = zero_(); add_(B, rev1, 1); add_(B, rev2, 1);
  var net = zero_(); HEADS4.forEach(function (h) { net[h] = A[h] - B[h]; });
  /* 6.1 — forward-charge tax is set off; reverse-charge tax is cash only */
  var opening = heads_(o.opening_itc || {}, p_);
  var payable = {}; HEADS4.forEach(function (h) { payable[h] = Math.max(0, a[h] + b[h]); });
  var rcmCash = heads_(d);
  var avail = {}; HEADS4.forEach(function (h) { avail[h] = Math.max(0, opening[h] + net[h]); if (opening[h] + net[h] < 0) warnings.push('4: reversals exceed the ITC available in ' + h.toUpperCase() + ' by ' + r_(-(opening[h] + net[h])) + ' — the excess is not carried as a negative credit'); });
  HEADS4.forEach(function (h) { if (a[h] + b[h] < 0) warnings.push('3.1: credit notes exceed the output tax in ' + h.toUpperCase() + ' by ' + r_(-(a[h] + b[h])) + ' — payable shown as nil, the excess is not carried'); });
  var so = P.gstSetOff({ ref: o.ref || ('GSTR3B-' + c.month), date: null, period: c.month,
    output: { cgst: r_(payable.cgst), sgst: r_(payable.sgst), igst: r_(payable.igst) }, input: { cgst: r_(avail.cgst), sgst: r_(avail.sgst), igst: r_(avail.igst) } });
  if (!so.ok) return refuse_(so.why);
  var cessUsed = Math.min(avail.cess, payable.cess), cash = {}, carried = {};
  HEADS.forEach(function (h) { cash[h] = p_(so.payable[h]) + rcmCash[h]; carried[h] = p_(so.carried[h]); });
  cash.cess = payable.cess - cessUsed + rcmCash.cess; carried.cess = avail.cess - cessUsed;
  var usedBy = {}; so.utilised.forEach(function (u) { usedBy[u.from] = usedBy[u.from] || {}; usedBy[u.from][u.against] = (usedBy[u.from][u.against] || 0) + p_(u.amount); });
  if (cessUsed) { usedBy.cess = { cess: cessUsed }; }
  var itcUsed = {}; HEADS4.forEach(function (h) { itcUsed[h] = 0; }); so.utilised.forEach(function (u) { itcUsed[u.against] += p_(u.amount); }); itcUsed.cess = cessUsed;
  var cashTotal = HEADS4.reduce(function (s, h) { return s + cash[h]; }, 0);
  var unregRows = Object.keys(unreg).sort().map(function (pos) { return { pos: pos, txval: r_(unreg[pos].txval), igst: r_(unreg[pos].igst) }; });
  var res = {
    ok: true, gstin: c.gstin, month: c.month, warnings: warnings,
    s3_1: { a: line_(a), b: line_(b), c: { txval: r_(cx.txval) }, d: line_(d), e: { txval: r_(e.txval) } },
    s3_2: { unregistered: unregRows },
    s4: { available: { reverse_charge: line_(itcA3), other: line_(itcA5), total: heads_(A, r_) }, reversed: { rules_and_17_5: heads_(rev1, r_), others: heads_(rev2, r_), total: heads_(B, r_) },
          net: heads_(net, r_), ineligible: { other: heads_(inelig, r_), blocked: blockedList } },
    s5: { intra_exempt: r_(in5.intra_exempt), intra_non_gst: r_(in5.intra_nongst), inter_exempt: r_(in5.inter_exempt), inter_non_gst: r_(in5.inter_nongst) },
    s6_1: { tax_payable: heads_({ igst: a.igst + b.igst + d.igst, cgst: a.cgst + b.cgst + d.cgst, sgst: a.sgst + b.sgst + d.sgst, cess: a.cess + b.cess + d.cess }, r_),
            itc_opening: heads_(opening, r_), itc_available: heads_(avail, r_), itc_utilised: so.utilised, itc_used_by_head: heads_(itcUsed, r_), itc_used_from: usedBy,
            cash: heads_(cash, r_), cash_total: r_(cashTotal), itc_carried: heads_(carried, r_), interest: 0, late_fee: 0 },
  };
  Object.keys(usedBy).forEach(function (f) { Object.keys(usedBy[f]).forEach(function (g) { usedBy[f][g] = r_(usedBy[f][g]); }); });
  res.tables = gstr3bTable(res);
  return res;
}

/** the GSTR-3B as simple tables */
function gstr3bTable(r) {
  var l = function (x) { return [x.txval, x.igst, x.cgst, x.sgst, x.cess]; }, H = ['Taxable', 'IGST', 'CGST', 'SGST', 'Cess'], hh = function (x) { return [x.igst, x.cgst, x.sgst, x.cess]; };
  var s = r.s3_1, f = r.s4, p = r.s6_1;
  return [
    { id: '3.1', title: '3.1 · Outward supplies and inward supplies liable to reverse charge', header: ['Nature'].concat(H), rows: [
      ['(a) Outward taxable (other than zero rated, nil rated, exempt)'].concat(l(s.a)), ['(b) Outward taxable, zero rated'].concat(l(s.b)), ['(c) Other outward (nil rated, exempt)', s.c.txval, 0, 0, 0, 0],
      ['(d) Inward liable to reverse charge'].concat(l(s.d)), ['(e) Non-GST outward', s.e.txval, 0, 0, 0, 0]] },
    { id: '3.2', title: '3.2 · Inter-state supplies to unregistered persons, by place of supply', header: ['POS', 'Taxable', 'IGST'], rows: r.s3_2.unregistered.map(function (u) { return [u.pos, u.txval, u.igst]; }) },
    { id: '4', title: '4 · Eligible ITC', header: ['Detail', 'IGST', 'CGST', 'SGST', 'Cess'], rows: [
      ['(A)(3) Reverse charge'].concat(hh(f.available.reverse_charge)), ['(A)(5) All other ITC'].concat(hh(f.available.other)), ['(B)(1) Reversed: Rules 38, 42, 43, s.17(5)'].concat(hh(f.reversed.rules_and_17_5)),
      ['(B)(2) Reversed: others (incl. purchase returns)'].concat(hh(f.reversed.others)), ['(C) Net ITC available'].concat(hh(f.net)), ['(D)(2) Ineligible (s.17(5) and others)'].concat(hh(f.ineligible.other))] },
    { id: '5', title: '5 · Exempt, nil-rated and non-GST inward supplies', header: ['Nature', 'Inter-state', 'Intra-state'], rows: [['Exempt / nil rated', r.s5.inter_exempt, r.s5.intra_exempt], ['Non-GST', r.s5.inter_non_gst, r.s5.intra_non_gst]] },
    { id: '6.1', title: '6.1 · Payment of tax', header: ['Detail', 'IGST', 'CGST', 'SGST', 'Cess'], rows: [
      ['Tax payable'].concat(hh(p.tax_payable)), ['Paid through ITC'].concat(hh(p.itc_used_by_head)), ['Paid in cash'].concat(hh(p.cash)), ['ITC carried forward'].concat(hh(p.itc_carried))] },
  ];
}

/**
 * ⭐ series({ gstin, months: ['2026-04', …], documents, opening_itc?, itc_reversals?, paid_on? }) → { ok, returns: [gstr3b…], carried }
 * Each month's unused ITC is the next month's opening. `itc_reversals` may carry a `month` to say which month it belongs to.
 * `paid_on`: { 'YYYY-MM': 'YYYY-MM-DD' } the day each month's cash was paid — when given, s.50 interest is worked into 6.1.
 */
function series(opts) {
  var o = opts || {}, out = [], carry = o.opening_itc || {}, paidOn = o.paid_on || {};
  for (var i = 0; i < (o.months || []).length; i++) {
    var m = o.months[i];
    var r = gstr3b({ gstin: o.gstin, month: m, documents: o.documents, opening_itc: carry, ref: o.ref,
      itc_reversals: (o.itc_reversals || []).filter(function (x) { return !x.month || x.month === m; }) });
    if (!r.ok) return r;
    if (paidOn[m]) { var it = interestFor({ cash_liability: r.s6_1.cash_total, due_date: dueDate(m), paid_on: paidOn[m] }); if (it.ok) { r.s6_1.interest = it.interest; r.s6_1.interest_days = it.days; } }
    out.push(r); carry = r.s6_1.itc_carried;
  }
  return { ok: true, returns: out, carried: carry };
}

/* ── reconcile ─────────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * ⭐ reconcile(gstr3b, ledger) → { ok, clean, heads, differences }
 *   ledger   { igst: { output, input, paid, setoff? }, cgst: {…}, sgst: {…} } — the Ledger's figures for the SAME month, rupees:
 *            output = tax on sales net of credit notes · input = tax on purchases net of returns · paid = the challan ·
 *            setoff = the credit used against output (optional)
 * Per head, return against Ledger for output, input, paid (and set-off when given). A difference is NAMED — which head, which
 * line, both figures, and when it equals the blocked ITC the return excluded, that is said — and never forced to zero.
 * `input` is compared to the return's eligible ITC plus what it excluded as blocked: the Ledger books a purchase's tax whole.
 */
function reconcile(ret, ledger) {
  if (!ret || !ret.ok || !ret.s6_1) return refuse_('reconcile needs a gstr3b result.');
  if (!ledger || typeof ledger !== 'object') return refuse_('reconcile needs the Ledger figures per head.');
  var diffs = [], heads = {}, blocked = ret.s4.ineligible.other, any = false;
  HEADS.forEach(function (h) {
    var L = ledger[h] || {}, H = h.toUpperCase();
    var outR = p_(ret.s6_1.tax_payable[h]), inR = p_(ret.s4.net[h]), inBlocked = p_(blocked[h]), paidR = p_(ret.s6_1.cash[h]), usedR = p_(ret.s6_1.itc_used_by_head[h]);
    var rows = {
      output: { ret: outR, led: L.output == null ? null : p_(L.output) },
      input: { ret: inR, led: L.input == null ? null : p_(L.input) },
      paid: { ret: paidR, led: L.paid == null ? null : p_(L.paid) },
      setoff: { ret: usedR, led: L.setoff == null ? null : p_(L.setoff) },
    };
    heads[h] = {};
    Object.keys(rows).forEach(function (k) {
      var x = rows[k]; if (x.led === null) { heads[h][k] = { return: r_(x.ret), ledger: null, diff: null }; return; }
      var diff = x.ret - x.led; heads[h][k] = { return: r_(x.ret), ledger: r_(x.led), diff: r_(diff) };
      if (!diff) return;
      var what = { output: 'output tax', input: 'input tax credit', paid: 'tax paid in cash', setoff: 'credit set off' }[k], hint = '';
      if (k === 'input' && inBlocked && x.led - x.ret === inBlocked) hint = ' — the Ledger holds ' + r_(inBlocked) + ' of s.17(5) blocked credit that the return does not claim';
      else if (k === 'input' && inBlocked && x.led - x.ret > 0) hint = ' — of which ' + r_(Math.min(inBlocked, x.led - x.ret)) + ' may be the blocked credit the return excludes';
      diffs.push({ head: h, line: k, return: r_(x.ret), ledger: r_(x.led), diff: r_(diff),
        name: H + ' ' + what + ' (' + ret.month + '): the return shows ' + r_(x.ret).toFixed(2) + ', the Ledger ' + r_(x.led).toFixed(2) + ', a difference of ' + r_(diff).toFixed(2) + hint });
      any = true;
    });
  });
  return { ok: true, month: ret.month, clean: !any, heads: heads, differences: diffs };
}

/* ── s.50 interest ─────────────────────────────────────────────────────────────────────────────────────────────── */
/** the due date of a month's monthly GSTR-3B: the 20th of the next month ('2026-04' → '2026-05-20'). QRMP filers' 22nd / 24th are not modelled. */
function dueDate(month) {
  var m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month || '')); if (!m) return null;
  var y = +m[1], mo = +m[2] + 1; if (mo > 12) { mo = 1; y++; }
  return y + '-' + String(mo).padStart(2, '0') + '-20';
}
/**
 * ⭐ interestFor({ cash_liability, due_date, paid_on, rate_pct? }) → { ok, days, interest, rate_pct }
 * s.50(1): interest at 18% a year on the NET CASH liability (the tax left after ITC), for the days from the due date to the day
 * paid — a payment on the due date owes none, a day after owes one day. interest = liability × rate × days / 365, rounded once.
 * The late fee (s.47) is not here. A liability paid on time, or nothing in cash, gives 0.
 */
function interestFor(o) {
  var x = o || {}, due = day_(x.due_date), paid = day_(x.paid_on), L = Number(x.cash_liability), rate = x.rate_pct == null ? RATE_INTEREST : Number(x.rate_pct);
  if (due === null || paid === null) return refuse_('Interest needs due_date and paid_on as YYYY-MM-DD.');
  if (!isFinite(L) || L < 0) return refuse_('Interest needs the net cash liability, zero or more.');
  if (!isFinite(rate) || rate < 0) return refuse_('Interest needs a rate in percent.');
  var days = Math.max(0, paid - due), M = money_();
  var raw = L * rate / 100 * days / 365;
  return { ok: true, days: days, interest: days && L ? (M && M.round ? M.round(raw) : Math.round(raw * 100) / 100) : 0, rate_pct: rate, basis: 'net cash liability, s.50(1)' };
}

var EXPORTS = { gstr1: gstr1, gstr1Table: gstr1Table, gstr3b: gstr3b, gstr3bTable: gstr3bTable, series: series, reconcile: reconcile, dueDate: dueDate, interestFor: interestFor,
                B2CL_LIMITS: B2CL_LIMITS, BLOCKED_REASONS: BLOCKED_REASONS, RATE_INTEREST: RATE_INTEREST };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBGstReturns. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBGstReturns = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
