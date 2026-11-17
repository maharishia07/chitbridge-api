'use strict';
// @type: unit
/**
 * polish-r-locale.test.cjs - l16 polish R09: shopDay/shopStamp (helpers.js) write a day and a moment in the shop's locale, never ISO and never the browser's order.
 * CALLED BY by hand / sit-box-run e2e:  node e2e/polish-r-locale.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const pub = path.join(__dirname, '..', 'public');
const store = {};
const win = { localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, navigator: { language: 'en-US', languages: ['en-US'] }, document: {}, addEventListener() {}, CB_SHOP_TZ: 'Australia/Sydney' };
win.window = win; win.self = win; win.globalThis = win;
const ctx = vm.createContext(Object.assign(win, { console, Intl, Date, Math }));
vm.runInContext(fs.readFileSync(path.join(pub, 'engine', 'locale.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(pub, 'app', 'helpers.js'), 'utf8') + '\nthis.shopDay = shopDay; this.shopStamp = shopStamp;', ctx);
ctx.CBLocale.setRegion('AU');
let bad = 0;
const t = (name, got, want) => { const ok = got === want; if (!ok) bad++; console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
t('bare day, AU', ctx.shopDay('2026-11-15'), '15 Nov 2026');
t('moment, AU, Sydney', ctx.shopStamp('2026-11-15T02:36:00Z').replace(/\s/g, ' '), '15 Nov 2026, 1:36 pm');
t('empty is the dash', ctx.shopDay(''), '—');
t('garbage is kept, not invented', ctx.shopDay('soon'), 'soon');
/* 2001 bug: V8 gives a year-less string the year 2001 (the api sent String(Date).slice(0,10) = "Thu Oct 08") */
['Thu Oct 08', 'Oct 8', '8 Oct'].forEach((v) => t('year-less "' + v + '" is never a day', ctx.CBLocale.date(v), ''));
t('ISO day', ctx.CBLocale.date('2026-10-08'), '08 Oct 2026');
t('ISO moment', ctx.CBLocale.date('2026-10-08T00:00:00.000Z'), '08 Oct 2026');
t('day with words and year', ctx.CBLocale.date('8 Oct 2026'), '08 Oct 2026');
t('epoch ms', ctx.CBLocale.date(Date.UTC(2026, 9, 8, 12)), '08 Oct 2026');
t('shopDay of a year-less string is kept, not 2001', ctx.shopDay('Thu Oct 08').indexOf('2001'), -1);
console.log('\n  checks · ' + bad + ' failed');
process.exit(bad ? 1 : 0);
