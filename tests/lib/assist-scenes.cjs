/**
 * assist-scenes.cjs — the named scenarios of tests/api-problem-assist.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per answer of the 22 routes of routes/assist.js (the assistant, the conform check, the catalogue-source authoring, the containers and regions,
 *           the help desk's publish), each with the stand-in rows, the stand-in model and the stand-in token it needs (answered by the shape of the statement, so the same facts meet old and new code).
 * CALLED BY tests/api-problem-assist.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, patch, env, headers, body, url, throws }] → the harness runs each one against the real route
 * CARD      28-platform-and-operations/assist
 * `throws: true` marks a scene whose stand-in raises the database's own words: the test scans EVERY answer of it, a 200 included, for those words (round-1 rule 8).
 */
'use strict';

const AS = '/api/assist';
const OTHER = '88888888-8888-4888-8888-888888888888';
const STRANGER_ID = '66666666-6666-4666-8666-666666666666';
const KNOWN_SOURCE = 'beta-royale-play@v1';
const BEARER = { authorization: 'Bearer stand-in' };
const MODEL_ON = { ASSIST_LLM_PROVIDER: 'anthropic' };

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { SHOP, SECRET_SQL, answering, raising, firstOf, standard } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const at = (tail) => AS + tail;
  const boom = () => {
    throw new Error(SECRET_SQL);
  };
  const boomLater = async () => boom();
  const refusedWith = (status) => async () => {
    throw Object.assign(new Error(SECRET_SQL), { status });
  };
  const failing = { db: 'fail' };
  const asStranger = { who: { identity_id: STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' } };
  /** a signed-in caller for the assistant's soft sign-in, and a model that answers */
  const signedIn = { jwt: { verifyJwt: () => ({ claims: { identity_id: SHOP, identity_type: 'entity' } }) } };
  const model = (text) => ({ ai: { invokeSkill: async () => ({ draft: text, model: 'stand-in', usage: { input_tokens: 1, output_tokens: 2 } }) } });
  const modelRefuses = (status) => ({ ai: { invokeSkill: refusedWith(status) } });
  const live = (patch) => ({ env: MODEL_ON, headers: BEARER, patch: Object.assign({}, signedIn, patch) });
  const containerRow = (owner) => answering(/FROM product_container/, [{ container_id: 'a/b', owner_entity_id: owner, source_key: 's', name: 'N', current_version: 1 }]);
  const versionRow = answering(/FROM product_version/, [{ container_id: 'a/b', version: 1, content: { a: 1 }, schema: {}, schema_version: null, minted_at: '2026-10-01T00:00:00.000Z' }]);
  const adoption = answering(/FROM catalogue_adoption/, [{ source_key: KNOWN_SOURCE, version: 'v1', commercials: {}, visible: true, updated_at: '2026-10-01T00:00:00.000Z' }]);
  const helpDesk = answering(/schema_name = 'Assistant Q&A'/, [{ '?column?': 1 }]);
  const fixedClock = { clock: { now: () => 1760000000000 }, dice: { random: () => 0.5 } };

  const assistant = [
    X('ask-nothing', 'POST ' + AS, 422, { body: {} }),
    X('ask-too-long', 'POST ' + AS, 422, { body: { q: 'x'.repeat(501) } }),
    X('ask-a-list', 'POST ' + AS, 422, { body: [1, 2] }),
    X('ask-not-configured', 'POST ' + AS, 503, { body: { q: 'what is a chit?' } }),
    X('ask-anonymous', 'POST ' + AS, 503, { body: { q: 'what is a chit?' }, env: MODEL_ON }),
    X('ask-answered', 'POST ' + AS, 200, { body: { q: 'what is a chit?', context: 'compose' }, ...live(model('A chit is a shared record.')) }),
    X('ask-empty-answer', 'POST ' + AS, 502, { body: { q: 'what is a chit?' }, ...live(model('   ')) }),
    X('ask-wallet-empty', 'POST ' + AS, 503, { body: { q: 'hi there' }, ...live(modelRefuses(402)) }),
    X('ask-rate-held', 'POST ' + AS, 503, { body: { q: 'hi there' }, ...live(modelRefuses(429)) }),
    X('ask-day-cap', 'POST ' + AS, 503, { body: { q: 'hi there' }, ...live(modelRefuses(503)) }),
    X('ask-model-fails', 'POST ' + AS, 502, { body: { q: 'hi there' }, throws: true, ...live(modelRefuses(500)) }),
    X('ask-model-throws', 'POST ' + AS, 502, { body: { q: 'hi there' }, throws: true, ...live({ ai: { invokeSkill: boomLater } }) }),
    X('ask-fault', 'POST ' + AS, 500, { body: { q: 'what is a chit?' }, throws: true, patch: { log: { info: boom } } })
  ];

  const conform = [
    X('conform-needs-a-standard', 'POST ' + at('/conform'), 422, { body: {} }),
    X('conform-unknown-standard', 'POST ' + at('/conform'), 404, { body: { standard: 'nope' } }),
    X('conform-checked', 'POST ' + at('/conform'), 200, { body: { standard, payload: {} } }),
    X('conform-with-narrative', 'POST ' + at('/conform'), 200, { body: { standard, payload: {} }, ...live(model('Fix the missing points.')) }),
    X('conform-narrative-fails', 'POST ' + at('/conform'), 200, { body: { standard, payload: {} }, throws: true, ...live(modelRefuses(500)) }),
    X('conform-fault', 'POST ' + at('/conform'), 500, { body: { standard }, throws: true, patch: { compliance: { getTemplate: boom } } }),
    X('standards-listed', 'GET ' + at('/standards'), 200, {})
  ];

  const structure = [
    X('sources-listed', 'GET ' + at('/catalogue-sources'), 200, {}),
    X('structure-unknown-source', 'POST ' + at('/catalogue-structure'), 404, { body: { source: 'nope@v1' } }),
    X('structure-built', 'POST ' + at('/catalogue-structure'), 200, { body: {} }),
    X('structure-with-intro', 'POST ' + at('/catalogue-structure'), 200, { body: {}, ...live(model('A lovely collection.')) }),
    X('structure-intro-fails', 'POST ' + at('/catalogue-structure'), 200, { body: {}, throws: true, ...live(modelRefuses(500)) }),
    X('structure-fault', 'POST ' + at('/catalogue-structure'), 500, { body: {}, throws: true, patch: { catalogueBuild: { build: boomLater } } }),
    X('source-read', 'GET ' + at('/catalogue-source/:key'), 200, { url: at('/catalogue-source/' + KNOWN_SOURCE)}),
    X('source-unknown', 'GET ' + at('/catalogue-source/:key'), 404, { url: at('/catalogue-source/nope@v1') }),
    X('source-fault', 'GET ' + at('/catalogue-source/:key'), 500, { url: at('/catalogue-source/' + KNOWN_SOURCE), throws: true, patch: { catalogueBuild: { build: boomLater } } })
  ];

  const adopt = [
    X('adopt-unknown-source', 'POST ' + at('/catalogue-adopt'), 404, { body: { source: 'nope@v1' } }),
    X('adopt-done', 'POST ' + at('/catalogue-adopt'), 200, { body: { commercials: {} } }),
    X('adopt-hidden', 'POST ' + at('/catalogue-adopt'), 200, { body: { visible: false } }),
    X('adopt-store-missing', 'POST ' + at('/catalogue-adopt'), 503, { body: {}, setup: { sqlRows: raising(/INSERT INTO catalogue_adoption/, '42P01') } }),
    X('adopt-fault', 'POST ' + at('/catalogue-adopt'), 500, { body: {}, throws: true, patch: { catalogueBuild: { resolve: boomLater } } }),
    X('mine-listed', 'GET ' + at('/catalogue-mine'), 200, {}),
    X('mine-with-a-catalogue', 'GET ' + at('/catalogue-mine'), 200, { setup: { sqlRows: adoption } }),
    X('mine-a-page', 'GET ' + at('/catalogue-mine'), 200, { url: at('/catalogue-mine?limit=1'), setup: { sqlRows: adoption } }),
    X('mine-store-missing', 'GET ' + at('/catalogue-mine'), 503, { setup: failing, throws: true }),
    X('mine-fault', 'GET ' + at('/catalogue-mine'), 500, { setup: { sqlRows: adoption }, throws: true, patch: { catalogueBuild: { resolve: boomLater } } })
  ];

  const authoring = [
    X('source-needs-a-key', 'PUT ' + at('/catalogue-source'), 422, { body: {} }),
    X('source-a-list', 'PUT ' + at('/catalogue-source'), 422, { body: [1] }),
    X('source-of-another-brand', 'PUT ' + at('/catalogue-source'), 403, { body: { source_key: 'x@v1' }, setup: { sqlRows: answering(/SELECT owner_entity_id FROM catalogue_source/, [{ owner_entity_id: OTHER }]) } }),
    X('source-of-the-platform', 'PUT ' + at('/catalogue-source'), 403, { body: { source_key: 'x@v1' }, setup: Object.assign({ sqlRows: answering(/SELECT owner_entity_id FROM catalogue_source/, [{ owner_entity_id: null }]) }, asStranger) }),
    X('source-store-missing', 'PUT ' + at('/catalogue-source'), 503, { body: { source_key: 'x@v1' }, setup: { sqlRows: raising(/SELECT owner_entity_id FROM catalogue_source/, '42P01') } }),
    X('source-write-missing', 'PUT ' + at('/catalogue-source'), 503, { body: { source_key: 'x@v1' }, setup: { sqlRows: raising(/INSERT INTO catalogue_source/, '42P01') } }),
    X('source-authored', 'PUT ' + at('/catalogue-source'), 200, { body: { source_key: 'x@v1', title: 'T', items: [{ name: 'Tussar' }] } }),
    X('source-fault', 'PUT ' + at('/catalogue-source'), 500, { body: { source_key: 'x@v1' }, setup: { jsonThrows: true }, throws: true }),
    X('container-needs-an-id', 'PUT ' + at('/container'), 422, { body: {} }),
    X('container-of-another-brand', 'PUT ' + at('/container'), 403, { body: { container_id: 'a/b' }, setup: { sqlRows: containerRow(OTHER) } }),
    X('container-store-missing', 'PUT ' + at('/container'), 503, { body: { container_id: 'a/b' }, setup: { sqlRows: raising(/INSERT INTO product_container/, '42P01') } }),
    X('container-authored', 'PUT ' + at('/container'), 200, { body: { container_id: 'a/b', name: 'N', content: { a: 1 } } }),
    X('container-enhanced', 'PUT ' + at('/container'), 200, { body: { container_id: 'a/b', content: { a: 2 } }, setup: { sqlRows: containerRow(SHOP) } }),
    X('container-fault', 'PUT ' + at('/container'), 500, { body: { container_id: 'a/b' }, setup: { jsonThrows: true }, throws: true }),
    X('region-needs-both', 'PUT ' + at('/region-override'), 422, { body: { container_id: 'a/b' } }),
    X('region-unknown-container', 'PUT ' + at('/region-override'), 404, { body: { container_id: 'a/b', region: 'AU' } }),
    X('region-of-another-brand', 'PUT ' + at('/region-override'), 403, { body: { container_id: 'a/b', region: 'AU' }, setup: { sqlRows: containerRow(OTHER) } }),
    X('region-store-missing', 'PUT ' + at('/region-override'), 503, { body: { container_id: 'a/b', region: 'AU' }, setup: { sqlRows: firstOf(containerRow(SHOP), raising(/container_region_override/, '42P01')) } }),
    X('region-stored', 'PUT ' + at('/region-override'), 200, { body: { container_id: 'a/b', region: 'AU', overrides: { x: 1 } }, setup: { sqlRows: containerRow(SHOP) } }),
    X('region-fault', 'PUT ' + at('/region-override'), 500, { body: { container_id: 'a/b', region: 'AU' }, setup: { sqlRows: containerRow(SHOP), jsonThrows: true }, throws: true })
  ];

  const reads = [
    X('container-read', 'GET ' + at('/container/:id'), 200, { url: at('/container/a%2Fb'), setup: { sqlRows: firstOf(containerRow(SHOP), versionRow) } }),
    X('container-unknown', 'GET ' + at('/container/:id'), 404, { url: at('/container/a%2Fb'),}),
    X('container-read-fault', 'GET ' + at('/container/:id'), 500, { url: at('/container/a%2Fb'), throws: true, patch: { container: { resolveContainer: boomLater } } }),
    X('handoffs-listed', 'GET ' + at('/erp-handoffs'), 200, { setup: { sqlRows: answering(/FROM erp_handoff/, [{ handoff_id: 'h1', chit_id: 'c1', summary: {}, payload_hash: 'x', status: 'sent', created_at: '2026-10-01T00:00:00.000Z' }]) } }),
    X('handoffs-store-missing', 'GET ' + at('/erp-handoffs'), 503, { setup: failing, throws: true }),
    X('handoffs-fault', 'GET ' + at('/erp-handoffs'), 500, { setup: { jsonThrows: true }, throws: true }),
    X('regions-listed', 'GET ' + at('/regions'), 200, { setup: { sqlRows: answering(/FROM region_layer/, [{ region_code: 'AU', currency: 'AUD', units: 'metric', language: 'en', jurisdiction: 'AU' }]) } }),
    X('regions-unread', 'GET ' + at('/regions'), 200, { setup: failing, throws: true }),
    X('regions-fault', 'GET ' + at('/regions'), 500, { setup: { jsonThrows: true }, throws: true }),
    X('resolve-needs-a-region', 'GET ' + at('/resolve'), 400, { url: at('/resolve?container=a%2Fb') }),
    X('resolve-unknown', 'GET ' + at('/resolve'), 404, { url: at('/resolve?container=a%2Fb&region=AU') }),
    X('resolve-found', 'GET ' + at('/resolve'), 200, { url: at('/resolve?container=a%2Fb&region=AU'), patch: { regional: { resolveRegional: async () => ({ container_id: 'a/b', region: 'AU' }) } } }),
    X('resolve-fault', 'GET ' + at('/resolve'), 500, { url: at('/resolve?container=a%2Fb&region=AU'), throws: true, patch: { regional: { resolveRegional: boomLater } } }),
    X('penetration-none', 'GET ' + at('/penetration'), 200, {}),
    X('penetration-counted', 'GET ' + at('/penetration'), 200, { setup: { sqlRows: answering(/FROM source_penetration/, [{ source_key: 's', locality: 'Pune', orders: 3, distributors: 1 }]) } }),
    X('penetration-store-missing', 'GET ' + at('/penetration'), 503, { setup: failing, throws: true }),
    X('penetration-fault', 'GET ' + at('/penetration'), 500, { setup: { jsonThrows: true }, throws: true }),
    X('questions-listed', 'GET ' + at('/questions'), 200, { setup: { sqlRows: answering(/FROM assist_qa/, [{ id: '1', q: 'x?', a: 'y.', topics: [], context: ['*'], fit: null, media: null }]) } }),
    X('questions-for-a-screen', 'GET ' + at('/questions'), 200, { url: at('/questions?context=compose,network') }),
    X('questions-unread', 'GET ' + at('/questions'), 500, { setup: failing, throws: true })
  ];

  const helpDesk_ = [
    X('gap-needs-a-question', 'POST ' + at('/gap'), 422, { body: { q: 'a' } }),
    X('gap-too-long', 'POST ' + at('/gap'), 422, { body: { q: 'x'.repeat(401) } }),
    X('gap-noted', 'POST ' + at('/gap'), 200, { body: { q: 'how do I pay?', context: 'compose' } }),
    X('gap-fault', 'POST ' + at('/gap'), 500, { body: { q: 'how do I pay?' }, setup: { jsonThrows: true }, throws: true }),
    X('publish-needs-both', 'POST ' + at('/publish'), 422, { body: { question: 'q?' } }),
    X('publish-not-a-help-desk', 'POST ' + at('/publish'), 403, { body: { question: 'q?', answer: 'a.' } }),
    X('publish-new', 'POST ' + at('/publish'), 200, { body: { question: 'q?', answer: 'a.', context: ['compose', 3] }, patch: fixedClock, setup: { sqlRows: firstOf(helpDesk, answering(/is_default = true/, [{ schema_id: 's1' }])) } }),
    X('publish-refined', 'POST ' + at('/publish'), 200, { body: { question: 'q?', answer: 'a.', qa_id: 'pub_1' }, patch: { catalogueWrite: { patchWhere: async () => ({ rowCount: 1 }) } }, setup: { sqlRows: helpDesk } }),
    X('publish-fault', 'POST ' + at('/publish'), 500, { body: { question: 'q?', answer: 'a.' }, setup: failing, throws: true }),
    X('gaps-retired', 'GET ' + at('/gaps'), 200, {}),
    X('resolve-retired', 'POST ' + at('/resolve'), 410, { body: {} }),
    X('whoami-help-desk', 'GET ' + at('/whoami'), 200, { setup: { sqlRows: helpDesk } }),
    X('whoami-not-a-help-desk', 'GET ' + at('/whoami'), 200, {}),
    X('whoami-unread', 'GET ' + at('/whoami'), 200, { setup: failing, throws: true })
  ];

  return [].concat(assistant, conform, structure, adopt, authoring, reads, helpDesk_);
}

module.exports = { extras, OTHER, STRANGER_ID, KNOWN_SOURCE };
