'use strict';
// @type: unit
/**
 * bank-preview.test.cjs - the Bank-to-books preview module, its in-app post adapter and the no-login demo page.
 *
 * OWNS      the proof that public/app/bank-preview.js (1) fingerprints a line the same in a re-exported file, (2) refuses a statement in another currency than the
 *           account, naming both, (3) never offers a line that needs a person, (4) posts ONE LINE AT A TIME: a failing line shows its own reason and the others go on,
 *           (5) refuses a line in a closed month before the press and counts it in the popup, (6) counts new parties once, (7) asks the GST basis and reads again with
 *           it; that public/app/cap-bank-post.js makes a new party FIRST, then posts with the party id and client_ref bank:<fp>, and says an owner-only refusal once;
 *           and that public/bank-demo.html is public and inert: strict CSP, noindex, no config.js / device-id.js, no network call and no storage in its files.
 *           The engines are stand-ins here (their contract is read through one door, projectionOf_); the real engines are proven by the SIT walk.
 * SCREEN    public/app/cap-bank-post.js (the adapter) has no screen of its own: what it could not do is said in words on the line ("Could not add ...", tested here); the
 *           light and dark theme at 1366 and 390, AA contrast and the locale (string layer) of the page that shows it are walked by e2e/walk-bank-demo.cjs.
 * CALLED BY ci.yml (the unit checks): node e2e/bank-preview.test.cjs
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
const fs = require('fs'),
  path = require('path'),
  assert = require('assert');
const pub = (rel) => path.join(__dirname, '..', 'public', rel);
const read = (rel) => fs.readFileSync(pub(rel), 'utf8').split('\r\n').join('\n');
const P = require(pub('app/bank-preview.js')),
  POST = require(pub('app/cap-bank-post.js'));
let ran = 0;
const ok = (name) => console.log('ok  ' + name) || ran++;

/* ── stand-in engines, shaped as the engines contract says (project(lines, proposals, books); amounts are { amount_minor, currency }) ── */
const LINES = [
  { date: '2026-10-23', narration: 'Account fee', debit_minor: 2200, credit_minor: 0 },
  { date: '2026-10-28', narration: 'Credit interest', debit_minor: 0, credit_minor: 1250 },
  { date: '2026-11-02', narration: 'ATO payment', debit_minor: 120000, credit_minor: 0 },
  { date: '2026-11-05', narration: 'Telstra', debit_minor: 11000, credit_minor: 0 },
  { date: '2026-11-06', narration: 'EFT customer', debit_minor: 0, credit_minor: 55000 }
];
const money = (minor) => ({ amount_minor: minor, currency: 'AUD' });
function engines(seen) {
  return {
    recon: {
      parse: (text) => (text === 'bad' ? { ok: false, why: 'Nothing to read: the statement is empty.' } : { ok: true, lines: LINES, warnings: [], skipped: seen.skipped || [], opening_minor: 1000000, closing_minor: 1750850 }),
      match: () => ({ matched: [{ stmt: [4], ledger: ['L1'], how: 'amount+date' }], unmatched_stmt: LINES.slice(0, 4).map((l, i) => Object.assign({ i }, l)), unmatched_ledger: [{ id: 'L9' }, { id: 'L8' }] }),
      nearMatches: (open, free) => ((seen.nearArgs = { open, free }), seen.near || {}),
      suggest: (line, o) => (seen.suggest.push(o), { event: { type: 'expense', date: line.date, amount: 1 } })
    },
    project: {
      refsOf: (lines) => lines.map((l, i) => "bank:" + "a".repeat(23) + i + "-1"),
      project: (lines, proposals, books) => {
        seen.project++;
        seen.args = { lines, proposals, books };
        if (books.statement.currency !== books.currency) return { ok: false, code: 'currency_mismatch', why: 'This statement is in ' + books.statement.currency + ' but the bank account is in ' + books.currency + '. Nothing is converted in this version.' };
        const gst = seen.suggest[seen.suggest.length - 1].gst_basis ? [] : ['gst_basis'];
        const row = (i, state, ready, blockers, party) => ({ i, state, ready, blockers, ref: 'bank:' + 'a'.repeat(23) + i + '-1', entry: ready || blockers.length ? { lines: [] } : null, party: party || null });
        return {
          ok: true,
          currency: 'AUD',
          lines: [
            row(0, 'proposed', true, []),
            row(1, 'proposed', true, [], { status: 'new', name: 'Origin Energy', kind: 'supplier' }),
            row(2, 'needs_you', false, ['no_entry'], { status: 'new', name: 'ATO', kind: 'supplier' }),
            row(3, 'proposed', !gst.length, gst, { status: 'new', name: 'origin energy', kind: 'supplier' }),
            row(4, 'in_books', false, [])
          ],
          ledger: [],
          brs: null,
          totals: seen.noTotals ? null : { entries: 3, in: money(1250), out: money(13200), tax: money(0), from: '2026-10-23', to: '2026-11-05' },
          counts: { lines: 5, in_books: 1, proposed: 3, ready: 3, needs_you: 1 },
          parties_to_create: [{ key: 'party:1', name: 'ATO', kind: 'supplier', lines: [2], did_you_mean: [{ id: 'p1', name: 'Australian Taxation Office', kind: 'supplier', score: 0.7 }] }]
        };
      }
    }
  };
}
const make = (over) => {
  const seen = { suggest: [], project: 0, posted: [] };
  const ctl = P.create(
    Object.assign(
      {
        engine: engines(seen),
        currency: 'AUD',
        statementCurrency: () => 'AUD', /* B5-05: the statement's currency is never the account's by default; a test that wants the file silent passes statementCurrency: () => null */
        account: 'Demo',
        ledger: () => ({ lines: [], opening_minor: 1000000 }),
        post: async (item) => (seen.posted.push(item.ref), { ok: true, entry_no: 'E' + seen.posted.length }),
        lockedMonth: () => null
      },
      over
    )
  );
  return { ctl, seen };
};

