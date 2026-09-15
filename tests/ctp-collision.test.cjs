/**
 * ── ⭐⭐⭐ TWO SHOPS WITH THE SAME NAME, IN TWO COUNTRIES ─────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-15:
 *
 *   *"create two shops identical in two different domain… let the user id, user name be same, ie ALPHA-TIMERS
 *    and Alpha Timers, one is in IN and another in Arab region, now they have to transfer between india to UAE…
 *    as both have same user id, does it create an impact? also, try and force the bridge id also same?"*
 *
 * ── ⚠️⚠️ THE COLLISION IS NOT THE PROBLEM; THE UNQUALIFIED NAME IS ──────────────────────────────────────────────
 *
 * In ONE database `bridge_id`, `lower(user_id)` and `email` are each UNIQUE, so the two shops cannot coexist
 * here and no test can make them. Across two INSTALLATIONS they are two rows in two databases, a collision is
 * expected — eight random characters minted independently, forever — and the question is only whether an
 * address can tell them apart.
 *
 * ⭐ IT CAN, BECAUSE THE ADDRESS CARRIES THE NAMESPACE: `CBAAAAAAAA@in.example` is not
 * `CBAAAAAAAA@ae.example`. Same shop name, same user id, same bridge id, different businesses — exactly as two
 * people may both be `admin@` at different companies.
 *
 * ⚠️ AND THE DANGEROUS CASE IS THE ONE THIS FILE EXISTS FOR: a qualified address must NEVER be resolved locally
 * just because we happen to hold that bridge id. Reading `CBAAAAAAAA@ae.example` as our own `CBAAAAAAAA` would
 * deliver a stranger's chit into our books, and silently, because both rows are perfectly valid.
 *
 * ⚠️ OFFLINE. The database is stubbed: what is under test is the ADDRESSING RULE, and a rule that needs two
 * live installations to check is a rule nobody checks.
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
const okA = async (name, fn) => { try { await fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

function loadAddress(dbStub) {
  const p = path.join(__dirname, '..', 'lib', 'ctpaddress.js');
  delete require.cache[require.resolve(p)];
  const real = Module._load;
  Module._load = function (req) { if (req === '../db') return dbStub; return real.apply(this, arguments); };
  try { return require(p); } finally { Module._load = real; }
}

/* ⭐ THE COLLISION, FORCED: the SAME bridge id exists here and at the Emirati installation. */
const SAME = 'CBAAAAAAAA';
const OUR_ENTITY = '11111111-1111-1111-1111-111111111111';

const stub = {
  query: async (sql, args) => {
    if (/FROM installation\s+WHERE active AND hosted_locally = false/i.test(sql)) {
      return { rows: [{ installation_key: 'platform-ae', ctp_endpoint: 'https://ae.example/ctp', region: 'AE' }] };
    }
    if (/FROM installation\s+WHERE lower\(domain\)/i.test(sql)) {
      if (args[0] === 'ae.example') {
        return { rows: [{ installation_key: 'platform-ae', ctp_endpoint: 'https://ae.example/ctp',
                          hosted_locally: false, active: true }] };
      }
      if (args[0] === 'in.example') {
        return { rows: [{ installation_key: 'platform-0', ctp_endpoint: null,
                          hosted_locally: true, active: true }] };
      }
      return { rows: [] };
    }
    if (/FROM identities/i.test(sql)) {
      /* our own Alpha Timers, holding the very same bridge id */
      return { rows: args[0] === SAME ? [{ identity_id: OUR_ENTITY }] : [] };
    }
    if (/ops\.f_installation_of/.test(sql)) return { rows: [{ installation_key: 'platform-0' }] };
    return { rows: [] };
  },
};

