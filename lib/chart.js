/* ADOPTED from chitbridge-engines v1.42.0 · chart · sha256 7201c432d50a3f35038f415cfef71c7ac1652c79ed3aadacca8cea3ec42fed37 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · chart. Edited ONLY in chitbridge-engines/src/chart.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
// @stage tested
// @stage-note [BOOKS · CORE] The chart of accounts as a MECHANISM over a pack's rows: accountOf, tree, nextCode, withAccounts; and the calendar and the numbers: dayOf, fiscalYearOf,
// @stage-note periodOf, fyRange, periodRange, fyLabel, voucherNo, partyNo. It names no country: the pack says its groups, ledgers, year and voucher shape.
/**
 * chart.js — THE CHART AND THE CALENDAR AS A MECHANISM (core-vs-packs step b1, v1.22.0, 2026-10-03).
 *
 * MOVED, cut and pasted, from accounts-packs.js: the code that reads a pack's rows (a ledger by role or code, the tree, the next free code, a shop's own ledgers) and the code that
 * reads a pack's year (which fiscal year a date is in, which period, the range of each, the one rule that writes a year's name) and writes a voucher number. A pack is an OBJECT handed
 * in — never a global; there is no default country and no default year in here. accounts-packs.js stays as the facade that every caller already uses (the same names, the same answers).
 *
 * A pack supplies: groups · ledgers · expense_classes · income_classes (rows), fiscalYear { startMonth, label }, voucherFormat, and accountExtras(row, group, pack) → the fields
 * that are its own (the statutory line a ledger lands on, its statement, the names its accountants read).
 *
 * ── ZERO DEPENDENCIES · NO CLOCK: every date is an argument ──────────────────────────────────────────────────
 */
const own = function (o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); };

/** a group by its key */
function groupOf(pack, key) { return ((pack || {}).groups || []).find((g) => g.code === key) || null; }
/** every ledger row a pack has — ledgers, expense classes, income classes — each with its kind */
function rows_(p) {
  return [].concat(
    (p.ledgers || []).map((r) => ['ledger', r]),
    (p.expense_classes || []).map((r) => ['expense_class', r]),
    (p.income_classes || []).map((r) => ['income_class', r]));
}
/**
 * accountOf(pack, roleOrCode) → { role, code, name, group, type, nature, side, kind } plus whatever the pack's accountExtras adds (its statutory line, its
 * statement 'bs' | 'pl', the legacy names a country's accountants read) — the one lookup the posting engine uses — or null. Accepts a ROLE ('debtors') or a CODE ('1300').
 * `type`, `nature` and `side` come from the account's GROUP.
 */
function accountOf(pack, key) {
  const p = pack || {};
  const k = String(key == null ? '' : key);
  const hit = rows_(p).find(([, r]) => r.role === k) || rows_(p).find(([, r]) => r.code === k);
  if (!hit) return null;
  const [kind, r] = hit;
  const g = groupOf(p, r.group);
  if (!g) return null;
  if (typeof p.accountExtras !== 'function') throw new Error('This regulation pack has no accountExtras, so it cannot say which statement line a ledger lands on.');
  return Object.assign({ role: r.role, code: r.code, name: r.name, group: g.code, type: g.type, nature: g.nature, side: g.side, kind: kind }, p.accountExtras(r, g, p));
}
/** ⭐ the chart as a tree: primary groups → sub-groups → ledgers (with codes), in code order — what a screen draws */
function tree(pack) {
  const p = pack || {};
  const byGroup = {};
  rows_(p).forEach(([kind, r]) => {
    if (!byGroup[r.group]) byGroup[r.group] = [];
    if (!byGroup[r.group].some((x) => x.code === r.code)) byGroup[r.group].push({ role: r.role, code: r.code, name: r.name, kind: kind });
  });
  const node = (g) => ({ group: g.code, name: g.name, nature: g.nature, range: g.range,
    ledgers: (byGroup[g.code] || []).slice().sort((a, b) => a.code.localeCompare(b.code)),
    children: (p.groups || []).filter((c) => c.parent === g.code).map(node) });
  return (p.groups || []).filter((g) => !g.parent).map(node)
    .sort((a, b) => (a.range ? a.range[0] : 0) - (b.range ? b.range[0] : 0));
}
/**
 * ⭐ nextCode(pack, groupKey, taken) → the next free 4-digit code in that group's range, or null when it is full — for a
 * ledger a shop adds. `taken` = the codes already used by this shop.
 */
function nextCode(pack, groupKey, taken) {
  const g = groupOf(pack, groupKey); if (!g || !g.range) return null;
  const used = {};
  rows_(pack || {}).forEach(([, r]) => { used[r.code] = 1; });
  (taken || []).forEach((c) => { used[String(c)] = 1; });
  for (let n = g.range[0]; n <= g.range[1]; n++) { const s = String(n); if (!used[s]) return s; }
  return null;
}

/**
 * ⭐ withAccounts(pack, shopRows) → a copy of the pack that also knows the ledgers a SHOP added: rows { code, name, group }
 * (role null — the rules never name them). ⚠️ Refused (throws 409), never merged: a code outside its group's range, a
 * code or name already in the chart (a CODE CLASH), an unknown group, a code that is not 4 digits.
 */
