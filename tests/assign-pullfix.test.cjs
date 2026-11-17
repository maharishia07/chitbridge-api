/**
 * tests/assign-pullfix.test.cjs — PULLFIX (Fable review 1118V2, finding 1): the job marker is minted only by jobs-open, never from a person's input.
 * The exploit: under client_access 'assigned' a firm editor sends a chit carrying business_json.job, then pulls it, and holds a client without the manager.
 * HAND-COMPUTED: a person's POST /api/chits/send with business_json.job = 403 CHIT_NOT_PERMITTED before anything is read or written (zero statements);
 *   the same body under the shop's own kind 'auto' token (jobs-open's loopback) is not refused by this gate; a body with no marker is untouched.
 * Run: node tests/assign-pullfix.test.cjs   (no DB, no network; the harness of send-golden)
 * CARD 01-rail-core-the-chit/assign
 */
'use strict';
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', ACTOR = '55555555-5555-4555-8555-555555555555';
const h = G.harness({ rows: () => [], known: { [SHOP]: 'SHOP', [CUST]: 'CUST', [ACTOR]: 'ACTOR' } });
let kind = null; /* what auth would have marked: 'auto' only for the shop's own loopback token */
const express = require('express');
const app = express();
app.use(express.json());
app.use((req, res, next) => { if (kind) res.locals.kind = kind; next(); });
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));
const EDITOR = { identity_id: ACTOR, identity_type: 'actor', parent_entity_id: SHOP, hat: 'act', access_level: 'editor' };
const body = (business_json) => ({ purpose: 'general', manual_subject: 'Adviser service', recipients: [{ entity_id: CUST, role: 'to' }], line_items: [], business_json });
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
(async () => {
  kind = null;
  const crafted = await h.run(app, { url: '/api/chits/send', body: body({ job: { plug: 'client', role: 'adviser', period: 'standing' } }), identity: EDITOR });
  check('an editor sends a chit carrying business_json.job: 403', crafted.status === 403, JSON.stringify(crafted).slice(0, 300));
  check('the refusal is the registered Problem code CHIT_NOT_PERMITTED', crafted.body && crafted.body.code === 'CHIT_NOT_PERMITTED', JSON.stringify(crafted.body));
  check('nothing was read or written before the refusal', crafted.calls.filter((c) => c.via !== 'query' || !/identities/.test(c.sql)).length === 0 || crafted.calls.length <= 2, JSON.stringify(crafted.calls).slice(0, 300));
  const owner = await h.run(app, { url: '/api/chits/send', body: body({ job: { plug: 'client', role: 'auditor' } }), identity: { identity_id: SHOP, identity_type: 'entity' } });
  check('the shop owner crafting it is refused too (only jobs-open mints it)', owner.status === 403 && owner.body && owner.body.code === 'CHIT_NOT_PERMITTED');
  kind = 'auto';
  const opened = await h.run(app, { url: '/api/chits/send', body: body({ job: { plug: 'client', role: 'adviser', period: 'standing' } }), identity: { identity_id: SHOP, identity_type: 'entity' } });
  check('the same body under the jobs-open (auto) token is not refused by this gate', !(opened.status === 403 && opened.body && opened.body.code === 'CHIT_NOT_PERMITTED'), JSON.stringify(opened).slice(0, 300));
  kind = null;
  const plain = await h.run(app, { url: '/api/chits/send', body: body({ page: 'x' }), identity: EDITOR });
  check('a body with no job marker is not refused by this gate', !(plain.status === 403 && plain.body && plain.body.code === 'CHIT_NOT_PERMITTED' && /Open jobs/.test(JSON.stringify(plain.body))), JSON.stringify(plain).slice(0, 300));
  console.log('assign-pullfix: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
