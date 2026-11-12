/**
 * tests/acc-330-billed-at-future.test.cjs — ACC-330: A COUNTER BILL WHOSE CLOCK IS YEARS AHEAD POSTS ON THE SEND DAY, IN THE BOOKS AND IN THE GST MONTH.
 *
 * OWNS      the proof that a till billed_at later than the server's own send (else creation) clock + BILLED_AT_FUTURE_SLACK_HOURS is not believed: the books' day
 *           (books-hooks postingMoment → classify) and the GST return's month (tax-copy POSTED_AT_SQL, the SQL twin) both use the send instead, the bill is NEVER
 *           refused (a till queue must not park), and the posting says so in its narration. Hand example (AUD cents): a sale of 50000 sent 2026-11-13 whose till said
 *           2030-03-15T10:00:00Z posts on 2026-11-13, not 2030-03-15.
 * CALLED BY scripts/guards.cjs · CI. The SQL expression is run on the LOCAL test Postgres (tests/lib/truth-harness default, a pure SELECT, no table touched, the
 *           session pinned to UTC); with no Postgres it says SKIP for that part only. Needs the books engines for classify (without them that part SKIPs, said).
 * Run: node tests/acc-330-billed-at-future.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0,
  fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SENT = '2026-11-13T05:00:00.000Z';
const hour = (n) => new Date(Date.parse(SENT) + n * 3600000).toISOString();
const copyAt = (billed, extra) => Object.assign({ business_json: billed === undefined ? {} : { billed_at: billed }, sent_at: SENT, created_at: '2026-11-13T04:59:00.000Z' }, extra || {});

(async () => {
  console.log('\n== ACC-330: A BILLED_AT FAR IN THE FUTURE ==\n');
  const K = require(path.join(H.API, 'lib', 'books-hooks'));

  /* ── 1. the one definition (the books' moment) ── */
  eq('billed_at 2030-03-15 with a send of 2026-11-13 falls back to the send', K.postingMoment(copyAt('2030-03-15T10:00:00Z')), SENT);
  eq('sent + 23 h stays the counter\'s own', K.postingMoment(copyAt(hour(23))), hour(23));
  eq('sent + 25 h falls back to the send', K.postingMoment(copyAt(hour(25))), SENT);
  eq('a 2020 billed_at is unchanged (moved to the ledger start by the posting date, by design)', K.postingMoment(copyAt('2020-01-05T10:00:00Z')), '2020-01-05T10:00:00Z');
  eq('a zone-less till time is read as UTC: 2026-11-13 20:00 (15 h ahead of 05:00Z) stays', K.postingMoment(copyAt('2026-11-13 20:00:00')), '2026-11-13 20:00:00');
  eq('…and 2026-11-14 06:00 zone-less (25 h ahead) falls back', K.postingMoment(copyAt('2026-11-14 06:00:00')), SENT);
  eq('with no sent_at the creation is the reference', K.postingMoment({ business_json: { billed_at: '2030-03-15T10:00:00Z' }, created_at: '2026-11-13T04:59:00.000Z' }), '2026-11-13T04:59:00.000Z');
  eq('with neither sent nor created there is nothing to bound it by: billed_at stands', K.postingMoment({ business_json: { billed_at: '2030-03-15T10:00:00Z' } }), '2030-03-15T10:00:00Z');
  ok('the bound is ONE named constant (24 h)', K.BILLED_AT_FUTURE_SLACK_HOURS === 24);

  /* ── 2. the SQL twin: tax-copy POSTED_AT_SQL answers what postingMoment answers (run on the local Postgres) ── */
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  ok('tax-copy exports its POSTED_AT_SQL and builds it from the same constant', typeof TC.POSTED_AT_SQL === 'string' && TC.POSTED_AT_SQL.indexOf(String(K.BILLED_AT_FUTURE_SLACK_HOURS) + ' hours') > 0);
  let pg = null;
  try {
    const { Client } = require('pg');
    pg = new Client({ connectionString: process.env.TRUTH_DB || 'postgres://postgres:cblocal@127.0.0.1:55432/cb_local', connectionTimeoutMillis: 3000 });
    await pg.connect();
    await pg.query("SET TIME ZONE 'UTC'");
  } catch (e) {
    console.log('   SKIP (SQL part): no local Postgres — ' + e.message);
    pg = null;
  }
  if (pg && TC.POSTED_AT_SQL) {
    const sqlMoment = async (billed) => {
      const json = billed === undefined ? {} : { billed_at: billed };
      const res = await pg.query('SELECT ' + TC.POSTED_AT_SQL + ' AS at FROM (SELECT $1::jsonb AS business_json, $2::timestamptz AS sent_at, $3::timestamptz AS created_at) h', [JSON.stringify(json), SENT, '2026-11-13T04:59:00.000Z']);
      return res.rows[0].at.toISOString();
    };
    for (const billed of ['2030-03-15T10:00:00Z', hour(23), hour(25), '2020-01-05T10:00:00Z', '2026-11-13 20:00:00', '2026-11-14 06:00:00', 'yesterday evening', undefined]) {
      const said = K.postingMoment(copyAt(billed)); /* a zone-less text is UTC (the session is pinned to UTC), never this machine's zone */
      const books = new Date(/(Z|[+-]\d\d(:?\d\d)?)$/.test(said) ? said : said.replace(' ', 'T') + 'Z').toISOString();
      eq('SQL month moment = the books moment for billed_at ' + JSON.stringify(billed), await sqlMoment(billed), books);
    }
    eq('a 2030 bill is in 2026-11 in the SQL (the GST month), not 2030-03', (await sqlMoment('2030-03-15T10:00:00Z')).slice(0, 7), '2026-11');
    await pg.end();
  }

  /* ── 2b. the walk-in day windows (books-store counterBills / countersBilling) read the SAME bounded expression ──
   *  run the REAL functions on the local Postgres over TEMP copies of chit_header / chit_detail (rolled back; nothing persists). */
  const STORE = require(path.join(H.API, 'lib', 'books-store'));
  let pw = null;
  try {
    const { Client } = require('pg');
    pw = new Client({ connectionString: process.env.TRUTH_DB || 'postgres://postgres:cblocal@127.0.0.1:55432/cb_local', connectionTimeoutMillis: 3000 });
    await pw.connect();
  } catch (e) {
    console.log('   SKIP (walk-in window SQL): no local Postgres — ' + e.message);
    pw = null;
  }
  if (pw) {
    const ENT = '33333333-3333-4333-8333-333333333333';
    try {
      await pw.query('BEGIN');
      await pw.query("SET LOCAL TIME ZONE 'UTC'");
      await pw.query('CREATE TEMP TABLE chit_header AS SELECT * FROM public.chit_header WITH NO DATA');
      await pw.query('CREATE TEMP TABLE chit_detail AS SELECT * FROM public.chit_detail WITH NO DATA');
      const put = (id, billed) => pw.query(
        "INSERT INTO chit_header (chit_id, entity_id, sender_entity_id, role, purpose, business_json, sent_at, created_at) VALUES ($1, $2, $2, 'Sent', 'order', $3::jsonb, $4::timestamptz, $4::timestamptz)",
        [id, ENT, JSON.stringify({ bill_no: 'B-' + id, till: { id: 'C1' }, billed_at: billed }), SENT]);
      await put('a0000000-0000-4000-8000-000000000001', '2030-03-15T10:00:00Z');
      await put('a0000000-0000-4000-8000-000000000002', hour(1));
      const ids = async (from, to) => (await STORE.counterBills(pw, ENT, 'C1', from, to)).map((r) => r.chit_id.slice(-1)).sort();
      eq('walk-in day window 2026-11-13: the 2030 bill (sent today) is IN it, with the sane one', await ids('2026-11-13T00:00:00Z', '2026-11-14T00:00:00Z'), ['1', '2']);
      eq('…and in NO 2030 window (the books already posted it on the send day)', await ids('2030-03-15T00:00:00Z', '2030-03-16T00:00:00Z'), []);
      eq('countersBilling (nightly catch-up) names the till for the send day', await STORE.countersBilling(pw, ENT, '2026-11-13T00:00:00Z', '2026-11-14T00:00:00Z'), ['C1']);
      eq('…and names nothing for 2030', await STORE.countersBilling(pw, ENT, '2030-03-15T00:00:00Z', '2030-03-16T00:00:00Z'), []);
    } catch (e) {
      ok('walk-in window SQL ran on the local Postgres', false, e.message);
    } finally {
      await pw.query('ROLLBACK').catch(() => {});
      await pw.end();
    }
  }
  ok('no raw billed_at cast is left in the two window readers', !/\(h\.business_json ->> 'billed_at'\)::timestamptz, h\.created_at/.test(require('fs').readFileSync(path.join(H.API, 'lib', 'books-store.js'), 'utf8')));

  /* ── 3. classify: the books' day is the send day, said in the narration, and the verdict is still a post (never a refusal) ── */
  const X = H.load();
  if (!X.src.dir) {
    console.log('   SKIP (classify part): ' + X.src.why);
  } else {
    const T = require(path.join(H.API, 'lib', 'tax'));
    const SHOP = '11111111-1111-4111-8111-111111111111',
      CUST = '22222222-2222-4222-8222-222222222222';
    const IDS = {
      [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', timezone: 'Asia/Kolkata', policy_flags: { price_includes_tax: 'no' } },
      [CUST]: { identity_id: CUST, gstn: '33BBBBB0000B1Z5', display_name: 'Chola Auto Care', country: 'IN', policy_flags: {} }
    };
    const SETTING = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR', timezone: 'Asia/Kolkata' };
    const party = (id) => ({ Gstin: IDS[id].gstn, LglNm: IDS[id].display_name, State: '33', Pos: '33', RegType: 'regular', Country: 'IN' });
    const memory = require('./support/books-memory.cjs');
    const ask = memory.fakeDb.query;
    memory.fakeDb.query = async (text, params) => {
      const sql = String(text);
      if (/FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: params[0].map((id) => IDS[id]).filter(Boolean) };
      if (/FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [IDS[params[0]]].filter(Boolean) };
      return ask(text, params);
    };
    delete require.cache[require.resolve(path.join(H.API, 'lib', 'tax-copy'))];
    const TCfresh = require(path.join(H.API, 'lib', 'tax-copy'));
    const sale = (billed) => ({
      chit_id: 'c0000000-0000-4000-8000-000000000330', purpose: 'invoice', role: 'Sender', currency_code: 'INR', summary_json: {}, line_items: [], created_at: SENT, sent_at: SENT,
      current_status: 'delivered', sender_entity_id: SHOP, all_recipients: [{ role: 'sender', entity_id: SHOP }, { role: 'receiver', entity_id: CUST }],
      business_json: { billed_at: billed, invoice: T.determine({ seller: party(SHOP), buyer: party(CUST), lines: [{ name: 'Brake pad', hsn: '9999', qty: 1, unit_price: 500, rate: 18 }] }) }
    });
    const verdict = async (billed) => {
      const chit = sale(billed);
      return K.classify({ chit, entry: await TCfresh.entryFor(chit, SHOP), setting: SETTING, status: 'delivered' });
    };
    const late = await verdict('2030-03-15T10:00:00Z');
    const fine = await verdict('2026-11-13T04:00:00Z');
    eq('a 2030 billed_at is still a POST, not a refusal or a hold (the till queue stays safe)', late.kind, 'post');
    eq('the books day is the send day (2026-11-13 in the shop zone)', late.event && late.event.date, '2026-11-13');
    ok('…and the narration says the counter clock was ahead', /ahead of the day it was sent/.test((late.event && late.event.narration) || ''), JSON.stringify(late.event && late.event.narration));
    eq('a sane billed_at posts on its own day with no such note', [fine.kind, fine.event && fine.event.date, /ahead of the day/.test((fine.event && fine.event.narration) || '')], ['post', '2026-11-13', false]);
  }


  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
