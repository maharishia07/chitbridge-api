/**
 * chit-proposals-scenes.cjs — the named scenarios of tests/api-problem-chit-proposals.test.cjs: an answer the generic worlds cannot reach (a refusal inside lib/chit-proposal, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per refusal the proposal doors answer (routes/chit-proposals.js over lib/chit-proposal.js), and one per success answer, each with the stand-in rows it needs
 *           (answered by the shape of the statement, as RLS and `WHERE entity_id = $2` would: a copy is found only for the shop that holds it).
 * CALLED BY tests/api-problem-chit-proposals.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, patch, body, url }] → the harness runs each one against the real route
 * CARD      01-rail-core-the-chit/chit-proposal
 */
'use strict';

const C = '/api/chits';
const SHOP = '11111111-1111-4111-8111-111111111111';
const PARTY = '22222222-2222-4222-8222-222222222222'; /* the chit id the harness puts in the path */
const OTHER = '33333333-3333-4333-8333-333333333333'; /* the other party on the chit */
const ROUND_A = 'a0000000-0000-4000-8000-00000000000a';
const ROUND_B = 'b0000000-0000-4000-8000-00000000000b';
const MIGRATED = /information_schema\.tables/;
/** the migration probe: the chit_proposal table is there */
const migrated = (sql) => (MIGRATED.test(sql) ? { rows: [{ '?column?': 1 }], rowCount: 1 } : null);

