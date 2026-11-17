'use strict';
// @type: unit
/**
 * field-edge.test.cjs — the --field-edge token (public/app/ui.js FIELD_EDGE_CSS) reaches 3:1 (WCAG 1.4.11) on EVERY background a field can sit on.
 *
 * OWNS      the proof, from the theme SOURCE (public/engine/screen.js THEMES, vendored, never forked), that the token as ui.js writes it
 *           (--edge pulled toward --ink by the written percentage) measures 3:1 or more on --card, --paper AND --panel in Light cream,
 *           Dark, Paper and Navy, and on the two unthemed page cards; and that the no-color-mix fallback value does too on Cream.
 * CALLED BY ci.yml (QA gate, beside ui-action-set); by hand: node e2e/field-edge.test.cjs  (FIELD_EDGE_MUTATE=raw measures the unmixed --edge: Cream --panel fails at 2.93)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Method    WCAG 2.x relative luminance; sRGB mix as color-mix(in srgb) does it (linear in the gamma-encoded channels).
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const pub = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
let failures = 0;
const check = (ok, message) => { console.log((ok ? '  ok ' : '  FAIL ') + message); if (!ok) failures++; };
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => { const [r, g, b] = channels(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, p) => '#' + channels(a).map((v, i) => Math.round(v * p + channels(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('');

const sandbox = { module: { exports: {} }, window: {}, self: {} };
sandbox.exports = sandbox.module.exports;
vm.createContext(sandbox);
vm.runInContext(pub('engine/screen.js'), sandbox);
const THEMES = (sandbox.module.exports.THEMES) || (sandbox.window.CBScreen && sandbox.window.CBScreen.THEMES) || (sandbox.self.CBScreen && sandbox.self.CBScreen.THEMES) || (sandbox.CBScreen && sandbox.CBScreen.THEMES);

const ui = pub('app/ui.js');
const written = /--field-edge:color-mix\(in srgb,var\(--edge,(#[0-9A-Fa-f]{6})\) (\d+)%,var\(--ink,(#[0-9A-Fa-f]{6})\)\)/.exec(ui);
const plain = /:root\{--field-edge:(#[0-9A-Fa-f]{6})\}/.exec(ui);
check(!!written && !!plain, 'ui.js writes --field-edge twice: a plain fallback and the color-mix of the theme --edge');
const percent = process.env.FIELD_EDGE_MUTATE === 'raw' ? 1 : Number(written[2]) / 100;
const edgeOf = (vars) => mix(vars['--edge'], vars['--ink'], percent);

console.log('every theme, every background a field can sit on');
['lightCream', 'dark', 'paper', 'navy'].forEach((key) => {
  const vars = THEMES[key].vars;
  const edge = edgeOf(vars);
  ['--card', '--paper', '--panel'].forEach((bg) => {
    const r = ratio(edge, vars[bg]);
    check(r >= 3, key + ' --field-edge ' + edge + ' on ' + bg + ' ' + vars[bg] + ' = ' + r.toFixed(2) + ':1 (needs 3)');
  });
});

console.log('unthemed pages and the no-color-mix fallback');
['#fffdf8', '#fbf6ec'].forEach((bg) => {
  const edge = mix(written[1], written[3], percent);
  check(ratio(edge, bg) >= 3, 'unthemed card ' + bg + ' with the fallbacks ' + edge + ' = ' + ratio(edge, bg).toFixed(2) + ':1');
});
const cream = THEMES.lightCream.vars;
['--card', '--paper', '--panel'].forEach((bg) => {
  check(ratio(plain[1], cream[bg]) >= 3, 'the plain fallback ' + plain[1] + ' on Cream ' + bg + ' = ' + ratio(plain[1], cream[bg]).toFixed(2) + ':1');
});
check(plain[1].toLowerCase() === mix(written[1], written[3], Number(written[2]) / 100).toLowerCase(), 'the plain fallback is the Cream mix, written out (they cannot drift apart)');
if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all passed');
