/**
 * trips-headers.test.cjs — the round-trip counter's headers must survive every layer above it.
 *
 * ── ⚠️⚠️⚠️ WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────────
 *
 * `lib/trips` counted correctly from 2026-09-07 and emitted NOTHING for six days. It wrapped `res.end`, and it
 * is the FIRST middleware registered — so `compression`, registered after it, wrapped the wrapper. On the way
 * out compression's version ran first, flushed the head, and only then called ours, by which time
 * `res.headersSent` was true and the guard skipped every single time.
 *
 * ⭐ BEING FIRST IN THE CHAIN MEANS BEING LAST TO ACT. That is the lesson, and it is not visible by reading
 * either file on its own — which is exactly why this test stands the two of them up together.
 *
 * ⚠️ IT ONLY FAILS WITH `compression` IN THE STACK. A test of trips alone passes on the broken version, which
 * is presumably how it shipped. The compression layer is the test.
 *
 * Run: node tests/trips-headers.test.cjs
 */
'use strict';
process.env.CB_TRIPS = '1';
const express = require('express');
const compression = require('compression');
const trips = require('../lib/trips');

const app = express();
app.use(trips.middleware());
/* ⚠ threshold 0 and a padded body: compression skips small responses, and a skipped compressor does not
   reproduce the fault — the test would pass on the broken code for the wrong reason */
app.use(compression({ threshold: 0 }));
app.get('/t', (req, res) => { trips.tick('q'); trips.tick('q'); res.json({ ok: true, pad: 'x'.repeat(4000) }); });

const srv = app.listen(0, async () => {
  let bad = 0;
  try {
    const port = srv.address().port;
    const r = await fetch('http://127.0.0.1:' + port + '/t');
    const n = r.headers.get('x-db-trips');
    const ms = r.headers.get('x-db-ms');
    console.log('\n══ TRIPS HEADERS · through compression ══\n');
    if (n !== '2') { console.log('  ✗ X-DB-Trips is ' + n + ', expected 2'); bad++; }
    else console.log('  ✓ X-DB-Trips survives the layers above it (2)');
    if (ms === null || isNaN(Number(ms))) { console.log('  ✗ X-DB-Ms is ' + ms); bad++; }
    else console.log('  ✓ X-DB-Ms is a number (' + ms + ')');
  } catch (e) {
    console.log('  ✗ ' + (e && e.message)); bad++;
  }
  srv.close();
  console.log('');
  process.exit(bad ? 1 : 0);
});
