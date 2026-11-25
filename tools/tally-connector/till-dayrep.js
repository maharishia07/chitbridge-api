/* app/till-dayrep.js — THE DAY REPORT'S AGGREGATION AND TABLES, a part of the till page (till.html) kept in its own file to hold the page's size row (2026-11-28; no behaviour changed).
 * Classic script, shared global scope with till.html: it reads the page's own money(), rmoney(), r2(), esc(), hhmm(), bohniOf(), schemeWord(), isReturnRow() and CBTax at call time.
 *
 * OWNER     cb-counter (the till)
 * RISK      money (the day's takings as the owner reads them)
 * OWNS      dayRepCount · dayRepRows (+ dayRepAddKinds · dayRepAddLines · dayRepAddRates · dayRepAddPays) · dayRepTable · dayRepSummary · dayRepOutByHow · dayRepSumOf ·
 *           dayRepPayTable · dayRepRateTable · dayRepKindTable · dayRepItemsTable · dayRepBillsTable · dayRepReturnsTable · dayRepExpensesTable · dayRepBusiestHour · dayRepFoot
 * CALLED BY till.html's dayReportHTML (the day report, [TILL-40]); loaded by <script src="/app/till-dayrep.js"> after the engines and before the page's main script
 * FLOW      the day's stored bills ──▶ dayRepRows (sums as issued) ──▶ the tables ──▶ dayReportHTML lays them out ──▶ screen or paper
 * CARD      02-counter-till/day-report
 *
 * ⚠️ MASTER: this file in the api kit (tools/tally-connector/till-dayrep.js); scripts/vendor-till.cjs copies it to web public/app/till-dayrep.js and the service worker shelves it.
 */
/** ⚠️ "1 bills" reads as a machine talking. One helper, so no table here ever has to remember. */
function dayRepCount(n, one, many){ return n + ' ' + (n === 1 ? one : many); }
/** U-F-02 · the rate-wise figures a bill counts in the day, with a RETURN's taken back: a credit note's by_rate is negative whatever shape it
    arrived in (the server's read may drop the sign or carry the original's), so the day nets it against the sales' rows and equals the books. Answers { rate: { taxable, tax } } or null. */
