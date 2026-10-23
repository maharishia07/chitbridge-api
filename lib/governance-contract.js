/*
 * OWNS      the contract of routes/governance.js: each route's OpenAPI operation (S9) and the one way its refusals and faults are worded (said, faultOf, thrownAs, vaultFault, countrySetupFault, conformanceRefusal).
 * CALLED BY routes/governance.js (schemaValidate on each route, router.openapi, problem(req, res, said(...))) → tools/api-register.cjs · tools/api-contract-tests.cjs · tests/api-problem-governance.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, said({ status, code }, error, message)) → the old { error, message } beside the Problem fields
 *           a thrown error → thrownAs(e, req, error, shown) → the status the library chose, the old body, nothing of the cause on a 5xx
 * CARD      21-compliance-attestation-and-trade/governance
 * This file shapes NO answer and decides no governance rule: the constitution, the readiness passport and the trade profile are the libraries' (lib/readiness, lib/profile, governance/).
 *
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing narrowed. Every handler answers a missing or odd value in its own sentence
 *    ("display_name and email required", "Which supplier?"), and those are frozen (docs/contracts/api-legacy.json). Required fields and unknown-key refusal are API-3 (strict_input) with the owners' say.
 * ⚠️ Behaviour kept on purpose, to be settled by the governance owners (cb-settings / cb-capability), not here: a 4xx a LIBRARY throws on /source, /compliance, /verify, /profile and /supplier-acceptance
 *    still answers the generic sentence as its message (only /ai-draft and /profile/vault show the library's own words).
 */
'use strict';
const { internalSpec } = require('./problem');
const { safeErr, SAFE_SENTENCE } = require('./respond');
const { contractOf, object, array } = require('./contract-kit');

/** a refusal of the route's own: { status, code } and the old words — `error` always, `message` when the old body had one, any other old keys beside them */
function said(kind, error, message, extra) {
  const legacy = Object.assign({ error }, message === undefined ? {} : { message }, extra || {});
  return { status: kind.status, code: kind.code, detail: message === undefined ? error : message, legacy };
}
/** a read or write that threw something we did not expect: a 500 { error, message } that says nothing of its cause (S8); the real error is logged with the request id */
const faultOf = (e, req, error) => internalSpec(req, e, { error, message: SAFE_SENTENCE });

/** the code a library error carries when it is a word of ours (A_INVARIANT, VAULT_CHANGED ...); else the status's own */
const CODE_FORM = /^[A-Z][A-Z0-9_]+$/;
const CONFORMANCE = { code: 'CONFORMANCE' };
const BY_STATUS = [
  { status: 400, code: 'GOV_BAD_REQUEST' }, { status: 401, code: 'SIGN_IN_FIRST' }, { status: 402, code: 'AI_GATED' }, { status: 404, code: 'NOT_FOUND' }, { status: 409, code: 'GOV_CONFLICT' },
  { status: 413, code: 'BODY_TOO_LARGE' }, { status: 422, code: 'GOV_REFUSED' }, { status: 429, code: 'AI_LIMIT' }, { status: 502, code: 'AI_PROVIDER' }, { status: 503, code: 'GOV_NOT_AVAILABLE' }
];
const codeOf = (e, status) => (e && CODE_FORM.test(String(e.code)) ? e.code : (BY_STATUS.find((entry) => entry.status === status) || { code: status < 500 ? 'GOV_REFUSED' : 'INTERNAL' }).code);

/**
 * a thrown error whose `status` the library chose (a 4xx refusal, or a 503 "not available yet"): the route keeps that status.
 * `shown` — the route showed the library's sentence on a 4xx (/ai-draft); otherwise it always answered the generic one. A 5xx never shows it (S8).
 */
function thrownAs(e, req, error, shown) {
  const status = (e && e.status) || 500;
  const spec = faultOf(e, req, error);
  if (status === 500) return spec;
  const words = shown && status < 500 ? e.message || SAFE_SENTENCE : SAFE_SENTENCE;
  const refusal = status < 500 ? { status, code: codeOf(e, status), detail: words } : { status, code: codeOf(e, status), detail: spec.detail };
  return Object.assign(spec, refusal, { legacy: { error, message: words } });
}

/** the constitution refused an override (GovernanceError: A_INVARIANT tighten-only, B_CAPABILITY): 422 with the engine's own code and sentence */
const conformanceRefusal = (e) => ({ status: 422, code: CODE_FORM.test(String(e.code)) ? e.code : CONFORMANCE.code, detail: e.message, legacy: { error: 'conformance', code: e.code, detail: e.message } });