function withAccounts(pack, shopRows) {
  const p = pack || {}, used = {}, names = {}, extra = [];
  rows_(p).forEach(([, r]) => { used[r.code] = r.role || r.name; names[String(r.name).toLowerCase()] = r.code; });
  (shopRows || []).forEach((r, i) => {
    const bad = (why) => { const e = new Error('Shop ledger #' + (i + 1) + ' (' + String(r && r.name).slice(0, 40) + '): ' + why); e.status = 409; throw e; };
    const code = String(r && r.code == null ? '' : r.code), name = String((r && r.name) || '').trim();
    if (!/^\d{4}$/.test(code)) bad('the code "' + code.slice(0, 20) + '" is not 4 digits.');
    const g = groupOf(p, r.group); if (!g) bad('there is no group "' + r.group + '".');
    if (!g.range || +code < g.range[0] || +code > g.range[1]) bad('code ' + code + ' is outside ' + g.name + ' (' + (g.range || []).join('–') + ').');
    if (own(used, code)) bad('code ' + code + ' is already ' + used[code] + ' — a code clash.');
    if (!name) bad('it has no name.');
    if (own(names, name.toLowerCase())) bad('the name is already ledger ' + names[name.toLowerCase()] + '.');
    used[code] = name; names[name.toLowerCase()] = code;
    extra.push({ role: null, code: code, name: name, group: g.code, shop: true });
  });
  return Object.assign({}, p, { ledgers: (p.ledgers || []).concat(extra) });
}

/* ═══ THE FISCAL YEAR AND THE NUMBER FORMATS — no clock: every date is an argument ═══ */

/**
 * ⚠️ v1.8.1 (critic H2): a date is a REAL CALENDAR DAY written YYYY-MM-DD and nothing else — no datetime
 * ('2026-09-05T10:00:00Z'), no unpadded '2026-9-5', no 30 February, no month 13. Anything else is null, and every
 * caller refuses on null. The one rule, shared: posting, ledger and bookpack all ask dayOf().
 */
function ymd_(s) {
  const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y: y, m: mo, d: d };
}
/** ⭐ dayOf('2026-09-29') → the day number (days since 1970-01-01, no clock, no zone), or null when it is not a real YYYY-MM-DD day */
function dayOf(date) { const t = ymd_(date); return t ? Math.round(Date.UTC(t.y, t.m - 1, t.d) / 86400000) : null; }
/** the month the pack's year starts in — the core has no default year: a pack without one is refused */
function startOf_(pack) {
  const f = pack && pack.fiscalYear;
  if (!f || !(f.startMonth >= 1 && f.startMonth <= 12)) throw new Error('A fiscal year needs the fiscalYear { startMonth, label } of a pack — the core has no default year.');
  return f.startMonth;
}
/** ⭐ fyLabel(2026, pack) → '2026-27' (label 'split': the year it starts in, then the next year's last two digits) or '2026' (label 'single') — the ONE rule that names a year */
function fyLabel(y, pack) {
  if (!pack || !pack.fiscalYear) throw new Error('A fiscal year label needs the fiscalYear of a pack.');
  return pack.fiscalYear.label === 'single' ? String(y) : y + '-' + String((y + 1) % 100).padStart(2, '0');
}
/** ⭐ fiscalYearOf('2026-09-29', pack) → '2026-27' (the pack says where the year starts and how it is written) */
function fiscalYearOf(date, pack) {
  const t = ymd_(date); if (!t) return null;
  const start = startOf_(pack);
  const y = t.m >= start ? t.y : t.y - 1;
  return fyLabel(y, pack);
}
/** ⭐ periodOf('2026-09-29', pack) → 6 (September is the 6th month of a year that starts in April). Period 0 is "brought forward". */
function periodOf(date, pack) {
  const t = ymd_(date); if (!t) return null;
  const start = startOf_(pack);
  return ((t.m - start + 12) % 12) + 1;
}
/** fyRange('2026-27', pack) → { start: '2026-04-01', end: '2027-03-31' } */
function fyRange(fy, pack) {
  const y = parseInt(String(fy || ''), 10); if (!(y > 0)) return null;
  const start = startOf_(pack);
  const s = new Date(Date.UTC(y, start - 1, 1)), e = new Date(Date.UTC(y + 1, start - 1, 0));
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}
/** periodRange('2026-27', 6, pack) → { start: '2026-09-01', end: '2026-09-30' } */
function periodRange(fy, period, pack) {
  const y = parseInt(String(fy || ''), 10), p = Number(period);
  if (!(y > 0) || !(p >= 1 && p <= 12)) return null;
  const start = startOf_(pack);
  const m0 = start - 1 + (p - 1);
  const s = new Date(Date.UTC(y, m0, 1)), e = new Date(Date.UTC(y, m0 + 1, 0));
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}
/** ⭐ partyNo(42) → 'P-00042' — one series per shop across customers and suppliers, assigned once, never reused */
function partyNo(n) { const k = Math.floor(Number(n)); return k > 0 ? 'P-' + String(k).padStart(5, '0') : null; }
/**
 * ⭐ voucherNo('SV', '2026-27', 41, pack?) → 'SV/2026-27/000041' — one series per voucher type (and the manual series for a person's own entry), gap-free per shop per
 * fiscal year per series. The shape is the pack's voucherFormat ('{series}/{fy}/{n:6}' when none). null for a nonsense series, year or counter.
 */
function voucherNo(series, fy, n, pack) {
  const k = Math.floor(Number(n)), s = String(series == null ? '' : series);
  if (!(/^[A-Z]{2,3}$/.test(s) && fy && k > 0)) return null;
  const f = (pack && pack.voucherFormat) || '{series}/{fy}/{n:6}';
  return f.replace('{series}', () => s).replace('{fy}', () => fy).replace(/\{n:(\d+)\}/,(m, w) => String(k).padStart(Number(w), '0'));
}

const EXPORTS = { groupOf, accountOf, tree, nextCode, withAccounts, dayOf, fiscalYearOf, periodOf, fyRange, periodRange, fyLabel, partyNo, voucherNo };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBChart. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBChart = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
