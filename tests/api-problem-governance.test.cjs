#!/usr/bin/env node
/**
 * api-problem-governance.test.cjs — API-4 sweep, governance: every refusal of routes/governance.js.
 *
 * OWNS      the proof that each refusal of the governance routes (the protected entity, the trade readiness passport, clearances, the trade profile and vault, Country setup,
 *           the AI draft) is a Problem body AND still carries the keys it answered before (docs/contracts/api-legacy.json, recorded from the code before the sweep), and this
 *           file's rows of docs/contracts/api-error-tests.json. Also: no answer outside the statuses the route's contract declares (lib/governance-contract.js), the foreign id
 *           of GET /entities/:id is the unknown id's 404 (api #345), and the contract's refusal mappers as units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/governance.js over a stand-in db and auth.
 * FLOW      route list (read from the router itself) x world (signed out, shop owner, staff, viewer, platform, bad id, failing db) + the named extras
 *           → real route → body → Problem fields present · frozen legacy keys equal · no leak on a 5xx · statuses tested → manifest
 *
 *   node tests/api-problem-governance.test.cjs                    check
 *   node tests/api-problem-governance.test.cjs --write            rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-governance.test.cjs --capture F        (run on the code BEFORE the change) record each answer to file F
 *   node tests/api-problem-governance.test.cjs --freeze F         merge a capture F into docs/contracts/api-legacy.json (the frozen answers)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const kit = require('./lib/problem-sweep-kit.cjs');

const { HERE, argv, flagValue, check, counts } = kit;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const MOUNT = '/api/governance';
const EVIDENCE_FILE = path.join(HERE, 'docs', 'contracts', 'api-hardening-evidence-areas.json'); /* the area tests' own evidence file (R2-4) */
const ROUTE_FILE = 'routes/governance.js';
const MINE = (route) => route.includes(' ' + MOUNT + '/');

/* ── stand-ins: auth and db ─────────────────────────────────────────────────────────────────────────────────── */
const SHOP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor' };
const VIEWER = Object.assign({}, STAFF, { access_level: 'viewer' });
const PLATFORM = Object.assign({}, OWNER, { owner_scope: 'platform' });
const SECRET_SQL = 'relation "identities" does not exist -- SELECT secret FROM vault';
const FRESH = { realAuth: false, who: OWNER, db: 'ok', sqlRows: null };
const world = Object.assign({}, FRESH);

/** the rows a statement gets: a scenario's own rows, then nothing (or the secret failure when the db is down) */
function rowsFor(sql) {
  if (world.db === 'fail') throw new Error(SECRET_SQL);
  if (world.sqlRows) {
    const given = world.sqlRows(String(sql));
    if (given) return given;
  }
  return { rows: [], rowCount: 0 };
}
const mock = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};

