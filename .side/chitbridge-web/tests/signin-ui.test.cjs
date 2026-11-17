/**
 * tests/signin-ui.test.cjs — M14: THE ONE SIGN-IN STATE MACHINE (public/app/signin-ui.js, CBSignin.machine), driven with no browser.
 *
 * The server is a stand-in `post` that answers what routes/signin.js answers (tests/signin-contact.test.cjs is the API side of
 * the same cases). What is proved here is the WINDOW's rules:
 *   owner by e-mail · owner by mobile · employee by mobile → code → set PIN → the PIN works · customer by e-mail ·
 *   ⭐ SEC-143: ask answers EVERYONE the same (api #883) so the window shows one PIN-or-code box for every person; one contact → two
 *   identities → the chooser appears only AFTER a correct secret (at verify) and re-verifies with the STORED id · a spent code is never re-sent ·
 *   social / SSO / passkey slots are hidden until switched on with a handler · the window never posts to a register door ·
 *   the session kept is the apps' shape (cb_sess) and a customer's is not cb_sess.
 *
 * Run: node tests/signin-ui.test.cjs
 */
'use strict';
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
/* ⚠️ this package is "type": "module", so require() of these browser files yields no exports — they attach to window, as in a page */
globalThis.window = globalThis;
require(path.join(ROOT, 'public', 'engine', 'signin.js'));
require(path.join(ROOT, 'public', 'app', 'signin-ui.js'));
const E = globalThis.CBSignin;
assert.strictEqual(typeof E.mount, 'function', 'signin-ui.js widened window.CBSignin with mount');

let pass = 0, fail = 0;
const it = (what, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('  ok  ' + what); }, (e) => { fail++; console.log('  FAIL ' + what + '\n       ' + (e && e.message || e)); });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const token = (claims) => b64({ alg: 'none' }) + '.' + b64(Object.assign({ iat: 1, exp: 2 }, claims)) + '.x';

/** the stand-in ChitBridge: the people, their contacts, what each door answers */
function standIn() {
  const calls = [];
  const P = {
    mayur: { id: 'mayuri123', kind: 'entity', name: 'Mayur Bhavan', contacts: ['athi@mayur.test', '9876543210'], code: null, pin: null,
             claims: { identity_id: 'mayur', identity_type: 'entity', display_name: 'Mayur Bhavan', bridge_id: 'B-MAYUR' } },
    bala:  { id: 'bala@mayuri123.br', kind: 'actor', name: 'Bala', contacts: ['9000000001'], code: '123456', pin: null,
             claims: { identity_id: 'bala', identity_type: 'actor', display_name: 'Bala', parent_entity_id: 'mayur', parent_entity_name: 'Mayur Bhavan', parent_bridge_id: 'B-MAYUR' } },
    kavi:  { id: 'kavi=mail.test@mayuri123.cr', kind: 'customer', name: 'Kavi', contacts: ['kavi@mail.test'], code: null, pin: null,
             claims: { identity_id: 'kavi', identity_type: 'customer', display_name: 'Kavi', parent_entity_id: 'mayur' } },
    athiAtAlpha: { id: 'athi@alpha-timers.br', kind: 'actor', name: 'Athi', contacts: ['9876543210'], code: null, pin: '2580',
             claims: { identity_id: 'athiAtAlpha', identity_type: 'actor', display_name: 'Athi', parent_entity_id: 'alpha', parent_entity_name: 'Alpha Timers' } },
  };
  const who = (id) => { id = String(id || '').trim().toLowerCase(); const all = Object.values(P);
    const exact = all.find((p) => p.id.toLowerCase() === id); if (exact) return [exact];
    return all.filter((p) => p.contacts.some((c) => c.toLowerCase() === id)); };
  const choices = (ps) => ps.map((p) => ({ id: p.id, kind: p.kind === 'actor' ? 'employee' : p.kind === 'customer' ? 'customer' : 'owner', name: p.name, shop: p.kind === 'entity' ? p.name : p.claims.parent_entity_name }));
  const tokens = new Map();
  const post = async (path, body, tok) => {
    calls.push({ path, body, tok });
    const id = body.id || body.email || body.user_id;
    if (path === '/api/signin/ask') {
      /* SEC-143: the SAME 200 for an unknown person, a PIN holder, a first-timer and a shared contact; only the side effect differs */
      const ps = who(id);
      if (ps.length === 1 && !(ps[0].kind === 'actor' && ps[0].pin)) { const p = ps[0]; p.code = p.kind === 'customer' ? '123123' : '123456'; p.sent = (p.sent || 0) + 1; }
      return { status: 200, body: { message: 'If that sign-in exists, enter your PIN or the code we sent.', need: 'pin_or_code' } };
    }
    if (path === '/api/signin/verify') {
      const ps = who(id);
      const secretOk = (p) => (p.kind === 'actor' && p.pin ? body.pin === p.pin : !!p.code && body.otp === p.code);
      const refused = { status: 400, body: { message: 'Invalid or expired OTP' } };
      if (!ps.length) return refused;
      /* SEC-143: a contact on several accounts is chosen AFTER a correct secret, never listed before */
      if (ps.length > 1) return ps.some(secretOk) ? { status: 409, body: { code: 'CHOOSE_IDENTITY', message: 'Choose one.', choices: choices(ps) } } : refused;
      const p = ps[0];
      if (!secretOk(p)) return p.kind === 'actor' && p.pin ? { status: 400, body: { message: 'Incorrect PIN. 4 attempts remaining.' } } : refused;
      if (!(p.kind === 'actor' && p.pin)) p.code = null;
      const t = token(p.claims); tokens.set(t, p);
      return { status: 200, body: Object.assign({ token: t, identity: { identity_id: p.claims.identity_id, display_name: p.name, user_id: p.kind === 'entity' ? p.id : null, identity_type: p.kind, bridge_id: p.claims.bridge_id || 'B' } },
        p.kind === 'actor' && !p.pin ? { requires_pin_setup: true } : {}) };
    }
    if (path === '/api/signin/pin') { const p = tokens.get(tok); if (!p) return { status: 401, body: {} }; p.pin = body.pin; return { status: 200, body: { message: 'PIN set successfully' } }; }
    return { status: 404, body: {} };
  };
  return { post, calls, P };
}
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const run = (c, api) => { const st = store(); const m = E.machine(Object.assign({ surface: 'test' }, c), { post: api.post, store: st }); return { m, st }; };

