/**
 * ── tests/route-auth.test.js · EVERY MUTATING ROUTE IS GUARDED, OR DECLARED PUBLIC ───────────────────────────
 *
 * Athi, 2026-09-11: *"we have to write test cases for each of the security functionality checked or to be
 * checked, vulnerability…"* — and then, correcting me: *"I meant pen testing only, not market penetration."*
 *
 * ⚠️⚠️ THERE IS NO SECURITY TESTING ON THIS PLATFORM. `scripts/penetration.js` is MARKET penetration — a brand's
 * aggregate heatmap — and the name is the only thing security about it. This file is the first piece.
 *
 * ⭐⭐⭐ IT ASKS THE ONE QUESTION A STATIC PASS CAN ANSWER HONESTLY: does every route that CHANGES something
 * either require a credential, or appear on a list where somebody wrote down why it does not? That is the same
 * declare-or-it-is-a-gap pattern the engine boundary and the query-shape budget already use, and it works for the
 * same reason — the list is short, the reasons are readable, and a NEW hole cannot be added quietly.
 *
 * ⚠️ WHAT THIS CANNOT DO, SAID SO NOBODY MISTAKES IT FOR MORE. It reads source. It cannot try an injection, forge
 * a token, exhaust a rate limit or find a logic flaw that lets one shop read another's chits. Those need a
 * running system and are on the backlog (`BACKLOG-nonfunctional.md`). A green run here means "nothing is
 * unguarded by accident", not "the platform is secure".
 *
 * ⚠️ AND IT TOOK THREE ATTEMPTS TO MEASURE HONESTLY. A naive line scan said 38 routes were unguarded; widening
 * the window said 23; scanning to the actual handler said 22 — because POST /send carries 1331 characters of
 * validators before `auth` appears. Each earlier number would have been published as a finding about the product
 * when it was a finding about the scan.
 *
 * Run: node tests/route-auth.test.js   · no network, no DB.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');

const ROUTES = path.join(__dirname, '..', 'routes');
let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

/** anything that establishes WHO is calling — including the ones that do it inside the handler */
const GUARDS = /\bauth\b|customerAuth|requireScope|\badmin\b|X-Bridge-Key|softIdentity|verifySignature|hmac|signature/i;

/**
 * ⭐⭐ DECLARED PUBLIC — each with the reason it must be reachable without a credential.
 *
 * ⚠️ A route on this list is NOT thereby safe. It is thereby DECIDED. The list exists so that adding a public
 * mutating route is a deliberate act somebody has to write a sentence for, rather than a line nobody notices.
 */
const PUBLIC = {
  'actors POST /login': 'signing in — a credential cannot be required to obtain one',
  'entities POST /register': 'registration — the same',
  'entities POST /verify': 'the one-time code that completes registration',
  'catalogue POST /:bridge_id/login/verify': 'a customer proving a phone number at a storefront',
  'catalogue POST /:bridge_id/order/start': 'a walk-in ordering from a public storefront',
  'catalogue POST /:bridge_id/order/confirm': 'the same order, confirmed',
  'catalogue POST /network-store/:networkId/order': 'a public network storefront',
  'capture POST /webhook/whatsapp': 'a webhook — the provider cannot hold our JWT; it is verified by its own means',
  'capture POST /webhook/email': 'the same',
  'till POST /pair/claim': 'pairing a counter — the claim code IS the credential',
  'simulator POST /lead': 'a marketing form on a public page',
  'simulator POST /feedback': 'the same',
  /**
   * ⚠️⚠️ THIS ONE IS NOT SETTLED AND IS LISTED SO IT STOPS BEING INVISIBLE.
   *
   * POST /integrations/ask/:handle/stock takes no credential, and a handle is PUBLIC — it is on every storefront.
   * So anybody who can read a shop's storefront can make that shop's connector do work, as often as they like,
   * and learn from the reply whether a connector is listening at all.
   *
   * It reads nothing and writes nothing, so this is not a data leak — it is an unauthenticated TRIGGER into
   * somebody else's machine, plus a small fact about their setup. ⭐ Whether that is acceptable is Athi's call,
   * not mine; what is not acceptable is that nothing anywhere said it was so.
   */
  'integrations POST /ask/:handle/stock': '⚠️ UNDECIDED — an unauthenticated trigger into a shop’s connector, '
    + 'callable by anyone who knows a public handle. Reads and writes nothing. Needs a decision: a rate limit, a '
    + 'key, or an explicit acceptance.',
};

/* the assistant answers anonymously on purpose — one entry rather than five identical ones */
const PUBLIC_PREFIX = {
  'assist POST ': 'the assistant answers without a session by design (softIdentity → anon), rate-limited in server.js',
  'connectors POST ': 'authenticated by the ActorKey in X-Bridge-Key, inside the handler',
  'channels POST ': 'guarded by the `admin` middleware',
};

