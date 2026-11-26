'use strict';
/**
 * tests/sec-199-identities-wholerow.test.cjs — SEC-199: no app-role read of a WHOLE identities row in lib/ routes/ middleware/ (SEC-186 revoked the credential columns from cb_app: a 500 at run time, not at test time).
 * CARD 18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 * Run: node tests/sec-199-identities-wholerow.test.cjs · MIN unit-per-rule · refusal-path (the old to_jsonb(i) form of lib/books-grant.js is refused) · no database needed
 * The behaviour as cb_app is tests/sec-199-identities-as-app.realstack.cjs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { hits } = require('../tools/identities-wholerow.cjs');
let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String(e && e.message).slice(0, 400)); } };
/** a temp tree holding one file lib/x.js with `body`: the hits the finder sees */
function hitsOf(body) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec199-'));
  try { fs.mkdirSync(path.join(tmp, 'lib')); fs.writeFileSync(path.join(tmp, 'lib', 'x.js'), body); return hits(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
check('the tree has no whole-row read of identities in lib/ routes/ middleware/', () => {
  const found = hits();
  assert.strictEqual(found.length, 0, found.map((x) => x.file + ':' + x.line + ' ' + x.what).join(' | '));
});
check('refuses the form that took down the client list (to_jsonb(i) over identities i)', () => assert.strictEqual(hitsOf("q(`SELECT (SELECT to_jsonb(i) ->> 'is_test' FROM identities i WHERE i.identity_id = g.x) AS t`)").length, 1));
check('refuses row_to_json(identities), i.*, SELECT * FROM identities, RETURNING *', () => {
  assert.strictEqual(hitsOf('q(`SELECT row_to_json(identities) FROM identities WHERE identity_id = $1`)').length, 1);
  assert.strictEqual(hitsOf('q(`SELECT i.* FROM identities i WHERE i.identity_id = $1`)').length, 1);
  assert.strictEqual(hitsOf('q(`SELECT * FROM identities WHERE identity_id = $1`)').length, 1);
  assert.strictEqual(hitsOf('q(`UPDATE identities SET display_name = $2\n WHERE identity_id = $1 RETURNING *`)').length, 1);
});
check('allows named columns, and to_jsonb over a named-column subselect', () => {
  assert.strictEqual(hitsOf('q(`SELECT (SELECT to_jsonb(i) FROM (SELECT country FROM identities WHERE identity_id = $1) i) AS identity`)').length, 0);
  assert.strictEqual(hitsOf('q(`SELECT i.display_name FROM identities i WHERE i.identity_id = $1`)').length, 0);
  assert.strictEqual(hitsOf("q(`SELECT to_jsonb(i) ->> 'network_role' FROM installation i`)").length, 0);
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
