/**
 * books-auto-post.test.cjs — M34: NOTHING POSTS BY ITSELF (DECISIONS; invariant I3). policy_flags.books.auto_post is OFF unless the owner turns it on.
 *
 * Proves, through the real nightly check (lib/books-nightly) on the in-memory books: with the flag OFF (absent, unreadable, or 'off') the nightly sweep
 * creates ZERO journal entries from an `auto` template or a due accrual reversal · every one of them is still a visible To-do row (recurring_due,
 * accrual_reversals_due) and an `auto` template reads as "ask me" (auto false on the row) · the flag ON posts them (the one path the owner opted into) ·
 * the flag is in the policy schema, owner-only to change.
 * Run: node tests/books-auto-post.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
const { memoryTemplates } = require('./support/books-recurring-memory.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';

(async () => {
  console.log('\n══ M34 — the nightly sweep only PROPOSES until books.auto_post is on ══\n');
  const X = H.load({});
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const R = require(path.join(H.API, 'lib', 'books-recurring'));
  const N = require(path.join(H.API, 'lib', 'books-nightly'));
  const TD = require(path.join(H.API, 'lib', 'books-todo'));
  const BP = require(path.join(H.API, 'lib', 'books-period'));
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const mem = memoryTemplates(); mem.migrated = true; R.use(mem.store);
  const DAY = '2026-10-02';
  const realDay = K.dayOf; K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));

  /* the flag as the shop's identities row would answer it; null = the read fails (a pre-migration or broken database) */
  let FLAG = undefined, BROKEN = false;
  const dbStub = require(path.join(H.API, 'db'));
  const real = dbStub.withEntity;
  dbStub.withEntity = async (e, fn) => fn(Object.assign(Object.create(X.db), {
    query: async (sql, args) => {
      if (/policy_flags'->'books'->'auto_post'/.test(String(sql))) { if (BROKEN) throw new Error('boom'); return { rows: [{ v: FLAG === undefined ? null : FLAG }] }; }
      return X.db.query(sql, args);
    },
  }));

  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  await X.B.enable(null, SHOP, { by: SHOP });
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true, credit_days: 10 });
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-08-05', currency: 'INR', party: CUST, source_ref: 'chit:a', by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: { cash: 1180 }, round_off: 0 });
  const S = await X.B.settingOf(X.db, SHOP);

  /* an auto template that fell due, and an accrual from September whose reversal day (1 Oct) has come */
  const ins = await R.create(SHOP, S, { name: 'Insurance', event: { kind: 'expense', class: 'insurance', amount: 1200, how: 'bank', narration: 'Insurance' }, frequency: 'monthly', next_on: '2026-09-30', auto: true }, SHOP);
  await BP.accrue(SHOP, S, { ref: 'ELEC-9', kind: 'outstanding', class: 'electricity', amount: 1200, date: '2026-09-30' }, SHOP);
  const entries = () => X.T.entries.length;
  const before = entries();

  const run = async (label) => { const n0 = entries(); const out = await N.check(SHOP, { today: DAY }); return { out, made: entries() - n0, label }; };

  FLAG = undefined;
  const a = await run('absent');
  ok('flag ABSENT: the nightly check creates zero journal entries', a.made === 0, 'made ' + a.made + ' ' + JSON.stringify(a.out.posted));
  ok('…it counts what it only proposed (1 template, 1 reversal), posted none', a.out.posted.recurring && a.out.posted.recurring.proposed === 1 && a.out.posted.recurring.proposed_reversals === 1 && a.out.posted.recurring.posted === 0 && a.out.posted.recurring.reversed === 0, JSON.stringify(a.out.posted.recurring));
  ok('…and the template did not move (it is still due)', mem.rows[0].next_on === '2026-09-30');

  const todo = await TD.todo(SHOP, S, DAY);
  const rd = todo.find((t) => t.kind === 'recurring_due'), rv = todo.find((t) => t.kind === 'accrual_reversals_due');
  ok('EVERY PROPOSAL IS A TO-DO ROW: the repeating entry is listed', !!rd && rd.count === 1 && rd.items[0].name === 'Insurance', JSON.stringify(rd));
  ok('…an `auto` template reads "ask me" (auto false on the row)', rd.items[0].auto === false);
  ok('…and the accrual reversal is listed, with a button to do it now', !!rv && rv.count === 1 && /Press each/.test(rv.words), JSON.stringify(rv));

  FLAG = 'off';
  ok("flag 'off': still zero entries", (await run('off')).made === 0);
  BROKEN = true;
  ok('a failed read of the flag is OFF, never on: still zero entries', (await run('broken')).made === 0);
  BROKEN = false;

  FLAG = 'on';
  const todoOn = await TD.todo(SHOP, S, DAY);
  ok("flag ON: the template's row says auto", todoOn.find((t) => t.kind === 'recurring_due').items[0].auto === true);
  const on = await run('on');
  ok('flag ON: the same check now posts the template and turns the accrual back (2 entries or more)', on.made >= 2 && on.out.posted.recurring.posted === 1 && on.out.posted.recurring.reversed === 1, JSON.stringify([on.made, on.out.posted.recurring]));
  FLAG = { on: true };
  ok("flag { on: true } is read as on", (await R.autoPostOn(SHOP)) === true);
  FLAG = 'maybe';
  ok('anything else is off', (await R.autoPostOn(SHOP)) === false);

  /* the schema */
  const P = require(path.join(H.API, 'lib', 'policy'));
  ok('policy.FLAGS has books, defaulting to empty (= OFF)', !!P.FLAGS.books && JSON.stringify(P.defaults().books) === '{}');
  ok("policy.coerce keeps books.auto_post 'on' and drops unknown keys", JSON.stringify(P.coerce('books', { auto_post: 'on', junk: 1 })) === '{"auto_post":"on"}');
  const src = require('fs').readFileSync(path.join(H.API, 'routes', 'entities.js'), 'utf8');
  ok('PATCH /entities/policy refuses `books` from anyone but the owner', /hasOwnProperty\.call\(req\.body, 'books'\)\s*&&\s*!require\('\.\.\/lib\/owner'\)\.isOwner/.test(src));

  dbStub.withEntity = real; K.dayOf = realDay;
  console.log('\n  ' + (fail ? '✗ ' + fail + ' FAILED · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