function mutatingRoutes() {
  const out = [];
  fs.readdirSync(ROUTES).filter((f) => f.endsWith('.js')).forEach((f) => {
    const src = fs.readFileSync(path.join(ROUTES, f), 'utf8');
    const re = /router\.(post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g;
    let m;
    while ((m = re.exec(src))) {
      /**
       * ⚠️ THE HEAD RUNS TO THE HANDLER, HOWEVER LONG. POST /send carries 1331 characters of express-validator
       * before `auth` appears; a fixed window reported it as unguarded, which it emphatically is not.
       */
      const after = src.slice(m.index);
      const h = after.search(/async\s*\(|\(\s*req\s*,\s*res/);
      out.push({
        key: f.replace(/\.js$/, '') + ' ' + m[1].toUpperCase() + ' ' + m[3],
        head: after.slice(0, h > 0 ? h : 400),
        file: f,
      });
    }
  });
  return out;
}

const routes = mutatingRoutes();

console.log('— every route that CHANGES something —');

it('⭐⭐⭐ a mutating route is guarded, or it is on the declared-public list', () => {
  const undeclared = routes
    .filter((r) => !GUARDS.test(r.head))
    .filter((r) => !PUBLIC[r.key])
    .filter((r) => !Object.keys(PUBLIC_PREFIX).some((p) => r.key.startsWith(p)))
    .map((r) => r.key);
  assert.deepStrictEqual(undeclared, [],
    'These change something and require no credential, and nobody has written down why. Either add the guard, or '
    + 'add it to PUBLIC with the reason — a public mutating route should be a sentence somebody wrote, not a line '
    + 'nobody noticed.');
});

it('⚠️ the public list does not name routes that no longer exist', () => {
  /* ⚠️ A stale exemption quietly re-permits whatever takes that path next. Same rule as the query-shape budget. */
  const live = new Set(routes.map((r) => r.key));
  const stale = Object.keys(PUBLIC).filter((k) => !live.has(k));
  assert.deepStrictEqual(stale, [], 'these are exempted and gone — remove them so the exemption cannot creep back');
});

it('⭐ and the number of public mutating routes is small enough to read', () => {
  /**
   * ⚠️ NOT AN ARBITRARY CAP. The value of this list is that a person can read all of it in a minute and judge it.
   * At forty entries nobody reads it, and it becomes the thing it was written to prevent.
   */
  const n = Object.keys(PUBLIC).length;
  assert.ok(n <= 20, n + ' public mutating routes — past about twenty this list stops being read, and an '
    + 'unreadable exemption list is a rubber stamp');
  console.log('        ' + routes.length + ' mutating routes · ' + n + ' declared public');
});

console.log('— and the things a source scan can still see —');

it('⚠️⚠️ no route builds SQL by interpolating a request value', () => {
  /**
   * ⚠️ The platform parameterises everywhere, and this is what keeps it that way. A template literal that drops
   * `req.body.x` or `req.params.y` straight into SQL is the classic injection, and it reads as ordinary code.
   * ⭐ Table and column names occasionally CANNOT be parameters — those are the ones to look at by hand, which is
   * why this names the file and line rather than just failing.
   */
  const bad = [];
  fs.readdirSync(ROUTES).filter((f) => f.endsWith('.js')).forEach((f) => {
    const src = fs.readFileSync(path.join(ROUTES, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!/SELECT|INSERT|UPDATE|DELETE|FROM|WHERE/i.test(line)) return;
      if (/\$\{\s*req\.(body|params|query)/.test(line)) bad.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 72));
    });
  });
  assert.deepStrictEqual(bad, [], 'a request value is interpolated straight into SQL');
});

it('⚠️ no secret is written into the source', () => {
  /* ⚠️ Not a scanner — a floor. It catches the obvious paste, which is how most secrets actually reach a repo. */
  const bad = [];
  ['routes', 'lib', 'middleware'].forEach((dir) => {
    const d = path.join(__dirname, '..', dir);
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d).filter((f) => f.endsWith('.js')).forEach((f) => {
      const src = fs.readFileSync(path.join(d, f), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/process\.env/.test(line)) return;                      /* reading one is the correct thing */
        if (/(secret|password|api[_-]?key|token)\s*[:=]\s*['"][A-Za-z0-9/+_-]{16,}['"]/i.test(line)) {
          bad.push(dir + '/' + f + ':' + (i + 1));
        }
      });
    });
  });
  assert.deepStrictEqual(bad, [], 'a literal that looks like a credential is committed here');
});

it('⚠️ no route answers with a raw error object', () => {
  /**
   * ⚠️ A raw error carries a stack, a query and sometimes a column list. `safeErr()` exists for this and is used
   * almost everywhere; this is what stops the next handler forgetting.
   */
  const bad = [];
  fs.readdirSync(ROUTES).filter((f) => f.endsWith('.js')).forEach((f) => {
    const src = fs.readFileSync(path.join(ROUTES, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/message:\s*(err|e)\.stack/.test(line)) bad.push(f + ':' + (i + 1));
      if (/res\.(status\(\d+\)\.)?json\(\s*(err|e)\s*\)/.test(line)) bad.push(f + ':' + (i + 1));
    });
  });
  assert.deepStrictEqual(bad, [], 'a raw error object or stack is sent to the caller');
});

console.log('\n  ' + pass + ' checks · ' + routes.length + ' mutating routes examined\n');
