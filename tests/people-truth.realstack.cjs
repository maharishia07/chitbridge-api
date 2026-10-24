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
 * PP-01 a colleague (not the owner) adding a person is refused 403 OWNER_ONLY, may:false + why, and the Add form greys with the same sentence ·
 * PP-03b a code for a person who is off through POST /:id/otp (gap) · PP-03c a person who is off cannot sign in, code or not ·
 * PP-04 a view-only employee changing the books is refused by the hat gate: 403 + the level + words ·
 * PP-05 an employee reads a product with no cost; cannot grant themselves the cost; sees it once the owner grants it ·
 * PP-06 a sign-in id (key at the shop) is unique per shop and free in another shop ·
 * PP-07 a new employee signs in with the first code, sets their own PIN, and the first code stops working.
 * Employee sign-in uses the local stack's first-code door the harness already relies on (H.ENTITY_OTP, as freshShop does: lib/dev-otp.js);
 * the offline proof of that path is tests/employee-first-signin.test.cjs. A sign-in that fails turns only its own case red.
 * Not here: PP-10 the Employees screen at 390 px dark (a screen: e2e/walk-employees.cjs).
 * Not re-run here (pure unit, no route): the sealed-environment refusal of employee-code.js (tests/employee-code.test.cjs) and the
 * hat-gate path list (tests/hat-gate.test.cjs).
 * A `gap:` FAIL is a RECORDED finding (PEOPLE-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. LOCAL ONLY; the database is only read.
 * Break-tested 2026-10-19: each passing case was run once with its expectation flipped and went red.
 * Run: node tests/people-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 17-people-employees-hr-and-payroll/README
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'pplx' + (Date.now() % 1e8).toString(36);   /* a User ID is 8 to 20 characters */
const key = (tag) => ('k' + tag + RUN.slice(-6)).slice(0, 12);
const addActor = async (shop, name, tag, level) => ok(await j('/api/actors', { method: 'POST', token: shop.token, body: { display_name: name, actor_key: key(tag), email: key(tag) + '@local.test', access_level: level || 'editor' } }), 'add ' + name).b;
/** the employee's first-code sign-in (routes/signin.js actorLogin): the answer as it came, so a case can read the refusal too */
const loginWith = (person, secret) => j('/api/actors/login', { method: 'POST', body: Object.assign({ username: person.actor.login_format }, secret) });
/** the token of an employee who signs in with the first code; a refusal throws with what the door said (this case turns red, no other) */
const signInAs = async (person) => ok(await loginWith(person, { otp: H.ENTITY_OTP }), 'first sign-in of ' + person.actor.login_format).b.token;
const PIN = String(1000 + (Date.now() % 9000));   /* an employee's own 4-digit PIN, made per run */
const SAYS_OWNER = (b) => b.code === 'OWNER_ONLY' && b.may === false && /\w+/.test(b.why || '');
const KEY_NOT_ADDED = 'x';   /* the key of the person a colleague tries to add (PP-01): it must never exist */
/** a sign-in code or PIN VALUE in an answer: a key that names one, or six digits under a key that says code/otp/pin */
const codeLeak = (body) => { const s = JSON.stringify(body); return /"(otp|otp_code|pin|pin_hash|code_value|one_time_code)"\s*:\s*"?\d/.test(s) || /"(code|otp|pin)"\s*:\s*"\d{4,8}"/.test(s); };

(async () => {
  console.log('\n── people truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const A = await freshShop(RUN, 'People truth');
  ok(await j('/api/books/enable', { method: 'POST', token: A.token }), 'books on');   /* the books are what a pay voucher lands in: a precondition, through its own route */
  const added = await addActor(A, 'Asha Wage', 'a');
  const asha = added.actor;

  await kase('PP-01', 'a colleague adds a person: refused 403 OWNER_ONLY (may:false + why) and the Add form greys with the same sentence', async () => {
    const emp = await addActor(A, 'Eli Colleague', 'c'), tok = await signInAs(emp);
    const tried = await j('/api/actors', { method: 'POST', token: tok, body: { display_name: 'Not Allowed', actor_key: key(KEY_NOT_ADDED), access_level: 'editor' } });
    const form = ok(await j('/api/people?for=add', { token: tok }), 'the Add form read').b;
    const ownerForm = ok(await j('/api/people?for=add', { token: A.token }), 'the Add form read (owner)').b;
    expect(ownerForm.may && ownerForm.may.add && ownerForm.may.add.ok === true, 'premise: the owner may add, saw ' + JSON.stringify(ownerForm.may));
    expect(tried.status === 403 && SAYS_OWNER(tried.b), 'a colleague adding answered ' + tried.status + ' ' + JSON.stringify(tried.b).slice(0, 200));
    expect(form.may.add.ok === false && /\w+/.test(form.may.add.why || ''), 'the Add form says ' + JSON.stringify(form.may.add));
    const keys = (ok(await j('/api/people', { token: A.token }), 'people').b.people || []).map((p) => p.actor_key);
    expect(!keys.includes(key(KEY_NOT_ADDED)), 'the refused person was added anyway');
  });

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

  await kase('PP-03b', 'a code for a person who is switched off through POST /:id/otp is refused', async () => {
    const off = await addActor(A, 'Off Again', 'd'), id = off.actor.identity_id;
    ok(await j('/api/actors/' + id + '/status', { method: 'PUT', token: A.token, body: { action: 'deactivate' } }), 'switch off');
    const given = await j('/api/actors/' + id + '/otp', { method: 'POST', token: A.token });
    expect(given.status >= 400 && given.status < 500, 'a code for a person who is off answered ' + given.status + ' ' + JSON.stringify(given.b).slice(0, 200));
  }, 'POST /api/actors/:id/otp (routes/actors.js:853) never reads break_status: a person who is off gets a fresh code (200); same gap as PP-03, PEOPLE-BACKLOG PPL-18');

  await kase('PP-03c', 'a person who is switched off cannot sign in, even with a code in hand', async () => {
    const off = await addActor(A, 'Off Signer', 'e'), id = off.actor.identity_id;
    ok(await j('/api/actors/' + id + '/status', { method: 'PUT', token: A.token, body: { action: 'deactivate' } }), 'switch off');
    const tried = await loginWith(off, { otp: H.ENTITY_OTP });
    expect(tried.status === 400 && tried.b.code === 'SIGNIN_REFUSED' && !tried.b.token, 'a person who is off signing in answered ' + tried.status + ' ' + JSON.stringify(tried.b).slice(0, 200));
  });

  await kase('PP-04', 'a view-only employee changes the books: refused by the hat gate, 403 with the level and the words', async () => {
    const viewer = await addActor(A, 'Vic Viewer', 'f', 'viewer'), tok = await signInAs(viewer);
    const tried = await j('/api/books/events', { method: 'POST', token: tok, body: { kind: 'expense', class: 'salary', amount: 1, paid_from: 'bank', narration: 'hat gate probe' } });
    const read = await j('/api/people', { token: tok });
    expect(tried.status === 403 && tried.b.access_level === 'viewer' && /\w+/.test(tried.b.message || ''), 'a view-only write answered ' + tried.status + ' ' + JSON.stringify(tried.b).slice(0, 200));
    expect(read.status === 200, 'the same person reading the people list answered ' + read.status + ' (a hat gates writes, never reads)');
  });

  await kase('PP-05', 'an employee reads a product with no cost; cannot grant the cost to themselves; sees it once the owner grants it', async () => {
    const made = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Costed Rice', unit: 'piece', price: 60, cost: 40 } } }), 'product').b;
    const id = made.item.item_id, cost = (reply) => ((reply.b.items || []).find((x) => x.item_id === id) || { item_data: {} }).item_data.cost;
    const emp = await addActor(A, 'Cora Clerk', 'g'), tok = await signInAs(emp);
    expect(cost(ok(await j('/api/products', { token: A.token }), 'owner list')) === 40, 'premise: the owner should see the cost 40');
    const seen = ok(await j('/api/products', { token: tok }), 'employee list');
    expect((seen.b.items || []).some((x) => x.item_id === id) && cost(seen) === undefined, 'the employee saw cost ' + cost(seen) + ' (or the product is missing)');
    const grab = await j('/api/actors/' + emp.actor.identity_id, { method: 'PATCH', token: tok, body: { can_see_costs: true } });
    expect(grab.status === 403 && grab.b.code === 'OWNER_ONLY', 'an employee granting themselves the cost answered ' + grab.status + ' ' + JSON.stringify(grab.b).slice(0, 160));
    ok(await j('/api/actors/' + emp.actor.identity_id, { method: 'PATCH', token: A.token, body: { can_see_costs: true } }), 'the owner grants the cost');
    expect(cost(ok(await j('/api/products', { token: tok }), 'employee list after the grant')) === 40, 'after the owner granted it the employee should see the cost');
  });

  await kase('PP-06', 'a sign-in id is unique per shop: the same key twice is refused, and it is free in another shop', async () => {
    const first = await addActor(A, 'Una Unique', 'h'), again = { display_name: 'Una Twin', actor_key: key('h'), access_level: 'editor' };
    const twin = await j('/api/actors', { method: 'POST', token: A.token, body: again });
    const check = ok(await j('/api/actors/check-key', { method: 'POST', token: A.token, body: { actor_key: key('h') } }), 'check-key').b;
    expect(twin.status === 400 && twin.b.code === 'ACTOR_KEY_TAKEN' && check.available === false, 'same key twice answered ' + twin.status + ' ' + JSON.stringify(twin.b).slice(0, 160) + ' · check-key ' + JSON.stringify(check));
    const B = await freshShop(RUN + 'b', 'People truth two');
    const other = ok(await j('/api/actors', { method: 'POST', token: B.token, body: again }), 'the same key in another shop').b;
    expect(other.actor.login_format !== first.actor.login_format, 'the two shops gave one sign-in id ' + other.actor.login_format);
  });

  await kase('PP-07', 'a new employee signs in with the first code, sets their own PIN, and the first code stops working', async () => {
    const emp = await addActor(A, 'Nia Newhire', 'i'), first = await loginWith(emp, { otp: H.ENTITY_OTP });
    expect(first.status === 200 && first.b.token && first.b.requires_pin_setup === true, 'first sign-in answered ' + first.status + ' ' + JSON.stringify(first.b).slice(0, 160));
    const odd = await j('/api/actors/set-pin', { method: 'POST', token: first.b.token, body: { pin: PIN, confirm_pin: '0000' } });
    expect(odd.status === 400, 'two PINs that differ answered ' + odd.status);
    ok(await j('/api/actors/set-pin', { method: 'POST', token: first.b.token, body: { pin: PIN, confirm_pin: PIN } }), 'set the PIN');
    const next = await loginWith(emp, { pin: PIN }), stale = await loginWith(emp, { otp: H.ENTITY_OTP });
    expect(next.status === 200 && next.b.token && next.b.requires_pin_setup === false, 'the PIN sign-in answered ' + next.status + ' ' + JSON.stringify(next.b).slice(0, 160));
    expect(stale.status >= 400 && !stale.b.token, 'the first code still signed in: ' + stale.status);
  });

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
  }, 'ACC-50 (open, merged-in PPL-5): a salary entry posts to the expense with no person; no payslip, no per-employee pay history. Armed: the salary voucher is really posted above');

  finish('people-truth', process.env.PEOPLE_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('people truth could not run:', e && e.message); process.exit(2); });
