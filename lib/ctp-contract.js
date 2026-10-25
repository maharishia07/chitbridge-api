/*
 * OWNS      the contract of routes/ctp.js: each door's OpenAPI operation (S9), the codes of its refusals, and the answers those doors gave
 *           before the standard (S2, S14). CTP's doors answer OTHER INSTALLATIONS: lib/ctptransport reads `accepted` and `why` (any content
 *           type), so every refusal keeps those keys word for word beside the Problem fields. A peer is never sent a 422.
 * CALLED BY routes/ctp.js (schemaValidate on /deliver and /query, router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json.
 * FLOW      operation → schemaValidate(operation, refusal) at the door → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const { problemResponse } = require('./problem');

/* ── the contract: each door's OpenAPI operation, the ONE source the register, the contract tests, schemaValidate and /api/openapi.json share ──
   ⚠️ a body declares only what the door's FIRST check refuses (ctp, kind): every later check answers in its own old words, and a schema
   that refused a malformed `to` would answer "not a CTP/1 envelope" where a peer was told "the envelope does not name a recipient". */
const refused = problemResponse;
const json = (schema) => ({ 'application/json': { schema } });
const text = { type: 'string' };
const maybeText = { type: ['string', 'null'] };
const object = (required, properties) => ({ type: 'object', required, properties: properties || {} });
const FAULT = refused('a fault of ours');
const PEER_REFUSED = refused('the installation is not one we deal with, or its manifest cannot be read, or the message is not signed by it');
const PEER_HOSTED_HERE = refused('the installation is hosted here, so it must not arrive over the wire');
const SIGNED_BY = { from: { description: 'the sending installation ({installation_key}) — checked against the key on its own domain' } };

const MANIFEST_OPERATION = {
  summary: 'Who this installation is: its key, its endpoint and the worlds it accepts (public, cacheable)',
  tags: ['ctp'],
  security: [],
  responses: {
    200: {
      description: 'the manifest',
      content: json(
        object(['ctp', 'installation_key', 'accepts_populations', 'public_key', 'can_sign'], {
          ctp: { type: 'string', enum: ['1'] },
          installation_key: text,
          label: maybeText,
          region: maybeText,
          endpoint: maybeText,
          accepts_populations: { type: 'array', items: text },
          public_key: maybeText,
          can_sign: { type: 'boolean' },
          note: text
        })
      )
    },
    500: FAULT
  }
};
const DELIVER_OPERATION = {
  summary: 'The receiving door: one signed envelope, one copy, one recipient here (unauthenticated: the signature stands in)',
  tags: ['ctp'],
  security: [],
  requestBody: {
    required: true,
    content: json(object(['ctp'], Object.assign({ ctp: { type: 'string', enum: ['1'] }, to: { description: 'the recipient ({bridge_id}) — resolved here, never trusted' } }, SIGNED_BY)))
  },
  responses: {
    200: {
      description: 'accepted and written as the recipient here',
      content: json(object(['accepted', 'chit_id', 'to'], { accepted: { type: 'boolean', enum: [true] }, chit_id: text, to: text, sender_governance: { type: ['object', 'null'] } }))
    },
    400: refused('not a CTP/1 envelope, or it names no recipient, no installation or no sender'),
    403: PEER_REFUSED,
    404: refused('no active business here with that bridge id'),
    409: refused('hosted here, the crossing is refused, or the envelope does not open'),
    500: FAULT,
    503: refused('this installation cannot check whether the crossing is permitted — it refuses rather than guess')
  }
};
const QUERY_OPERATION = {
  summary: 'A signed question from a peer: resolve a business, pull its public catalogue (the same view an anonymous visitor gets), or search its listed shops (NET-39)',
  tags: ['ctp'],
  security: [],
  requestBody: {
    required: true,
    content: json(object(['ctp', 'kind'], Object.assign({ ctp: { type: 'string', enum: ['1'] }, kind: { type: 'string', enum: ['query'] }, ask: { description: "{ want: 'resolve' | 'catalogue' | 'search' (q, kind, limit), … }" } }, SIGNED_BY)))
  },
  responses: {
    200: {
      description: 'the answer, found or not (a search: results = listed shops with public fields only, and how many were searched)',
      content: json(object(['ok', 'found'], { ok: { type: 'boolean' }, found: { type: 'boolean' }, why: text, bridge_id: text, results: { type: 'array', items: { type: 'object' } }, searched: { type: 'integer' } }))
    },
    400: refused('not a CTP/1 query, no installation named, or not a question this installation answers'),
    403: PEER_REFUSED,
    409: PEER_HOSTED_HERE,
    500: FAULT
  }
};

/* ── the answers these doors gave before the standard (docs/contracts/api-legacy.json): the keys a peer reads, frozen ── */
const NOT_AN_ENVELOPE = 'not a CTP/1 envelope';
const NOT_A_QUERY = 'not a CTP/1 query';
/* a body the schema refuses: the old 400 in the old words, never S4's 422 (another installation reads `why`) */
const ENVELOPE_REFUSAL = { status: 400, code: 'CTP_NOT_AN_ENVELOPE', legacy: () => ({ accepted: false, why: NOT_AN_ENVELOPE }) };
const QUERY_REFUSAL = { status: 400, code: 'CTP_NOT_A_QUERY', legacy: () => ({ ok: false, why: NOT_A_QUERY }) };
/* fail closed: a 5xx says which side failed and nothing of why (before slice 1d the query's `why` went on with the error text) */
const MANIFEST_FAILED = { error: 'manifest unavailable' };
const STORE_FAILED = { accepted: false, why: 'this installation failed to store it' };
const QUERY_FAILED = { ok: false, why: 'this installation could not answer' };

/** crossingRefused(population, installation) → why a crossing is refused: `live` is shared by name; any other world is a LOCAL name that must
 *  name the installation as a peer first (CTP-DESIGN §7.1) — the old words, a peer reads them */
const crossingRefused = (population, installation) =>
  population === 'live' ? 'refused' : '“' + population + '” is a local name on both sides — it must name ' + installation + ' as a peer first';

module.exports = { MANIFEST_OPERATION, DELIVER_OPERATION, QUERY_OPERATION, ENVELOPE_REFUSAL, QUERY_REFUSAL, MANIFEST_FAILED, STORE_FAILED, QUERY_FAILED, crossingRefused };
