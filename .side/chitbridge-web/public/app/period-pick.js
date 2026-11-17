/**
 * period-pick.js — THE PERIOD CONTROL of a firm looking at a client's books (Athi 16 Nov: W8 year switch, W14 one dropdown instead of 24 month chips, W15/W17 open on the year under review).
 *
 * OWNS      the ONE period {fy, from, to}: its words in the address (?fy=2025-26 or ?from=…&to=…), the dropdown lines ("Sep 2025 · 40 entries · Locked · 40/40 checked"), and the control itself (the library Select, ui-select.js)
 * CALLED BY books-grant-view.js (the six reads of a client's books) · network-app.js (the address)
 * FLOW      GET /api/books/periods?marks=1 → { under_review, years, periods } → options → one pick → { fy, from, to } → every view reads it (tb: as at `to` · p&l, day book: from–to · bs, dues: as at `to`)
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 * Decides nothing: the year under review, each month's state and each checked n of m are the server's (api lib/books-period-choices.js); this file only words them. A figure the server did not send is left out of the line, never shown as 0.
 *   CBPeriodPick.fromAddress(search) · .toAddress(period) · .of(value, answer) · .valueOf(period) · .optionsOf(answer, period) · .control(answer, period, onPick) · .same(a, b) · .words(period)
 */
