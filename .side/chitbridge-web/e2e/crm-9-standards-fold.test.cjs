/**
 * crm-9-standards-fold.test.cjs — CRM-9 (proof 2026-11-14): the 'Why follow standards' sheet leads with the gist and folds the story, with Expand all / Collapse all.
 * OWNS      the proof, on the real cap-standards.js code (stdFoldBar · stdWhyHTML lifted into a vm sandbox): the full sheet carries the fold bar and one folded <details class="std-fold"> per item;
 *           the compact sheet (the Legend) carries neither; and the two buttons' own onclick, RUN against a stand-in sheet, open every fold / close every fold.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/crm-9-standards-fold.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-standards.js'), 'utf8');
const why = src.slice(src.indexOf('var STD_WHY = {'), src.indexOf('\n};', src.indexOf('var STD_WHY = {')) + 3);
const cx = vm.createContext({ tx: (s) => s });
vm.runInContext(why + '\n' + liftFns('public/app/cap-standards.js', ['stdFoldBar', 'stdWhyHTML']) + '\nthis.stdFoldBar = stdFoldBar; this.stdWhyHTML = stdWhyHTML;', cx);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const count = (s, re) => (s.match(re) || []).length;

const bar = cx.stdFoldBar();
ok(count(bar, /<button/g) === 2 && /data-testid="std-fold-all"[^>]*>Expand all</.test(bar) && /data-testid="std-fold-none"[^>]*>Collapse all</.test(bar), 'the bar is two buttons: "Expand all" and "Collapse all"');

/** run a button's onclick against a stand-in sheet: this.parentNode.parentNode.querySelectorAll('details.std-fold') are 3 folds, 2 of them open */
const press = (testid) => {
  const m = bar.match(new RegExp('data-testid="' + testid + '"[^>]*onclick="([^"]*)"'));
  if (!m) return null;
  const code = m[1].replace(/&quot;/g, '"');
  const folds = [{ open: true }, { open: false }, { open: true }];
  let selector = null;
  const root = { querySelectorAll: (s) => { selector = s; return folds; } };
  const button = { parentNode: { parentNode: root } };
  new Function(code).call(button);
  return { opens: folds.map((d) => d.open), selector };
};
const all = press('std-fold-all'), none = press('std-fold-none');
ok(all && all.selector === 'details.std-fold' && all.opens.every((v) => v === true), 'pressing Expand all opens every folded block of the sheet (details.std-fold): ' + JSON.stringify(all));
ok(none && none.selector === 'details.std-fold' && none.opens.every((v) => v === false), 'pressing Collapse all closes every folded block: ' + JSON.stringify(none));

const full = cx.stdWhyHTML({});
const compact = cx.stdWhyHTML({ compact: true });
ok(count(full, /data-testid="std-fold-all"/g) === 1 && count(full, /data-testid="std-fold-none"/g) === 1, 'the full sheet carries the fold bar once');
ok(count(full, /<details class="std-fold"/g) >= 2, 'the full sheet folds each item\'s story under its bold line (' + count(full, /<details class="std-fold"/g) + ' folds)');
ok(/data-testid="std-why-short"/.test(full) && full.indexOf('Your chit reaches another shop.') > 0 && full.indexOf('That shop can read it on day one.') > 0 && full.indexOf('No one has to be taught our way.') > 0, 'it leads with the three-line gist before any story');
ok(count(full, /<summary[^>]*><b/g) >= 2 && /<summary[^>]*>[^<]*<b[^>]*>[^<]+<\/b><\/summary>/.test(full), 'each fold\'s summary is its bold gist line (the detail sits inside the fold)');
ok(count(compact, /std-fold/g) === 0, 'the compact (Legend) sheet has no fold bar and no folds: the headings only');
process.exitCode = bad ? 1 : 0;
