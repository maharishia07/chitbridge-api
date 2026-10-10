/**
 * tests/till-rail.test.cjs — THE TILL'S LEFT RAIL (T2i, M207–M209): Expense in, Labs out · one layout switch · the one avatar.
 * Static + a vm slice of the real till.html functions (modeNow / modeCycle / modeSet) — no browser, no network.
 * Run: node tests/till-rail.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').split('\r\n').join('\n');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

/* M207 — the ops that stand on the rail */
const ops = (src.match(/^  \{ id: '[\w-]+',.*$/gm) || []).filter((l) => /fn: '/.test(l));
const rail = ops.filter((l) => /\brail: true\b/.test(l)).map((l) => /id: '([\w-]+)'/.exec(l)[1]);
ok(rail.length <= 7, 'the rail stands at most seven: ' + rail.join(','));
ok(rail.includes('expense'), 'Expense is on the rail');
ok(!rail.includes('labs'), 'Labs is off the rail');
const exp = ops.find((l) => /id: 'expense'/.test(l));
ok(/fn: 'expOpen'/.test(exp), 'Expense opens the existing expOpen()');
ok(/id: 'labs',.*fn: 'openLabs'/.test(ops.find((l) => /id: 'labs'/.test(l))), 'Labs is still declared (openLabs)');
ok(/id: 'pricing'[^\n]*ops: \['productlab', 'offerlab', 'combolab'\]/.test(src), 'Labs stay reachable in the Menu (pricing section)');
ok(/aria-disabled="true"/.test(src) && /EXP_WHYNOT : ''/.test(src), 'a refused Expense is greyed with its sentence');

/* M208 — the layout switch drives CBScreen through screenSet, the store Settings › Screen writes */
const a = src.indexOf('var MODES = {'), b = src.indexOf('/** ⭐ SHAPE FOLLOWS LAYOUT');
ok(a > 0 && b > a, 'the mode block is there');
const calls = [];
const ctx = { CART: [], STYLE_PEND: null, window: { CBScreen: { LAYOUTS: { vertical: { label: 'Vertical' }, tablet: { label: 'Tablet' } } } },
  screenSet: (p) => { calls.push(['screenSet', p]); ctx.LAYOUT = p.layout; }, layoutShapeFollow() {}, densityApply() {}, paintSide() {}, toastLine: () => {}, LAYOUT: 'horizontal',
  screenCfg: () => ({ layout: ctx.LAYOUT }), Object, String };
ctx.CBScreen = ctx.window.CBScreen;
vm.createContext(ctx); vm.runInContext(src.slice(a, b), ctx);
ok(ctx.modeNow().key === 'desktop' && ctx.modeNow().next === 'tablet', 'horizontal reads as Desktop');
ctx.modeCycle(); ok(ctx.LAYOUT === 'tablet' && ctx.modeNow().label === 'Tablet', 'Desktop → Tablet');
ctx.modeCycle(); ok(ctx.LAYOUT === 'phone' && ctx.modeNow().key === 'phone', 'Tablet → Phone');
ctx.modeCycle(); ok(ctx.LAYOUT === 'horizontal', 'Phone → Desktop');
ctx.LAYOUT = 'vertical'; ok(ctx.modeNow().label === 'Vertical' && ctx.modeNow().next === 'desktop', 'a kiosk layout is named, and one tap returns to Desktop');
ctx.LAYOUT = 'horizontal'; ctx.CART = [1]; calls.length = 0; ctx.modeCycle();
ok(!calls.length && ctx.STYLE_PEND && ctx.STYLE_PEND.layout === 'tablet', 'a bill in hand holds the change (the styleApply rule)');
ok(!/localStorage[^\n]*layout|ls\.set\([^)]*layout/i.test(src.slice(a, b)), 'the switch keeps no layout store of its own');
ok(/data-testid="till-side-layout"[^;]*aria-label=[^;]*title=|data-testid="till-side-layout" data-ic="layout-mode" title="[^\n]*aria-label=/.test(src), 'the switch has aria-label + title');

/* M209 — the one avatar */
ok(/<script src="\/app\/avatar\.js">/.test(src), 'avatar.js is loaded');
ok(/id="cb-avatar"/.test(src) && /CBAvatar\.mount\(slot/.test(src), 'the rail foot mounts CBAvatar');
ok(!/(?:^|[^.\w])CBAvatar\s*=(?!=)|root\.CBAvatar\s*=(?!=)|function\s+buildAvatar/.test(src), 'no second avatar builder on the till');
ok(/onSignOut: function\(\)\{ usignOut\(\); \}/.test(src), 'sign out is the counter shift sign-out');
console.log('till-rail: ' + n + ' checks ok');
