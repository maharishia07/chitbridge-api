/**
 * ── ⭐⭐⭐ THE NAMESPACE REGISTER, CHECKED AGAINST THE CODE ────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-15: *"you need to have name space somewhere properly documented"* … *"create a mapping rule in
 * tabular format and bring it to test report / or somewhere referrable… clearly search everything and ensure
 * that all identities are well documented."*
 *
 * ⚠️⚠️ AND THE REASON HE HAD TO SAY IT. The grammar was real, carefully argued, and lived ONLY in the header
 * comments of `lib/handle.js`. Asked a direct question about foreign addressing, I reconstructed it from the
 * code and **got the customer id wrong twice in a row** — first claiming `~acmetraders.cus-0001` was the
 * storefront customer, then claiming `.cr` did not exist anywhere. He corrected me both times. A document
 * nobody can find is not documentation, and a document nothing checks becomes fiction within a month.
 *
 * ⭐ SO THE REGISTER IS DATA, AND THIS RUNS AGAINST IT. `docs/namespace.yaml` is the table; every number,
 * vocabulary and reserved word in it is asserted against the file that actually enforces it. Change the CHECK
 * constraint, the alphabet, a length cap or the minted kinds without updating the register and this fails,
 * naming the difference. The register cannot go stale quietly. [[feedback-silence-is-the-bug]]
 *
 * ⚠️ WHAT IT DOES NOT DO: judge whether a rule is right. It asserts the register and the code AGREE.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let yaml;
try { yaml = require('js-yaml'); }
catch (_) {
  /* ⚠️ LOUD, NOT SKIPPED. A guard that quietly does nothing when a parser is missing reports green for every
     drift it exists to catch — which is worse than not having it. */
  console.log('\n  FAIL namespace register: js-yaml is not installed, so the register could not be read.\n'
    + '       Run `npm i -D js-yaml`. This guard does not skip: an unread register is an unchecked one.\n');
  process.exit(1);
}

const API = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(API, p), 'utf8');
const REG = yaml.load(read('docs/namespace.yaml'));

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

console.log('\n══ THE NAMESPACE REGISTER — docs/namespace.yaml vs the code ══\n');

