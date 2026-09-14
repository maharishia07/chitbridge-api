'use strict';
/**
 * ── tests/board-kinds.test.cjs · THE SHARED BOARD CARRIES CASES AND NOTHING ELSE ────────────────────────────────
 *
 * Athi, 2026-09-14: *"the requirement / incident should not be seen by others, other than the platform owner,
 * which is us?"*
 *
 * ⚠️⚠️ HE ASKED BECAUSE THE ANSWER WAS NO. Every incident and requirement route pointed at
 * `testboard.entityFor()`, so setting TEST_BOARD_ENTITY — one environment variable, no deploy — would have put
 * every shop's fault report, in their own words, with their prices and a screenshot of their till, in front of
 * every signed-in user of the platform. lib/testboard.js WARNED ABOUT EXACTLY THIS in its own header on the day
 * it was written, and twenty-one routes were pointed at it anyway.
 *
 * ── ⭐⭐⭐ AND THE TRAP THAT NEARLY REPEATED IT ─────────────────────────────────────────────────────────────────
 *
 * `POST /requirements` writes `kind = 'spec'`. The word "requirement" is a DISPLAY label out of
 * teststatus.workStatus() and appears nowhere in the table. A split that trusts the route name — or the design
 * note, which got this wrong first — leaves every requirement on the shared board while believing it did not.
 *
 * ⚠️ SO THIS GUARD IS STATIC AND IT READS THE SQL, NOT THE ROUTE NAMES. It asks: for each handler that queries a
 * finding kind, which entity does that handler resolve? A test that trusted the naming would have passed
 * against the bug.
 *
 * ⭐ It also runs with the board OFF, which is how it will usually run. That is fine and deliberate: this checks
 * WHICH FUNCTION a handler calls, and that is true whether or not the env var is set. A guard that only bites
 * when the dangerous configuration is live is a guard that first bites in production.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'testing.js'), 'utf8');
const BOARD = require('../lib/testboard.js');

let pass = 0;
const it = (what, fn) => {
  try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; }
};

/** ⚠️ blanked, so a kind named in a COMMENT never counts as a query. Three guards have been tripped by their
 *  own explanatory prose; this one is written knowing that. */
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

const lines = CODE.split('\n');

/** every `router.<verb>('<path>'` with the line it starts on */
const HANDLERS = [];
lines.forEach((l, i) => {
  const m = l.match(/^router\.(get|post|patch|put|delete)\('([^']+)'/);
  if (m) HANDLERS.push({ verb: m[1].toUpperCase(), route: m[2], from: i + 1 });
});
HANDLERS.forEach((h, i) => { h.to = i + 1 < HANDLERS.length ? HANDLERS[i + 1].from - 1 : lines.length; });

const bodyOf = (h) => lines.slice(h.from - 1, h.to).join('\n');
const handlerAt = (n) => HANDLERS.find((h) => n >= h.from && n <= h.to);

console.log('— the shared board carries cases and nothing else —');

it('there are handlers to check at all (the parse works)', () => {
  assert.ok(HANDLERS.length >= 20, 'only found ' + HANDLERS.length + ' handlers — the route regex has drifted');
});

