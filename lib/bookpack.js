/* ADOPTED from chitbridge-engines v1.20.0 · bookpack · sha256 1021a12646ad9a3ce224f90ae2ca0c7e96ae346640e7e77b1694cbe32956ae58 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · bookpack. Edited ONLY in chitbridge-engines/src/bookpack.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS v2] The handover pack from given rows: SAF-T-shaped JSON, Tally XML, CSVs (trial balance, ledgers,
// @stage-note ageing, day book), a code book and a manifest with control totals, chained to the previous pack. No crypto:
// @stage-note the caller hands in a hash function (or hashes the returned files itself). No clock: created_at is passed.
/**
 * bookpack.js — THE PACK HANDED TO THE SHOP (v1.8.0, 2026-09-29; hardened v1.8.1, 2026-09-30). [SPEC-books-v2.md §6; RESEARCH-ledger-offload §5]
 *
 * Athi, 2026-09-29: *"how this data can be offloaded on a regular basis and handover to the entity."* ⭐ So every month
 * (and every year, and on exit) the shop gets its own records in forms any other system reads: a SAF-T-shaped JSON (the
 * OECD structure: master files + general ledger entries), Tally XML (ledgers under their Tally group, vouchers with
 * bill-wise references), plain CSVs, and a code book saying what every code means. ⚠️ The manifest's control totals are
 * the proof: counts, Σ debits = Σ credits, and opening + movement = closing for every account and party.
 * ⚠️ Screens say "Ledger pack", never "books of account", until Athi says so.
 *
 * ── INPUT ──  build(input, { hash? })
 *   input { kind: month|year|exit, entity: { id, name, tax_id?, country? }, fiscal_year, period? (month packs),
 *           from?, to? (override), created_at (ISO — passed, never read), software?: { name, version },
 *           accounts? (shop ledgers), parties[{ party_id, party_no, name, side: customer|supplier, legal_name?,
 *           tax_ids?[{ scheme, value }], state_code? }], lines (the range's journal lines, CBLedger.linesOf shape),
 *           balances? (period rows — the opening, and the independent closing), items? (party items: bill-wise, ageing),
 *           prev_sha256? }
 *   hash: (text) → hex sha256. Absent → every sha256 is null and manifest.unhashed = true (hash the files, then seal()).
 * ── OUTPUT ── { files: [{ name, content, rows }], manifest }
 *   ⚠️ items / lines: hand in what is dated ON OR BEFORE `to` — bill-wise references and ageing read every item given
 *   (a June allocation handed to a May pack would appear on May's voucher; a later bill would age as "not due").
 *
 * ── v1.8.1 (the critic's review, 2026-09-29) ──
 *   ⚠️⚠️ tally.xml IS NOT YET RUN AGAINST TALLYPRIME. manifest.tally_xml_status says so, and it stays so until a live
 *   import with Athi at the keyboard. The LIVE-PROVEN Tally writer is the platform's
 *   chitbridge-api/tools/tally-connector/adapters/tally.js (Sales / Receipt / Purchase voucher types, REPORTNAME
 *   Vouchers, ISPARTYLEDGER, eduDates — proven 2026-09-05). This engine is pure and cannot call it; the platform's pack
 *   builder should PREFER that adapter's voucher shape. Known differences here, NOT guessed at: every voucher is a
 *   Journal (TallyPrime refuses cash/bank ledgers in a Journal unless F12 allows it); masters and vouchers share one
 *   "All Masters" envelope; <PARENT> names a Tally group by its ENGLISH name (a company with renamed groups will not match).
 *   M7a  every party a voucher names gets a ledger master — one not in `parties` is created under its control
 *        account's group and named in manifest.checks.mismatches (party_unknown).
 *   M9   verify() flags a file the manifest does not list.  L9 verify(files, null) → ok: false.
 *   M11  SAF-T: what was added, and what is still missing, is listed above saft().
 */

