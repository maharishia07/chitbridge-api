/**
 * ── ⭐⭐⭐ MINT A USER ID, AND READ ONE BACK ───────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-15: *"mint user id should be a module, and it should have these combinations in one place,
 * similarly, resolve user id should be a module… similarly for others as well, network naming and so on. so it
 * will be easier to maintain."*
 *
 * ⚠️⚠️ THE ASSERTION THAT MATTERS MOST IS § 0, AND IT IS NOT ABOUT NEW CODE. The customer handle is the OTP
 * lookup key for every storefront customer that already exists. If moving the builder out of
 * routes/catalogue.js changes one byte, every returning customer stops being recognised and silently becomes a
 * SECOND identity — with their order history left behind on the first. So the original formula is written out
 * here independently and the module is held to it.
 */
const assert = require('assert');
const mint = require('../lib/mintuserid');
const resolve = require('../lib/resolveuserid');
const handle = require('../lib/handle');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

console.log('\n══ USER IDS — one place to mint, one place to read ══\n');

/* ── § 0 · THE FORM THAT ALREADY EXISTS IN PRODUCTION MUST NOT MOVE ────────────────────────────────────────── */
/** routes/catalogue.js crHandle(), as it was before the move. Written out, not imported — the point is to be a
 *  SECOND opinion. If the module and this disagree, the module is wrong. */
function crHandleOriginal(channel, raw, entity) {
  const local = channel === 'email' ? raw.replace('@', '=') : raw;
  const at = (entity && entity.user_id) || (entity && entity.bridge_id) || '';
  return local + '@' + at + '.cr';
}

ok('⭐⭐ the customer handle is byte-identical to the one production already stores', () => {
  const shops = [
    { user_id: 'alpha-timers', bridge_id: 'CBZQK5DAH9' },
    { user_id: null, bridge_id: 'CBZQK5DAH9' },          /* registered before b170 — the fallback */
    { user_id: 'acmetraders', bridge_id: 'CBM5P72HB7' },
  ];
  const contacts = [
    ['phone', '9876512345'], ['phone', '00971501234567'],
    ['email', 'xyz@gmail.com'], ['email', 'xyz@yahoo.com'], ['email', 'a.b+tag@sub.domain.co.in'],
  ];
  for (const shop of shops) {
    for (const [ch, raw] of contacts) {
      const want = crHandleOriginal(ch, raw, shop);
      const got = mint.customer(ch, raw, shop).handle;
      assert.strictEqual(got, want,
        'a returning customer would no longer be recognised: ' + ch + ' ' + raw + ' at '
        + (shop.user_id || shop.bridge_id) + ' → ' + got + ', was ' + want);
    }
  }
});

ok('⚠️ two addresses at one shop stay two people', () => {
  const shop = { user_id: 'alpha-timers' };
  const a = mint.customer('email', 'xyz@gmail.com', shop).handle;
  const b = mint.customer('email', 'xyz@yahoo.com', shop).handle;
  assert.notStrictEqual(a, b,
    'the local part alone would collapse these into ONE identity — cross-customer order visibility, misrouted OTP');
});

ok('⚠️ the same person at two shops is two customers', () => {
  const a = mint.customer('phone', '9876512345', { user_id: 'alpha-timers' }).handle;
  const b = mint.customer('phone', '9876512345', { user_id: 'acmetraders' }).handle;
  assert.notStrictEqual(a, b, 'a storefront identity is per-shop by design');
});

/* ── § 1 · EVERY COMBINATION, FROM ONE DOOR ───────────────────────────────────────────────────────────────── */
const SHOP = { user_id: 'alpha-timers', bridge_id: 'CBZQK5DAH9' };

ok('⭐ every kind mints from the same front door', () => {
  assert.strictEqual(mint.mint('entity', { user_id: 'acmetraders' }).handle, 'acmetraders');
  assert.strictEqual(mint.mint('employee', { actor_key: 'ravi', entity: SHOP }).handle, 'ravi@alpha-timers.br');
  assert.strictEqual(mint.mint('customer', { channel: 'phone', raw: '9876512345', entity: SHOP }).handle,
    '9876512345@alpha-timers.cr');
  assert.strictEqual(mint.mint('minted', { entity: SHOP, minted_kind: 'sup', n: 7 }).handle,
    '~alpha-timers.sup-0007');
  assert.strictEqual(mint.mint('network', { in: 'acmetraders', name: 'Mens Clothing' }).handle,
    'acmetraders.mens-clothing');
  assert.ok(/^CB[A-HJ-NP-Z2-9]{8}$/.test(mint.mint('bridge_id', {}).handle));
});

