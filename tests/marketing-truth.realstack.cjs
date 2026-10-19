'use strict';
/**
 * tests/marketing-truth.realstack.cjs — MARKETING TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §10 "Marketing").
 *
 * MKT-11. Principles: reads the one party list and keeps no copy · no consent, no send: every provider send asks the one gate · "came back" is counted
 * from real sales after a send · the advisor's thresholds are inputs, not constants.
 * MK-01 a party with no consent is refused with a sentence and gets no outbound row · MK-02 consent withdrawn before the send runs → not sent ·
 * MK-03 a party who agreed DOES reach the one sender (the gate lets the right one through) · MK-04 "who came back" exists and counts from sales ·
 * MK-06 the Groups numbers = the CRM page's party count · MK-07 the win-back threshold is an input, not a literal · MK-08 the send log keeps the consent basis.
 * Not here: MK-05 the group's send button (W15, a screen) · MK-09 owner/viewer/visitor consent screens (✓ walk-consent.cjs).
 * The provider is not configured locally (no WHATSAPP_TOKEN), so "0 provider calls" is read from channel_outbound: a refused party has NO row at all,
 * a party who may be sent has ONE row (status refused by the sender, in words) — the gate is asked BEFORE the sender.
 * A `gap:` FAIL is a RECORDED finding (MARKETING-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. LOCAL ONLY.
 * Break-tested 2026-10-19: each passing case was run once with its expected figure flipped to a wrong one and went red.
 * Run: node tests/marketing-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 12-marketing/README
 */
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, pause, kase, expect, bill, freshShop, finish } = H;
const RUN = 'mk' + (Date.now() % 1e10).toString(36);
const API_DIR = path.join(__dirname, '..');
let pg = null;
const pref = async (shop, id, allowed) => ok(await j('/api/crm/parties/' + id + '/contact-prefs', { method: 'POST', token: shop.token, body: { channel: 'whatsapp', purpose: 'marketing', allowed } }), 'pref');
const rowsFor = async (shop, phone) => (await pg.query('SELECT status, reason FROM channel_outbound WHERE entity_id = $1 AND to_ref = $2', [shop.entity, phone])).rows;
/** every .js file under routes/ and lib/ whose text matches — a static scan (How = S in the case list) */
const scan = (re) => ['routes', 'lib'].flatMap((d) => fs.readdirSync(path.join(API_DIR, d)).filter((f) => f.endsWith('.js')).map((f) => [d + '/' + f, fs.readFileSync(path.join(API_DIR, d, f), 'utf8')])).filter(([, t]) => re.test(t)).map(([f]) => f);