it("'spec' IS the requirement kind — the premise this guard rests on", () => {
  const post = HANDLERS.find((h) => h.verb === 'POST' && h.route === '/requirements');
  assert.ok(post, 'no POST /requirements');
  assert.ok(/VALUES\s*\(\$1,'spec'/.test(bodyOf(post)),
    "POST /requirements no longer writes kind='spec'. If the kind was renamed, update SHARED_KINDS and this "
    + 'guard together — the split is by kind, and a rename that misses one of them reopens the hole.');
});

it('testcase is the only shared kind', () => {
  assert.deepStrictEqual(BOARD.sharedKinds(), ['testcase'],
    'SHARED_KINDS changed. Adding a kind here publishes it to every signed-in user — that is a decision for '
    + 'Athi, not a refactor.');
});

/**
 * ── ⭐⭐ EVERY KIND IS CLASSIFIED ON PURPOSE, NOT BY FALLING THROUGH ─────────────────────────────────────────────
 *
 * `entityForKind()` sends any kind it does not recognise to the caller's own entity. That default is the SAFE
 * one — and a safe default is exactly how a kind comes to be private by accident instead of by decision. The
 * day somebody flips the fallback, or adds a kind to SHARED_KINDS "to make the report work", nothing here
 * would notice.
 *
 * ⚠️ DESIGN-SUPPORT-LIFECYCLE.md adds two kinds, and `release` is the trap. It faces the shop — it is the
 * record that says "the thing you reported shipped" — so sharing it onto the board looks like the point of it.
 * It must NOT be shared: a shop hears about a release through a CHIT addressed to it, not by reading a board
 * that also carries every other shop's fault reports. `change` is worse still: a diff cites file paths, and
 * file paths describe the product's internals.
 *
 * ⭐ SO THE TEST IS BEHAVIOURAL, NOT A STRING COMPARE. It loads the board WITH an entity configured — the only
 * state in which shared and private differ at all — and asserts where each kind actually resolves to. With
 * TEST_BOARD_ENTITY unset every kind resolves to the caller and a string test would pass while proving
 * nothing. [[feedback-silence-is-the-bug]]
 */
const CLASSIFIED = {
  testcase: 'shared',    /* the product's own suite — nobody's trade in it */
  spec:     'private',   /* ⚠️ the REQUIREMENT kind. See the note below: it is two things under one name. */
  incident: 'private',   /* somebody's fault report, in their words, with a screenshot */
  evidence: 'private',   /* the screenshot itself */
  change:   'private',   /* ⚠️ cites repo paths — the product's internals */
  release:  'private',   /* ⚠️ faces the shop, but through a CHIT — never through the shared board */
};

it('every kind resolves where it was classified — checked with a board actually configured', () => {
  const BOARD_ID = '00000000-0000-4000-8000-0000000000b0';
  const CALLER   = '11111111-1111-4111-8111-111111111111';
  const prev = process.env.TEST_BOARD_ENTITY;
  process.env.TEST_BOARD_ENTITY = BOARD_ID;
  delete require.cache[require.resolve('../lib/testboard.js')];
  delete require.cache[require.resolve('../lib/namedentity.js')];
  const B = require('../lib/testboard.js');
  try {
    assert.strictEqual(B.entityFor(CALLER), BOARD_ID,
      'the board did not configure — this test proves nothing unless shared and private can differ');
    for (const [kind, where] of Object.entries(CLASSIFIED)) {
      const got = B.entityForKind(kind, CALLER);
      assert.strictEqual(got, where === 'shared' ? BOARD_ID : CALLER,
        "'" + kind + "' resolved to the " + (got === BOARD_ID ? 'shared board' : "caller's own entity")
        + ' but is classified as ' + where + '. Publishing a kind to every signed-in user is a decision for '
        + 'Athi, not a refactor; hiding one that should be shared breaks the report silently.');
    }
  } finally {
    if (prev === undefined) delete process.env.TEST_BOARD_ENTITY; else process.env.TEST_BOARD_ENTITY = prev;
    delete require.cache[require.resolve('../lib/testboard.js')];
    delete require.cache[require.resolve('../lib/namedentity.js')];
  }
});

it('no kind is written into `definition` that nobody has classified', () => {
  const written = new Set();
  for (const m of CODE.matchAll(/VALUES\s*\(\s*\$1\s*,\s*'([a-z_]+)'/g)) written.add(m[1]);
  assert.ok(written.size > 0, 'found no kind literals — the INSERT shape has drifted and this guard is blind');
  for (const k of written) {
    assert.ok(Object.prototype.hasOwnProperty.call(CLASSIFIED, k),
      "routes/testing.js writes kind='" + k + "' and CLASSIFIED above does not mention it. Decide whether it "
      + 'is shared or private and say so here — the fallback would make it private without anyone choosing.');
  }
});

/**
 * ── ⚠️⚠️ `spec` IS TWO DIFFERENT THINGS, AND ONLY ONE OF THEM IS PRIVATE ────────────────────────────────────────
 *
 * Found by this guard on its first run, which is the entire argument for writing it:
 *
 *   THE PRODUCT'S OWN SPEC CLAUSES — seeded by POST /cases/seed from a file in the repo. What a case CITES.
 *   Identical for every shop on the rail, contains nobody's trade.       ⇒ belongs on the BOARD.
 *
 *   A REQUIREMENT SOMEBODY RAISED — POST /requirements. "I want the bill to show the tax split."
 *   Their words, about their business.                                    ⇒ stays with the RAISER.
 *
 * Same table, same `kind`. Splitting on kind alone cannot separate them, so /cases/seed is allowed to resolve
 * the board — but ONLY WHILE THE DISCRIMINATOR BELOW HOLDS. An exception list that merely names a file hides
 * the next bug; this one asserts the REASON, so if the reason stops being true the exception fails with it.
 */
it('the two uses of `spec` are still distinguishable — the exception below depends on it', () => {
  const seed = HANDLERS.find((h) => h.verb === 'POST' && h.route === '/cases/seed');
  const post = HANDLERS.find((h) => h.verb === 'POST' && h.route === '/requirements');
  const get  = HANDLERS.find((h) => h.verb === 'GET'  && h.route === '/requirements');
  assert.ok(seed && post && get, 'one of the three spec routes is gone');

  assert.ok(/VALUES\s*\(\$1,'spec',\$2,\$3,\$4,'live'/.test(bodyOf(seed)),
    "a seeded clause is no longer status='live'");
  assert.ok(/VALUES\s*\(\$1,'spec',\$2,\$3,\$4,'draft'/.test(bodyOf(post)),
    "a raised requirement is no longer status='draft'");
  assert.ok(/state:\s*'raised'/.test(bodyOf(post)),
    "a raised requirement no longer stamps rules.state — that is the discriminator");
  assert.ok(/rules->>'state' IS NOT NULL/.test(bodyOf(get)),
    'GET /requirements no longer filters on rules.state, so it would now list the product\'s seeded clauses '
    + 'as though a person had raised them');
});

/**
 * ⭐ THE CENTRAL ASSERTION. Find every handler whose SQL touches a finding kind, and prove it resolves its
 * entity with entityForFinding — never entityFor.
 */
it('no handler that queries spec / incident resolves the shared board', () => {
  /* ⚠️ Two entries, two different reasons. Neither is "it was failing".
     /report      reads BOTH halves deliberately and separately — it names entityFor for its case half.
     /cases/seed  writes the PRODUCT's spec clauses, not anybody's requirement — guarded by the test above. */
  const ALLOWED = new Set(['/report', '/cases/seed']);

  const offenders = [];
  lines.forEach((l, i) => {
    if (!/kind\s*(=|IN)\s*.{0,4}(spec|incident)/.test(l)) return;
    const h = handlerAt(i + 1);
    if (!h || ALLOWED.has(h.route)) return;
    const body = bodyOf(h);
    if (/testboard\.entityFor\(/.test(body) && !/testboard\.entityForFinding\(/.test(body)) {
      offenders.push('  ' + h.verb + ' ' + h.route + '  (line ' + (i + 1) + ')');
    }
  });
  assert.deepStrictEqual(offenders, [],
    'these handlers read a FINDING but resolve the shared BOARD:\n' + offenders.join('\n'));
});

it('the six finding routes each call entityForFinding', () => {
  const want = [
    ['POST',  '/requirements'], ['GET', '/requirements'], ['PATCH', '/requirements/:id'],
    ['POST',  '/incidents'],    ['GET', '/incidents'],    ['PATCH', '/incidents/:id'],
  ];
  const missing = want.filter(([v, r]) => {
    const h = HANDLERS.find((x) => x.verb === v && x.route === r);
    return !h || !/testboard\.entityForFinding\(/.test(bodyOf(h));
  }).map(([v, r]) => v + ' ' + r);
  assert.deepStrictEqual(missing, [], 'not resolving entityForFinding: ' + missing.join(', '));
});

it('a screenshot stays with the tester who took it', () => {
  const h = HANDLERS.find((x) => x.verb === 'POST' && x.route === '/evidence');
  assert.ok(h, 'no POST /evidence');
  assert.ok(/testboard\.entityForFinding\(/.test(bodyOf(h)),
    "POST /evidence resolves the board. Its own header says a test screenshot 'belongs to the tester who took "
    + "it and to nobody else' — on a shared board it is a photograph of somebody's till, published.");
});

it('cases DO still share, or the board is pointless', () => {
  const h = HANDLERS.find((x) => x.verb === 'GET' && x.route === '/cases');
  assert.ok(h && /testboard\.entityFor\(/.test(bodyOf(h)) && !/entityForFinding/.test(bodyOf(h)),
    'GET /cases no longer resolves the shared board — the product suite has gone back to per-tenant copies.');
});

/** ⭐ and prove the function actually routes, rather than trusting that it is called */
it('entityForKind sends findings home and cases to the board', () => {
  const BID = '11111111-2222-3333-4444-555555555555';
  const old = process.env.TEST_BOARD_ENTITY;
  process.env.TEST_BOARD_ENTITY = BID;
  delete require.cache[require.resolve('../lib/testboard.js')];
  const on = require('../lib/testboard.js');
  try {
    assert.strictEqual(on.entityForKind('testcase', 'me'), BID, 'a case should reach the board');
    for (const k of ['spec', 'incident', 'requirement', 'evidence', 'anything-new']) {
      assert.strictEqual(on.entityForKind(k, 'me'), 'me', k + ' must stay with the caller');
    }
  } finally {
    if (old === undefined) delete process.env.TEST_BOARD_ENTITY; else process.env.TEST_BOARD_ENTITY = old;
    delete require.cache[require.resolve('../lib/testboard.js')];
  }
});

/** ⚠️ the default matters more than the list: an unknown kind must be PRIVATE, not shared */
it('a kind nobody has thought of yet defaults to private', () => {
  assert.strictEqual(BOARD.entityForKind('some-future-kind', 'me'), 'me',
    'an unrecognised kind resolved to the board. The default must fail closed.');
});

console.log('  ' + pass + ' checks');
