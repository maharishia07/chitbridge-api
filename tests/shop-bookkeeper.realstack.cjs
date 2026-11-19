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
 *   BK-4  Ravi is refused year close, lock, unlock, reverse, write-off, settings and opening balances (the books are running): 403 OWNER_ONLY, the words name the owner; the owner closes nothing here
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
        ['reverse', await call(R, 'POST', '/entries/00000000-0000-4000-8000-000000000000/reverse', { reason: 'x' })],
        ['write-off', await call(R, 'POST', '/write-off', {})],
        ['settings', await call(R, 'POST', '/setting', { walkin_grain: 'shift' })],
        ['opening, the books are running', await call(R, 'POST', '/opening', { rows: [{ code: '1400', dr_minor: 100 }, { code: '3000', cr_minor: 100 }] })]
      ];
      const bad = tries.filter(([, reply]) => !owner(reply)).map(([what, reply]) => what + ' ' + said(reply));
      expect(!bad.length, 'not refused as OWNER_ONLY: ' + bad.join(' | '));
      return tries.map(([what, reply]) => what + ' ' + reply.status).join(', ');
    });
  } finally {
    await pg.end();
  }
  finish('shop-bookkeeper', process.env.TRUTH_JSON);
})().catch((failure) => {
  console.error(failure);
  process.exitCode = 1;
});
