/**
 * cat-135-category-chips.test.cjs — CAT-135 (proof 2026-11-14): the category chips carry counts from the CATALOGUE; Uncategorised only above 0, last; the active chip clears.
 * OWNS      the proof on the real public/app/cart.js (CBCart.create + CBCatUI.pickerHTML in a vm window, no browser): rice in Zulu, dal in Zulu and Staples,
 *           a pen in none -> chips Staples 1, Zulu 2, Uncategorised 1 (Uncategorised LAST though "U" sorts before "Z"); every item categorised -> no Uncategorised chip;
 *           searching narrows the list but the chip counts stay the catalogue's; tapping the active chip clears it.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/cat-135-category-chips.test.cjs
 */
'use strict';
const { loadScript } = require('./lib/lift-fn.cjs');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
const sb = loadScript('public/app/cart.js', { esc, tx: (s) => s, txf: (s) => s });
const CATS = [{ id: 'c1', name: 'Zulu' }, { id: 'c2', name: 'Staples' }];
const item = (id, name, categories) => ({ item_id: id, item_data: Object.assign({ name, price: 10 }, categories ? { categories } : {}) });
const make = (items) => { const h = sb.CBCart.create({ items, categories: CATS, offers: [] }, { categories: CATS }); return h; };
/** the chips of the picker, in order: [{ name, n, on }] — "All" is not a category chip */
function chips(h) {
  const html = sb.CBCatUI.pickerHTML(h, {});
  const out = [];
  const re = /<button(?: data-cbsid="[^"]*")? type="button" class="cbpick-chip( on)?"[^>]*data-testid="pick-catg"[^>]*>([^<]*)<span class="cbpick-chipn">(\d+)<\/span><\/button>/g;
  let m;
  while ((m = re.exec(html))) out.push({ name: m[2].trim(), n: Number(m[3]), on: !!m[1] });
  return out;
}
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const h = make([item('a', 'Rice', ['c1']), item('b', 'Pen', null), item('c', 'Dal', ['c1', 'c2'])]);
const first = chips(h);
ok(JSON.stringify(first.map((x) => x.name + ' ' + x.n)) === JSON.stringify(['Staples 1', 'Zulu 2', 'Uncategorised 1']), 'chips with counts, Uncategorised last (' + first.map((x) => x.name + ' ' + x.n).join(', ') + ')');
h.search('Pen');
ok(JSON.stringify(chips(h).map((x) => x.n)) === JSON.stringify([1, 2, 1]), 'a search narrows the list, not the chip counts (still 1, 2, 1)');
h.search('');
const full = make([item('a', 'Rice', ['c1']), item('c', 'Dal', ['c1', 'c2'])]);
ok(!chips(full).some((x) => /Uncategorised/.test(x.name)), 'no Uncategorised chip when its count is 0 (' + chips(full).map((x) => x.name).join(', ') + ')');
sb.CBCart.category(h.ns, 'c1');
ok(chips(h).filter((x) => x.on).map((x) => x.name).join() === 'Zulu', 'tapping a chip selects it');
sb.CBCart.category(h.ns, 'c1');
ok(chips(h).filter((x) => x.on).length === 0, 'tapping the active chip clears it (no chip is on)');
process.exitCode = bad ? 1 : 0;