function installStubs() {
  /* the db goes in first: a module that destructures { query } the moment it loads would otherwise keep the real one */
  const client = { query: async (sql) => rowsFor(sql) };
  const known = { query: async (sql) => rowsFor(sql), withEntity: async (id, run) => run(client), withTransaction: async (run) => run(client), readBatch: async (entity, header, statements) => statements.map((one) => rowsFor(one.text)) };
  const db = new Proxy(known, { get: (target, name) => (name in target ? target[name] : typeof name === 'symbol' || name === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
  mock('db', db);
  mock('db/index', db);
  const realAuth = require(path.join(HERE, 'middleware', 'auth'));
  const stubAuth = (req, res, next) => {
    if (world.realAuth) return realAuth(req, res, next);
    req.identity = world.who;
    return next();
  };
  mock('middleware/auth', Object.assign(stubAuth, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }));
  console.error = () => undefined; /* the routes log a 5xx here; the scenarios read the answer */
}

/* ── the scenarios: every route the router holds x the worlds, then the named extras ──────────────────────── */
const VALUES = { id: SHOP, key: 'nobody', bridge_id: 'BRG-1', handle: 'nobody' };
const WORLDS = [
  { id: 'signed-out', setup: { realAuth: true } },
  { id: 'shop-owner', setup: {} },
  { id: 'staff-asks', setup: { who: STAFF } },
  { id: 'viewer-asks', setup: { who: VIEWER } },
  { id: 'platform-asks', setup: { who: PLATFORM } },
  { id: 'bad-id', setup: {}, badId: true },
  { id: 'db-fails', setup: { db: 'fail' } }
];
/** the extras: an answer the generic worlds cannot reach (a named refusal inside a handler) */
const X = (id, route, status, extra) => Object.assign({ id, route, expect: status, setup: {} }, extra);
const CONSTITUTION = { version: '1', params: { defaults: { exposure_default: 'network' }, allowed: { exposure_tiers: ['private', 'network', 'public'], languages: ['en'] } }, plan_menu: { free: { max_entities: 1 } }, root_id: 'root-1' };
/** a statement is answered by the first pair whose pattern matches it: [pattern, rows | (sql) => rows | an Error to throw] */
const ANSWERS = (...pairs) => (sql) => {
  const hit = pairs.find(([pattern]) => pattern.test(sql));
  if (!hit) return null;
  if (hit[1] instanceof Error) throw hit[1];
  const rows = typeof hit[1] === 'function' ? hit[1](sql) : hit[1];
  return { rows, rowCount: rows.length };
};
const ACTIVE = [/FROM platform_constitution/, [{ version: '1', params: CONSTITUTION.params, plan_menu: CONSTITUTION.plan_menu, root_id: 'root-1' }]];
const ENTITY = [/FROM identities WHERE governed_by/, [{ constitution_version: '1', params_override: {}, plan: 'free' }]];
const WIDENS = { caps: { catalogue_visibility: 'public' } };
const LIB_REFUSAL = (status, extra) => Object.assign(new Error('The library said no.'), { status }, extra);
/** a library call that fails the way a database fault does, or refuses on purpose (status) */
const FAIL = (mod, fn, throws) => [{ mod, fn, throws: throws || new Error(SECRET_SQL) }];
const TABLE_THERE = { mod: 'lib/schema', fn: 'hasTable', value: async () => true };

/* ── the READY side of the reads (API-8 review lesson): the generic worlds hit a shop with nothing stated, so the schema of each read is learned from BOTH branches of its handler ── */
const KEY_32 = '0'.repeat(64); /* a vault key for the scenarios that read a filled vault */
const SHOP_ROW = { identity_id: SHOP, display_name: 'Test shop', bridge_id: 'BRG-1', user_id: 'testshop', gstn: '27AAAAA0000A1Z5', country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata', policy_flags: { gst_registration: 'regular' }, address: '1 Main Road', phone: '9999999999', email: 'a@b.c' };
const SETUP_ROW = { fy_start_month: 4, tax_registration: { registered: true, number: '27AAAAA0000A1Z5', scheme: 'regular' }, setup_source: { country: 'confirmed by the owner', currency: 'typed', fy_start_month: 'the pack', tax: 'typed', timezone: 'your device clock' }, country_setup_at: '2026-10-01T00:00:00.000Z' };
const VAULT_BODY = { sections: [{ type: 'identity', label: 'Business identity', rows: [{ name: 'Legal name', value: 'Test Traders', tag: 'legal_name', source: 'typed', as_of: '2026-10-01T00:00:00.000Z', rung: 'declared' }, { name: 'City', value: 'Pune', rung: 'declared' }] }] };
/** the vault as the database holds it: an envelope, made here with the key the scenario sets */
const vaultEnvelope = () => require(path.join(HERE, 'lib', 'vaultcrypto')).encryptVault(VAULT_BODY);
const GST_DOC = { standard_key: 'gst-registration', doc_key: 'gstn', title: 'GST registration', scope: 'org', frequency: 'once', display_order: 1 };
const IEC_DOC = { standard_key: 'iec', doc_key: 'iec_cert', title: 'Import-export code', scope: 'org', frequency: 'once', display_order: 1 };
const READY_ROWS = ANSWERS(
  [/SELECT DISTINCT standard_key FROM standard_source/, [{ standard_key: 'gst-registration' }, { standard_key: 'iec' }]],
  [/SELECT DISTINCT ON \(standard_key\)/, [{ standard_key: 'gst-registration', title: 'GST registration', applicability: { origin: ['IN'], destination: ['any'], categories: [] }, guidance: 'Register with the GST portal.' }, { standard_key: 'iec', title: 'Import-export code', applicability: { origin: ['IN'], destination: ['any'], cross_border: true, categories: [] }, guidance: 'Apply to the DGFT.' }]],
  [/FROM standard_document/, [GST_DOC, IEC_DOC]],
  [/FROM entity_compliance/, [{ standard_key: 'gst-registration', doc_key: 'gstn', status: 'gathered', evidence_ref: '27AAAAA0000A1Z5', valid_until: '2099-01-01', verification: { method: 'registry', verified_at: '2026-10-01T00:00:00.000Z', provider: 'GSTN' } }, { standard_key: 'iec', doc_key: 'iec_cert', status: 'gathered', evidence_ref: '33333333-3333-4333-8333-333333333333', valid_until: '2020-01-01', verification: null }]],
  [/FROM jurisdiction/, [{ dest_key: 'IN', name: 'Domestic (India)', domestic: true }, { dest_key: 'EU', name: 'European Union', domestic: false }]],
  [/SELECT standard_key, voluntary FROM standard_source/, [{ standard_key: 'gst-registration', voluntary: false }, { standard_key: 'iso-9001', voluntary: true }]],
  [/FROM vertical_category/, [{ category: 'paint' }]],
  [/country-setup constituted/, [{ products: true, chits: false, entries: false }]],
  [/country-setup \*\/ fy_start_month/, [SETUP_ROW]],
  [/FROM entity_profile/, () => [{ trade_mode: 'export', markets: ['EU'], sectors: ['paint'], adopted: ['iso-9001'], vault: vaultEnvelope(), version: '2026-10-01T00:00:00.000Z' }]],
  [/WITH mine AS/, [{ counterparties: '4', dealings: '9', first_at: new Date('2026-01-01T00:00:00Z'), last_at: new Date('2026-10-01T00:00:00Z') }]],
  [/FROM chit_status/, [{ n: '6' }]],
  [/FROM chit_disputes/, [{ o: '0', r: '1' }]],
  [/meter='ai.draft'/, [{ calls: 3, tokens: '1200', spent_usd: '0.0123' }]],
  [/AS all_spent/, [{ all_spent: '0.0123' }]],
  [/FROM entity_wallet/, [{ credits: '5.0000' }]],
  [/s\.facet = 'commerce'/, [{ standard_key: 'FRM-1', title: 'Incoterms 2020', facet: 'commerce', guidance: 'Pick the term.', owner_bridge_id: 'BRG-9', owner_name: 'ICC', owner_sealed: true }, { standard_key: 'FRM-2', title: 'UCP 600', facet: 'commerce', guidance: null, owner_bridge_id: null, owner_name: null, owner_sealed: null }]],
  [/FROM identities/, [SHOP_ROW]]
);
/** a stranger reads the passport of another shop: its registry value stays with its owner (evidence_ref null) */
const STRANGER_ROWS = ANSWERS(
  [/FROM customer_list/, [{ customer: false, supplier: true }]],
  [/FROM identities/, [Object.assign({}, SHOP_ROW, { identity_id: OTHER })]],
  [/SELECT DISTINCT standard_key FROM standard_source/, [{ standard_key: 'gst-registration' }]],
  [/FROM standard_document/, [GST_DOC]],
  [/FROM entity_compliance/, [{ standard_key: 'gst-registration', doc_key: 'gstn', status: 'gathered', evidence_ref: '27AAAAA0000A1Z5', valid_until: null, verification: null }]]
);
const NO_FACTS_ROWS = ANSWERS([/FROM customer_list/, [{ customer: true, supplier: false }]], [/FROM identities/, [{ identity_id: OTHER, display_name: 'Quiet Co', bridge_id: 'BRG-2', user_id: 'quiet', gstn: null, country: null, policy_flags: null }]]);
/** a legacy entity signed up by e-mail has no handle: identities.user_id is nullable (the unique index is WHERE user_id IS NOT NULL) */
const NO_HANDLE_ROWS = ANSWERS([/FROM customer_list/, [{ customer: false, supplier: true }]], [/FROM identities/, [Object.assign({}, SHOP_ROW, { identity_id: OTHER, user_id: null })]]);
const MIGRATED = { mod: 'lib/schema', fn: 'hasColumn', value: async () => true };
/** a read made with the shop's rows seated, a vault key set, and the b299 column there */
const READY = (id, route, extra) => X(id, route, 200, Object.assign({ setup: { sqlRows: READY_ROWS }, env: { VAULT_ENC_KEY: KEY_32 }, patch: [MIGRATED] }, extra));

/** one library call per route: the library throws a database fault → the route's own 500 */
const FAULTS = [
  ['GET /api/governance/ai-skills', 'lib/ai', 'listSkills'], ['GET /api/governance/ai-usage', 'lib/ai', 'usageSummary'],
  ['GET /api/governance/commerce-standards', 'lib/instruments', 'commerceStandards'], ['GET /api/governance/instruments', 'lib/instruments', 'resolveInstruments'],
  ['GET /api/governance/journey', 'lib/instruments', 'resolveJourney'], ['GET /api/governance/lanes', 'lib/readiness', 'resolveLaneMatrix'],
  ['GET /api/governance/profile', 'lib/profile', 'getProfile'], ['GET /api/governance/profile/path', 'lib/profile', 'resolvePath'],
  ['GET /api/governance/profile/readiness', 'lib/profile', 'resolveProfileReadiness'], ['GET /api/governance/readiness', 'lib/readiness', 'resolveReadiness'],
  ['GET /api/governance/track-record', 'lib/reference', 'resolveTrackRecord'], ['GET /api/governance/vault-schema', 'lib/profile', 'SECTION_TYPES'],
  ['POST /api/governance/conformance', 'lib/conformance', 'checkConformance'], ['GET /api/governance/boilerplate/:key', 'lib/boilerplate', 'resolveBoilerplate'],
  ['POST /api/governance/boilerplate/:key/adopt', 'lib/boilerplate', 'resolveBoilerplate'], ['GET /api/governance/source/:key', 'lib/source', 'resolveSourceEntity'],
  ['POST /api/governance/compliance', 'lib/readiness', 'gatherDocument'], ['POST /api/governance/verify', 'lib/verify', 'verifyRegistry'],
  ['GET /api/governance/country-setup', 'lib/country-setup', 'profile'], ['PUT /api/governance/profile', 'lib/profile', 'saveProfile'],
  ['PUT /api/governance/profile/vault', 'lib/profile', 'readVault'], ['POST /api/governance/ai-draft', 'lib/ai', 'invokeSkill']
];
const readyExtras = [
  READY('readiness-own-ready', 'GET /api/governance/readiness'),
  READY('readiness-for-a-destination', 'GET /api/governance/readiness', { url: MOUNT + '/readiness?destination=EU&vertical=paint&origin=IN' }),
  X('readiness-destination-origin-unasked', 'GET /api/governance/readiness', 200, { url: MOUNT + '/readiness?destination=EU' }),
  READY('lanes-ready', 'GET /api/governance/lanes', { url: MOUNT + '/lanes?vertical=paint&origin=IN' }),
  READY('track-record-ready', 'GET /api/governance/track-record'),
  X('instruments-with-incoterm', 'GET /api/governance/instruments', 200, { url: MOUNT + '/instruments?incoterm=CIF' }),
  X('instruments-domestic', 'GET /api/governance/instruments', 200, { url: MOUNT + '/instruments?cross_border=0' }),
  X('journey-domestic-incoterm', 'GET /api/governance/journey', 200, { url: MOUNT + '/journey?cross_border=0&incoterm=fob' }),
  READY('commerce-standards-ready', 'GET /api/governance/commerce-standards'),
  READY('profile-ready', 'GET /api/governance/profile'),
  READY('profile-readiness-ready', 'GET /api/governance/profile/readiness'),
  READY('profile-path-ready', 'GET /api/governance/profile/path'),
  READY('country-setup-ready', 'GET /api/governance/country-setup'),
  READY('ai-usage-metered', 'GET /api/governance/ai-usage'),
  X('supplier-readiness-own-row', 'GET /api/governance/readiness/:bridge_id', 200, { setup: { sqlRows: READY_ROWS } }),
  X('supplier-readiness-seen-by-a-stranger', 'GET /api/governance/readiness/:bridge_id', 200, { setup: { sqlRows: STRANGER_ROWS } }),
  X('supplier-readiness-legacy-without-handle', 'GET /api/governance/readiness/:bridge_id', 200, { setup: { sqlRows: NO_HANDLE_ROWS } }),
  X('supplier-readiness-without-facts', 'GET /api/governance/readiness/:bridge_id', 200, { setup: { sqlRows: NO_FACTS_ROWS } })
];
const faultExtras = FAULTS.map(([route, mod, fn]) => X('library-fault', route, 500, { patch: FAIL(mod, fn) }));
const SOURCE_BODY = { source_key: 'k' };
const EXTRAS = faultExtras.concat(readyExtras).concat([
  X('foreign-entity-id', 'GET /api/governance/entities/:id', 404, { url: MOUNT + '/entities/' + OTHER }),
  X('platform-reads-any-unknown-id', 'GET /api/governance/entities/:id', 404, { setup: { who: PLATFORM }, url: MOUNT + '/entities/' + OTHER }),
  X('entity-without-constitution', 'GET /api/governance/entities/:id', 503, { setup: { sqlRows: ANSWERS(ENTITY) } }),
  X('governed-entity-unnamed', 'POST /api/governance/entities', 400, { setup: { who: PLATFORM }, body: {} }),
  X('no-constitution-to-create-under', 'POST /api/governance/entities', 503, { setup: { who: PLATFORM }, body: { display_name: 'A', email: 'a@b.c' } }),
  X('entity-quota-reached', 'POST /api/governance/entities', 409, { setup: { who: PLATFORM, sqlRows: ANSWERS(ACTIVE, [/count\(\*\)/, [{ n: 5 }]]) }, body: { display_name: 'A', email: 'a@b.c' } }),
  X('override-widens-the-constitution', 'POST /api/governance/entities', 422, { setup: { who: PLATFORM, sqlRows: ANSWERS(ACTIVE, [/count\(\*\)/, [{ n: 0 }]]) }, body: { display_name: 'A', email: 'a@b.c', params_override: WIDENS } }),
  X('email-already-governed', 'POST /api/governance/entities', 409, { setup: { who: PLATFORM, sqlRows: ANSWERS(ACTIVE, [/count\(\*\)/, [{ n: 0 }]], [/INSERT INTO identities/, Object.assign(new Error('duplicate key'), { code: '23505' })]) }, body: { display_name: 'A', email: 'a@b.c' } }),
  X('governed-create-fault', 'POST /api/governance/entities', 500, { setup: { who: PLATFORM, db: 'fail' }, body: { display_name: 'A', email: 'a@b.c' } }),
  X('no-such-governed-entity', 'POST /api/governance/entities/:id/reattest', 404, { setup: { who: PLATFORM } }),
  X('no-constitution-to-reattest', 'POST /api/governance/entities/:id/reattest', 503, { setup: { who: PLATFORM, sqlRows: ANSWERS(ENTITY) } }),
  X('stored-override-widens', 'POST /api/governance/entities/:id/reattest', 422, { setup: { who: PLATFORM, sqlRows: ANSWERS(ACTIVE, [/FROM identities WHERE governed_by/, [{ params_override: WIDENS }]]) } }),
  X('reattest-fault', 'POST /api/governance/entities/:id/reattest', 500, { setup: { who: PLATFORM, db: 'fail' } }),
  X('no-such-boilerplate', 'GET /api/governance/boilerplate/:key', 404, {}),
  X('no-such-boilerplate-to-adopt', 'POST /api/governance/boilerplate/:key/adopt', 404, {}),
  X('no-such-source', 'GET /api/governance/source/:key', 404, {}),
  X('source-unnamed', 'POST /api/governance/source', 400, { setup: { who: PLATFORM }, body: {} }),
  X('source-fault', 'POST /api/governance/source', 500, { setup: { who: PLATFORM }, body: SOURCE_BODY, patch: FAIL('lib/source', 'registerSource') }),
  X('source-refused-by-the-library', 'POST /api/governance/source', 422, { setup: { who: PLATFORM }, body: SOURCE_BODY, patch: FAIL('lib/source', 'registerSource', LIB_REFUSAL(422)) }),
  X('no-such-supplier-readiness', 'GET /api/governance/readiness/:bridge_id', 404, {}),
  X('supplier-readiness-fault', 'GET /api/governance/readiness/:bridge_id', 500, { setup: { sqlRows: ANSWERS([/FROM customer_list/, [{ customer: false, supplier: true }]], [/FROM identities/, [{ identity_id: OTHER, bridge_id: 'BRG-1' }]]) }, patch: FAIL('lib/readiness', 'resolveReadiness') }),
  X('acceptance-not-switched-on', 'POST /api/governance/supplier-acceptance', 503, { body: {}, patch: [{ mod: 'lib/schema', fn: 'hasTable', value: async () => false }] }),
  X('supplier-unnamed', 'POST /api/governance/supplier-acceptance', 400, { body: {}, patch: [TABLE_THERE] }),
  X('no-such-supplier', 'POST /api/governance/supplier-acceptance', 404, { body: { supplier: 'nobody' }, patch: [TABLE_THERE] }),
  X('acceptance-fault', 'POST /api/governance/supplier-acceptance', 500, { body: { supplier: 'nobody' }, setup: { db: 'fail' }, patch: [TABLE_THERE] }),
  X('acceptance-read-fault', 'GET /api/governance/supplier-acceptance/:handle', 500, { setup: { db: 'fail' }, patch: [TABLE_THERE] }),
  X('verify-refused-by-the-library', 'POST /api/governance/verify', 400, { body: { id_type: 'gstin', id_value: 'x' }, patch: FAIL('lib/verify', 'verifyRegistry', LIB_REFUSAL(400)) }),
  X('clearance-refused-by-the-library', 'POST /api/governance/compliance', 400, { body: {}, patch: FAIL('lib/readiness', 'gatherDocument', LIB_REFUSAL(400)) }),
  X('profile-refused-by-the-library', 'PUT /api/governance/profile', 400, { body: {}, patch: FAIL('lib/profile', 'saveProfile', LIB_REFUSAL(400)) }),
  X('vault-older-than-the-screen', 'PUT /api/governance/profile/vault', 409, { body: { vault: { sections: [] } }, patch: [{ mod: 'lib/profile', fn: 'readVault', value: async () => ({ version: 'v1', vault: {} }) }] }),
  X('vault-changed-meanwhile', 'PUT /api/governance/profile/vault', 409, { body: { version: 'v0', patch: { sections: {} } }, patch: FAIL('lib/profile', 'patchVault', LIB_REFUSAL(409, { code: 'VAULT_CHANGED', say: 'Changed since you opened it — reload?' })) }),
  X('vault-refused-by-the-library', 'PUT /api/governance/profile/vault', 400, { body: { vault: { sections: [] } }, patch: FAIL('lib/profile', 'readVault', LIB_REFUSAL(400)) }),
  X('country-setup-in-words', 'GET /api/governance/country-setup', 503, { patch: FAIL('lib/country-setup', 'profile', LIB_REFUSAL(503, { say: 'Country setup arrives after the next update.', code: 'COUNTRY_SETUP_NOT_MIGRATED' })) }),
  X('country-setup-not-by-the-owner', 'PUT /api/governance/country-setup', 403, { setup: { who: STAFF }, body: {} }),
  X('country-setup-refused-in-words', 'PUT /api/governance/country-setup', 409, { body: {}, patch: FAIL('lib/country-setup', 'save', LIB_REFUSAL(409, { say: 'That is a different country.', code: 'COUNTRY_CHANGE' })) }),
  X('country-setup-said-without-status', 'PUT /api/governance/country-setup', 422, { body: {}, patch: FAIL('lib/country-setup', 'save', Object.assign(new Error('x'), { say: 'Name the country.', code: 'COUNTRY_NEEDED' })) }),
  X('country-setup-fault', 'PUT /api/governance/country-setup', 500, { body: {}, patch: FAIL('lib/country-setup', 'save') }),
  X('ai-draft-no-skill', 'POST /api/governance/ai-draft', 400, { body: {} }),
  X('ai-draft-gated', 'POST /api/governance/ai-draft', 402, { body: { skill_id: 's' }, patch: FAIL('lib/ai', 'invokeSkill', LIB_REFUSAL(402)) }),
  X('ai-draft-over-the-limit', 'POST /api/governance/ai-draft', 429, { body: { skill_id: 's' }, patch: FAIL('lib/ai', 'invokeSkill', LIB_REFUSAL(429)) }),
  X('ai-draft-not-connected', 'POST /api/governance/ai-draft', 503, { body: { skill_id: 's' }, patch: FAIL('lib/ai', 'invokeSkill', LIB_REFUSAL(503)) })
]);

/** a scenario that needs a library to fail (or answer) swaps one property for a getter, then puts the real one back */
function applyPatch(patch) {
  const undo = [];
  (patch || []).forEach((one) => {
    const owner = require(path.join(HERE, one.mod));
    undo.push([owner, one.fn, Object.getOwnPropertyDescriptor(owner, one.fn)]);
    Object.defineProperty(owner, one.fn, { configurable: true, enumerable: true, get() { if (one.throws) throw one.throws; return one.value; } });
  });
  return () => undo.forEach(([owner, name, original]) => (original ? Object.defineProperty(owner, name, original) : delete owner[name]));
}

async function runScenario(port, scenario) {
  Object.assign(world, FRESH, scenario.setup);
  require(path.join(HERE, 'lib', 'confcache')).invalidate(); /* the active constitution is remembered for a minute; each scenario starts without it */
  const restore = applyPatch(scenario.patch);
  const envBefore = {};
  Object.keys(scenario.env || {}).forEach((name) => {
    envBefore[name] = process.env[name];
    process.env[name] = scenario.env[name];
  });
  require(path.join(HERE, 'lib', 'country-setup')).forget(SHOP); /* the gate remembers a shop's answer for a minute: each scenario starts without it */
  const method = scenario.route.split(' ')[0];
  const answer = await kit.send(port, method, scenario.url, scenario.body === undefined && kit.BODY_METHODS.includes(method) ? {} : scenario.body);
  restore();
  Object.keys(envBefore).forEach((name) => {
    if (envBefore[name] === undefined) delete process.env[name];
    else process.env[name] = envBefore[name];
  });
  return answer;
}

/** the sign-in middleware's own 401 is still the old body: tested, not yet a Problem (a follow-up for the auth middleware) */
const inherited = (scenario, answer) => answer.status === 401 && scenario.id === 'signed-out';

async function checkRoutes(port, scenarios, recording) {
  const tested = {};
  const allowed = argv.includes('--capture') ? null : require(path.join(HERE, 'lib', 'governance-contract.js')).allowedStatuses();
  for (const scenario of scenarios) {
    const answer = await runScenario(port, scenario);
    const label = scenario.route + ' · ' + scenario.id;
    recording[scenario.route + '|' + scenario.id] = { route: scenario.route, status: answer.status, body: answer.json, request: { url: scenario.url, body: scenario.body } }; /* the request is kept so the shape tool can play it */
    if (answer.status >= 400) (tested[scenario.route] = tested[scenario.route] || new Set()).add(answer.status);
    if (argv.includes('--capture')) continue;
    check(label + ': answers (not a hang)', answer.status !== 0);
    if (scenario.expect) check(label + ': answers the status the scenario was made for (' + scenario.expect + ')', answer.status === scenario.expect, [answer.status, answer.json]);
    if (answer.status < 400) continue;
    check(label + ': ' + answer.status + ' is a status the contract declares for this route', allowed(scenario.route).includes(answer.status), allowed(scenario.route));
    if (inherited(scenario, answer)) continue;
    kit.checkProblemBody(label, answer);
    if (answer.status >= 500) check(label + ': a 5xx says nothing of its cause', !/SELECT secret|relation "/.test(answer.text), answer.text);
    else kit.checkLegacy(label, answer, kit.legacyOf(scenario.route, scenario.id));
  }
  return tested;
}

/** lib/governance-contract.js as a unit: the words of a thrown refusal and of a fault, as the routes always said them */
function checkWords() {
  const { thrownAs, faultOf } = require(path.join(HERE, 'lib', 'governance-contract.js'));
  const request = { id: 'r1' };
  const fault = faultOf(new Error(SECRET_SQL), request, 'Readiness failed');
  check('faultOf: a 500 keeps { error, message } and says nothing of its cause', fault.status === 500 && fault.code === 'INTERNAL' && fault.legacy.error === 'Readiness failed' && !JSON.stringify(fault).includes('SELECT secret'), fault);
  const gated = thrownAs(Object.assign(new Error('Over the limit.'), { status: 429 }), request, 'AI draft failed', true);
  check('thrownAs: a 4xx the library chose keeps its status, and (shown) its sentence', gated.status === 429 && gated.legacy.message === 'Over the limit.' && gated.detail === 'Over the limit.', gated);
  const hidden = thrownAs(Object.assign(new Error('Because.'), { status: 400, code: 'BAD_THING' }), request, 'Save profile failed');
  check('thrownAs: a 4xx the route never showed keeps the generic message and the library\'s own code', hidden.status === 400 && hidden.code === 'BAD_THING' && hidden.legacy.message !== 'Because.', hidden);
  const server = thrownAs(Object.assign(new Error(SECRET_SQL), { status: 503 }), request, 'AI draft failed', true);
  check('thrownAs: a 5xx never shows the library\'s sentence', server.status === 503 && !JSON.stringify(server).includes('SELECT secret'), server);
  const plain = thrownAs(new Error('boom'), request, 'Verify failed');
  check('thrownAs: an error with no status is a 500 INTERNAL', plain.status === 500 && plain.code === 'INTERNAL', plain);
}

/** lib/contract-kit.js row.refusals: a route that passes a library's status through declares those statuses beside its own */
function checkKitRefusals() {
  const kitLib = require(path.join(HERE, 'lib', 'contract-kit.js'));
  const contract = kitLib.contractOf({ mount: '/api/x', routes: { 'POST /draft': { summary: 'Draft', body: ['a'], refusals: [{ status: 402 }, { status: 429 }] }, 'GET /plain': { summary: 'Plain' } }, gateStatus: {}, extension: 'x-r' });
  check('kit: a row that names refusals allows them in a test and declares none of them in its responses', contract.allowedStatuses()('POST /api/x/draft').includes(429) && !contract.OPERATIONS['POST /api/x/draft'].responses[429], contract.allowedStatuses()('POST /api/x/draft'));
  check('kit: a row with none allows only what it declares', !contract.allowedStatuses()('GET /api/x/plain').includes(429));
}

/**
 * API-8 output allow-list (S34), the way tests/api-problem-books.test.cjs proves it: a governance read whose 200 schema is CLOSED (additionalProperties false, derived in
 * docs/contracts/api-output-shapes.json) and whose recorded 200s ALL fit that schema with no key pruned — the ready side and the not-ready side of each handler both recorded
 * above. → { route: { output_allowlist: true } } for the routes that held
 */
function checkAllowList(recording) {
  const proved = {};
  const words = require(path.join(HERE, 'lib', 'governance-contract.js'));
  const engine = require(path.join(HERE, 'middleware', 'validate.js')).bodyEngine;
  const { prune } = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  Object.keys(words.OPERATIONS).filter((route) => route.startsWith('GET ')).sort().forEach((route) => {
    const schema = (((words.OPERATIONS[route].responses[200] || {}).content || {})['application/json'] || {}).schema;
    if (!schema || schema.additionalProperties !== false) return;
    const answers = Object.values(recording).filter((one) => one.route === route && one.status === 200 && one.body);
    const fits = engine.compile(schema);
    const held = answers.length > 0 && answers.every((one) => fits(one.body) && prune(schema, one.body).dropped.length === 0);
    check(route + ': every recorded 200 (' + answers.length + ') holds only the keys its operation lists (a closed schema the answers fit)', held, { answers: answers.length, errors: fits.errors });
    if (held) proved[route] = { output_allowlist: true };
  });
  /* under OUTPUT_ALLOWLIST=enforce the recorded answers are already cut, so the filter's own count is the proof that no scenario lost a key */
  const filter = require(path.join(HERE, 'lib', 'output-allowlist.js'));
  check('the output filter dropped no key from any answer of any scenario (' + filter.droppedCount() + ' dropped)', filter.droppedCount() === 0, filter.droppedKeys());
  return proved;
}
/** the governance reads the evidence file says output_allowlist for */
function allowListEvidenceOnDisk() {
  const routes = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8')).routes || {};
  return Object.fromEntries(Object.keys(routes).filter((route) => route.includes(' ' + MOUNT + '/') && routes[route].output_allowlist).sort().map((route) => [route, { output_allowlist: true }]));
}
/** write this file's output_allowlist rows into the evidence file (other routes and columns stay as they are) */
function writeAllowList(proved) {
  const onDisk = JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8'));
  const routes = onDisk.routes || {};
  Object.keys(routes).filter((route) => route.includes(' ' + MOUNT + '/')).forEach((route) => {
    delete routes[route].output_allowlist;
    if (!Object.keys(routes[route]).length) delete routes[route];
  });
  Object.keys(proved).forEach((route) => (routes[route] = Object.assign(routes[route] || {}, proved[route])));
  const sorted = Object.fromEntries(Object.keys(routes).sort().map((route) => [route, routes[route]]));
  fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(Object.assign({}, onDisk, { routes: sorted }), null, 1) + '\n');
}

/** the whole sweep in a few sentences: who is refused, the foreign id, and that every recorded refusal was replayed */
function checkAnswers(recording) {
  const answers = Object.values(recording);
  const keys = Object.keys(recording);
  check('a caller who is not signed in is refused with 401', keys.filter((key) => key.endsWith('|signed-out')).every((key) => recording[key].status === 401));
  const platformOnly = ['POST /api/governance/entities', 'POST /api/governance/entities/:id/reattest', 'POST /api/governance/source'];
  check('a shop login is refused with 403 NOT_PLATFORM at every platform-only door', platformOnly.every((route) => recording[route + '|shop-owner'] && recording[route + '|shop-owner'].status === 403 && recording[route + '|shop-owner'].body.code === 'NOT_PLATFORM'));
  check('a viewer is refused every trade write with 403 and the rail\'s word', ['PUT /api/governance/profile', 'POST /api/governance/compliance', 'POST /api/governance/verify'].every((route) => recording[route + '|viewer-asks'].status === 403 && recording[route + '|viewer-asks'].body.code === 'read_only'));
  const foreign = recording['GET /api/governance/entities/:id|foreign-entity-id'];
  const unknown = recording['GET /api/governance/entities/:id|platform-reads-any-unknown-id'];
  check('api #345: a foreign shop id gets the unknown id\'s 404, the same body, and says nothing of another shop', foreign.status === 404 && unknown.status === 404 && foreign.body.error === unknown.body.error && foreign.body.error === 'entity not found or not governed');
  const legacy = JSON.parse(require('fs').readFileSync(path.join(HERE, 'docs', 'contracts', 'api-legacy.json'), 'utf8')).routes;
  const frozen = Object.keys(legacy).filter(MINE).reduce((sum, route) => sum + legacy[route].answers.length, 0);
  check('every refusal recorded before the sweep is replayed against the code: ' + frozen + ' answers, each once, byte for byte', frozen > 60);
  check('a 500 never says its cause: no answer of any route carries the database text', answers.every((one) => !JSON.stringify(one.body || {}).includes('SELECT secret')));
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  if (flagValue('--freeze')) return kit.freeze(flagValue('--freeze'), MINE);
  installStubs();
  const router = require(path.join(HERE, ROUTE_FILE));
  const routes = kit.routesOf(router, MOUNT);
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  app.use(MOUNT, router);
  const server = app.listen(0);
  const recording = {};
  const tested = await checkRoutes(server.address().port, kit.scenariosOf(routes, WORLDS, EXTRAS, VALUES), recording);
  server.close();
  if (flagValue('--capture')) {
    require('fs').writeFileSync(flagValue('--capture'), JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' answers over ' + Object.keys(routes).length + ' routes');
    process.exit(0);
  }
  console.log('\n-- lib/governance-contract.js: the refusal mappers as a unit --');
  checkWords();
  checkKitRefusals();
  checkAnswers(recording);
  const proved = checkAllowList(recording);
  kit.settleCoverage(tested, MINE);
  if (argv.includes('--write')) writeAllowList(proved);
  else check('docs/contracts/api-hardening-evidence-areas.json says output_allowlist for exactly the governance reads whose 200 held closed here', kit.sameValue(allowListEvidenceOnDisk(), proved), { onDisk: Object.keys(allowListEvidenceOnDisk()).length, proved: Object.keys(proved).length });
  console.log('\n  ' + counts.passed + ' checks, ' + counts.failed + ' failed');
  process.exit(counts.failed ? 1 : 0);
})();