(async () => {
  console.log('\n══ TWO ALPHA TIMERS — one in India, one in the Emirates ══\n');
  const A = loadAddress(stub);

  /* ── ① PARSING ─────────────────────────────────────────────────────────────────────────────────────────── */
  ok('a bare name is this installation’s own namespace', () => {
    const p = A.parse(SAME);
    /* ⚠️ `ok` FIRST. Without it this assertion passed while the bare-name branch was disabled — a refused
       address also reports qualified:false, so the test agreed with a broken parser. An assertion that holds
       when the thing is broken is worse than none. */
    assert.strictEqual(p.ok, true, 'a bare name must RESOLVE, not merely fail to be qualified');
    assert.strictEqual(p.qualified, false);
    assert.strictEqual(p.bridge_id, SAME);
    assert.strictEqual(p.domain, null);
  });

  ok('name@domain splits, and the domain is lowercased', () => {
    const p = A.parse(SAME + '@AE.Example');
    assert.strictEqual(p.qualified, true);
    assert.strictEqual(p.bridge_id, SAME);
    assert.strictEqual(p.domain, 'ae.example');
  });

  ok('rubbish is refused rather than guessed at', () => {
    for (const bad of ['', '@ae.example', 'CB@@x', 'CB@', 'CB@ spaces ']) {
      assert.strictEqual(A.parse(bad).ok, false, 'should refuse: ' + JSON.stringify(bad));
    }
  });

  ok('a local party formats WITHOUT a domain', () => {
    /* ⚠️ adding ours would assert a name other installations do not use for us */
    assert.strictEqual(A.format(SAME, null), SAME);
    assert.strictEqual(A.format(SAME, 'AE.Example'), SAME + '@ae.example');
  });

  /* ── ② THE COLLISION ───────────────────────────────────────────────────────────────────────────────────── */
  await okA('⚠️ the SAME bridge id at another domain resolves REMOTE, not to ours', async () => {
    const r = await A.resolveAddress(SAME + '@ae.example');
    assert.strictEqual(r.ok, true, r.why);
    assert.strictEqual(r.local, false,
      'we hold this bridge id too — reading the address as ours would deliver a stranger’s chit into our books');
    assert.strictEqual(r.installation_key, 'platform-ae');
    assert.strictEqual(r.endpoint, 'https://ae.example/ctp');
    assert.strictEqual(r.entity_id, null, 'a remote party has no entity id here, and must not be given one');
  });

  await okA('…while the bare name still resolves to OUR shop', async () => {
    const r = await A.resolveAddress(SAME);
    assert.strictEqual(r.local, true, r.why);
    assert.strictEqual(r.entity_id, OUR_ENTITY);
  });

  await okA('…and our own domain resolves back to us, not out to a wire', async () => {
    const r = await A.resolveAddress(SAME + '@in.example');
    assert.strictEqual(r.local, true, r.why);
    assert.strictEqual(r.entity_id, OUR_ENTITY, 'a domain we host is still our namespace');
  });

  await okA('a domain we do not deal with is refused, not dialled', async () => {
    const r = await A.resolveAddress(SAME + '@stranger.example');
    assert.strictEqual(r.ok, false);
    assert.ok(/no installation we deal with/.test(r.why), r.why);
  });

  /* ── ③ WHAT THE IDENTICAL SHOPS MEAN ───────────────────────────────────────────────────────────────────── */
  ok('two identical shops are two distinct addresses', () => {
    const inAddr = A.format(SAME, 'in.example');
    const aeAddr = A.format(SAME, 'ae.example');
    assert.notStrictEqual(inAddr, aeAddr,
      'same user_id, same display name, same bridge id — and still two businesses, because the namespace differs');
  });

  ok('⚠️ an identity_id is never an address', () => {
    /* it parses as a bare name, which means "ours" — and our lookup is by BRIDGE ID, so a uuid finds nothing.
       That is the correct outcome: an internal key must not be an address. */
    const p = A.parse('11111111-1111-1111-1111-111111111111');
    assert.strictEqual(p.qualified, false);
    assert.strictEqual(p.bridge_id, '11111111-1111-1111-1111-111111111111');
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