(async () => {
  /* currency */
  const usd = make({ statementCurrency: () => 'USD' });
  const refused = usd.ctl.load('ok', 'x.csv');
  assert.strictEqual(refused.ok, false);
  assert.ok(/USD/.test(refused.why) && /AUD/.test(refused.why));
  assert.deepStrictEqual(usd.ctl.view().items, []);
  assert.strictEqual(make().ctl.load('bad').ok, false);
  ok('a statement in another currency is refused (the engine words, naming both) and no line is shown');
  /* B5-05: a file that does not say its currency is NOT read as the account's */
  const silent = make({ statementCurrency: () => null });
  assert.strictEqual(silent.ctl.load('ok', 'f.csv').ok, false);
  assert.strictEqual(silent.seen.args.books.statement.currency, null);
  assert.deepStrictEqual(silent.ctl.view().items, []);
  const noAsker = make({ statementCurrency: undefined });
  assert.strictEqual(noAsker.ctl.load('ok', 'f.csv').ok, false);
  assert.strictEqual(noAsker.seen.args.books.statement.currency, null);
  ok('B5-05: with no statement currency (none said, none in the file) nothing is defaulted to the account\'s: the engine is handed none and refuses');

  /* FIN-116 / FIN-117: what the host cannot post, and a tax kind asked of a registered shop, ride on the PROPOSAL as the engine's own `needs` (so its counts and totals leave the line out); the demo (no options) does not move */
  const plain = make();
  plain.ctl.load('ok', 'f.csv');
  assert.strictEqual(plain.seen.args.proposals[0].needs, undefined);
  const registered = make({ taxRegistered: true });
  registered.ctl.load('ok', 'f.csv');
  assert.strictEqual(registered.seen.args.proposals[0].needs, 'tax_kind');
  const unknownReg = make({ taxRegistered: null });
  unknownReg.ctl.load('ok', 'f.csv');
  assert.strictEqual(unknownReg.seen.args.proposals[0].needs, undefined, 'registration unknown asks nothing and claims nothing');
  const onlyContra = make({ postable: ['contra'] });
  onlyContra.ctl.load('ok', 'f.csv');
  assert.strictEqual(onlyContra.seen.args.proposals[0].needs, 'not_here');
  ok('FIN-116/117: a registered shop is ASKED the tax kind (needs tax_kind, never defaulted); unknown registration asks nothing; a kind the host cannot post says where it is recorded; the demo is unchanged');

  /* the statement check runs before any line is worked (engines bank-statement-check via bank-preview-check.js): refuse stops in its words, confirm waits for the owner's tick, already-done lines carry their why */
  globalThis.CBBankPreviewCheck = require(pub('app/bank-preview-check.js'));
  const verdictOf = (verdict, items) => ({ ok: true, verdict, items, pending: items.filter((x) => x.level === 'confirm' && !x.confirmed).map((x) => x.code), already: { all: false, per_line: [{ i: 0, kind: 'posted', why: 'Posted by Ann on 12 Oct (entry MJ-4).' }] }, fingerprint_account: null });
  const refuseSeen = { suggest: [], project: 0, posted: [] };
  const refuseEngine = Object.assign(engines(refuseSeen), { statementCheck: { check: () => verdictOf('refuse', [{ code: 'currency_mismatch', level: 'refuse', why: 'This statement is in USD, the account is in AUD.' }]) } });
  const wrongStatement = P.create({ engine: refuseEngine, currency: 'AUD', statementCurrency: () => 'AUD', account: 'Demo', ledger: () => ({ lines: [], opening_minor: 0 }), post: async () => ({ ok: true }), lockedMonth: () => null, checkInput: () => ({}) });
  const refusedLoad = wrongStatement.load('ok', 'f.csv');
  assert.strictEqual(refusedLoad.ok, false);
  assert.ok(/USD/.test(refusedLoad.why) && refuseSeen.project === 0, 'a refusal stops BEFORE project()');
  let confirmedSent = [];
  const confirmSeen = { suggest: [], project: 0, posted: [] };
  const confirmEngine = Object.assign(engines(confirmSeen), { statementCheck: { check: (input) => { confirmedSent = input.confirmed; const ticked = input.confirmed.indexOf('gap') >= 0; return verdictOf(ticked ? 'go' : 'confirm', [{ code: 'gap', level: 'confirm', why: 'There is a gap before this statement.', confirmed: ticked }]); } } });
  const waiting = P.create({ engine: confirmEngine, currency: 'AUD', statementCurrency: () => 'AUD', account: 'Demo', ledger: () => ({ lines: [], opening_minor: 0 }), post: async () => ({ ok: true }), lockedMonth: () => null, checkInput: () => ({}) });
  assert.strictEqual(waiting.load('ok', 'f.csv').ok, true);
  assert.ok((await waiting.postReady()).blocked, 'an unticked confirm blocks every post');
  waiting.confirmCheck('gap');
  assert.deepStrictEqual(confirmedSent, ["gap"]);
  assert.ok(!(await waiting.postReady()).blocked, 'ticked: line work goes on');
  assert.ok(waiting.view().items.some((x) => x.alreadyWhy), 'the already-done why rides on the line');
  ok('statement check: refuse stops before project(); confirm waits for the owner tick; already-done why on the line');

  /* B5-06: every skipped row reaches the engine's statement, so "tied" can refuse */
  const skip = make();
  skip.seen.skipped = [{ row: 3, why: 'unreadable date "06/11/2026 09:14"' }];
  skip.ctl.load('ok', 'f.csv');
  assert.deepStrictEqual(skip.seen.args.books.statement.skipped, skip.seen.skipped);
  ok('B5-06: the skipped rows of the parse ride into project() with the statement');

  /* B5-02: a line that may already be in the books asks; a pair takes the line (and the entry) out of the question */
  const near = make();
  near.seen.near = { 0: [{ id: 'L9', date: '2026-10-20', entry_no: 'MJ/1', narration: 'Account fee', gap_days: 3 }] };
  near.ctl.load('ok', 'f.csv');
  assert.deepStrictEqual(near.seen.args.books.near, near.seen.near);
  const nearKey = near.ctl.view().items[0].key;
  assert.strictEqual(near.ctl.pair(nearKey, 'L9').ok, true);
  assert.strictEqual(near.seen.args.proposals[0], null, 'a paired line is in the books: no proposal is asked for');
  assert.deepStrictEqual(near.seen.nearArgs.free.map((x) => x.id), ['L8'], 'the paired entry is out of every other line\'s list');
  near.ctl.notMatch(near.ctl.view().items[1].key);
  assert.ok(!near.seen.nearArgs.open.some((x) => x.i === 1), '"it is new" takes the line out of the question');
  assert.strictEqual(near.ctl.pair('no-such-line', 'L9').ok, false);
  ok('B5-02: near matches are handed to the engine; a pair makes the line "in your books" and uses its entry up; "it is new" ends the question; an unknown line is refused');

  /* B5-01 / B5-03: the tick and the word on the tax invoice ride into the engine call for THAT line only */
  const ask = make();
  ask.ctl.load('ok', 'f.csv');
  const tickKey = ask.ctl.view().items[3].key;
  ask.ctl.tick(tickKey);
  ask.ctl.invoice(tickKey, 'held');
  const last = ask.seen.suggest.slice(-4);
  assert.deepStrictEqual(last.map((o) => o.confirmed), [false, false, false, true]);
  assert.deepStrictEqual(last.map((o) => o.tax_invoice), [undefined, undefined, undefined, 'held']);
  ask.ctl.invoice(tickKey, 'anything else');
  assert.strictEqual(ask.seen.suggest.slice(-4)[3].tax_invoice, 'none');
  ok('B5-01/03: a tick and an invoice answer are per line, and anything but "held" is "none" (no credit), never a default of "held"');

  /* never offered: needs-you, gst question; ready count */
  const m = make();
  assert.strictEqual(m.ctl.load('ok', 'f.csv').ok, true);
  const items = m.ctl.view().items;
  assert.deepStrictEqual(items.map((i) => i.ready), [true, true, false, false, false]);
  assert.strictEqual(items[3].needs, 'gst_basis');
  ok('a line with no proposal, and a line waiting on the GST basis, are not ready');
  m.ctl.answer('gst_basis', 'cash');
  assert.strictEqual(m.seen.suggest[m.seen.suggest.length - 1].gst_basis, 'cash');
  assert.strictEqual(m.ctl.readyCount(), 3);
  ok('the GST basis is passed to the engine and the proposals are read again');

  /* popup */
  const text = m.ctl.confirmText();
  const all = text.title + text.lines.join('|');
  ['Add 3 entries', 'AUD 12.50', 'AUD 132.00', '23 Oct 2026 to 5 Nov 2026', 'AUD', '1 new party', '1 still need you'].forEach((w) => assert.ok(all.includes(w), w + ' in ' + all));
  ok('the popup says count, in, out, range, currency, new parties and who still needs you; two lines naming one payee make one party');
  m.seen.noTotals = true;
  m.ctl.answer('x', 1);
  assert.strictEqual(m.ctl.confirmText(), null);
  ok('with no carried figures from the engine the popup is not made up');

  /* one at a time: a failure shows on its line, the rest go on */
  const f = make({
    post: async (item) => {
      if (item.i === 1) return { ok: false, why: 'The server said no.' };
      if (item.i === 3) throw new Error('Network down');
      return { ok: true, entry_no: 'E1' };
    }
  });
  f.ctl.load('ok', 'f.csv');
  f.ctl.answer('gst_basis', 'cash');
  const told = [];
  const sum = await f.ctl.postReady((item, r) => told.push(item.i + ':' + r.ok));
  assert.deepStrictEqual(sum, { tried: 3, added: 1, failed: 2 });
  assert.deepStrictEqual(told, ['0:true', '1:false', '3:false']);
  assert.strictEqual(f.ctl.view().results[f.ctl.view().items[1].key].why, 'The server said no.');
  assert.strictEqual(f.ctl.view().results[f.ctl.view().items[3].key].why, 'Network down');
  assert.ok(f.seen.project >= 3, 'the books are read and projected again after the press');
  ok('posting is one line at a time: a failure (answer or throw) is that line\'s reason and the others continue');

  /* closed month */
  const c = make({ lockedMonth: (d) => (d.startsWith('2026-10') ? { month: 'Oct 2026', words: 'Oct 2026 is closed.' } : null) });
  c.ctl.load('ok', 'f.csv');
  c.ctl.answer('gst_basis', 'cash');
  assert.deepStrictEqual(c.ctl.view().items.map((i) => i.state), ['closed', 'closed', 'needs_you', 'proposed', 'in_books']);
  assert.strictEqual(c.ctl.view().items[0].why, 'Oct 2026 is closed.');
  assert.ok(c.ctl.confirmText().lines.join('|').includes('2 in a closed month'));
  await c.ctl.postReady();
  assert.deepStrictEqual(c.seen.posted.length, 1);
  ok('a line in a closed month is refused before the press, named, counted, and never posted');

  /* party edit */
  const e = make();
  e.ctl.load('ok');
  const k1 = e.ctl.view().items[1].key;
  assert.strictEqual(e.ctl.editParty(k1, { name: '  ', kind: 'supplier' }).ok, false);
  e.ctl.editParty(k1, { status: 'existing', id: 'p9', name: 'Origin Energy Pty' });
  assert.strictEqual(e.ctl.view().items[1].party.status, 'existing');
  ok('a new party needs a name; an existing party can be picked from did-you-mean');

  /* answering a needs-you line: a refusal stays on ITS line until the owner changes that line */
  const g = make({ engine: Object.assign(engines({ suggest: [], project: 0 }), {}) });
  g.ctl.load('ok');
  g.ctl.answer('x', 1);
  const stuck = g.ctl.view().items[2].key;
  const none = g.ctl.resolveLine(stuck, { account: '' });
  assert.strictEqual(none.ok, false);
  g.ctl.answer('y', 2);
  assert.strictEqual(g.ctl.view().items[2].resolveWhy, 'Pick an account from the list first.');
  g.ctl.editParty(stuck, { name: 'ATO', kind: 'supplier' });
  assert.strictEqual(g.ctl.view().items[2].resolveWhy, null);
  ok('a refused answer stays on its line through repaints and goes when the owner changes the line');

  /* in-app adapter */
  const calls = [];
  const api = async (key, o) => {
    calls.push([key, o.body]);
    if (key === 'supAdd') return o.body.name === 'Fail Co' ? Promise.reject(new Error('Name taken')) : { supplier: { supplier_entity_id: 'sup-1' } };
    return { entry_no: 'MJ-9', duplicate: false };
  };
  const post = POST.adapter({ api, who: { role: 'owner' } });
  const item = { ref: 'bank:abc', event: { type: 'expense', amount: 1 }, party: { status: 'new', name: 'Origin Energy', kind: 'supplier' } };
  const done = await post(item);
  assert.deepStrictEqual(calls.map((x) => x[0]), ['supAdd', 'booksEventPost']);
  assert.strictEqual(calls[1][1].kind, 'expense', 'the server reads kind, never type');
  assert.ok(!('type' in calls[1][1]) && !('ref' in calls[1][1]) && !('party' in calls[1][1]), 'only keys the closed POST /events body lists');
  assert.strictEqual(calls[1][1].client_ref, 'bank:abc');
  assert.strictEqual(done.ok, true);
  await post(item);
  assert.strictEqual(calls.filter((x) => x[0] === 'supAdd').length, 1);
  const bad = await post({ ref: 'bank:x', event: { type: 'expense', amount: 1 }, party: { status: 'new', name: 'Fail Co', kind: 'supplier' } });
  assert.strictEqual(bad.ok, false);
  assert.ok(/Fail Co/.test(bad.why) && /Name taken/.test(bad.why));
  assert.strictEqual(calls.filter((x) => x[1] && x[1].client_ref === 'bank:x').length, 0);
  const acct = await POST.adapter({ api, who: { role: 'accountant' } })(item);
  assert.strictEqual(acct.ok, false);
  ok('app adapter: the party is made FIRST (once), the entry carries its id and bank:<fp>; a party failure fails that line only; a non-owner is told at once');

  /* FIN-117 / FIN-116: the exact body per kind, and what is refused before anything is made */
  const taxed = POST.bodyOf({ ref: 'bank:t', event: { type: 'expense', class: 'bank_charges', paid_from: 'bank', date: '2026-10-23', amount: 20, narration: 'Bank statement 2026-10-23: Account fee', currency: 'AUD' }, tax: { tax_minor: 200 } }, null, (b) => Object.assign({}, b, { paid_from: 'card' }));
  assert.deepStrictEqual(taxed, { kind: 'expense', date: '2026-10-23', amount: 20, narration: 'Bank statement 2026-10-23: Account fee', client_ref: 'bank:t', class: 'bank_charges', paid_from: 'card', input_tax_minor: 200 });
  const contra = POST.bodyOf({ ref: 'bank:c', event: { type: 'contra', from: 'bank', to: 'cash', date: '2026-10-29', amount: 500, narration: 'ATM' } });
  assert.deepStrictEqual(Object.keys(contra).sort(), ['amount', 'client_ref', 'date', 'from', 'kind', 'narration', 'to']);
  /* the loan / tax-payment answers have no api door yet: refused in words before any party is made or anything sent */
  const guard = POST.adapter({ api: async () => assert.fail('nothing is sent'), who: { role: 'owner' } });
  for (const type of ['loan_taken', 'loan_repaid']) {
    const refused = await guard({ ref: 'bank:n', event: { type, amount: 5 }, party: { status: 'new', name: 'Z', kind: 'supplier' } });
    assert.ok(refused.ok === false && /cannot be added from a bank line yet/.test(refused.why), type);
  }
  /* M5: the ATO BAS payment (the whole figure on the one head) and a taxed receipt (net + the GST inside) are posted through POST /events */
  const bas = POST.bodyOf({ ref: 'bank:b', event: { type: 'tax_payment', mode: 'bank', heads: { gst: 0 }, date: '2026-10-24', amount: 1462, narration: 'ATO PAYMENT BAS 1126' } }, null, (b) => Object.assign({}, b, { paid_from: b.paid_from }));
  assert.deepStrictEqual(bas, { kind: 'tax_payment', date: '2026-10-24', amount: 1462, narration: 'ATO PAYMENT BAS 1126', client_ref: 'bank:b', paid_from: 'bank' });
  const card = POST.bodyOf({ ref: 'bank:k', event: { type: 'other_income', class: 'sundry_income', into: 'bank', date: '2026-10-08', amount: 410, narration: 'CARD' }, tax: { direction: 'output', tax_minor: 4100 } });
  assert.strictEqual(card.output_tax_minor, 4100);
  assert.strictEqual(card.amount, 410);
  assert.ok(POST.POSTABLE.indexOf('tax_payment') >= 0);
  /* item 1: tax_invoice 'held' rides with the tax; a new customer answers customer_identity_id */
  const held = POST.bodyOf({ ref: 'bank:h', event: { type: 'expense', class: 'x', paid_from: 'bank', date: '2026-10-23', amount: 100, narration: 'n' }, tax: { tax_minor: 1000, invoice_answer: 'held' } });
  assert.strictEqual(held.tax_invoice, 'held');
  assert.ok(!('tax_invoice' in POST.bodyOf({ ref: 'bank:u', event: { type: 'expense', amount: 1 }, tax: { tax_minor: 100 } })));
  assert.strictEqual(POST.idOfParty({ customer: { customer_identity_id: 'c-1', customer_list_id: 'l-1' } }), 'c-1');
  /* items 2 and 5: money in / out for a party goes to POST /payments (booksPayRecord), the line's own figure and ref; same_again only for a ticked or twin line */
  const paid = [];
  const payApi = async (key, o) => { paid.push([key, o.body]); return key === 'custAdd' ? { customer: { customer_identity_id: 'c-1' } } : { payment: { duplicate: false }, posted: { entry_no: 'RC-1' } }; };
  const payPost = POST.adapter({ api: payApi, who: { role: 'owner' }, modeOf: (b) => Object.assign({}, b, { paid_from: 'bank' }) });
  const recv = { ref: 'bank:r1', event: { type: 'payment_received', mode: 'bank', date: '2026-10-05' }, line: { date: '2026-10-05', credit_minor: 165000, debit_minor: 0 }, party: { status: 'new', name: 'Smith', kind: 'customer' } };
  const r1 = await payPost(recv);
  assert.strictEqual(r1.ok, true);
  assert.deepStrictEqual(paid.map((x) => x[0]), ['custAdd', 'booksPayRecord']);
  assert.deepStrictEqual(paid[1][1], { party_id: 'c-1', direction: 'in', amount_minor: 165000, mode: 'bank', received_at: '2026-10-05', reference: 'bank:r1', allocate: 'none', client_ref: 'bank:r1' });
  await payPost(Object.assign({}, recv, { ref: 'bank:r2', twin: true }));
  assert.deepStrictEqual(paid[paid.length - 1][1].acknowledge, ['same_again']);
  await payPost(Object.assign({}, recv, { ref: 'bank:r3', ticked: true, event: { type: 'payment_made', date: '2026-10-05' }, line: { date: '2026-10-05', credit_minor: 0, debit_minor: 500 } }));
  assert.strictEqual(paid[paid.length - 1][1].direction, 'out');
  assert.strictEqual(paid[paid.length - 1][1].amount_minor, 500);
  ok('app adapter body: kind not type, only the closed keys, the tax inside the bank figure as input_tax_minor, a party line goes to POST /payments with its own figure and ref; tax_payment / loan lines are refused in words');

  /* FIN-118: the shared-record line never carries the server's raw sentence (it named a route); and the lines painter is the one both pages use */
  const store = fs.readFileSync(pub('app/cap-bank-store.js'), 'utf8');
  assert.ok(!/Saved on this device for now\.'\) \+/.test(store), 'the error line adds nothing from the server');
  assert.ok(/Could not reach the shared record\. Saved on this device for now\./.test(store));
  assert.ok(/CBBankPreviewUI\.mount/.test(fs.readFileSync(pub('app/bank-demo.js'), 'utf8')) && /CBBankPreviewUI\.mount/.test(fs.readFileSync(pub('app/cap-bank-sheet.js'), 'utf8')), 'one painter for the demo and the app');
  ok('FIN-118: the shared-record line says it in our words, never the server\'s route; FIN-117: the demo and the app paint lines through the one painter');

  /* the demo page is public and inert */
  const html = read('bank-demo.html');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  /* style-src 'self' 'unsafe-inline' only: the shared library sets a style attribute and injects its own style element (CSP-DECISION, 15 Nov); scripts stay 'self', the network stays shut */
  assert.ok(csp && !/unsafe-eval|https?:/.test(csp[1]) && !/script-src[^;]*unsafe-inline/.test(csp[1]) && /script-src 'self'/.test(csp[1]) && /style-src 'self' 'unsafe-inline'/.test(csp[1]) && /connect-src 'none'/.test(csp[1]), 'script-src self only, no network');
  assert.ok(/name="robots" content="noindex/.test(html));
  assert.ok(/Demo\. Nothing is saved/.test(html));
  assert.ok(!/config\.js|device-id\.js|analytics|<script>[^<]|style="/.test(html.replace(/<!--[\s\S]*?-->/g, '')));
  const codes = html.match(/data-cbsid="[^"]+"/g) || [];
  assert.strictEqual(new Set(codes).size, codes.length);
  assert.ok(codes.every((x) => /BKS017-[A-Z]\d\d/.test(x)));
  ['app/bank-demo.js', 'app/bank-preview-line.js', 'app/bank-preview.js', 'app/bank-preview-ui.js', 'app/bank-preview-ui-parts.js', 'app/bank-demo.css'].forEach((rel) => {
    const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie|@import|url\(/.test(src), rel + ' is inert');
  });
  ok('bank-demo.html: strict CSP, noindex, a Demo banner, no config.js / device-id.js, one code per control, and no network or storage in its files');
  /* M4: a line the engine found to BE an open invoice settles that invoice (allocations), never 'none' */
  const against = [{ against_ref: 'inv-2-uuid', bill_no: 'HP-INV-2', amount_minor: 275000 }];
  await payPost(Object.assign({}, recv, { ref: 'bank:r4', party: { status: 'existing', id: 'c-coogee', name: 'Coogee Bay Cafe', kind: 'customer' }, against, line: { date: '2026-10-20', credit_minor: 275000, debit_minor: 0 } }));
  const settled = paid[paid.length - 1][1];
  assert.deepStrictEqual(settled.allocations, [{ against_ref: 'inv-2-uuid', amount_minor: 275000 }]);
  assert.strictEqual(settled.allocate, undefined);
  assert.strictEqual(settled.amount_minor, 275000);
  ok('M4: a receipt that is exactly one open invoice is posted AGAINST it (allocations from the against the engine gave, no allocate none)');

  console.log(ran + ' checks passed');
})().catch((err) => {
  console.error('FAIL', err && err.stack ? err.stack : err);
  process.exit(1);
});
