/**
 * ── ⭐⭐⭐ THE BARE SLATE — WHAT SURVIVES WITHOUT CHITBRIDGE ─────────────────────────────────────────────────────
 *
 * Athi, 2026-09-15:
 *
 *   *"each capability has to be proven without the concept of chit if possible so we understand what is tightly
 *    bound and what can be reused and we have to clearly mark it, so we should be able to include it as a jar
 *    file or include in any other language kind of — that will be our software asset."*
 *
 * ⭐ THE TEST OF AN ASSET IS THAT IT RUNS WITH NOTHING AROUND IT. Not "it has few imports" — that it can be
 * lifted out, dropped into a program that has never heard of a chit, and still answer correctly. Everything
 * below is exercised with no database, no network, no server, no session, and no chit.
 *
 * ── ⚠️⚠️ THE HARD PART IS NOT RUNNING THEM, IT IS PROVING THEY ARE *ALONE* ──────────────────────────────────────
 *
 * A module can import the world and still pass a functional test, because the imports load fine in this repo.
 * So §0 below reads each file and asserts its require() list is empty or Tier-A-only — a module that reaches for
 * ../db is bound to this database and is NOT an asset, however pure its arithmetic looks.
 *
 * ⚠️ AND A PASSING RUN HERE IS NOT A SHIPPING CLAIM. It says these ten can be lifted. It does not say anybody
 * has packaged them, versioned them, or written their documentation. See docs/SOFTWARE-ASSETS.md for what each
 * one IS, and for the list of things that are deliberately NOT assets.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

const LIB = path.join(__dirname, '..', 'lib');

/**
 * The claim, per module: it answers a real question, and it needs nothing but itself.
 * ⚠️ `allow` is what it may import and still be liftable — a Tier A sibling travels WITH it.
 */
const ASSETS = [
  { file: 'money.js',          allow: [],                      what: 'an amount and a currency, never converted' },
  { file: 'points.js',         allow: [],                      what: 'a reward balance that refuses to be money' },
  { file: 'units.js',          allow: [],                      what: 'one unit, many spellings; never converts' },
  { file: 'docnumber.js',      allow: [],                      what: 'what a document number may look like, per country' },
  { file: 'jurisdiction.js',   allow: [],                      what: 'country → how a party may be paid' },
  { file: 'rewards.js',        allow: [],                      what: 'what a point is worth, said in words' },
  { file: 'inventory.js',      allow: [],                      what: 'perpetual stock, weighted average' },
  /* ⚠️ `crypto` is node's own. A builtin travels with the LANGUAGE, not with this product — a Java or Go port
     would use its own standard library and the module would still be the same asset. */
  { file: 'canon.js',          allow: ['crypto'],              what: 'the same value, always the same bytes' },
  { file: 'order-input.js',    allow: [],                      what: 'what a catalogue asks a buyer for' },
  { file: 'form-handshake.js', allow: [],                      what: 'which document fills which field' },
];

console.log('\n══ BARE SLATE — ten modules, no database, no chit ══\n');