function dayRateFigures(bill, issuedRates){
  var src = (isReturnRow(bill) ? null : issuedRates) || (bill && bill.by_rate) || null;
  if (!src || !Object.keys(src).length) return null;
  var sign = isReturnRow(bill) ? -1 : 1, out = {};
  Object.keys(src).forEach(function(rate){
    var v = src[rate] || {}, taxable = Number(v.taxable != null ? v.taxable : v.base) || 0, tax = Number(v.tax) || 0;
    out[rate] = sign < 0 ? { taxable: -Math.abs(taxable), tax: -Math.abs(tax) } : { taxable: taxable, tax: tax };
  });
  return out;
}
function dayRepRows(bills){
  var sums = { items: {}, byRate: {}, byPay: {}, payBills: {}, byKind: {}, namedKind: false };
  bills.forEach(function(b){
    var issuedRates = dayRepAddKinds(sums, b);   /* Q-F-07 · the per-rate figures the BOOKS read: the invoice's own, not the bill header's second rounding */
    dayRepAddLines(sums.items, b);
    dayRepAddRates(sums.byRate, b, issuedRates);
    dayRepAddPays(sums, b);
  });
  return { items: sums.items, byRate: sums.byRate, byPay: sums.byPay, payBills: sums.payBills, byKind: sums.namedKind ? sums.byKind : null };
}
/** the rate-wise figures the invoice was issued with (its by_rate), or null when it carries none */
function dayRepIssuedRates(figures){
  return figures && figures.by_rate && Object.keys(figures.by_rate).length ? figures.by_rate : null;
}
/** the invoice's own by_kind rows, else its by_rate read as standard-kind rows, else none */
function dayRepKindRows(figures){
  if (figures && figures.by_kind) return figures.by_kind;
  if (!(figures && figures.by_rate)) return [];
  return Object.keys(figures.by_rate).map(function(rt){ return { kind: 'standard', rate: Number(rt), taxable: figures.by_rate[rt].taxable, tax: figures.by_rate[rt].tax }; });
}
/** SUPPLY KIND: the day by kind, from each bill's own invoice (the engine's by_kind), as issued; shown only when some bill named a kind */
function dayRepAddKinds(sums, bill){
  var issuedRates = null;
  try { var invoice = bill.invoice, named = !!(invoice && invoice._cb && invoice._cb.kinds && invoice._cb.kinds.length), figures = (invoice && window.CBTax && CBTax.moneyOf) ? CBTax.moneyOf(invoice) : null;
    if (named) sums.namedKind = true;
    issuedRates = dayRepIssuedRates(figures);
    dayRepKindRows(figures).forEach(function(w){
      var key = w.kind + '|' + w.rate, row = sums.byKind[key] || (sums.byKind[key] = { kind: w.kind, rate: w.rate, taxable: 0, tax: 0 });
      row.taxable = rmoney(row.taxable + (Number(w.taxable) || 0)); row.tax = rmoney(row.tax + (Number(w.tax) || 0)); });
  } catch (e) { cbQuiet('dayRepAddKinds:1', e); /* an old bill with no readable invoice is left out of this table only */ }
  return issuedRates;
}
/** each line of the bill added into the day's item rows: quantity, gross, offers, the line's own tax, net */
function dayRepAddLines(items, bill){
  (bill.lines || []).forEach(function(l){
    if (!l || !l.name) return;
    var k = l.name;
    var r = items[k] || (items[k] = { name: l.name, unit: l.unit || '', qty: 0, gross: 0, off: 0, tax: 0, net: 0 });
    r.qty = r2(r.qty + (Number(l.qty) || 0));
    r.gross = rmoney(r.gross + (Number(l.gross) || 0));
    r.off = rmoney(r.off + (Number(l.save) || 0));
    /* ⭐ THE LINE'S OWN TAX, as it was issued ([TILL-101]). Stored at sale time precisely so a reprint does
       not recompute against today's slabs — and for the same reason this report must not either. A bill
       from before that field existed contributes 0 rather than a guess. */
    r.tax = rmoney(r.tax + (Number(l.tax) || 0));
    r.net = rmoney(r.net + (Number(l.net) || 0));
  });
}
/** ⭐ the rate-wise summary the bill was ISSUED with, not one recomputed from today's slabs */
function dayRepAddRates(byRate, bill, issuedRates){
  var rateSrc = (typeof dayRateFigures === 'function' ? dayRateFigures(bill, issuedRates) : (issuedRates || bill.by_rate)) || {};   /* typeof: a harness that lifts functions by name still runs */
  Object.keys(rateSrc).forEach(function(rate){
    var v = rateSrc[rate] || {};
    var r = byRate[rate] || (byRate[rate] = { rate: rate, taxable: 0, tax: 0 });
    r.taxable = rmoney(r.taxable + (Number(v.taxable) || 0));
    r.tax = rmoney(r.tax + (Number(v.tax) || 0));
  });
}
/** how the bill was paid: the amount per way, and the count of bills that used each way (a way counted once per bill) */
function dayRepAddPays(sums, bill){
  var seen = {};
  (bill.payments || []).forEach(function(pmt){
    var how = String(pmt.how || 'cash');
    sums.byPay[how] = rmoney((sums.byPay[how] || 0) + (Number(pmt.amount) || 0));
    if (!seen[how]) { sums.payBills[how] = (sums.payBills[how] || 0) + 1; seen[how] = 1; }
  });
}
/** one table, one shape — a heading, columns, rows, and a total line when there is one */
function dayRepTable(title, cols, rows, foot){
  if (!rows.length) return '';
  return '<section class="drsec"><h3>' + esc(title) + '</h3><table class="drt"><thead><tr>'
    + cols.map(function(c){ return '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>'; }).join('')
    + '</tr></thead><tbody>'
    /* ⭐ data-h is the column's own name, used ONLY when a 72mm slip folds the row ([TILL-101]). On screen it
       costs nothing; on paper it is the difference between four figures and four LABELLED figures. */
    + rows.map(function(r){ return '<tr>' + r.map(function(cell, n){
        return '<td' + (cols[n] && cols[n].num ? ' class="num"' : '')
          + ' data-h="' + esc((cols[n] && cols[n].label) || '') + '">' + cell + '</td>'; }).join('') + '</tr>'; }).join('')
    + '</tbody>'
    + (foot ? '<tfoot><tr>' + foot.map(function(cell, n){
        return '<td' + (cols[n] && cols[n].num ? ' class="num"' : '') + '>' + cell + '</td>'; }).join('') + '</tr></tfoot>' : '')
    + '</table></section>';
}
/** the day's first table — bills, items, average, offers, taxable, tax, Net sales. ⭐ TILL-B2: and the cash rounding the bills took (AU · MY,
    each bill's cash_round), so Net sales plus it is what "How the money moved" totals */
