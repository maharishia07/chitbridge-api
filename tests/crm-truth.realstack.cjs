'use strict';
/**
 * tests/crm-truth.realstack.cjs — CRM (PARTIES) TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §9 "CRM").
 *
 * CRM-6. The principles: ONE party list (a phone is one party, however it arrives) · the first named bill ends the lead · segments count NAMED
 * bills only and say why a count is low · remove HIDES and never deletes, and is refused while dues are open.
 * CR-01 first bill ends the lead · CR-02 segments match the bills sent · CR-03 unnamed bills are not counted AND the screen says why ·
 * CR-04 remove refused with open dues · CR-05 a removed party is hidden, the row kept · CR-06 one phone, one party (lead, counter, import).
 * CR-07 may we trade (a local party, a party on the rail) · CR-09 a follow-up is shown on its day (today · late · later).
 * Not here: CR-08 viewer (an actor sign-in has no offline-provable code: crm-viewer.test.cjs ✓) · CR-10 the lead path (W16, a walk) · may-trade's inactive / shopper / other-sandbox words (pure unit: crm-maytrade.test.cjs).
 * A `gap:` FAIL is a RECORDED finding (CRM-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. LOCAL ONLY.
 * Break-tested 2026-10-19: each passing case was run once with its expected figure flipped to a wrong one (CR-02a 5 regular, CR-03a 12 customers, CR-04 status 200, CR-05 txn_count 99) and went red.
 * Run: node tests/crm-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 11-crm-and-marketing/crm-groups
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
/* ACC-198: tax registration is never assumed - an unknown shop's sales wait with the question; these shops sell untaxed, so they SAY not registered */
const NOT_REGISTERED = { tax: { registered: false } };
const { DB, j, ok, pause, kase, expect, bill, freshShop, finish } = H;
const RUN = 'cr' + (Date.now() % 1e10).toString(36);
let pg = null;
/** one counter bill; party = who it names (null = a walk-in with no name); credit = paid later (the customer then owes) */
const sendBill = async (shop, no, P, qty, party, credit) => {
  const b = bill(no, [[P, qty]]); b.business_json.customer = party ? { name: party.name, party_id: party.id } : { name: 'Walk-in' };
  if (credit) { b.business_json.payment = { mode: 'credit', paid: 0, change: 0, parts: [{ how: 'credit', amount: qty * P.price }] }; b.business_json.slip = 'credit'; }
  return ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body: b }), 'bill ' + no).b;
};
const lead = async (shop, name, phone) => j('/api/crm/leads', { method: 'POST', token: shop.token, body: { name, phone } });
const listOf = async (shop) => ok(await j('/api/crm/parties', { token: shop.token }), 'parties').b;
const segCounts = async (shop) => { const s = ok(await j('/api/crm/segments', { token: shop.token }), 'segments').b; const c = {}; s.segments.forEach((x) => { c[x.key] = x.count; }); return { c, raw: s }; };

