'use strict';
/**
 * e2e/shortcuts-guard.cjs: THE SHORTCUT REGISTER IS WELL FORMED (MNT-63, DECISIONS 14 Nov "Keyboard shortcuts become a measure").
 * OWNS      the rules of public/app/shortcuts-register.js: two codes never share one key (within nav, and a popup key never a nav key) · no bare always-on letter · no Ctrl or Meta
 *           chord, and no Alt+Shift chord a browser or screen reader owns · every customer-page nav entry has a row · a row names something that exists · no key written outside the register.
 *           judge() is the one rule set; the fixtures below feed it bad registers that each must fail.
 * CALLED BY CI (Static guards) and by hand: node e2e/shortcuts-guard.cjs
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/shortcuts
 * FLOW      register rows -> judge(rows) -> problems[] ; real register must give none, each fixture must give its own problem
 * SCOPE     "one listener" means ONE LISTENER FOR SHORTCUT HANDLING (shortcuts.js). The other keydown handlers (list-ctl, shell Escape, avatar, kural, sides, rail-bell) handle
 *           their own widget and are not shortcuts, so they are not counted here.
 */
const fs = require('fs');
const path = require('path');
const counter = require('../tools/shortcuts-count.cjs');

const WEB = path.join(__dirname, '..');
/* Chrome's own Alt+Shift keys, copied from the page itself (fetched 14 Nov 2026), Windows and Linux column: https://support.google.com/chrome/answer/157179
   "Focus on inactive dialogs" Alt+Shift+A · "Set focus on the first item in the Chrome toolbar" Shift+Alt+T · "Open a feedback form" Alt+Shift+I · "Open split view in the active tab" Shift+Alt+N.
   Alt+Shift+B is not on that page, so it is not refused. */
const CHROME_OWNED = ['Alt+Shift+A', 'Alt+Shift+T', 'Alt+Shift+I', 'Alt+Shift+N'];
/* Screen readers (fetched 14 Nov 2026). NVDA: "can be configured so that the insert, numpadInsert, and/or capsLock key can be used as the NVDA modifier key"
   (https://download.nvaccess.org/documentation/userGuide.html#TheNVDAModifierKey). JAWS: "By default, Insert is the JAWS modifier key" (https://webaim.org/articles/jaws/).
   Both use Insert or CapsLock as their modifier, so no Alt+Shift+letter is refused for them; the rule below refuses those key names as a modifier in a row. */
const SCREEN_READER_MODIFIERS = /(^|\+)(Insert|CapsLock|NVDA|JAWS)(\+|$)/i;
const GRANDFATHERED_LITERALS = { 'public/app/ui.js': 1 }; /* the Run in background component's Control+B: it only shrinks */
const scopeOf = (code) => (code.startsWith('POP') ? 'popup' : 'nav');

/** every problem of a register's rows, as sentences; [] = well formed */
function judge(rows) {
  const codes = Object.keys(rows);
  const problems = [];
  codes.filter((code) => !counter.KEY_FORM.test(rows[code])).forEach((code) => problems.push('bad form (a bare letter, Ctrl or Meta chord, or unknown shape): ' + code + '=' + rows[code]));
  codes.filter((code) => SCREEN_READER_MODIFIERS.test(rows[code])).forEach((code) => problems.push('a screen reader modifier: ' + code + '=' + rows[code]));
  codes.filter((code) => CHROME_OWNED.includes(rows[code])).forEach((code) => problems.push('a chord Chrome owns: ' + code + '=' + rows[code]));
  const byKey = {};
  codes.filter((code) => scopeOf(code) === 'nav').forEach((code) => { (byKey[rows[code]] = byKey[rows[code]] || []).push(code); });
  Object.keys(byKey).filter((key) => byKey[key].length > 1).forEach((key) => problems.push('two nav codes share ' + key + ': ' + byKey[key].join(' + ')));
  const popupKeys = [...new Set(codes.filter((code) => scopeOf(code) === 'popup').map((code) => rows[code]))];
  if (popupKeys.length > 1) problems.push('popup rows use more than one key: ' + popupKeys.join(','));
  if (popupKeys.length === 1 && byKey[popupKeys[0]]) problems.push('the popup key is also a nav key: ' + popupKeys[0]);
  return problems;
}

let pass = 0;
const fails = [];
const ok = (what, cond) => { if (cond) { pass++; console.log('  ok ' + what); } else { fails.push(what); console.error('  FAIL ' + what); } };

const reg = counter.register();
const rows = reg.rows;
const codes = Object.keys(rows);

