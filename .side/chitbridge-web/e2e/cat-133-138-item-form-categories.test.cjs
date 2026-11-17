/**
 * cat-133-138-item-form-categories.test.cjs — CAT-133 and CAT-138 (proof 2026-11-14): the item form offers the shop's existing categories, by definition id with name.
 * OWNS      CAT-138: ctCategoryChips (cap-catalogue.js) draws ONE chip per live category of the shelf, carrying its definition id (data-cid) and its name, a
 *           retired-but-cited one kept amber, and nothing when the shelf is not read yet.
 *           CAT-133: what the form saves is the chosen definition ids (ctCategoriesFromForm -> core.js catgSetOn): categories = [ids], category_names = their names,
 *           the legacy single `category` key gone; an unchanged selection leaves the item untouched; no chips on screen leaves it untouched (absent is not cleared).
 *           The functions are the real ones, lifted from public/app/cap-catalogue.js and core.js into a vm sandbox.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/cat-133-138-item-form-categories.test.cjs
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

const SHELF = [{ id: 'def-grains', name: 'Grains' }, { id: 'def-staples', name: 'Staples' }];
/** a fake ct_categories host whose chips are the buttons ctCategoryChips drew, with `on` taken from their class */
function hostFrom(html) {
  const chips = [];
  const re = /<button type="button" class="ctcatg( on)?[^"]*" data-cid="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) chips.push({ id: m[2], on: !!m[1] });
  return { querySelectorAll: () => chips.filter((c) => c.on).map((c) => ({ getAttribute: () => c.id })) };
}
const sandbox = { console, _CATG: SHELF, document: { getElementById: () => null }, esc: (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';'), tx: (s) => s, txf: (s, v) => s.replace('{n}', v && v.n) };
vm.createContext(sandbox);
vm.runInContext(
  liftFns('public/app/core.js', ['catgIdsOf', 'catgNamesOf', 'catgSetOn']) + '\n' +
  liftFns('public/app/cap-catalogue.js', ['ctCatgChip_', 'ctCategoryChips', 'ctCategoriesFromForm', 'sameIds']) +
  '\nthis.ctCategoryChips = ctCategoryChips; this.ctCategoriesFromForm = ctCategoriesFromForm;', sandbox);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

/* CAT-138 — the form offers the existing categories */
const html = sandbox.ctCategoryChips({}, SHELF, {});
ok((html.match(/class="ctcatg[ "]/g) || []).length === 2, 'two live categories -> two chips');
ok(/data-cid="def-grains"[^>]*>Grains</.test(html) && /data-cid="def-staples"[^>]*>Staples</.test(html), 'each chip carries its definition id and its name');
ok(sandbox.ctCategoryChips({ categories: ['def-grains'] }, SHELF, {}).includes('class="ctcatg on" data-cid="def-grains"'), 'an item already in Grains shows that chip chosen');
const gone = sandbox.ctCategoryChips({ categories: ['def-old'], category_names: ['Old shelf'] }, SHELF, {});
ok(/ctcatg on gone" data-cid="def-old"/.test(gone) && gone.includes('Old shelf'), 'a retired category the item still cites is kept (amber) under its travelling name');
ok(sandbox.ctCategoryChips({}, null, {}) === '', 'shelf not read yet -> no chips (the host fills them when it lands)');

/* CAT-133 — what is saved is the definition ids, with their names */
const form = sandbox.ctCategoryChips({ category: 'def-grains' }, SHELF, {});   /* legacy single key: chip shows chosen */
const chosen = hostFrom(form);
chosen.querySelectorAll = () => [{ getAttribute: () => 'def-grains' }, { getAttribute: () => 'def-staples' }];
sandbox.document.getElementById = () => chosen;
const saved = sandbox.ctCategoriesFromForm({ name: 'Rice', category: 'def-grains', category_name: 'Grains' });
ok(JSON.stringify(saved.categories) === JSON.stringify(['def-grains', 'def-staples']), 'two chosen chips save categories = their two definition ids (' + JSON.stringify(saved.categories) + ')');
ok(JSON.stringify(saved.category_names) === JSON.stringify(['Grains', 'Staples']), 'and category_names = their names, aligned (' + JSON.stringify(saved.category_names) + ')');
ok(!('category' in saved) && !('category_name' in saved), 'the legacy single key is gone after the save');
const same = { name: 'Rice', categories: ['def-staples', 'def-grains'] };
ok(sandbox.ctCategoriesFromForm(same) === same && !('category_names' in same), 'the same set in any order leaves the item untouched (a patch carries only what changed)');
sandbox.document.getElementById = () => null;
const untouched = { name: 'Rice', categories: ['def-grains'] };
ok(sandbox.ctCategoriesFromForm(untouched).categories.join() === 'def-grains', 'no chips on screen (shelf unread) leaves the item untouched: absent is not cleared');
process.exitCode = bad ? 1 : 0;
