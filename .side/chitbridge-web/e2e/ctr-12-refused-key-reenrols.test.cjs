/**
 * ctr-12-refused-key-reenrols.test.cjs — CTR-12 (proof 2026-11-14): a phone whose key the shop refuses is re-enrolled by the next sign-in, so a refresh keeps the person signed in WITH the product list.
 * OWNS      the proof on the real public/till.html code (refreshFailed · usignShopMove · shopMoveOf lifted into a vm sandbox; the till's own globals stubbed). The 4 Oct 2026 phone: signed in, no product list,
 *           every pull to refresh flashed "Due to maintenance" (the shop answered 401 to a key it had refused) because the sign-in answered 'same' and never got a fresh key.
 *           Hand-computed: (1) a 401 on the snapshot marks the key refused (KEY_OK false) and says "Due to maintenance"; a 500 does not (the shop merely did not answer);
 *           (2) with the key refused, a sign-in by the person door of the SAME shop is 'pair' (enrol afresh -> a working key -> the product list loads again), not 'same';
 *           (3) with a working key the same sign-in is 'same' (nothing to re-do), a different shop is 'other', no key is 'pair'; (4) a person already billing as this shop's person is 'same' (replaced in place).
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/ctr-12-refused-key-reenrols.test.cjs
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

const flashed = [];
const world = { paired: 'KEY-OLD', personOn: false, entity: 'E1' };
const sandbox = {
  console, String, KEY_OK: true,
  paired: () => world.paired, personOn: () => world.personOn, onAgent: () => false,
  CloudHost: { person: { entity_id: 'E1' } }, S: { entity_id: 'E1' }, USIGN: { forceEnrol: false },
  ls: { get: () => '' }, shopLs: (k) => k, cbQuiet: () => {},
  flash: (ico, line) => { flashed.push(line); }, keyWord: () => 'Sign in again', noNet: () => '', pairAgain() {}, refresh() {}, openLineGrid() {},
  personRefused: () => ({ ico: '', line: 'person refused', fix: '', act: 'x' }), fromMenu() {}, STATE: {}, window: {}
};
vm.createContext(sandbox);
vm.runInContext(liftFns('public/till.html', ['refreshFailed', 'usignShopMove', 'shopMoveOf']) + '\nthis.refreshFailed = refreshFailed; this.usignShopMove = usignShopMove; this.shopMoveOf = shopMoveOf;', sandbox);

let bad = 0;
const ok = (m, c, info) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || !info ? '' : ' -> ' + info)); if (!c) bad++; };
const answer = (id) => ({ identity: { entity_id: id } });

sandbox.refreshFailed(500);
ok('a 500 (the shop did not answer) leaves the key as it was and says so', sandbox.KEY_OK === true && flashed[flashed.length - 1] === 'The shop did not answer', sandbox.KEY_OK + ' ' + flashed);
ok('with a working key a sign-in of the same shop is same (nothing to re-do)', sandbox.usignShopMove(answer('E1')) === 'same', sandbox.usignShopMove(answer('E1')));
ok('a different shop is other', sandbox.usignShopMove(answer('E2')) === 'other', sandbox.usignShopMove(answer('E2')));

sandbox.refreshFailed(401);
ok('a 401 on the snapshot marks the key refused and says "Due to maintenance"', sandbox.KEY_OK === false && flashed[flashed.length - 1] === 'Due to maintenance', sandbox.KEY_OK + ' ' + flashed);
ok('then the same shop\'s person door answers pair: it enrols afresh, never same (the 4 Oct loop)', sandbox.usignShopMove(answer('E1')) === 'pair', sandbox.usignShopMove(answer('E1')));
ok('a 403 does the same', (sandbox.KEY_OK = true, sandbox.refreshFailed(403), sandbox.KEY_OK === false), String(sandbox.KEY_OK));

sandbox.KEY_OK = true; world.paired = '';
ok('no key at all: pair', sandbox.usignShopMove(answer('E1')) === 'pair', '');
world.paired = 'KEY'; sandbox.KEY_OK = false; world.personOn = true;
ok('a person already billing as this very shop is replaced in place (same), even with a refused key', sandbox.usignShopMove(answer('E1')) === 'same', sandbox.usignShopMove(answer('E1')));
process.exitCode = bad ? 1 : 0;