console.log('\n== the register ==');
const problems = judge(rows);
ok('the real register has no problem: ' + (problems.join('; ') || 'none'), !problems.length);
ok('the setting is the avatar kind "keys"', reg.setting === 'keys' && /keys: 'cb_keys'/.test(fs.readFileSync(path.join(WEB, 'public/app/avatar.js'), 'utf8')));
ok('the sheet key is ? and its code is a row', reg.sheet.key === '?' && Object.prototype.hasOwnProperty.call(rows, reg.sheet.code));

console.log('\n== bad registers each fail ==');
const bad = {
  'a duplicate key': { 'HOM001-B01#a': 'g a', 'HOM001-B01#b': 'g a' },
  'a bare letter': { 'HOM001-B01#a': 'a' },
  'a Ctrl+letter': { 'HOM001-B01#a': 'Control+B' },
  'a Meta+letter': { 'HOM001-B01#a': 'Meta+K' },
  'a Chrome-owned chord (Alt+Shift+A)': { POP001: 'Alt+Shift+A' },
  'a Chrome-owned chord (Alt+Shift+T)': { 'HOM001-K01#trade': 'Alt+Shift+T' },
  'a Chrome-owned chord (Alt+Shift+N, split view)': { 'HOM001-B01#network-lab': 'Alt+Shift+N' },
  'a screen reader modifier': { 'HOM001-K01#home': 'Insert+H' },
  'a popup key that is also a nav key': { POP001: 'Alt+Shift+H', 'HOM001-K01#home': 'Alt+Shift+H' }
};
Object.keys(bad).forEach((name) => ok('fixture ' + name + ' fails the guard', judge(bad[name]).length > 0));
const dialogOf = (footer) => "x pop: 'POP900',\n  footerHtml:" + footer + "\n  });";
ok('closeOnly: a lone Cancel footer is n/a', counter.closeOnly('POP900', [dialogOf("'<button onclick=\"closeModal()\">Cancel</button>'")]));
ok('closeOnly: a lone danger action is NOT n/a', !counter.closeOnly('POP900', [dialogOf("'<button class=\"danger\" onclick=\"doRemove()\">Remove</button>'")]));
ok('closeOnly: Cancel plus a plain action is NOT n/a', !counter.closeOnly('POP900', [dialogOf("'<button onclick=\"closeModal()\">Cancel</button><button onclick=\"save()\">Save</button>'")]));
ok('closeOnly: an unreadable opener stays in', !counter.closeOnly('POP900', ['nothing here']));
ok('a clean fixture passes (the rules are not blanket)', judge({ 'HOM001-B01#a': 'g a', 'HOM001-K01#home': 'Alt+Shift+H', POP001: 'Alt+Shift+D' }).length === 0);

console.log('\n== the rows name real things ==');
const result = counter.count();
const navMissing = result.missing.filter((code) => code.startsWith('HOM001'));
ok('every area and every customer-page card has a row (missing: ' + (navMissing.join(', ') || 'none') + '); popups without one are the counter work, ' + (result.popups.of - result.popups.declared) + ' left (popup list: ' + result.popups.source + ')', !navMissing.length);
const wanted = new Set(counter.areas().map((id) => 'HOM001-K01#' + id).concat(counter.cards().map((id) => 'HOM001-B01#' + id), counter.popups().codes));
const stray = codes.filter((code) => !wanted.has(code));
ok('no row names something that is not there: ' + (stray.join(', ') || 'none stray'), !stray.length);

console.log('\n== one shortcut listener, one register ==');
const unit = fs.readFileSync(path.join(WEB, 'public/app/shortcuts.js'), 'utf8');
const registerText = fs.readFileSync(path.join(WEB, 'public/app/shortcuts-register.js'), 'utf8');
ok('the shortcut unit adds exactly one keydown listener (other widgets keep their own; not counted)', (unit.match(/addEventListener\('keydown'/g) || []).length === 1);
ok('the register file only assigns CB_SHORTCUT_REGISTER (no code of its own)', /root\.CB_SHORTCUT_REGISTER = \{/.test(registerText) && !/addEventListener|\bfunction \w/.test(registerText));

console.log('\n== no key written outside the register ==');
const appDir = path.join(WEB, 'public/app');
const offenders = fs.readdirSync(appDir).filter((name) => name.endsWith('.js') && !/^shortcuts(-register)?\.js$/.test(name)).filter((name) => {
  const hits = (fs.readFileSync(path.join(appDir, name), 'utf8').match(/\bshortcut:\s*['"]/g) || []).length;
  return hits > (GRANDFATHERED_LITERALS['public/app/' + name] || 0);
});
ok('no component declares a shortcut: literal of its own: ' + (offenders.join(', ') || 'none'), !offenders.length);

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
process.exit(fails.length ? 1 : 0);
