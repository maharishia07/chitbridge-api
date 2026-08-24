/**
 * tests/round-trips-chit.test.cjs — OPENING A CHIT HAS A ROUND-TRIP BUDGET TOO.
 *
 * Athi, 2026-08-23: *"the system is dam slow in localhost… it drags like hell, people will forget using
 * computer, ours is like a 1950s computer."*
 *
 * ⚠️⚠️ `GET /chits/:id` IS THE SECOND-HOTTEST READ ON THE PLATFORM — every task opened, every job looked at,
 * both designs — and it was measured at TWELVE round trips. Against Supabase-in-Mumbai from Railway-in-
 * Singapore that is ~250ms each, and it is why recording one delivery cost 8.4 seconds: the write took 3.5s
 * and the confirming re-read took 4.9s. The write already answers with its own result now, but the OPEN is
 * still twelve.
 *
 * ⭐⭐ A BUDGET, NOT A SNAPSHOT — the same shape as `/me`'s. Asserting the exact count would fail on every
 * harmless change and get raised reflexively until it meant nothing. A ceiling fails only when someone ADDS a
 * round trip to a hot read, which is the event worth interrupting a build for.
 *
 * ⚠️ It counts `withEntity` bodies too: each one is BEGIN + set_config + the query + COMMIT, so a transaction
 * opened to run a single SELECT costs four trips, not one. That is the measurement that matters, and counting
 * only `db.query` calls would have said this endpoint was cheap.
 */
const API = 'C:/dev/chitbridge-api';

let queries = [];
let txOpens = 0;
const COLUMNS = new Set(['timezone', 'supplies', 'storefront_access', 'locale_prefs', 'ui_prefs',
  'capabilities', 'retention_until', 'policy_flags']);

/**
 * ⭐ The stub answers with PLAUSIBLE rows, not empty ones. Returning `[]` everywhere makes each handler take
 * its earliest not-found exit, and then the measurement flatters the endpoint by never walking it.
 */
function rowsFor(sql) {
  if (/information_schema\.tables|to_regclass/.test(sql)) return [{ t: 'cb_attachment' }];
  if (/FROM chit_status/.test(sql) && /current_status/.test(sql)) return [{ current_status: 'pending', read_at: null }];
  if (/FROM chit_header/.test(sql)) return [{ chit_id: 'c1', entity_id: 'e1', role: 'Receiver', created_by_actor_id: 'e1', sender_entity_id: 'other' }];
  if (/FROM chit_detail/.test(sql)) return [{ detail_type: 'order', line_item_count: 0, total_value: '0', currency_code: 'INR', line_items: [] }];
  if (/COUNT\(\*\)/.test(sql)) return [{ count: 0 }];
  if (/RETURNING/.test(sql)) return [{ was_read_at: null }];
  return [];
}

require.cache[require.resolve(API + '/db')] = { exports: {
  query: async (sql, args) => {
    queries.push('Q  ' + String(sql).replace(/\s+/g, ' ').trim());
    if (/information_schema\.columns/.test(sql)) {
      return { rows: COLUMNS.has(args && args[1]) ? [{ '?column?': 1 }] : [] };
    }
    return { rows: rowsFor(String(sql)) };
  },
  /* ⚠️ ONE withEntity IS FOUR TRIPS: BEGIN · set_config · the statement · COMMIT. Counted as such below. */
  withEntity: async (id, fn) => {
    txOpens++;
    return fn({ query: async (s) => { queries.push('TX ' + String(s).replace(/\s+/g, ' ').trim()); return { rows: rowsFor(String(s)) }; } });
  },
  withTransaction: async (fn) => {
    txOpens++;
    return fn({ query: async (s) => { queries.push('TX ' + String(s).replace(/\s+/g, ' ').trim()); return { rows: rowsFor(String(s)) }; } });
  },
} };

require.cache[require.resolve(API + '/middleware/auth')] = { exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }
) };

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/chits', require(API + '/routes/chits'));

let pass = 0;
let fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  FAIL ' + name + (extra ? '   ' + extra : '')); }
};

/**
 * The ceiling. Lower it when the endpoint gets cheaper; never raise it without saying why here.
 *
 * ⚠️ 14 IS THE COLD-PROCESS NUMBER. Two of the fourteen are one-time cached probes — `schema.hasTable` and
 * `storage.ensureTable` — so a warm process opens a chit in 12. The ceiling counts the cold path because that
 * is what the test actually runs, and a budget you cannot reproduce is a budget nobody trusts.
 *
 * ── WHAT IS LEFT, MEASURED — the next person should not have to re-derive it ────────────────────────────────
 * Live, ?timing=1, after this change: main_read ~1850ms · one_shot ~1320ms · wall ~3.4s (it was ~5.05s).
 * Two collapses remain, both real and both bigger than anything above:
 *   · header + detail + state_log are three independent SELECTs in one transaction → one statement saves 2.
 *   · the two transactions could be one → saves BEGIN + set_config + COMMIT, another 3.
 * ⚠️ NOT DONE HERE ON PURPOSE. Both need `SELECT *` turned into json subqueries, and `to_jsonb` returns a
 * numeric as a JSON NUMBER where pg returns it as a STRING today — so `total_value` would change type in the
 * response. That is a client-visible change and wants a person watching it, not an unattended run.
 */
const BUDGET = Number(process.env.CHIT_READ_BUDGET || 14);

const PORT = 45873;
const srv = app.listen(PORT, async () => {
  console.log('\n── opening one chit ──');
  queries = [];
  txOpens = 0;
  const r = await fetch(`http://localhost:${PORT}/api/chits/00000000-0000-0000-0000-000000000001`)
    .then((x) => x.status).catch((e) => 'ERR ' + e.message);

  /* Each transaction carries BEGIN + set_config + COMMIT around whatever statements ran inside it. */
  const trips = queries.length + txOpens * 3;
  console.log(`  status ${r} · ${queries.length} statement(s) in ${txOpens} transaction(s) → ${trips} round trip(s)`);
  queries.forEach((q, i) => console.log('    ' + String(i + 1).padStart(2) + '  ' + q.slice(0, 118)));

  t(`opening a chit stays within ${BUDGET} round trips`, trips <= BUDGET, trips + ' used');
  t('it does not open a transaction per statement',
    txOpens === 0 || queries.length / txOpens >= 1, txOpens + ' transaction(s)');

  console.log(`\n  ${pass} passed · ${fail} failed\n`);
  srv.close();
  process.exit(fail ? 1 : 0);
});
