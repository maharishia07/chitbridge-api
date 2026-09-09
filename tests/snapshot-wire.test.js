/**
 * snapshot-wire.test.js — WHAT THE COUNTER ACTUALLY RECEIVES (2026-09-08).
 *
 * ⚠️⚠️ THE BUG THIS EXISTS FOR. Athi: *"no, tax is not there."* `taxShelf.readShelf()` returns `slabs` as a **Map**, and every
 * in-process caller hands it straight to `taxSlab.resolve()`, which accepts a Map — so it was correct in four places. This route
 * does not call a function with it; it puts it on the wire, and `JSON.stringify(new Map())` is `{}`. Every snapshot the till had
 * ever taken carried `slabs: {}`. No rate resolved on any product, no GST on any bill, nothing thrown, nothing logged.
 *
 * The lesson is narrow and worth keeping: **a value that crosses JSON must be checked AFTER it crosses.** Reading the code proves
 * nothing here — the code was right everywhere except at the one boundary that serialises.
 *
 * Run: node tests/snapshot-wire.test.js   · no DB, no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const taxSlab = require(path.join(API, 'lib', 'tax-slab.js'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('— what survives the wire —');

it('⚠️⚠️ a Map becomes {} in JSON — the shape that cost the counter its tax', () => {
  const m = taxSlab.indexSlabs([{ definition_id: 'gst-5', name: 'GST 5%', rate: 5 }]);
  assert.ok(m instanceof Map, 'indexSlabs no longer returns a Map — this guard may be over');
  assert.strictEqual(JSON.stringify({ slabs: m }), '{"slabs":{}}');
});

it('⭐ the snapshot converts it, so the slabs reach the till as rows', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  /* ⚠️ read the CODE line, not the comment above it that quotes the old broken shape — an anchor that matches prose proves nothing */
  const line = src.split(/\r?\n/).filter(function (l) { return /^\s*slabs:/.test(l); })[0] || '';
  assert.ok(/shelf\.slabs instanceof Map/.test(line), 'the snapshot sends readShelf\'s slabs without unwrapping the Map: ' + line.trim());
  assert.ok(/\[\.\.\.shelf\.slabs\.values\(\)\]/.test(line), 'and it must send the VALUES, not the Map');
});

it('⭐⭐ and a rate resolves from what the wire actually delivers', () => {
  const m = taxSlab.indexSlabs([{ definition_id: 'gst-5', name: 'GST 5%', rate: 5 },
                                { definition_id: 'gst-18', name: 'GST 18%', rate: 18 }]);
  /* exactly what the route now does, then exactly what JSON does to it */
  const onTheWire = JSON.parse(JSON.stringify({ slabs: [...m.values()] }));
  assert.strictEqual(onTheWire.slabs.length, 2, 'the slabs did not survive the crossing');
  const r = taxSlab.resolve({ item_data: { name: 'Masala', tax_slab: 'gst-5' }, face: {}, slabs: onTheWire.slabs, categories: [] });
  assert.strictEqual(r.rate, 5, 'a product citing gst-5 still has no rate after the wire');
  assert.strictEqual(r.source, 'product');
});

it('⚠️ the OLD shape resolves to nothing — which is what a shop saw, in silence', () => {
  const m = taxSlab.indexSlabs([{ definition_id: 'gst-5', name: 'GST 5%', rate: 5 }]);
  const asItWas = JSON.parse(JSON.stringify({ slabs: m }));
  const r = taxSlab.resolve({ item_data: { name: 'Masala', tax_slab: 'gst-5' }, face: {}, slabs: asItWas.slabs, categories: [] });
  assert.strictEqual(r.rate, null, 'the old shape must be shown to fail, or this test proves nothing');
  assert.strictEqual(r.unresolved, true);
  assert.strictEqual(r.cited, 'gst-5', 'and it knew which slab it could not find — nobody was reading');
});

it('a shop with no shelf at all still gets an array, never null', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  assert.ok(src.indexOf("((shelf && shelf.slabs) || [])") > 0, 'the fallback must stay an array — the counter does .length on it');
});

it('⚠️⚠️ the snapshot says how many products the shop HAS — a delete is invisible to a delta', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  /**
   * ⚠️ NO REGEX HERE, ON PURPOSE. This assertion was written as /^s*total:/m — the backslash of \s was eaten on its way into
   * the file, leaving a pattern that can never match, so the guard failed on correct code and would have been "fixed" by
   * deleting it. A line filter says the same thing and cannot be damaged in transit.
   */
  const carries = src.split(/\r?\n/).some((l) => l.trim().indexOf('total:') === 0);
  assert.ok(carries, 'the snapshot no longer carries a total; a hard delete becomes invisible again');
  assert.ok(src.indexOf("NOT IN ('unavailable', 'redundant', 'retired')") > 0,
    'the count must exclude exactly the blocked statuses');
});

it('⭐⭐ and that SQL agrees with isOfferable for every status a row can hold', () => {
  const itemstatus = require(path.join(API, 'lib', 'itemstatus.js'));
  /* what the SQL does, in JS: COALESCE(NULLIF(btrim(lower(status)),''),'available') NOT IN (blocked) */
  const BLOCKED = ['unavailable', 'redundant', 'retired'];
  const sqlSays = (raw) => {
    const v = String(raw == null ? '' : raw).trim().toLowerCase();
    return BLOCKED.indexOf(v === '' ? 'available' : v) < 0;
  };
  /* ⚠️ the unknown and the blank are the cases that matter: statusOf() falls back to 'available', so a row that never had the
     field IS sellable. A count that required status='available' would under-count every such row, and the counter would then
     decide its copy was wrong and re-read the whole shop on every single refresh, for ever. */
  for (const raw of ['available', 'unavailable', 'redundant', 'retired', '', null, undefined, '  AVAILABLE  ', 'Retired', 'nonsense'])
    assert.strictEqual(sqlSays(raw), itemstatus.isOfferable({ status: raw }),
      'SQL and isOfferable disagree about status ' + JSON.stringify(raw));
});

it('⭐ the counter refuses a merge that does not add up', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf('snap.items.length !== snap.total') > 0,
    'the counter no longer checks its merged copy against the shop own count');
  const at = page.indexOf('snap.items.length !== snap.total');
  const after = page.slice(at, at + 400);
  assert.ok(after.indexOf('/api/till/snapshot') > 0 && after.indexOf('rebuilt') > 0,
    'on a mismatch it must take the WHOLE shop again, not patch around it');
});

console.log(pass + ' checks');
