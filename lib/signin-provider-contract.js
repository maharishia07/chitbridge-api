/*
 * OWNS      the contract of routes/signin-provider.js (SEC-112 P0: the provider list, the start and the callback): each route's OpenAPI operation (S9) and the statuses the handlers write themselves.
 * CALLED BY routes/signin-provider.js (router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json.
 * FLOW      operation → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      18-identity-sign-in-and-access/sign-in
 * ⚠️ A VISIT CANNOT SHOW JSON. start and callback are top-level browser visits: they answer a 302 (to the provider, or back to the web sign-in page with #e=<CODE> in the fragment). Only an unknown provider key is a 404 problem.
 *    The routes P1a adds (handoff · choose · connect/ask · connect · links) are declared there, with their own rows; these three start partial in docs/API-REGISTER.md until cb-api signs the human columns.
 */
'use strict';
const { contractOf, object, maybeText } = require('./contract-kit');

const QUERY_START = ['device_id', 'next', 'lt'];
/** what a provider's redirect carries: the authorization code and state, the issuer (RFC 9207), or an error (RFC 6749 4.1.2.1) */
const QUERY_CALLBACK = ['code', 'state', 'iss', 'error', 'error_description', 'session_state'];

const ROUTES = {
  'GET /providers': {
    summary: 'Which outside sign-in providers exist on this installation (an empty list = the page is exactly today\'s); never says who has an account',
    public: true,
    out: object(['providers', 'standin'], { providers: { type: 'array', items: object(['key', 'label', 'live'], { key: { type: 'string' }, label: { type: 'string' }, live: { type: 'boolean' } }, true) }, standin: { type: 'boolean' } }, true)
  },
  'GET /provider/:key/start': {
    summary: 'Send this browser to the provider (a top-level visit): a start row, the __Host-cb_sso cookie and a 302; every refusal is a 302 back to the sign-in page with #e=<CODE>',
    public: true,
    ok: 302,
    says: 'a redirect to the provider',
    query: QUERY_START,
    lenient: true,
    inline: [404],
    media: 'text/plain',
    noKeys: true /* a redirect has no body keys to leak */
  },
  'GET /provider/:key/callback': {
    summary: 'The provider sends the person back here: the answer is checked, the start row spent, and the browser goes to the web sign-in page with a one-time #h=<code> (or #e=<CODE>)',
    public: true,
    ok: 302,
    says: 'a redirect to the web sign-in page',
    query: QUERY_CALLBACK,
    lenient: true,
    inline: [404],
    media: 'text/plain',
    noKeys: true /* a redirect has no body keys to leak */
  },
  'POST /provider/handoff': {
    summary: 'The one-time code from the provider hand-off (#h=) and this device: the one connected account is signed in, answered as POST /verify answers; nobody is created, and no e-mail address finds an account',
    public: true,
    invalid: 400,
    inline: [400, 401, 403, 404, 409, 429, 503],
    list: false,
    body: ['code', 'device_id', 'surface'],
    required: ['code'],
    rules: { additionalProperties: false },
    out: object(['message', 'token', 'entity', 'identity', 'constitution'], { message: { type: 'string' }, token: { type: 'string' }, requires_pin_setup: { type: 'boolean' }, entity: {}, identity: {}, constitution: {} }, true)
  },
  'GET /provider/links': {
    summary: "The signed-in person's own connected provider accounts (never a subject or issuer) and which providers can be connected here",
    inline: [503],
    out: object(['reproof', 'links', 'providers'], { reproof: { type: 'string', enum: ['pin', 'code'] }, links: { type: 'array', items: object(['link_id', 'provider'], { link_id: { type: 'string' }, provider: { type: 'string' }, email: maybeText, email_verified: { type: 'boolean' }, linked_at: {}, last_used_at: {} }, true) }, providers: { type: 'array', items: object(['key', 'label', 'live', 'accepted'], { key: { type: 'string' }, label: { type: 'string' }, live: { type: 'boolean' }, accepted: { type: 'boolean' } }, true) } }, true)
  },
  'POST /provider/link/start': {
    summary: "Re-proof with the person's own PIN or a fresh code, then the address that starts connecting a provider to THIS account (one-use, one minute, this device and this session)",
    invalid: 400,
    inline: [400, 401, 403, 404, 503],
    list: false,
    body: ['provider', 'pin', 'otp', 'next', 'device_id', 'surface'],
    required: ['provider'],
    rules: { additionalProperties: false },
    out: object(['url'], { url: { type: 'string' } }, true)
  },
  'POST /provider/link/finish': {
    summary: 'The signed-in session that started a provider link confirms it with the one-time code from #k=; only this writes the link (same account, session and device as the start)',
    invalid: 400,
    inline: [400, 401, 403, 409, 503],
    list: false,
    body: ['code', 'device_id', 'surface'],
    required: ['code'],
    rules: { additionalProperties: false },
    out: object(['ok', 'linked'], { ok: { type: 'boolean' }, linked: { type: 'boolean' } }, true)
  },
  'DELETE /provider/links/:link_id': {
    summary: "Disconnect one of the person's own provider accounts, after re-proof; refused when it is the only way in or the business requires it; outstanding sign-in codes die with it",
    params: { link_id: { type: 'string', minLength: 1, maxLength: 64 } },
    invalid: 400,
    inline: [401, 403, 404, 409, 503],
    list: false,
    body: ['pin', 'otp', 'device_id', 'surface'],
    rules: { additionalProperties: false },
    out: object(['ok', 'removed'], { ok: { type: 'boolean' }, removed: { type: 'boolean' } }, true)
  }
};
const contract = contractOf({ mount: '/api/signin', routes: ROUTES, gateStatus: {} });

module.exports = { contract, ROUTES, QUERY_START, QUERY_CALLBACK };
