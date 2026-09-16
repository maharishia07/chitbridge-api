/**
 * ── ⭐⭐⭐ THE CONSTITUTION MATRIX — one cascade, two doors, and it now works for a party that is not here ────────
 *
 * Athi, 2026-09-16: *"verify the constitution matrix, so it resolves correctly here; if not, bring it to the
 * same place, so it works for CTP"* … *"i hope you are keeping it as a single source and nothing to be found
 * from sweeping the entire code base?"*
 *
 * ── WHAT WAS FOUND ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   1. `resolveEntityGovernance` is keyed by a LOCAL entity and reads `entity_governance` under RLS. A party
 *      arriving over CTP has no row here, so it resolved — silently — as `base @ platform-0`, the way a brand-new
 *      local shop would. An Emirati supplier governed as a default Indian one, with nothing saying so.
 *   2. `lib/workpattern.js` had ITS OWN resolver, with a DIFFERENT fallback: `is_default` where govresolve says
 *      `base`. Two answers to "who governs this entity".
 *
 * ── WHAT IS NOW TRUE, and asserted below ───────────────────────────────────────────────────────────────────────
 *
 *   · `resolveInstallationGovernance(key)` resolves from the installation row alone — the SAME rule b254's SQL
 *     trigger uses (installation → vertical_key → constitution) — so a remote peer (b257, hosted_locally=false)
 *     resolves its own constitution, region and currency with no entity row and no RLS context.
 *   · both doors share ONE cascade, and every answer says `resolved_from` and whether it was a `fallback`.
 *   · in lib/, ONLY govresolve reads the governance tables to resolve; the writers in routes/ are named.
 *
 * ⚠️ OFFLINE. The database is stubbed: what is under test is the RULE, and a rule that needs two live
 * installations to check is a rule nobody checks. Same stance as tests/ctp-collision.test.cjs.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
const okA = async (name, fn) => { try { await fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

/* ── the world, as rows ────────────────────────────────────────────────────────────────────────────────────── */
const INSTALLATIONS = {
  'platform-0':  { installation_key: 'platform-0',  label: 'India',    region: 'IN', currency: 'INR', timezone: 'Asia/Kolkata', languages: ['en', 'ta'], vertical_key: null,      domain: 'in.example', hosted_locally: true,  active: true },
  'platform-ae': { installation_key: 'platform-ae', label: 'Emirates', region: 'AE', currency: 'AED', timezone: 'Asia/Dubai',   languages: ['ar', 'en'], vertical_key: 'uae-vat', domain: 'ae.example', hosted_locally: false, active: true },
  /* a currency the universe does not allow — proves bounded() still tightens after the refactor */
  'platform-zz': { installation_key: 'platform-zz', label: 'Nowhere',  region: 'IN', currency: 'ZZZ', timezone: 'Asia/Kolkata', languages: [],           vertical_key: null,      domain: 'zz.example', hosted_locally: false, active: true },
};
const CONSTITUTIONS = {
  'base':    { constitution_key: 'base',    version: 'v1', capabilities: [],
               governance: { allowed: { currencies: ['INR', 'AED', 'USD'], regions: ['IN', 'AE', 'MX'] }, defaults: { currency: 'INR', region: 'IN', languages: ['en'] } } },
  'uae-vat': { constitution_key: 'uae-vat', version: 'v2', capabilities: [],
               governance: { defaults: { currency: 'AED', region: 'AE' }, jurisdiction: 'AE' } },
};
const STAMPS = {
  'E-IN': { constitution_key: 'base', constitution_version: 'v1', installation_key: 'platform-0' },
  /* 'E-NONE' has no stamp at all — the legacy case */
};

const dbStub = {
  query: async (sql, args) => {
    if (/FROM constitution\b/.test(sql))  return { rows: CONSTITUTIONS[args[0]] ? [CONSTITUTIONS[args[0]]] : [] };
    if (/FROM installation\b/.test(sql))  return { rows: INSTALLATIONS[args[0]] ? [INSTALLATIONS[args[0]]] : [] };
    if (/FROM capability\b/.test(sql))    return { rows: [] };
    return { rows: [] };
  },
  withEntity: async (entity_id, cb) => cb({
    query: async (sql, args) => (/FROM entity_governance/.test(sql)
      ? { rows: STAMPS[args[0]] ? [STAMPS[args[0]]] : [] } : { rows: [] }),
  }),
};
const memoStub = { memo: async (key, fn) => fn() };

function loadGov() {
  const p = path.join(API, 'lib', 'govresolve.js');
  delete require.cache[require.resolve(p)];
  const real = Module._load;
  Module._load = function (req) {
    if (req === '../db') return dbStub;
    if (req === './confcache') return memoStub;
    return real.apply(this, arguments);
  };
  try { return require(p); } finally { Module._load = real; }
}

