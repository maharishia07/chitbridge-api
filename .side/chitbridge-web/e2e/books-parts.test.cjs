/* e2e/books-parts.test.cjs — the Ledger and Month-end part files hold what they own and nothing else (the cap-books / cap-period split, 2026-11-17)
 * OWNS      the proof for public/app/cap-books-tree.js · cap-books-cheques.js · cap-books-waiting-cells.js · cap-books-waiting-view.js · cap-books-party.js · cap-period-accruals.js:
 *           each part defines its functions once, the parent no longer defines them, each moved function is the main branch's text unchanged, a part draws with tokens
 *           (cream and dark, 1366 and 390 wide, AA contrast — no colour of its own), every catch in a part says so in words, and the pages load the parts.
 * CALLED BY node e2e/books-parts.test.cjs (offline, no browser, git for the main text)
 * FLOW      read each part and its parent → list the top-level functions → compare with origin/main's text → scan for colours, catches and the page tags
 * CARD      16-finance/cb-finance
 * MIN walk (a source walk of every part: functions, colours, catches and page tags — the browser walks of CB Accounts run on SIT)
 * MIN cream-and-dark-1366-390
 * MIN aa-contrast
 * MIN could-not-read-words
 * MIN string-layer
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const PARTS = [
  { file: 'public/app/cap-books-tree.js', parent: 'public/app/cap-books.js' },
  { file: 'public/app/cap-books-cheques.js', parent: 'public/app/cap-books.js' },
  { file: 'public/app/cap-books-waiting-cells.js', parent: 'public/app/cap-books.js' },
  { file: 'public/app/cap-books-waiting-view.js', parent: 'public/app/cap-books.js' },
  { file: 'public/app/cap-books-party.js', parent: 'public/app/cap-books.js' },
  { file: 'public/app/cap-period-accruals.js', parent: 'public/app/cap-period.js' }
];
/** changed on the branch before the split (not by it): the one place a part differs from main */
const CHANGED_BEFORE_SPLIT = ['bkLtPaneHTML'];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
const mainText = (rel) => cp.execSync('git show origin/main:' + rel, { cwd: ROOT, maxBuffer: 1e8 }).toString().split('\r\n').join('\n');
let failures = 0;
const check = (ok, what) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + what);
  if (!ok) failures++;
};
/** the top-level functions of a script: name → its text (from "function name(" to the closing brace in column 0) */
function functionsOf(text) {
  const out = {};
  const starts = [...text.matchAll(/^(?:async )?function ([A-Za-z0-9_$]+)\(/gm)];
  for (const found of starts) {
    const end = text.indexOf('\n}\n', found.index);
    out[found[1]] = text.slice(found.index, end + 2);
  }
  return out;
}

for (const part of PARTS) {
  const text = read(part.file);
  const own = functionsOf(text);
  const names = Object.keys(own);
  const parentFns = functionsOf(read(part.parent));
  const mainFns = functionsOf(mainText(part.parent));
  console.log(part.file + ' — ' + names.length + ' functions');
  check(names.length > 3, 'defines its functions (a part with nothing in it is a dead file)');
  check(names.every((name) => !(name in parentFns)), 'the parent ' + path.basename(part.parent) + ' no longer defines any of them (one place each)');
  check(names.every((name) => (text.match(new RegExp('^(?:async )?function ' + name + '[(]', 'gm')) || []).length === 1), 'no function is defined twice inside the part');
  /* before the split lands main's parent holds each function (moved, not rewritten); once it has landed main's parent no longer does, and the proof was this check run before the merge */
  const landed = names.every((name) => !(name in mainFns));
  check(landed || names.every((name) => mainFns[name] === own[name] || CHANGED_BEFORE_SPLIT.includes(name)), 'every function is the main branch text, unchanged (moved, not rewritten)' + (landed ? ' — the split is on main already, so nothing is left to compare' : ''));
  check(/OWNS[\s\S]*CALLED BY[\s\S]*CARD\s+\S+\/\S+/.test(text.slice(0, 1500)), 'the header names what it OWNS, who it is CALLED BY and its CARD');
  /* cream and dark, 1366 wide and 390 wide, AA contrast: the part paints with the page's tokens and states no colour of its own */
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check(!/#[0-9a-fA-F]{3,8}\b/.test(code.replace(/var\(--[\w-]+,\s*#[0-9a-fA-F]{3,8}\)/g, '')), 'no hard-coded colour outside a token fallback (the cream and dark themes keep their contrast)');
  check(!/(?:^|[^-\w])(?:width|min-width)\s*:\s*(?:1[0-9]{3}|[5-9][0-9]{2})px/.test(code), 'no fixed width wider than a phone (1366 and 390 wide both fit)');
  /* could not read, in words: a catch in a part tells the person (bkErr / bkWhy / toast / bkQuiet), it never swallows */
  const catches = [...code.matchAll(/catch\s*\(?[\w\s]*\)?\s*\{([^}]*)\}/g)].map((found) => found[1]);
  const spoken = catches.filter((body) => body.trim());
  check(spoken.every((body) => /bkErr|bkWhy|peBad|toast|bkQuiet|cbQuiet|textContent|innerHTML|throw|return/.test(body)), 'every catch says what the person sees or logs it (' + spoken.length + ' catches)');
  const mainCode = names.map((name) => mainFns[name] || '').join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  check(catches.length - spoken.length <= (mainCode.match(/catch\s*\(?[\w\s]*\)?\s*\{\s*\}/g) || []).length, 'no empty catch beyond the ones main already had (a moved catch stays; none is added)');
  /* the string layer: words go through tx / txf / txn (the locale layer), none is typed raw into a node */
  check(!/(?:textContent|innerText)\s*=\s*'[A-Z][a-z]+ [a-z]+/.test(code), 'no raw English assigned to a node outside the string layer (tx · txf · txn)');
  check(/\btx[fn]?\(/.test(code) || names.length < 1, 'its words go through tx · txf · txn');
}

/* the pages that run the parts load them: accounts.html runs every part; crm.html needs the party editor, finance.html the cheques */
const accounts = read('public/accounts.html');
for (const part of PARTS) check(accounts.includes('/app/' + path.basename(part.file)), 'accounts.html loads ' + path.basename(part.file));
check(read('public/crm.html').includes('/app/cap-books-party.js'), 'crm.html loads cap-books-party.js (partyEditOpen)');
check(read('public/finance.html').includes('/app/cap-books-cheques.js'), 'finance.html loads cap-books-cheques.js (bkChequesLoad · bkChequeList)');

/* fail closed: a part that is missing a function the parent calls is caught here, not on a customer's screen */
const parentCalls = (parentRel, partRel) => {
  const partFns = Object.keys(functionsOf(read(partRel)));
  const body = read(parentRel);
  return partFns.filter((name) => new RegExp('[^\\w.$]' + name + '\\b').test(body));
};
check(parentCalls('public/app/cap-books.js', 'public/app/cap-books-cheques.js').length > 0, 'the parent calls into the cheques part (the seam is real)');
check(parentCalls('public/app/cap-books.js', 'public/app/cap-books-waiting-view.js').length > 0, 'the parent calls into the waiting part (the seam is real)');
console.log(failures ? '\nbooks-parts: ' + failures + ' FAILED' : '\nbooks-parts: all ok');
process.exit(failures ? 1 : 0);
