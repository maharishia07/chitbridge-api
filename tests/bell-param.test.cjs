/**
 * bell-param.test.cjs — EVERY PAGE THAT OPENS THE BELL CAN ACTUALLY HEAR IT.
 *
 * Found 2026-09-17, two faults on one path, both silent:
 *   1 routes/events.js read the ticket from ?t=; the counter and the shop screen sent ?ticket= — the stream answered 401 and
 *     the page quietly fell back to its fifteen-minute timer.
 *   2 lib/events.js NAMES its events ("event: cb"); the counter and the shop screen listened with onmessage, which only ever
 *     sees UNNAMED events — so even a connected stream was never heard.
 * A brand's offer change sat in every store's snapshot while no counter heard of it.
 *
 * Run: node tests/bell-param.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ' + name); pass++; } catch (e) { console.log('  FAIL ' + name + '\n      ' + e.message); fail++; } };

const ROOT = path.join(__dirname, '..');
const events = fs.readFileSync(path.join(ROOT, 'routes', 'events.js'), 'utf8');
const accepted = [...events.matchAll(/req\.query\.([a-z_]+)/g)].map((m) => m[1]);
const lib = fs.readFileSync(path.join(ROOT, 'lib', 'events.js'), 'utf8');
const named = [...new Set([...lib.matchAll(/event: ([a-z_]+)/g)].map((m) => m[1]).filter((n) => n !== 'hello'))];

const clients = [];
const scan = (dir, re) => {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory() || !re.test(f)) continue;
    const src = fs.readFileSync(full, 'utf8');
    for (const m of src.matchAll(/events\/stream\?([a-z_]+)=/g)) clients.push({ file: path.relative(ROOT, full), param: m[1], src });
  }
};
scan(path.join(ROOT, 'tools', 'tally-connector'), /\.html$/);
const WEB = path.join(ROOT, '..', 'chitbridge-web', 'public');
scan(WEB, /\.html$/);
scan(path.join(WEB, 'app'), /\.js$/);

console.log('\nthe bell · every page can hear it');
t('the stream reads a ticket from the query at all', () => {
  assert.ok(accepted.length, 'routes/events.js reads no ticket from the query');
});
t('some page opens the bell (or this guard is guarding nothing)', () => {
  assert.ok(clients.length >= 2, 'found ' + clients.length + ' pages opening the bell');
});
t('⚠️⚠️ every page asks with a name the stream accepts', () => {
  const bad = clients.filter((c) => accepted.indexOf(c.param) < 0).map((c) => c.file + ' ?' + c.param + '=');
  assert.deepStrictEqual(bad, [], 'these pages ask with a name the stream never reads — they will be refused silently');
});
t('the server names the events it pushes', () => {
  assert.ok(named.length, 'no named event found in lib/events.js');
});
t('⚠️⚠️ every page that opens the bell listens for those events BY NAME', () => {
  const deaf = clients.filter((c) => !named.some((n) => c.src.indexOf("addEventListener('" + n + "'") >= 0)).map((c) => c.file);
  assert.deepStrictEqual([...new Set(deaf)], [], 'these pages open the bell and can never hear it (onmessage sees no named event)');
});
console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
