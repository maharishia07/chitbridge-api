/**
 * tests/sheets-links.test.cjs — the nav-map link bugs of 18 Oct (RAIL-86 · ORD-62 · UX-93 · UX-94 · FIN-29 · ACC-175).
 * UX-93: the header chip and the page read the SAME address word (Finance: "#payables" and "#/payables"; Tasks: Disputes has its own row).
 * Run: node tests/sheets-links.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const P = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').replace(/\r\n/g, '\n');
globalThis.window = globalThis;
globalThis.location = { hash: '' };
globalThis.document = { addEventListener() {}, getElementById: () => null };
globalThis.addEventListener = () => {};
globalThis.esc = (s) => String(s);
eval(P('app/screen-id.js'));
const SID = globalThis.CBScreenId;

/* UX-93 · Finance: the tab finTab() decides is the row the chip names, for both address spellings and an unknown word */
const src = P('app/cap-finance-terms.js');
const a = src.indexOf('var FIN_TABS'), b = src.indexOf('function ftNav');
assert(a > 0 && b > a, 'finTab is found');
const finTab = new Function('location', src.slice(a, b) + '; return finTab;');
const TAB_ROW = { collect: 'collections', pay: 'payables', cheques: 'cheques', cash: 'cash', terms: 'terms', repeat: 'repeat', returns: 'returns', reports: 'reports' };
['collections', 'payables', 'cheques', 'cash', 'terms', 'repeat', 'returns', 'reports', 'nonsense', ''].forEach((w) => {
  ['#/' + w, '#' + w, '#/' + w + '?x=1'].forEach((h) => {
    const loc = { hash: h }, tab = finTab(loc)();
    SID.here('finance', null); globalThis.location = loc;
    const chip = SID.row('finance', null);
    assert.strictEqual(chip.key, TAB_ROW[tab], h + ': the chip (' + chip.key + ') names the tab shown (' + tab + ')');
  });
});
assert.strictEqual(finTab({ hash: '#payables' })(), 'pay', '#payables (no slash) now opens Payables');

/* UX-93 · Tasks: Disputes and Assist have their own rows (the chip fell back to "Orders in") */
globalThis.location = { hash: '' };
assert.strictEqual(SID.row('tasks', 'disputes').screen, 'Disputes');
assert.strictEqual(SID.row('tasks', 'assist').screen, 'Assist');
assert.strictEqual(SID.row('tasks', 'orders_in').screen, 'Orders in');

/* ACC-175 · every view of the Accounts NAV has a menu button; Dues is one; Waiting is retired (DECISIONS 2026-10 line 397): no button, no badge, an old link lands on To do */
const acc = P('accounts.html'), shell = P('app/accounts-shell.js');
const groups = acc.slice(acc.indexOf('const NAV_GROUPS'), acc.indexOf('const navFolded'));
assert(/'dues'/.test(groups), 'dues is in a menu group');
assert(!/'waiting'/.test(groups) && !/acc-waiting-n/.test(acc) && acc.indexOf("['waiting', 'Waiting'") < 0, 'Waiting has no button and no badge');
/* the To do notices open real places, never a tap that does nothing: bills to accept -> Received bills; suppliers to add -> the CRM supplier list */
const books = P('app/cap-books.js');
/* iter1: the pass wraps lines and renames locals, so the source checks compare without comments and whitespace */
const flat = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');

assert(flat(acc).includes(flat("accept: () => { ACC.billTab = 'B-2100'; show('bills'); }")), 'accept opens the Received bills');
assert(flat(acc).includes(flat('supplier: () => { location.href = CB_HOMES.suppliers; }')) && shell.indexOf("suppliers: '/crm.html#/parties?role=supplier'") >= 0, 'suppliers to add opens the CRM supplier list');
assert(acc.indexOf("waiting: 'waiting'") >= 0 && acc.indexOf('waiting: (body)') < 0, 'the failed-posting list stays reachable from its To do row only');
assert(books.split("bkNoticeGo('accept')").length === 2 && books.indexOf("bkNoticeGo('supplier')") >= 0 && flat(books).includes(flat("text: todoCounts.waiting + ' ' + tx('waiting to be recorded'), onOpen: function () { bkTab('waiting')")), 'accept and supplier go through bkNoticeGo; waiting keeps its list');
const navIds = [...acc.slice(acc.indexOf('const NAV = ['), acc.indexOf('const KURAL_OF')).matchAll(/^\s*\['(\w+)', '/gm)].map((m) => m[1]);
navIds.forEach((id) => assert(new RegExp("'" + id + "'").test(groups), 'NAV view ' + id + ' has a menu button'));

/* FIN-29 · Returns points at a view that exists */
assert(/href="\/accounts\.html#gstclose"/.test(P('app/cap-finance-returns.js')) && !/accounts\.html#gst"/.test(P('app/cap-finance-returns.js')));
assert(navIds.indexOf('gstclose') >= 0, 'Accounts has #gstclose');

/* RAIL-86 / ORD-62 · the Dispute button has somewhere to go; Tasks opens the chit page, not itself */
const sheet = P('app/chit-sheet.js'), tasks = P('tasks.html');
assert(/function disputePageHref\(id\)/.test(shell) && /disputes: '\/tasks\.html\?view=disputes&chit='/.test(shell));
assert(/disputePageHref\(id\)/.test(sheet) && /Raise a dispute from Tasks/.test(sheet), 'no form here: go to Tasks, or say so');
assert(/window\.openChitPage = function/.test(tasks) && /chitPageHref\(id\)/.test(tasks), 'Tasks has its own Open page');
assert(/q\.get\('chit'\)/.test(tasks) && /CBDispute\.open\(\{ chit_id: chit \}\)/.test(tasks), 'Tasks › Disputes opens the chit');

/* UX-94 · an empty default view is the empty state */
const dp = P('app/cap-dispute.js'), lc = P('app/list-ctl.js');
assert(/presetIsDefault: true/.test(dp) && /When you or the other side raise one on a bill or order, it shows here\./.test(dp));
assert(/o\.presetIsDefault/.test(lc));
console.log('sheets-links: all ok');
