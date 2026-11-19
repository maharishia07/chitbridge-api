'use strict';
/**
 * tests/shop-bookkeeper.realstack.cjs — the shop Bookkeeper (slice A, W25/W26) on REAL Postgres, the api running as cb_app, an IN shop.
 *
 * owns: the proof the stand-in routers cannot give: the seat is made by the owner (POST /api/actors, hat manager), signs in with its own first code, and does the day's books; the
 *       books carry the employee's own id on what it posted; the owner-only doors refuse it in the owner's words.
 * FLOW  fresh IN shop (not GST registered), books on → owner adds "Ravi" as Bookkeeper (editor, whole entity, sees costs, hat manager) and "Meena" as a plain editor (Regional manager facts, hat act)
 *   BK-1  GET /api/people names Ravi "Bookkeeper" and Meena "Regional manager"; GET /api/actors preset keys bookkeeper / regional (no collision)
 *   BK-2  Ravi: GET /events says may.post.ok (first step); the preview of Pay expense rent Rs 5,000 cash carries no "Only the owner may record this."; POST /events posts it (200),
 *         the journal holds Dr 6010 500000 / Cr cash 500000 created_by Ravi; Meena is refused POST /events (403 OWNER_ONLY) and her GET /events says may.post.ok false
 *   BK-3  Ravi adds a bank fee line paid from the bank, signs the statement (201) and matches the line (201); GET /bank/statement-files says may.write.may and may.post.ok
 *   BK-4  Ravi is refused year close, lock, unlock, write-off, settings and opening balances (the books are running): 403 OWNER_ONLY, the words name the owner; the owner closes nothing here
 *   BK-5  (20 Nov, Athi: the edit seat creates AND modifies, its id on every change) Ravi posts; created_by is Ravi (not the owner), the Day book names him (made_by); Ravi reverses it (a mirror entry, never an edit):
 *         200, the reversal's created_by is Ravi, the original reads reversed_by the reversal; a second reverse is 409 ALREADY_REVERSED
 *   BK-6  the owner asks to approve first (books_owner_approves on): Ravi's reverse answers 202 held, nothing reversed; the owner accepts, the reversal posts once, created_by Ravi, the approver (accepted step) is the owner
 *   BK-7  an Auditor-seat employee (commenter) and a View-only employee are refused the reverse (403); neither changes the books
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 * Run: API_BASE=http://127.0.0.1:<port> node tests/shop-bookkeeper.realstack.cjs   ⚠️ LOCAL / throwaway DB ONLY (the harness refuses anything else)
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;

const RUN = 'bk' + (Date.now() % 1e8).toString(36).padStart(6, '0');
const key = (tag) => ('k' + tag + RUN.slice(-6)).slice(0, 12);
const { shopToday } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
const DAY = shopToday();
const said = (reply) => JSON.stringify([reply.status, reply.b]);
const addActor = async (shop, name, tag, extra) => ok(await j('/api/actors', { method: 'POST', token: shop.token, body: Object.assign({ display_name: name, actor_key: key(tag), email: key(tag) + '@local.test', access_level: 'editor', whole_entity: true, can_see_costs: true }, extra) }), 'add ' + name).b;
const signIn = async (person) => ok(await j('/api/actors/login', { method: 'POST', body: { username: person.actor.login_format, otp: H.ENTITY_OTP } }), 'first sign-in of ' + person.actor.login_format).b.token;
const rent = (ref) => ({ kind: 'expense', class: 'rent', date: DAY, amount_minor: 500000, narration: 'Shop rent', paid_from: 'cash', client_ref: RUN + ref });
const owner = (reply) => reply.status === 403 && reply.b.code === 'OWNER_ONLY' && /owner/i.test(JSON.stringify(reply.b.detail || reply.b.message || ''));

(async () => {
  console.log('\n══ shop Bookkeeper · slice A · real Postgres · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const shop = await freshShop(RUN, 'Bookkeeper Shop', { tax: { registered: false } });
    ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
    const ravi = await addActor(shop, 'Ravi Books', 'r', { hat: 'manager' });
    const meena = await addActor(shop, 'Meena Counter', 'm', { hat: 'act' });
    const R = await signIn(ravi);
    const M = await signIn(meena);
    const call = (token, method, path, body) => j('/api/books' + path, { method, token, body });

    await kase('BK-1', 'the people list says Bookkeeper and Regional manager apart (same three facts, the hat differs)', async () => {
      const people = ok(await j('/api/people', { token: shop.token }), 'people').b.people;
      const label = (id) => (people.find((p) => p.id === id || p.identity_id === id) || { access: {} }).access.label;
      expect(label(ravi.actor.identity_id) === 'Bookkeeper' && label(meena.actor.identity_id) === 'Regional manager', 'labels ' + label(ravi.actor.identity_id) + ' / ' + label(meena.actor.identity_id));
      const actors = ok(await j('/api/actors', { token: shop.token }), 'actors').b;
      const list = actors.actors || actors.rows || actors;
      const preset = (id) => (list.find((a) => a.identity_id === id) || {}).preset;
      expect(preset(ravi.actor.identity_id) === 'bookkeeper' && preset(meena.actor.identity_id) === 'regional', 'presets ' + preset(ravi.actor.identity_id) + ' / ' + preset(meena.actor.identity_id));
      return 'Bookkeeper / Regional manager';
    });

    await kase('BK-2', 'Ravi posts Pay expense (rent, Rs 5,000, cash) with his own login; Meena is refused and told on the first read', async () => {
      const first = ok(await call(R, 'GET', '/events'), 'Ravi events').b;
      expect(first.may && first.may.post && first.may.post.ok === true, 'Ravi may.post ' + JSON.stringify(first.may));
      const hers = ok(await call(M, 'GET', '/events'), 'Meena events').b;
      expect(hers.may && hers.may.post && hers.may.post.ok === false && hers.may.post.code === 'OWNER_ONLY', 'Meena may.post ' + JSON.stringify(hers.may));
      const preview = ok(await call(R, 'POST', '/preview', { event: rent('p') }), 'preview').b;
      expect(!JSON.stringify(preview.refusals || []).includes('Only the owner may record this.') && preview.balanced === true, 'preview ' + JSON.stringify(preview).slice(0, 400));
      const posted = await call(R, 'POST', '/events', rent('a'));
      expect(posted.status === 200 && posted.b.ok && posted.b.entry_no, 'post ' + said(posted));
      const lines = (await pg.query("SELECT a.code, l.dr_minor, l.cr_minor, e.created_by FROM journal_entry e JOIN journal_line l ON l.entry_id = e.entry_id AND l.entity_id = e.entity_id JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id WHERE e.entity_id = $1 AND e.entry_no = $2", [shop.entity, posted.b.entry_no])).rows;
      const dr = lines.find((x) => Number(x.dr_minor) === 500000), cr = lines.find((x) => Number(x.cr_minor) === 500000);
      expect(lines.length === 2 && dr && dr.code === '6010' && cr && lines.every((x) => x.created_by === ravi.actor.identity_id), 'journal ' + JSON.stringify(lines));
      const refused = await call(M, 'POST', '/events', rent('b'));
      expect(owner(refused), 'Meena ' + said(refused));
      return posted.b.entry_no;
    });

    await kase('BK-3', 'Ravi adds a bank statement and matches a line; the Bank page is told he may', async () => {
      const accounts = ok(await call(R, 'GET', '/accounts'), 'accounts').b;
      const bank = ((accounts.accounts || accounts.rows || accounts).find((x) => x.role === 'bank') || {}).code;
      expect(!!bank, 'a bank ledger');
      const fee = ok(await call(R, 'POST', '/events', { kind: 'expense', class: 'bank_charges', date: DAY, amount_minor: 1000, narration: 'Account fee', paid_from: 'bank', client_ref: RUN + 'f' }), 'bank fee');
      const FP = 'fp' + RUN;
      const mark = await call(R, 'POST', '/bank/marks', { account: bank, file_hash: FP, marks: [{ act: 'accept', key: RUN + 'f', how: 'matched', ledger: [String(fee.b.entry_no)] }] });
      const statement = await call(R, 'POST', '/bank/statements', { account: bank, period_from: DAY, period_to: DAY, opening_minor: 0, closing_bank_minor: -1000, closing_books_minor: -1000, difference_minor: 0, currency: 'INR', file_hash: FP });
      expect(mark.status === 201 && statement.status === 201, 'marks/statement ' + said(mark) + ' ' + said(statement));
      const files = ok(await call(R, 'GET', '/bank/statement-files?accounts=' + bank), 'statement-files').b;
      expect(files.may && files.may.write && files.may.write.may === true && files.may.post.ok === true, 'may ' + JSON.stringify(files.may));
      return said(statement);
    });

    await kase('BK-4', 'the decisions that cannot be undone stay the owner\'s: refused in the owner\'s words', async () => {
      const tries = [
        ['year close', await call(R, 'POST', '/year/2026-27/close', { returns_lodged: true })],
        ['lock', await call(R, 'POST', '/periods/2026-27/7/lock', {})],
        ['unlock', await call(R, 'POST', '/periods/2026-27/7/unlock', {})],
        ['write-off', await call(R, 'POST', '/write-off', {})],
        ['settings', await call(R, 'POST', '/setting', { walkin_grain: 'shift' })],
        ['opening, the books are running', await call(R, 'POST', '/opening', { rows: [{ code: '1400', dr_minor: 100 }, { code: '3000', cr_minor: 100 }] })]
      ];
      const bad = tries.filter(([, reply]) => !owner(reply)).map(([what, reply]) => what + ' ' + said(reply));
      expect(!bad.length, 'not refused as OWNER_ONLY: ' + bad.join(' | '));
      return tries.map(([what, reply]) => what + ' ' + reply.status).join(', ');
    });
    const nameOf = async (token, entryNo) => {
      const book = ok(await call(token, 'GET', '/daybook?from=' + DAY + '&to=' + DAY), 'day book').b;
      return (book.entries || []).find((entry) => entry.entry_no === entryNo);
    };
    const rowOf = async (entryId) => (await pg.query('SELECT entry_no, created_by, reverses_entry_id, source_ref FROM journal_entry WHERE entity_id = $1 AND entry_id = $2', [shop.entity, entryId])).rows[0];
    let original;
    await kase('BK-5', 'Ravi posts then reverses: his id is on both entries, the Day book names him, the original reads reversed', async () => {
      original = ok(await call(R, 'POST', '/events', rent('p')), 'Ravi posts').b;
      const mine = await rowOf(original.entry_id);
      expect(mine.created_by === ravi.actor.identity_id, 'created_by is Ravi, not the owner: ' + JSON.stringify(mine));
      const seen = await nameOf(shop.token, original.entry_no);
      expect(seen && seen.made_by === 'Ravi Books', 'the Day book names the maker: ' + JSON.stringify(seen && seen.made_by));
      const undone = await call(R, 'POST', '/entries/' + original.entry_id + '/reverse', { reason: 'Wrong month, re-enter' });
      expect(undone.status === 200 && undone.b.ok && undone.b.entry_no && undone.b.reverses_entry_id === original.entry_id, 'reverse ' + said(undone));
      const mirror = await rowOf(undone.b.entry_id);
      expect(mirror.created_by === ravi.actor.identity_id && mirror.reverses_entry_id === original.entry_id, 'the reversal carries Ravi: ' + JSON.stringify(mirror));
      const after = await nameOf(shop.token, original.entry_no);
      expect(after && after.reversed_by === undone.b.entry_no, 'the original is marked reversed by ' + undone.b.entry_no + ': ' + JSON.stringify(after && after.reversed_by));
      const again = await call(R, 'POST', '/entries/' + original.entry_id + '/reverse', { reason: 'twice' });
      expect(again.status === 409 && again.b.code === 'ALREADY_REVERSED', 'a second reverse ' + said(again));
      return original.entry_no + ' reversed by ' + undone.b.entry_no + ' (both by Ravi)';
    });

    await kase('BK-6', 'owner approves ON: the reverse Ravi presses is held, the owner accepts, the reversal posts once, by Ravi, approved by the owner', async () => {
      ok(await j('/api/entities/policy', { method: 'PATCH', token: shop.token, body: { books_owner_approves: 'on' } }), 'approves on');
      const target = ok(await call(shop.token, 'POST', '/events', rent('q')), 'the owner posts the entry to be corrected').b;
      const held = await call(R, 'POST', '/entries/' + target.entry_id + '/reverse', { reason: 'Entered twice' });
      expect(held.status === 202 && held.b.state === 'waiting_accept' && held.b.kind === 'reverse' && held.b.total_minor === 500000 && held.b.currency === 'INR', 'held ' + said(held));
      const still = await nameOf(shop.token, target.entry_no);
      expect(still && !still.reversed_by, 'nothing is reversed yet');
      const done = await j('/api/books-actions/' + held.b.action_id + '/accept', { method: 'POST', token: shop.token, body: { store_id: shop.entity, body_hash: held.b.body_hash, total_minor: 500000, currency: 'INR' } });
      expect(done.status === 200 && done.b.entry && done.b.entry.entry_no, 'accept ' + said(done));
      const mirror = await rowOf(done.b.entry.entry_id);
      expect(mirror.created_by === ravi.actor.identity_id && mirror.reverses_entry_id === target.entry_id && mirror.source_ref === 'action:' + held.b.action_id, 'the held reversal carries Ravi: ' + JSON.stringify(mirror));
      const one = ok(await j('/api/books-actions/' + held.b.action_id + '?store_id=' + shop.entity, { token: shop.token }), 'the action').b;
      const names = (one.steps || []).map((step) => step.step + ':' + step.role + ':' + step.name);
      expect(names.length === 2 && names[0].startsWith('prepared:staff:Ravi') && names[1].startsWith('accepted:owner:'), 'steps ' + names.join(' | '));
      return done.b.entry.entry_no + ' · ' + names.join(' | ');
    });

    await kase('BK-7', 'an Auditor-seat employee and a View-only employee are refused the reverse; the books do not move', async () => {
      const auditor = await signIn(await addActor(shop, 'Asha Audit', 'a', { access_level: 'commenter', hat: 'audit' }));
      const viewer = await signIn(await addActor(shop, 'Vik View', 'v', { access_level: 'viewer', whole_entity: false, can_see_costs: false }));
      const fresh = ok(await call(shop.token, 'POST', '/events', rent('r')), 'the owner posts one more').b;
      const tries = [['auditor', auditor], ['view-only', viewer]].map(async ([what, token]) => [what, await call(token, 'POST', '/entries/' + fresh.entry_id + '/reverse', { reason: 'x' })]);
      const bad = (await Promise.all(tries)).filter(([, reply]) => reply.status !== 403).map(([what, reply]) => what + ' ' + said(reply));
      expect(!bad.length, 'not refused: ' + bad.join(' | '));
      const kept = await nameOf(shop.token, fresh.entry_no);
      expect(kept && !kept.reversed_by, 'the entry is untouched');
      return 'auditor and view-only: 403';
    });
  } finally {
    await pg.end();
  }
  finish('shop-bookkeeper', process.env.TRUTH_JSON);
})().catch((failure) => {
  console.error(failure);
  process.exitCode = 1;
});
