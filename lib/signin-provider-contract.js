/*
 * OWNS      the contract of routes/signin-provider.js (SEC-112 P0: the provider list, the start and the callback): each route's OpenAPI operation (S9) and the statuses the handlers write themselves.
 * CALLED BY routes/signin-provider.js (router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json.
 * FLOW      operation → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      18-identity-sign-in-and-access/sign-in
 * ⚠️ A VISIT CANNOT SHOW JSON. start and callback are top-level browser visits: they answer a 302 (to the provider, or back to the web sign-in page with #e=<CODE> in the fragment). Only an unknown provider key is a 404 problem.
 *    The routes P1a adds (handoff · choose · connect/ask · connect · links) are declared there, with their own rows; these three start partial in docs/API-REGISTER.md until cb-api signs the human columns.
 */
'use strict';
const { contractOf, object } = require('./contract-kit');

const QUERY_START = ['device_id', 'next'];
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
  }
};
const contract = contractOf({ mount: '/api/signin', routes: ROUTES, gateStatus: {} });

module.exports = { contract, ROUTES, QUERY_START, QUERY_CALLBACK };
