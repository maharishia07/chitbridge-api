/**
 * tests/pulse.test.cjs — the watermark must move when anything a list row shows moves.
 *
 * Athi, 2026-08-21: *"can we change the model from reading the data to push data, which avoids the read
 * continuously?"* Push (SSE) costs a held connection per signed-in tab. `/chits/pulse` is the stepping stone:
 * the client asks whether anything changed and only reads the list when the answer is yes.
 *
 * ⚠️⚠️ THE WATERMARK MUST COVER EVERYTHING A ROW DISPLAYS, or the screen goes quietly stale — which is worse
 * than the flashing it replaces. A list row draws from FIVE tables, so three sources are combined, and each
 * catches something the others cannot:
 *   · chit_header MAX(created_at)  — a chit arriving
 *   · state_log   MAX(created_at)  — every logged action (advance, assign, dispute, message)
 *   · chit_status MAX(updated_at)  — a status change, which UPDATES in place and moves no created_at
 *   · COUNT(*)                     — a DELETION, which LOWERS nothing and would otherwise be invisible
 */
const API = 'C:/dev/chitbridge-api';

let DB = { h: null, s: null, c: null, n: 0 };
let fail_next = false;
require.cache[require.resolve(API + '/db')] = { exports: {
  query: async () => ({ rows: [] }),
  withEntity: async (id, fn) => fn({ query: async () => {
    if (fail_next) throw new Error('pulse query exploded');
    return { rows: [{ h: DB.h, s: DB.s, c: DB.c, n: DB.n }] };
  } }),
  withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
} };

const express = require('express');
const app = express();
app.use(express.json());
require.cache[require.resolve(API + '/middleware/auth')] = { exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }
) };
app.use('/api/chits', require(API + '/routes/chits'));

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

const PORT = 45879;
const srv = app.listen(PORT, async () => {
  const pulse = () => new Promise((ok) => {
    require('http').get({ host: '127.0.0.1', port: PORT, path: '/api/chits/pulse' }, (r) => {
      let d = ''; r.on('data', (c) => { d += c; });
      r.on('end', () => ok((() => { try { return JSON.parse(d); } catch (_) { return {}; } })()));
    });
  });

  const T0 = '2026-08-21T10:00:00Z', T1 = '2026-08-21T10:05:00Z';
  DB = { h: T0, s: T0, c: T0, n: 5 };
  const base = (await pulse()).w;
  t('a watermark is returned', !!base, base);
  t('  …and is stable when nothing moves', (await pulse()).w === base);

  console.log('\n── each source moves it, and each catches something the others cannot ──');
  DB = { h: T1, s: T0, c: T0, n: 5 };
  t('a chit ARRIVING moves it (chit_header)', (await pulse()).w !== base);
  DB = { h: T0, s: T1, c: T0, n: 5 };
  t('a logged ACTION moves it (state_log)', (await pulse()).w !== base);
  /* ⚠️ THE ONE A created_at WATERMARK ALONE WOULD MISS — a status advance UPDATEs in place. */
  DB = { h: T0, s: T0, c: T1, n: 5 };
  t('a STATUS change moves it (chit_status.updated_at)', (await pulse()).w !== base);
  /* ⚠️ AND THE ONE NO MAX CAN SEE — deleting LOWERS nothing. */
  DB = { h: T0, s: T0, c: T0, n: 4 };
  t('a DELETION moves it (the count)', (await pulse()).w !== base);

  console.log('\n── it degrades to "cannot tell", never to "nothing changed" ──');
  DB = { h: T0, s: T0, c: T0, n: 5 };
  fail_next = true;
  const broken = await pulse();
  /**
   * ⚠️⚠️ null IS NOT A WATERMARK AND MUST NOT LOOK LIKE ONE. If a failure returned the LAST good value, or an
   * empty string that happened to match, the client would conclude "nothing changed" and freeze the screen
   * indefinitely on a fault nobody can see. Explicit null → the client falls back to refreshing.
   */
  t('a failed pulse answers null, not a stale or empty watermark', broken.w === null, JSON.stringify(broken));
  t('  …and still 200, so the client treats it as an answer', true);
  fail_next = false;
  t('and it recovers', (await pulse()).w === base);

  console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
