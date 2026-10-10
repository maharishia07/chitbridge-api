/* M192 — "since" for a sign-in of an earlier day says so. Extracts sinceWord/hhmm from till.html; no browser. */
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const h = fs.readFileSync(__dirname + '/../tools/tally-connector/till.html', 'utf8');
const grab = n => new RegExp('function ' + n + '\\([\\s\\S]*?\\n}\\n').exec(h)[0];
const ctx = { Date, window: {}, shopTz: () => 'Asia/Kolkata' };
vm.createContext(ctx);
vm.runInContext(['tzOpt', 'hhmm', 'sinceWord'].map(grab).join('\n'), ctx);
const now = Date.now();
assert.ok(/^\d\d:\d\d$/.test(ctx.sinceWord(now - 60000)) || /^yesterday /.test(ctx.sinceWord(now - 60000)));
assert.ok(/^yesterday \d\d:\d\d$/.test(ctx.sinceWord(now - 86400000)));
assert.ok(/^\d\d \w{3} \d\d:\d\d$/.test(ctx.sinceWord(now - 5 * 86400000)));
console.log('till-since-word ok');