ok('⚠️ an unknown kind is refused, not guessed', () => {
  const r = mint.mint('franchise', {});
  assert.ok(r.error && /not a kind of user id/.test(r.error), JSON.stringify(r));
});

ok('the fallback to a bridge id is real, and only when there is no handle', () => {
  const old = { user_id: null, bridge_id: 'CBZQK5DAH9' };
  /* ⚠️ the bridge id keeps its CASE — see ownerOf. Lowercasing it broke the customer form for every
     pre-b170 shop, and the employee form follows the same rule so the two cannot drift apart. */
  assert.strictEqual(mint.employee('ravi', old).handle, 'ravi@CBZQK5DAH9.br');
  assert.strictEqual(mint.employee('ravi', SHOP).handle, 'ravi@alpha-timers.br',
    'a shop WITH a handle must never fall back — that is the readable form Athi asked for');
});

ok('⚠️ a business with neither a handle nor a bridge id is refused', () => {
  assert.ok(mint.employee('ravi', {}).error, 'there is nothing to hang the name from');
  assert.ok(mint.employee('ravi', null).error);
});

ok('an employee key must be letters and numbers', () => {
  for (const bad of ['ra vi', 'ravi@x', 'ravi.kumar', '', null]) {
    assert.ok(mint.employee(bad, SHOP).error, JSON.stringify(bad) + ' should be refused');
  }
});

/* ── § 2 · READING ONE BACK ───────────────────────────────────────────────────────────────────────────────── */
ok('⭐ every minted form classifies back to the kind that made it', () => {
  const cases = [
    [mint.entity('acmetraders').handle, 'entity'],
    [mint.network('acmetraders', 'Mens').handle, 'network_node'],
    [mint.employee('ravi', SHOP).handle, 'employee'],
    [mint.customer('phone', '9876512345', SHOP).handle, 'customer'],
    [mint.customer('email', 'xyz@gmail.com', SHOP).handle, 'customer'],
    [mint.minted(SHOP, 'sup', 7).handle, 'minted'],
    [mint.bridge().handle, 'bridge_id'],
  ];
  for (const [h, kind] of cases) {
    assert.strictEqual(resolve.classify(h).kind, kind, h + ' read back as ' + resolve.classify(h).kind);
  }
});

ok('⭐ a round trip recovers the parts, including an email', () => {
  const e = resolve.classify(mint.employee('ravi', SHOP).handle);
  assert.strictEqual(e.actor_key, 'ravi'); assert.strictEqual(e.at, 'alpha-timers');
  const p = resolve.classify(mint.customer('phone', '9876512345', SHOP).handle);
  assert.strictEqual(p.channel, 'phone'); assert.strictEqual(p.contact, '9876512345');
  const m = resolve.classify(mint.customer('email', 'xyz@gmail.com', SHOP).handle);
  assert.strictEqual(m.channel, 'email');
  assert.strictEqual(m.contact, 'xyz@gmail.com', 'the "=" swap must be readable back for display');
  assert.strictEqual(m.at, 'alpha-timers');
});

ok('⭐ a foreign address is a bridge id and a domain — never a handle', () => {
  const f = resolve.classify('CBZQK5DAH9@in.example');
  assert.strictEqual(f.kind, 'foreign');
  assert.strictEqual(f.bridge_id, 'CBZQK5DAH9');
  assert.strictEqual(f.domain, 'in.example');
});

ok('⚠️⚠️ the UNSUFFIXED typed form is its own answer, not a guess', () => {
  const t = resolve.classify('ravi@acmetraders');
  assert.strictEqual(t.kind, 'employee_typed',
    'this is what a person types at a login box AND what a foreign address looks like — the grammar cannot '
    + 'settle it alone, and pretending otherwise is how one gets read as the other');
  assert.deepStrictEqual(t.could_be, ['employee']);
  const d = resolve.classify('alpha-timers@in.example');
  assert.deepStrictEqual(d.could_be, ['employee', 'foreign'], 'a dotted right side could be either');
});

