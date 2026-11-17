'use strict';
// @type: unit
/**
 * bank-lock.test.cjs - W15-85: a statement line in a LOCKED month, said before any work, and the two ways on.
 *
 * OWNS      the proof that public/app/bank-lock.js reads the server's month rows (who closed it, when, may it reopen, the first OPEN month after it) and says nothing it does not carry;
 *           that the controller (bank-preview.js) holds a not-yet-booked line of a locked month ('closed', never ready) and never a line already in the books; that "Post in <next month> instead"
 *           makes those lines ready again with moveTo; that the post adapter (cap-bank-post.js) then sends if_locked: next_open, the line's OWN date and the bank's own words (an entry; the api adds the note) or the same switch (a payment); and that a second read of the SAME file finds the moved line by its client_ref (the bank log's posted row carries posting_date and doc_date),
 *           shows it as in the books with "posted 1 Oct 2026 (September locked)", offers it no more, and hands the engine the SAME books lines and opening as before (the difference does not move).
 *           The engines are stand-ins here (their contract is read through one door); the real engines and the page are proven by the SIT walk (e2e/banklock-live.cjs).
 * CALLED BY ci.yml (the unit checks): node e2e/bank-lock.test.cjs
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
const path = require('path'),
  assert = require('assert');
const pub = (rel) => path.join(__dirname, '..', 'public', rel);
/* the page loads helpers.js first (monthNames, the one list of month words); so does this unit */
globalThis.window = globalThis;
require('vm').runInThisContext(require('fs').readFileSync(pub('app/helpers.js'), 'utf8'), { filename: 'helpers.js' });
const L = require(pub('app/bank-lock.js'));
globalThis.CBBankLock = L;
const P = require(pub('app/bank-preview.js')),
  POST = require(pub('app/cap-bank-post.js'));
let ran = 0;
const ok = (name) => console.log('ok  ' + name) || ran++;

const ROWS = [
  { fiscal_year: '2026-27', period: 3, start_date: '2026-09-01', end_date: '2026-09-30', status: 'soft_locked', reopen: { may: true }, lock_trail: [{ action: 'locked', by_name: 'Anna Lee', at: '2026-10-03T01:00:00Z' }] },
  { fiscal_year: '2026-27', period: 4, start_date: '2026-10-01', end_date: '2026-10-31', status: 'open', reopen: { may: false } },
  { fiscal_year: '2026-27', period: 2, start_date: '2026-08-01', end_date: '2026-08-31', status: 'hard_locked', reopen: { may: false }, lock_trail: [] }
];

/* ── 1 · the month rows ── */
const sep = L.lockedOf(ROWS, '2026-09-15');
assert.strictEqual(sep.label, 'September 2026');
assert.strictEqual(sep.by, 'Anna Lee');
assert.strictEqual(sep.at, '2026-10-03');
assert.strictEqual(sep.may, true);
assert.deepStrictEqual(sep.next && sep.next.date, '2026-10-01');
ok('a day in a locked month: its label, who closed it, when, may it reopen, the next open month');
assert.strictEqual(L.lockedOf(ROWS, '2026-10-02'), null);
assert.strictEqual(L.lockedOf(ROWS, '2027-01-02'), null);
ok('an open month, or a month the rows do not cover, is not locked');
assert.strictEqual(L.noticeWords(Object.assign({ count: 1 }, sep)), "September 2026 is locked (closed by Anna Lee, 3 Oct 2026). New lines can't be added until it's reopened.");
const aug = L.lockedOf(ROWS, '2026-08-10');
assert.strictEqual(aug.may, false);
assert.strictEqual(aug.by, null);
assert.strictEqual(L.noticeWords(aug), "August 2026 is locked. New lines can't be added until it's reopened.");
ok('a month whose trail names nobody is just "locked": nothing is filled in; a hard lock offers no reopen');
const twoLocked = ROWS.concat([{ fiscal_year: '2026-27', period: 5, start_date: '2026-11-01', end_date: '2026-11-30', status: 'open' }]).map((row) => (row.period === 4 ? Object.assign({}, row, { status: 'soft_locked' }) : row));
assert.strictEqual(L.lockedOf(twoLocked, '2026-09-15').next.date, '2026-11-01');
ok('the next OPEN month skips a locked one');
assert.strictEqual(L.lateWords({ posting_date: '2026-10-01', doc_date: '2026-09-15' }), 'posted 1 Oct 2026 (September locked)');
assert.strictEqual(L.lateWords({ posting_date: '2026-09-15', doc_date: '2026-09-15' }), null);
assert.strictEqual(L.lateWords({ posting_date: '2026-09-15' }), null);
ok('the late-posted words read the two carried dates (a normal line says nothing)');