function dayRepSummary(figures){
  var rounded = figures.bills.reduce(function(sum, bill){ return rmoney(sum + (Number(bill.cash_round) || 0)); }, 0);
  var rows = [['Bills', String(figures.count)], ['Items sold', String(figures.qty)], ['Average bill', figures.count ? money(rmoney(figures.total / figures.count)) : '\u2014'],
    ['Taken off by offers', figures.saved ? '\u2212' + money(figures.saved) : money(0)], ['Sales before tax', money(figures.taxable)], ['Tax', money(figures.tax)]];
  /* U-F-02 · the returns line: sales before tax and Tax above are NET of these, so the sheet says what came off */
  var backs = figures.bills.filter(isReturnRow), backTaxable = backs.reduce(function(a, x){ return rmoney(a + Math.abs(Number(x.taxable) || 0)); }, 0),
      backTax = backs.reduce(function(a, x){ return rmoney(a + Math.abs(Number(x.tax) || 0)); }, 0);
  if (backs.length) rows.push(['Returns (' + dayRepCount(backs.length, 'credit note', 'credit notes') + '), before tax and tax', '−' + money(backTaxable) + ' · −' + money(backTax)]);
  if (rounded) rows.push(['Cash rounding', (rounded > 0 ? '+' : '') + money(rounded)]);
  return dayRepTable('The day', [{ label: 'What' }, { label: 'Figure', num: true }], rows,
    ['<b>Net sales</b>', '<b data-testid="till-dayrep-netsales">' + money(figures.total) + '</b>']);
}
/** what went back (credit notes) or out (expenses) per payment method: sums the rows' list (refunds or spent) by the way it was paid */
function dayRepOutByHow(rows, listKey){
  var out = {};
  rows.forEach(function(b){ (b[listKey] || []).forEach(function(x){ if (x && x.how) out[x.how] = rmoney((out[x.how] || 0) + Math.abs(Number(x.amount) || 0)); }); });
  return out;
}
/** the sum of a method-to-amount map */
function dayRepSumOf(byHow){ return Object.keys(byHow).reduce(function(a, k){ return rmoney(a + byHow[k]); }, 0); }
/**
 * ⚠️⚠️ THE SHEET RECONCILES TO ITSELF (2026-09-28, M11). "How it was paid" summed only money TAKEN, so it was
 * gross of refunds while "Net sales" above it was net: ₹4,600 over ₹5,000 with nothing saying the two were on
 * different bases. Each method now shows what was taken, what went back (credit notes) and what was paid out
 * (expenses), and its net — and the net total is the Net sales figure, to the paisa.
 */
