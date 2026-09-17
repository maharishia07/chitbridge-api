/**
 * screen-kit.test.cjs — THE SCREEN LIBRARY KEEPS ITS PROMISES (2026-09-17).
 *
 * From the quick-keys design handoff (§10 acceptance), the checks that need no browser:
 *   every layout places every part of the sell screen — moved to a tab, step or sheet, never dropped;
 *   every preset names choices that exist; a stored name the library does not know falls back, never through;
 *   device beats counter beats shop; the auto layout follows the viewport table;
 *   a tile with no photo shows initials (never an empty box); sold out restores from its face; photos off = text tile;
 *   every picker offers both levels (groups, then one group's items).
 *
 * Run: node tests/screen-kit.test.cjs   · no DB, no network, no DOM.
 */
'use strict';
const assert = require('assert'), path = require('path');
const K = require(path.join(__dirname, '..', 'lib', 'screen-kit.js'));

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ' + name); pass++; } catch (e) { console.log('  FAIL ' + name + '\n      ' + e.message); fail++; } };

console.log('\nscreen kit · layouts, presets, resolution');
t('⭐⭐ every layout places every slot — nothing is ever dropped', () => {
  for (const id of Object.keys(K.LAYOUTS)) assert.deepStrictEqual(K.missingSlots(id), [], id + ' drops a part of the sell screen');
  assert.ok(K.SLOTS.length >= 13, 'the slot list shrank — the handoff names thirteen');
});
t('⭐ the small layouts MOVE the bill and pay into steps; the big ones keep them inline', () => {
  assert.strictEqual(K.LAYOUTS.phone.slots.bill, 'step');
  assert.strictEqual(K.LAYOUTS.phone.slots.pay, 'step');
  assert.strictEqual(K.LAYOUTS.horizontal.slots.bill, 'inline');
  assert.strictEqual(K.LAYOUTS.compact.slots.quickKeys, 'tab');
});
t('⭐ every preset names a layout, tile, picker and theme that exist', () => {
  for (const [id, p] of Object.entries(K.PRESETS)) {
    for (const k of ['layout', 'tile', 'picker', 'theme']) {
      const reg = { layout: K.LAYOUTS, tile: K.TILES, picker: K.PICKERS, theme: K.THEMES }[k];
      assert.ok(reg[p[k]], id + ' names an unknown ' + k + ': ' + p[k]);
    }
  }
  assert.strictEqual(Object.keys(K.PRESETS).length, 9);
});
t('⭐ counterClassic IS today\'s counter — the default', () => {
  const r = K.resolve();
  assert.deepStrictEqual([r.preset, r.layout, r.tile, r.picker, r.theme, r.photos], ['counterClassic', 'horizontal', 'classic', 'popup', 'lightCream', false]);
});
t('⭐⭐ device beats counter beats shop; a preset fills first, explicit fields then win', () => {
  const r = K.resolve({ preset: 'counterDark', photos: true }, { tile: 'monogram' }, { preset: 'phoneOwner', theme: 'navy' });
  assert.strictEqual(r.layout, 'phone');
  assert.strictEqual(r.theme, 'navy');
  assert.strictEqual(r.tile, 'classic', 'the device preset should set the tile over the counter\'s choice');
  assert.strictEqual(r.picker, 'bottomSheet');
  const r2 = K.resolve({ preset: 'counterDark' }, { tile: 'monogram' });
  assert.deepStrictEqual([r2.theme, r2.tile], ['dark', 'monogram']);
});
t('⚠️ a name the library does not know falls back — it never blanks the screen', () => {
  const r = K.resolve({ tile: 'hologram', theme: 'neon', layout: 'wall', picker: 'telepathy', preset: 'nope' });
  assert.deepStrictEqual([r.tile, r.theme, r.layout, r.picker], ['classic', 'lightCream', 'horizontal', 'popup']);
});
t('⭐ auto layout follows the viewport table', () => {
  assert.strictEqual(K.autoLayout({ width: 1600, height: 900 }), 'horizontal');
  assert.strictEqual(K.autoLayout({ width: 1080, height: 1920 }), 'vertical');
  assert.strictEqual(K.autoLayout({ width: 1024, height: 768 }), 'compact');
  assert.strictEqual(K.autoLayout({ width: 1180, height: 820, touch: true }), 'tablet');
  assert.strictEqual(K.autoLayout({ width: 390, height: 844 }), 'phone');
  assert.strictEqual(K.autoLayout({ width: 360, height: 720, scanner: true }), 'handheld');
});