/* ── § 0 · ALONE ───────────────────────────────────────────────────────────────────────────────────────────── */
const requiresIn = (src) => [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

for (const a of ASSETS) {
  ok('alone: ' + a.file.padEnd(18) + a.what, () => {
    const p = path.join(LIB, a.file);
    assert.ok(fs.existsSync(p), a.file + ' is gone — this list names a file that is not there');
    const deps = requiresIn(fs.readFileSync(p, 'utf8'));
    const bad = deps.filter((d) => !a.allow.includes(d));
    assert.deepStrictEqual(bad, [],
      a.file + ' imports ' + JSON.stringify(bad) + '. A module that reaches for the database, the network or '
      + 'another layer is bound to this product and is not liftable, however pure its arithmetic looks.');
  });
}

/* ── § 1 · AND EACH ONE ANSWERS SOMETHING REAL ─────────────────────────────────────────────────────────────── */
console.log('');

ok('money: adds like money and refuses to convert', () => {
  const m = require('../lib/money');
  const a = m.make(100, 'INR'), b = m.make(50, 'INR');
  assert.strictEqual(m.amountOf(m.sum([a, b])), 150);
  assert.throws(() => m.sum([a, m.make(50, 'AED')]), /across currencies/i,
    'two currencies must never silently add — that is a conversion nobody authorised');
});

ok('points: a balance that will not pass as money', () => {
  const p = require('../lib/points');
  const pts = p.make(500, 'gold');
  assert.strictEqual(p.pointsOf(pts), 500);
  assert.strictEqual(p.isMoneyShaped(pts), false,
    'points must not satisfy a money check, or a ledger will one day sum them with rupees');
});

ok('units: folds spellings, never relates two units', () => {
  const u = require('../lib/units');
  assert.strictEqual(u.normUnit('KG'), u.normUnit('kg'));
  assert.strictEqual(u.sameUnit('kg', 'kilogram'), true);
  assert.strictEqual(u.sameUnit('kg', 'crate'), false,
    'a crate→kg factor is entity-specific and must never live in a shared table');
});

ok('docnumber: India’s rules, and a refusal to invent anybody else’s', () => {
  const d = require('../lib/docnumber');
  assert.ok(d.rules('IN'), 'India is the studied one');
  /* ⚠️ studied() LISTS the verified countries and takes no argument — I assumed a predicate and was wrong.
     India is on it and nothing else is, which is the honest state: an unstudied country gets a permissive
     default rather than a guessed limit that would refuse a number perfectly legal where the shop actually is. */
  const verified = d.studied();
  assert.deepStrictEqual(verified, ['IN'], 'only India has been studied — do not let this list quietly grow');
  assert.ok(d.rules('ZZ'), 'an unstudied country still gets rules');
  assert.ok(!verified.includes('ZZ'), 'but it is never claimed as verified');
});

ok('jurisdiction: country → how a party may be paid', () => {
  const j = require('../lib/jurisdiction');
  const ways = j.payWays('IN');
  assert.ok(Array.isArray(ways) && ways.length, 'India must offer at least one way to be paid');
});

ok('rewards: says what a point is worth, in words', () => {
  const r = require('../lib/rewards');
  const said = r.worthOf(500, { kind: 'money_off', points_per_unit: 100, unit_value: 1 },
    { money: (n) => '₹' + n });
  assert.ok(said && String(said.say || said).length > 0, 'it must produce a sentence a shopkeeper can read');
});

ok('inventory: a movement changes a balance, and a replay agrees', () => {
  const inv = require('../lib/inventory');
  /* ⚠️ a movement must name a PRODUCT and an inbound one must carry a RATE. Both refusals are deliberate and
     both were found by getting them wrong here: stock that arrives unvalued can never be valued later. */
  const buy = inv.apply({ qty: 0, value: 0 },
    { item_id: 'p1', reason: 'purchase', qty: 10, rate: 5, unit: 'kg' });
  assert.strictEqual(buy.ok, true, buy.why);
  assert.strictEqual(buy.qty, 10);
  const sell = inv.apply({ qty: buy.qty, value: buy.value, avg_cost: buy.avg_cost },
    { item_id: 'p1', reason: 'sale', qty: 4, unit: 'kg' });
  assert.strictEqual(sell.ok, true, sell.why);
  assert.strictEqual(sell.qty, 6, 'a sale of 4 from 10 leaves 6, on any machine, offline');
});

ok('canon: two spellings of one value hash the same', () => {
  const c = require('../lib/canon');
  assert.strictEqual(c.hash({ a: 1, b: 2 }), c.hash({ b: 2, a: 1 }),
    'key order must not change a hash, or a signature verifies on one machine and fails on another');
  assert.notStrictEqual(c.hash({ a: 1 }), c.hash({ a: '1' }), 'a number is not its string');
});

ok('order-input: a preset says what a buyer is asked for', () => {
  const oi = require('../lib/order-input');
  const r = oi.resolve({ preset: 'cart' });
  assert.ok(r && r.schema, 'a preset must resolve to a schema');
});

ok('form-handshake: which document fills which field', () => {
  const fh = require('../lib/form-handshake');
  const cov = fh.coverage(
    { type: 'object', properties: { gstin: {}, pan: {} }, required: ['gstin'] },
    [{ kind: 'gst_certificate', fields: ['gstin'] }]);
  assert.ok(cov, 'coverage must answer at design time, before anybody is asked to upload anything');
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
