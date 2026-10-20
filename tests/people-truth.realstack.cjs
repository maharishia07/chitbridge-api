'use strict';
/**
 * tests/people-truth.realstack.cjs — PEOPLE TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §13 "People").
 *
 * PPL-1. Principles: no sign-in code leaves the server · a person who is off gets no code · cost and pay are seen only by those allowed ·
 * pay = days x rate, and paying staff leaves a books voucher and a bank row that name the person.
 * PP-02 no read or write answer carries a sign-in code (real stack; the offline file is people-writes-sec2.test.cjs) ·
 * PP-03 a person who is switched off cannot be given a code: refused, and the list greys the action ·
 * PP-08 attendance for a month, run payroll: pay = days x rate and a salary voucher posts (H2P is not built: no route exists) ·
 * PP-09a paying a salary today (the Pay expense event, class salary) posts a balanced voucher and a bank credit ·
 * PP-09b the pay voucher names the employee it paid (today it names nobody, PEOPLE-BACKLOG PPL-5 was set aside).
 * Not here: PP-10 the Employees screen at 390 px dark (a screen: e2e/walk-employees.cjs) · PP-01/04..07 stay on their offline files.
 * A `gap:` FAIL is a RECORDED finding (PEOPLE-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. LOCAL ONLY; the database is only read.
 * Break-tested 2026-10-19: each passing case was run once with its expectation flipped and went red.
 * Run: node tests/people-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 17-people-employees-hr-and-payroll/README
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'pplx' + (Date.now() % 1e8).toString(36);   /* a User ID is 8 to 20 characters */
const key = (tag) => ('k' + tag + RUN.slice(-6)).slice(0, 12);
const addActor = async (shop, name, tag) => ok(await j('/api/actors', { method: 'POST', token: shop.token, body: { display_name: name, actor_key: key(tag), email: key(tag) + '@local.test', access_level: 'editor' } }), 'add ' + name).b;
/** a sign-in code or PIN VALUE in an answer: a key that names one, or six digits under a key that says code/otp/pin */
const codeLeak = (body) => { const s = JSON.stringify(body); return /"(otp|otp_code|pin|pin_hash|code_value|one_time_code)"\s*:\s*"?\d/.test(s) || /"(code|otp|pin)"\s*:\s*"\d{4,8}"/.test(s); };

(async () => {
  console.log('\n── people truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const A = await freshShop(RUN, 'People truth');
  ok(await j('/api/books/enable', { method: 'POST', token: A.token }), 'books on');   /* the books are what a pay voucher lands in: a precondition, through its own route */
  const added = await addActor(A, 'Asha Wage', 'a');
  const asha = added.actor;

  await kase('PP-02', 'no answer about a person carries a sign-in code: add, the people list, a code reset', async () => {
    const list = ok(await j('/api/people', { token: A.token }), 'people').b, reset = ok(await j('/api/actors/' + asha.identity_id + '/pin', { method: 'DELETE', token: A.token }), 'reset').b;
    const leaks = [['add', added], ['list', list], ['reset', reset]].filter(([, b]) => codeLeak(b)).map(([k]) => k);
    expect(leaks.length === 0, 'a code value is in: ' + leaks.join(', '));
  });

  await kase('PP-03', 'a person who is switched off cannot be given a code: refused, and the list greys the action with a sentence', async () => {
    const off = await addActor(A, 'Off Person', 'b'), id = off.actor.identity_id;
    ok(await j('/api/actors/' + id + '/status', { method: 'PUT', token: A.token, body: { action: 'deactivate' } }), 'switch off');
    const reset = await j('/api/actors/' + id + '/pin', { method: 'DELETE', token: A.token });
    const row = (ok(await j('/api/people', { token: A.token }), 'people').b.people || []).find((p) => p.id === id);
    expect(row && row.state !== 'on', 'premise: the person should be off in the list, saw state ' + (row && row.state));
    expect(reset.status >= 400 && reset.status < 500, 'a code for a person who is off answered ' + reset.status + ' ' + JSON.stringify(reset.b).slice(0, 200));
    expect(row && row.may.reset_pin.ok === false && /\w+/.test(row.may.reset_pin.why || ''), 'the list says reset_pin ' + JSON.stringify(row && row.may.reset_pin));
  }, 'DELETE /api/actors/:id/pin (routes/actors.js:637) never reads break_status: a person who is off gets a fresh one-time code (200); people.test.cjs only proves the list greys it');

  await kase('PP-08', 'attendance for a month, run payroll: pay = days x rate and a salary voucher posts', async () => {
    const tried = [];
    for (const [m, p] of [['POST', '/api/payroll/run'], ['POST', '/api/payroll'], ['POST', '/api/attendance'], ['POST', '/api/hr/payroll/run'], ['POST', '/api/people/payroll']]) {
      const r = await j(p, { method: m, token: A.token, body: { month: '2026-10', actor_id: asha.identity_id } });
      tried.push(m + ' ' + p + ' ' + r.status);
      if (r.status !== 404) return tried.join(' · ');   /* a route exists: the next step is to drive it to a number */
    }
    expect(false, 'no attendance or payroll door exists — ' + tried.join(' · '));
  }, 'H2P: payroll and attendance are NO-CODE (docs card payroll-wage-advances-payslip-pay); no route to hold days, a rate or a payslip');

  /* paying a salary today is the Pay expense event with class "salary" (lib/books-manual.js): the only door there is */
  const pay = ok(await j('/api/books/events', { method: 'POST', token: A.token, body: { kind: 'expense', class: 'salary', amount: 5000, paid_from: 'bank', narration: 'Salary Asha Wage' } }), 'pay salary').b;
  const day = ok(await j('/api/books/daybook', { token: A.token }), 'daybook').b, entry = (day.entries || []).find((e) => e.entry_id === pay.entry_id);

  await kase('PP-09a', 'paying a salary posts ONE balanced voucher: Dr Salaries 5,000.00, Cr Bank 5,000.00', async () => {
    const dr = entry && entry.lines.filter((l) => l.dr_minor).map((l) => l.name + ' ' + l.dr_minor), cr = entry && entry.lines.filter((l) => l.cr_minor).map((l) => l.name + ' ' + l.cr_minor);
    expect(entry && entry.lines.length === 2 && dr[0] === 'Salaries 500000' && cr[0] === 'Bank 500000', 'voucher lines ' + JSON.stringify(entry && entry.lines.map((l) => [l.name, l.dr_minor, l.cr_minor])));
  });

  await kase('PP-09b', 'the pay voucher names the employee it paid (a party or person on the line, or in the entry)', async () => {
    const named = entry && (entry.lines.some((l) => l.party_id) || entry.person_id || entry.actor_id || entry.employee_id);
    expect(named, 'the salary voucher ' + (entry && entry.entry_no) + ' has no person on any line (party_id null) — a pay entry cannot be read per employee');
  }, 'PPL-5 (set aside): a salary entry posts to the expense with no person; no payslip, no per-employee pay history');

  finish('people-truth', process.env.PEOPLE_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('people truth could not run:', e && e.message); process.exit(2); });