console.log('\nscreen kit · tiles');
const item = { name: 'Idli batter', price: '₹80.00', unit: 'kg', attrs: 'data-testid="k0"', hideAttrs: 'data-testid="x0"', restoreAttrs: 'data-testid="r0"' };
t('⭐⭐ with photos on and no image, every tile shows initials — never an empty box', () => {
  for (const s of ['classic', 'photo']) {
    const h = K.tile(s, Object.assign({ showPhoto: true }, item));
    assert.ok(/class="sk-init"[^>]*>IB</.test(h), s + ' has no initials fallback');
    assert.ok(!/<img/.test(h));
  }
  assert.strictEqual(K.initials('Masala Dosa'), 'MD');
  assert.strictEqual(K.initials('  '), '?');
});
t('⭐ an image is drawn with alt = the item name, lazily', () => {
  const h = K.tile('photo', Object.assign({ showPhoto: true, image: 'https://x/y.png' }, item));
  assert.ok(/<img src="https:\/\/x\/y.png" alt="Idli batter" loading="lazy"/.test(h));
});
t('⭐ photos OFF turns the classic tile into a text tile', () => {
  const h = K.tile('classic', Object.assign({ showPhoto: false }, item));
  assert.ok(!/sk-ph/.test(h) && /sk-bar/.test(h));
});
t('⭐⭐ every tile: its face adds, × hides; sold out has no ×, and its face restores', () => {
  for (const s of Object.keys(K.TILES)) {
    const on = K.tile(s, item), out = K.tile(s, Object.assign({ soldOut: true }, item));
    assert.ok(/data-testid="k0"/.test(on) && /data-testid="x0"/.test(on), s + ' normal tile lacks its actions');
    assert.ok(/sk-out/.test(out) && /data-testid="r0"/.test(out), s + ' sold-out tile does not restore');
    assert.ok(!/data-testid="x0"/.test(out) && !/data-testid="k0"/.test(out), s + ' sold-out tile still adds or hides');
  }
});
t('⭐ in the bill, every tile shows the quantity', () => {
  for (const s of Object.keys(K.TILES)) assert.ok(/\b3\b/.test(K.tile(s, Object.assign({ qty: 3 }, item)).replace(/data-testid="[^"]*"/g, '')), s + ' hides the bill quantity');
});
t('⚠️ names are escaped — a product name cannot inject markup', () => {
  const h = K.tile('classic', { name: '<img onerror=x>', price: '1' });
  assert.ok(!/<img onerror/.test(h));
});

console.log('\nscreen kit · pickers and themes');
const model = { groups: [{ id: 'g1', name: 'Morning', from: '06:00', to: '11:30', total: 10, available: 7, on: true },
                         { id: 'g2', name: 'Afternoon', from: '11:30', to: '15:30', total: 10, available: 10, on: false }],
                attrs: { group: (id) => `data-g="${id}"`, open: (id) => `data-o="${id}"`, item: (id) => `data-i="${id}"`,
                         all: () => 'data-all', none: () => 'data-none', back: () => 'data-back', close: () => 'data-close' } };
t('⭐⭐ every picker lists every group with its toggle', () => {
  for (const s of Object.keys(K.PICKERS)) {
    const h = K.picker(s, model);
    assert.ok(/data-g="g1"/.test(h) && /data-g="g2"/.test(h), s + ' does not offer every group');
    assert.ok(/Morning/.test(h) && /Afternoon/.test(h));
  }
});
t('⭐ the dialog pickers open a group to its items, with Show all / Hide all and Back', () => {
  for (const s of Object.keys(K.PICKERS).filter((x) => !K.PICKERS[x].inline)) {
    const h = K.picker(s, Object.assign({}, model, { openId: 'g1', items: [{ id: 'i1', name: 'Idli', on: true }, { id: 'i2', name: 'Vada', on: false }] }));
    assert.ok(/data-i="i1"/.test(h) && /data-all/.test(h) && /data-none/.test(h) && /data-back/.test(h), s + ' lacks level B');
  }
});
t('⭐ every theme sets the same variables, and every theme has contrast between ink and paper', () => {
  const keys = Object.keys(K.THEMES.lightCream.vars).sort();
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const c = [16, 8, 0].map((s) => { const v = ((n >> s) & 255) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  for (const [id, th] of Object.entries(K.THEMES)) {
    assert.deepStrictEqual(Object.keys(th.vars).sort(), keys, id + ' leaves a variable unset');
    const a = lum(th.vars['--ink']), b = lum(th.vars['--paper']);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(ratio >= 4.5, id + ' ink on paper is ' + ratio.toFixed(2) + ':1 (needs 4.5)');
    assert.ok(/^:root\{--paper:/.test(K.themeCss(id)));
  }
});
t('⭐ group colours: the four named ones by name, and a steady colour for any other', () => {
  assert.strictEqual(K.groupColour('morning').bar, '#E0A020');
  assert.deepStrictEqual(K.groupColour('Specials'), K.groupColour('Specials'));
  assert.ok(K.groupColour(9).bar);
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
