/**
 * trips-headers.test.cjs — the round-trip counter answers the right people, and nobody else.
 *
 * ── ⚠️⚠️⚠️ TWO FAULTS THIS FILE STANDS AGAINST ───────────────────────────────────────────────────────────────
 *
 * 1 · IT EMITTED NOTHING FOR SIX DAYS. `lib/trips` wrapped `res.end` and is the FIRST middleware registered, so
 *     `compression` wrapped the wrapper; on the way out compression flushed the head first and `res.headersSent`
 *     was already true. Being first in the chain means being LAST to act. Now it patches `writeHead`, which
 *     fires when the headers are serialised, whoever is sending them.
 *     ⚠️ This only fails with `compression` in the stack — a test of trips alone passes on the broken code,
 *     which is presumably how it shipped. The compression layer IS the test.
 *
 * 2 · IT WAS ALL-OR-NOBODY. Athi, 2026-09-13: *"definitely for prod this feature has to be removed, or kept
 *     silent, or activated only for a few ids, id specific."* A diagnostic you can only have for everybody gets
 *     left on — which is exactly what happened the morning it was switched on.
 *
 * Run: node tests/trips-headers.test.cjs
 */
'use strict';
const express = require('express');
const compression = require('compression');

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

/** a fresh app per case, because the middleware reads the env when the request arrives */
function build(who) {
  delete require.cache[require.resolve('../lib/trips')];
  const trips = require('../lib/trips');
  const app = express();
  app.use((req, res, next) => { req.identity = { entity_id: who }; next(); });
  app.use(trips.middleware());
  /* ⚠ threshold 0 and a padded body: compression SKIPS small responses, and a skipped compressor does not
     reproduce fault 1 — the test would pass on the broken code for the wrong reason */
  app.use(compression({ threshold: 0 }));
  app.get('/t', (req, res) => { trips.tick('q'); trips.tick('q'); res.json({ ok: true, pad: 'x'.repeat(4000) }); });
  return app;
}

function once(app) {
  return new Promise((resolve) => {
    const srv = app.listen(0, async () => {
      const r = await fetch('http://127.0.0.1:' + srv.address().port + '/t');
      const out = { n: r.headers.get('x-db-trips'), ms: r.headers.get('x-db-ms') };
      srv.close(() => resolve(out));
    });
  });
}

const MINE = '11111111-1111-1111-1111-111111111111';
const YOURS = '22222222-2222-2222-2222-222222222222';

(async () => {
  console.log('\n══ TRIPS HEADERS · through compression, and only for the named ══\n');

  process.env.CB_TRIPS = '1';
  let r = await once(build(MINE));
  ok(r.n === '2', 'CB_TRIPS=1 · the count survives the layers above it (' + r.n + ')');
  ok(r.ms !== null && !isNaN(Number(r.ms)), 'CB_TRIPS=1 · the time is a number (' + r.ms + ')');

  delete process.env.CB_TRIPS;
  r = await once(build(MINE));
  ok(r.n === null && r.ms === null, 'unset · nothing is said at all — the production default');

  process.env.CB_TRIPS = '0';
  r = await once(build(MINE));
  ok(r.n === null && r.ms === null, '0 · still nothing');

  process.env.CB_TRIPS = MINE + ',' + '33333333-3333-3333-3333-333333333333';
  r = await once(build(MINE));
  ok(r.n === '2', 'a named entity is answered (' + r.n + ')');

  r = await once(build(YOURS));
  /* ⚠️ ABSENT, NOT ZERO. A header reading 0 would say "no database work happened", which is a different and
     false statement — and the panel is written to say "the server is not reporting" only when it is missing. */
  ok(r.n === null && r.ms === null, 'an entity NOT on the list gets no header at all, not a zero');

  delete process.env.CB_TRIPS;
  console.log('');
  /* ⚠ exitCode, never process.exit(), while an http server is closing — it aborts libuv mid-close */
  process.exitCode = bad ? 1 : 0;
})();
