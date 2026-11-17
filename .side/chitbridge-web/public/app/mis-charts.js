/* app/mis-charts.js — the owner's MIS pictures: the data ADAPTERS from the server's answers to CBDraw's shapes (MISCH, 2026-11-17).
 * CARD 26-reporting-mis-and-bi/charts
 *
 * ⭐ ONE CALCULATION: nothing here adds, rounds or compares money. Each adapter renames and orders what the server carried (rollup.series slots · /dues aged_totals ·
 *   /pl by_line · /cashflow series + lowest) and puts words on it; the money text comes from deps.money (the one shop-currency formatter). A figure the server
 *   did not give is null and the chart shows an empty tick, never a 0. The ONE place a period key becomes words (keyWords) is here: Reports › Trend reads it too.
 * ⭐ A TABLE UNDER EVERY CHART: each adapter returns { points|rows, table: { head, rows } } so the page can toggle the same figures as text.
 * Pictures (one component per kind, all in engine/chart-draw.js): sales week / month / year against last year (CBDraw.bars) · what is owed by age (CBDraw.hbars) ·
 *   income and expense lines against last year (CBDraw.compare, money) · cash for 30 days (CBDraw.cashLine).
 * NOT built, and why: profit PER ITEM and top items — no cost price per item (REP-29) and no items-sold read exist on main; the REQ forbids a profit per item before then (the overview says so).
 *   Sales BY WEEKDAY: /overview weekdays[7] (one soldByDay read, widened) → weekdayPoints.
 * deps = { tx (words), money (minor, currency) → text, date (Date → text for a month name), cur (currency) }.
 * OWNS      MC (keyWords · salesPoints · salesTable · duesRows · plRows · cashPoints · monthPoints · monthTable · profitPoints · weekdayPoints · weekdayTable)
 * CALLED BY app/cap-books-overview.js (How we are doing: monthPoints · profitPoints · weekdayPoints · duesRows · cashPoints) · app/cap-mis-pictures.js (the Pictures view) · app/cap-mis-trend.js (trKeyWords · trPoints) · e2e/mis-charts.test.cjs
 * FLOW      R2R · reports — server answer in → points/rows + table out → CBDraw → svg
 */