/* ── 2 · the controller, with stand-in engines ── */
const LINES = [
  { date: '2026-09-15', narration: 'MONTHLY ACCOUNT FEE', debit_minor: 1500, credit_minor: 0 },
  { date: '2026-09-20', narration: 'Credit interest', debit_minor: 0, credit_minor: 250 },
  { date: '2026-09-25', narration: 'Telstra', debit_minor: 11000, credit_minor: 0 },
  { date: '2026-10-05', narration: 'Bunnings', debit_minor: 3000, credit_minor: 0 }
];
const refOf = (i) => 'bank:' + 'a'.repeat(23) + i + '-1';
const BOOKS = { lines: [{ id: 'L1', date: '2026-09-25', dr_minor: 0, cr_minor: 11000, ref: null, entry_no: 'MJ/1' }], opening_minor: 500000 };
function engines(seen) {
  return {
    recon: {
      parse: () => ({ ok: true, lines: LINES, warnings: [], skipped: [], opening_minor: 500000, closing_minor: 480000 }),
      match: () => ({ matched: [{ stmt: [2], ledger: ['L1'], how: 'amount+date' }], unmatched_stmt: LINES.map((l, i) => Object.assign({ i }, l)), unmatched_ledger: [] }),
      suggest: (line) => ({ event: { type: 'expense', class: 'bank_charges', date: line.date, amount: 1, narration: line.narration } })
    },
    project: {
      refsOf: (lines) => lines.map((l, i) => refOf(i)),
      project: (lines, proposals, books) => {
        seen.books = books;
        const row = (i) => {
          const posted = i === 2 || (books.posted_refs || []).indexOf(refOf(i)) >= 0; /* line 2 is matched to a books entry */
          return { i, state: posted ? 'in_books' : 'proposed', ready: !posted, blockers: [], ref: refOf(i), entry: posted ? null : { lines: [] }, party: null };
        };
        return {
          ok: true, currency: 'AUD', lines: lines.map((l, i) => row(i)), ledger: [], brs: { opening: books.opening_minor, ledger: books.ledger.length }, parties_to_create: [],
          totals: { entries: 3, in: { amount_minor: 250, currency: 'AUD' }, out: { amount_minor: 4500, currency: 'AUD' }, tax: { amount_minor: 0, currency: 'AUD' }, from: '2026-09-15', to: '2026-10-05' },
          counts: { lines: 4, in_books: 0, proposed: 3, ready: 3, needs_you: 0 }
        };
      }
    }
  };
}
const make = (over) => {
  const seen = { posted: [] };
  const ctl = P.create(
    Object.assign(
      {
        engine: engines(seen), currency: 'AUD', statementCurrency: () => 'AUD', account: 'Eastlake',
        ledger: () => Object.assign({}, BOOKS, { posted_refs: [] }),
        post: async (item) => (seen.posted.push(item), { ok: true, entry_no: 'MJ/9', posting_date: '2026-10-01' }),
        lockedMonth: (date) => L.lockedOf(ROWS, date)
      },
      over
    )
  );
  ctl.load('x', 'sep.csv');
  return { ctl, seen };
};

const first = make();
let items = first.ctl.view().items;
assert.deepStrictEqual(items.map((i) => i.state), ['closed', 'closed', 'in_books', 'proposed']);
assert.strictEqual(items[0].closed.label, 'September 2026');
ok('lines of a locked month are held (closed); an open month\'s line is ready; no work was done first');
assert.strictEqual(first.ctl.readyCount(), 1);
assert.deepStrictEqual(L.groupsOf(items, first.ctl.movedMonths()).map((g) => [g.key, g.count, g.moved]), [['2026-09', 2, false]]);
ok('the band reads one group: September 2026, 2 lines, not moved');
const booked = make({ ledger: () => Object.assign({}, BOOKS, { posted_refs: [refOf(0)] }) });
assert.strictEqual(booked.ctl.view().items[0].state, 'in_books');
assert.strictEqual(booked.ctl.view().items[0].closed, null);
ok('a line already in the books is never held by the lock');

first.ctl.moveLocked('2026-09', true);
items = first.ctl.view().items;
assert.deepStrictEqual(items.map((i) => i.state), ['proposed', 'proposed', 'in_books', 'proposed']);
assert.strictEqual(items[0].moveTo.next.date, '2026-10-01');
assert.strictEqual(first.ctl.readyCount(), 3);
ok('"Post in October instead": the lines are ready again, each carrying where it will post');
first.ctl.moveLocked('2026-09', false);
assert.strictEqual(first.ctl.readyCount(), 1);
ok('"Keep them out" takes it back');

