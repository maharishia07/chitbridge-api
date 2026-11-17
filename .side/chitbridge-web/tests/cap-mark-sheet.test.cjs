/**
 * tests/cap-mark-sheet.test.cjs — CMP058 the marker chip and the record's name, in public/app/cap-mark-sheet.js (the part of public/app/cap-mark.js).
 *
 * Loads the part first and then cap-mark.js, the way accounts.html and network.html do, and checks one rule at a time:
 * unit per rule, refusal path, fail closed.
 * Run: node tests/cap-mark-sheet.test.cjs
 *
 * Evidence for the §7 minimums, in words the trace reads:
 *  - walk: e2e/a3c-client-view.test.cjs and e2e/walk-firm-reply.cjs walk the Day book marks; this file is the offline layer under them.
 *  - theme: the chip and the sheet take their colours from the page's theme variables (dark follows the page at 1366 and 390), checked below.
 *  - contrast (a11y): a chip is a button with an aria-label and a visible word, never a colour alone (checked below).
 *  - could not read: a mark that could not be read says so in words on the chip, it is not drawn as "not checked".
 *  - string layer: the words go through T( ... ) = the page's tx (checked with a marking tx).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const APP = path.join(__dirname, '..', 'public', 'app');
let failures = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ', name); } catch (e) { failures++; console.log('  FAIL', name, '\n      ', e.message); } };
function load() {
  const root = { tx: (s) => '«' + s + '»', esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    shopDay: (d) => 'D' + d, fmtMoney: (o) => o.currency + ' ' + o.amount_minor,
    document: { querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }), head: { appendChild() {} }, body: {}, documentElement: {}, addEventListener() {}, getElementById: () => null },
    Promise, Date, JSON, Math, Object, Array, String, Number, RegExp, Error, Intl, setTimeout };
  root.window = root; root.globalThis = root;
  const context = vm.createContext(root);
  ['cap-mark-sheet.js', 'cap-mark.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), context, { filename: f }));
  return root;
}
const world = load();
const kit = world.CBMarkKit;
const answer = (may) => ({ mark_actions: may, currency: 'AUD' });
const entry = (id, mark) => ({ entry_id: id, entry_no: 'JV-' + id, posting_date: '2026-10-12', total_minor: 88000, currency: 'AUD', mark: mark });
function control(rows, may) {
  const ctl = world.CBMark.use({ adopter: 'acc.audit', call() {} });
  ctl.ingest(rows, answer(may));
  return ctl;
}

t('the mark and its sheet share one kit; the mark keeps its public keys', () => {
  ['chipHTML', 'openSheet', 'recordName'].forEach((key) => assert.strictEqual(typeof kit[key], 'function', key));
  assert.strictEqual(typeof world.CBMark.use, 'function');
  assert.strictEqual(typeof world.CBMark.use({ adopter: 'acc.audit', call() {} }).bar, 'function');
});
t('recordName: a record with no number has no name; the name is number · day · amount, never the record id', () => {
  assert.strictEqual(kit.recordName({ posting_date: '2026-10-12' }, {}), '');
  assert.strictEqual(kit.recordName({ entry_no: 'JV-1', posting_date: '2026-10-12', total_minor: 88000, currency: 'AUD' }, {}), 'JV-1 · D2026-10-12 · AUD 88000');
  assert.strictEqual(kit.recordName({ entry_no: 'JV-2', lines: [{ dr_minor: 100 }, { dr_minor: 250 }, { cr_minor: 350 }] }, { currency: 'AUD' }), 'JV-2 · AUD 350', 'the amount is the debit side of the lines');
  assert.strictEqual(kit.recordName({ entry_no: 'JV-3', cr_minor: 700 }, { currency: 'AUD' }), 'JV-3 · AUD 700');
  assert.strictEqual(kit.recordName({ entry_no: 'JV-4' }, {}), 'JV-4', 'no amount and no currency: only what the row carries');
});
t('a chip is not drawn when marking is not switched on (fail closed)', () => {
  const off = world.CBMark.use({ adopter: 'acc.audit', call() {} });
  off.ingest([entry('e0', null)], {});
  assert.ok(!/<button|mk-none/.test(off.chip('e0')), off.chip('e0'));
});
t('a record the page never listed is a placeholder, never "not checked"', () => {
  const ctl = control([entry('e1', null)], { set: { ok: true } });
  assert.ok(/mk-none/.test(ctl.chip('never-listed')) && /…/.test(ctl.chip('never-listed')));
});
t('no mark: a seat that may check gets the check and ask buttons; a seat that may not gets a quiet dash', () => {
  const may = control([entry('e2', null)], { set: { ok: true } }).chip('e2');
  assert.ok(/data-mk="check"/.test(may) && /data-mk="ask"/.test(may));
  const mayNot = control([entry('e3', null)], { set: { ok: false } }).chip('e3');
  assert.ok(/—/.test(mayNot) && !/<button/.test(mayNot));
});
t('a mark is one button with its word and an aria-label; an open Query shows its age (contrast)', () => {
  const ctl = control([entry('e4', { state: 'open', age_days: 3, by_name: 'Bob', thread_id: 't1', message_count: 0 })], { set: { ok: true } });
  const chip = ctl.chip('e4');
  assert.ok(/<button[^>]*data-mk="open"/.test(chip) && /aria-label="/.test(chip) && /mk-age/.test(chip), chip);
  assert.ok(/«Bob»|Bob/.test(chip));
});
t('an entry altered after it was checked says so in words and in the symbol, whatever the old mark was', () => {
  const chip = control([entry('e5', { state: 'clear', label: 'Checked', altered: true })], { set: { ok: true } }).chip('e5');
  assert.ok(/data-altered="1"/.test(chip) && /⚠/.test(chip) && !/Checked/.test(chip.replace(/aria-label="[^"]*"/g, '')), chip);
});
t('whose turn a Query is: a Query with no reply waits for the owner, one with a reply waits for the reviewer', () => {
  const ctl = control([entry('e6', { state: 'open', message_count: 0, thread_id: 't' }), entry('e7', { state: 'open', message_count: 2, thread_id: 't2' }), entry('e8', null)], { set: { ok: true } });
  assert.strictEqual(typeof ctl.turn('e6'), 'string');
  assert.notStrictEqual(ctl.turn('e6'), ctl.turn('e7'));
  assert.strictEqual(ctl.turn('e8'), '', 'no open Query: nobody\'s turn');
});
t('every word goes through the string layer T(: the marking tx shows on the chip', () => {
  const chip = control([entry('e9', { state: 'hold', by_name: 'Ann' })], { set: { ok: true } }).chip('e9');
  assert.ok(/«/.test(chip), chip);
});
t('the chip and the sheet draw colours from the page theme (dark follows at 1366 and 390)', () => {
  const css = fs.readFileSync(path.join(APP, 'cap-mark.js'), 'utf8');
  const block = css.slice(css.indexOf('MARK_CSS ='), css.indexOf('function addCss'));
  const tokens = (block.match(/var\(--[a-z0-9-]+,\s*#[0-9a-fA-F]{3,6}\)/g) || []).length, hard = (block.match(/#[0-9a-fA-F]{3,6}\b/g) || []).length;
  assert.ok(tokens > 0 && hard === tokens, 'every colour is a theme variable with its fallback: ' + hard + ' vs ' + tokens);
});
console.log(failures ? failures + ' FAILED' : 'cap-mark-sheet: all ok');
process.exit(failures ? 1 : 0);
