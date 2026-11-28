#!/usr/bin/env node
// @type: unit
/**
 * tests/books-ref-guard-scan.test.cjs — AX-F-02 (2026-11-22): a static scan, so the NEXT client_ref write door cannot forget the reused-ref guard.
 * OWNS      (1) every route in routes/books.js that reads a client_ref is guarded (guardOf / recordPayment) or named in EXEMPT with its reason; (2) every
 *           route(...) door in routes/books.js reaches lib/books-period.js through P().fn, and every postOwn call in that file is guarded by default (only the four natural-key doors opt out).
 * CALLED BY scripts/guards.cjs
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * No server: it reads the two source files. A mutation of each file's text (guard removed) must fail the same scan, so the scan itself is proven.
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
/** doors that read a client_ref and are NOT guarded by the journal compare, each with why */
const EXEMPT = {
  'post /opening': 'a second opening is refused by its own replay (opening:<ref> answers the first; a change goes through /opening/replace, which names a reason)',
  'post /move-in/preview': 'the DRY RUN: nothing is written (routes/books.js doc line), the ref only keys the suspense it names; a repeat has nothing to replay or compare',
  'post /move-in/import':'an import keyed by the file, not by a posted entry; it posts through its own proof (move-in-proof)',
  'post /events/batch': 'each line goes through the same event writer as POST /events (M().post, where the journal compare lives); the route only reads each line\'s client_ref to name its result',
};
/** the lib doors a route may hand its ref to instead of guardOf: the payments door compares the stored payment (books-event-guard.refuseOtherPayment) */
const GUARDED_IN_LIB = /recordPayment\(/;
/** postOwn doors keyed by the shop's own natural key (not a client_ref), the only ones that may pass `natural` */
const NATURAL = ['runDepreciation', 'gstClose', 'holdSurplus', 'gstPay'];
function routeBlocks(text) {
  const code = strip(text), re = /^(router\.(post|put|patch|delete)|route)\(\s*(?:'(post|put|patch|delete)',\s*)?'([^']+)'/gm, idx = [];
  let m; while ((m = re.exec(code))) idx.push({ at: m.index, key: (m[2] || m[3]) + ' ' + m[4] });
  return idx.map((x, i) => Object.assign(x, { text: code.slice(x.at, i + 1 < idx.length ? idx[i + 1].at : code.length) }));
}
/** → the routes that read a client_ref and are neither guarded nor exempt */
function unguardedRoutes(routesText) {
  return routeBlocks(routesText).filter((b) => /clientRef\(|client_ref/.test(b.text) && !/guardOf\(/.test(b.text) && !GUARDED_IN_LIB.test(b.text) && !EXEMPT[b.key]).map((b) => b.key);
}
/** → the functions of lib/books-period.js that call postOwn with `natural`, plus a postOwn whose default is not the guard */
function periodFindings(periodText) {
  const code = strip(periodText), out = { naturalIn: [], defaultGuarded: /function postOwn\([^)]*natural\)[\s\S]*?natural \? undefined : require\('\.\/books-event-guard'\)\.guardOf\(/.test(code) };
  const fnRe = /^(?:async )?function (\w+)\(/gm; const fns = []; let m; while ((m = fnRe.exec(code))) fns.push({ at: m.index, name: m[1] });
  const call = /postOwn\(/g; let c;
  while ((c = call.exec(code))) {
    const fn = fns.filter((f) => f.at < c.index).pop(); if (!fn || fn.name === 'postOwn') continue;
    let depth = 0, i = c.index + 'postOwn'.length, end = i; for (; i < code.length; i++) { if (code[i] === '(') depth++; if (code[i] === ')') { depth--; if (!depth) { end = i; break; } } }
    if (/,\s*(true|false)\s*,\s*true\s*\)$/.test(code.slice(c.index, end + 1).replace(/\s+/g, ' ').replace(/\s*\)$/, ')'))) out.naturalIn.push(fn.name);
  }
  return out;
}
const routesText = fs.readFileSync(path.join(API, 'routes', 'books.js'), 'utf8'), periodText = fs.readFileSync(path.join(API, 'lib', 'books-period.js'), 'utf8');
ok('every route in routes/books.js that reads a client_ref is guarded or exempt with a reason', unguardedRoutes(routesText).length === 0, 'unguarded: ' + unguardedRoutes(routesText).join(', '));
ok('the scan SEES the ref doors (guards and exemptions are not vacuous)', routeBlocks(routesText).filter((b) => /clientRef\(|client_ref/.test(b.text)).length >= 5);
ok('mutation: the write-off door without its guard is reported', unguardedRoutes(routesText.replace(/(router\.post\('\/write-off'[\s\S]*?)guardOf\(entity, found\.event\)/, '$1null')).indexOf('post /write-off') >= 0);
const found = periodFindings(periodText);
ok('postOwn guards by default (natural opts out)', found.defaultGuarded);
ok('only the natural-key doors opt out of the guard', JSON.stringify(found.naturalIn.sort()) === JSON.stringify(NATURAL.slice().sort()), 'natural: ' + found.naturalIn.join(', '));
ok('mutation: a postOwn that does not guard is reported', !periodFindings(periodText.replace("natural ? undefined : require('./books-event-guard').guardOf(entity, posting)", 'undefined')).defaultGuarded);
const doors = routeBlocks(routesText).filter((b) => /^route\(/.test(b.text) || /P\(\)\./.test(b.text)).map((b) => (b.text.match(/P\(\)\.(\w+)/) || [])[1]).filter(Boolean);
ok('the route( doors reach lib/books-period.js (loans, assets, accruals, closing stock, contra among them)', ['takeLoan', 'loanEmi', 'addAsset', 'accrue', 'closingStock', 'contra'].every((f) => doors.includes(f) && periodText.includes('function ' + f + '(')), doors.join(','));
console.log('\n' + (fail ? '  FAILED ' + fail : '  ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
