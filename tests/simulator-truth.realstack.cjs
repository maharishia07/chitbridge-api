'use strict';
/**
 * tests/simulator-truth.realstack.cjs — TOUR TRUTH, on the LOCAL stack (T2: real Postgres; API-STANDARD R2-10, API-4 sweep of routes/simulator.js).
 *
 * OWNS      one case per route and per id surface of the /tour page's three PUBLIC routes, on real rows (the stand-in db of tests/api-problem-simulator.test.cjs MODELS the foreign key and the column types; here
 *           the real database answers). No route has an id in its path, all three are signed out (so there is no "another shop") and none is a money write; the id surface is the body's `leadId`:
 *   SIM-01  GET /content with no credential answers the six lists, and a bearer that means nothing changes nothing
 *   SIM-02  POST /lead stores ONE sim_leads row (e-mail lower-cased, no org stored as null) and answers { token, leadId }; the token is no platform credential: a signed-in route refuses it (S1)
 *   SIM-03  POST /feedback with the lead id the gate gave stores a sim_feedback row under that lead; with none, lead_id is null
 *   SIM-04  a refused write stores nothing (a name under two letters, an e-mail without an @, a blank message)
 *   SIM-05  POST /feedback rating: a whole number is stored, 3.5 is the column's own refusal (22P02) and the generic 500, and nothing is written
 *   SIM-06  gap: the foreign-key oracle. A real lead id answers 200; a well-formed uuid nobody holds is the key's 23503 and a 36-character non-uuid is the cast's 22P02, both the generic 500. A signed-out caller
 *           can therefore tell whether a uuid is a lead (rated LOW: uuids are random and never listed). Listed for cb-security; the principle (every lead id answers alike) is the expectation
 * CALLED BY the S41 job (it picks up every *-truth.realstack.cjs) · by hand on the local stack. NOT run on the laptop that wrote it (no Docker there): written, runs in S41.
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/simulator-truth.realstack.cjs   (one realstack file at a time on :3100)
 * Every value is obviously made up (`Test Lead`, `…@example.invalid`): the rows it leaves in the LOCAL database carry no one's data.
 * CARD qa/offline-guards
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, finish } = H;
const RUN = 'sm' + (Date.now() % 1e10).toString(36);
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';
const DASHES = '-'.repeat(36);
let pg = null;

/** an answer as it is compared: status and the words, the per-request id left out (it differs between any two answers) */
const same = (left, right) => left.status === right.status && JSON.stringify(Object.assign({}, left.b, { request_id: null })) === JSON.stringify(Object.assign({}, right.b, { request_id: null }));
const leadsOf = async (email) => (await pg.query('SELECT id, name, email, org FROM sim_leads WHERE email = $1', [email])).rows;
const feedbackOf = async (message) => (await pg.query('SELECT lead_id, section, rating, message FROM sim_feedback WHERE message = $1', [message])).rows;
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
const signUp = (name, email, org) => j('/api/simulator/lead', { method: 'POST', body: { name, email, org } });

