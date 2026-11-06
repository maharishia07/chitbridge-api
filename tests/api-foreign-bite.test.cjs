/**
 * tests/api-foreign-bite.test.cjs — the BITE of the foreign-id proof (S35, critic 6 Nov 2026 Finding A): a foreign-id case that cannot fail proves nothing.
 *
 * OWNS      (1) the helper bite: tests/lib/foreign-id-world.cjs biteCase goes red against a store that ignores the owner and green against a scoped one;
 *           (2) the chits bite: the generator's foreign world (tools/api-contract-tests.cjs, world.weak) over the REAL chits routes: with the store weakened,
 *               the routes whose store read decides the answer must flip to failing. Routes that stay green are LISTED (held by another check, or never reading).
 *           books: tests/api-problem-books.test.cjs checkForeignBite (a pack read by its id alone is not held). Other area worlds: listed in the PR.
 * CALLED BY scripts/guards.cjs · CI. Offline: the real app over the stand-in database.
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const FOREIGN = require('./lib/foreign-id-world.cjs');
const generator = require(path.join(API, 'tools', 'api-contract-tests.cjs'));

let passed = 0;
let failed = 0;
const check = (label, condition) => {
  if (condition) passed++;
  else failed++;
  console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label);
};

const answer = (status, json) => ({ status, type: 'application/json', json, text: JSON.stringify(json) });
const NOT_HERE = { code: 'NOT_FOUND' };
/* a stand-in store: scoped reads the owner's rows only; weak reads by id alone */
const storeWorld = (scoped) => async (who, planted) => {
  const holds = planted && (!scoped || who === 'owner');
  return holds ? answer(200, { id: 'a' }) : answer(404, NOT_HERE);
};

async function helperBite() {
  check('helper bite: a scoped store holds, and the weakened one is caught (biteCase null)', (await FOREIGN.biteCase(storeWorld(true))) === null);
  check('helper bite: a store that reads by id alone FAILS the foreign-id case', (await FOREIGN.foreignIdCase(storeWorld(false))) !== null);
  const alwaysNotFound = async () => answer(404, NOT_HERE);
  check('helper bite: a world that answers 404 to everyone (cannot tell shops apart) is named, not passed', (await FOREIGN.biteCase(alwaysNotFound)) !== null);
}

async function chitsBite() {
  const app = generator.appForCases(API);
  const chits = (leaf) => /^\/api\/chits\/:/.test(leaf.path);
  const flipped = [];
  const stayed = [];
  await generator.servedFor(app, async (port) => {
    const facts = (() => {
      const register = require(path.join(API, 'tools', 'api-register.cjs'));
      const seen = new Set();
      return {
        leaves: require(path.join(API, 'tools', 'load-app.cjs')).leavesOf(app, true).filter((leaf) => chits(leaf) && !seen.has(leaf.path) && seen.add(leaf.path)),
        operations: register.operationsOfApp(),
        appliesOf: () => ({ foreign_id_404: true }),
        fieldsOf: () => ({})
      };
    })();
    generator.world.weak = false;
    const real = await generator.runHardening(app, port, facts);
    generator.world.weak = true;
    const weak = await generator.runHardening(app, port, facts);
    generator.world.weak = false;
    Object.keys(real.results).filter((key) => real.results[key].foreign_id_404.pass).forEach((key) => (weak.results[key].foreign_id_404.pass ? stayed : flipped).push(key));
  });
  console.log('  chits routes held in the real world: ' + (flipped.length + stayed.length) + ' · caught by the weakened store: ' + flipped.length);
  stayed.forEach((key) => console.log('  note  ' + key + ': stays green under a weakened store (held by another check, or the id is never read)'));
  check('chits bite: the weakened store is caught on at least one real chits route', flipped.length >= 1);
  check('chits bite: at least one chits route held in the real world (the comparison has something to bite)', flipped.length + stayed.length >= 1);
}

/* the exemptions of docs/contracts/api-hardening-scope.json: the ONE rule set is register.scopeProblems (also run by api-register.cjs --check); here it is run on the committed files, and the register is shown to read every cannot_answer entry */
function exemptionsHaveReasons() {
  const scope = require(path.join(API, 'docs', 'contracts', 'api-hardening-scope.json'));
  const register = require(path.join(API, 'tools', 'api-register.cjs'));
  const problems = register.scopeProblems(scope, require(path.join(API, 'docs', 'api-register.json')).routes);
  problems.forEach((sentence) => console.log('  FINDING ' + sentence));
  check('public_ids, platform_only and cannot_answer: every entry has a reason of 20+ characters, names a route that exists, and a cannot_answer status is declared', problems.length === 0);
  const parsed = register.hardeningScope();
  check('the register reads every cannot_answer entry (none dropped for want of a field)', Object.values(parsed.cannotAnswer).reduce((sum, set) => sum + set.size, 0) === scope.cannot_answer.length);
  check('the register reads every platform_only entry', parsed.platformOnly.size === Object.keys(scope.platform_only).length);
}

(async () => {
  exemptionsHaveReasons();
  await helperBite();
  await chitsBite();
  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
