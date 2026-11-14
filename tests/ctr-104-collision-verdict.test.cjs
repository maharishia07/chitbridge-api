#!/usr/bin/env node
/**
 * ctr-104-collision-verdict.test.cjs — CTR-104 (proof 2026-11-14): the duplicate-bill tie-break is ONE function and both call sites give the same verdict.
 * @type regression
 * OWNS      on the real routes/chits.js code (tillCollisionVerdict + answerReplay lifted into a vm sandbox): same till and same billed_at = a retry (no collision); a different till = a collision
 *           naming both counters; the same till name at another moment = a collision with the "ALSO called" wording (the branch the race-catch once lacked); a missing moment on either side = no collision;
 *           call site 1 (answerReplay) answers 409 with exactly the verdict body and 200 duplicate for a retry; call site 2 (the race-catch in POST /chits/send) reaches the SAME function through replayRefusal,
 *           which reads the same four inputs (till id, stored till_id, both billed_at) the same way; and no second copy of the verdict (TILL_SERIES_COLLISION is written once in the route).
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      source text -> vm -> verdicts for hand-made (mine, theirs, myAt, theirAt)
 *   node tests/ctr-104-collision-verdict.test.cjs
 */
'use strict';
const vm = require('vm');
const { ok, done } = require('./lib/cat-proof-kit.cjs');
const { liftFns, source } = require('./lib/lift-fn.cjs');

const sent = [];
const sandbox = {
  String, Object, JSON,
  problem: (req, res, spec) => { sent.push({ kind: 'problem', spec }); return 'problem'; },
  /* the one database-bound step (CTR-204 same number, different sale) has its own proof; here a retry has no differing sale */
  replayOtherSale: async () => null,
  said: (body, code) => ({ body, code }),
  res: { status(n) { this.code = n; return this; }, json(b) { sent.push({ kind: 'json', code: this.code, body: b }); return 'json'; } }
};
vm.createContext(sandbox);
vm.runInContext(liftFns('routes/chits.js', ['tillCollisionVerdict', 'answerReplay', 'replayRefusal']) + '\nthis.verdict = tillCollisionVerdict; this.answerReplay = answerReplay;', sandbox);
const T1 = '2026-11-10T09:30:00.000Z', T2 = '2026-11-10T09:31:00.000Z';

const retry = sandbox.verdict('T1', 'T1', T1, T1, 'B-1');
ok('same till, same billed_at: a retry, not a collision', retry.collision === false, JSON.stringify(retry));
const other = sandbox.verdict('T1', 'T2', T1, T1, 'B-1');
ok('a different till on the same number: collision naming both (till T1, taken_by T2), code TILL_SERIES_COLLISION',
  other.collision && !other.sameName && other.body.till === 'T1' && other.body.taken_by === 'T2' && other.body.code === 'TILL_SERIES_COLLISION' && /counter T2, and this is counter T1/.test(other.body.message), JSON.stringify(other));
const same = sandbox.verdict('Counter', 'Counter', T1, T2, 'B-2');
ok('the same till name at another moment: collision with the "ALSO called Counter" wording', same.collision && same.sameName && /ALSO called Counter/.test(same.body.message), JSON.stringify(same));
ok('no billed_at on either side and no till pair: not a collision (an old client is a retry)', sandbox.verdict(null, null, null, T1, 'B-3').collision === false && sandbox.verdict('T1', null, T1, null, 'B-3').collision === false, '');

const site1 = async (mine, theirs, myAt, theirAt) => {
  sent.length = 0;
  const req = { body: { business_json: { till: mine ? { id: mine } : undefined, billed_at: myAt } } };
  await sandbox.answerReplay(req, sandbox.res, { chit_id: 'c-1', till_id: theirs, billed_at: theirAt }, 'B-1');
  return sent[0];
};
(async () => {
const a = await site1('T1', 'T2', T1, T1);
ok('call site 1 (the replay check) answers 409 with exactly the verdict body', a.kind === 'problem' && a.spec.status === 409 && JSON.stringify(a.spec.body) === JSON.stringify(sandbox.verdict('T1', 'T2', T1, T1, 'B-1').body), JSON.stringify(a));
const b = await site1('T1', 'T1', T1, T1);
ok('call site 1 answers a retry 200 duplicate with the chit that exists', b.kind === 'json' && b.code === 200 && b.body.duplicate === true && b.body.chit_id === 'c-1', JSON.stringify(b));

const src = source('routes/chits.js');
const callers = src.match(/tillCollisionVerdict\(/g) || [];
ok('tillCollisionVerdict( appears 2 times: its definition and its ONE caller, replayRefusal (CTR-204 folded the race-catch onto it)', callers.length === 2 && /const verdict = tillCollisionVerdict\(mine, seen\.till_id \|\| null, myAt, seen\.billed_at \? String\(seen\.billed_at\) : null, client_ref\)/.test(src), String(callers.length));
ok('the race-catch (call site 2) and the replay check (call site 1) both ask replayRefusal, so both read the same four things: till id, stored till_id, both billed_at',
  /const mine = \(businessJson && businessJson\.till && businessJson\.till\.id\) \|\| null;\s+const myAt = businessJson && businessJson\.billed_at \? String\(businessJson\.billed_at\) : null;/.test(src)
  && /await replayRefusal\(req, sender_id, seen, client_ref\)/.test(src) && /await replayRefusal\(req, who, seen, raceRef\)/.test(src), '');
ok('the verdict body is written once: TILL_SERIES_COLLISION appears one time in the route', (src.match(/TILL_SERIES_COLLISION/g) || []).length === 1, String((src.match(/TILL_SERIES_COLLISION/g) || []).length));
})().then(done);