(function (root) {
  'use strict';
  var DUE_KEYS = [
    ['not_due', 'Not due', false],
    ['d0_30', '1-30 days', true],
    ['d31_60', '31-60 days', true],
    ['d61_90', '61-90 days', true],
    ['d90_plus', 'Over 90 days', true]
  ];

  function monthWords(key, form, deps) {
    var parts = /^(\d{4})-(\d{2})$/.exec(key);
    return parts ? deps.date(Date.UTC(+parts[1], +parts[2] - 1, 15), { month: form, year: form === 'long' ? 'numeric' : '2-digit' }) : key;
  }
  function fiscalWords(year, deps) {
    return /^\d{4}-\d{2}$/.test(year) ? deps.tx('FY') + ' ' + year : year;
  }
  function shortYear(words) {
    return words.replace(/\d{2}(\d{2})-(\d{2})$/, '$1-$2');
  }
  /** { label (under a bar), title (a sentence's name for it) } of one slot key — the engine's key, the reader's words */
  function keyWords(key, period, deps) {
    var text = String(key),
      parts;
    if (period === 'week' && (parts = /^(\d{4})-W(\d{2})$/.exec(text))) return { label: 'W' + parts[2], title: deps.tx('Week') + ' ' + Number(parts[2]) + ', ' + parts[1] };
    if (period === 'month') return { label: monthWords(text, 'short', deps), title: monthWords(text, 'long', deps) };
    if (period === 'quarter' && (parts = /^(.+)-Q([1-4])$/.exec(text))) return { label: 'Q' + parts[2] + ' ' + shortYear(parts[1]), title: 'Q' + parts[2] + ' · ' + fiscalWords(parts[1], deps) };
    return { label: shortYear(fiscalWords(text, deps)), title: fiscalWords(text, deps) };
  }
  function moneyOrDash(minor, deps) {
    return minor === null || minor === undefined ? '—' : deps.money(minor, deps.cur);
  }

  /** the engine's slots → CBDraw.bars points: this period solid, last year the dashed line, part of a period hatched */
  function salesPoints(slots, period, deps) {
    return (slots || []).map(function (slot) {
      var words = keyWords(slot.key, period, deps),
        lastYear = slot.last_year || {};
      return {
        key: slot.key,
        label: words.label,
        value: slot.gross_minor,
        line: lastYear.gross_minor,
        hatch: !!(slot.coverage && (slot.coverage.partial || slot.coverage.short)),
        title: words.title + ' · ' + (slot.gross_minor === null ? deps.tx('missing') : moneyOrDash(slot.gross_minor, deps)),
        lineTitle: deps.tx('Last year') + ' · ' + moneyOrDash(lastYear.gross_minor, deps)
      };
    });
  }
  /** the same figures as a table (newest first) */
  function salesTable(slots, period, deps) {
    return {
      head: [deps.tx('Period'), deps.tx('Sales'), deps.tx('Last year')],
      rows: (slots || []).slice().reverse().map(function (slot) {
        return [keyWords(slot.key, period, deps).title, moneyOrDash(slot.gross_minor, deps), moneyOrDash((slot.last_year || {}).gross_minor, deps)];
      })
    };
  }

  /** /dues aged_totals[side] → hbars rows by age (not due first); a side the server did not send (null) → no rows */
  function duesRows(answer, side, deps) {
    var totals = answer && answer.aged_totals && answer.aged_totals[side];
    if (!totals) return { rows: [], table: { head: [], rows: [] } };
    var rows = DUE_KEYS.map(function (pair) {
      var value = totals[pair[0]] === undefined ? null : totals[pair[0]];
      return { label: deps.tx(pair[1]), value: value, words: moneyOrDash(value, deps), title: deps.tx(pair[1]) + ' · ' + moneyOrDash(value, deps), hatch: pair[2] };
    });
    return {
      rows: rows,
      table: {
        head: [deps.tx('Age'), deps.tx('Amount')],
        rows: rows.map(function (row) {
          return [row.label, row.words];
        })
      }
    };
  }

  /** /pl by_line heads (income then expense) → compare rows in money mode: this year against last; the server's change_bp becomes the printed percent only by unit (bp → %) */
  function plRows(answer, deps) {
    var by = (answer && answer.by_line) || {},
      rows = [];
    [
      ['income', 'Income'],
      ['expense', 'Expense']
    ].forEach(function (side) {
      (by[side[0]] || []).forEach(function (head) {
        var change = head.change_bp === null || head.change_bp === undefined ? null : head.change_bp / 100;
        rows.push({
          label: head.label || head.line,
          now: head.amount_minor,
          before: head.prior_minor,
          changePct: change,
          title: deps.tx(side[1]) + ' · ' + (head.label || head.line) + ' · ' + moneyOrDash(head.amount_minor, deps) + ' · ' + deps.tx('Last year') + ' ' + moneyOrDash(head.prior_minor, deps),
          side: side[0]
        });
      });
    });
    return {
      rows: rows,
      table: {
        head: [deps.tx('Line'), deps.tx('This year'), deps.tx('Last year')],
        rows: rows.map(function (row) {
          return [row.label, moneyOrDash(row.now, deps), moneyOrDash(row.before, deps)];
        })
      }
    };
  }

  /** /cashflow series → cashLine points; the lowest day is the SERVER's (lowest.date) found by key, never searched for by value */
  function cashPoints(answer, deps) {
    var series = (answer && answer.series) || [],
      lowest = answer && answer.lowest,
      points = series.map(function (day) {
        return { label: String(day.date || '').slice(5), value: day.balance_minor, title: day.date + ' · ' + moneyOrDash(day.balance_minor, deps) };
      }),
      at = lowest ? series.findIndex(function (day) { return day.date === lowest.date; }) : -1,
      end = series.length ? series[series.length - 1] : null;
    return {
      points: points,
      lowestAt: at,
      startWords: series.length ? moneyOrDash(series[0].balance_minor, deps) : '',
      endWords: end ? moneyOrDash(end.balance_minor, deps) : '',
      lowestWords: lowest ? moneyOrDash(lowest.balance_minor, deps) : '',
      table: {
        head: [deps.tx('Day'), deps.tx('Balance')],
        rows: series.map(function (day) {
          return [day.date, moneyOrDash(day.balance_minor, deps)];
        })
      }
    };
  }

  /** /overview bars[12] → bars points: this month solid (the running one hatched), the same month last year the dashed line; a month the server did not read is an empty tick */
  function monthPoints(list, deps) {
    return (list || []).map(function (item) {
      var name = monthWords(String(item.from).slice(0, 7), 'long', deps) + (item.running ? ' · ' + deps.tx('so far') : '');
      return {
        key: item.from,
        label: monthWords(String(item.from).slice(0, 7), 'short', deps),
        value: item.sold_minor === undefined ? null : item.sold_minor,
        line: item.last_year_minor === undefined ? null : item.last_year_minor,
        hatch: !!item.running,
        title: name + ' · ' + moneyOrDash(item.sold_minor, deps),
        lineTitle: deps.tx('Last year') + ' · ' + moneyOrDash(item.last_year_minor, deps)
      };
    });
  }
  function monthTable(list, key, deps, withLast) {
    return {
      head: withLast ? [deps.tx('Month'), deps.tx('Sales'), deps.tx('Last year')] : [deps.tx('Month'), deps.tx('Profit')],
      rows: (list || []).map(function (item) {
        var name = monthWords(String(item.from).slice(0, 7), 'long', deps) + (item.running ? ' ' + deps.tx('(so far)') : '');
        return withLast ? [name, moneyOrDash(item[key], deps), moneyOrDash(item.last_year_minor, deps)] : [name, moneyOrDash(item[key], deps)];
      })
    };
  }
  /** /overview profit_by_month[12] → bars points (no last-year line: the server sends none) */
  function profitPoints(list, deps) {
    return (list || []).map(function (item) {
      var p = monthPoints([{ from: item.from, running: item.running, sold_minor: item.profit_minor }], deps)[0];
      p.line = null;
      return p;
    });
  }
  /** /overview weekdays[7] → bars points: this ISO week by weekday, the same week last year the dashed line; a day not yet come (or with no sale) is an empty tick */
  function weekdayWords(day, form, deps) {
    var at = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    return at ? deps.date(Date.UTC(+at[1], +at[2] - 1, +at[3]), { weekday: form }) : day;
  }
  function weekdayPoints(days, deps) {
    return (days || []).map(function (item) {
      var name = weekdayWords(item.day, 'long', deps);
      return {
        key: item.day,
        label: weekdayWords(item.day, 'short', deps),
        value: item.sold_minor,
        line: item.last_year_minor,
        hatch: false,
        title: name + ' · ' + moneyOrDash(item.sold_minor, deps),
        lineTitle: deps.tx('Last year') + ' · ' + moneyOrDash(item.last_year_minor, deps)
      };
    });
  }
  function weekdayTable(days, deps) {
    return {
      head: [deps.tx('Day'), deps.tx('Sales'), deps.tx('Last year')],
      rows: (days || []).map(function (item) {
        return [weekdayWords(item.day, 'long', deps), moneyOrDash(item.sold_minor, deps), moneyOrDash(item.last_year_minor, deps)];
      })
    };
  }

  var misCharts = { keyWords: keyWords, salesPoints: salesPoints, salesTable: salesTable, duesRows: duesRows, plRows: plRows, cashPoints: cashPoints, monthPoints: monthPoints, monthTable: monthTable, profitPoints: profitPoints, weekdayPoints: weekdayPoints, weekdayTable: weekdayTable };
  if (typeof module !== 'undefined' && module.exports) module.exports = misCharts;
  if (root) root.MC = misCharts;
})(typeof window !== 'undefined' ? window : globalThis);
