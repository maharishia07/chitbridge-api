/*
 * OWNS      the contract of routes/books-grants.js: each route's OpenAPI operation (S9), the words of the consent screen, and the refusals the member's grant routes answer in.
 * CALLED BY routes/books-grants.js (schemaValidate, router.openapi) · tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 * Every route here is the MEMBER's (the owner of the books), never the auditor's: the auditor reads through GET /api/books/* with the X-Books-For header (middleware/books-grant.js), not through this file.
 */
'use strict';
const { contractOf, object, array, text } = require('./contract-kit');
const { UUID_TEXT } = require('./chits-input');
const { GRANT_READS } = require('../middleware/books-grant');

const IDS = { id: UUID_TEXT };
/** what an auditor can read, in plain words, named from the allow-list itself (the consent screen cannot say more or less than the guard allows) */
const READS_IN_WORDS = {
  '/accounts': 'your chart of accounts', '/daybook': 'your day book', '/ledger/:account': 'each ledger', '/trial-balance': 'your trial balance', '/pl': 'your profit and loss',
  '/bs': 'your balance sheet', '/dues': 'who owes you and whom you owe, by name', '/cashflow': 'your cash flow', '/periods': 'your closed months', '/year/:fy/status': 'the state of each year',
  '/terms': 'your payment terms', '/fx-rates': 'your exchange rates', '/health': 'the health check of your books', '/cheques': 'your cheques', '/bank/rail': 'your bank lines',
  '/returns': 'your tax return figures'
};
const consentWords = (canSeeCosts) => ({
  headline: 'Let your network parent read your books',
  can_read: [...GRANT_READS].map((route) => READS_IN_WORDS[route]).filter(Boolean),
  cannot: ['change or add anything', 'see customer or supplier phone numbers or bank details', 'copy or export your books'],
  costs: canSeeCosts === false ? 'It will not see your costs and margins.' : 'It will see your costs and margins.',
  rights: 'You can end this at any time. Every look is recorded and you can read the list. It ends by itself on the date you pick, 12 months from today unless you choose another.'
});

const GRANT = object(['grant_id', 'grantor_entity', 'grantee_entity', 'purpose', 'expires_at']);
const ROUTES = {
  'GET /consent': { summary: 'The plain words a member reads before it lets its network parent see its books', query: ['can_see_costs'], out: object(['headline', 'can_read', 'cannot', 'costs', 'rights'], { can_read: array() }) },
  'GET /': { summary: 'The access this business gave and the access it holds, each with whether it is live now', gates: ['owner'], inline: [503], out: object(['given', 'received'], { given: array(), received: array() }) },
  'POST /': { summary: 'Give the network parent read-only access to these books (owner only; purpose in words, an end date, a yes to the consent)', gates: ['owner'], ok: 201, inline: [403, 409, 422, 503], body: { grantee: UUID_TEXT, purpose: text, expires_at: text, can_see_costs: { type: 'boolean' }, consent: { type: 'boolean' } }, required: ['grantee', 'consent'], rules: { additionalProperties: false }, out: GRANT },
  'PATCH /:id': { summary: 'Change the end date or the purpose of an open access (owner only)', gates: ['owner'], inline: [403, 409, 422, 503], params: IDS, body: { purpose: text, expires_at: text }, rules: { additionalProperties: false }, out: GRANT },
  'POST /:id/revoke': { summary: 'End an access now: the auditor is refused on its very next request (owner only)', gates: ['owner'], inline: [403, 503], params: IDS, body: {}, rules: { additionalProperties: false }, out: GRANT },
  'GET /log': { summary: 'Who looked at these books, newest first: the route, the shape of the question and what was answered, never the figures', gates: ['owner'], inline: [503], query: ['limit', 'grant_id'], out: object(['looks'], { looks: array() }) }
};

module.exports = Object.assign({ ROUTES, consentWords, READS_IN_WORDS }, contractOf({ mount: '/api/books-grants', routes: ROUTES, gateStatus: { owner: 403 } }));
