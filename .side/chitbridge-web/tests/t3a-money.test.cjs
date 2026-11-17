'use strict';
/* T3a (M141 · M137 · M136 · M132 · M148-late-count): the money rules, run as the page runs them — functions lifted whole from the page source, no browser.
   Run: node tests/t3a-money.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = (f) => fs.readFileSync(__dirname + '/../public/app/' + f, 'utf8');
/** a top-level `function name(` with its body, by brace matching */
function fn(text, name) {
  const i = text.indexOf('function ' + name + '('); assert(i >= 0, name + ' is in the source');
  let d = 0, j = text.indexOf('{', i);
  for (let k = j; k < text.length; k++) { if (text[k] === '{') d++; else if (text[k] === '}' && --d === 0) return text.slice(i, k + 1); }
  throw new Error('unbalanced ' + name);
}
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

/* ── M141: Add missing posts against the ledger the statement belongs to (FIN-117: the in-app Bank sheet, cap-bank-sheet.js bkshModeOf, swaps the fixed "bank" of an entry for the statement's own ledger) ── */
const bank = src('cap-bank.js'), sheet = src('cap-bank-sheet.js');
const book = { acct: '1520', accts: [{ code: '1500', role: 'bank' }, { code: '1520', role: 'card' }, { code: '1530', role: null }] };
const cx = vm.createContext({ bkshBook: () => book });
vm.runInContext(fn(bank, 'bkbModeOf') + fn(sheet, 'bkshModeOf'), cx);
const charge = { paid_from: 'bank', into: undefined, from: undefined, to: undefined };
ok(cx.bkshModeOf(charge).paid_from === 'card', 'M141: a bank charge on the Card settlements statement (1520) is paid from card — Cr 1520, not Bank 1500');
book.acct = '1500';
ok(cx.bkshModeOf(charge).paid_from === 'bank', 'M141: the same charge on the Bank statement still posts to Bank');
book.acct = '1530';
ok(cx.bkshModeOf(charge) === charge, 'M141: a ledger with no payment mode is never guessed — the entry is left as it came');
book.acct = '1520';
const contra = cx.bkshModeOf({ from: 'bank', to: 'cash' });
ok(contra.from === 'card' && contra.to === 'cash', 'M141: a contra suggestion takes the statement mode in place of the fixed bank');

/* ── M137: a supplier with a Dr balance is an advance, never under To pay ── */
const books = src('cap-books.js'), cb = vm.createContext({});
vm.runInContext(fn(books, 'bkDuesSide') + fn(books, 'bkDuesAdvance'), cb);
const paidAhead = { side: 'supplier', balance_minor: 200 }, owed = { side: 'supplier', balance_minor: -5000 }, cust = { side: 'customer', balance_minor: 900 };
ok(cb.bkDuesAdvance(paidAhead) === true && cb.bkDuesAdvance(owed) === false && cb.bkDuesAdvance(cust) === false, 'M137: only a supplier with a Dr balance is an advance');
ok(cb.bkDuesSide(paidAhead) === 'pay', 'M137: the ledger tree still files the supplier under suppliers (bkDuesSide unchanged)');

/* ── M136/M139/M132/M138: the words and the doors are in the source the page runs ── */
ok(/Nobody owes you money/.test(books) && /You owe nobody/.test(books), 'M136: the empty sides say "Nobody owes you money" / "You owe nobody"');
/* l16 needsyou (90b30d51): the Needs filter is on every list; only the Side chip is left off a page's own side */
ok(/filters: bkNeedFilters\(\)\.concat\(bkDuesSideFilter\(onlySide\)\)/.test(books) && /function bkDuesSideFilter\(onlySide\) \{\s*return \(onlySide\s*\?\s*\[\]/.test(books), 'M136: a page\'s own side is not a filter chip');
ok(/These filters match nothing here/.test(src('list-ctl.js')) && !/These filters'\) \+ ' '\) \+ esc\(T\(I, 'matches/.test(src('list-ctl.js')), 'M136: "These filters match nothing here" (grammar)');
const acc = fs.readFileSync(__dirname + '/../public/accounts.html', 'utf8');
ok(/\['bills', 'Unpaid bills'/.test(acc), 'M139: the menu says "Unpaid bills"');
ok(/addEventListener\('hashchange'/.test(acc), 'M138: the # decides the page — hashchange is listened to');
ok(/bkDayBillsLink\(s, tid\)/.test(books) && /function bkDayBillsOpen/.test(books), 'M132: a walk-in day\'s "N bills" opens the bills it covers');
const bank2 = bank + src('cap-bank-rows.js'); /* the statement rows moved to cap-bank-rows.js (17 Nov split) */ ok(/tx\((?:r|line)\.in \? 'In' : 'Out'\)/.test(bank2) && !/'Dr' : 'Cr'\)\) \}/.test(bank2), 'M142: bank lines say In / Out');
console.log('\n  ' + n + ' checks');
