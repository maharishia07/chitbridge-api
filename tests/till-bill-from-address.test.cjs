/* F-43 — the till opened by "Bill it" on the Tasks & Orders page (/till.html?bill=<chit_id>) goes to Sell and bills THAT order through tasksBill,
   once, and takes ?bill= off the address. It used to open in the last-held mode (Receive) and bill nothing. Lifts the two functions from the master; no network. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
function fn(name, async_) {
  const head = (async_ ? 'async function ' : 'function ') + name + '(';
  const at = src.indexOf('\n' + head); assert(at > 0, name + ' is in till.html');
  const rest = src.slice(at + 1);
  return rest.slice(0, rest.search(/\n(?:\/\*\*|async function |function )/));
}
function run(search, mode) {
  const log = { mode, billed: [], url: null };
  const env = { location: { search, pathname: '/till.html', hash: '' }, history: { replaceState: (a, b, u) => { log.url = u; } }, MODE: mode, cbQuiet: () => {}, tasksBill: async (id) => { log.billed.push(id); } };
  env.setMode = (m) => { env.MODE = m; };
  const body = fn('billAskedId') + '\n' + fn('billFromAddress', true) + '\nreturn billFromAddress;';
  const f = new Function(...Object.keys(env), body)(...Object.values(env));
  return f().then(() => { log.mode = env.MODE; return log; });
}
(async () => {
  let r = await run('?bill=ord-12345678', 'receive');
  assert.deepStrictEqual(r.billed, ['ord-12345678'], 'the named order is billed');
  assert.strictEqual(r.mode, 'sell', 'a saved Receive mode no longer wins');
  assert.strictEqual(r.url, '/till.html', '?bill= is taken off the address');
  r = await run('?dev=1&bill=ord-12345678', 'despatch');
  assert.strictEqual(r.url, '/till.html?dev=1', 'other query words stay');
  r = await run('', 'receive');
  assert.deepStrictEqual(r.billed, [], 'no ?bill=, nothing billed');
  assert.strictEqual(r.mode, 'receive', 'no ?bill=, the mode is left alone');
  r = await run('?bill=<script>', 'sell');
  assert.deepStrictEqual(r.billed, [], 'a non-id value is ignored');
  assert(/TILL_BOOT\.then\(billFromAddress\)/.test(src), 'the boot calls it after the shop is loaded');
  console.log('till-bill-from-address ok');
})().catch((e) => { console.error(e); process.exit(1); });