function dayRepPayTable(dayFigures, back, spent){
  var outBack = dayRepOutByHow(back, 'refunds'), outPaid = dayRepOutByHow(spent, 'spent');
  var hows = {}; [dayFigures.byPay, outBack, outPaid].forEach(function(o){ Object.keys(o).forEach(function(k){ hows[k] = 1; }); });
  var payRows = Object.keys(hows).sort().map(function(how){
    var inn = dayFigures.byPay[how] || 0, bk = outBack[how] || 0, pd = outPaid[how] || 0;
    return [esc(how.charAt(0).toUpperCase() + how.slice(1)), String(dayFigures.payBills[how] || 0), money(inn),
            bk ? '−' + money(bk) : '', pd ? '−' + money(pd) : '', money(rmoney(inn - bk - pd))];
  });
  var payTotal = rmoney(dayRepSumOf(dayFigures.byPay) - dayRepSumOf(outBack) - dayRepSumOf(outPaid));
  return dayRepTable('How the money moved', [{ label: 'Method' }, { label: 'Bills', num: true }, { label: 'Taken', num: true },
    { label: 'Given back', num: true }, { label: 'Paid out', num: true }, { label: 'Net', num: true }],
    payRows, ['<b>Total</b>', '', '<b>' + money(dayRepSumOf(dayFigures.byPay)) + '</b>', dayRepSumOf(outBack) ? '<b>−' + money(dayRepSumOf(outBack)) + '</b>' : '',
              dayRepSumOf(outPaid) ? '<b>−' + money(dayRepSumOf(outPaid)) + '</b>' : '', '<b data-testid="till-dayrep-net">' + money(payTotal) + '</b>']);
}
/** "Tax by rate": one row per rate, halved for the two heads only under a state-split pack, with the total line when there are rows */
function dayRepRateTable(dayFigures, taxable, taxTotal){
  var rateRows = Object.keys(dayFigures.byRate).sort(function(a, b){ return Number(a) - Number(b); }).map(function(k){
    var r = dayFigures.byRate[k];
    /* ⚠️ HALVED FOR THE TWO HEADS, NOT RECOMPUTED — the bill recorded the total tax at this rate.
       CX0: only under a state-split pack (India); a one-head scheme (GST in Australia, VAT in the UAE) has one Tax column, never two invented halves */
    var cg = rmoney(r.tax / 2);   /* Q-F-07 · the second head is the remainder, so an odd paisa never makes the two halves overshoot the row */
    return packSplitsByState() ? [esc(k) + '%', money(r.taxable), money(cg), money(rmoney(r.tax - cg)), money(r.tax)]
                               : [esc(k) + '%', money(r.taxable), money(r.tax)];
  });
  return packSplitsByState()
    ? dayRepTable('Tax by rate', [{ label: 'Rate' }, { label: 'Taxable', num: true },
        { label: 'CGST', num: true }, { label: 'SGST', num: true }, { label: 'Tax', num: true }], rateRows,
        rateRows.length ? ['<b>Total</b>', '<b>' + money(taxable) + '</b>', '', '', '<b>' + money(taxTotal) + '</b>'] : null)
    : dayRepTable(schemeWord() + ' by rate', [{ label: 'Rate' }, { label: 'Taxable', num: true }, { label: schemeWord(), num: true }], rateRows,
        rateRows.length ? ['<b>Total</b>', '<b>' + money(taxable) + '</b>', '<b>' + money(taxTotal) + '</b>'] : null);
}
/** SUPPLY KIND: "Sales by kind" - one row per kind and rate, the pack's own word; a 0% with no kind reads "0%, kind not said" */
function dayRepKindTable(dayFigures){
  var kindRows = !dayFigures.byKind ? [] : Object.keys(dayFigures.byKind).sort().map(function(k){
    var w = dayFigures.byKind[k], word = w.kind !== 'standard' ? kindWord(w.kind) : (Number(w.rate) ? w.rate + '%' : '0%, kind not said');
    return [esc(word), money(w.taxable), money(w.tax)];
  });
  return dayRepTable('Sales by kind', [{ label: 'Kind' }, { label: 'Sales before tax', num: true }, { label: schemeWord(), num: true }], kindRows);
}
/** "Everything sold": one row per item, by value top to bottom, with the totals line */
function dayRepItemsTable(dayFigures, soldQty, total){
  /* ⭐ GROSS · OFFERS · TAX · NET, in that order ([TILL-101]) — Athi named the four, and they read left to
     right as the arithmetic happens: what it listed at, what came off, what the state takes, what is left. */
  var soldRows = Object.keys(dayFigures.items).map(function(k){ return dayFigures.items[k]; })
    .sort(function(a, b){ return b.net - a.net; });          /* by VALUE, top to bottom */
  var taxSold = soldRows.reduce(function(a, r){ return rmoney(a + r.tax); }, 0);
  var offSold = soldRows.reduce(function(a, r){ return rmoney(a + r.off); }, 0);
  var grossSold = soldRows.reduce(function(a, r){ return rmoney(a + r.gross); }, 0);
  var sold = soldRows.map(function(r){ return [esc(r.name), esc(r.unit), String(r.qty), money(r.gross),
                              r.off ? '−' + money(r.off) : '', r.tax ? money(r.tax) : '', money(r.net)]; });
  return dayRepTable('Everything sold', [{ label: 'Item' }, { label: 'Unit' }, { label: 'Qty', num: true },
    { label: 'Gross', num: true }, { label: 'Offers', num: true }, { label: 'Tax', num: true },
    { label: 'Net', num: true }], sold,
    ['<b>' + dayRepCount(sold.length, 'product', 'products') + '</b>', '', '<b>' + soldQty + '</b>',
     '<b>' + money(grossSold) + '</b>', offSold ? '<b>−' + money(offSold) + '</b>' : '',
     taxSold ? '<b>' + money(taxSold) + '</b>' : '', '<b>' + money(total) + '</b>']);
}
/** "Every bill": one row per sale (not returns or expenses) with its time, customer, item count and way of paying */
function dayRepBillsTable(bills, saleCount, soldQty, total){
  var billRows = (bills || []).filter(function(b){ return !isReturnRow(b) && !isExpenseRow(b); }).map(function(b){
    var ct = (b.lines || []).reduce(function(a, l){ return r2(a + (Number(l.qty) || 0)); }, 0);
    var how = (b.payments || []).map(function(x){ return x.how; }).filter(Boolean).join(' + ') || '—';
    return [esc(String(b.no || '')), esc(hhmm(b.at)), esc(((b.customer || {}).name) || 'Walk-in'),
            String(ct), esc(how), money(Number(b.total) || 0)];
  });
  return dayRepTable('Every bill', [{ label: 'No' }, { label: 'Time' }, { label: 'Customer' },
    { label: 'Items', num: true }, { label: 'Paid', num: true }, { label: 'Total', num: true }], billRows,
    ['<b>' + dayRepCount(saleCount, 'bill', 'bills') + '</b>', '', '', '<b>' + soldQty + '</b>', '', '<b>' + money(total) + '</b>']);
}
/** "Returns": one row per credit note, with what was given back */
function dayRepReturnsTable(back){
  var returned = back.reduce(function(a, b){ return rmoney(a + Math.abs(Number(b.total) || 0)); }, 0);
  return dayRepTable('Returns', [{ label: 'Credit note' }, { label: 'Against' }, { label: 'Why' },
    { label: 'Given back', num: true }],
    back.map(function(b){
      return [esc(String(b.no || '')), esc(((b.against || {}).bill_no) || ''),
              esc(b.reason_words || b.reason || ''), money(Math.abs(Number(b.total) || 0))];
    }),
    back.length ? ['<b>' + dayRepCount(back.length, 'credit note', 'credit notes') + '</b>', '', '',
                   '<b>' + money(returned) + '</b>'] : null);
}
/** "Expenses" ⭐ [till expenses]: the identical table, one column short — an expense has no "against" bill and no GST reason, just what it was for and which tender it left. */
function dayRepExpensesTable(spent){
  var expensedT = spent.reduce(function(a, b){ return rmoney(a + Math.abs(Number(b.total) || 0)); }, 0);
  return dayRepTable('Expenses', [{ label: 'No' }, { label: 'What' }, { label: 'Paid by' },
    { label: 'Amount', num: true }],
    spent.map(function(b){
      var how = (b.spent || []).map(function(x){ return x.how; }).filter(Boolean).join(' + ') || '—';
      return [esc(String(b.no || '')), esc(b.what || ''), esc(how), money(Math.abs(Number(b.total) || 0))];
    }),
    spent.length ? ['<b>' + dayRepCount(spent.length, 'expense', 'expenses') + '</b>', '', '',
                    '<b>' + money(expensedT) + '</b>'] : null);
}
/** the hour with most bills, or undefined when no bill has a time */
function dayRepBusiestHour(bills){
  var hours = {};
  bills.forEach(function(b){ var hs = hhmm(b.at), h = Number(hs.slice(0, 2)); if (hs && isFinite(h)) hours[h] = (hours[h] || 0) + 1; });
  return Object.keys(hours).sort(function(a, b){ return hours[b] - hours[a]; })[0];
}
/** the foot of the sheet: the first sale of the day, the busiest hour, and the sold-not-stock warning */
function dayRepFoot(bills, saleCount){
  var bohni = bohniOf(bills);
  var busiest = dayRepBusiestHour(bills);
  return '<footer class="drfoot">'
    + '<div><b>Bohni</b> — ' + (bohni
        ? esc(String(bohni.no || '')) + ' at ' + esc(hhmm(bohni.at)) + ', ' + money(Number(bohni.total) || 0)
        : 'the first sale of the day is still to come') + '</div>'
    + (busiest != null && saleCount > 1 ? '<div><b>Busiest hour</b> — ' + String(busiest).padStart(2, '0')
        + ':00–' + String((Number(busiest) + 1) % 24).padStart(2, '0') + ':00</div>' : '')
    + '<div class="drwarn">This counter counts what was SOLD; it does not hold stock figures.</div>'
    + '</footer>';
}
