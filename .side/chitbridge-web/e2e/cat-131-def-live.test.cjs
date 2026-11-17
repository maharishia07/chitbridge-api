/**
 * cat-131-def-live.test.cjs — CAT-131 (proof 2026-11-14): a definition correction reaches every product that cites it, because the reference resolves LIVE.
 * OWNS      the proof, on the real core.js code (cbDefsLive · cbDefsCached · cbOrderLive · cbOrderDecl lifted into a vm sandbox): a product stores only
 *           order = { ref: <definition_id> }; the shelf says "Carton of 6" (step 6) -> the product resolves to step 6; the owner corrects the definition to 12;
 *           the forced refresh (what cap-definitions calls after a change) makes the SAME stored product resolve to step 12 with nothing rewritten on the product;
 *           a reference to a definition the shelf lacks is unresolved 'missing', never a quiet default.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/cat-131-def-live.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'core.js'), 'utf8');
const i = src.indexOf('var _DEFS = {};');
const j = src.indexOf('function cbDefsCached');
if (i < 0 || j < 0) throw new Error('cbDefsLive block not found in core.js');
const block = src.slice(i, src.indexOf('\n', src.indexOf('}', j)));
const shelf = { rules: { step: 6 } };
let asked = 0;
const sandbox = {
  console,
  api: () => { asked++; return Promise.resolve({ definitions: [{ kind: 'ordermodel', definition_id: 'om-carton', name: 'Carton of 6', sub: 'pack', rules: shelf.rules }] }); }
};
vm.createContext(sandbox);
vm.runInContext(block + '\n' + liftFns('public/app/core.js', ['cbOrderLive', 'cbOrderDecl']) + '\nthis.cbOrderLive = cbOrderLive; this.cbOrderDecl = cbOrderDecl;', sandbox);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
(async () => {
  const product = { name: 'Rice 6-pack', order: { ref: 'om-carton' } };
  const stored = JSON.stringify(product);
  const loading = sandbox.cbOrderDecl(product.order);
  ok(loading.unresolved === 'loading', 'before the shelf is read the reference says loading, not a default model');
  await sandbox.cbOrderLive();
  const first = sandbox.cbOrderDecl(product.order);
  ok(first.step === 6 && first.name === 'Carton of 6' && first.model === 'pack', 'the product resolves to the shelf: Carton of 6, step 6 (' + JSON.stringify(first) + ')');
  shelf.rules = { step: 12 };
  const stale = sandbox.cbOrderDecl(product.order);
  ok(stale.step === 6, 'between the correction and the refresh the cache still answers 6 (the refresh is what propagates)');
  await sandbox.cbOrderLive(true);
  const after = sandbox.cbOrderDecl(product.order);
  ok(after.step === 12, 'after the forced refresh the SAME product resolves to step 12 (' + after.step + ')');
  ok(JSON.stringify(product) === stored && Object.keys(product.order).join() === 'ref', 'the product itself was not rewritten: it still holds only the reference');
  const gone = sandbox.cbOrderDecl({ ref: 'om-deleted' });
  ok(gone.unresolved === 'missing' && gone.step === undefined, 'a reference the shelf lacks is unresolved "missing" and never quietly a count');
  ok(asked >= 2, 'the shelf was read from the server (' + asked + ' reads)');
  process.exitCode = bad ? 1 : 0;
})();
