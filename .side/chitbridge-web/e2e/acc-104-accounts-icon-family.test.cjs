/**
 * acc-104-accounts-icon-family.test.cjs — ACC-104 (proof 2026-11-14): the Accounts panel's cards (the menu of accounts.html) use ONE icon family: 24x24 stroke SVG, no emoji.
 * OWNS      the design-guard on the real page: the NAV table (public/accounts.html, lifted out of the script and evaluated in a vm sandbox) gives every view an icon path; each is a plain SVG path in the
 *           24 x 24 box (absolute M/L/H/V coordinates inside 0..24, no non-ASCII character); navItems() draws every one as <svg viewBox="0 0 24 24"><path d=...> and nothing else; every <svg> in the page
 *           is that one 24 box; the page's one svg rule is stroke-only (fill none, stroke currentColor, 1.8 wide, round caps) - the family the nine emoji were replaced by; no emoji in the nav labels.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/acc-104-accounts-icon-family.test.cjs
 *
 * THE HAND CASE: the NAV table lists 26 views: todo, overview (MIS How we are doing, b24803af), daybook, ledgers, tb, pl, bs, compare, receivables, payables, dues, bills, cheques, bank, lock, closingstock, assets, accruals, gstclose, yearclose, packs,
 * opening, accounts, movein, access (books-grant door, bd2f5b55), rates - 26 views, 26 icons, 26 <path> drawn.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

let bad = 0;
const ok = (c, m, why) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (!c && why ? '\n          ' + why : '')); if (!c) bad++; };
const file = 'public/accounts.html';
const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

/* NAV, evaluated from the page's own text: from "const NAV = [" to its closing "];" at column 0 */
const start = src.indexOf('const NAV = [');
const end = src.indexOf('\n];\n', start);
ok(start > 0 && end > start, 'the NAV table is found in accounts.html');
const sb = vm.createContext({});
const NAV = vm.runInContext('(' + src.slice(start + 'const NAV = '.length, end + 2) + ')', sb);
const WANT = ['todo', 'overview', 'daybook', 'ledgers', 'tb', 'pl', 'bs', 'compare', 'receivables', 'payables', 'dues', 'bills', 'cheques', 'bank', 'lock', 'closingstock', 'assets', 'accruals', 'gstclose', 'yearclose', 'packs', 'opening', 'accounts', 'movein', 'access', 'rates'];
ok(JSON.stringify(NAV.map((n) => n[0])) === JSON.stringify(WANT), 'NAV lists the 26 views, in menu order (' + NAV.length + ')', NAV.map((n) => n[0]).join());

const nonAscii = (s) => /[^\x20-\x7e]/.test(s);
const coords = (d) => {
  const bad2 = [];
  for (const m of d.matchAll(/([MLHV])([^MLHVZmlhvzcCsSqQtTaA]*)/g)) {
    const nums = (m[2].match(/-?\d*\.?\d+/g) || []).map(Number);
    nums.forEach((n) => { if (n < 0 || n > 24) bad2.push(m[1] + n); });
  }
  return bad2;
};
const stray = NAV.filter(([id, label, d]) => typeof d !== 'string' || !/^M[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/.test(d) || nonAscii(d));
ok(stray.length === 0, 'every view has a plain SVG path (letters of the path grammar and numbers only, no emoji or other character)', stray.map((n) => n[0]).join());
const outside = NAV.map(([id, , d]) => [id, coords(d)]).filter((x) => x[1].length);
ok(outside.length === 0, 'every absolute M/L/H/V coordinate lies inside the 24 x 24 box', JSON.stringify(outside));
ok(new Set(NAV.map((n) => n[2])).size === NAV.length, 'the icons are distinct drawings, not one reused (' + new Set(NAV.map((n) => n[2])).size + ' distinct of ' + NAV.length + ')');
ok(!NAV.some(([, label]) => nonAscii(label.replace(/[&]/g, ''))), 'no emoji or pictograph in a menu label');

/* the one drawing function */
const draw = liftFns(file, ['navItems']);
const ctx = vm.createContext({ esc: (s) => String(s), tx: (s) => s });
vm.runInContext(draw, ctx);
const html = vm.runInContext('navItems', ctx)(NAV, 'todo');
const svgs = [...html.matchAll(/<svg viewBox="0 0 24 24" aria-hidden="true"><path d="([^"]+)"\/><\/svg>/g)];
ok(svgs.length === NAV.length, 'navItems draws ' + NAV.length + ' icons, each <svg viewBox="0 0 24 24"><path d=...> (found ' + svgs.length + ')');
ok(svgs.every((m, i) => m[1] === NAV[i][2]), 'each drawn path is the NAV path of its view (the carried string, nothing redrawn)');
ok(!/<img|&#x?[0-9a-f]+;|[^\x00-\x7f]/i.test(html), 'the drawn menu holds no <img>, no entity and no emoji');

/* every svg in the page is the same 24 box, and the page's svg rule is the stroke family */
const allSvg = [...src.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]);
ok(allSvg.length >= 3 && allSvg.every((t) => /viewBox="0 0 24 24"/.test(t)), 'every <svg> in the page is viewBox 0 0 24 24 (' + allSvg.length + ' tags)', allSvg.filter((t) => !/viewBox="0 0 24 24"/.test(t)).join(' | '));
const pageRules = src + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public/app/accounts-page.css'), 'utf8'); /* the page's rules live in app/accounts-page.css */
const rule = /(?:^|\n)svg\{([^}]*)\}/.exec(pageRules);
ok(!!rule && /fill:none/.test(rule[1]) && /stroke:currentColor/.test(rule[1]) && /stroke-width:1\.8/.test(rule[1]) && /stroke-linecap:round/.test(rule[1]) && /stroke-linejoin:round/.test(rule[1]), 'the page svg rule is the stroke family: fill none, stroke currentColor, 1.8 wide, round caps and joins', rule && rule[1]);
process.exitCode = bad ? 1 : 0;
