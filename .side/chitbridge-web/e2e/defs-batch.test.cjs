/**
 * defs-batch.test.cjs — the kinds asked for in one tick must travel in ONE call.
 *
 * ── ⭐⭐ WHY ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Measured with CB_TRIPS on, 2026-09-13: opening the Catalogue called /api/definitions SEVEN times, each ~65 ms
 * inside the server for 273–642 ms of wall time and ZERO database round trips. Nearly all of it was the wire.
 *
 * ⚠️ THE THREE THINGS THAT WOULD SILENTLY UNDO IT, each asserted below, because none of them shows up as an
 * error — the app keeps working and just goes back to being slow, or worse, goes stale:
 *   1. the tick's kinds not actually coalescing
 *   2. a kind with NO definitions not being cached as empty → every render asks again, forever
 *   3. a FORCED refresh joining a batch composed before the change it exists to pick up
 *
 * Run: node e2e/defs-batch.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'core.js'), 'utf8');
const i = src.indexOf('var _DEFS = {};');
const j = src.indexOf('function cbDefsCached');
if (i < 0 || j < 0) throw new Error('cbDefsLive block not found in core.js');
const block = src.slice(i, src.indexOf('\n', src.indexOf('}', j)));

const calls = [];
const sandbox = {
  console,
  api: (key, opts) => {
    calls.push((opts && opts.query) || {});
    const kinds = String(((opts && opts.query) || {}).kind || '').split(',').filter(Boolean);
    /* the server answers only for kinds that HAVE rows — 'empty' deliberately returns none */
    const definitions = [];
    kinds.forEach((k) => { if (k !== 'empty') definitions.push({ kind: k, definition_id: k + '-1', name: k }); });
    return Promise.resolve({ definitions });
  },
};
vm.createContext(sandbox);
vm.runInContext(block + '\nthis.cbDefsLive = cbDefsLive; this.cbDefsCached = cbDefsCached;', sandbox);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

(async () => {
  console.log('\n══ DEFINITIONS · one tick, one call ══\n');

  /* 1 · five kinds in one synchronous run */
  const got = await Promise.all(
    ['tax', 'category', 'pricing', 'ordermodel', 'empty'].map((k) => sandbox.cbDefsLive(k)));
  ok(calls.length === 1, 'five kinds asked in one tick made ' + calls.length + ' call(s), expected 1');
  ok(String(calls[0] && calls[0].kind) === 'tax,category,pricing,ordermodel,empty',
    'they went as one kind list (' + (calls[0] && calls[0].kind) + ')');
  ok(got[0].length === 1 && got[0][0].kind === 'tax', 'each caller got back only its own kind');

  /* 2 · a kind the server has nothing for is cached as empty, not left unfetched */
  ok(Array.isArray(sandbox.cbDefsCached('empty')), 'a kind with no rows is cached as [] and not re-asked');
  await sandbox.cbDefsLive('empty');
  ok(calls.length === 1, 'asking for the empty kind again made no new call (' + calls.length + ')');

  /* 3 · a forced refresh goes on its own, never on a batch composed before the change */
  const before = calls.length;
  sandbox.cbDefsLive('category');            /* queues a fresh batch */
  await sandbox.cbDefsLive('tax', true);     /* must NOT ride on it */
  ok(calls.length === before + 1 || calls.length === before + 2,
    'the forced refresh issued its own call');
  const forced = calls[before] || {};
  ok(String(forced.kind) === 'tax', 'and it asked for tax alone (' + forced.kind + ')');

  console.log('');
  process.exitCode = bad ? 1 : 0;
})();
