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
const object = (required, properties, closed) => Object.assign({ type: 'object', required, properties: properties || {} }, closed ? { additionalProperties: false } : {});
const FAULT = refused('a fault of ours');
const PEER_REFUSED = refused('the installation is not one we deal with, or its manifest cannot be read, or the message is not signed by it');
const PEER_HOSTED_HERE = refused('the installation is hosted here, so it must not arrive over the wire');
/* the envelope's version: a major with an optional minor ('1', '1.2'); which major we read is the door's refusal, not the schema's (lib/ctpenvelope versionRefusal) */
const VERSION = { type: 'string', pattern: '^[0-9]+([.][0-9]+)*$', examples: ['1'] }; /* a pattern a bare sample cannot meet names its own example (the contract generator's valid case) */
/* S33-T (tolerant by design) · RAIL-126 (decided 6 Nov 2026): CTP/1 inbound is a tolerant reader. The three keys the doors read each say what they hold: the object they are, and the one text inside each that the handler reads
   (to.bridge_id, from.installation_key, ask.want). Nothing inside is closed: an unknown field of a peer on a higher minor is ignored, and the later checks still answer in their own words (a peer is never sent a 422). */
const SIGNED_BY = { from: { type: 'object', description: 'the sending installation ({installation_key}) — checked against the key on its own domain', properties: { installation_key: text } } };
const TO_KEY = { type: 'object', description: 'the recipient ({bridge_id}) — resolved here, never trusted', properties: { bridge_id: text } };
const ASK_KEY = { type: 'object', description: "{ want: 'resolve' | 'catalogue' | 'search' (q, kind, limit), … }", properties: { want: text } };

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
          note: text,
          domain: maybeText,
          membership: { type: ['object', 'null'] },
          network_fingerprint: text
        }, true)
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
    content: json(object(['ctp'], Object.assign({ ctp: VERSION, to: TO_KEY }, SIGNED_BY)))
  },
  responses: {
    200: {
      description: 'accepted and written as the recipient here',
      content: json(object(['accepted', 'chit_id', 'to'], { accepted: { type: 'boolean', enum: [true] }, repeat: { type: 'boolean' }, duplicate: { type: 'boolean' }, applied: { type: 'boolean' }, why: maybeText, chit_id: text, to: text, sender_governance: { type: ['object', 'null'] } }, true))
    },
    400: refused('not a CTP/1 envelope, or it names no recipient, no installation or no sender'),
    403: PEER_REFUSED,
    404: refused('no active business here with that bridge id'),
    409: refused('hosted here, the crossing is refused, or the envelope does not open'),
    500: FAULT,
    503: refused('this installation cannot check whether the crossing is permitted — it refuses rather than guess')
  }
};
/* API-7 / S34: the answer to a signed question is ONE of eight, so its closed schema is the union of the top-level keys the eight handlers name (nested rows stay open: a catalogue's items and a directory are the seller's and the master's own shapes).
   routes/ctp.js answerResolve · answerCatalogue (+ catalogue publicResponseFor) · answerSearch · lib/ctpreturn attachmentFor · lib/netmember answerCertificate / answerDirectory / answerLocate / answerChanges. A key a handler adds later
   must be added here, or output_allowlist reports it (and drops it under OUTPUT_ALLOWLIST=enforce). The peer's readers (lib/remote-party, remote-catalogue, network-search, netsync, netmember, ctpreturn) read only keys below. */
const QUERY_ANSWER_KEYS = {
  ok: { type: 'boolean' }, found: { type: 'boolean' }, why: text,
  bridge_id: text, display_name: text, user_id: text, address: text, installation_key: text, sells_outside: { type: 'boolean' },
  shop: {}, sign_in: {}, schema: {}, fields: {}, items: {}, groups: {}, lines: {}, catalogue_summary: {}, unpriced_hidden: {}, offers: {}, categories: {}, finishes: {},
  results: { type: 'array', items: { type: 'object' } }, searched: { type: 'integer' },
  name: text, mime: text, size: { type: 'integer' }, sha256: text, data_base64: text,
  membership: {}, directory: {}, sealed: {}, hints: { type: 'array', items: { type: 'object' } }, changes: { type: 'array', items: { type: 'object' } }, entities: { type: 'integer' }, last_seq: { type: 'integer' }
};
const QUERY_OPERATION = {
  summary: 'A signed question from a peer: resolve a business, pull its public catalogue (the same view an anonymous visitor gets), or search its listed shops (NET-39)',
  tags: ['ctp'],
  security: [],
  requestBody: {
    required: true,
    content: json(object(['ctp', 'kind'], Object.assign({ ctp: VERSION, kind: { type: 'string', enum: ['query'] }, ask: ASK_KEY }, SIGNED_BY)))
  },
  responses: {
    200: {
      description: 'the answer, found or not (a search: results = listed shops with public fields only, and how many were searched)',
      content: json(object(['ok'], QUERY_ANSWER_KEYS, true))
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

module.exports = { QUERY_ANSWER_KEYS, MANIFEST_OPERATION, DELIVER_OPERATION, QUERY_OPERATION, ENVELOPE_REFUSAL, QUERY_REFUSAL, MANIFEST_FAILED, STORE_FAILED, QUERY_FAILED, crossingRefused };
