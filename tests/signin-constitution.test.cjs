/**
 * tests/signin-constitution.test.cjs — SIGNIN-CONST (2026-10-14): A SIGN-IN NEVER RESETS THE CONSTITUTION.
 *
 * routes/signin.js auto-minted the governance stamp on EVERY owner verify with `ON CONFLICT (entity_id) DO UPDATE SET constitution_key…`,
 * so a shop's chosen constitution was reset to `base` the next time its owner signed in. The one writer is now
 * lib/country-setup.stampConstitution: the registrant's choice lands on the placeholder row at registration's verify only; every later
 * sign-in inserts only when the shop has no row at all; the answer names the constitution the shop ACTUALLY holds.
 *
 * The brief's test: set → sign in twice → unchanged. No database: an in-memory entity_governance table that answers the writer's one
 * statement with Postgres's own semantics for it (INSERT … ON CONFLICT DO NOTHING | DO UPDATE … WHERE; the CTE's RETURNING, else the
 * standing row). The route is read as SOURCE so the overwrite cannot come back by hand.
 * Run: node tests/signin-constitution.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

/* lib/country-setup requires the db module at load; nothing here reaches it — the writer takes the handle it is given */
require.cache[require.resolve(path.join(API, 'db'))] = { exports: {
  query: async (sql) => { throw new Error('unstubbed query: ' + sql); },
  withEntity: async (_id, fn) => fn({ query: async (sql) => { throw new Error('unstubbed query: ' + sql); } }),
} };
delete require.cache[require.resolve(path.join(API, 'lib', 'country-setup'))];
const CS = require(path.join(API, 'lib', 'country-setup'));

/** the table: entity_id → { constitution_key, constitution_version, installation_key }; `sqls` keeps every statement text */
function table() {
  const rows = new Map(), sqls = [];
  const h = { query: async (sql, params) => {
    sqls.push(sql);
    if (!/INSERT INTO entity_governance/.test(sql)) throw new Error('not the writer\'s statement: ' + sql.slice(0, 60));
    const [entity, key, version, ik] = params;
    const cur = rows.get(entity);
    let written = null;
    if (!cur) { written = { constitution_key: key, constitution_version: version, installation_key: ik }; rows.set(entity, written); }
    else if (/DO UPDATE/.test(sql)) {
      /* the writer's own WHERE: only a placeholder (`base`) takes the registrant's choice */
      const m = /WHERE entity_governance\.constitution_key = '([a-z-]+)'/.exec(sql);
      if (m && cur.constitution_key === m[1]) { written = { constitution_key: key, constitution_version: version, installation_key: ik }; rows.set(entity, written); }
    }
    /* DO NOTHING: an existing row is untouched */
    const standing = rows.get(entity);
    return { rows: [written ? { constitution_key: written.constitution_key, constitution_version: written.constitution_version, stamped: true }
                           : { constitution_key: standing.constitution_key, constitution_version: standing.constitution_version, stamped: false }] };
  } };
  return { rows, sqls, h };
}
const SHOP = '11111111-1111-4111-8111-111111111111';

(async () => {
  console.log('\n══ SIGN-IN NEVER RESETS THE CONSTITUTION ══\n');

  /* 1. a shop with no row at all: a sign-in stamps base (the fallback the b254 trigger would have written) */
  let t = table();
  let r = await CS.stampConstitution(t.h, SHOP, { key: 'base', version: 'v3', installation_key: 'platform-0', first: false });
  eq('no stamp row → a sign-in inserts base', [r.constitution_key, r.constitution_version, r.stamped, t.rows.get(SHOP).installation_key], ['base', 'v3', true, 'platform-0']);
  ok('…with INSERT … ON CONFLICT DO NOTHING — never SET constitution_key', /ON CONFLICT \(entity_id\) DO NOTHING/.test(t.sqls[0]) && !/SET constitution_key/.test(t.sqls[0]), t.sqls[0]);

  /* 2. registration's verify: the registrant's choice lands on the placeholder row noteGuess / the trigger left */
  t = table(); t.rows.set(SHOP, { constitution_key: 'base', constitution_version: 'v1', installation_key: 'platform-0' });
  r = await CS.stampConstitution(t.h, SHOP, { key: 'service-desk', version: 'v2', installation_key: 'mx-1', first: true });
  eq('first verify: the chosen vertical replaces the base placeholder', [r.constitution_key, r.constitution_version, r.stamped, t.rows.get(SHOP).installation_key], ['service-desk', 'v2', true, 'mx-1']);

  /* 3. THE BRIEF'S TEST — set → sign in twice → unchanged */
  t = table(); t.rows.set(SHOP, { constitution_key: 'service-desk', constitution_version: 'v2', installation_key: 'mx-1' });
  const a = await CS.stampConstitution(t.h, SHOP, { key: 'base', version: 'v3', installation_key: 'platform-0', first: false });
  const b = await CS.stampConstitution(t.h, SHOP, { key: 'base', version: 'v3', installation_key: 'platform-0', first: false });
  eq('set → sign in twice → the stamp is unchanged', t.rows.get(SHOP), { constitution_key: 'service-desk', constitution_version: 'v2', installation_key: 'mx-1' });
  eq('…and each sign-in answers the constitution the shop HOLDS, not the one it would have minted', [a.constitution_key, a.constitution_version, a.stamped, b.constitution_key, b.stamped], ['service-desk', 'v2', false, 'service-desk', false]);
  ok('…neither statement could overwrite (DO NOTHING both times)', t.sqls.every((s) => /DO NOTHING/.test(s) && !/DO UPDATE/.test(s)));

  /* 4. registration's verify on a row that already names a vertical (a spin's world stamp): kept */
  t = table(); t.rows.set(SHOP, { constitution_key: 'service-desk', constitution_version: 'v2', installation_key: 'mx-1' });
  r = await CS.stampConstitution(t.h, SHOP, { key: 'base', version: 'v3', installation_key: 'platform-0', first: true });
  eq('first verify never overwrites a row that already names a vertical', [r.constitution_key, r.stamped, t.rows.get(SHOP).constitution_key], ['service-desk', false, 'service-desk']);

  /* 5. the route, as source: the overwrite is gone and the one writer is called with "first = not yet email_verified" */
  const src = fs.readFileSync(path.join(API, 'routes', 'signin.js'), 'utf8');
  ok('routes/signin.js no longer carries ON CONFLICT … DO UPDATE SET constitution_key', !/DO UPDATE SET constitution_key/.test(src));
  ok('…it calls country-setup.stampConstitution with first = identity.email_verified !== true', /stampConstitution\(cl, identity\.identity_id/.test(src) && /const first = identity\.email_verified !== true/.test(src));
  ok('…and the verify SELECT carries email_verified so "first" is read, never guessed', /otp_attempts, owner_scope, parent_entity_id, email_verified`/.test(src));
  const cs = fs.readFileSync(path.join(API, 'lib', 'country-setup.js'), 'utf8');
  ok('the writer is exported from the governance construct (lib/country-setup)', /stampConstitution, SOURCES/.test(cs) && typeof CS.stampConstitution === 'function');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