/** PUT /profile/vault: the library's own sentence is shown whenever it chose a status (a version clash, a vault not set up), the generic one otherwise */
function vaultFault(e, req) {
  if (e && e.code === 'VAULT_CHANGED') return said({ status: 409, code: 'VAULT_CHANGED' }, e.say, e.say, { code: e.code });
  if (!(e && e.status)) return faultOf(e, req, 'Save vault failed');
  safeErr(e, { id: req && req.id, path: req && req.path });
  const words = e.message || SAFE_SENTENCE;
  return { status: e.status, code: codeOf(e, e.status), detail: words, legacy: { error: 'Save vault failed', message: words } };
}

/** Country setup: a library error that SAYS something (e.say) answers in that sentence under { code, error, message }; any other is the route's generic fault */
function countrySetupFault(e, req, generic, fallbackStatus) {
  if (e && e.say) {
    const status = e.status || fallbackStatus;
    return { status, code: codeOf(e, status), detail: e.say, legacy: { code: e.code, error: e.say, message: e.say } };
  }
  return thrownAs(e, req, generic);
}

/* ── the contract: each route's OpenAPI operation, built from one row of ROUTES ── */
const GATE_STATUS = { platform: 403, writer: 403, owner: 403 };
const ENTITY_VIEW = ['minted_version', 'active_version', 'drift', 'plan', 'effective', 'exceptions'];
const AI_REFUSALS = [
  { status: 402, code: 'AI_GATED', when: 'the shop\'s AI wallet or plan does not allow the call' },
  { status: 413, code: 'BODY_TOO_LARGE', when: 'the context is too large to send' },
  { status: 429, code: 'AI_LIMIT', when: 'the shop is over its AI rate limit' },
  { status: 502, code: 'AI_PROVIDER', when: 'the model provider did not answer' },
  { status: 503, code: 'GOV_NOT_AVAILABLE', when: 'AI is not connected on this installation' }
];
const SETUP_REFUSALS = [
  { status: 409, code: 'a code of Country setup', when: 'a different country is a new entity' },
  { status: 503, code: 'COUNTRY_SETUP_NOT_MIGRATED', when: 'Country setup arrives with the next database update' }
];
const VAULT_REFUSALS = [{ status: 503, code: 'VAULT_ENC_UNCONFIGURED | VAULT_STORE_MISSING', when: 'the vault is not set up on this installation' }];
const ROUTES = {
  'GET /entities/:id': { summary: 'The protected entity\'s own view: plan, effective constitution and exceptions (a shop reads its own; the platform reads any)', inline: [503], out: object(ENTITY_VIEW) },
  'POST /entities': { summary: 'Create a governed entity under the active constitution (platform only)', gates: ['platform'], inline: [400, 409, 503], body: ['params_override', 'plan', 'display_name', 'email'], ok: 201, out: object(['id', 'effective', 'exceptions']) },
  'POST /entities/:id/reattest': { summary: 'Re-stamp an entity to the active constitution and clear its drift (platform only)', gates: ['platform'], inline: [503], out: object(['message', 'constitution_version', 'drift', 'effective', 'exceptions']) },
  'POST /conformance': { summary: 'Advisory check of a process or chit against the active standards: a verdict, nothing is blocked', body: ['data', 'scope'] },
  'GET /boilerplate/:key': { summary: 'A sealed boilerplate: its declared sources and bound locale', out: object() },
  'POST /boilerplate/:key/adopt': { summary: 'Stamp the caller\'s entity with a boilerplate so it resolves that mould\'s declared sources', out: object(['message', 'boilerplate', 'standards', 'locale']) },
  'POST /source': { summary: 'Register a source as a sealed source-entity and stamp it (platform only)', gates: ['platform'], inline: [400], body: ['source_key', 'title', 'facet', 'kind', 'template'], refusals: [{ status: 400, code: 'GOV_BAD_REQUEST', when: 'the source key or kind is missing or unknown' }], out: object(['message', 'source']) },
  'GET /source/:key': { summary: 'A source: its typed content and its owning source-entity', out: object() },
  'GET /readiness': { summary: 'The caller\'s own trade readiness, optionally for a destination and vertical', query: ['destination', 'vertical', 'origin'], out: object(['may']) },
  'GET /lanes': { summary: 'The caller\'s market-readiness matrix: readiness per destination and the gaps', query: ['vertical', 'origin'], out: object(['may']) },
  'GET /track-record': { summary: 'The caller\'s own track record: counterparties, settled dealings, dispute health', out: object() },
  'GET /instruments': { summary: 'The commercial instruments grouped by the risk they cover', query: ['incoterm', 'cross_border'], out: object() },
  'GET /journey': { summary: 'The ordered settlement chain, with the partner and cover per stage', query: ['incoterm', 'cross_border'], out: object() },
  'GET /commerce-standards': { summary: 'The commerce standards (Incoterms, UCP, FRM) as governed source-entities', out: object() },
  'GET /profile': { summary: 'The shop\'s trade profile: mode, markets, sectors, adopted certificates', out: object() },
  'PUT /profile': { summary: 'Save the trade profile (owner or editor)', gates: ['writer'], body: ['trade_mode', 'markets', 'sectors', 'certs', 'adopted', 'party'], refusals: [{ status: 400, code: 'GOV_BAD_REQUEST', when: 'a profile field the library cannot take' }], out: object() },
  'GET /vault-schema': { summary: 'The vault section types on offer and the tags that can be checked at source', out: object(['section_types', 'verifiable_tags']) },
  'PUT /profile/vault': { summary: 'Save the trade vault as a versioned merge-patch, or a first whole fill (owner or editor)', gates: ['writer'], inline: [409], body: ['version', 'patch', 'vault', 'sections'], refusals: VAULT_REFUSALS.concat([{ status: 400, code: 'GOV_BAD_REQUEST', when: 'a vault the library cannot take' }]), out: object() },
  'GET /profile/readiness': { summary: 'The shop\'s own required set (mandatory and adopted) resolved from its profile', out: object() },
  'GET /profile/path': { summary: 'The forward roadmap: which markets could be reached next and what to add', out: object() },
  'GET /country-setup': { summary: 'Country setup: country, currency, financial-year start, tax registration, and whether the step is still to do', refusals: SETUP_REFUSALS, out: object() },
  'PUT /country-setup': { summary: 'Complete Country setup (owner only)', gates: ['owner'], body: ['country', 'currency', 'fy_start_month', 'tax', 'source'], refusals: SETUP_REFUSALS, out: object() },
  'POST /ai-draft': { summary: 'Draft a clearance document with the AI co-assist: a draft for a person to confirm, metered per shop', inline: [400], body: ['skill_id', 'doc_type', 'context'], refusals: AI_REFUSALS, out: object() },
  'GET /ai-usage': { summary: 'The shop\'s AI spend', out: object() },
  'GET /ai-skills': { summary: 'The AI skills the co-assist can be invoked to do', out: object(['skills'], { skills: array() }) },
  'GET /readiness/:bridge_id': { summary: 'A counterparty\'s shareable readiness passport: status and validity only, never another shop\'s registry values', out: object(['supplier', 'facts']) },
  'POST /compliance': { summary: 'Gather a clearance document for the acting shop (owner or editor)', gates: ['writer'], body: ['standard_key', 'doc_key', 'evidence_ref', 'valid_until', 'status'], refusals: [{ status: 400, code: 'GOV_BAD_REQUEST', when: 'a clearance the library cannot take' }], out: object(['message']) },
  'POST /verify': { summary: 'Machine-verify a registry ID (IEC, GSTIN, PAN) and record the clearance (owner or editor)', gates: ['writer'], inline: [422], body: ['id_type', 'id_value', 'standard_key', 'doc_key', 'valid_until'], refusals: [{ status: 400, code: 'GOV_BAD_REQUEST', when: 'a clearance the library cannot take' }], out: object(['message', 'verdict']) },
  'POST /supplier-acceptance': { summary: 'Record that this shop looked at a supplier\'s readiness and accepted it (owner or editor)', gates: ['writer'], inline: [400, 404, 503], body: ['supplier', 'note'], out: object(['message', 'acceptance', 'summary']) },
  'GET /supplier-acceptance/:handle': { summary: 'The latest acceptance of a supplier by this shop, if any', out: object(['acceptance', 'applied']) }
};
const contract = contractOf({ mount: '/api/governance', routes: ROUTES, gateStatus: GATE_STATUS, extension: 'x-governance-refusals' });

module.exports = { said, faultOf, thrownAs, vaultFault, countrySetupFault, conformanceRefusal, contract, OPERATIONS: contract.OPERATIONS, allowedStatuses: contract.allowedStatuses };
