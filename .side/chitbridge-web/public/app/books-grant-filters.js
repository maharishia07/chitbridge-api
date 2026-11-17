/**
 * books-grant-filters.js — A3C rank 3 (auditor paper 17 Nov): REVIEW BY EXCEPTION on the Day book. The filters the one list control (list-ctl.js `filters:`) draws above the auditor's Day book.
 *
 * OWNS      the filters Mark · Evidence · Type, the journal-risk filters (JET, ASA 240: Recorded · Made · Round sum · Made by · Narration) and Year end (ASA 560), each with its own address word (&dbf_mark= &dbf_ev= &dbf_kind= &dbf_rec= &dbf_time= &dbf_round= &dbf_by= &dbf_narr= &dbf_ye= &dbf_risk=, so a reload or a shared link opens the same narrowing)
 * CALLED BY books-grant-view.js (the Day book's list configuration)
 * FLOW      filtersFor(mk) → the list's `filters:` → each choice is answered by the SAME three one-definitions the rows already paint: the mark control's class of the entry (cap-mark.js markOf) ·
 *           the evidence chip's key (cap-evidence.js stateOf) · the Day book's kind (helpers.js dayBookKind). Nothing is counted or decided here: the list counts what matches.
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 * JET RULES (one definition each, read-only; nothing is calculated: a day compared to a day, a clock hour, a remainder): recordedDay = the day of `recorded_at` in the SHOP's zone (window.CB_SHOP_TZ, else the viewer's) · afterEnd = recordedDay later than the period's end · daysLate = days from `posting_date` to recordedDay · weekend = the rest days of the AUDITED SHOP's country (the answer's `country`, read by CBLocale.weekInfo(region), the one reader; the viewer's own locale only when the shop's country is unknown; Sat and Sun as the last fallback) · afterHours = before 07:00 or from 20:00 · round = a whole multiple of 100 or 1,000 major units (the currency's own decimals, CBMoney.decimals) · noNarration = the server's `no_narration`. RISK = how many of those six an entry trips (riskOf: after period end · over 7 days late · weekend · after hours · round multiple of 100 · no narration), one point each, nothing weighted; the Risk column shows the count and the Any risk filter keeps the rows with one or more. `rec=afterend` and `ye=recorded` (dated inside the period, recorded after its end) are the SAME afterEnd.
 *
 * "Not checked" is everything the bar's "Checked n of m" does not count: no mark, a check that changed after review, a query, a hold, a refusal. So Not checked = m − n and Checked + Not checked = every row (tests/a3c-day-book-exception).
 *   CBBooksGrantFilters.carry(search, clientId) · .filtersFor(mk) · .markState(mk, row) · .evidenceKey(row) · .kindOf(row) · .toAddress(filt) · .fromAddress(search)
 */
