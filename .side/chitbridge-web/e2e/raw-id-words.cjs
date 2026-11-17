// @type: unit
/* raw-id-words.cjs — A RAW ID IS NEVER SHOWN WHERE A NAME BELONGS (R123 Pay sheet bill, R109 timeline "by"; UX-118)
 *
 * cbIsRawId (accounts-shell.js, the one test) and bkBillNo (cap-books.js, the bill's number or "Bill of <date>") are taken from the
 * real sources with the page's formatters stubbed. The two painters that used to print `e.by` / `against_ref` straight are checked
 * by source: they must go through these two. No browser, no server.
 * Run: node e2e/raw-id-words.cjs        (exit 1 on any failure)
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8');
const shell = read('accounts-shell.js'), books = read('cap-books.js'), crm = read('cap-crm-record.js'), bank = read('cap-bank.js') + read('cap-bank-rows.js');
let bad = 0;
const say = (label, ok, detail) => { console.log('  ' + String(label).padEnd(84) + '· ' + (detail || '') + '  ' + (ok ? 'OK' : (bad++, 'FAILED'))); };

/** the source of `function name(…){…}` in `src` — braces counted */
function fnSource(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) return src.slice(at, i + 1); } }
  return null;
}
const ctx = { tx: (s) => s, txf: (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k]), bkDate: (d) => 'D(' + d + ')' };
vm.createContext(ctx);
for (const [src, name] of [[shell, 'cbIsRawId'], [books, 'bkBillNo']]) {
  const s = fnSource(src, name);
  if (!s) { say(name + '() exists', false, 'not found'); continue; }
  vm.runInContext(s + '\nthis.' + name + ' = ' + name + ';', ctx);
}
const UUID = '778d9977-c082-4ccb-a5b6-3a3e1a8f12ee';
if (ctx.cbIsRawId && ctx.bkBillNo) {
  say('a uuid is a raw id', ctx.cbIsRawId(UUID) === true);
  say('"pay:<hex>" is a raw id', ctx.cbIsRawId('pay:0d102689-aaaa-bbbb-cccc') === true);
  say('a bill number and a person are not', !ctx.cbIsRawId('SG-1022') && !ctx.cbIsRawId('Kaveri (owner)') && !ctx.cbIsRawId(''));
  say('R123: a bill with a number shows the number', ctx.bkBillNo('SG-1022', UUID, '2026-10-12') === 'SG-1022');
  say('R123: no number, a uuid ref, a date → "Bill of D(2026-10-12)", never the id', ctx.bkBillNo('', UUID, '2026-10-12') === 'Bill of D(2026-10-12)');
  say('R123: no number, a uuid ref, no date → "Bill"', ctx.bkBillNo(null, UUID, null) === 'Bill');
  say('R123: no number, a readable ref → the ref', ctx.bkBillNo('', 'b1', '2026-10-12') === 'b1');
}
say('Pay sheet BILL column goes through bkBillNo', /esc\(bkBillNo\(item\.bill_no, item\.against_ref/.test(books));
say('Bank rec "Bills" goes through bkBillNo', /bkBillNo\(entry\.bill_no, entry\.ref_chit_id/.test(bank));
const whoSource = fnSource(crm, 'crmWho');
if (whoSource && ctx.cbIsRawId) {
  vm.runInContext(whoSource + '\nthis.crmWho = crmWho;', ctx);
  say('R109: a shop uuid as "by" says nothing; a name stays; empty stays empty', ctx.crmWho(UUID) === '' && ctx.crmWho('Kaveri (owner)') === 'Kaveri (owner)' && ctx.crmWho(null) === '');
} else say('crmWho() exists', false, 'not found');
say('CRM timeline: change row, stage move and history-of-changes "by" go through crmWho', (crm.match(/crmWho\((e|x)\.by\)/g) || []).length >= 3);
say('crmIsRawId is gone (one test, not two)', !/function crmIsRawId/.test(crm) && !/crmIsRawId\(/.test(crm));
process.exit(bad ? 1 : 0);
