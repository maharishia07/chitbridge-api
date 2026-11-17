'use strict';
/* tests/firm-home-budget.test.cjs - THE FIRM HOME'S CALL BUDGET CANNOT CREEP BACK (l16 firmhome; Fable round 2 R2-1: 58 calls a load against a limit of 500 per 900 s).
 * OWNS      e2e/firm-home-calls.budget.json stays at 15 or less and the walk that counts the calls (e2e/walk-firm-practice.cjs) reads it; the Home code keeps the four things that cut it:
 *           one ask per card URL (factsOnce), the practice read first (settled), a firm's cards asked as they come into view (whenSeen), and no GET /books/health for a ledger /me says is off.
 * CALLED BY npm run check:firmhome (package.json, in `check`). No browser: the count itself is measured by walk-firm-practice.cjs on a SIT box.
 * Run: node tests/firm-home-budget.test.cjs */
const fs = require('fs'), path = require('path'), assert = require('assert');
const R = path.join(__dirname, '..'), rd = (p) => fs.readFileSync(path.join(R, p), 'utf8');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const B = JSON.parse(rd('e2e/firm-home-calls.budget.json'));
ok(Number.isInteger(B.firm_home_calls_max) && B.firm_home_calls_max <= 15, 'the firm Home budget is a whole number of 15 or less (' + B.firm_home_calls_max + ')');
ok(/firm-home-calls\.budget\.json/.test(rd('e2e/walk-firm-practice.cjs')) && /firm_home_calls_max/.test(rd('e2e/walk-firm-practice.cjs')), 'walk-firm-practice.cjs counts the calls against the budget file');
const sh = rd('public/app/shell.js') + rd('public/app/shell-facts.js'); /* the cards' read moved to shell-facts.js */
ok(/function factsOnce\(/.test(sh) && /ctx\.cache\[url\]/.test(sh), 'shell.js asks each card URL once per load (factsOnce)');
ok(/function practiceFirst\(/.test(sh) && /CBPractice\.settled/.test(sh), 'shell.js waits for the practice read before asking cards');
ok(/function whenSeen\(/.test(sh) && /isFirm\(\) && !!root\.IntersectionObserver/.test(sh), 'a firm Home asks a card when it comes into view');
ok(/shown\(\)\.forEach\(function \(card\) \{\s*if \(!card \|\| card\.state !== 'built'/.test(sh), 'only the cards drawn (shown) are asked, never the ones a firm hides');
const ix = rd('index.html');
ok(/ledgerSaid\(\)\.then/.test(ix) && /on === false/.test(ix), 'Home does not ask GET /books/health when /me says the ledger is off');
ok(/SHELL\.facts \? SHELL\.facts\(rail\.facts\)/.test(ix), 'Your work shares the Tasks card ask');
console.log(n + ' passed');
