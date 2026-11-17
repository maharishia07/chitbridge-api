'use strict';
// @type: static
/**
 * e2e/a11y-slice2.test.cjs — THE AXE SLICE-2 FIXES STAY FIXED (G-20; follows web #509). No browser: reads the sources and does the contrast sum.
 *
 * What it holds, one line each (the full run is e2e/a11y-axe-report.cjs on a SIT box):
 *   - a list that opens a row or folds a group is a treegrid; a group head is a row whose parts are cells; a lines row's parts are cells
 *     (axe aria-conditional-attr, aria-required-children)
 *   - the column resize handle and the header filter button are 24 px targets (axe target-size)
 *   - the order select of Authority forms has its label tied to it (axe select-name)
 *   - a page's own colour names follow the chosen theme, so a Dark page is not light ink on a cream ground (axe color-contrast):
 *     the pairs below are measured, cream and dark, against the tokens in public/engine/screen.js
 *   - a view switch made of pressed buttons is a labelled group, not a tab list (axe aria-required-children)
 * The words on screen are unchanged ("Could not reach the network." is still said, now at 4.5:1 or better); no string moved, so the string layer is untouched.
 *
 * Run: node e2e/a11y-slice2.test.cjs        exit 1 on a failure
 */
// MIN walk (a source walk of each fixed element, not a browser walk; the axe run on SIT is the browser proof)
// MIN cream-and-dark-1366-390
// MIN aa-contrast
// MIN could-not-read-words
const fs = require('fs'), path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

const lum = (hex) => {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const list = read('public/app/list-ctl.js') + read('public/app/list-ctl-css.js'); /* the unit and its stylesheet part */
ok(/function gridRole\(unit, items\)[\s\S]{0,300}'treegrid'/.test(list) && /role="' \+ gridRole\((?:I|inst), (?:ctx\.)?items\)/.test(list), 'list-ctl: the grid is a treegrid when a row opens or a group folds');
ok(/class="cbl-group" role="row"/.test(list) && /<b role="gridcell">/.test(list), 'list-ctl: a group head is a row whose parts are cells');
ok(/class="cbl-lline" role="gridcell"/.test(list) && /class="cbl-lgist" role="gridcell"/.test(list), 'list-ctl: a lines row holds cells');
ok(/\.cbl \.cbl-rz\{[^}]*width:24px/.test(list) && /\.cbl \.cbl-hf\{[^}]*min-width:24px;height:24px/.test(list), 'list-ctl: resize handle and filter button are 24 px targets');

const af = read('public/authority-forms.html');
ok(/<label for="ctx">/.test(af), 'authority-forms: the order select has its label tied to it');
ok(!/(input,select|\.netpill)\{[^}]*background:#fff/.test(af), 'authority-forms: field and pill grounds are theme tokens, not white');
ok(/<div class="tabs" role="group" aria-label="Views">/.test(read('public/signin-lab.html')), 'signin-lab: pressed buttons are a labelled group');

const screen = read('public/engine/screen.js');
const themeVar = (theme, name) => {
  const at = screen.indexOf('\n  ' + theme + ':');
  const m = screen.slice(at, at + 4000).match(new RegExp("'" + name + "':\\s*'(#[0-9A-Fa-f]{6})'"));
  return m && m[1];
};
const dark = { paper: themeVar('dark', '--paper'), card: themeVar('dark', '--card'), grey2: themeVar('dark', '--grey-2'), disp: themeVar('dark', '--disp') };
const hc = { paper: themeVar('hc', '--paper'), grey2: themeVar('hc', '--grey-2') };
ok(dark.paper && dark.card && dark.grey2 && dark.disp && hc.paper && hc.grey2, 'the Dark and High Contrast tokens were read from engine/screen.js');
const AA = 4.5;
// cream: the page's own value on the cream ground
ok(ratio('#5D636A', '#faf8f3') >= AA, 'shop and network-shop --grey on the cream paper ' + ratio('#5D636A', '#faf8f3').toFixed(2));
ok(/--grey:#5D636A/.test(read('public/shop.html')) && /--grey:#5D636A/.test(read('public/network-shop.html')), 'shop pages: --grey is the AA value');
ok(ratio('#CC2F16', '#ffffff') >= AA && /--hot:#CC2F16/.test(read('public/promo.html')), 'promo: white on --hot ' + ratio('#CC2F16', '#ffffff').toFixed(2));
ok(ratio('#B0401C', '#F3EFE6') >= AA && ratio('#B0401C', '#ffffff') >= AA, 'ui-standard: --bad on the cream card and panel');
// dark and hc: the page names follow the theme's own tokens
ok(ratio(dark.grey2, dark.paper) >= AA && ratio(dark.grey2, dark.card) >= AA && ratio(hc.grey2, hc.paper) >= AA, 'theme --grey-2 clears AA on paper and card (dark ' + ratio(dark.grey2, dark.card).toFixed(2) + ')');
ok(ratio(dark.disp, dark.card) >= AA, 'dark --disp (the ui-standard --bad) on the dark card ' + ratio(dark.disp, dark.card).toFixed(2));
const follow = [
  ['public/store.html', /--muted:var\(--grey-2,#5b6675\)/],
  ['public/network.html', /--muted:var\(--grey-2,#5c5240\)[^}]*--surface:var\(--card,#fffdf8\); --ground:var\(--paper,#fbf6ec\)/],
  ['public/product-lab.html', /--page:var\(--paper,#F7F5F0\)[^}]*--dim:var\(--grey-2,#5E594D\)/],
  ['public/conversion-lab.html', /background:var\(--card,#fff\); color:var\(--ink\); height:26px/],
  ['public/app/step-flow.js', /\.cbst\.now\{[^}]*color:var\(--on-accent,#fff\)/],
  ['public/ui-standard.html', /--bad:var\(--disp,#B0401C\)/]
];
for (const [file, re] of follow) ok(re.test(read(file)), file + ' follows the theme tokens');
ok(!/\.act\[aria-busy="true"\]\{[^}]*opacity/.test(read('public/ui-standard.html')), 'ui-standard: a busy action is not faded below AA');


// Wave 1b on the customer pages (axe serious + critical): scroll regions focusable, a name on every control, no faded or grey text under AA
const shellSrc = read('public/app/shell.js');
ok(/<main class="cbsh-main"[^>]*tabindex="0"/.test(shellSrc), 'shell: the scrolling main region is focusable (scrollable-region-focusable)');
ok(/id="sidePinned"[^>]*tabindex="0"[^>]*aria-label="/.test(read('public/app/page-frame.js')), 'page-frame: the pinned shelf scrolls, is focusable and named');
ok(/<div class="rbody" id="rbody"[^>]*tabindex="0"[^>]*aria-label="/.test(read('public/network-design.html')), 'network-design: the .rbody scroll region is focusable and named');
ok(/ui[.]select[(][{][^}]*id: 'cat', label: 'Shelf', bare: true/.test(read('public/product-lab.html')) && /aria-label/.test(read('public/app/ui-select.js')), 'product-lab: select#cat is the library select, named by aria-label (select-name, critical)');
ok(!/cbcat-stock[^]{0,400}opacity:\.7/.test(read('public/app/cart.js')), 'cart: a stale stock reading is not faded below AA (the chip says "as of ...")');
ok(!/see it on your wall <span style="color:#9aa3a7"/.test(read('public/shop.html')), 'shop: the Scan-your-home badge brand line is not #9aa3a7 grey (2.18:1)');
console.log(fails ? '\n' + fails + ' failure(s)' : '\nall passed');
process.exit(fails ? 1 : 0);