(async () => {
  console.log('\n══ THE CONSTITUTION MATRIX — one cascade, two doors ══\n');
  const G = loadGov();

  await okA('⭐⭐ a REMOTE installation resolves ITS OWN constitution — not ours, not base', async () => {
    const g = await G.resolveInstallationGovernance('platform-ae');
    assert.strictEqual(g.constitution, 'uae-vat@v2', 'installation → vertical_key → constitution, the b254 rule');
    assert.strictEqual(g.basics.currency, 'AED');
    assert.strictEqual(g.basics.region, 'AE');
    assert.strictEqual(g.jurisdiction, 'AE');
    assert.strictEqual(g.resolved_from, 'installation');
    assert.strictEqual(g.fallback, false);
  });

  await okA('⚠️ an installation we do not know resolves to the default AND SAYS SO', async () => {
    const g = await G.resolveInstallationGovernance('platform-nowhere');
    assert.strictEqual(g.fallback, true, 'a default dressed up as an answer is the silent failure this replaces');
    assert.strictEqual(g.resolved_from, 'fallback');
    assert.strictEqual(g.constitution, 'base@v1');
  });

  await okA('⚠️ an entity with no stamp is a FALLBACK, and says so — it used to say nothing', async () => {
    const g = await G.resolveEntityGovernance('E-NONE');
    assert.strictEqual(g.fallback, true);
    assert.strictEqual(g.resolved_from, 'fallback');
    assert.strictEqual(g.constitution, 'base@v1');
  });

  await okA('a stamped entity resolves from its stamp', async () => {
    const g = await G.resolveEntityGovernance('E-IN');
    assert.strictEqual(g.resolved_from, 'entity_stamp');
    assert.strictEqual(g.fallback, false);
    assert.strictEqual(g.basics.currency, 'INR');
  });

  await okA('⭐⭐⭐ ONE CASCADE: the entity door and the installation door give the same answer for the same world', async () => {
    const byEntity = await G.resolveEntityGovernance('E-IN');            /* stamped base @ platform-0 */
    const byInstall = await G.resolveInstallationGovernance('platform-0'); /* platform-0 has no vertical → base */
    for (const k of ['constitution', 'basics', 'allowed', 'capabilities', 'jurisdiction']) {
      assert.deepStrictEqual(byInstall[k], byEntity[k],
        k + ' differs between the two doors — that is two cascades, which is the thing being removed');
    }
  });

  await okA('⚠️ tighten-only survives the refactor: an installation cannot pick a currency the universe forbids', async () => {
    const g = await G.resolveInstallationGovernance('platform-zz');
    assert.strictEqual(g.basics.currency, 'INR', 'ZZZ is not in allowed.currencies, so the default wins');
    assert.deepStrictEqual(g.allowed.currencies, ['INR', 'AED', 'USD']);
  });

  /* ── SINGLE SOURCE ───────────────────────────────────────────────────────────────────────────────────────── */
  ok('⭐⭐ in lib/, ONLY govresolve resolves a constitution from the governance tables', () => {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const files = fs.readdirSync(path.join(API, 'lib')).filter((f) => f.endsWith('.js') && f !== 'govresolve.js');
    const offenders = [];
    for (const f of files) {
      const code = strip(fs.readFileSync(path.join(API, 'lib', f), 'utf8'));
      /* reading constitution_key out of entity_governance, or reading the constitution table, IS resolving */
      const readsStamp = /SELECT[^;]*constitution_key[^;]*FROM entity_governance/i.test(code);
      const readsConst = /FROM constitution\b/i.test(code);
      if (readsStamp || readsConst) offenders.push(f);
    }
    assert.deepStrictEqual(offenders, [],
      'these resolve a constitution on their own: ' + offenders.join(', ')
      + '. lib/workpattern.js did, with a DIFFERENT fallback (is_default vs base) — two resolvers, two answers.');
  });

  ok('⚠️ the writers in routes/ are the named ones and no more', () => {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    /* these WRITE the stamp (registration, boilerplate adoption) or LIST constitutions for a picker. They are not
       resolvers, and they are registered here so that a fourth one cannot arrive unnoticed. */
    const WRITERS = ['entities.js', 'governance.js'];
    const files = fs.readdirSync(path.join(API, 'routes')).filter((f) => f.endsWith('.js'));
    const offenders = [];
    for (const f of files) {
      if (WRITERS.indexOf(f) >= 0) continue;
      const code = strip(fs.readFileSync(path.join(API, 'routes', f), 'utf8'));
      if (/FROM constitution\b/i.test(code) || /SELECT[^;]*constitution_key[^;]*FROM entity_governance/i.test(code)) offenders.push(f);
    }
    assert.deepStrictEqual(offenders, [], 'new route(s) reading governance tables directly: ' + offenders.join(', '));
  });

  ok('workpattern asks govresolve, and its private helper is gone', () => {
    const src = fs.readFileSync(path.join(API, 'lib', 'workpattern.js'), 'utf8');
    assert.ok(/resolveEntityGovernance\(/.test(src), 'resolveConstitutionRef must ask the one cascade');
    assert.ok(!/function entityConstitution/.test(src), 'the private stamp reader must not survive as dead code');
  });

  ok('⭐ the CTP door resolves the SENDER from its installation, and only annotates', () => {
    const src = fs.readFileSync(path.join(API, 'routes', 'ctp.js'), 'utf8');
    assert.ok(/resolveInstallationGovernance\(ik\)/.test(src), 'the arrival path must ask the installation door');
    assert.ok(/sender_governance/.test(src), 'and put the answer on the response');
    /* it must not become a gate: no `return no(` may depend on senderGov */
    const gate = /if\s*\(\s*!?senderGov[^)]*\)\s*return no\(/.test(src);
    assert.strictEqual(gate, false, 'whether a foreign constitution is accepted is CTP-DESIGN §9’s open decision, not this file’s');
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
