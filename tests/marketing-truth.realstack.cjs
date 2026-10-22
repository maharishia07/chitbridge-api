'use strict';
/**
 * tests/marketing-truth.realstack.cjs — MARKETING TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §10 "Marketing").
 *
 * MKT-11. Principles: reads the one party list and keeps no copy · no consent, no send: every provider send asks the one gate · "came back" is counted
 * from real sales after a send · the advisor's thresholds are inputs, not constants.
 * MK-01 a party with no consent is refused with a sentence and gets no outbound row · MK-02 consent withdrawn before the send runs → not sent ·
 * MK-03 a party who agreed DOES reach the one sender (the gate lets the right one through) · MK-04 "who came back" counts from real bills after a SENT offer ·
 * MK-06 the Groups numbers = the CRM page's party count · MK-07 the win-back threshold is an input, not a literal · MK-08 the send log keeps the consent basis ·
 * MK-10 a group send of 10 logs 10 rows, the 3 not messaged with their reason · MK-11 the came-back days are a shop setting (14 → 20 moves 3 to 4).
 * Not here: MK-05 the group's send button (W15, a screen) · MK-09 owner/viewer/visitor consent screens (✓ walk-consent.cjs).
 * The provider is not configured locally (no WHATSAPP_TOKEN), so "0 provider calls" is read from channel_outbound: a party refused by the gate has ONE row
 * (status refused, the gate's reason, a basis code; since b776 22 Oct 2026 the group's refusals are logged), a party who may be sent has ONE row (status refused
 * by the sender, in words) — the gate is asked BEFORE the sender. NO row is ever 'sent' locally: MK-04 ARMS that precondition in SQL (says so below).
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
let pg = null,
  refusedShop = null; /* the first shop: its one send was refused for the missing token */
const pref = async (shop, id, allowed) => ok(await j('/api/crm/parties/' + id + '/contact-prefs', { method: 'POST', token: shop.token, body: { channel: 'whatsapp', purpose: 'marketing', allowed } }), 'pref');
const rowsFor = async (shop, phone) => (await pg.query('SELECT status, reason FROM channel_outbound WHERE entity_id = $1 AND to_ref = $2', [shop.entity, phone])).rows;
/** every .js file under routes/ and lib/ whose text matches — a static scan (How = S in the case list) */
const scan = (re) => ['routes', 'lib'].flatMap((d) => fs.readdirSync(path.join(API_DIR, d)).filter((f) => f.endsWith('.js')).map((f) => [d + '/' + f, fs.readFileSync(path.join(API_DIR, d, f), 'utf8')])).filter(([, t]) => re.test(t)).map(([f]) => f);

const DAY = 86400e3;
const at = (days) => new Date(Date.now() - days * DAY).toISOString();
/**
 * THE PASS TEST (MKT-critic 22 Oct 2026): a group of 10 - 7 agreed, 3 did not. Send -> Offers sent lists 10 rows (the 3 not messaged with their reason).
 * ARMED here, in SQL, because no WHATSAPP_TOKEN exists locally and so nothing is ever really 'sent': the 7 become 'sent'; their send time and the first bills
 * (which only made them customers) are moved back so the days are real. Then: bills for 3 who were sent the offer (day 5), 1 sent 15 days ago, one who was
 * REFUSED, one never in the group -> Who came back = 3; at 20 days = 4. Marketing's group count = CRM's (the same /api/crm/segments).
 */