(async () => {
  console.log('\n── marketing truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Marketing truth');
    const r = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 60 } } }), 'product').b;
    const P = { id: r.item.item_id, name: 'Rice', unit: 'piece', price: 60 };
    /* three named customers, each with one bill: M0 agreed, M1 agreed then withdrew, M2 was never asked */
    const people = [];
    for (let c = 0; c < 3; c++) {
      const phone = '98765400' + (10 + c), l = ok(await j('/api/crm/leads', { method: 'POST', token: A.token, body: { name: 'Mkt ' + c, phone } }), 'lead').b.party;
      const b = bill(RUN + '-' + c, [[P, 1]]); b.business_json.customer = { name: l.display_name, party_id: l.party_id };
      ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: b }), 'bill');
      people.push({ id: l.party_id, name: l.display_name, phone });
    }
    await pause(1500);
    await pref(A, people[0].id, true); await pref(A, people[1].id, true); await pref(A, people[1].id, false);
    const dry = ok(await j('/api/crm/segments/new/send', { method: 'POST', token: A.token, body: { text: 'Diwali 10% off', dry: true } }), 'dry').b;
    const real = ok(await j('/api/crm/segments/new/send', { method: 'POST', token: A.token, body: { text: 'Diwali 10% off' } }), 'send').b;

    await kase('MK-01', 'a party with no consent is refused with a sentence (NO_CONSENT) and has no outbound row', async () => {
      const x = dry.refused.find((p) => p.party_id === people[2].id), rows = await rowsFor(A, people[2].phone);
      expect(x && x.code === 'NO_CONSENT' && /consent/i.test(x.why) && !rows.length && !real.sent.some((s) => s.party_id === people[2].id), 'verdict ' + JSON.stringify(x) + ' · outbound rows ' + rows.length);
    });
    await kase('MK-02', 'consent withdrawn before the send runs: refused (CONSENT_WITHDRAWN), no outbound row, and the dry run said so too', async () => {
      const a = dry.refused.find((p) => p.party_id === people[1].id), b = real.refused.find((p) => p.party_id === people[1].id), rows = await rowsFor(A, people[1].phone);
      expect(a && a.code === 'CONSENT_WITHDRAWN' && b && b.code === 'CONSENT_WITHDRAWN' && !rows.length, 'dry ' + JSON.stringify(a) + ' · real ' + JSON.stringify(b) + ' · outbound rows ' + rows.length);
    });
    await kase('MK-03', 'the party who agreed IS handed to the one sender (one outbound row, logged even though the provider is not set up)', async () => {
      const rows = await rowsFor(A, people[0].phone);
      expect(dry.may === 1 && real.members === 3 && rows.length === 1 && rows[0].status === 'refused' && /not set|not configured/i.test(rows[0].reason || ''), 'may ' + dry.may + ' of ' + real.members + ' · rows ' + JSON.stringify(rows));
    });
    await kase('MK-04', 'a "who came back" read exists, and counts the buyers after a send, each linked to its bill', async () => {
      const hits = scan(/came[_-]?back|who[_-]came/i);
      expect(hits.length > 0, 'no route or lib in routes/ or lib/ names a "came back" read — an offer sent to 3 with 1 buyer cannot be counted');
    }, 'MK-04 "Who came back" not built (MARKETING-SEED T1)');
    await kase('MK-06', 'the Groups numbers are the CRM page\'s party count: segments.customers = the customers CRM lists = Σ the four segments', async () => {
      const seg = ok(await j('/api/crm/segments', { token: A.token }), 'segments').b, page = ok(await j('/api/crm/parties', { token: A.token }), 'crm').b;
      const total = seg.segments.reduce((a, s) => a + s.count, 0);
      expect(seg.customers === page.count && total === page.count && page.count === 3, 'segments.customers ' + seg.customers + ' · Σ segments ' + total + ' · CRM page ' + page.count + ' (3 named customers)');
    });
    await kase('MK-07', 'the win-back (inactive) threshold is an input the shop or its vertical can change, not a literal 90 in the SQL', async () => {
      const lit = fs.readFileSync(path.join(API_DIR, 'lib', 'customer-groups.js'), 'utf8').match(/INTERVAL '90 days'/g) || [];
      expect(lit.length === 0, 'lib/customer-groups.js carries INTERVAL \'90 days\' ' + lit.length + ' times; high value reads policy_flags.crm (shopRule) but inactive does not');
    }, 'VB9: no vertical.advisor and no setting for the inactive days; only high_value pct / min bills are tunable');
    await kase('MK-08', 'the send log keeps the consent basis it relied on (a column or a field beside the row)', async () => {
      const cols = (await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'channel_outbound'")).rows.map((x) => x.column_name);
      expect(cols.some((c) => /basis|consent/i.test(c)), 'channel_outbound columns: ' + cols.join(', ') + ' — the consent is proved by party_contact_pref history, not stored on the send');
    }, 'MARKETING-SEED: a send names its consent row; today the log has no basis column (the proof is the pref history by party and time)');
  } finally { await pg.end(); }
  finish('marketing-truth', process.env.MARKETING_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('marketing truth could not run:', e && e.message); process.exit(2); });