(async () => {
  console.log('\nsignin-ui · the one state machine');

  await it('owner by e-mail: ask → code → in; cb_sess holds the apps\' shape; onIn fires once', async () => {
    const api = standIn(); let got = null;
    const { m, st } = run({ need: 'person', onIn: (s) => { got = s; } }, api);
    m.typed('Athi@Mayur.test'); await m.go();
    assert.strictEqual(m.state().at, 'credential'); assert.strictEqual(m.state().need, 'either'); assert.strictEqual(m.state().kind, '', 'the window learns no kind before a secret');
    assert.deepStrictEqual(api.calls[0].body, { mode: 'login', email: 'athi@mayur.test' }, 'the engine\'s ask body, the e-mail tidied');
    await m.verify('123456');
    assert.strictEqual(m.state().at, 'in');
    const sess = JSON.parse(st.getItem('cb_sess'));
    assert.deepStrictEqual(Object.keys(sess).sort(), ['bridgeId', 'entity', 'name', 'role', 'token']);
    assert.strictEqual(sess.role, 'entity'); assert.strictEqual(sess.entity, 'Mayur Bhavan');
    assert.ok(got && got.token === sess.token && got.person.kind === 'owner' && got.person.id === 'mayuri123');
  });

  await it('owner by mobile (typed with spaces): sent as id; what was TYPED (tidied) is what verify sends', async () => {
    const api = standIn(); const { m } = run({ need: 'person' }, api);
    m.typed('98765 43210');
    api.P.athiAtAlpha.contacts = [];           /* only the owner holds this number in this case */
    await m.go();
    assert.deepStrictEqual(api.calls[0].body, { mode: 'login', id: '9876543210' });
    assert.strictEqual(m.state().resolved, '9876543210', 'the typed id, tidied: the server no longer sends one back');
    await m.verify('123456');
    assert.strictEqual(api.calls[1].body.id, '9876543210'); assert.strictEqual(m.state().at, 'in');
  });

  await it('⭐ employee by mobile: code → signed in → asked to set a PIN (4 digits, twice) → in; next time the PIN alone, by mobile', async () => {
    const api = standIn(); const { m, st } = run({ need: 'person' }, api);
    m.typed('9000000001'); await m.go();
    assert.strictEqual(m.state().need, 'either'); assert.strictEqual(m.state().resolved, '9000000001');
    await m.verify('123456');
    assert.strictEqual(m.state().at, 'setpin', 'requires_pin_setup → the set-PIN step');
    assert.strictEqual(st.getItem('cb_sess'), null, 'not signed in to the apps before the PIN is set');
    await m.setPin('4826', '4862');
    assert.strictEqual(m.state().at, 'setpin'); assert.ok(/different/.test(m.state().why), m.state().why);
    await m.setPin('1234', '1234');
    assert.ok(/easy to guess/.test(m.state().why), m.state().why);
    await m.setPin('482', '482');
    assert.strictEqual(m.state().why, 'Your PIN is four digits.', 'the online PIN is named as such, not "counter PIN"');
    await m.setPin('4826', '4826');
    assert.strictEqual(m.state().at, 'in');
    assert.strictEqual(api.calls.filter((c) => c.path === '/api/signin/pin').length, 1);
    assert.strictEqual(api.calls.find((c) => c.path === '/api/signin/pin').body.pin, '4826');
    const sess = JSON.parse(st.getItem('cb_sess'));
    assert.strictEqual(sess.role, 'actor'); assert.strictEqual(sess.entity, 'Mayur Bhavan'); assert.strictEqual(sess.duty, 'duty');
    /* the next day */
    const again = run({ need: 'person' }, api);
    again.m.typed('9000000001'); await again.m.go();
    assert.strictEqual(again.m.state().need, 'either', 'the same box for a PIN holder');
    assert.strictEqual(again.m.state().said, 'If that sign-in exists, enter your PIN or the code we sent.');
    await again.m.verify('123456');
    assert.strictEqual(again.m.state().at, 'credential'); assert.ok(again.m.state().why, 'a wrong secret is the server\'s refusal, not a client rule about kinds');
    assert.strictEqual(again.m.state().session, null);
    await again.m.verify('4826');
    assert.strictEqual(api.calls.filter((c) => c.path === '/api/signin/verify' && c.body.pin === '4826').length, 1, 'a 4-digit secret goes as pin');
    assert.strictEqual(again.m.state().at, 'in');
    assert.strictEqual(api.P.bala.sent, 1, 'no second code was ever issued for Bala');
  });

  await it('customer by e-mail: the customer\'s code; kept under sessionStorage cb_cust@<shop>, never cb_sess', async () => {
    const api = standIn(); const { m, st } = run({ need: 'customer', shop: 'mayur' }, api);
    m.typed('kavi@mail.test'); await m.go();
    assert.strictEqual(m.state().resolved, 'kavi@mail.test');
    await m.verify('123123');
    assert.strictEqual(m.state().at, 'in');
    assert.strictEqual(st.getItem('cb_sess'), null);
    assert.ok(JSON.parse(st.getItem('cb_cust@mayur')).token, 'kept under cb_cust@<shop> in the host store (sessionStorage in a page), never cb_sess');
  });

  await it('⭐ SEC-143 one mobile, two people: ask says nothing of it; the chooser comes AFTER the correct secret, then verifies with the STORED id', async () => {
    const api = standIn(); const { m } = run({ need: 'person' }, api);
    m.typed('9876543210'); await m.go();
    assert.strictEqual(m.state().at, 'credential', 'the same one box, no chooser at ask'); assert.deepStrictEqual(m.state().choices, []);
    await m.verify('9999');
    assert.strictEqual(m.state().at, 'credential', 'a wrong secret shows no list'); assert.ok(m.state().why);
    await m.verify('2580');
    assert.strictEqual(m.state().at, 'choose'); assert.strictEqual(m.state().choices.length, 2);
    assert.ok(!JSON.stringify(m.state()).includes('2580'), 'the held secret is not in the state the page paints');
    const i = m.state().choices.findIndex((c) => c.kind === 'employee');
    await m.choose(i);
    const last = api.calls[api.calls.length - 1];
    assert.strictEqual(last.path, '/api/signin/verify'); assert.strictEqual(last.body.id, 'athi@alpha-timers.br'); assert.strictEqual(last.body.pin, '2580');
    assert.strictEqual(api.calls.filter((c) => c.path === '/api/signin/ask').length, 1, 'choosing never asks again');
    assert.strictEqual(m.state().at, 'in'); assert.strictEqual(m.state().session.entity, 'Alpha Timers');
  });

  await it('⭐ SEC-143 verify answers 409 with 2 accounts: the chooser shows exactly those, one pick re-verifies ONCE, a double tap does not repost, held is cleared', async () => {
    const api = standIn(); const { m } = run({ need: 'person' }, api);
    m.typed('9876543210'); await m.go(); await m.verify('2580');
    const shown = m.state().choices.map((c) => c.id).sort();
    assert.strictEqual(m.state().at, 'choose');
    assert.deepStrictEqual(shown, ['athi@alpha-timers.br', 'mayuri123'], 'exactly the accounts the 409 listed');
    const before = api.calls.filter((c) => c.path === '/api/signin/verify').length;
    const i = m.state().choices.findIndex((c) => c.id === 'athi@alpha-timers.br');
    const first = m.choose(i); const second = m.choose(i);   /* a double tap */
    await first; await second;
    assert.strictEqual(api.calls.filter((c) => c.path === '/api/signin/verify').length, before + 1, 'one pick = one re-verify, the double tap posted nothing');
    assert.strictEqual(m.state().at, 'in');
    const after = api.calls.length; await m.choose(i);
    assert.strictEqual(api.calls.length, after, 'held is cleared after the sign-in: choosing again posts nothing');
    /* and a window torn down while the chooser is open drops the secret too */
    const b = run({ need: 'person' }, standIn()); b.m.typed('9876543210'); await b.m.go(); await b.m.verify('2580');
    assert.strictEqual(b.m.state().at, 'choose'); b.m.close();
    const api2 = standIn(); const c2 = run({ need: 'person' }, api2); c2.m.typed('9876543210'); await c2.m.go(); await c2.m.verify('2580'); c2.m.close();
    const k = api2.calls.length; await c2.m.choose(0); assert.strictEqual(api2.calls.length, k, 'close() cleared held: nothing to repost');
  });

  await it('⭐ SEC-143 the same box and the same words for an unknown person, a PIN holder and a first-timer', async () => {
    const seen = [];
    for (const typed of ['nobody@nowhere.test', '9000000001', 'athi@alpha-timers.br']) {
      const api = standIn(); if (typed === '9000000001') api.P.bala.pin = '4826';
      const { m } = run({ need: 'person' }, api); m.typed(typed); await m.go();
      const S = m.state(); seen.push(JSON.stringify([S.at, S.need, S.kind, S.said, S.why]));
    }
    assert.strictEqual(new Set(seen).size, 1, 'one screen for everyone: ' + seen.join(' | '));
    assert.ok(!/no account|not found|pin|code sent/i.test(JSON.parse(seen[0])[3].replace('PIN or the code we sent', '')), 'nothing before the secret says whether the person exists or has a PIN');
  });

  await it('⚠️ a spent code is never re-sent: Continue twice = one ask; a wrong code never re-asks; "Send a new code" is the only second ask; once in, nothing asks', async () => {
    const api = standIn(); const { m } = run({ need: 'person' }, api);
    m.typed('athi@mayur.test'); await m.go();
    m.back(); m.typed('athi@mayur.test'); await m.go();      /* came back to the box, pressed Continue again */
    assert.strictEqual(api.calls.filter((c) => c.path === '/api/signin/ask').length, 1, 'the code already on its way is not asked for again');
    assert.strictEqual(m.state().at, 'credential');
    await m.verify('000000');
    assert.ok(/did not match|Invalid/.test(m.state().why), m.state().why);
    assert.strictEqual(api.calls.filter((c) => c.path === '/api/signin/ask').length, 1, 'a wrong code does not re-send');
    await m.again();
    assert.strictEqual(api.calls.filter((c) => c.path === '/api/signin/ask').length, 2, 'Send a new code is the one way');
    assert.strictEqual(api.P.mayur.sent, 2);
    await m.verify('123456');
    assert.strictEqual(m.state().at, 'in');
    await m.again(); await m.go();
    assert.strictEqual(api.calls.filter((c) => c.path === '/api/signin/ask').length, 2, 'signed in: nothing asks');
    assert.strictEqual(m.state().sent, null);
  });

  await it('refusals are sentences: an unknown contact, too many tries, the line down — and the register door is never posted to', async () => {
    const api = standIn(); const { m } = run({ need: 'person' }, api);
    m.typed('nobody@nowhere.test'); await m.go();
    assert.strictEqual(m.state().at, 'credential', 'SEC-143: ask does not say the person is unknown');
    await m.verify('123456'); assert.ok(m.state().why, 'the refusal comes with the secret'); assert.strictEqual(m.state().at, 'credential');
    assert.ok(!/no account/i.test(m.state().why), 'and does not say which part was wrong');
    m.typed(''); await m.go(); assert.ok(m.state().why);
    const flaky = { post: async (p) => ({ status: 429, body: {} }) };
    const n = E.machine({ need: 'person' }, { post: flaky.post, store: store() }); n.typed('athi@mayur.test'); await n.go();
    assert.strictEqual(n.state().why, 'Too many tries. Wait 15 minutes.');
    const down = E.machine({ need: 'person' }, { post: async () => ({ status: 0, body: {} }), store: store() }); down.typed('athi@mayur.test'); await down.go();
    assert.ok(/Could not reach/.test(down.state().why), down.state().why);
    assert.ok(api.calls.every((c) => /^\/api\/signin\//.test(c.path)), 'only the sign-in door — never /api/entities/register');
  });

  await it('the method slots: config, hidden by default; shown only when switched on WITH a handler; never a fake button', () => {
    assert.deepStrictEqual(Object.keys(E.METHODS).sort(), ['apple', 'google', 'microsoft', 'passkey', 'sso']);
    assert.deepStrictEqual(E.machine({}).methods(), []);
    assert.deepStrictEqual(E.machine({ methods: { google: true } }).methods(), [], 'switched on but no handler → still hidden');
    assert.deepStrictEqual(E.machine({ methods: { google: true, sso: true }, onMethod: () => {} }).methods(), ['google', 'sso']);
  });

  await it('sessionOf reads a verify answer into the session the apps keep (entity · employee · customer)', () => {
    const e = E.sessionOf({ token: token({ identity_id: 'x', identity_type: 'entity', display_name: 'Shop', bridge_id: 'B1' }), identity: { display_name: 'Shop', user_id: 'shop', identity_type: 'entity', bridge_id: 'B1' } });
    assert.deepStrictEqual([e.role, e.name, e.entity, e.bridgeId, e.person.kind, e.duty], ['entity', 'Shop', 'Shop', 'B1', 'owner', undefined]);
    const a = E.sessionOf({ token: token({ identity_id: 'a', identity_type: 'actor', display_name: 'Ravi', parent_entity_id: 'x', parent_entity_name: 'Shop', parent_bridge_id: 'B1', device_id: 'd1', surface: 'till', jti: 'j' }), identity: { display_name: 'Ravi', identity_type: 'actor' } });
    assert.deepStrictEqual([a.role, a.entity, a.bridgeId, a.person.kind, a.duty, a.device_id, a.surface, a.jti], ['actor', 'Shop', 'B1', 'employee', 'duty', 'd1', 'till', 'j']);
    const c = E.sessionOf({ token: token({ identity_id: 'c', identity_type: 'customer', display_name: 'Kavi', parent_entity_id: 'x' }), identity: { display_name: 'Kavi', identity_type: 'customer' } });
    assert.strictEqual(c.person.kind, 'customer'); assert.strictEqual(c.person.shop, 'x');
  });

  /* ── the till (2026-10-08): the same window, with the counter PIN book as the host's LOCAL credential ──────────────────── */
  const book = () => {
    const entries = { xclerk: { id: 'xclerk', name: 'X Clerk', kind: 'employee', entity: 'mayur', pin: '9173', tries: 0 } };
    const calls = [];
    return { entries, calls, local: {
      find: (id) => { calls.push(['find', id]); const e = entries[String(id).trim().toLowerCase()]; return e && e.tries < 5 ? e : null; },
      check: async (e, pin) => { calls.push(['check', e.id, pin]);
        if (pin === e.pin) { e.tries = 0; return { ok: true, person: { id: e.id, name: e.name, kind: e.kind, entity: e.entity } }; }
        e.tries++; return e.tries >= 5 ? { ok: false, locked: true, why: 'Locked. Sign in with a code.' } : { ok: false, why: 'Wrong PIN. ' + (5 - e.tries) + ' left.', entry: e }; },
      has: (p) => !!entries[p && p.id],
      save: async (sess, pin) => { calls.push(['save', sess.person.id, pin]); entries[sess.person.id] = { id: sess.person.id, name: sess.name, kind: 'employee', pin, tries: 0 }; return { ok: true }; },
    } };
  };

  await it('⭐ the till: a counter PIN in the host\'s book is tried FIRST — nothing posted, no token, no cb_sess; onIn gets no answer', async () => {
    const api = standIn(); const b = book(); let got = null;
    const { m, st } = run({ need: 'person', surface: 'till', local: b.local, onIn: (s, a) => { got = [s, a]; } }, api);
    m.typed('XClerk '); await m.go();
    assert.strictEqual(m.state().at, 'credential'); assert.strictEqual(m.state().need, 'pin'); assert.ok(m.state().local, 'the local entry is held');
    assert.deepStrictEqual(api.calls, [], 'the line was not asked');
    await m.verify('123456'); assert.ok(/four digits/.test(m.state().why), 'a code in the PIN box is refused in words');
    await m.verify('0000'); assert.ok(/Wrong PIN/.test(m.state().why)); assert.strictEqual(m.state().at, 'credential');
    await m.verify('9173');
    assert.strictEqual(m.state().at, 'in'); assert.strictEqual(m.state().session.token, '');
    assert.strictEqual(st.getItem('cb_sess'), null, 'no session is kept for a local sign-in');
    assert.ok(got && got[0].person.id === 'xclerk' && got[0].local === true && got[1] === null, 'onIn: the person, and no server answer');
    assert.deepStrictEqual(api.calls, [], 'still nothing posted');
  });

  await it('⚠️ a locked counter PIN sends them back to the box; "Use a code instead" asks the line (and never while offline)', async () => {
    const api = standIn(); const b = book(); let online = false;
    const { m } = run({ need: 'person', local: b.local, online: () => online }, api);
    b.entries.xclerk.tries = 4;
    m.typed('xclerk'); await m.go(); await m.verify('1111');
    assert.strictEqual(m.state().at, 'out'); assert.ok(/Locked/.test(m.state().why)); assert.strictEqual(m.state().local, null);
    /* a usable PIN again, but the person wants the line: offline → refused silently (no dead button); online → the ask goes out */
    b.entries.xclerk.tries = 0; m.typed('xclerk'); await m.go();
    await m.line(); assert.strictEqual(m.state().at, 'credential'); assert.ok(m.state().local, 'offline: the PIN box stays');
    online = true; api.P.xc = { id: 'xclerk', kind: 'actor', name: 'X Clerk', contacts: [], code: null, pin: null, claims: { identity_id: 'xc', identity_type: 'actor', display_name: 'X Clerk', parent_entity_id: 'mayur' } };
    await m.line();
    assert.strictEqual(api.calls[0].path, '/api/signin/ask'); assert.strictEqual(m.state().local, null); assert.strictEqual(m.state().need, 'either');
    assert.ok(b.calls.filter((c) => c[0] === 'find').length >= 2, 'the book was consulted first each time');
  });

  await it('⭐ the till: after an online sign-in the host offers the LOCAL PIN (offerPin → setpin → save → in); "Not now" skips it; the server PIN step is not skippable', async () => {
    const api = standIn(); const b = book();
    const { m } = run({ need: 'person', local: b.local, onIn: () => {} }, api);
    m.typed('athi@mayur.test'); await m.go(); await m.verify('123456');
    assert.strictEqual(m.state().at, 'in');
    await m.offerPin();
    assert.strictEqual(m.state().at, 'setpin'); assert.strictEqual(m.state().localPin, true);
    await m.setPin('123', '123'); assert.strictEqual(m.state().why, 'Counter PIN is four digits.', 'named as the counter PIN');
    await m.later(); assert.strictEqual(m.state().at, 'in'); assert.strictEqual(b.calls.filter((c) => c[0] === 'save').length, 0);
    await m.offerPin(); await m.setPin('4826', '4826');
    assert.strictEqual(m.state().at, 'in'); assert.deepStrictEqual(b.calls.filter((c) => c[0] === 'save')[0], ['save', 'mayuri123', '4826']);
    assert.strictEqual(api.calls.filter((c) => c.path === '/api/signin/pin').length, 0, 'the local PIN never reaches the server');
    await m.offerPin(); assert.strictEqual(m.state().at, 'in', 'has() → no second offer');
    /* the SERVER's first-time PIN (requires_pin_setup) is not a choice: later() does nothing there */
    const e = run({ need: 'person', local: b.local }, api); e.m.typed('9000000001'); await e.m.go(); await e.m.verify('123456');
    assert.strictEqual(e.m.state().at, 'setpin'); assert.strictEqual(e.m.state().localPin, false);
    await e.m.later(); assert.strictEqual(e.m.state().at, 'setpin', 'the server PIN step cannot be skipped');
    /* and a host that holds the person already (the till after a reload) may offer with a given session */
    const r = run({ need: 'person', local: b.local }, api);
    await r.m.offerPin({ token: '', name: 'Bala', person: { id: 'bala', kind: 'employee' } });
    assert.strictEqual(r.m.state().at, 'setpin'); assert.strictEqual(r.m.state().localPin, true);
  });

  console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
