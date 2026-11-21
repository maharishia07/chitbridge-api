'use strict';
/**
 * tests/shop-bookkeeper-approves.realstack.cjs — the shop Bookkeeper, slice B: the OWNER-APPROVES mode (policy_flags.books_owner_approves), on REAL Postgres, the api running as cb_app, an IN shop.
 *
 * owns: the setting off = slice A (the Bookkeeper posts) · on = 202 and nothing posted · the owner accepts and the ONE writer posts (created_by the Bookkeeper, source_ref action:<id>, both people on the action) · a return posts nothing ·
 *       the Bookkeeper cannot prepare lock, unlock or year close (a reversal is theirs: shop-bookkeeper.realstack BK-6) · the owner's own post is never held · the To-do kind and its items
 * NEEDS migration b867 and b884: the fresh-db step builds both. Without the table the file says so and stops after the direct post (the api answers BOOKS_ACTION_NOT_SWITCHED_ON there).
 * HAND-COMPUTED  Pay expense rent Rs 5,000 cash = 500000 minor INR: Dr 6010 500000 / Cr cash 500000 (the BK-2 figures of slice A).
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 * Run: API_BASE=http://127.0.0.1:<port> node tests/shop-bookkeeper-approves.realstack.cjs   ⚠️ LOCAL / throwaway DB or a SIT box ONLY (the harness refuses anything else)
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;

const RUN = 'ap' + (Date.now() % 1e8).toString(36).padStart(6, '0');
const key = (tag) => ('k' + tag + RUN.slice(-6)).slice(0, 12);
const { shopToday } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
const DAY = shopToday();
const said = (reply) => JSON.stringify([reply.status, reply.b]);
const addActor = async (shop, name, tag, extra) => ok(await j('/api/actors', { method: 'POST', token: shop.token, body: Object.assign({ display_name: name, actor_key: key(tag), email: key(tag) + '@local.test', access_level: 'editor', whole_entity: true, can_see_costs: true }, extra || {}) }), 'add ' + name).b;
const signIn = async (person) => ok(await j('/api/actors/login', { method: 'POST', body: { username: person.actor.login_format, otp: H.ENTITY_OTP } }), 'first sign-in of ' + person.actor.login_format).b.token;
const rent = (ref) => ({ kind: 'expense', class: 'rent', date: DAY, amount_minor: 500000, narration: 'Shop rent', paid_from: 'cash', client_ref: RUN + ref });

(async () => {
  console.log('\n══ shop Bookkeeper · slice B · owner approves · real Postgres · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const shop = await freshShop(RUN, 'Approves Shop', { tax: { registered: false } });
    ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
    const ravi = await addActor(shop, 'Ravi Books', 'r', { hat: 'manager' });
    const meena = await addActor(shop, 'Meena Counter', 'm', { hat: 'act' });
    const R = await signIn(ravi);
    const M = await signIn(meena);
    const books = (token, method, path, body) => j('/api/books' + path, { method, token, body });
    const acts = (token, method, path, body) => j('/api/books-actions' + path, { method, token, body: body && Object.assign({ store_id: shop.entity }, body) });
    const steps = async () => Number((await pg.query('SELECT count(*)::int AS n FROM books_action_step WHERE store = $1', [shop.entity])).rows[0].n);
    const entryOf = async (id) => (await pg.query('SELECT entry_no, created_by, source_ref FROM journal_entry WHERE entity_id = $1 AND source_ref = $2', [shop.entity, 'action:' + id])).rows;
    const table = (await pg.query("SELECT to_regclass('public.books_action_step') AS t")).rows[0].t;

    await kase('AP-1', 'setting OFF (the default): Ravi posts as in slice A, nothing is held, and the queue door says no one asked', async () => {
      const posted = await books(R, 'POST', '/events', rent('a'));
      expect(posted.status === 200 && posted.b.ok && posted.b.entry_no, 'direct post ' + said(posted));
      if (!table) return 'posted; the queue table is not there (b867/b884 not run): ' + posted.b.entry_no;
      const held = await acts(R, 'POST', '', { kind: 'event', body: rent('x'), client_ref: RUN + 'x' });
      expect(held.status === 409 && held.b.code === 'BOOKS_OWNER_APPROVES_OFF', 'queue door ' + said(held));
      return posted.b.entry_no + ' · queue door ' + held.status;
    });
    if (!table) {
      console.log('  (b867 is not in this database: the rest of this file needs it)');
      finish('shop-bookkeeper-approves', process.env.TRUTH_JSON);
      return;
    }

    await kase('AP-2', 'only the owner switches the setting on', async () => {
      const refused = await j('/api/entities/policy', { method: 'PATCH', token: R, body: { books_owner_approves: 'on' } });
      expect(refused.status === 403, 'Ravi PATCH ' + said(refused));
      const done = ok(await j('/api/entities/policy', { method: 'PATCH', token: shop.token, body: { books_owner_approves: 'on' } }), 'owner PATCH');
      const read = ok(await j('/api/entities/policy', { token: shop.token }), 'policy read').b;
      expect(JSON.stringify(read).includes('"books_owner_approves":"on"'), 'read ' + JSON.stringify(read).slice(0, 300));
      return 'Ravi ' + refused.status + ', owner ' + done.status;
    });

    let held;
    await kase('AP-3', "setting ON: Ravi's Day book entry answers 202, waiting for the owner, INR 500000, nothing posted", async () => {
      held = await books(R, 'POST', '/events', rent('b'));
      expect(held.status === 202 && held.b.state === 'waiting_accept' && held.b.kind === 'event' && held.b.total_minor === 500000 && held.b.currency === 'INR', '202 ' + said(held));
      expect(held.b.prepared && held.b.prepared.name === 'Ravi Books' && held.b.prepared.role === 'staff', 'stamp ' + JSON.stringify(held.b.prepared));
      expect((await entryOf(held.b.action_id)).length === 0, 'an entry was posted');
      const again = await books(R, 'POST', '/events', rent('b'));
      expect(again.status === 409, 'the same press twice is the open action: ' + said(again));
      return held.b.action_id;
    });

    await kase('AP-4', "the owner's own post is never held; Meena (Regional manager) is refused as before", async () => {
      const own = await books(shop.token, 'POST', '/events', rent('o'));
      expect(own.status === 200 && own.b.entry_no, 'owner ' + said(own));
      const hers = await books(M, 'POST', '/events', rent('m'));
      expect(hers.status === 403 && hers.b.code === 'OWNER_ONLY', 'Meena ' + said(hers));
      return own.b.entry_no;
    });

    await kase('AP-5', "the owner's To do names the entry waiting for OK, with its amount and currency and who sent it", async () => {
      const todo = ok(await books(shop.token, 'GET', '/todo'), 'todo').b;
      const rows = todo.todo || todo.items || todo;
      const row = (Array.isArray(rows) ? rows : []).find((x) => x.kind === 'entries_to_ok');
      expect(row && row.count === 1, 'row ' + JSON.stringify(row));
      const item = row.items[0];
      expect(item.action_id === held.b.action_id && item.total_minor === 500000 && item.currency === 'INR' && item.by === 'Ravi Books', 'item ' + JSON.stringify(item));
      return row.words;
    });

    await kase('AP-6', 'the owner accepts: the one writer posts it once, created by Ravi, source action:<id>; both people are on the action', async () => {
      const wrong = await acts(shop.token, 'POST', '/' + held.b.action_id + '/accept', { body_hash: held.b.body_hash, total_minor: 499999, currency: 'INR' });
      expect(wrong.status === 409 && (await entryOf(held.b.action_id)).length === 0, 'a wrong total is refused and nothing posts: ' + said(wrong));
      const done = await acts(shop.token, 'POST', '/' + held.b.action_id + '/accept', { body_hash: held.b.body_hash, total_minor: 500000, currency: 'INR' });
      expect(done.status === 200 && done.b.entry && done.b.entry.entry_no, 'accept ' + said(done));
      const rows = await entryOf(held.b.action_id);
      expect(rows.length === 1 && rows[0].created_by === ravi.actor.identity_id, 'entry ' + JSON.stringify(rows));
      const one = ok(await acts(shop.token, 'GET', '/' + held.b.action_id), 'the action').b;
      const names = (one.steps || []).map((x) => x.step + ':' + x.role + ':' + x.name);
      expect(names.length === 2 && names[0].startsWith('prepared:staff:Ravi') && names[1].startsWith('accepted:owner:'), 'steps ' + names.join(' | '));
      const second = await acts(shop.token, 'POST', '/' + held.b.action_id + '/accept', { body_hash: held.b.body_hash, total_minor: 500000, currency: 'INR' });
      expect(second.status === 409 && (await entryOf(held.b.action_id)).length === 1, 'a second accept is refused: ' + said(second));
      return rows[0].entry_no + ' · ' + names.join(' | ');
    });

    await kase('AP-7', 'the owner returns the next one with a note: nothing posts, the round ends', async () => {
      const second = await books(R, 'POST', '/events', rent('c'));
      expect(second.status === 202, 'held ' + said(second));
      const short = await acts(shop.token, 'POST', '/' + second.b.action_id + '/return', { body_hash: second.b.body_hash, reason: '' });
      expect(short.status === 422, 'a return needs its note: ' + said(short));
      const back = await acts(shop.token, 'POST', '/' + second.b.action_id + '/return', { body_hash: second.b.body_hash, reason: 'Wrong month, make it November' });
      expect(back.status === 200 && back.b.state === 'returned', 'return ' + said(back));
      expect((await entryOf(second.b.action_id)).length === 0, 'a returned entry posted');
      const late = await acts(shop.token, 'POST', '/' + second.b.action_id + '/accept', { body_hash: second.b.body_hash, total_minor: 500000, currency: 'INR' });
      expect(late.status === 409, 'accepting a returned one: ' + said(late));
      const mine = ok(await books(R, 'GET', '/todo'), 'Ravi todo').b;
      const rows = Array.isArray(mine) ? mine : mine.todo || mine.items || [];
      const sent = rows.find((x) => x.kind === 'entries_returned');
      expect(sent && sent.count === 1 && sent.items[0].note === 'Wrong month, make it November' && sent.items[0].currency === 'INR', "the owner's note reaches Ravi: " + JSON.stringify(sent));
      const theirs = ok(await books(shop.token, 'GET', '/todo'), 'owner todo').b;
      expect(!(Array.isArray(theirs) ? theirs : theirs.todo || theirs.items || []).some((x) => x.kind === 'entries_returned'), 'the owner is not shown the returned line');
      return back.b.closed && back.b.closed.reason;
    });

    await kase('AP-8', "a typed journal is held the same way; one that names a bill is refused in the owner's words", async () => {
      const cash = (await pg.query("SELECT a.code FROM ledger_account a WHERE a.entity_id = $1 AND a.role = 'cash' LIMIT 1", [shop.entity])).rows[0];
      const lines = [{ code: '6010', dr_minor: 1000 }, { code: cash ? cash.code : '1100', cr_minor: 1000 }];
      const journal = await books(R, 'POST', '/entries', { narration: 'Petty', date: DAY, lines, client_ref: RUN + 'j' });
      expect(journal.status === 202 && journal.b.kind === 'journal' && journal.b.total_minor === 1000, 'journal ' + said(journal));
      const party = await books(R, 'POST', '/entries', { narration: 'Bill', date: DAY, lines, against_ref: 'x', client_ref: RUN + 'k' });
      expect(party.status === 422 && /owner/i.test(JSON.stringify(party.b)), 'party ' + said(party));
      return journal.b.action_id;
    });

    await kase('AP-9', 'Ravi cannot prepare lock, unlock or year close; nothing is stored', async () => {
      const before = await steps();
      const tries = [
        ['lock', { kind: 'lock', body: { fy: '2026-27', period: 7 }, client_ref: RUN + 'l1' }],
        ['unlock', { kind: 'unlock', body: { fy: '2026-27', period: 7, reason: 'check' }, client_ref: RUN + 'l2' }],
        ['year_close', { kind: 'year_close', body: { fy: '2025-26' }, client_ref: RUN + 'l3' }]
      ];
      const bad = [];
      for (const [what, body] of tries) {
        const reply = await acts(R, 'POST', '', body);
        if (!(reply.status === 403 && reply.b.code === 'ACTION_KIND_NOT_FOR_STAFF')) bad.push(what + ' ' + said(reply));
      }
      expect(!bad.length, 'not refused: ' + bad.join(' | '));
      expect((await steps()) === before, 'a step was stored');
      return 'three refusals, ' + before + ' steps unchanged';
    });

    await kase('AP-10', 'Ravi cannot accept his own entry, and the owner cannot prepare through the staff door', async () => {
      const mine = ok(await books(R, 'POST', '/events', rent('d')), 'held again').b;
      const accept = await acts(R, 'POST', '/' + mine.action_id + '/accept', { body_hash: mine.body_hash, total_minor: 500000, currency: 'INR' });
      expect(accept.status === 403 && accept.b.code === 'OWNER_ONLY', 'accept ' + said(accept));
      const own = await acts(shop.token, 'POST', '', { kind: 'event', body: rent('e'), client_ref: RUN + 'e' });
      expect(own.status === 403, 'owner prepare ' + said(own));
      return 'accept ' + accept.status + ', owner prepare ' + own.status;
    });
  } finally {
    await pg.end();
  }
  finish('shop-bookkeeper-approves', process.env.TRUTH_JSON);
})().catch((failure) => {
  console.error(failure);
  process.exitCode = 1;
});