/** the copy a shop holds: an order it sent to OTHER (so this shop is the buyer and OTHER the seller); `rfq` makes it a proposal deal (business_json.deal_type) */
function copyRows(owner, options) {
  const choice = Object.assign({ rfq: true, proposals: [] }, options);
  const header = {
    sender_entity_id: owner,
    purpose: 'order',
    business_json: choice.rfq ? { deal_type: 'rfq' } : {},
    summary_json: {},
    all_recipients: [{ entity_id: owner, display_name: 'Test shop', role: 'sender' }, { entity_id: OTHER, display_name: 'Other shop', role: 'receiver' }]
  };
  const detail = { line_items: [{ particulars: 'Pump', quantity: 2, price: 100 }], currency_code: 'INR' };
  return (sql, params) => {
    const held = params && String(params[1]) === String(owner); /* the copy is found only for the shop that holds it */
    if (/FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2/.test(sql)) return held ? { rows: [header], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (/FROM chit_detail WHERE chit_id = \$1 AND entity_id = \$2/.test(sql)) return held ? { rows: [detail], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (/FROM chit_proposal WHERE entity_id = \$1 AND chit_id = \$2 ORDER BY/.test(sql)) return params && String(params[0]) === String(owner) ? { rows: choice.proposals, rowCount: choice.proposals.length } : { rows: [], rowCount: 0 };
    if (/FROM chit_proposal WHERE entity_id = \$1 AND chit_id = \$2 AND proposal_id = \$3/.test(sql)) {
      const found = String(params[0]) === String(owner) ? choice.proposals.filter((row) => row.proposal_id === params[2]) : [];
      return { rows: found, rowCount: found.length };
    }
    if (/SELECT bridge_id, display_name FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [{ bridge_id: 'CBTEST0001', display_name: 'Test shop' }], rowCount: 1 };
    return migrated(sql);
  };
}

/** a round on the chit as the table holds it */
function round(id, more) {
  return Object.assign({ proposal_id: id, entity_id: SHOP, chit_id: PARTY, round: 2, kind: 'pro_forma', from_entity_id: OTHER, from_bridge_id: 'CBOTHER001', from_name: 'Other shop', status: 'proposed', edits: [], request: null, invoice: null, summary: { money: { net: 200 } }, currency_code: 'AUD', tax_note: null, base_hash: 'stale', note: null, created_at: '2026-10-25T00:00:00.000Z', decided_at: null, decided_by: null }, more);
}

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { OWNER, STAFF } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const VIEWER = Object.assign({}, STAFF, { access_level: 'viewer' });
  const withRows = (answer) => ({ sqlRows: answer });
  const at = (tail) => C + '/' + PARTY + '/proposals' + tail;
  const LIST = 'GET ' + C + '/:chit_id/proposals';
  const PROPOSE = 'POST ' + C + '/:chit_id/proposals';
  const ACCEPT = 'POST ' + C + '/:chit_id/proposals/:proposal_id/accept';
  const REJECT = 'POST ' + C + '/:chit_id/proposals/:proposal_id/reject';
  const COUNTER = 'POST ' + C + '/:chit_id/proposals/:proposal_id/counter';
  const openRound = round(ROUND_A);
  const decidedRound = round(ROUND_A, { status: 'rejected', decided_at: '2026-10-25T01:00:00.000Z', decided_by: 'Test shop' });
  const myRound = round(ROUND_A, { from_entity_id: OWNER.identity_id, from_name: 'Test shop' });
  const olderRound = round(ROUND_A, { round: 2 });
  const newerRound = round(ROUND_B, { round: 3 });
  const requestRound = round(ROUND_A, { kind: 'request', request: { lines: [{ line_index: 0, quantity: 3 }] }, currency_code: null, summary: null });
  /** the table is there but every later statement fails with the text a caller must never see */
  const failsAfterSetup = (sql) => {
    const probe = migrated(sql);
    if (probe) return probe;
    throw new Error(tools.SECRET_SQL);
  };
  return [
    /* ── the list ── */
    X('not-set-up-yet-lists-none', LIST, 200, {}),
    X('rounds-listed', LIST, 200, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [openRound] })) }),
    X('rounds-listed-by-staff', LIST, 200, { setup: Object.assign({ who: STAFF }, withRows(copyRows(OWNER.identity_id, { proposals: [openRound] }))) }),
    X('list-chit-not-held', LIST, 404, { setup: withRows(migrated) }),
    X('list-read-fails', LIST, 500, { setup: withRows(failsAfterSetup) }),
    X('list-viewer-refused', LIST, 403, { setup: { who: VIEWER } }),
    /* ── putting a round forward ── */
    X('propose-not-set-up', PROPOSE, 503, { body: { lines: [{ line_index: 0, quantity: 3 }] } }),
    X('propose-chit-not-held', PROPOSE, 404, { setup: withRows(migrated), body: { lines: [{ line_index: 0, quantity: 3 }] } }),
    X('propose-domestic-chit', PROPOSE, 409, { setup: withRows(copyRows(OWNER.identity_id, { rfq: false })), body: { lines: [{ line_index: 0, quantity: 3 }] } }),
    X('propose-says-nothing', PROPOSE, 400, { setup: withRows(copyRows(OWNER.identity_id)), body: {} }),
    X('propose-quantity-not-a-number', PROPOSE, 400, { setup: withRows(copyRows(OWNER.identity_id)), body: { lines: [{ line_index: 0, quantity: 'many' }] } }),
    X('propose-terms-say-nothing', PROPOSE, 400, { setup: withRows(copyRows(OWNER.identity_id)), body: { terms: {} } }),
    X('propose-unknown-key-refused', PROPOSE, 422, { setup: withRows(copyRows(OWNER.identity_id)), body: { lines: [], price_total: 10 } }),
    X('propose-lines-not-a-list', PROPOSE, 422, { setup: withRows(copyRows(OWNER.identity_id)), body: { lines: 'all of them' } }),
    X('propose-nobody-else-on-the-chit', PROPOSE, 409, { setup: withRows(copyRows(OWNER.identity_id)), body: { note: 'please' }, patch: { proposal: { propose: async () => null } } }),
    X('propose-request-recorded', PROPOSE, 200, { setup: withRows(copyRows(OWNER.identity_id)), body: { lines: [{ line_index: 0, quantity: 3, requested_price: '90' }], note: 'Three, please' } }),
    X('propose-line-without-item', PROPOSE, 400, { setup: withRows(copyRows(OWNER.identity_id)), body: { lines: [{ line_index: 0, quantity: 2 }] }, patch: { proposal: { propose: async () => { throw Object.assign(new Error('A replacement line needs an item. To remove the line, send line: null.'), { status: 400, code: 'AMEND_LINE_NEEDS_ITEM' }); } } } }),
    X('propose-write-fails', PROPOSE, 500, { setup: withRows(failsAfterSetup), body: { note: 'please' } }),
    X('propose-viewer-refused', PROPOSE, 403, { setup: { who: VIEWER }, body: { note: 'please' } }),
    /* ── deciding ── */
    X('accept-not-set-up', ACCEPT, 503, { body: {} }),
    X('accept-chit-not-held', ACCEPT, 404, { setup: withRows(migrated), body: {} }),
    X('accept-no-such-round', ACCEPT, 404, { setup: withRows(copyRows(OWNER.identity_id)), url: at('/' + ROUND_B + '/accept'), body: {} }),
    X('accept-my-own-round', ACCEPT, 403, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [myRound] })), url: at('/' + ROUND_A + '/accept'), body: {} }),
    X('accept-round-already-decided', ACCEPT, 409, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [decidedRound] })), url: at('/' + ROUND_A + '/accept'), body: {} }),
    X('accept-older-round', ACCEPT, 409, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [olderRound, newerRound] })), url: at('/' + ROUND_A + '/accept'), body: {} }),
    X('accept-a-request', ACCEPT, 409, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [requestRound] })), url: at('/' + ROUND_A + '/accept'), body: {} }),
    X('accept-stale-round', ACCEPT, 409, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [openRound] })), url: at('/' + ROUND_A + '/accept'), body: { note: 'yes' } }),
    X('accept-unknown-key-refused', ACCEPT, 422, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [openRound] })), url: at('/' + ROUND_A + '/accept'), body: { note: 'yes', signed: true } }),
    X('accept-read-fails', ACCEPT, 500, { setup: withRows(failsAfterSetup), body: {} }),
    X('reject-round', REJECT, 200, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [openRound] })), url: at('/' + ROUND_A + '/reject'), body: { note: 'Too dear' } }),
    X('reject-unknown-key-refused', REJECT, 422, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [openRound] })), url: at('/' + ROUND_A + '/reject'), body: { reason: 'Too dear' } }),
    X('reject-read-fails', REJECT, 500, { setup: withRows(failsAfterSetup), body: {} }),
    X('reject-no-such-round', REJECT, 404, { setup: withRows(copyRows(OWNER.identity_id)), url: at('/' + ROUND_B + '/reject'), body: {} }),
    X('reject-viewer-refused', REJECT, 403, { setup: { who: VIEWER }, body: {} }),
    /* ── countering ── */
    X('counter-not-set-up', COUNTER, 503, { body: { note: 'less' } }),
    X('counter-chit-not-held', COUNTER, 404, { setup: withRows(migrated), body: { note: 'less' } }),
    X('counter-says-nothing', COUNTER, 400, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [openRound] })), url: at('/' + ROUND_A + '/counter'), body: {} }),
    X('counter-recorded', COUNTER, 200, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [openRound] })), url: at('/' + ROUND_A + '/counter'), body: { lines: [{ line_index: 0, quantity: 2, requested_price: '80' }], note: 'Less, please' } }),
    X('counter-unknown-key-refused', COUNTER, 422, { setup: withRows(copyRows(OWNER.identity_id, { proposals: [openRound] })), url: at('/' + ROUND_A + '/counter'), body: { note: 'less', currency_code: 'AUD' } }),
    X('counter-nobody-else-on-the-chit', COUNTER, 409, { setup: withRows(copyRows(OWNER.identity_id)), body: { note: 'less' }, patch: { proposal: { propose: async () => null } } }),
    X('counter-write-fails', COUNTER, 500, { setup: withRows(failsAfterSetup), body: { note: 'less' } })
  ];
}

module.exports = { extras, copyRows, round, migrated, OTHER, ROUND_A, ROUND_B, PARTY };