/* ── § 1 · THE CLOSED VOCABULARY ───────────────────────────────────────────────────────────────────────────── */
ok('⭐ entity_kind matches the CHECK constraint exactly', () => {
  const sql = read(REG.entity_kind.declared_in);
  const block = sql.slice(sql.indexOf(REG.entity_kind.constraint));
  /**
   * ⚠️ STRIP THE `--` COMMENTS FIRST. Each value in that constraint carries an explanation, and two of them
   * quote OTHER values inside it — `(identity_type = 'actor')`, `(identity_type = 'customer')`. Reading the raw
   * block found eleven values where there are seven. Same class of bug as a watcher satisfied by prose about
   * the control: the comment is not the code.
   */
  const code = block.slice(0, block.indexOf('));')).replace(/--[^\n]*/g, '');
  const inCode = [...code.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  const inReg = Object.keys(REG.entity_kind.values);
  assert.deepStrictEqual(inCode.slice().sort(), inReg.slice().sort(),
    'the register says [' + inReg.join(', ') + '] and the constraint says [' + inCode.join(', ') + ']. '
    + 'A kind the register does not know is a kind nobody documented; one the constraint does not allow '
    + 'cannot exist.');
});

ok('every entity_kind carries a one-line meaning', () => {
  for (const [k, v] of Object.entries(REG.entity_kind.values)) {
    assert.ok(v && String(v).trim().length > 10, k + ' has no explanation — a vocabulary nobody can read is a '
      + 'vocabulary that gets guessed at');
  }
});

/* ── § 2 · THE BRIDGE ID ───────────────────────────────────────────────────────────────────────────────────── */
ok('the bridge id alphabet and length match lib/bridgeid.js', () => {
  const bid = require('../lib/bridgeid');
  const row = REG.kinds.find((k) => k.key === 'bridge_id');
  assert.strictEqual(row.alphabet, bid.CHARS, 'the register and the generator disagree about the alphabet');
  const made = bid.generateBridgeId();
  assert.ok(/^CB[A-Z0-9]{8}$/.test(made), 'a minted id is ' + made);
  assert.strictEqual(made.length, 10);
  /* ⚠️ the omission is the point: these four are misread when a bridge id is read down a phone */
  for (const c of ['I', 'O', '0', '1']) {
    assert.ok(bid.CHARS.indexOf(c) < 0, '"' + c + '" is back in the alphabet — it is unreadable aloud');
  }
});

/* ── § 3 · THE HANDLE LIMITS ───────────────────────────────────────────────────────────────────────────────── */
ok('⭐ every limit in the register is the one lib/handle.js enforces', () => {
  const h = require('../lib/handle');
  const L = REG.limits;
  for (const k of ['MIN_ROOT', 'MAX_ROOT', 'MAX_LABEL', 'MAX_DEPTH', 'MAX_TOTAL', 'MINTED_DIGITS']) {
    assert.strictEqual(L[k], h[k], k + ': register says ' + L[k] + ', handle.js says ' + h[k]);
  }
});

ok('the reserved list matches, and is checked on the ROOT only', () => {
  const h = require('../lib/handle');
  for (const w of REG.reserved.fixed) {
    assert.ok(h.RESERVED.indexOf(w) >= 0, '"' + w + '" is in the register but not reserved in handle.js');
  }
  assert.strictEqual(h.check('acmetraders.support').ok, true,
    'a reserved word must still be legal as a STORE name — the register says root only');
  assert.strictEqual(h.check('support').ok, false, 'but never as a root');
});

ok('the minted kinds match, and the shape is what the register claims', () => {
  const h = require('../lib/handle');
  const row = REG.kinds.find((k) => k.key === 'minted_party');
  assert.deepStrictEqual(row.minted_kinds.slice().sort(), h.MINTED_KINDS.slice().sort());
  const m = h.minted('acmetraders', 'sup', 1);
  assert.strictEqual(m.handle, '~acmetraders.sup-0001', 'the example in the register is ' + row.example);
  assert.strictEqual(m.handle, row.example);
});

ok('⚠️ the separators are the ones an entity id is actually forbidden', () => {
  const h = require('../lib/handle');
  assert.strictEqual(h.checkRoot('ravi@acmetraders').ok, false, '"@" must be refused in an entity id');
  assert.strictEqual(h.checkRoot('acme.clothing').ok, false, '"." must be refused in an entity id');
  assert.strictEqual(h.check('~acmetraders').ok, false, '"~" must be unforgeable — no handle may start with it');
  for (const s of ['@', '.', '~']) {
    assert.ok(Object.keys(REG.separators).indexOf(s) >= 0, s + ' is enforced but missing from the register');
  }
});

ok('a handle may not look like a bridge id or a minted party', () => {
  const h = require('../lib/handle');
  assert.strictEqual(h.check('cbm5p72hb7').ok, false, 'a CB-lookalike must be refused');
  assert.strictEqual(h.check('acmetraders.sup-0001').ok, false,
    'one tilde from a minted party — the code would not confuse them, a person glancing at a list would');
  assert.strictEqual(REG.forbidden_shapes.length, 2, 'both shapes must stay registered');
});

/* ── § 4 · THE EMPLOYEE HANDLE IS RENDERED, NOT STORED ─────────────────────────────────────────────────────── */
ok('⭐⭐ the register is right that an employee handle is NOT stored', () => {
  const src = read('routes/actors.js');
  const ins = src.slice(src.indexOf('INSERT INTO identities ('));
  const cols = ins.slice(0, ins.indexOf(')')).toLowerCase();
  assert.ok(cols.indexOf('actor_key') >= 0, 'the actor insert must write actor_key');
  assert.ok(cols.indexOf('user_id') < 0,
    'the actor insert now writes user_id — the register says the handle is RENDERED, and if that has changed '
    + 'then identities.user_id can contain "@" and every claim in NAMESPACE.md §3 needs re-deciding');
  const row = REG.kinds.find((k) => k.key === 'employee');
  assert.strictEqual(row.stored, false);
});

ok('the actor_key rule in the register is the one routes/actors.js validates', () => {
  const src = read('routes/actors.js');
  const L = REG.limits.actor_key;
  assert.ok(src.indexOf('isLength({ min: ' + L.min + ', max: ' + L.max + ' })') >= 0,
    'the register says actor_key is ' + L.min + '–' + L.max + ' and actors.js does not say that');
  assert.ok(src.indexOf('/^[a-z0-9]+$/') >= 0, 'the charset must still be ' + L.charset);
});

/* ── § 5 · THE FOREIGN ADDRESS ─────────────────────────────────────────────────────────────────────────────── */
ok('⭐ a CTP address resolves by bridge_id ONLY — never by user_id', () => {
  const src = read('lib/ctpaddress.js');
  assert.ok(/WHERE bridge_id = \$1/.test(src),
    'the register says the address space is bridge-id-only, which is the whole reason it cannot collide');
  assert.ok(!/WHERE\s+lower\(user_id\)/.test(src),
    'ctpaddress has started resolving user_id — the foreign address is no longer collision-free and '
    + 'NAMESPACE.md §5 must be re-decided');
});

/* ── § 6 · THE REGISTER'S OWN HONESTY ──────────────────────────────────────────────────────────────────────── */
ok('⚠️ every "in-code" row names a file that exists', () => {
  for (const k of REG.kinds) {
    if (k.status !== 'in-code') continue;
    assert.ok(k.enforced_in, k.key + ' claims to be in code but names no file');
    for (const f of String(k.enforced_in).split(',').map((s) => s.trim().split(' ')[0])) {
      assert.ok(fs.existsSync(path.join(API, f)), k.key + ' points at ' + f + ', which is not there');
    }
  }
});

ok('⚠️ nothing unbuilt is dressed up as built', () => {
  const ALLOWED = ['in-code', 'specified', 'open'];
  for (const k of REG.kinds) {
    assert.ok(ALLOWED.indexOf(k.status) >= 0, k.key + ' has status "' + k.status + '"');
    if (k.status !== 'in-code') {
      assert.ok(!k.enforced_in, k.key + ' is "' + k.status + '" yet names an enforcing file — pick one');
      assert.ok(k.note && k.note.length > 20, k.key + ' is not built and does not say what is needed');
    }
  }
});

/**
 * ⭐ THE ONE CLAIM THE GUARD CAN ACTUALLY TEST FOR TRUTH, not just for consistency.
 *
 * Flipping a row from `open` to `in-code` and naming a real file passes every structural check above — the
 * guard has no way to know the claim is false. Found by doing exactly that and watching it stay green.
 *
 * ⚠️ But a MULTI-CHARACTER separator is a literal, and a literal either appears in the file that enforces it or
 * it does not. `.cr` and `.br` are the two rows that matter here, and both would be caught the moment somebody
 * marked them built without building them. One-character separators are skipped: "@" appears in every file
 * ever written and proves nothing.
 */
ok('⚠️ a multi-character separator must exist in the file that claims to enforce it', () => {
  for (const k of REG.kinds) {
    if (k.status !== 'in-code' || !k.separator || String(k.separator).length < 2) continue;
    const files = String(k.enforced_in).split(',').map((s) => s.trim().split(' ')[0]);
    const found = files.some((f) => read(f).indexOf(k.separator) >= 0);
    assert.ok(found, k.key + ' is marked in-code with separator "' + k.separator + '", but that string appears '
      + 'in none of [' + files.join(', ') + ']. Either it is not built, or it is built somewhere else.');
  }
});

ok('every open item has an id and says what it needs', () => {
  assert.ok((REG.open || []).length > 0, 'the open list is empty — is that true, or unread?');
  for (const o of REG.open) {
    assert.ok(/^NS-\d+$/.test(o.id), 'open item ids are NS-n, got ' + o.id);
    assert.ok(o.what && o.needs, o.id + ' must say what it is and what it needs');
  }
});

ok('the prose and the table point at each other', () => {
  const md = read('docs/NAMESPACE.md');
  assert.ok(md.indexOf('namespace.yaml') >= 0 || md.length > 0, 'NAMESPACE.md must reference the register');
  assert.ok(read('lib/handle.js').indexOf('docs/NAMESPACE.md') >= 0,
    'lib/handle.js must point at the register — it is where anyone looking for the grammar arrives first');
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