var PACKS_ = null, LEDGER_ = null, MONEY_ = null;
function req_(g, key, path, cache) {
  var v = (typeof root !== 'undefined' && root && root[g] && root[g][key]) ? root[g] : null;
  if (!v && typeof globalThis !== 'undefined' && globalThis.window && globalThis.window[g]) v = globalThis.window[g];
  if (!v && typeof require === 'function') { try { v = require(path); } catch (_) { v = null; } }
  return v;
}
function P_() { return PACKS_ || (PACKS_ = req_('CBAccountsPacks', 'accountOf', './accounts-packs')); }
function G_() { return LEDGER_ || (LEDGER_ = req_('CBLedger', 'balanceAsAt', './ledger')); }
function M_() { return MONEY_ || (MONEY_ = req_('CBMoney', 'decimals', './money')); }
function refuse_(why) { var e = new Error(why); e.status = 422; return e; }
function own_(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
const TALLY_XML_STATUS = 'not yet run against TallyPrime';

/* ── exact decimals from minor units: string arithmetic, never a float ── */
function dec(minor, dp) {
  var d = dp == null ? 2 : dp, n = Number(minor);
  if (!Number.isSafeInteger(n)) throw refuse_('Not a whole minor-unit amount: ' + String(minor).slice(0, 40) + '.');
  var neg = n < 0, s = String(Math.abs(n));
  if (d === 0) return (neg ? '-' : '') + s;
  while (s.length <= d) s = '0' + s;
  return (neg ? '-' : '') + s.slice(0, s.length - d) + '.' + s.slice(s.length - d);
}
/* v1.8.1 (H2): ONE date rule — accounts-packs.dayOf: a real calendar day as YYYY-MM-DD, else null */
function day_(s) { var P = P_(); return P && P.dayOf ? P.dayOf(s) : null; }
function ymd_(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }

/** ⭐ csv(rows, header) — RFC 4180; ⚠️ a text cell starting = + - @ (a spreadsheet formula) is prefixed with ' */
function csvCell_(v, numeric) {
  if (v == null) return '';
  var s = String(v);
  if (!numeric && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csv(header, rows, numericCols) {
  var num = {}; (numericCols || []).forEach(function (k) { num[k] = 1; });
  return [header.map(function (h) { return csvCell_(h); }).join(',')].concat((rows || []).map(function (r) {
    return header.map(function (h) { return csvCell_(r[h], num[h]); }).join(',');
  })).join('\r\n') + '\r\n';
}
function xml_(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
/** UTF-8 byte length, counted — no TextEncoder needed */
function bytes(s) {
  var n = 0, t = String(s);
  for (var i = 0; i < t.length; i++) {
    var c = t.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < t.length) { n += 4; i++; } else n += 3;
  }
  return n;
}
/** canonical JSON: keys sorted, so the same manifest always hashes the same */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

/* ═══ the range, the chart, the parties — shared by every part ═══ */
function context_(input) {
  var x = input || {}, P = P_(), G = G_();
  if (!P || !G) throw refuse_('The pack needs the accounts-packs and ledger engines.');
  var pack = x.pack || P.packFor((x.entity && x.entity.country) || 'IN');
  if (Array.isArray(x.accounts) && x.accounts.length) pack = P.withAccounts(pack, x.accounts);
  /* L6: 'quarter' became 'month' silently — an unknown kind is refused; absent = month */
  if (x.kind != null && ['month', 'year', 'exit'].indexOf(x.kind) < 0) throw refuse_('Unknown pack kind "' + String(x.kind).slice(0, 20) + '" — month, year or exit.');
  var kind = x.kind || 'month';
  var fy = x.fiscal_year, range;
  if (x.from && x.to) range = { start: x.from, end: x.to };
  else if (kind === 'month') range = P.periodRange(fy, Number(x.period), pack);
  else range = P.fyRange(fy, pack);
  if (!range || day_(range.start) === null || day_(range.end) === null) throw refuse_('The pack needs its fiscal year (and month) or from/to.');
  if (day_(range.start) > day_(range.end)) throw refuse_('A pack runs from a day to a later one (' + range.start + ' → ' + range.end + ').');
  if (P.fiscalYearOf(range.start, pack) !== P.fiscalYearOf(range.end, pack)) throw refuse_('A pack stays inside one fiscal year.');
  fy = P.fiscalYearOf(range.start, pack);
  var cur = String(pack.currency || 'INR'), M = M_(), dp = M && M.decimals ? M.decimals(cur) : 2;
  var chart = Object.create(null), acct = function (l) {
    var k = l.code != null && l.code !== '' ? String(l.code) : String(l.account == null ? '' : l.account);
    if (own_(chart, k)) return chart[k];
    var a = P.accountOf(pack, k); if (!a) throw refuse_('The account "' + k + '" is not in the chart.');
    chart[k] = a; return a;
  };
  var parties = Object.create(null);                                  /* a party id of "__proto__" is just a key */
  (x.parties || []).forEach(function (p) { if (p && p.party_id != null) parties[String(p.party_id)] = p; });
  var f = day_(range.start), t = day_(range.end);
  var moves = (x.lines || []).filter(function (l) { return l && Number(l.period) !== 0 && day_(l.date) >= f && day_(l.date) <= t; });
  /* M7a: a party a line names that is NOT in `parties` — it still gets a master (no ghost ledger) and is named in the manifest */
  var deb = P.accountOf(pack, 'debtors').code, cre = P.accountOf(pack, 'creditors').code, unknown = Object.create(null);
  moves.forEach(function (l) {
    if (!l.party) return;
    var code = acct(l).code, k = String(l.party);
    if ((code !== deb && code !== cre) || parties[k] || unknown[k]) return;
    unknown[k] = { party_id: k, party_no: null, name: k, side: code === cre ? 'supplier' : 'customer', unknown: true };
  });
  return { x: x, P: P, G: G, pack: pack, kind: kind, fy: fy, range: range, cur: cur, dp: dp, acct: acct, parties: parties, moves: moves,
           unknown: Object.keys(unknown).sort().map(function (k) { return unknown[k]; }) };
}

/** the opening (the day before the range) and the closing, as nets per code and per code+party */
function positions_(c) {
  var x = c.x, G = c.G, P = c.P, prev = ymd_(day_(c.range.start) - 1), open = { accounts: Object.create(null), parties: Object.create(null) };
  var base = { pack: c.pack, balances: x.balances, lines: x.lines }, rows = Array.isArray(x.balances);
  var monthEnd = function (d) { var r = P.periodRange(P.fiscalYearOf(d, c.pack), P.periodOf(d, c.pack), c.pack); return !!r && r.end === d; };
  /* ⭐ v1.8.1 (H1): when the rows were handed in, the opening and the closing are THE ROWS' OWN figures, asked for by
     name — { prefer: 'rows' } — never inferred from the calendar. That is what makes the tie check independent. */
  var rowsAt = function (d) { return G.balanceAsAt(Object.assign({}, base, { asOf: d }, rows && monthEnd(d) ? { prefer: 'rows' } : {})); };
  if (P.fiscalYearOf(prev, c.pack) === c.fy) open = rowsAt(prev);
  else {
    var src = rows ? x.balances : (x.lines || []);
    src.forEach(function (r, i) {
      if (!r || r.fiscal_year !== c.fy || Number(r.period) !== 0) return;
      /* L10: G.minor — the ledger's one reader ('1e3' and true were taken by Number() here, and refused everywhere else) */
      var a = c.acct(r), dr = r.dr_minor == null ? 0 : G.minor(r.dr_minor, 'opening row ' + (i + 1)), cr = r.cr_minor == null ? 0 : G.minor(r.cr_minor, 'opening row ' + (i + 1));
      var isParty = r.party != null && r.party !== '';
      if (!rows || !isParty) { var o = open.accounts[a.code] || (open.accounts[a.code] = { net_minor: 0 }); o.net_minor += dr - cr; }
      if (isParty) { var pp = open.parties[a.code] || (open.parties[a.code] = Object.create(null)), q = pp[r.party] || (pp[r.party] = { net_minor: 0 }); q.net_minor += dr - cr; }
    });
  }
  var mv = Object.create(null), mvp = Object.create(null), dr = 0, cr = 0;
  c.moves.forEach(function (l) {
    var where = 'a line of ' + (l.jv_no || l.entry_id || '?');
    var a = c.acct(l), d = l.dr_minor == null ? 0 : G.minor(l.dr_minor, where), k = l.cr_minor == null ? 0 : G.minor(l.cr_minor, where);
    var m = mv[a.code] || (mv[a.code] = { dr_minor: 0, cr_minor: 0 }); m.dr_minor += d; m.cr_minor += k;
    if (l.party) { var pm = mvp[a.code] || (mvp[a.code] = Object.create(null)), q = pm[l.party] || (pm[l.party] = { dr_minor: 0, cr_minor: 0 }); q.dr_minor += d; q.cr_minor += k; }
    dr += d; cr += k;
  });
  /* the independent closing: the month rows at the range end (when the rows were handed in) */
  var close = rows ? rowsAt(c.range.end) : null;
  return { open: open, mv: mv, mvp: mvp, close: close, dr: dr, cr: cr };
}

/* ═══ THE PARTS ═══ */

/** ⭐ codeBook(input) → the CSV that says what every code means: code, role, name, group, Tally group, Schedule III, SAF-T */
function codeBook(input) {
  var c = context_(input), P = c.P, rows = [];
  var add = function (r) { var a = P.accountOf(c.pack, r.code); if (a) rows.push(a); };
  (c.pack.ledgers || []).concat(c.pack.expense_classes || [], c.pack.income_classes || []).forEach(add);
  var seen = {}, out = [];
  rows.sort(function (p, q) { return p.code < q.code ? -1 : p.code > q.code ? 1 : 0; }).forEach(function (a) {
    if (seen[a.code]) return; seen[a.code] = 1;
    out.push({ code: a.code, role: a.role || '', name: a.name, group: a.group, tally_group: a.tally_group, nature: a.nature,
               statement: a.statement, sch3: a.sch3, sch3_line: a.sch3_line, saft_category: a.saft.category, saft_code: a.saft.code });
  });
  return out;
}

/**
 * ⭐ saft(input) → the SAF-T-shaped object (OECD 2.0 structure: Header · MasterFiles · GeneralLedgerEntries).
 * ⚠️ "SAF-T-SHAPED", NOT A SAF-T FILE — nobody promises a CA one. v1.8.1 (critic M11), against the OECD 2.0 schema:
 *   ADDED where the input carries the data — Header.TaxAccountingBasis (input.tax_accounting_basis, else 'Invoice':
 *     entries are posted on the bill) · Company.TaxRegistration[] (entity.tax_id / tax_ids — it used to sit in
 *     RegistrationNumber, which is the COMPANY registration: now entity.registration_no) · Company.Address and
 *     Customer/Supplier.Address (when entity.address / party.address are given) · Journal.Type · Transaction.SystemEntryDate
 *     (the line's posted_at, else null) · Line.TaxInformation on the GST lines (TaxType, TaxCode, TaxPercentage, TaxBase,
 *     TaxAmount — TaxPercentage/TaxBase only when the line carries its rate) · MasterFiles.TaxTable (the codes and rates seen)
 *     · opening / closing balances as ONE explicit side (the schema's choice), never both with "0.00".
 *   STILL MISSING, by name — SourceDocuments (sales / purchase invoices, payments): the engine is handed journal lines, not
 *     the documents; Address where the input has none; tax lines posted without a rate (an expense's input tax) carry no
 *     TaxPercentage / TaxBase.
 */
function saft(input) {
  var c = context_(input), x = c.x, pos = positions_(c), dp = c.dp;
  /* the schema's CHOICE: a debit balance OR a credit balance (a nil balance is a debit of 0.00) */
  var bal = function (r, prefix, net) { if (net >= 0) r[prefix + 'DebitBalance'] = dec(net, dp); else r[prefix + 'CreditBalance'] = dec(-net, dp); };
  var closeNet = function (code) { var o = (pos.open.accounts[code] || { net_minor: 0 }).net_minor, m = pos.mv[code] || { dr_minor: 0, cr_minor: 0 }; return o + m.dr_minor - m.cr_minor; };
  var accounts = codeBook(input).filter(function (a) { return pos.open.accounts[a.code] || pos.mv[a.code]; }).map(function (a) {
    var r = { AccountID: a.code, AccountDescription: a.name, StandardAccountID: a.role || null, GroupingCategory: a.saft_category,
              GroupingCode: a.saft_code, AccountType: 'GL' };
    bal(r, 'Opening', (pos.open.accounts[a.code] || { net_minor: 0 }).net_minor); bal(r, 'Closing', closeNet(a.code));
    return r;
  });
  var deb = c.P.accountOf(c.pack, 'debtors').code, cre = c.P.accountOf(c.pack, 'creditors').code;
  var partyRow = function (p, code, idKey) {
    var o = ((pos.open.parties[code] || {})[p.party_id] || { net_minor: 0 }).net_minor, m = (pos.mvp[code] || {})[p.party_id] || { dr_minor: 0, cr_minor: 0 };
    var r = {};
    r[idKey] = p.party_no || String(p.party_id); r.AccountID = code; r.Name = p.legal_name || p.name;
    if (p.address) r.Address = p.address;
    r.TaxRegistration = (p.tax_ids || []).map(function (t) { return { TaxRegistrationNumber: t.value, TaxType: t.scheme }; });
    if (p.unknown) r.NotInPartyList = true;                            /* M7a: named on a line, absent from `parties` */
    bal(r, 'Opening', o); bal(r, 'Closing', o + m.dr_minor - m.cr_minor);
    return r;
  };
  var list = Object.keys(c.parties).sort().map(function (k) { return c.parties[k]; }).concat(c.unknown);
  var customers = list.filter(function (p) { return p.side !== 'supplier'; }).map(function (p) { return partyRow(p, deb, 'CustomerID'); });
  var suppliers = list.filter(function (p) { return p.side === 'supplier'; }).map(function (p) { return partyRow(p, cre, 'SupplierID'); });
  var byEntry = Object.create(null), order = [];
  c.moves.forEach(function (l) { var k = l.jv_no || l.entry_id; if (!byEntry[k]) { byEntry[k] = []; order.push(k); } byEntry[k].push(l); });
  order.sort(function (p, q) { var a = byEntry[p][0], b = byEntry[q][0]; return (day_(a.date) - day_(b.date)) || String(p).localeCompare(String(q)); });
  /* a GST line: a ledger under Duties & Taxes whose role is output_/input_ + cgst|sgst|igst. CGST and SGST are each HALF the bill's rate. */
  var taxOf = function (a) { var m = /^(output|input)_(cgst|sgst|igst|cess)$/.exec(a.role || ''); return m && a.group === 'duties_taxes' ? { dir: m[1], code: m[2].toUpperCase() } : null; };
  var pct = function (t, rate) { var n = Number(rate); return t.code === 'CESS' ? null : rate == null || rate === '' || !Number.isFinite(n) ? null : String(t.code === 'IGST' ? n : n / 2); };
  var seenTax = Object.create(null);
  var tx = order.map(function (k) {
    var ls = byEntry[k], h = ls[0], base = Object.create(null);
    ls.forEach(function (l) {                                           /* the taxable value per rate: the entry's rated lines that are not tax lines */
      if (l.rate == null || taxOf(c.acct(l))) return;
      var r = String(l.rate); base[r] = (base[r] || 0) + Number(l.dr_minor || 0) + Number(l.cr_minor || 0);
    });
    return { TransactionID: String(k), Period: Number(h.period), PeriodYear: c.fy, TransactionDate: h.date, GLPostingDate: h.date,
             SystemEntryDate: h.posted_at || null,
             Description: h.narration || null, SourceID: h.entry_id != null ? String(h.entry_id) : null,
             Line: ls.map(function (l, i) {
               var a = c.acct(l), p = l.party ? c.parties[String(l.party)] : null, L = { RecordID: String(i + 1), AccountID: a.code };
               if (l.party) { var pid = p && p.party_no ? p.party_no : String(l.party); if (a.code === cre) L.SupplierID = pid; else L.CustomerID = pid; }
               L.SourceDocumentID = l.ref || null; L.Description = a.name;
               if (Number(l.dr_minor)) L.DebitAmount = { Amount: dec(l.dr_minor, dp) }; else L.CreditAmount = { Amount: dec(l.cr_minor, dp) };
               var t = taxOf(a);
               if (t) {
                 var per = pct(t, l.rate), b = l.rate != null && base[String(l.rate)] != null ? dec(base[String(l.rate)], dp) : null;
                 L.TaxInformation = { TaxType: 'GST', TaxCode: t.code, TaxPercentage: per, TaxBase: b,
                                      TaxAmount: { Amount: dec(Number(l.dr_minor) || Number(l.cr_minor) || 0, dp) } };
                 var sk = t.code + '|' + (per === null ? '' : per);
                 if (!seenTax[sk]) seenTax[sk] = { TaxCode: t.code, Description: a.name.replace(/^(Output|Input)\s+/, ''), TaxPercentage: per };
               }
               return L;
             }) };
  });
  var e = x.entity || {}, sw = x.software || {};
  var taxReg = (e.tax_ids || []).map(function (t) { return { TaxRegistrationNumber: t.value, TaxType: t.scheme }; });
  if (e.tax_id) taxReg.unshift({ TaxRegistrationNumber: e.tax_id, TaxType: e.tax_scheme || (c.pack.country === 'IN' ? 'GSTIN' : 'TAX') });
  var company = { RegistrationNumber: e.registration_no || null, Name: e.name || null, EntityID: e.id || null, TaxRegistration: taxReg };
  if (e.address) company.Address = e.address;
  var taxCodes = Object.keys(seenTax).sort().map(function (k) { return seenTax[k]; });
  return { AuditFile: {
    Header: { AuditFileVersion: '2.00', AuditFileCountry: c.pack.country, AuditFileDateCreated: x.created_at || null,
              SoftwareCompanyName: sw.company || 'ChitBridge', SoftwareID: sw.name || 'chitbridge-engines/bookpack', SoftwareVersion: sw.version || null,
              Company: company,
              DefaultCurrencyCode: c.cur,
              SelectionCriteria: { SelectionStartDate: c.range.start, SelectionEndDate: c.range.end, PeriodYear: c.fy, Kind: c.kind },
              TaxAccountingBasis: x.tax_accounting_basis || 'Invoice',
              HeaderComment: 'SAF-T-shaped (OECD SAF-T 2.0 structure) — a handover record, not a statutory filing. Not included: SourceDocuments.' },
    MasterFiles: { GeneralLedgerAccounts: { Account: accounts }, Customers: { Customer: customers }, Suppliers: { Supplier: suppliers },
                   TaxTable: { TaxTableEntry: taxCodes.length ? [{ TaxType: 'GST', Description: 'Goods and Services Tax', TaxCodeDetails: taxCodes }] : [] } },
    GeneralLedgerEntries: { NumberOfEntries: tx.length, TotalDebit: dec(pos.dr, dp), TotalCredit: dec(pos.cr, dp),
                            Journal: [{ JournalID: 'GJ', Description: 'General journal', Type: 'GL', Transaction: tx }] } } };
}

/* the bill-wise split of one party line: Agst Ref for each bill it settled (from the party items), the rest New Ref / Advance */
function billwise_(c, l, signedMinor) {
  var items = (c.x.items || []).filter(function (r) { return r && r.ref === l.ref && String(r.party) === String(l.party); });
  var out = [], left = signedMinor, agst = Object.create(null);
  items.forEach(function (r) {
    if (r.against_ref === r.ref) return;
    if (r.ref_kind !== 'allocation' && r.ref_kind !== 'reversal') return;
    agst[r.against_ref] = (agst[r.against_ref] || 0) + Number(r.amount_minor);
  });
  var sign = signedMinor < 0 ? -1 : 1;
  Object.keys(agst).sort().forEach(function (b) {
    var m = agst[b]; if (!m) return;
    var take = sign * Math.min(Math.abs(m), Math.abs(left)); if (!take) return;
    out.push({ name: b, type: 'Agst Ref', minor: take }); left -= take;
  });
  if (left) {
    var isBill = items.some(function (r) { return r.ref_kind === 'bill'; });
    out.push({ name: l.ref || String(l.jv_no || l.entry_id), type: isBill ? 'New Ref' : (items.length ? 'Advance' : 'On Account'), minor: left });
  }
  return out;
}

/**
 * ⭐ tallyXml(input) → Tally import XML: masters (ledgers under their Tally group, parties bill-wise) + journal vouchers.
 * ⚠️⚠️ STATUS: 'not yet run against TallyPrime' (manifest.tally_xml_status). See the v1.8.1 note at the top of this file: the
 * live-proven writer is chitbridge-api tools/tally-connector/adapters/tally.js; nothing here was shaped by guessing at
 * what TallyPrime accepts. v1.8.1 (M7a): a master is created for EVERY party a voucher names, listed or not.
 */
function tallyXml(input) {
  var c = context_(input), pos = positions_(c), dp = c.dp, P = c.P;
  var deb = P.accountOf(c.pack, 'debtors').code, cre = P.accountOf(c.pack, 'creditors').code;
  /* Tally: a DEBIT is a negative amount with ISDEEMEDPOSITIVE Yes */
  var amt = function (netDr) { return dec(-netDr, dp); };
  var partyName = function (id) { var p = c.parties[String(id)]; return p ? (p.name + ' (' + (p.party_no || id) + ')') : String(id); };   /* an unknown party's ledger is its id — the same name its master gets below */
  var ledgerName = function (a, party) { return party && (a.code === deb || a.code === cre) ? partyName(party) : a.name; };
  var masters = [];
  codeBook(input).forEach(function (a) {
    if (a.code === deb || a.code === cre) return;
    var o = (pos.open.accounts[a.code] || { net_minor: 0 }).net_minor;
    masters.push('<TALLYMESSAGE><LEDGER NAME="' + xml_(a.name) + '" ACTION="Create"><NAME.LIST><NAME>' + xml_(a.name) + '</NAME><NAME>' + xml_(a.code) + '</NAME></NAME.LIST>'
      + '<PARENT>' + xml_(a.tally_group) + '</PARENT><OPENINGBALANCE>' + amt(o) + '</OPENINGBALANCE></LEDGER></TALLYMESSAGE>');
  });
  Object.keys(c.parties).sort().forEach(function (k) {
    var p = c.parties[k], code = p.side === 'supplier' ? cre : deb, a = P.accountOf(c.pack, code);
    var o = ((pos.open.parties[code] || {})[k] || { net_minor: 0 }).net_minor, gst = (p.tax_ids || []).find(function (t) { return t.scheme === 'GSTIN'; });
    masters.push('<TALLYMESSAGE><LEDGER NAME="' + xml_(partyName(k)) + '" ACTION="Create"><NAME.LIST><NAME>' + xml_(partyName(k)) + '</NAME></NAME.LIST>'
      + '<PARENT>' + xml_(a.tally_group) + '</PARENT><ISBILLWISEON>Yes</ISBILLWISEON>'
      + (gst ? '<PARTYGSTIN>' + xml_(gst.value) + '</PARTYGSTIN>' : '') + (p.state_code ? '<LEDSTATENAME>' + xml_(p.state_code) + '</LEDSTATENAME>' : '')
      + '<OPENINGBALANCE>' + amt(o) + '</OPENINGBALANCE></LEDGER></TALLYMESSAGE>');
  });
  /* M7a: no ghost ledgers — a party a voucher names but `parties` does not list still gets its master, under its control account's group */
  c.unknown.forEach(function (p) {
    var code = p.side === 'supplier' ? cre : deb, a = P.accountOf(c.pack, code), o = ((pos.open.parties[code] || {})[p.party_id] || { net_minor: 0 }).net_minor;
    masters.push('<TALLYMESSAGE><LEDGER NAME="' + xml_(partyName(p.party_id)) + '" ACTION="Create"><NAME.LIST><NAME>' + xml_(partyName(p.party_id)) + '</NAME></NAME.LIST>'
      + '<PARENT>' + xml_(a.tally_group) + '</PARENT><ISBILLWISEON>Yes</ISBILLWISEON><OPENINGBALANCE>' + amt(o) + '</OPENINGBALANCE></LEDGER></TALLYMESSAGE>');
  });
  var byEntry = Object.create(null), order = [];
  c.moves.forEach(function (l) { var k = l.jv_no || l.entry_id; if (!byEntry[k]) { byEntry[k] = []; order.push(k); } byEntry[k].push(l); });
  order.sort(function (p, q) { var a = byEntry[p][0], b = byEntry[q][0]; return (day_(a.date) - day_(b.date)) || String(p).localeCompare(String(q)); });
  var vouchers = order.map(function (k) {
    var ls = byEntry[k], h = ls[0];
    return '<TALLYMESSAGE><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>' + h.date.replace(/-/g, '') + '</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>'
      + '<VOUCHERNUMBER>' + xml_(k) + '</VOUCHERNUMBER>' + (h.narration ? '<NARRATION>' + xml_(h.narration) + '</NARRATION>' : '')
      + ls.map(function (l) {
        var a = c.acct(l), net = Number(l.dr_minor || 0) - Number(l.cr_minor || 0);
        var bills = l.party && (a.code === deb || a.code === cre) ? billwise_(c, l, net) : [];
        return '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + xml_(ledgerName(a, l.party)) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' + (net > 0 ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE>'
          + '<AMOUNT>' + amt(net) + '</AMOUNT>'
          + bills.map(function (b) { return '<BILLALLOCATIONS.LIST><NAME>' + xml_(b.name) + '</NAME><BILLTYPE>' + b.type + '</BILLTYPE><AMOUNT>' + amt(b.minor) + '</AMOUNT></BILLALLOCATIONS.LIST>'; }).join('')
          + '</ALLLEDGERENTRIES.LIST>';
      }).join('') + '</VOUCHER></TALLYMESSAGE>';
  });
  var e = c.x.entity || {};
  return '<?xml version="1.0" encoding="UTF-8"?>\r\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>'
    + '<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + xml_(e.name || '') + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>'
    + '<REQUESTDATA>\r\n' + masters.concat(vouchers).join('\r\n') + '\r\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\r\n';
}

/** ⭐ the CSV parts: trial balance (opening · movement · closing), ledgers (running per account), day book, ageing */
function tables(input) {
  var c = context_(input), pos = positions_(c), dp = c.dp, P = c.P, G = c.G;
  var names = Object.create(null); codeBook(input).forEach(function (a) { names[a.code] = a; });
  var codes = Object.create(null); Object.keys(pos.open.accounts).concat(Object.keys(pos.mv)).forEach(function (k) { codes[k] = 1; });
  var tb = Object.keys(codes).sort().map(function (k) {
    var o = (pos.open.accounts[k] || { net_minor: 0 }).net_minor, m = pos.mv[k] || { dr_minor: 0, cr_minor: 0 }, cl = o + m.dr_minor - m.cr_minor;
    return { code: k, name: (names[k] || {}).name, group: (names[k] || {}).tally_group,
             opening_dr: dec(o > 0 ? o : 0, dp), opening_cr: dec(o < 0 ? -o : 0, dp), movement_dr: dec(m.dr_minor, dp), movement_cr: dec(m.cr_minor, dp),
             closing_dr: dec(cl > 0 ? cl : 0, dp), closing_cr: dec(cl < 0 ? -cl : 0, dp) };
  });
  var sorted = c.moves.slice().sort(function (p, q) { return (day_(p.date) - day_(q.date)) || String(p.jv_no || p.entry_id).localeCompare(String(q.jv_no || q.entry_id)) || ((p.line_no || 0) - (q.line_no || 0)); });
  var pn = function (id) { var p = c.parties[String(id)]; return p ? p : null; };
  var run = Object.create(null);
  var ledgers = sorted.slice().sort(function (p, q) { var a = c.acct(p).code, b = c.acct(q).code; return a < b ? -1 : a > b ? 1 : 0; }).map(function (l) {
    var a = c.acct(l); if (run[a.code] == null) run[a.code] = (pos.open.accounts[a.code] || { net_minor: 0 }).net_minor;
    run[a.code] += Number(l.dr_minor || 0) - Number(l.cr_minor || 0);
    var p = l.party ? pn(l.party) : null;
    return { code: a.code, account: a.name, date: l.date, jv_no: l.jv_no || l.entry_id, ref: l.ref || '', party_no: p ? p.party_no : (l.party || ''),
             party: p ? p.name : '', narration: l.narration || '', dr: dec(l.dr_minor || 0, dp), cr: dec(l.cr_minor || 0, dp), balance: dec(run[a.code], dp) };
  });
  var daybook = sorted.map(function (l) {
    var a = c.acct(l), p = l.party ? pn(l.party) : null;
    return { date: l.date, jv_no: l.jv_no || l.entry_id, narration: l.narration || '', code: a.code, account: a.name,
             party_no: p ? p.party_no : (l.party || ''), dr: dec(l.dr_minor || 0, dp), cr: dec(l.cr_minor || 0, dp) };
  });
  var ageing = [];
  if (Array.isArray(c.x.items) && c.x.items.length) {
    var R = req_('CBReceivables', 'outstanding', './receivables');
    if (!R) throw refuse_('Ageing from party items needs the receivables engine.');
    ['receivable', 'payable'].forEach(function (s) {
      var docs = c.x.items.filter(function (r) { return r && (r.side || 'receivable') === s; });
      if (!docs.length) return;
      var ag = G.ageing(R.outstanding(docs).by_ref, c.range.end, s);
      Object.keys(ag.by_party).sort().forEach(function (q) {
        ['undisputed', 'disputed'].forEach(function (dk) {
          var b = ag.by_party[q][dk], tot = ag.bucket_keys.reduce(function (t, k) { return t + b[k]; }, 0);
          if (!tot) return;
          var p = pn(q), row = { side: s, party_no: p ? p.party_no : q, party: p ? p.name : '', disputed: dk === 'disputed' ? 'yes' : 'no' };
          ag.bucket_keys.forEach(function (k) { row[k] = dec(b[k], dp); }); row.total = dec(tot, dp);
          ageing.push(row);
        });
      });
    });
  }
  return { trial_balance: tb, ledgers: ledgers, day_book: daybook, ageing: ageing };
}

/**
 * ⭐⭐ build(input, { hash? }) → { files[{ name, content, rows, bytes }], manifest } — every part, and the manifest:
 *   { pack_kind, entity_id, fiscal_year, period, from, to, created_at, currency, files[{ file, bytes, rows, sha256 }],
 *     counts{ entries, lines, accounts, customers, suppliers, party_items }, totals{ dr_minor, cr_minor, balanced },
 *     checks{ ok, opening_plus_movement_equals_closing, mismatches[] }, prev_sha256, sha256,
 *     tally_xml_status (v1.8.1: 'not yet run against TallyPrime' — also on the tally.xml file row), country_fallback? }
 * ⚠️ A pack whose controls fail is still BUILT (the shop is owed its records) — manifest.checks.ok is false and the
 * mismatches are named; the caller shows them and never marks such a pack clean.
 */
function build(input, opt) {
  var c = context_(input), o = opt || {}, pos = positions_(c), hash = typeof o.hash === 'function' ? o.hash : null;
  var T = tables(input), sf = saft(input), cb = codeBook(input);
  var files = [
    { name: 'saft.json', content: JSON.stringify(sf, null, 1) + '\n', rows: sf.AuditFile.GeneralLedgerEntries.NumberOfEntries },
    { name: 'tally.xml', content: tallyXml(input), rows: sf.AuditFile.GeneralLedgerEntries.NumberOfEntries },
    { name: 'trial_balance.csv', content: csv(['code', 'name', 'group', 'opening_dr', 'opening_cr', 'movement_dr', 'movement_cr', 'closing_dr', 'closing_cr'], T.trial_balance, ['opening_dr', 'opening_cr', 'movement_dr', 'movement_cr', 'closing_dr', 'closing_cr']), rows: T.trial_balance.length },
    { name: 'ledgers.csv', content: csv(['code', 'account', 'date', 'jv_no', 'ref', 'party_no', 'party', 'narration', 'dr', 'cr', 'balance'], T.ledgers, ['dr', 'cr', 'balance']), rows: T.ledgers.length },
    { name: 'day_book.csv', content: csv(['date', 'jv_no', 'narration', 'code', 'account', 'party_no', 'dr', 'cr'], T.day_book, ['dr', 'cr']), rows: T.day_book.length },
    { name: 'ageing.csv', content: csv(['side', 'party_no', 'party', 'disputed'].concat(T.ageing.length ? Object.keys(T.ageing[0]).filter(function (k) { return ['side', 'party_no', 'party', 'disputed'].indexOf(k) < 0; }) : ['total']), T.ageing, ['not_due', 'lt_6m', 'm6_1y', 'lt_1y', 'y1_2', 'y2_3', 'gt_3y', 'total']), rows: T.ageing.length },
    { name: 'code_book.csv', content: csv(['code', 'role', 'name', 'group', 'tally_group', 'nature', 'statement', 'sch3', 'sch3_line', 'saft_category', 'saft_code'], cb), rows: cb.length }
  ];
  files.forEach(function (f) { f.bytes = bytes(f.content); });
  /* ⭐ the controls: Σdr = Σcr; opening + movement = the closing the month rows say (when rows were given) */
  var mism = [];
  if (pos.dr !== pos.cr) mism.push({ name: 'unbalanced', dr_minor: pos.dr, cr_minor: pos.cr });
  /* M7a: a party a voucher names that the party list does not — built (it has its master), but never clean */
  c.unknown.forEach(function (p) { mism.push({ name: 'party_unknown', party: p.party_id, side: p.side }); });
  var byEntry = Object.create(null);
  c.moves.forEach(function (l) { var k = l.jv_no || l.entry_id, e = byEntry[k] || (byEntry[k] = [0, 0]); e[0] += Number(l.dr_minor || 0); e[1] += Number(l.cr_minor || 0); });
  Object.keys(byEntry).forEach(function (k) { if (byEntry[k][0] !== byEntry[k][1]) mism.push({ name: 'entry_unbalanced', entry: k, dr_minor: byEntry[k][0], cr_minor: byEntry[k][1] }); });
  var tie = null;
  if (pos.close) {
    tie = true;
    var codes = Object.create(null); Object.keys(pos.open.accounts).concat(Object.keys(pos.mv), Object.keys(pos.close.accounts)).forEach(function (k) { codes[k] = 1; });
    Object.keys(codes).sort().forEach(function (k) {
      var want = (pos.open.accounts[k] || { net_minor: 0 }).net_minor + (pos.mv[k] ? pos.mv[k].dr_minor - pos.mv[k].cr_minor : 0);
      var have = (pos.close.accounts[k] || { net_minor: 0 }).net_minor;
      if (want !== have) { tie = false; mism.push({ name: 'opening_plus_movement_ne_closing', code: k, computed_minor: want, rows_minor: have }); }
    });
    var pc = Object.create(null); [pos.open.parties, pos.mvp, pos.close.parties].forEach(function (m) { Object.keys(m).forEach(function (k) { Object.keys(m[k]).forEach(function (q) { pc[k + '\u0000' + q] = 1; }); }); });
    Object.keys(pc).sort().forEach(function (key) {
      var s = key.split('\u0000'), k = s[0], q = s[1];
      var o = ((pos.open.parties[k] || {})[q] || { net_minor: 0 }).net_minor, m = (pos.mvp[k] || {})[q];
      var want = o + (m ? m.dr_minor - m.cr_minor : 0), have = ((pos.close.parties[k] || {})[q] || { net_minor: 0 }).net_minor;
      if (want !== have) { tie = false; mism.push({ name: 'party_opening_plus_movement_ne_closing', code: k, party: q, computed_minor: want, rows_minor: have }); }
    });
  }
  var parties = Object.keys(c.parties).map(function (k) { return c.parties[k]; });
  var manifest = {
    pack_kind: c.kind, entity_id: (c.x.entity || {}).id || null, fiscal_year: c.fy, period: c.kind === 'month' ? Number(c.x.period) || null : null,
    from: c.range.start, to: c.range.end, created_at: c.x.created_at || null, currency: c.cur, format: 'chitbridge-bookpack/1',
    files: files.map(function (f) {
      var row = { file: f.name, bytes: f.bytes, rows: f.rows, sha256: hash ? String(hash(f.content)) : null };
      if (f.name === 'tally.xml') row.status = TALLY_XML_STATUS;
      return row;
    }),
    tally_xml_status: TALLY_XML_STATUS,
    counts: { entries: Object.keys(byEntry).length, lines: c.moves.length, accounts: sf.AuditFile.MasterFiles.GeneralLedgerAccounts.Account.length,
              customers: parties.filter(function (p) { return p.side !== 'supplier'; }).length, suppliers: parties.filter(function (p) { return p.side === 'supplier'; }).length,
              parties_unknown: c.unknown.length, party_items: (c.x.items || []).length },
    totals: { dr_minor: pos.dr, cr_minor: pos.cr, dr: dec(pos.dr, c.dp), cr: dec(pos.cr, c.dp), balanced: pos.dr === pos.cr },
    checks: { ok: mism.length === 0, opening_plus_movement_equals_closing: tie, mismatches: mism },
    prev_sha256: c.x.prev_sha256 || null, sha256: null
  };
  /* L6: a country this engine has no chart for was built on India's — said, never silent */
  if (c.pack.fallback) manifest.country_fallback = { asked: c.pack.asked || null, used: c.pack.country };
  if (!hash) manifest.unhashed = true;
  else manifest.sha256 = String(hash(canonical(Object.assign({}, manifest, { sha256: null }))));
  files.push({ name: 'manifest.json', content: JSON.stringify(manifest, null, 1) + '\n', rows: 1 });
  files[files.length - 1].bytes = bytes(files[files.length - 1].content);
  return { files: files, manifest: manifest };
}

/** ⭐ seal(manifest, fileHashes, hash) → the manifest with each file's sha256 and its own — for a caller that hashed outside */
function seal(manifest, fileHashes, hash) {
  if (typeof hash !== 'function') throw refuse_('seal needs the hash function.');
  var m = JSON.parse(JSON.stringify(manifest || {}));
  (m.files || []).forEach(function (f) { if (!own_(fileHashes || {}, f.file)) throw refuse_('No hash for ' + f.file + '.'); f.sha256 = String(fileHashes[f.file]); });
  delete m.unhashed; m.sha256 = null; m.sha256 = String(hash(canonical(m)));
  return m;
}

/**
 * ⭐ verify(files, manifest, hash) → { ok, mismatches[] } — every file's hash and size as the manifest says, and the
 * manifest's own hash. ⭐ verifyChain(manifests) → { ok, breaks[] } — each pack names the one before it (prev_sha256).
 */
function verify(files, manifest, hash) {
  if (typeof hash !== 'function') throw refuse_('verify needs the hash function.');
  /* L9: no manifest is a failed check, said by name — not a TypeError */
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files)) return { ok: false, mismatches: [{ file: 'manifest.json', why: 'missing' }] };
  var bad = [], by = Object.create(null), listed = Object.create(null);
  (files || []).forEach(function (f) { if (f) by[f.name] = f; });
  manifest.files.forEach(function (f) {
    listed[f.file] = 1;
    var x = by[f.file]; if (!x) { bad.push({ file: f.file, why: 'missing' }); return; }
    if (bytes(x.content) !== f.bytes) bad.push({ file: f.file, why: 'size' });
    if (String(hash(x.content)) !== f.sha256) bad.push({ file: f.file, why: 'hash' });
  });
  /* M9: a pack is THESE files and no others — a file the manifest does not list is named (manifest.json is the manifest itself) */
  Object.keys(by).sort().forEach(function (n) { if (!listed[n] && n !== 'manifest.json') bad.push({ file: n, why: 'unlisted' }); });
  var self = String(hash(canonical(Object.assign({}, manifest, { sha256: null }))));
  if (self !== manifest.sha256) bad.push({ file: 'manifest.json', why: 'hash' });
  return { ok: bad.length === 0, mismatches: bad };
}
function verifyChain(manifests) {
  var breaks = [];
  (manifests || []).forEach(function (m, i) {
    if (i === 0) return;
    if ((m && m.prev_sha256) !== (manifests[i - 1] && manifests[i - 1].sha256)) breaks.push({ at: i, pack: m && (m.fiscal_year + '/' + (m.period || m.pack_kind)), want: manifests[i - 1] && manifests[i - 1].sha256, got: m && m.prev_sha256 });
  });
  return { ok: breaks.length === 0, breaks: breaks };
}

const EXPORTS = { dec, csv, bytes, canonical, codeBook, saft, tallyXml, tables, build, seal, verify, verifyChain };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBBookPack. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBBookPack = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
