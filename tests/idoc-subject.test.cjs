/**
 * tests/idoc-subject.test.cjs — who may file a document against whom.
 *
 * ⚠️⚠️ THIS RULE CANNOT BE TESTED LIVE YET. The route checks hasTable('identity_documents') first and returns
 * 503 until b174 is run, so every request short-circuits before reaching the authorisation. Leaving it
 * untested until the migration lands would mean the rule ships unverified and is first exercised by real
 * documents belonging to real people — which is the worst possible place to discover it is wrong.
 *
 * WHAT IS BEING PROTECTED. The route originally took no identity_id at all: the subject was always the caller,
 * so no shape of the request could file a document against another person. Owner-side capture at co-assist
 * registration is a real need and it reopens exactly that shape. These are the three conditions that replace
 * the property that was lost.
 */
const path = require('path');

let ROWS = [];   // what the "database" holds for the parent-entity check
const dbPath = require.resolve('../db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async () => ({ rows: ROWS }),
    withEntity: async () => ({ rows: [] }),
    withTransaction: async () => ({ rows: [] }),
  }
};

/* The route module builds an express Router at require time, which is fine — we only want resolveSubject, and
   it is not exported, so drive it through the module's own source. Requiring the file also proves it loads. */
require('../routes/identity-docs');
const src = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'identity-docs.js'), 'utf8');
const body = src.match(/async function resolveSubject\(req, wanted\) \{[\s\S]*?\n\}/);
if (!body) { console.error('✗ could not find resolveSubject — the test is stale, fix it before trusting it'); process.exit(1); }
const { query } = require('../db');
const resolveSubject = eval('(' + body[0].replace(/^async function resolveSubject/, 'async function') + ')');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.error('  ✗ ' + name + (extra ? '\n      ' + extra : '')); } };

const ENTITY = { identity_id: 'ent-1', identity_type: 'entity' };
const ACTOR  = { identity_id: 'act-1', identity_type: 'actor', parent_entity_id: 'ent-1' };

async function attempt(identity, wanted) {
  try { return { ok: true, res: await resolveSubject({ identity }, wanted) }; }
  catch (e) { return { ok: false, status: e.status, code: e.code, message: e.message }; }
}

(async () => {
  console.log('\n── the subject defaults to the caller ──');
  ROWS = [];
  let r = await attempt(ACTOR, undefined);
  ok('an actor with no identity_id gets themselves', r.ok && r.res.id === 'act-1' && r.res.onBehalf === false);
  r = await attempt(ACTOR, 'act-1');
  ok('naming YOURSELF is not "on behalf"', r.ok && r.res.onBehalf === false);

  console.log('\n── an actor may never name anyone else ──');
  ROWS = [{ x: 1 }];   // even if the row check WOULD pass, the type check must fire first
  r = await attempt(ACTOR, 'act-2');
  ok('actor naming a COLLEAGUE is refused 403', !r.ok && r.status === 403, JSON.stringify(r));
  ok('  …with a code the UI can branch on', !r.ok && r.code === 'IDOC_SUBJECT_FORBIDDEN');
  ok('  …and the refusal does NOT depend on the database answer',
     !r.ok, 'ROWS was non-empty, so only the identity_type check can have refused it');

  console.log('\n── an entity may name its OWN co-assist, and only its own ──');
  ROWS = [{ x: 1 }];
  r = await attempt(ENTITY, 'act-1');
  ok('entity naming its own co-assist is allowed', r.ok && r.res.id === 'act-1' && r.res.onBehalf === true);

  ROWS = [];           // the parent-entity check finds nothing
  r = await attempt(ENTITY, 'act-9');
  ok('entity naming SOMEONE ELSE\'S staff is refused 403', !r.ok && r.status === 403, JSON.stringify(r));
  ok('  …and says so in words an owner can act on',
     !r.ok && /not one of your co-assists/i.test(r.message || ''), r.message);

  console.log(`\n══ ${pass} passed · ${fail} failed ══\n`);
  process.exit(fail ? 1 : 0);
})();