async function groupOfTen() {
  const B = await freshShop(RUN + 'b', 'Marketing group');
  const r = ok(await j('/api/products', { method: 'POST', token: B.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 60 } } }), 'product').b;
  const P = { id: r.item.item_id, name: 'Rice', unit: 'piece', price: 60 };
  const makeCustomer = async (tag, phone) => {
    const l = ok(await j('/api/crm/leads', { method: 'POST', token: B.token, body: { name: 'Grp ' + tag, phone } }), 'lead').b.party;
    const b = bill(RUN + 'g' + tag, [[P, 1]]);
    b.business_json.customer = { name: l.display_name, party_id: l.party_id, identity_id: l.party_id };
    ok(await j('/api/chits/send', { method: 'POST', token: B.token, body: b }), 'first bill');
    return { id: l.party_id, name: l.display_name, phone };
  };
  const C = [];
  for (let c = 0; c < 10; c++) C.push(await makeCustomer(String(c), '987654' + (2000 + c)));
  const outsider = await makeCustomer('out', '9876543999');
  await pause(1500);
  await pg.query("UPDATE chit_header SET created_at = created_at - interval '60 days' WHERE entity_id = $1 AND business_json->>'bill_no' LIKE $2", [B.entity, RUN + 'g%']);
  ok(await j('/api/crm/groups', { method: 'POST', token: B.token, body: { name: 'demo10', add: C.map((x) => x.id) } }), 'group');
  for (let c = 0; c < 7; c++) await pref(B, C[c].id, true);
  const sent = ok(await j('/api/crm/segments/group:demo10/send', { method: 'POST', token: B.token, body: { text: 'Diwali 10% off' } }), 'send').b;
  const listed = ok(await j('/api/channels/outbound?purpose=marketing&limit=50', { token: B.token }), 'offers sent').b;

  await kase('MK-10', 'a group send of 10 logs 10 rows in Offers sent; the 3 not messaged carry the consent reason', async () => {
    const mine = listed.outbound.filter((o) => o.send_ref === sent.send_ref), refused = mine.filter((o) => o.basis && o.basis.code === 'NO_CONSENT');
    expect(sent.members === 10 && listed.total === 10 && mine.length === 10 && refused.length === 3 && refused.every((o) => o.status === 'refused' && /consent/i.test(o.reason) && o.party_name),
      'members ' + sent.members + ' · total ' + listed.total + ' · rows of this send ' + mine.length + ' · refused for consent ' + refused.length + ' · envelope ' + JSON.stringify({ page: listed.page, limit: listed.limit }));
  });
  await kase('MK-08', 'the send log keeps the consent basis it relied on: the gate code, the preference row and when it was noted', async () => {
    const rows = (await pg.query('SELECT party_id, status, basis FROM channel_outbound WHERE entity_id = $1 AND send_ref = $2', [B.entity, sent.send_ref])).rows,
      agreed = rows.filter((x) => x.basis && x.basis.code === 'CONSENT');
    expect(rows.length === 10 && agreed.length === 7 && agreed.every((x) => x.basis.pref_id && x.basis.at), 'rows ' + rows.length + ' · with a CONSENT basis ' + agreed.length + ' · ' + JSON.stringify(agreed[0]));
  });

  /* ARM: the 7 agreed become 'sent'; c3's send is 15 days old, the rest 5 days */
  await pg.query("UPDATE channel_outbound SET status = 'sent', reason = NULL WHERE entity_id = $1 AND send_ref = $2 AND basis->>'code' = 'CONSENT'", [B.entity, sent.send_ref]);
  for (let c = 0; c < 7; c++) await pg.query('UPDATE channel_outbound SET created_at = $3 WHERE entity_id = $1 AND party_id = $2', [B.entity, C[c].id, at(c === 3 ? 15 : 5)]);
  const buyers = [C[0], C[1], C[2], C[3], C[7], outsider];
  for (const x of buyers) {
    const b = bill(RUN + 'n' + x.phone.slice(-4), [[P, 1]]);
    b.business_json.customer = { name: x.name, party_id: x.id, identity_id: x.id };
    ok(await j('/api/chits/send', { method: 'POST', token: B.token, body: b }), 'bill');
  }
  await pause(1500);
  const back = ok(await j('/api/marketing/came-back', { token: B.token }), 'came back').b;
  await kase('MK-04', '"Who came back" counts the buyers within 14 days of a SENT offer: 3 - not the refused, the outsider, or the one sent 15 days ago', async () => {
    const ids = back.customers.map((x) => x.party_id).sort(), want = [C[0].id, C[1].id, C[2].id].sort();
    expect(back.came_back_n === 3 && ids.join() === want.join() && back.sent_n === 7 && back.days === 14 && back.money.by_currency.length === 1 && back.money.by_currency[0].chits === 3 && back.customers.every((x) => x.bills_n === 1 && x.bills[0].chit_id),
      'came_back ' + back.came_back_n + ' of sent ' + back.sent_n + ' · days ' + back.days + ' · who ' + back.customers.map((x) => x.name).join(', ') + ' · money ' + JSON.stringify(back.money.by_currency));
  });
  ok(await j('/api/entities/policy', { method: 'PATCH', token: B.token, body: { came_back_days: 20 } }), 'policy 20');
  const wide = ok(await j('/api/marketing/came-back', { token: B.token }), 'came back 20').b;
  const toolong = await j('/api/entities/policy', { method: 'PATCH', token: B.token, body: { came_back_days: 100 } });
  await kase('MK-11', 'the came-back days are the shop setting: 20 days counts the day-15 buyer too (4), and 100 is held to the 90-day maximum', async () => {
    expect(wide.days === 20 && wide.came_back_n === 4 && wide.money.by_currency[0].chits === 4 && toolong.status < 300 && toolong.b.flags.came_back_days === 90, 'days ' + wide.days + ' · came back ' + wide.came_back_n + ' · 100 -> ' + JSON.stringify(toolong.b.flags && toolong.b.flags.came_back_days));
  });
  await kase('MK-12', 'Marketing group count is the CRM count: the same endpoint says 10 in demo10, 7 of them may be sent offers', async () => {
    const seg = ok(await j('/api/crm/segments', { token: B.token }), 'segments').b, g = seg.groups.find((x) => x.name === 'demo10');
    expect(g && g.count === 10 && g.reach.may === 7, 'group ' + JSON.stringify(g && { count: g.count, may: g.reach.may }));
  });
  const A2 = await freshShop(RUN + 'c', 'Marketing empty');
  const empty = ok(await j('/api/marketing/came-back', { token: A2.token }), 'empty').b;
  await kase('MK-13', 'a shop that sent nothing sees 0 WITH the reason (NO_SENDS), never a silent 0; a shop whose sends were all refused is told why', async () => {
    const refusedOnly = ok(await j('/api/marketing/came-back', { token: refusedShop.token }), 'refused only').b;
    expect(empty.came_back_n === 0 && empty.why && empty.why.code === 'NO_SENDS' && refusedOnly.why && /^(NO_TOKEN|NO_TEMPLATE|ALL_REFUSED|NO_CONSENT)$/.test(refusedOnly.why.code) && refusedOnly.why.say,
      'empty ' + JSON.stringify(empty.why) + ' · refused-only ' + JSON.stringify(refusedOnly.why));
  });
}

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

    await kase('MK-01', 'a party with no consent is refused with a sentence (NO_CONSENT); the refusal is logged with its reason and nothing is sent', async () => {
      const x = dry.refused.find((p) => p.party_id === people[2].id), rows = await rowsFor(A, people[2].phone);
      expect(x && x.code === 'NO_CONSENT' && /consent/i.test(x.why) && rows.length === 1 && rows[0].status === 'refused' && /consent/i.test(rows[0].reason) && !real.sent.some((s) => s.party_id === people[2].id),
        'verdict ' + JSON.stringify(x) + ' · outbound rows ' + JSON.stringify(rows));
    });
    await kase('MK-02', 'consent withdrawn before the send runs: refused (CONSENT_WITHDRAWN), logged as refused with the reason, and the dry run said so too', async () => {
      const a = dry.refused.find((p) => p.party_id === people[1].id), b = real.refused.find((p) => p.party_id === people[1].id), rows = await rowsFor(A, people[1].phone);
      expect(a && a.code === 'CONSENT_WITHDRAWN' && b && b.code === 'CONSENT_WITHDRAWN' && rows.length === 1 && rows[0].status === 'refused' && /withdrew/i.test(rows[0].reason),
        'dry ' + JSON.stringify(a) + ' · real ' + JSON.stringify(b) + ' · outbound rows ' + JSON.stringify(rows));
    });
    await kase('MK-03', 'the party who agreed IS handed to the one sender (one outbound row, logged even though the provider is not set up)', async () => {
      const rows = await rowsFor(A, people[0].phone);
      expect(dry.may === 1 && real.members === 3 && rows.length === 1 && rows[0].status === 'refused' && /not set|not configured/i.test(rows[0].reason || ''), 'may ' + dry.may + ' of ' + real.members + ' · rows ' + JSON.stringify(rows));
    });
    await kase('MK-06', 'the Groups numbers are the CRM page\'s party count: segments.customers = the customers CRM lists = Σ the four segments', async () => {
      const seg = ok(await j('/api/crm/segments', { token: A.token }), 'segments').b, page = ok(await j('/api/crm/parties', { token: A.token }), 'crm').b;
      const total = seg.segments.reduce((a, s) => a + s.count, 0);
      expect(seg.customers === page.count && total === page.count && page.count === 3, 'segments.customers ' + seg.customers + ' · Σ segments ' + total + ' · CRM page ' + page.count + ' (3 named customers)');
    });
    await kase('MK-07', 'the win-back (inactive) threshold is an input the shop or its vertical can change, not a literal 90 in the SQL', async () => {
      const lit = fs.readFileSync(path.join(API_DIR, 'lib', 'customer-groups.js'), 'utf8').match(/INTERVAL '90 days'/g) || [];
      expect(lit.length === 0, 'lib/customer-groups.js carries INTERVAL \'90 days\' ' + lit.length + ' times; high value reads policy_flags.crm (shopRule) but inactive does not');
    }, 'VB9: no vertical.advisor and no setting for the inactive days; only high_value pct / min bills are tunable');
    refusedShop = A;
    await groupOfTen();
  } finally { await pg.end(); }
  finish('marketing-truth', process.env.MARKETING_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('marketing truth could not run:', e && e.message); process.exit(2); });