(async () => {
  console.log('\n── tour truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    await kase('SIM-01', 'GET /content: six lists with no sign-in, and a bearer that means nothing changes nothing', async () => {
      const plain = ok(await j('/api/simulator/content'), 'content');
      expect(['layers', 'items', 'shapes', 'rules', 'compare', 'usps'].every((name) => Array.isArray(plain.b[name])), 'the six lists: ' + Object.keys(plain.b));
      const bearer = ok(await j('/api/simulator/content', { token: 'not-a-token' }), 'content with a bearer');
      expect(JSON.stringify(bearer.b) === JSON.stringify(plain.b), 'a bearer changed the answer');
    });

    const email = 'lead-' + RUN + '@example.invalid';
    let gate = null;
    await kase('SIM-02', 'POST /lead stores one row and mints a token the platform does not accept (S1)', async () => {
      gate = ok(await signUp('Test Lead', '  Lead-' + RUN + '@Example.INVALID ', undefined), 'lead').b;
      expect(typeof gate.token === 'string' && /^[0-9a-f-]{36}$/.test(gate.leadId) && Object.keys(gate).join() === 'token,leadId', 'the answer: ' + JSON.stringify(gate));
      const rows = await leadsOf(email);
      expect(rows.length === 1 && rows[0].id === gate.leadId && rows[0].name === 'Test Lead' && rows[0].org === null, 'the stored lead: ' + JSON.stringify(rows));
      const claims = claimsOf(gate.token);
      expect(claims.kind === 'sim_lead' && claims.leadId === gate.leadId && claims.email === email, 'the claims: ' + JSON.stringify(claims));
      const asCredential = await j('/api/notifications', { token: gate.token });
      expect(asCredential.status === 401, 'a signed-in route accepted the tour token: ' + asCredential.status);
    });

    await kase('SIM-03', 'POST /feedback under the lead the gate gave, and with none', async () => {
      const message = 'Test message ' + RUN;
      ok(await j('/api/simulator/feedback', { method: 'POST', body: { section: 'pricing', rating: 4, message, leadId: gate.leadId } }), 'feedback');
      const own = await feedbackOf(message);
      expect(own.length === 1 && own[0].lead_id === gate.leadId && own[0].section === 'pricing' && own[0].rating === 4, 'the stored feedback: ' + JSON.stringify(own));
      const bare = 'Test message alone ' + RUN;
      ok(await j('/api/simulator/feedback', { method: 'POST', body: { message: bare } }), 'feedback alone');
      const alone = await feedbackOf(bare);
      expect(alone.length === 1 && alone[0].lead_id === null && alone[0].section === null && alone[0].rating === null, 'the stored feedback alone: ' + JSON.stringify(alone));
    });

    await kase('SIM-04', 'a refused write stores nothing', async () => {
      const shortName = 'short-' + RUN + '@example.invalid';
      const refused = await signUp('A', shortName, undefined);
      expect(refused.status === 400 && refused.b.error === 'A name and a valid email are required.' && (await leadsOf(shortName)).length === 0, 'a one-letter name: ' + refused.status + ' ' + JSON.stringify(refused.b));
      const noAt = await signUp('Test Lead', 'no-at-' + RUN, undefined);
      expect(noAt.status === 400 && (await pg.query('SELECT 1 FROM sim_leads WHERE email = $1', ['no-at-' + RUN])).rowCount === 0, 'an e-mail without @: ' + noAt.status);
      const blank = await j('/api/simulator/feedback', { method: 'POST', body: { message: '   ', section: 'blank-' + RUN } });
      expect(blank.status === 400 && blank.b.error === 'A message is required.' && (await pg.query('SELECT 1 FROM sim_feedback WHERE section = $1', ['blank-' + RUN])).rowCount === 0, 'a blank message: ' + blank.status);
    });

    await kase('SIM-05', 'POST /feedback rating: a whole number is stored; 3.5 is the integer column\'s own refusal and nothing is written', async () => {
      const message = 'Test rating ' + RUN;
      ok(await j('/api/simulator/feedback', { method: 'POST', body: { rating: '5', message } }), 'rating as text');
      expect((await feedbackOf(message))[0].rating === 5, 'a rating sent as "5" is stored as 5');
      const decimal = 'Test decimal ' + RUN;
      const refused = await j('/api/simulator/feedback', { method: 'POST', body: { rating: 3.5, message: decimal } });
      expect(refused.status === 500 && refused.b.error === 'Could not record that — please try again.' && (await feedbackOf(decimal)).length === 0, 'a rating of 3.5: ' + refused.status + ' ' + JSON.stringify(refused.b));
    });

    await kase('SIM-06', 'every lead id answers alike: a real one, one nobody holds, and a non-uuid', async () => {
      const real = await j('/api/simulator/feedback', { method: 'POST', body: { message: 'Test oracle real ' + RUN, leadId: gate.leadId } });
      const unknown = await j('/api/simulator/feedback', { method: 'POST', body: { message: 'Test oracle unknown ' + RUN, leadId: UNKNOWN_UUID } });
      const notUuid = await j('/api/simulator/feedback', { method: 'POST', body: { message: 'Test oracle dashes ' + RUN, leadId: DASHES } });
      expect(real.status === 200 && same(unknown, notUuid), 'real ' + real.status + ' unknown ' + unknown.status + ' non-uuid ' + notUuid.status);
      expect(same(real, unknown), 'a real lead id answered ' + real.status + ' where an unknown uuid answered ' + unknown.status + ' and a 36-character non-uuid ' + notUuid.status + ': a signed-out caller can tell whether a uuid is a lead');
    }, 'sim_feedback.lead_id REFERENCES sim_leads(id): the key (23503) and the uuid cast (22P02) are the database\'s own and the catch answers the generic 500; a real id answers 200. Rated LOW (random uuids, never listed): cb-security decides whether the unknown id should answer like the real one (API-4c, a behaviour change)');
  } finally {
    await pg.end();
  }
  finish('tour truth', process.env.SIM_TRUTH_JSON || null);
})().catch((failure) => { console.error(failure); process.exitCode = 1; });
