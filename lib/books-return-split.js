/**
 * books-return-split.js — what each ledger adds to a return's box (ACC-357, W15-103b): "6 ledgers ▸" opens a panel, one line per ledger with ITS amount for the period.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      splitBoxes(returnFor, pack, period, rows, opts, boxes) → boxes with `accounts` sorted largest first, each { code, name, amount_minor, tax_minor }, cut to the top TOP, with accounts_n · accounts_more_n · split_ok
 * CALLED BY lib/books-period.taxReturn
 * CARD      14-accounting/README
 * ⭐ ONE CALCULATION: a ledger's figure is the ENGINE's own box answer (gst-returns.returnFor) over that ledger's rows alone — no formula here. `split_ok` compares two CARRIED totals (the ledgers' sum against the box) and says so; it never recomputes the box.
 */
'use strict';
const TOP = 10; /* the panel shows ten, then "and n more": a shop with hundreds of ledgers is never sent whole */

const sizeOf = (item) => Math.abs(Number(item.amount_minor != null ? item.amount_minor : item.tax_minor || 0));
const sumOf = (list, key, currency) => require('./books-money-ops').sumMinor(list, currency, (item) => item[key]); /* the engine's plusMoney, in the return's currency (CUR-1) */

/** the ledgers behind each box of a return: one line per ledger, largest first, the top few and "and n more" (see the header) */
function splitBoxes(returnFor, pack, period, rows, opts, boxes, currency) {
  const codes = new Set();
  boxes.forEach((box) => box.accounts.forEach((item) => codes.add(String(item.code))));
  const answers = new Map();
  codes.forEach((code) => {
    const filed = returnFor(pack, period, rows.filter((row) => String(row.code) === code), opts);
    answers.set(code, filed && filed.ok ? filed.boxes : []);
  });
  return boxes.map((box) => {
    const all = box.accounts
      .map((item) => {
        const mine = (answers.get(String(item.code)) || []).find((x) => x.code === box.code) || {};
        return { code: item.code, name: item.name, amount_minor: mine.amount_minor == null ? null : mine.amount_minor, tax_minor: mine.tax_minor == null ? null : mine.tax_minor };
      })
      .sort((a, b) => sizeOf(b) - sizeOf(a) || String(a.code).localeCompare(String(b.code)));
    const same = (key) => box[key] == null || sumOf(all, key, currency) === box[key];
    return Object.assign({}, box, { accounts: all.slice(0, TOP), accounts_n: all.length, accounts_more_n: Math.max(0, all.length - TOP), split_ok: same('amount_minor') && same('tax_minor') });
  });
}

module.exports = { splitBoxes, TOP };