ok('⭐ storedForm turns what somebody types into what the row holds', () => {
  assert.strictEqual(resolve.storedForm('ravi@acmetraders'), 'ravi@acmetraders.br');
  assert.strictEqual(resolve.storedForm('ravi@acmetraders.br'), 'ravi@acmetraders.br', 'already stored');
  assert.strictEqual(resolve.storedForm('acmetraders'), 'acmetraders');
  assert.strictEqual(resolve.storedForm('9876512345@alpha-timers.cr'), '9876512345@alpha-timers.cr');
  assert.strictEqual(resolve.storedForm('CBZQK5DAH9'), null, 'a bridge id is not a user id');
  assert.strictEqual(resolve.storedForm('alpha-timers@in.example', { as: 'foreign' }), null);
});

ok('⚠️ a minted party is never sendable, and everything real is', () => {
  assert.strictEqual(resolve.isSendable(mint.minted(SHOP, 'sup', 1).handle), false,
    'a chit addressed to somebody who cannot sign in would sit as sent for ever');
  for (const h of ['acmetraders', mint.employee('ravi', SHOP).handle,
                   mint.customer('phone', '99', SHOP).handle, 'CBZQK5DAH9@in.example']) {
    assert.strictEqual(resolve.isSendable(h), true, h + ' must be sendable');
  }
});

/**
 * ── ⭐⭐ THE CONSTITUTION, AND THE SECOND MEANING OF "@" ─────────────────────────────────────────────────────────
 * Athi, 2026-09-15: *"check the constitution logic, all should work perfectly."*
 */
ok('⭐⭐ a constitution ref is NOT read as a person', () => {
  for (const ref of ['gst-india@v1', 'uae-vat@v12', 'iso-29119@v1', 'cb-core@v3']) {
    const c = resolve.classify(ref);
    assert.strictEqual(c.kind, 'version_ref',
      ref + ' read as "' + c.kind + '" — a caller acting on that would go looking for a person called '
      + String(ref).split('@')[0]);
    assert.strictEqual(c.version, ref.split('@')[1]);
    assert.strictEqual(c.of, ref.split('@')[0]);
  }
});

ok('⚠️ and a version ref can never be sent a chit', () => {
  assert.strictEqual(resolve.isSendable('gst-india@v1'), false,
    '"not minted and not unreadable" would have said yes — a constitution is not a party');
});

ok('⚠️ a real business is never mistaken for a version', () => {
  /* the discriminator is structural: a handle is at least MIN_ROOT characters, a version is v + digits */
  assert.strictEqual(resolve.classify('ravi@acmetraders').kind, 'employee_typed');
  assert.strictEqual(resolve.classify('ravi@v1shop').kind, 'employee_typed',
    'v1shop is a business name, not a version — only "v" followed by digits ALONE is a version');
  assert.ok(handle.MIN_ROOT >= 8, 'the discriminator relies on a business handle being at least 8 characters');
});

ok('rubbish is "unknown" with a reason, never an exception', () => {
  for (const bad of ['', '   ', '@', 'x@', '@y', '~notminted', 'ravi@.br', null, undefined]) {
    const r = resolve.classify(bad);
    assert.strictEqual(r.kind, 'unknown', JSON.stringify(bad) + ' → ' + r.kind);
    assert.ok(r.why, 'and it must say why');
  }
});

/**
 * ── ⭐⭐⭐ § 2b · SIGNING IN AS AN EMPLOYEE STILL WORKS ────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-15: *"if I sign in as employee id, it should work?"*
 *
 * ⚠️ THE LOGIN PARSE WAS CHANGED TODAY — `routes/actors.js` had `username.split('@')` written out twice and now
 * asks the resolver instead. That is the highest-risk edit in the app, so the shapes people actually type are
 * pinned here. The route's lookups are `LOWER(user_id)`, `LOWER(display_name)` and an EXACT `actor_key = $1`,
 * and every actor_key is stored lowercase at every mint site — so the resolver lowercasing both halves is
 * correct, and it FIXES `Ravi@acme`, which previously matched nothing.
 */
