'use strict';
/** FW-40 (walk 25 Nov): Home > Sell opened the till in Receive ("What arrived?") because the mode lived in localStorage for ever. Now: a fresh open is Sell, ?mode= may ask, a reload in the same tab keeps the pick. Run: node tests/till-start-mode-1130.test.cjs */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
const a = html.indexOf('function startMode()'); let d = 0, i = html.indexOf('{', a), end;
for (let j = i; j < html.length; j++) { if (html[j] === '{') d++; if (html[j] === '}' && --d === 0) { end = j + 1; break; } }
function run(search, tab) { const c = { OPS: ['sell', 'receive', 'despatch', 'maintain'], location: { search }, sessionStorage: { getItem: () => tab } }; vm.createContext(c); vm.runInContext(html.slice(a, end) + '\nthis.r = startMode();', c); return c.r; }
assert.strictEqual(run('', null), 'sell', 'a fresh open is Sell');
assert.strictEqual(run('', 'receive'), 'receive', 'a reload in the same tab keeps the pick');
assert.strictEqual(run('?mode=receive', null), 'receive', 'a link may ask');
assert.strictEqual(run('?mode=bogus', null), 'sell', 'an unknown ask is ignored');
assert(/setMode\(startMode\(\)\)/.test(html) && !/setMode\(ls\.get\('cb_till_mode'/.test(html), 'the start no longer reads the device-long key');
console.log('ok fw40');
