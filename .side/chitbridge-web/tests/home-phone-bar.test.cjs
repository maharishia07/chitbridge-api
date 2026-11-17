/**
 * tests/home-phone-bar.test.cjs - HOME DESIGN PASS (19 Oct 2026): the phone's FIVE tabs and where the tiles now sit.
 * Pass mark: docs/design/home-phone-bar/REQUIREMENT.md + NAV-MAP section 6 items 1-9 (Athi 19 Oct: Marketing in Selling, Assist in Running, Country and Conversion Lab tiles).
 * Runs the real shell.js in a stub window (its own sectionOf decides each tile's section) and reads the real manifest. No browser.
 * Run: node tests/home-phone-bar.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const win = { document: undefined, matchMedia: undefined };
win.window = win;
vm.runInNewContext(read('public/app/shell.js'), win);
const Shell = win.CBShell;
assert(Shell && typeof Shell.sectionOf === 'function', 'shell.js exports CBShell.sectionOf');

/* the bar: five tabs on a phone, seven areas on a laptop; More holds exactly Trade, Labs, Setup */
assert.strictEqual(JSON.stringify(Shell.PHONE_TABS), JSON.stringify(['home', 'selling', 'money', 'running', 'more']), 'five phone tabs, in order');
assert.strictEqual(JSON.stringify(Shell.PHONE_MORE), JSON.stringify(['trade', 'labs', 'setup']), 'More holds Trade, Labs, Setup');
assert.strictEqual(Shell.AREAS.length, 7, 'a laptop keeps the seven-button rail');
assert.strictEqual(Shell.WORDS.areas.more, 'More', 'the fifth tab has its word');
const src = read('public/app/shell.js');
assert(/\.cbsh-nv\[data-go=trade\],\.cbsh-nv\[data-go=labs\],\.cbsh-nv\[data-go=setup\]\{display:none\}/.test(src), 'the phone hides the Trade, Labs and Setup buttons');
assert(/data-go="more" data-testid="shell-nav-more"/.test(src), 'the More button is drawn');
assert(/\.cbsh-nv\{min-height:44px/.test(src), 'a 44 px touch target');
assert(/data-tab=more\] \.cbsh-sec\.trade/.test(src), 'the More tab shows the three sections');

/* the tiles: where each stands now */
const man = JSON.parse(read('public/app/manifest.json'));
const by = {}; man.entries.forEach((e) => { by[e.id] = e; });
const section = (id) => { assert(by[id], 'manifest has ' + id); return Shell.sectionOf(by[id]); };
const expect = {
  selling: ['till', 'catalogue', 'crm', 'marketing', 'storefront', 'disputes'],
  money: ['finance', 'accounts', 'reports', 'trend'],
  running: ['tasks', 'operations', 'employees', 'counters', 'coassist'],
  trade: ['kyb', 'documents', 'network'],
  labs: ['product-lab', 'offer-lab', 'combo-lab', 'network-lab', 'country-lab', 'conversion-lab'],
};
Object.keys(expect).forEach((a) => expect[a].forEach((id) => assert.strictEqual(section(id), a, id + ' stands in ' + a)));
['standards', 'shop', 'connectors', 'governance', 'account', 'plan'].forEach((id) => assert.strictEqual(section(id), 'setup', id + ' stands in Setup'));
assert.strictEqual(by.governance.name, 'Policy', 'one word: the tile that opens Policy is called Policy');
assert.strictEqual(by['combo-lab'].route, '/offer-lab-next.html?mode=combo', 'Combo Lab opens the Offer Lab in combo mode (no redirect hop)');
assert(!by.people && !by.trade && !by['tax-lab'], 'the People, Trade and Tax Lab LATER chips are gone');
assert.strictEqual(by['rail-lab'].name, 'Dispute Lab', 'the Rail Lab chip is the Dispute Lab');

/* every built tile with a page of its own opens a file that exists (a tile never opens a blank) */
man.entries.filter((e) => e.state === 'built' && e.route && !/\{bridge_id\}/.test(e.route)).forEach((e) => {
  const file = e.route.split(/[?#]/)[0].replace(/^\//, '');
  assert(fs.existsSync(path.join(root, 'public', file)), e.id + ' opens public/' + file);
});
/* max three taps: Home > tab > tile (two), Home > More > row > tile (three) - so every tile has a section the bar reaches */
man.entries.filter((e) => e.state === 'built' && e.route).forEach((e) => {
  const sec = Shell.sectionOf(e);
  assert(Shell.AREAS.includes(sec) && sec !== 'home', e.id + ' has a section on the bar (' + sec + ')');
});

/* the other Home moves: ONE waiting row, a greyed shop tile, the +n badge in words */
const idx = read('index.html');
assert(!/alert_\('ledger-accept'|alert_\('ledger-supplier'/.test(idx), 'Home draws ONE waiting row');
assert(/cbsh-box off/.test(src) && /noShop/.test(src), 'a shop tile with no shop id is greyed with its sentence');
console.log('home-phone-bar: all ok');