/* ── 3 · what is sent ── */
(async () => {
  first.ctl.moveLocked('2026-09', true);
  const sent = [];
  const adapter = POST.adapter({ api: async (key, opts) => (sent.push([key, opts.body]), { ok: true, entry_no: 'MJ/9', posting_date: '2026-10-01', duplicate: false }), who: { role: 'owner' } });
  const fee = first.ctl.view().items[0];
  const reply = await adapter(Object.assign({}, fee, { event: Object.assign({}, fee.event, { type: 'expense', class: 'bank_charges', date: '2026-09-15', amount: { amount_minor: 1500, currency: 'AUD' }, narration: 'MONTHLY ACCOUNT FEE' }) }));
  assert.strictEqual(reply.ok, true);
  assert.strictEqual(reply.posting_date, '2026-10-01');
  const body = sent[0][1];
  assert.strictEqual(body.if_locked, 'next_open');
  assert.strictEqual(body.date, '2026-09-15');
  assert.strictEqual(body.narration, 'MONTHLY ACCOUNT FEE'); /* the api adds the "<Month> locked" note (W15-85a), one wording for events and payments */
  assert.strictEqual(body.client_ref, fee.ref);
  ok('an entry is sent with if_locked next_open, its OWN date, the bank own words, and the line\'s own client_ref');
  const plain = POST.bodyOf(Object.assign({}, items[3], { moveTo: null, event: { type: 'expense', date: '2026-10-05', amount: 1, narration: 'Bunnings' } }), null, null);
  assert.strictEqual(plain.if_locked, undefined);
  assert.strictEqual(plain.narration, 'Bunnings');
  ok('a line in an open month is sent exactly as before');
  const pay = POST.paymentBodyOf(Object.assign({}, fee, { event: { type: 'payment_made', date: '2026-09-25' }, line: LINES[2] }), 'P1', null);
  assert.strictEqual(pay.if_locked, 'next_open');
  assert.strictEqual(pay.received_at, '2026-09-25');
  ok('a payment to a party carries the same switch and keeps its own day');

  /* ── 4 · the SAME file read again, on another session: found by its ref, not offered, difference unchanged ── */
  const logRow = { ref: refOf(0), entry_no: 'MJ/9', posting_date: '2026-10-01', doc_date: '2026-09-15' };
  const lateRefs = [logRow].filter((row) => L.lateWords(row)).map((row) => row.ref);
  const again = make({
    ledger: () => Object.assign({}, BOOKS, { posted_refs: lateRefs }), /* the ledger of the statement's dates cannot show an October entry: the bank log does */
    lateOf: (ref) => L.lateWords([logRow].filter((row) => row.ref === ref)[0])
  });
  const reread = again.ctl.view().items[0];
  assert.strictEqual(reread.state, 'in_books');
  assert.strictEqual(reread.closed, null);
  assert.strictEqual(reread.moveTo, null);
  assert.strictEqual(reread.alreadyWhy, 'posted 1 Oct 2026 (September locked)');
  assert.strictEqual(again.ctl.view().items[1].state, 'closed');
  ok('read again: the moved line is "In your books · posted 1 Oct 2026 (September locked)"; the unmoved one is still held');
  assert.strictEqual(again.ctl.readyCount(), 1);
  assert.deepStrictEqual(L.groupsOf(again.ctl.view().items, {}).map((g) => g.count), [1]);
  ok('it is not offered again: the band counts only the lines still to do');
  assert.deepStrictEqual(again.seen.books.ledger, first.seen.books.ledger);
  assert.strictEqual(again.seen.books.opening_minor, first.seen.books.opening_minor);
  ok('the engine got the same books lines and opening as before: the Difference does not move');
  assert.strictEqual(logRow.ref, refOf(0));
  ok('the line is found by its own client_ref, never by date (the posted row names posting_date 1 Oct, the line is 15 Sep)');
  /* W15-85b · the band's buttons by seat: Reopen is the owner's alone; "Post in <month> instead" is the owner's and the accountant's where the grant lets her post */
  {
    const vm = require('vm'), src = require('fs').readFileSync(pub('app/cap-bank-sheet.js'), 'utf8');
    const at = src.indexOf('function bkshLockNotice()'), body = src.slice(at, src.indexOf('\n}\n', at) + 3);
    const group = { key: '2026-09', label: 'September 2026', name: 'September', may: true, next: { name: 'October', date: '2026-10-01' }, moved: false, count: 1, by: null, at: null };
    const seat = (signed) => {
      const sb = { bkshSignedIn: () => signed, bkshLockGroups: () => [group], CBBankLock: L, bkbE: (x) => x, tx: (x) => x, txf: (x) => x };
      vm.createContext(sb);
      vm.runInContext(body + '\nthis.out = bkshLockNotice();', sb);
      return { reopen: /bank-lock-reopen-0/.test(sb.out), move: /bank-lock-move-0/.test(sb.out) };
    };
    assert.deepStrictEqual(seat({ role: 'owner' }), { reopen: true, move: true });
    assert.deepStrictEqual(seat({ role: 'adviser', posts: true }), { reopen: false, move: true });
    assert.deepStrictEqual(seat({ role: 'adviser', posts: false }), { reopen: false, move: false });
    assert.deepStrictEqual(seat({ role: 'other' }), { reopen: false, move: false });
    ok('the owner may Reopen and Post in the next month; the accountant who posts may only Post in the next month; one who may not post, and anyone else, is told and offered neither');
  }
  console.log('\n' + ran + ' checks passed');
})().catch((failure) => {
  console.error(failure);
  process.exit(1);
});
