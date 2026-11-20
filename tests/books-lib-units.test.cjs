#!/usr/bin/env node
// @type: unit
/**
 * tests/books-lib-units.test.cjs — READ-GUARD §7 unit evidence for the small books / sign-in / people modules of the 20 Nov batch that had none: one unit per rule, the refusal path and the fail-closed case, offline.
 * OWNS      books-input (strict input: text amounts, long narration and ref refused, never cut) · books-reversal-date (a reversal ahead of the shop's day is refused) · books-debit-check (a note against no booked bill is refused) ·
 *           books-event-guard (the same ref with another journal is refused, the same journal replays) · books-balance-rows · books-store-locks · books-year-reopen (no reason, not closed: refused) ·
 *           practice-switch-audit (only a moved switch leaves a row) · signin-ask-cap (one budget per account, no account typed = not capped) · no-store-signed-in (signed-in answers are never cached)
 * CALLED BY scripts/guards.cjs
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * Run: node tests/books-lib-units.test.cjs   (no database, no network)
 */
'use strict';
const assert = require('assert');
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = ''; process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String(e && e.message).slice(0, 300)); } };
const refusedWith = (fn, status) => { try { fn(); } catch (e) { return !status || e.status === status; } return false; };

(async () => {
  const input = require('../lib/books-input');
  await t('books-input: a narration over the limit is refused (422), never cut; under it passes trimmed', () => {
    assert.ok(refusedWith(() => input.narration('x'.repeat(input.NARRATION_MAX + 1)), 422));
    assert.strictEqual(input.narration('  rent  '), 'rent');
  });
  await t('books-input: a client_ref over 80 is refused, an empty one is none', () => {
    assert.ok(refusedWith(() => input.clientRef('r'.repeat(input.REF_MAX + 1)), 422));
    assert.strictEqual(input.clientRef(''), null);
  });
  await t('books-input: an amount sent as text is refused (minor and major), a number passes', () => {
    assert.ok(refusedWith(() => input.minorOnly('100', 'dr_minor'), 422));
    assert.ok(refusedWith(() => input.majorOnly('10.5', 'dr', 'INR'), 422));
    assert.strictEqual(input.minorOnly(100, 'dr_minor'), 100);
    assert.strictEqual(input.majorOnly(10.5, 'dr', 'INR'), 10.5);
  });
  await t('books-input: a rate sent as text is refused; a journal line that is null or not an object is refused naming the line', () => {
    assert.ok(refusedWith(() => input.typedRate({ rate: '83.1' }, {}), 422));
    assert.ok(refusedWith(() => input.lineShape([{ account: 'a' }, null]), 422));
    assert.doesNotThrow(() => input.lineShape([{ account: 'a', dr: 1 }]));
  });
  await t('books-input: a date SENT as null or empty is a slip (refused by the date reader); a date left out is not', () => {
    assert.strictEqual(input.sentEmpty({ date: null }, 'date'), true);
    assert.strictEqual(input.sentEmpty({ date: '' }, 'date'), true);
    assert.strictEqual(input.sentEmpty({}, 'date'), false);
    assert.strictEqual(input.sentEmpty({ date: '2026-11-20' }, 'date'), false);
  });

  const rows = require('../lib/books-balance-rows');
  await t('books-balance-rows: a line lands on its account, and again on account+party when it names a party', () => {
    const out = rows.balanceRows([{ account_id: 'a1', party_id: 'p1', currency: 'INR', dr_minor: 500, cr_minor: 0 }, { account_id: 'a1', party_id: null, currency: 'INR', dr_minor: 0, cr_minor: 200 }], '2026-27', 7);
    assert.strictEqual(out.length, 2);
    const own = out.find((row) => row.party_key === require('../lib/books-store').ZERO);
    assert.deepStrictEqual([own.dr_minor, own.cr_minor, own.line_count], [500, 200, 2]);
    assert.deepStrictEqual(rows.balanceRows([], '2026-27', 7), []);
  });

  const locks = require('../lib/books-store-locks');
  await t('books-store-locks: the fx lock is shared for a read and exclusive for a write; a source_ref lock is taken on its own key', async () => {
    const seen = [];
    const db = { query: async (sql, args) => { seen.push([sql, args]); return { rows: [] }; } };
    await locks.fxLock(db, 'E1', true); await locks.fxLock(db, 'E1', false);
    assert.ok(/advisory_xact_lock_shared/.test(seen[0][0]) && !/shared/.test(seen[1][0]));
    await locks.lockSourceRef(db, 'E1', 'ev:x:1');
    assert.ok(JSON.stringify(seen[2]).includes('src|ev:x:1'));
  });
  await t('books-store-locks: hasTrading is false on opening-only books (fail closed: nothing read = not trading) and true once a month holds a journal', async () => {
    assert.strictEqual(await locks.hasTrading({ query: async () => ({ rows: [] }) }, 'E1'), false);
    assert.strictEqual(await locks.hasTrading({ query: async () => ({ rows: [{}] }) }, 'E1'), true);
  });

  const reversal = require('../lib/books-reversal-date');
  await t('books-reversal-date: a reversal in an open month passes untouched; one pushed far ahead of the shop day is refused (REVERSAL_MONTH_LOCKED)', () => {
    const when = { moved: false, date: '2026-11-20' };
    assert.strictEqual(reversal.notAhead({}, { entry_no: 'MJ/1' }, { owner: true }, when), when);
    let err = null;
    try { reversal.notAhead({}, { entry_no: 'MJ/1' }, { owner: true }, { moved: true, date: '2999-01-01' }); } catch (e) { err = e; }
    assert.ok(err && err.code === 'REVERSAL_MONTH_LOCKED' && err.status === 422 && err.refused === true);
  });

  const debit = require('../lib/books-debit-check');
  const receivables = { outstanding: (items) => ({ by_ref: { B1: { outstanding_minor: -700 } } }) };
  await t('books-debit-check: no booked bill of that supplier is no open figure (null, the caller refuses); a booked bill gives what it still owes', () => {
    assert.strictEqual(debit.openOf([], 'B1', receivables), null);
    assert.strictEqual(debit.openOf([{ ref: 'B1', amount_minor: 1000 }], 'B1', receivables), 700);
    assert.strictEqual(debit.openOf([{ ref: 'B2', amount_minor: 1000 }], 'B1', receivables), null);
  });

  const guard = require('../lib/books-event-guard');
  const lines = [{ account_id: 'a', dr_minor: 100, cr_minor: 0, party_id: null }, { account_id: 'b', dr_minor: 0, cr_minor: 100 }];
  await t('books-event-guard: the same ref with the same journal replays; another journal under the ref is refused (EVENT_REF_REUSED, the door answers 409)', () => {
    const composed = { lines, docDate: '2026-11-20' };
    const same = { entry_no: 'MJ/9', doc_date: '2026-11-20', lines: lines.slice().reverse() };
    assert.doesNotThrow(() => guard.refuseOther({ source_ref: 'ev:x:r1' }, composed, same));
    let err = null;
    try { guard.refuseOther({ source_ref: 'ev:x:r1' }, composed, { entry_no: 'MJ/9', doc_date: '2026-11-21', lines }); } catch (e) { err = e; }
    assert.ok(err && err.refused === true && err.code === 'EVENT_REF_REUSED' && err.entry_no === 'MJ/9');
    assert.strictEqual(guard.signature(lines, 'd'), guard.signature(lines.slice().reverse(), 'd'));
  });
  await t('books-event-guard: no ref, nothing stored under it, or no composed journal: nothing to refuse', () => {
    assert.doesNotThrow(() => guard.refuseOther({}, { lines, docDate: 'd' }, { entry_no: 'MJ/1', lines }));
    assert.doesNotThrow(() => guard.refuseOther({ source_ref: 'r' }, { lines, docDate: 'd' }, null));
  });

  const reopen = require('../lib/books-year-reopen');
  const refuse = (words, code) => Object.assign(new Error(words), { code, refused: true });
  await t('books-year-reopen: no reason is refused; a year that is not closed is refused, nothing is written', async () => {
    const wrote = [];
    const S = { periods: async () => [{ fiscal_year: '2026-27', period: 1, status: 'open' }], setPeriodStatus: async () => wrote.push(1), logChange: async () => wrote.push(2) };
    await assert.rejects(() => reopen.reopenYear({}, 'E1', '2026-27', 'u', '', S, refuse));
    await assert.rejects(() => reopen.reopenYear({}, 'E1', '2026-27', 'u', 'a late bill', S, refuse), /not closed/);
    assert.deepStrictEqual(wrote, []);
  });

  const audit = require('../lib/practice-switch-audit');
  await t('practice-switch-audit: only a switch that moved leaves an audit row; an unsaved practice is read from the column defaults', async () => {
    const calls = [];
    const withEntity = async (entity, fn) => fn({ query: async (sql, args) => { calls.push(args); return { rows: [] }; } });
    const before = calls.length;
    await audit.record(withEntity, 'E1', { was: { client_access: 'all' }, now: { rows: [{ client_access: 'all', staff_pick_up: 'on', all_task_visible: false, assignment_model: 'both' }] } }, 'U1');
    assert.strictEqual(calls.length, before, 'nothing moved: no row (and an absent before-row reads as the defaults)');
    assert.strictEqual(audit.SWITCH_DEFAULTS.staff_pick_up, 'on');
    await audit.record(withEntity, 'E1', { was: {}, now: { rows: [{ client_access: 'assigned', staff_pick_up: 'on', all_task_visible: false, assignment_model: 'both' }] } }, 'U1');
    assert.ok(calls.length > before, 'client_access moved from its default: one row');
  });

  const cap = require('../lib/signin-ask-cap');
  await t('signin-ask-cap: 5 per 15 minutes per typed account by default, keyed by the lower-cased account; no account typed is not capped (the door refuses it)', () => {
    let options = null;
    cap.accountCap({ rateLimit: (opts) => { options = opts; return opts; }, intFromEnv: (name, fallback) => fallback, typedByAsk: (req) => String(req.body.email || '') });
    assert.strictEqual(options.max, 5);
    assert.strictEqual(options.windowMs, 15 * 60 * 1000);
    assert.strictEqual(options.keyGenerator({ body: { email: 'Asha@Example.COM' } }), 'acct:asha@example.com');
    assert.strictEqual(options.skip({ body: {} }), true);
    assert.strictEqual(options.skip({ body: { email: 'a@b.c' } }), false);
    assert.strictEqual(options.message.error, 'Too many codes');
  });

  const noStore = require('../middleware/no-store-signed-in');
  await t('no-store-signed-in: a call with a login or an api key is never cached; an anonymous one is left alone; next always runs', () => {
    const run = (headers) => { const set = []; let nexted = false; noStore({ headers }, { setHeader: (k, v) => set.push([k, v]) }, () => { nexted = true; }); return { set, nexted }; };
    assert.deepStrictEqual(run({ authorization: 'Bearer x' }).set, [['Cache-Control', 'no-store']]);
    assert.deepStrictEqual(run({ 'x-api-key': 'k' }).set, [['Cache-Control', 'no-store']]);
    const anon = run({});
    assert.deepStrictEqual(anon.set, []);
    assert.strictEqual(anon.nexted, true);
  });

  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
