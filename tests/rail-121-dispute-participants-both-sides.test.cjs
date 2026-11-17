#!/usr/bin/env node
// @type: unit
/**
 * rail-121-dispute-participants-both-sides.test.cjs — RAIL-121 (cb-rail, walk W17 2026-10-25): "Dispute participants on the seller side shows only the raiser; the raiser's side
 * shows both". The cause was the per-copy dispute (b68): the party's copy carried a roster that named the raiser alone. Written 2026-11-14 (proof pass); no database.
 *   1  WRITE: POST /:chit_id/disputes builds the roster as the raiser AND every party and hands the SAME roster and audience to chit_dispute_deliver, which writes one copy per
 *      audience member — so the party's copy names both (lifted recordRaise run with a stand-in client; the roster built in the route read from its source).
 *   2  READ: finishDisputes, run for the PARTY (the seller) on a roster of raiser + party, answers participants = both, others = the raiser, mine = false; the raiser sees both
 *      and others = the party; the status of each is the roster's live one when it can be read.
 * HAND-COMPUTED: raiser R (buyer), party S (seller). Seller view: participants [R raiser, S party] (2), others [R] (1). Buyer view: participants 2, others [S].
 * RUN       node tests/rail-121-dispute-participants-both-sides.test.cjs     (tests/rail-sec-db-proofs.red.cjs breaks each line and shows this go red)
 * CARD      03-disputes-service-and-register/disputes-per-party-confidential
 */
'use strict';
const P = require('./lib-proof-mutate.cjs');
let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' :: ' + detail)); };

(async () => {
  const chits = P.read('routes/chits.js');
  const R = 'aaaaaaaa-0000-4000-8000-00000000000a', S = 'bbbbbbbb-0000-4000-8000-00000000000b';

  /* 1 · WRITE */
  const rosterAt = chits.indexOf("const roster = [{ entity_id, display_name: entityName, role: 'raiser' }]");
  const routeSrc = rosterAt >= 0 ? chits.slice(rosterAt, rosterAt + 900) : '';
  check('the route names the raiser AND every party in the roster it stores on every copy', /role: 'raiser' \}\]\.concat\(\s*partyIds\.map\(\(pid\) => \(\{ entity_id: pid, display_name: partyNames\[pid\] \|\| null, role: 'party' \}\)\)/.test(routeSrc), routeSrc.slice(0, 260));
  check('…and the audience that gets a copy is the raiser plus those parties', /const audience = \[\.\.\.new Set\(\[entity_id, \.\.\.partyIds\]\)\];/.test(routeSrc), routeSrc.slice(0, 400));
  check('…recordRaise is handed that roster and audience', /recordRaise\(client, \{[^}]*roster, audience, partyIds/.test(chits), 'recordRaise call');

  const sqls = [];
  const client = { query: async (sql, params) => { sqls.push({ sql: String(sql), params }); return { rows: [] }; } };
  const record = new Function('uuidv4', 'postMessageCopies', 'definersReady', P.lift(chits, 'recordRaise') + '\nreturn recordRaise;')(() => 'msg-1', async () => {}, async () => true);
  const roster = [{ entity_id: R, display_name: 'Buyer Shop', role: 'raiser' }, { entity_id: S, display_name: 'Seller Shop', role: 'party' }];
  await record(client, { dispute_id: 'd-1', chit_id: 'c-1', raiser_id: R, raiser_name: 'Buyer Shop', actor_name: 'Asha', target_id: S, target_name: 'Seller Shop', scope: 'targeted', parity: { mode: 'two_sided', answerable: true, parity_state: 'both' }, via: 'app', category: 'quality', reason: 'cracked pads', evidence: {}, roster, audience: [R, S], partyIds: [S], ready: true });
  const deliver = sqls.find((x) => /chit_dispute_deliver/.test(x.sql));
  const sent = deliver ? JSON.parse(deliver.params[14]) : [];
  check('the definer that writes the per-party copies receives BOTH names in the roster', sent.length === 2 && sent.some((x) => x.entity_id === R && x.role === 'raiser') && sent.some((x) => x.entity_id === S && x.role === 'party'), deliver && deliver.params[14]);
  check('…and BOTH entity ids as the audience (one copy each)', deliver && deliver.params[15].length === 2 && deliver.params[15].includes(R) && deliver.params[15].includes(S), deliver && JSON.stringify(deliver.params[15]));

  /* 2 · READ */
  const liveStatus = [{ dispute_id: 'd-1', entity_id: R, role: 'raiser', status: 'open' }, { dispute_id: 'd-1', entity_id: S, role: 'party', status: 'open' }];
  const stubQuery = async () => ({ rows: liveStatus });
  const finish = new Function('query', 'railActions', 'disputeMay', 'log', P.lift(chits, 'finishDisputes') + '\nreturn finishDisputes;')(
    stubQuery, { can: () => true }, { resolve: () => ({ allowed: true }) }, { warn() {} });
  const row = { dispute_id: 'd-1', chit_id: 'c-1', status: 'open', raised_by_entity_id: R, category: 'quality', roster, evidence_snapshot: { x: 1 } };
  const seller = (await finish([row], S, {}))[0];
  check('SELLER side: participants shows BOTH (raiser and party), not only the raiser', seller.participants.length === 2 && seller.participants.map((x) => x.entity_id).sort().join() === [R, S].sort().join(), JSON.stringify(seller.participants));
  check('…each with its name and role, so the screen can say who is who', seller.participants.find((x) => x.entity_id === R).display_name === 'Buyer Shop' && seller.participants.find((x) => x.entity_id === S).role === 'party', JSON.stringify(seller.participants));
  check('…others is the raiser alone and the seller is not the raiser (mine is false)', seller.others.length === 1 && seller.others[0].entity_id === R && seller.mine === false, JSON.stringify({ others: seller.others, mine: seller.mine }));
  const buyer = (await finish([row], R, {}))[0];
  check('RAISER side: participants shows both too, others is the seller, mine is true', buyer.participants.length === 2 && buyer.others.length === 1 && buyer.others[0].entity_id === S && buyer.mine === true, JSON.stringify(buyer));
  check('the evidence is never carried to either side (presence only)', seller.evidence_snapshot === undefined && seller.has_evidence === true && buyer.evidence_snapshot === undefined, JSON.stringify(seller));

  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL the test itself threw :: ' + e.stack); process.exit(1); });