ok('⭐⭐ every shape a person types at the sign-in box still resolves', () => {
  const cases = [
    ['ravi@acmetraders',    'ravi', 'acmetraders'],   /* the User ID form */
    ['ravi@Alpha Timers',   'ravi', 'alpha timers'],  /* the DISPLAY NAME form — still accepted, still lowercased */
    ['Ravi@AcmeTraders',    'ravi', 'acmetraders'],   /* ⭐ was broken: actor_key = 'Ravi' matched no row */
    ['ravi@acmetraders.br', 'ravi', 'acmetraders'],   /* ⭐ the STORED form now resolves to the business too */
    ['ravi@athi.clothing',  'ravi', 'athi.clothing'], /* an employee of a network store */
  ];
  for (const [typed, key, at] of cases) {
    const c = resolve.classify(typed);
    assert.ok(c.kind === 'employee' || c.kind === 'employee_typed',
      typed + ' read as "' + c.kind + '" — a login box must never fail to recognise what people already type');
    assert.strictEqual(c.actor_key, key, typed + ' → actor_key ' + c.actor_key);
    assert.strictEqual(c.at, at, typed + ' → business ' + c.at);
  }
});

/**
 * ⭐⭐ A STORE INSIDE A NETWORK, AND ITS PEOPLE. Athi, 2026-09-15: *"an entity is created as part of network,
 * what its name? and its employee id? can you give how the network entity employee login to the system?"*
 *
 *     network root         acmetraders
 *     store in it          acmetraders.clothing        ⚠️ ROOT first, then the store — never the reverse, and
 *                                                        never a third level (acmetraders.clothing.mens is
 *                                                        refused; depth lives in the ltree)
 *     its employee, stored ravi@acmetraders.clothing.br
 *     what she types       ravi@acmetraders.clothing   → entity `acmetraders.clothing` → actor `ravi` under it
 */
ok('⭐⭐ a network store is root.store, and its employee id hangs off that', () => {
  const store = mint.network('acmetraders', 'Clothing');
  assert.strictEqual(store.handle, 'acmetraders.clothing');
  assert.strictEqual(mint.network('acmetraders.clothing', 'Mens').handle, 'acmetraders.mens',
    'a department of a department is STILL root.name — a co-assist login must stay sayable');
  const emp = mint.employee('ravi', { user_id: store.handle, bridge_id: 'CBM5P72HB7' });
  assert.strictEqual(emp.handle, 'ravi@acmetraders.clothing.br');
  /* and the login path reads both forms back to the STORE, not to the network root */
  for (const typed of ['ravi@acmetraders.clothing', 'ravi@acmetraders.clothing.br']) {
    const c = resolve.classify(typed);
    assert.strictEqual(c.actor_key, 'ravi');
    assert.strictEqual(c.at, 'acmetraders.clothing', typed + ' must resolve to the store she works at');
  }
});

ok('⚠️ and the suffixed form does NOT send anybody looking for a business called "acmetraders.br"', () => {
  assert.strictEqual(resolve.classify('ravi@acmetraders.br').at, 'acmetraders',
    'the old split("@") returned "acmetraders.br", which matches no entity row');
});

/* ── § 3 · THE TWO MODULES SHARE ONE GRAMMAR AND NEVER EACH OTHER ─────────────────────────────────────────── */
ok('⚠️ mint does not require resolve, and resolve does not require mint', () => {
  const fs = require('fs'), path = require('path');
  const m = fs.readFileSync(path.join(__dirname, '..', 'lib', 'mintuserid.js'), 'utf8');
  const r = fs.readFileSync(path.join(__dirname, '..', 'lib', 'resolveuserid.js'), 'utf8');
  assert.ok(!/require\('\.\/resolveuserid'\)/.test(m),
    'a builder that also parses starts accepting only what it emits, and last year’s form stops being readable');
  assert.ok(!/require\('\.\/mintuserid'\)/.test(r));
  for (const src of [m, r]) assert.ok(/require\('\.\/handle'\)/.test(src), 'both must share the ONE grammar');
});

ok('every kind the modules name is one the other knows about', () => {
  for (const k of mint.KINDS) {
    if (k === 'network') { assert.ok(resolve.KINDS.indexOf('network_node') >= 0); continue; }
    assert.ok(resolve.KINDS.indexOf(k) >= 0, 'mint can make "' + k + '" and resolve cannot read it back');
  }
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
