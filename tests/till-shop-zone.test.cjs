/* E-F-06 (till): every displayed time is in the SHOP's zone. A Sydney shop read on an IST device shows Sydney time. No browser. */
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const h = fs.readFileSync(__dirname + '/../tools/tally-connector/till.html', 'utf8');
const grab = (n) => new RegExp('function ' + n + '\\([\\s\\S]*?\\n}\\n').exec(h)[0];
const mk = (shop, tzChoice, device) => {
  const ctx = { Date, Intl, isNaN, cbQuiet() {}, shopPack: () => null, S: { shop }, localStorage: { getItem: () => tzChoice || null },
    window: { CBLocale: { timezone: () => device || 'Asia/Kolkata' } } };
  ctx.CBLocale = ctx.window.CBLocale; /* the till reads the bare global, as a browser's window is its global */
  vm.createContext(ctx);
  vm.runInContext(['shopTz', 'shopOwnTz', 'tzOpt'].map(grab).join('\n'), ctx);
  return ctx;
};
const at = '2026-11-21T09:00:00Z'; /* 20:00 in Sydney (AEDT +11), 14:30 in India */
const fmt = (c) => new Date(at).toLocaleTimeString('en-GB', c.tzOpt({ hour: '2-digit', minute: '2-digit', hour12: false }));
assert.strictEqual(fmt(mk({ timezone: 'Australia/Sydney' })), '20:00', 'AU shop on an IST device shows Sydney');
assert.strictEqual(fmt(mk({})), '14:30', 'no shop zone stated -> the device answer, as before');
assert.strictEqual(fmt(mk({ timezone: 'Australia/Sydney' }, 'Asia/Kolkata')), '14:30', "the person's own cb_tz choice wins");
assert.strictEqual(fmt(mk({ timezone: 'Not/AZone' })), '14:30', 'an unknown zone is ignored');
/* no displayed time left without the zone */
const bare = h.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\.toLocale(Date|Time)?String\(/.test(l) && !/tzOpt|moneyTag|1970, 0, 1/.test(l));
assert.deepStrictEqual(bare.map(([i]) => i), [], 'a time/date shown without the shop zone at till.html line(s) ' + bare.map(([i]) => i));
console.log('till-shop-zone ok · 5 checks');