(function (root) {
  'use strict';
  var MOUNT = 'NET005-U01'; /* the library Select's mount code on this screen (register NET005) */

  function phrase(text) {
    return typeof root.tx === 'function' ? root.tx(text) : text;
  }
  function shopDayOf(iso) {
    return typeof root.shopDay === 'function' ? root.shopDay(iso) : iso;
  }
  function monthWord(iso) {
    var names = typeof root.monthNames === 'function' ? root.monthNames('short') : [];
    return (names[Number(iso.slice(5, 7)) - 1] || iso.slice(0, 7)) + ' ' + iso.slice(0, 4);
  }
  function entriesWord(n) {
    return Number(n) === 0 ? phrase('no entries') : Number(n) + ' ' + phrase(Number(n) === 1 ? 'entry' : 'entries');
  }
  /** "40/40 checked", or nothing at all when the server sent no count */
  function checkedWord(checked, of) {
    return checked == null || of == null || Number(of) === 0 ? '' : checked + '/' + of + ' ' + phrase('checked');
  }
  function line(parts) {
    return parts.filter(Boolean).join(' · ');
  }
  /** E13: the month's state in the SAME word as the Month lock page and the firm's Months (CBLockWords.stateWord, from the server's state names) */
  function stateOf(status) {
    return root.CBLockWords ? root.CBLockWords.stateWord(status) : phrase(status === 'soft_locked' || status === 'hard_locked' ? 'Locked' : 'Open');
  }

  /** the period named in an address (?fy= or ?from=&to=), or null: the page then opens on the year under review */
  function fromAddress(search) {
    var query = new root.URLSearchParams(search || ''), fy = query.get('fy'), from = query.get('from'), to = query.get('to'), ok = /^\d{4}-\d{2}-\d{2}$/;
    if (from && to && ok.test(from) && ok.test(to) && from <= to) return { kind: 'custom', fy: null, from: from, to: to };
    return fy ? { kind: 'year', fy: fy, from: null, to: null } : null; /* a year named in the address: its dates come from the server's years */
  }
  /** a period's words for the address: &fy=2025-26 for a year, &from=…&to=… for a month or any range */
  function toAddress(period) {
    if (!period) return '';
    if (period.kind === 'year' && period.fy) return '&fy=' + encodeURIComponent(period.fy);
    return '&from=' + encodeURIComponent(period.from) + '&to=' + encodeURIComponent(period.to);
  }
  /** the option value of a period: y:<fy> · m:<from>|<to> · c:<from>|<to> */
  function valueOf(period) {
    if (!period) return '';
    return period.kind === 'year' ? 'y:' + period.fy : (period.kind === 'month' ? 'm:' : 'c:') + period.from + '|' + period.to;
  }
  function same(a, b) {
    return valueOf(a) === valueOf(b);
  }
  /** an option value → the period, read from the server's answer (a year's dates are the server's, never worked out here) */
  function of(value, answer) {
    var kind = String(value).charAt(0), rest = String(value).slice(2), dates = rest.split('|');
    if (kind === 'y') {
      var year = ((answer && answer.years) || []).filter(function (y) { return String(y.fy) === rest; })[0];
      return year ? { kind: 'year', fy: year.fy, from: year.from, to: year.to } : null;
    }
    var fy = null;
    ((answer && answer.periods) || []).forEach(function (p) { if (String(p.start_date).slice(0, 10) === dates[0]) fy = p.fiscal_year; });
    return { kind: kind === 'm' ? 'month' : 'custom', fy: kind === 'm' ? fy : null, from: dates[0], to: dates[1] };
  }
  /** a year the address named by its label only: fill its dates from the server's years (null when the books hold no such year) */
  function filled(period, answer) {
    if (!period || period.from) return period;
    return of('y:' + period.fy, answer);
  }
  /** one line of the dropdown for a month: "Sep 2025 · 40 entries · locked · 40/40 checked" */
  function monthLine(p) {
    return line([monthWord(String(p.start_date).slice(0, 10)), entriesWord(p.entries), stateOf(p.status), checkedWord(p.checked, p.of)]);
  }
  /** one line for a year: "FY 2025-26 · 1 Jul 2025 – 30 Jun 2026 · 480 entries · 12 of 12 months locked · 470/480 checked" */
  function yearLine(y) {
    return line(['FY ' + y.fy, shopDayOf(y.from) + ' – ' + shopDayOf(y.to), entriesWord(y.entries), y.locked + ' ' + phrase('of') + ' ' + y.months + ' ' + phrase('months locked'), checkedWord(y.checked, y.of)]);
  }
  /** the dropdown's options, newest year first, each year's line then its months that hold entries; a range typed in the address that is none of these is added at the top */
  function optionsOf(answer, period) {
    var out = [], years = (answer && answer.years) || [], months = ((answer && answer.periods) || []).filter(function (p) { return Number(p.period) >= 1 && Number(p.entries) > 0; });
    years.forEach(function (y) {
      out.push({ value: 'y:' + y.fy, label: yearLine(y) });
      months.filter(function (p) { return p.fiscal_year === y.fy; }).sort(function (a, b) { return a.start_date < b.start_date ? 1 : -1; }).forEach(function (p) {
        out.push({ value: 'm:' + String(p.start_date).slice(0, 10) + '|' + String(p.end_date).slice(0, 10), label: '   ' + monthLine(p) });
      });
    });
    if (period && !out.some(function (o) { return o.value === valueOf(period); })) out.unshift({ value: valueOf(period), label: shopDayOf(period.from) + ' – ' + shopDayOf(period.to) });
    return out;
  }
  /** "For 1 Jul 2025 – 30 Jun 2026" words of a period, for a heading */
  function words(period) {
    return period ? shopDayOf(period.from) + ' – ' + shopDayOf(period.to) : '';
  }
  /** the control: the library Select (ui.select), one line per year and month; onPick(period) when one is chosen. '' when the server named no period to choose from (a books with no months) or the library is not on the page. */
  function control(answer, period, onPick) {
    var options = optionsOf(answer, period);
    if (!options.length || !root.ui || typeof root.ui.select !== 'function') return '';
    return root.ui.select({
      mount: MOUNT, label: 'Period', bare: true, id: 'bv_period', testid: 'bv-period-pick', value: valueOf(period), options: options,
      onChange: function (value) { var picked = of(value, answer); if (picked) onPick(picked); }
    });
  }
  root.CBPeriodPick = { fromAddress: fromAddress, toAddress: toAddress, valueOf: valueOf, same: same, of: of, filled: filled, optionsOf: optionsOf, control: control, words: words };
})(typeof window !== 'undefined' ? window : globalThis);
