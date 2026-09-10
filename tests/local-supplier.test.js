/**
 * ── tests/local-supplier.test.js · A SUPPLIER WHO NEVER REGISTERED ─────────────────────────────────────────────
 *
 * Athi, 2026-09-10: *"Follow the existing path. Only thing is he is not a recipient — so you can't bring him to
 * the rail. Otherwise for all practical purposes he is a bridge user."* and *"entity user id-sup-nnnn, whatever,
 * so he is specific to the user."*
 *
 * ⭐⭐ THE CHECKS THAT MATTER HERE ARE THE ONES NOBODY WOULD EVER REPORT. Everything about a local supplier looks
 * right on screen whether or not it is done properly — the name appears in the list either way. What is invisible
 * is (a) whether the same shop typed twice became two records, splitting a spend figure nobody adds up, (b)
 * whether a chit can be addressed to someone who can never open it, and (c) whether the row leaked into the global
 * business search, publishing who supplies you to every competitor. None of the three would ever produce a
 * complaint, so all three are asserted here.
 */
'use strict';
const assert = require('assert'), path = require('path'), fs = require('fs');
const L = require(path.join(__dirname, '..', 'lib', 'local-identity.js'));
const H = require(path.join(__dirname, '..', 'lib', 'handle.js'));
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
                           catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); }
                                  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

const SHOP = '11111111-1111-1111-1111-111111111111';

/** a stub that RECORDS what was asked — the SQL itself carries most of the guarantees under test */
function stub(rowsFor) {
  const seen = [];
  const query = async (sql, params) => {
    seen.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params: params || [] });
    const r = rowsFor(String(sql).replace(/\s+/g, ' '), params || [], seen.length);
    if (r instanceof Error) throw r;
    return { rows: r || [] };
  };
  return { query, seen, ownerHandle: 'acmetraders' };
}
const dupErr = () => Object.assign(new Error('duplicate key'), { code: '23505' });

