/* CTR-158 — the till slip closes with the footer the shop saved in Print setup (the one bill-print prints); today's words only when none is saved.
   No DB, no browser: the page's slipFooterHTML and the route's slipFooterOf are lifted out and run. CTR158_MUTATE=1 puts the hard-coded words back and must fail. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const API = path.join(__dirname, '..');
let page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const route = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8').replace(/\r\n/g, '\n');
if (process.env.CTR158_MUTATE === '1') page = page.replace('    + slipFooterHTML(shop)\n', '    + \'<div style="text-align:center">Thank you · visit again</div><div style="text-align:center">Billed on ChitBridge</div>\'\n');
const grab = (src, n) => new RegExp('(?:async )?function ' + n + '\\([\\s\\S]*?\\n}\\n').exec(src)[0];
const slip = grab(page, 'slipHTML');
assert.ok(/slipFooterHTML\(shop\)/.test(slip) && !/Thank you · visit again/.test(slip), 'slipHTML still prints hard-coded footer words');
const ctx = { esc: (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;') };
vm.createContext(ctx);
vm.runInContext(grab(page, 'slipFooterHTML'), ctx);
assert.ok(/Come again, friend &amp; neighbour/.test(ctx.slipFooterHTML({ slip_footer: 'Come again, friend & neighbour' })), 'the saved footer is not printed');
assert.ok(!/Billed on ChitBridge/.test(ctx.slipFooterHTML({ slip_footer: 'Come again' })), 'the saved footer still carries the hard-coded brand line');
assert.strictEqual(ctx.slipFooterHTML({ slip_footer: '' }), '', 'an unticked footer prints nothing');
for (const none of [{}, { slip_footer: null }, null]) assert.ok(/Thank you · visit again/.test(ctx.slipFooterHTML(none)) && /Billed on ChitBridge/.test(ctx.slipFooterHTML(none)), "no saved footer must keep today's words");
/* the route: vault 'signature' rows footer + order → string | '' | null */
const mk = (vault) => new Function('require', 'log', grab(route, 'signatureRowsByTag') + grab(route, 'slipFooterOf') +'\nreturn slipFooterOf;')(() => ({ getVault: async () => vault }), { warn() {} });
const sig = (rows) => ({ sections: [{ type: 'signature', rows }] });
(async () => {
  assert.strictEqual(await mk(sig([{ tag: 'footer', value: ' Come   again ' }, { tag: 'order', value: 'trade_name,footer' }]))('e'), 'Come again');
  assert.strictEqual(await mk(sig([{ tag: 'footer', value: 'Come again' }, { tag: 'order', value: 'trade_name' }]))('e'), '', 'unticked');
  assert.strictEqual(await mk(sig([{ tag: 'order', value: 'trade_name,footer' }]))('e'), null, 'ticked with no words saved');
  assert.strictEqual(await mk({ sections: [] })('e'), null);
  assert.ok(/slip_footer: slipFooter,/.test(route), 'the snapshot shop block does not carry slip_footer');
  console.log('till-s4-ctr158-footer ok · 9 checks');
})().catch((e) => { console.error(e.message); process.exit(1); });