(async () => {
  console.log('\n── crm truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Crm truth', NOT_REGISTERED);
    ok(await j('/api/books/enable', { method: 'POST', token: A.token }), 'books on');   /* the Ledger is what says "dues" — a precondition, through its own route */
    const r = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Rice', unit: 'piece', price: 60 } } }), 'product').b;
    const P = { id: r.item.item_id, name: 'Rice', unit: 'piece', price: 60 };

    const first = (await lead(A, 'First Bill Lead', '9876510001')).b.party;
    await kase('CR-01', 'a lead stays a lead until the first bill that names them; then stage = customer, txn_count 1', async () => {
      const before = ok(await j('/api/crm/parties/' + first.party_id, { token: A.token }), 'record').b;
      expect(before.lead && before.lead.stage === 'lead', 'before the bill the stage is ' + JSON.stringify(before.lead));
      await sendBill(A, RUN + '-f1', P, 1, { id: first.party_id, name: first.display_name }); await pause(1200);
      const after = ok(await j('/api/crm/parties/' + first.party_id, { token: A.token }), 'record').b;
      const n = (await pg.query('SELECT txn_count FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2', [A.entity, first.party_id])).rows[0];
      expect(after.lead && after.lead.stage === 'customer' && Number(after.customer.txn_count) === 1 && n && Number(n.txn_count) === 1, 'after: ' + JSON.stringify(after.lead) + ' · txn_count ' + (n && n.txn_count));
    });

    /* the shop under test: 5 named customers, 40 bills (20 · 10 · 5 · 4 · 1), then unnamed walk-in bills */
    const plan = [20, 10, 5, 4, 1], people = [];
    for (let c = 0; c < plan.length; c++) { const l = ok(await lead(A, 'Seg Cust ' + c, '98765100' + (20 + c)), 'lead ' + c).b.party; people.push({ id: l.party_id, name: l.display_name, bills: plan[c] }); }
    let n = 0;
    for (const p of people) for (let k = 0; k < p.bills; k++) await sendBill(A, RUN + '-s' + (n++), P, 1, p, p === people[4]);   /* the last one buys on credit: he owes */
    for (let k = 0; k < 6; k++) await sendBill(A, RUN + '-w' + k, P, 1, null);
    await pause(3000);
    const seg = await segCounts(A);
    await kase('CR-02a', 'segments match the bills sent: 3-or-more bills = regular (4), fewer = new (+ the CR-01 customer), none inactive', async () => {
      expect(seg.c.regular === 4 && seg.c.new === 2 && seg.c.inactive === 0, 'counts ' + JSON.stringify(seg.c) + ' (expected regular 4 · new 2 · inactive 0)');
    });
    await kase('CR-02b', 'with 40 named bills the top spender is HIGH VALUE (the count is not 0)', async () => {
      const rows = (await pg.query("SELECT COUNT(*)::int AS n FROM party_item WHERE entity_id = $1 AND ref_kind = 'bill'", [A.entity])).rows[0].n;
      expect(seg.c.high_value >= 1, 'high_value ' + seg.c.high_value + ' — the rule reads party_item bill rows: ' + rows + ' rows for 41 named bills');
    }, 'W14: High value counts only bills that reached party_item (credit bills); a cash-paid customer is never high value');
    await kase('CR-03a', 'unnamed (walk-in) bills are in no segment: customers = the named ones only', async () => {
      const total = Object.values(seg.c).reduce((a, b) => a + b, 0);
      expect(seg.raw.customers === 6 && total === 6, 'customers ' + seg.raw.customers + ' · segment total ' + total + ' (6 named, 6 unnamed bills)');
    });
    await kase('CR-03b', 'and the Groups answer SAYS why: it carries the count of unnamed bills it left out', async () => {
      expect(/unnamed|walk[-_ ]?in|no[_ ]name/i.test(JSON.stringify(seg.raw)), 'segments answer keys: ' + Object.keys(seg.raw).join(', ') + ' — no reason for the 6 bills left out');
    }, 'CRM-D6 not built: the segments answer has no "N of M bills had no name" line');

    const owing = people[4], settled = people[3];
    await kase('CR-04', 'removing a party who owes is refused with a sentence, and the party stays on the list', async () => {
      const d = await j('/api/crm/parties/' + owing.id, { method: 'DELETE', token: A.token });
      const still = (await listOf(A)).parties.some((x) => x.party_id === owing.id);
      expect(d.status === 409 && d.b.code === 'HAS_DUES' && /dues/i.test(d.b.message || '') && still, 'delete ' + d.status + ' ' + JSON.stringify(d.b).slice(0, 160) + ' · still listed ' + still);
    });
    await kase('CR-05', 'removing a settled party HIDES them (off the list) and keeps the row and their bill count', async () => {
      const d = await j('/api/crm/parties/' + settled.id, { method: 'DELETE', token: A.token });
      const listed = (await listOf(A)).parties.some((x) => x.party_id === settled.id);
      const row = (await pg.query('SELECT hidden_at, txn_count FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2', [A.entity, settled.id])).rows[0];
      expect(d.status === 200 && !listed && row && row.hidden_at && Number(row.txn_count) === settled.bills, 'delete ' + d.status + ' · listed ' + listed + ' · row ' + JSON.stringify(row));
    });

    const base = (await lead(A, 'Phone Once', '9876510077')).b.party;
    const count = async (digits) => (await pg.query("SELECT COUNT(*)::int AS n FROM identities i JOIN customer_list cl ON cl.customer_identity_id = i.identity_id " +
      "WHERE cl.owner_entity_id = $1 AND regexp_replace(COALESCE(i.otp_contact,''), '[^0-9]', '', 'g') LIKE '%' || $2", [A.entity, digits])).rows[0].n;
    await kase('CR-06a', 'the same phone added at the counter after a lead is refused with the existing name, and stays one party', async () => {
      const c = await j('/api/relationships/customers', { method: 'POST', token: A.token, body: { name: 'Counter Twin', phone: '9876510077' } });
      expect(c.status === 409 && /Phone Once/.test(JSON.stringify(c.b)) && await count('9876510077') === 1, 'counter add ' + c.status + ' ' + JSON.stringify(c.b).slice(0, 160) + ' · parties with that phone ' + await count('9876510077'));
    });
    await kase('CR-06b', 'a CSV import of the same phone is skipped with a reason ("Already a lead"), a new phone is added', async () => {
      const i = ok(await j('/api/crm/leads/import', { method: 'POST', token: A.token, body: { rows: [{ name: 'Import Twin', phone: '9876510077' }, { name: 'Import New', phone: '9876510078' }] } }), 'import').b;
      expect(i.added === 1 && i.skipped.length === 1 && i.rows[0].party_id === base.party_id && /already/i.test(i.skipped[0].why || '') && await count('9876510077') === 1, JSON.stringify({ added: i.added, skipped: i.skipped }).slice(0, 220));
    });
    await kase('CR-06c', 'the same phone typed with +91 and spaces is the same party', async () => {
      const c = await lead(A, 'Format Twin', '+91 98765 10077');
      expect(c.status === 409 && await count('9876510077') === 1, 'lead ' + c.status + ' ' + JSON.stringify(c.b).slice(0, 140) + ' · parties with that phone ' + await count('9876510077'));
    });

    /* CR-07 · may we trade? the verdict word comes with the party (list row and record), the sentence with the add answer */
    await kase('CR-07a', 'a local party (a lead) is NOT on ChitBridge: the record says may_trade false, why "local", and the add answer says so in words', async () => {
      const rec = ok(await j('/api/crm/parties/' + base.party_id, { token: A.token }), 'record').b;
      const row = ok(await j('/api/crm/parties?view=leads', { token: A.token }), 'leads list').b.parties.find((x) => x.party_id === base.party_id); /* leads are out of the default list (lib/crm.js:301) */
      const added = ok(await j('/api/relationships/customers', { method: 'POST', token: A.token, body: { name: 'Counter Local ' + RUN } }), 'add local').b;
      expect(rec.may_trade && rec.may_trade.ok === false && rec.may_trade.why === 'local' && rec.on_chitbridge === false && row && row.may_trade.why === 'local', 'record ' + JSON.stringify(rec.may_trade) + ' · list ' + JSON.stringify(row && row.may_trade));
      expect(/not on ChitBridge/.test(added.message || '') && added.customer.on_rail === false && /not on ChitBridge/.test((added.customer.one_sided || {}).why || ''), 'add answer ' + JSON.stringify(added).slice(0, 200));
    });
    const B = await freshShop(RUN + 'b', 'Crm truth trader', NOT_REGISTERED);
    await kase('CR-07b', 'a business on the rail in the same sandbox MAY trade: added by User ID, on_rail true, no one-sided note, may_trade ok', async () => {
      const added = ok(await j('/api/relationships/customers', { method: 'POST', token: A.token, body: { handle: RUN + 'b' } }), 'add by user id').b;
      const rec = ok(await j('/api/crm/parties/' + added.customer.customer_identity_id, { token: A.token }), 'record').b;
      expect(added.customer.on_rail === true && !added.customer.one_sided && rec.may_trade && rec.may_trade.ok === true && rec.on_chitbridge === true, 'add ' + JSON.stringify(added.customer).slice(0, 200) + ' · record ' + JSON.stringify(rec.may_trade));
    });

    /* CR-09 · a follow-up is shown on its day: the SERVER names the shop's day, and says today / late / week */
    const shopDay = ok(await j('/api/crm/followups?scope=all', { token: A.token }), 'followups').b;
    const dayPlus = (n) => new Date(Date.parse(shopDay.shop_day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const askFollowup = async (what, due) => ok(await j('/api/crm/followups', { method: 'POST', token: A.token, body: { party_id: first.party_id, what, due_at: due } }), 'follow-up ' + what).b.followup;
    await kase('CR-09', 'a follow-up due today is TODAY (not late), one due yesterday is LATE, one due in three days is neither; the list counts and the record carry them', async () => {
      const t = await askFollowup('Ring about the quote ' + RUN, dayPlus(0)), l = await askFollowup('Overdue call ' + RUN, dayPlus(-1)), w = await askFollowup('Next week call ' + RUN, dayPlus(3));
      expect(t.today === true && t.late === false && t.bucket === 'today' && t.due_day === dayPlus(0), 'today one ' + JSON.stringify({ today: t.today, late: t.late, bucket: t.bucket, due_day: t.due_day }));
      expect(l.late === true && l.today === false && l.bucket === 'late' && w.late === false && w.today === false && w.bucket === 'week', 'late ' + l.bucket + ' · later ' + w.bucket);
      const all = ok(await j('/api/crm/followups?scope=all', { token: A.token }), 'list').b, rec = ok(await j('/api/crm/parties/' + first.party_id, { token: A.token }), 'record').b;
      const mine = new Set([t.followup_id, l.followup_id, w.followup_id]);
      expect(all.today === shopDay.today + 1 && all.late === shopDay.late + 1 && all.total === shopDay.total + 3 && all.shop_day === shopDay.shop_day, 'counts ' + JSON.stringify({ today: all.today, late: all.late, total: all.total, was: [shopDay.today, shopDay.late, shopDay.total] }));
      expect(rec.followups.filter((x) => mine.has(x.followup_id)).length === 3, 'the record carries ' + rec.followups.length + ' follow-ups');
    });

    /* R82 (CRM walk 24 Oct): a logged call must be readable again: the party's timeline is the GET that lists it */
    await kase('CR-R82', 'a call logged on a party is listed again by GET /parties/:id/timeline (kind interaction, with its words)', async () => {
      const said = 'Rang about the order ' + RUN;
      ok(await j('/api/crm/parties/' + first.party_id + '/interactions', { method: 'POST', token: A.token, body: { kind: 'call', direction: 'in', body: said } }), 'log call');
      const tl = ok(await j('/api/crm/parties/' + first.party_id + '/timeline', { token: A.token }), 'timeline').b;
      expect((tl.entries || []).some((x) => x.kind === 'interaction' && JSON.stringify(x).indexOf(said) >= 0), 'timeline kinds ' + (tl.entries || []).map((x) => x.kind).join(','));
    }, 'R82: the walk saw logged calls not listed; GET /calls is the to-call queue, not the log (owner cb-crm decides where the log lists)');
  } finally { await pg.end(); }
  finish('crm-truth', process.env.CRM_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('crm truth could not run:', e && e.message); process.exit(2); });