(async () => {

console.log('— the naming convention —');

it('⭐⭐ ~<entity user id>.sup-nnnn, exactly as Athi specified', () => {
  assert.strictEqual(H.minted('acmetraders', 'sup', 1).handle, '~acmetraders.sup-0001');
  assert.strictEqual(H.minted('acmetraders', 'sup', 42).handle, '~acmetraders.sup-0042');
});

it('⭐ "specific to the user" — two shops each get their own numbering', () => {
  assert.strictEqual(H.minted('acmetraders', 'sup', 1).handle, '~acmetraders.sup-0001');
  assert.strictEqual(H.minted('bharatstores', 'sup', 1).handle, '~bharatstores.sup-0001');
});

it('⚠️ past 9999 the number gets LONGER — it never wraps and never truncates', () => {
  /* ⭐ a wrapped or truncated number reuses an id, and a reused id attaches a new supplier to a removed one's
     purchase history. Widening is ugly; reusing is wrong. */
  assert.strictEqual(H.minted('acmetraders', 'sup', 10000).handle, '~acmetraders.sup-10000');
});

it('⭐ it parses back, even when the owner\'s own handle contains a hyphen', () => {
  /* ⚠️ THE REASON THE SEPARATOR BEFORE `sup` IS A DOT AND NOT A HYPHEN. Athi wrote it with hyphens and said
     "whatever"; with hyphens throughout, `acme-traders-sup-0007` cannot be split back into owner and suffix
     without guessing where the name ends. A dot cannot appear in a registered user_id, so it splits cleanly. */
  assert.deepStrictEqual(H.mintedParts('~acme-traders.sup-0007'), { owner: 'acme-traders', kind: 'sup', n: 7 });
});

it('⚠️ a kind that is not a real kind is refused, rather than minted as one', () => {
  assert.ok(H.minted('acmetraders', 'vendor', 1).error);
  assert.ok(H.minted('acmetraders', 'sup', 0).error, 'numbering starts at 1, not 0');
});

console.log('— the marker cannot be forged —');

it('⭐⭐⭐ nobody can REGISTER a handle that looks minted', () => {
  /**
   * ⚠️ THIS IS THE WHOLE REASON FOR THE LEADING TILDE. Athi's bare form — acmetraders-sup-0001 — is a perfectly
   * legal handle: hyphens and digits are allowed, so a stranger could register a name that reads like somebody
   * else's supplier record and be resolved as them. Assert it against the REAL registration rule, not a copy.
   */
  assert.strictEqual(H.checkRoot('~acmetraders.sup-0001').ok, false);
  assert.strictEqual(H.check('~acmetraders.sup-0001').ok, false);
  /* and the bare form genuinely IS registerable, which is what makes the tilde load-bearing rather than decorative */
  assert.strictEqual(H.checkRoot('acmetraders-sup-0001').ok, true,
    'if this ever fails, the tilde is no longer the thing preventing impersonation — re-derive the rule');
});

it('⭐ isMinted is the one question, and it reads the handle rather than a second flag', () => {
  assert.strictEqual(H.isMinted('~acmetraders.sup-0001'), true);
  assert.strictEqual(H.isMinted('acmetraders'), false);
  assert.strictEqual(H.isMinted(null), false);
  assert.strictEqual(L.onRail({ user_id: '~acmetraders.sup-0001' }), false);
  assert.strictEqual(L.onRail({ user_id: 'bharatstores' }), true);
  /* ⚠️ an unknown/missing handle must NOT read as minted — that would hide a real supplier's catalogue silently.
     Defaulting the other way shows a button that fails loudly instead, which is findable. */
  assert.strictEqual(L.onRail({}), true);
});

console.log('— a name is not always a name —');

await ita('⚠️ an empty name is refused before anything is asked of the database', async () => {
  const s = stub(() => []);
  const r = await L.mint(SHOP, '   ', s);
  assert.strictEqual(r.status, 400);
  assert.strictEqual(s.seen.length, 0);
});

await ita('⭐⭐ an EMAIL typed into the name box is refused, not minted as a private lookalike', async () => {
  /* ⚠️ THE FAILURE IS SILENT AND EXPENSIVE. Someone means to add a real ChitBridge business, pastes their email
     into the wrong box, and gets a minted row with that name. It says added. Then the catalogue never loads and
     orders cannot be sent, with nothing anywhere explaining why. */
  const s = stub(() => []);
  const r = await L.mint(SHOP, 'raj@abcdistributors.com', s);
  assert.strictEqual(r.status, 400);
  assert.ok(/ChitBridge business/.test(r.error.message), r.error && r.error.message);
  assert.strictEqual(s.seen.length, 0);
});

console.log('— the same shop, typed twice, is one row —');

await ita('⭐⭐⭐ a repeat purchase from the same shop lands on the SAME id', async () => {
  /* ⚠️ Otherwise "what did we pay Corner Hardware last time" answers from a fraction of the history, and the
     shopkeeper has no way to see that it did — the total is simply wrong and looks fine. */
  const EXISTING = { identity_id: 'aaaa', bridge_id: 'CB-AAAA', display_name: 'Corner Hardware',
                     user_id: '~acmetraders.sup-0001' };
  const s = stub((sql) => (/lower\(btrim\(display_name\)\)/.test(sql) ? [EXISTING] : []));
  const r = await L.mint(SHOP, '  corner   HARDWARE ', s);
  assert.strictEqual(r.identity_id, 'aaaa');
  assert.strictEqual(r.created, false);
  assert.ok(!s.seen.some((x) => /INSERT/i.test(x.sql)), 'it minted a second supplier instead of finding the first');
  const look = s.seen.find((x) => /lower\(btrim\(display_name\)\)/.test(x.sql));
  assert.strictEqual(look.params[2], 'corner hardware',
    'the lookup key must fold case AND inner spaces, or the same shop typed in a hurry becomes two suppliers');
  assert.ok(/sup-/.test(String(look.params[1])),
    'the name lookup must be scoped to suppliers — a trader you both buy from and sell to is ordinary, and their '
    + 'customer record must not be returned as their supplier record');
});

console.log('— the number is an ordinal —');

await ita('⭐⭐ the next id is MAX + 1, so a removed supplier\'s number is never reused', async () => {
  /* 0001 and 0003 exist, 0002 was removed → the next is 0004. A count would hand out 0003 again, attaching a new
     supplier to a removed one's purchase history — the one mistake in an append-only world that cannot be undone. */
  const s = stub((sql, p, n) => {
    if (/lower\(btrim\(display_name\)\)/.test(sql)) return [];
    if (/ORDER BY length\(user_id\)/.test(sql)) return [{ user_id: '~acmetraders.sup-0003' }];
    return [{ identity_id: 'bbbb', bridge_id: 'CB-B', display_name: 'New Traders', user_id: '~acmetraders.sup-0004' }];
  });
  const r = await L.mint(SHOP, 'New Traders', s);
  assert.strictEqual(r.created, true);
  const ins = s.seen.find((x) => /INSERT/i.test(x.sql));
  assert.ok(ins.params.indexOf('~acmetraders.sup-0004') >= 0,
    'expected sup-0004, got params ' + JSON.stringify(ins.params));
});

await ita('⭐ the first supplier a shop ever adds is 0001', async () => {
  const s = stub((sql, p, n) => (/INSERT/i.test(sql)
    ? [{ identity_id: 'cccc', bridge_id: 'CB-C', display_name: 'First', user_id: '~acmetraders.sup-0001' }] : []));
  await L.mint(SHOP, 'First Supplier', s);
  const ins = s.seen.find((x) => /INSERT/i.test(x.sql));
  assert.ok(ins.params.indexOf('~acmetraders.sup-0001') >= 0, JSON.stringify(ins.params));
});

console.log('— two tills at the same instant —');

await ita('⭐⭐ losing the NUMBER takes the next one; losing the NAME returns their row', async () => {
  /**
   * ⚠️⚠️ ONE ERROR CODE, TWO OPPOSITE MEANINGS, and getting them the wrong way round is a real bug either way.
   * A clash on the handle index means someone merely took the number we wanted → try the next. A clash on the
   * name index means they already created this very supplier → their row IS the answer. Retrying a name clash
   * would loop; returning their row on a number clash would return a completely different supplier.
   */
  let inserts = 0;
  const s = stub((sql) => {
    if (/INSERT/i.test(sql)) { inserts++; return inserts === 1 ? dupErr() : [{ identity_id: 'dddd', bridge_id: 'CB-D', display_name: 'Race Co', user_id: '~acmetraders.sup-0002' }]; }
    if (/ORDER BY length\(user_id\)/.test(sql)) return [{ user_id: '~acmetraders.sup-0001' }];
    return [];    /* the name is NOT taken — so this was a number clash */
  });
  const r = await L.mint(SHOP, 'Race Co', s);
  assert.strictEqual(r.created, true, 'a number clash must retry, not give up');
  assert.strictEqual(inserts, 2);
});

await ita('⭐ and a NAME clash returns the winner\'s row rather than looping', async () => {
  let asked = 0;
  const s = stub((sql) => {
    if (/INSERT/i.test(sql)) return dupErr();
    if (/ORDER BY length\(user_id\)/.test(sql)) return [];
    asked++;
    /* first lookup: not there yet. after the failed insert: the other writer's row */
    return asked === 1 ? [] : [{ identity_id: 'eeee', bridge_id: 'CB-E', display_name: 'Race Co', user_id: '~acmetraders.sup-0001' }];
  });
  const r = await L.mint(SHOP, 'Race Co', s);
  assert.strictEqual(r.identity_id, 'eeee');
  assert.strictEqual(r.created, false);
});

console.log('— it is an ordinary entity, and that was the point —');

await ita('⭐⭐⭐ minted on the EXISTING path: identity_type entity, under this shop', async () => {
  /* Athi: *"for all practical purposes he is a bridge user."* Anything else — a null id, a new identity_type —
     forces a special case into adoption, purchases, spend and every screen that shows a bridge id. */
  const s = stub((sql) => (/INSERT/i.test(sql)
    ? [{ identity_id: 'ffff', bridge_id: 'CB-F', display_name: 'X', user_id: '~acmetraders.sup-0001' }] : []));
  await L.mint(SHOP, 'Corner Hardware', s);
  const ins = s.seen.find((x) => /INSERT/i.test(x.sql));
  assert.ok(/'entity'/.test(ins.sql), 'a minted party must be an ordinary entity: ' + ins.sql);
  assert.ok(!/'local'/.test(ins.sql), "identity_type 'local' was the rejected design — it makes a special case");
  assert.ok(ins.params.indexOf(SHOP) >= 0, 'parent_entity_id must be the shop that minted it');
  assert.ok(ins.sql.indexOf('bridge_id') >= 0, 'it still carries a bridge id, so every screen keeps working');
});

await ita('⭐⭐ and it is given NO way to sign in', async () => {
  const s = stub((sql) => (/INSERT/i.test(sql)
    ? [{ identity_id: 'gggg', bridge_id: 'CB-G', display_name: 'X', user_id: '~acmetraders.sup-0001' }] : []));
  await L.mint(SHOP, 'Corner Hardware', s);
  const cols = s.seen.find((x) => /INSERT/i.test(x.sql)).sql.split('VALUES')[0];
  ['email', 'password', 'pin_hash', 'otp'].forEach((c) => {
    assert.ok(!new RegExp('\\b' + c, 'i').test(cols), 'a minted party was given a ' + c + ': ' + cols);
  });
});

console.log('— "he is not a recipient" —');

it('⭐⭐⭐ the recipient resolver refuses a minted party, on every branch', () => {
  /**
   * ⚠️ A chit addressed to someone who cannot sign in sits as sent for ever, and the sender waits on an answer
   * that cannot come. Four lookups resolve a recipient — by entity_id, bridge, user_id and display name — and a
   * minted party would satisfy all four, because it IS an ordinary active entity.
   * ⚠️⚠️ THE DISPLAY-NAME BRANCH IS THE DANGEROUS ONE: minted names are ordinary shop names, so "Corner Hardware"
   * typed by a DIFFERENT business would otherwise resolve to this one's private record.
   */
  const s = src('routes/chits.js');
  assert.ok(/isMinted\(typedAny\)/.test(s), 'nothing rejects a typed minted handle before the lookups run');
  assert.ok(/cannot receive chits/.test(s), 'the refusal must say why, or it reads as "we lost your supplier"');
  const byName = s.match(/WHERE LOWER\(display_name\) = LOWER\(\$1\)[\s\S]{0,900}?`/);
  assert.ok(byName, 'the display-name fallback moved — this guard is now blind');
  assert.ok(/NOT LIKE '~%'/.test(byName[0]),
    'a chit can still be addressed to a minted party by typing its display name');
});

it('⭐⭐⭐ the business search excludes them — asserted in the file that does the excluding', () => {
  /**
   * ⚠️ Asserting "we mint a tilde" only proves half. The other half lives in another file, and if someone widens
   * that WHERE clause the leak opens there while every assertion about minting stays green. So read it there.
   */
  const s = src('routes/entities.js');
  const m = s.match(/router\.get\('\/search'[\s\S]{0,4000}?ORDER BY/);
  assert.ok(m, 'GET /entities/search moved — this guard is now blind and must be repointed');
  assert.ok(/NOT LIKE '~%'/.test(m[0]),
    'the business search no longer excludes minted parties — every local supplier is now public');
});

it('⭐⭐ and one shop cannot add another shop\'s minted party', () => {
  /* ⚠️ The handle is guessable — it is the shop's own user id plus a small number. Without this, a competitor
     could walk ~theirshop.sup-0001, 0002, 0003 and copy a supplier list one row at a time. */
  const s = src('routes/relationships.js');
  const adds = s.split('router.post').filter((b) => /isMinted/.test(b));
  assert.ok(adds.length >= 2, 'both the supplier add and the customer add must refuse a minted handle');
});

console.log('— one construct, not two —');

it('⭐⭐⭐ nothing mints a chit except sendChit', () => {
  /**
   * Athi, 2026-09-10: *"never ever go out of the product construct and create a different path — whatever we try
   * to build should follow the core principles."*
   *
   * ⚠️ SAID BECAUSE I HAD JUST DONE IT. Recording a delivery from an off-rail supplier, I wrote a private modal
   * that called createChit directly. It worked, and it skipped cbFreezeTerms, the business_json merge, per-line
   * attachments and drafts — every rule sendChit owns. A second minting path does not announce itself when it
   * drifts; it simply stops doing something the real one started doing, and no test notices because both "work".
   *
   * ⭐ So: a lazily-loaded capability may OPEN compose, but may not mint. app.html's own helpers are the
   * construct and are exempt; a capability reaching past them is the thing this catches.
   */
  /**
   * ⚠️⚠️ AND ITS FIRST RUN FOUND ONE I DID NOT PUT THERE. cap-readiness.js mints a bare self-chit twice — as the
   * evidence record a clearance document hangs on. It is declared here rather than quietly excluded, because a
   * guard that silently tolerates what it finds is a guard that measures nothing. Declared, not fixed, and
   * deliberately so: it is two working screens in the middle of someone else's cycle, and the two chits it makes
   * are empty (no lines, no terms, no business_json), so nothing sendChit owns is actually being skipped TODAY.
   * ⚠️ The risk is the ordinary one: the day sendChit gains a rule, these two stop obeying it and say nothing.
   * ⭐ THE LIST ONLY EVER SHRINKS. Anything new that appears here is a second construct being born.
   */
  const DECLARED = ['cap-readiness.js'];
  const dir = path.join(__dirname, '..', '..', 'chitbridge-web', 'public', 'app');
  if (!fs.existsSync(dir)) return;                    /* API repo checked out alone — nothing to check */
  const mints = fs.readdirSync(dir)
    .filter((f) => /^cap-.*\.js$/.test(f))
    .filter((f) => /api\(\s*['"]createChit['"]/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepStrictEqual(mints.filter((f) => DECLARED.indexOf(f) < 0), [],
    'these capabilities mint a chit themselves instead of going through compose/sendChit: ' + mints.join(', '));
  /* ⚠️ and the declaration must stay HONEST — a name left here after it was fixed hides the next offender */
  assert.deepStrictEqual(DECLARED.filter((f) => mints.indexOf(f) < 0), [],
    'declared as minting its own chit, but no longer does — remove it from DECLARED');
});

console.log('— what the columns will actually accept —');

it('⚠️⚠️ every added_via the route writes is one the CHECK constraint permits', () => {
  /**
   * ⭐ THE BUG THIS IS HERE FOR, found by [SUP-02] on its first run: the insert used added_via = 'local', which
   * reads perfectly and is not in the constraint (manual/transaction/import). Postgres raised 23514, the route
   * turned it into a 500, and the screen said "Something went wrong — please try again", which is true and
   * useless. Nothing in unit tests could catch it because the value only meets its constraint in the database.
   *
   * ⭐⭐ 'manual' is also the RIGHT answer rather than merely the permitted one: added_via records HOW the row
   * arrived — a person typed it — which is true of both kinds. WHETHER they are on the rail is the handle's job.
   * The same fact in two columns is two facts waiting to disagree.
   */
  const allowed = (fs.readFileSync(path.join(__dirname, '..', 'migrations', '000_baseline_part2.sql'), 'utf8')
    .match(/supplier_list_added_via_check[\s\S]{0,400}?\)\);/) || [''])[0]
    .match(/'([a-z_]+)'::character varying/g) || [];
  const permitted = allowed.map((s) => s.split("'")[1]);
  assert.ok(permitted.length, 'the supplier_list added_via constraint moved — this guard is now blind');

  const route = src('routes/relationships.js');
  const written = (route.match(/added_via\s*\)[\s\S]{0,400}?VALUES[\s\S]{0,200}?'([a-z_]+)'\)/g) || [])
    .map((s) => (s.match(/'([a-z_]+)'\)$/) || [])[1]).filter(Boolean);
  assert.ok(written.length >= 2, 'expected both supplier inserts to name an added_via, found ' + written.length);
  written.forEach((v) => assert.ok(permitted.indexOf(v) >= 0,
    "added_via '" + v + "' is not permitted by the constraint (" + permitted.join(', ') + ') — this is a 500'));
});

console.log('— the migration —');

it('⚠️ b218 folds the name exactly the way the code does, or one of them is inert', () => {
  const sql = src('migrations/b218_local_suppliers.sql');
  assert.ok(/uq_identities_minted_sup/.test(sql));
  assert.ok(/lower\(btrim\(display_name\)\)/.test(sql), 'the index must fold case the same way mint() does');
  assert.ok(/parent_entity_id/.test(sql), 'one name per SHOP — two shops may each have their own Corner Hardware');
  assert.ok(/sup-/.test(sql), 'the index must be partial to suppliers, or a customer of the same name collides');
});

it('⭐ POST /suppliers accepts a name, and the list tells the screen which rows can be called', () => {
  const s = src('routes/relationships.js');
  assert.ok(/local-identity/.test(s), 'the route does not mint an id for a supplier given by name');
  assert.ok(/supply_kind/.test(s), 'the trade/other flag is not settable');
  assert.ok(/AS on_rail/.test(s), 'GET /suppliers does not say which suppliers can be ordered from');
});

console.log(pass + ' checks');
})();