(function (root) {
  'use strict';
  var PARAM = { mark: 'dbf_mark', ev: 'dbf_ev', kind: 'dbf_kind', rec: 'dbf_rec', time: 'dbf_time', round: 'dbf_round', by: 'dbf_by', narr: 'dbf_narr', ye: 'dbf_ye', flag: 'dbf_flag', risk: 'dbf_risk' };
  var NIGHT_FROM = 20, NIGHT_TO = 7; /* after hours: from 20:00 and before 07:00, shop time */
  var DAY_MS = 86400000;

  function words(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  /** the mark's class for the entry row ('none' · 'clear' · 'open' · 'hold' · 'reject') and whether a check still holds */
  function markState(mk, row) {
    var m = mk && row ? mk.markOf(row.entry_id) : null;
    return m || { state: 'none', altered: false };
  }
  /** a check that still holds: the ONLY thing the bar's "Checked n of m" counts (the server's stillCleared); everything else, queried and on hold included, is "Not checked" (so Not checked = m − n) */
  function isChecked(mk, row) {
    var m = markState(mk, row);
    return m.state === 'clear' && !m.altered;
  }
  /** the evidence chip's own key (flag · none · nodoc · held); '' when the server sent no evidence on the entry */
  function evidenceKey(row) {
    var ev = row && row.evidence;
    if (!ev || !root.CBEvidence || !root.CBEvidence.stateOf) return '';
    return root.CBEvidence.stateOf(ev).key;
  }
  function kindOf(row) {
    return root.dayBookKind(row);
  }
  /** a moment in the shop's zone → { day: 'YYYY-MM-DD', dow: the short weekday name, hour: 0-23 }; null when it is not a moment */
  function zoned(iso) {
    if (!iso || isNaN(new Date(iso).getTime())) return null;
    var o = { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' };
    if (root.CB_SHOP_TZ) o.timeZone = String(root.CB_SHOP_TZ);
    var p = {};
    function read() { new Intl.DateTimeFormat('en-CA', o).formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; }); }
    try { read(); } catch (failure) { delete o.timeZone; read(); } /* an unknown zone: the viewer's own, as shopDateTime does */
    return { day: p.year + '-' + p.month + '-' + p.day, dow: p.weekday, hour: Number(p.hour) % 24 };
  }
  function recordedDay(row) {
    var z = zoned(row && row.recorded_at);
    return z ? z.day : '';
  }
  /** recorded after the end of the period (the period is { from, to }) */
  function afterEnd(row, period) {
    var rd = recordedDay(row);
    return !!(rd && period && period.to && rd > String(period.to).slice(0, 10));
  }
  /** whole days from the entry's date to the day it was recorded (never below 0) */
  function daysLate(row) {
    var rd = recordedDay(row), pd = row && row.posting_date ? String(row.posting_date).slice(0, 10) : '';
    if (!rd || !pd) return 0;
    return Math.max(0, Math.round((Date.parse(rd + 'T00:00:00Z') - Date.parse(pd + 'T00:00:00Z')) / DAY_MS));
  }
  var ISO_DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  /** the ONE weekend answer: the region's rest days as ISO numbers (1 Mon .. 7 Sun) from CBLocale.weekInfo (CLDR; the reader Admin shows as "x + y is the weekend here"); Sat + Sun only where the reader gives none */
  function weekendDays(region) {
    var wi = root.CBLocale && root.CBLocale.weekInfo ? root.CBLocale.weekInfo(region || undefined) : null;
    return wi && wi.weekend && wi.weekend.length ? wi.weekend : [6, 7];
  }
  function weekend(row, region) {
    var z = zoned(row && row.recorded_at);
    return !!z && weekendDays(region).indexOf(ISO_DOW[z.dow]) >= 0;
  }
  function afterHours(row) {
    var z = zoned(row && row.recorded_at);
    return !!z && (z.hour >= NIGHT_FROM || z.hour < NIGHT_TO);
  }
  /** a whole multiple of `step` major units (never zero); the currency's own decimals say what a minor unit is */
  function round(row, step, currency) {
    var minor = Number(row && row.amount_minor), dec = root.CBMoney && root.CBMoney.decimals ? root.CBMoney.decimals(currency) : 2;
    return isFinite(minor) && minor > 0 && minor % (step * Math.pow(10, dec)) === 0;
  }
  var LATE_DAYS = 7; /* "late" in the Risk count = over 7 days, the Recorded filter's first step (shown on the page) */
  /** the six JET rules, each ONE definition above: [key, words, test(row, period, currency)] in the order the page lists them */
  var RULES = [
    ['afterend', 'After period end', function (row, period) { return afterEnd(row, period); }],
    ['late', 'Over 7 days late', function (row) { return daysLate(row) > LATE_DAYS; }],
    ['weekend', 'At a weekend', function (row, period, currency, region) { return weekend(row, region); }],
    ['night', 'After hours', function (row) { return afterHours(row); }],
    ['round', 'Round sum', function (row, period, currency) { return round(row, 100, currency); }],
    ['narr', 'No narration', function (row) { return noNarration(row); }]
  ];
  /** the rules this row trips, as their words (a list; its length is the Risk count) */
  function riskOf(row, period, currency, region) {
    return RULES.filter(function (rule) { return rule[2](row, period, currency, region); }).map(function (rule) { return words(rule[1]); });
  }
  function noNarration(row) {
    return !!(row && row.no_narration);
  }
  function madeBy(row) {
    return (row && row.made_by) || '';
  }
  /** the people who made the entries on the page, once each, in order of name */
  function makers(rows) {
    var seen = {};
    (rows || []).forEach(function (row) { if (madeBy(row)) seen[madeBy(row)] = true; });
    return Object.keys(seen).sort();
  }
  function opts(list) {
    return list.map(function (o) { return { v: o[0], label: words(o[1]) }; });
  }
  /** my private bookmarks and notes (cap-flag.js): a flag never changes "Checked n of m", and this filter never reads a mark */
  function flagFilter(flagHelper) {
    return { key: 'flag', label: words('Saved'), all: words('All'), options: opts([['bookmarked', 'Bookmarked'], ['noted', 'With a note']]), match: function (row, v) { return v === 'noted' ? flagHelper.noted(row.entry_id) > 0 : flagHelper.bookmarked(row.entry_id); } };
  }
  /** ctx (optional, widens the three): { period: () => {from,to}, currency: () => code, region: () => the AUDITED SHOP's country code (its weekend is the test's calendar, never the viewer's), rows: () => entries } — read when a row is judged, so a new period or page is followed */
  function filtersFor(markHelper, ctx) {
    ctx = ctx || {};
    var flagHelper = ctx.fl || null;
    var period = function () { return ctx.period ? ctx.period() : null; }, currencyOf = function () { return ctx.currency ? ctx.currency() : ''; }, regionOf = function () { return ctx.region ? ctx.region() : ''; };
    var EVIDENCE_WORDS = (root.CBEvidence && root.CBEvidence.words) || { flag: 'No tax invoice', none: 'No file', nodoc: 'No source', held: 'File attached' }; /* the chip's own words: one wording per state */
    return [
      { key: 'mark', label: words('Mark'), all: words('All'), options: opts([['notchecked', 'Not checked'], ['checked', 'Checked'], ['hold', 'On hold'], ['query', 'Queried']]), match: function (row, v) { var st = markState(markHelper, row).state; return v === 'checked' ? isChecked(markHelper, row) : v === 'notchecked' ? !isChecked(markHelper, row) : v === 'hold' ? st === 'hold' : st === 'open'; } },
      { key: 'ev', label: words('Evidence'), all: words('All'), options: opts([['flag', EVIDENCE_WORDS.flag], ['none', EVIDENCE_WORDS.none], ['nodoc', EVIDENCE_WORDS.nodoc], ['held', EVIDENCE_WORDS.held]]), match: function (row, v) { return evidenceKey(row) === v; } },
      { key: 'risk', label: words('Risk'), all: words('All'), options: opts([['any', 'Any risk']]), match: function (row) { return riskOf(row, period(), currencyOf(), regionOf()).length > 0; } },
      { key: 'rec', label: words('Recorded'), all: words('All'), options: opts([['afterend', 'After period end'], ['late7', 'Over 7 days late'], ['late30', 'Over 30 days late'], ['late90', 'Over 90 days late']]), match: function (row, v) { return v === 'afterend' ? afterEnd(row, period()) : daysLate(row) > Number(String(v).replace('late', '')); } },
      { key: 'time', label: words('Made'), all: words('All'), options: opts([['weekend', 'At a weekend'], ['night', 'After hours']]), match: function (row, v) { return v === 'weekend' ? weekend(row, regionOf()) : afterHours(row); } },
      { key: 'round', label: words('Round sum'), all: words('All'), options: opts([['100', 'Multiple of 100'], ['1000', 'Multiple of 1,000']]), match: function (row, v) { return round(row, Number(v), currencyOf()); } },
      { key: 'by', label: words('Made by'), all: words('All'), options: function () { return makers(ctx.rows ? ctx.rows() : []).map(function (n) { return { v: n, label: n }; }); }, match: function (row, v) { return madeBy(row) === v; } },
      { key: 'narr', label: words('Narration'), all: words('All'), options: opts([['none', 'None written']]), match: function (row) { return noNarration(row); } },
      { key: 'ye', label: words('Year end'), all: words('All'), options: opts([['dated', 'Dated after it'], ['recorded', 'Recorded after it']]), match: function (row, v) { var p = period() || {}, d = String(row.posting_date || '').slice(0, 10); return v === 'dated' ? !!p.to && d > String(p.to).slice(0, 10) : afterEnd(row, p) && d <= String(p.to).slice(0, 10) && (!p.from || d >= String(p.from).slice(0, 10)); } },
      { key: 'kind', label: words('Type'), all: words('All'), options: opts([['Sales', 'Sales'], ['Purchases', 'Purchases'], ['Expenses', 'Expenses'], ['Returns', 'Returns'], ['Receipts', 'Receipts'], ['Payments', 'Payments'], ['Other', 'Journals and other']]), match: function (row, v) { return kindOf(row) === v; } }
    ].concat(flagHelper && !flagHelper.off() ? [flagFilter(flagHelper)] : []);
  }
  /** the choices in force → the address words (only the ones set) */
  function toAddress(filt) {
    var out = '';
    Object.keys(PARAM).forEach(function (k) { if (filt && filt[k]) out += (out ? '&' : '') + PARAM[k] + '=' + encodeURIComponent(filt[k]); });
    return out;
  }
  /** the address → the choices ({} when none): a value the list does not offer is dropped by the list itself (cleanFilters) */
  function fromAddress(search) {
    var q = new root.URLSearchParams(search || ''), out = {};
    Object.keys(PARAM).forEach(function (k) { var v = q.get(PARAM[k]); if (v) out[k] = v; });
    return out;
  }
  /** the filter words already in the address, as '&dbf_..=..' to append to the client's address (so the address the page writes for itself does not wipe them) */
  function carry(search, clientId) {
    var open = new root.URLSearchParams(search || '').get('open');
    if (clientId && open !== clientId) return ''; /* another client's narrowing never follows to this one */
    var text = toAddress(fromAddress(search));
    return text ? '&' + text : '';
  }
  /** the address words of every filter, for a page that wipes them (one list, so a new filter is never missed) */
  function paramNames() { return Object.keys(PARAM).map(function (k) { return PARAM[k]; }); }
  /** Year end 'Dated after it' reads the days AFTER the period (one year on): the range, or null with no period */
  function afterRange(period) {
    if (!period || !period.to) return null;
    var end = Date.parse(String(period.to).slice(0, 10) + 'T00:00:00Z');
    return { from: new Date(end + DAY_MS).toISOString().slice(0, 10), to: new Date(end + 366 * DAY_MS).toISOString().slice(0, 10) };
  }
  root.CBBooksGrantFilters = { paramNames: paramNames, afterRange: afterRange, recordedDay: recordedDay, afterEnd: afterEnd, daysLate: daysLate, weekend: weekend, weekendDays: weekendDays, riskOf: riskOf, afterHours: afterHours, round: round, noNarration: noNarration, makers: makers, carry: carry, filtersFor: filtersFor, markState: markState, isChecked: isChecked, evidenceKey: evidenceKey, kindOf: kindOf, toAddress: toAddress, fromAddress: fromAddress };
}(typeof window !== 'undefined' ? window : globalThis));
