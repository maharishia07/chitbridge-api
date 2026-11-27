/*
 * OWNS      the contract of routes/books-grants.js: each route's OpenAPI operation (S9), the words of the consent screen, and the refusals the member's grant routes answer in.
 * CALLED BY routes/books-grants.js (schemaValidate, router.openapi) · tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 * Every route here is the MEMBER's (the owner of the books), never the auditor's: the auditor reads through GET /api/books/* with the X-Books-For header (middleware/books-grant.js), not through this file.
 */
'use strict';
const { contractOf, object, array, text } = require('./contract-kit');
const { SEATS } = require('./role-matrix'); /* the role matrix: what each seat is answered (register column 14) */
const bounds = require('./bounds'); /* the one set of input bounds: a list's page size is bounds.limit() (column 16, resource_cap) */
const { UUID_TEXT } = require('./chits-input');
const { GRANT_READS, FILE_READS } = require('../middleware/books-grant');

const IDS = { id: UUID_TEXT };
/** what an auditor can read, in plain words, named from the allow-list itself (the consent screen cannot say more or less than the guard allows) */
const READS_IN_WORDS = {
  '/accounts': 'your chart of accounts', '/daybook': 'your day book', '/ledger/:account': 'each ledger', '/trial-balance': 'your trial balance', '/pl': 'your profit and loss',
  '/bs': 'your balance sheet', '/dues': 'who owes you and whom you owe, by name', '/party/:id/statement': 'the balance and entries of each customer or supplier', '/cashflow': 'your cash flow', '/periods': 'your closed months', '/year/:fy/status': 'the state of each year',
  '/terms': 'your payment terms', '/fx-rates': 'your exchange rates', '/health': 'the health check of your books', '/cheques': 'your cheques',
  '/overview': 'your business at a glance: sales against last year, profit by month, what you are owed and owe, and cash for the next 30 days',
  '/returns': 'your tax return figures',
  '/opening': 'your opening balances, line by line, with who entered them and when', '/opening/years': 'the opening and the carry-forward of each year',
  '/bank/log': 'your bank reconciliation record: who matched each line, and the months signed off',
  '/loans': 'what you owe on each loan: the lender, the amount taken and what is still outstanding', '/gst/lodged': 'the tax years you have declared lodged',
  '/bank/statement-files': 'the list of bank statements you keep in your Statements box'
};
/** the words of the ADVISER grant (ACC-176b): a separate role from the auditor's, in the owner's plain words: it can change the books, so the screen says so first */
const ADVISER_WORDS = {
  headline: 'Let your adviser firm act in your books',
  can_read: ['everything you can see in your books'],
  can_do: ['post and reverse entries', 'lock and unlock a month, and close the year', 'do the owner steps of your books, the same as you'],
  posting_choices: [
    { value: 'adviser_posts', words: 'Your adviser posts for you. Nobody else checks an entry before it is posted; every post is recorded in your audit log and shown in your weekly summary; an unlock or a year close is listed there at once.' },
    { value: 'owner_approves', words: 'You approve each post. Your adviser prepares, a colleague at the firm checks it, and you accept it.' }
  ],
  cannot: ['act outside your books', 'be used by anyone outside that firm', 'hide what it did: every step is recorded with the name of the person and the firm'],
  rights: 'You can end this at any time, on its own, apart from any auditor access. It ends by itself on the date you pick, 12 months from today unless you choose another.'
};
/** CON-165 (DECISIONS.md 27 Nov, firm seats never see client phone/e-mail): the party reads a firm seat makes, said in the consent: the list (lib/party-grant-view) is the same cut */
const PARTIES_IN_WORDS = 'your customers and suppliers: names, party numbers, customer tax numbers, terms and balances (never their phone numbers, e-mail or bank details)';
const consentWords = (canSeeCosts, preset) => preset === 'adviser' ? Object.assign({ costs: canSeeCosts === false ? 'It will not see your costs and margins.' : 'It will see your costs and margins.' }, ADVISER_WORDS) : ({
  headline: 'Let your network parent read your books',
  can_read: [...[...GRANT_READS].map((route) => READS_IN_WORDS[route]).filter(Boolean), PARTIES_IN_WORDS],
  cannot: ['change or add anything', 'see customer or supplier phone numbers or bank details', 'copy or export your books', ...(FILE_READS.size ? ['download your bank statement files or the evidence kept with an entry'] : [])],
  costs: canSeeCosts === false ? 'It will not see your costs and margins.' : 'It will see your costs and margins.',
  rights: 'You can end this at any time. Every look is recorded and you can read the list. It ends by itself on the date you pick, 12 months from today unless you choose another.'
});

const GRANT = object(['grant_id', 'grantor_entity', 'grantee_entity', 'purpose', 'expires_at']);
const ROUTES = {
  'GET /consent': { seats: SEATS.EVERYONE_SIGNED_IN, summary: 'The plain words a member reads before it lets its network parent see its books', inline: [403], query: ['can_see_costs', 'preset'], out: object(['headline', 'can_read', 'cannot', 'costs', 'rights'], { can_read: array() }) },
  'GET /': { seats: SEATS.OWNER_AND_FIRM_SEATS, summary: 'The access this business gave and the access it holds, each with whether it is live now; a person of a firm that holds access sees only the access the firm holds (the owner of the books, or a person who may use a grant)', gates: ['owner'], inline: [503], out: object(['given', 'received', 'seats'], { given: array(), received: array(), parents: array(), seats: array() }) },
  'GET /practice': { seats: SEATS.OWNER_AND_FIRM_SEATS, summary: "A firm's client list in one read, worst first (page and limit ask for a page of the list, at most 200 a page, the contract's own limit maximum; with neither the whole list comes): per live client the work waiting (queries, return due, months not locked, entries checked, access ending) and the business's health read from the client's own books, with the rule applied; one look is logged per client; the On us today tile to_check carries n (clients behind) and entries (the entries to check, the sum of each client's own count)", gates: ['grant_user'], inline: [503], query: ['page', 'limit'], queryBounds: { limit: bounds.limit() }, out: object(['rule', 'today', 'band', 'clients', 'truncated', 'own_trade'], { rule: {}, words: {}, band: {}, clients: array(), total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' }, has_more: { type: 'boolean' }, may_assign: { type: 'boolean' }, may_take: { type: 'boolean' } }) },
  'POST /practice/baseline': { seats: SEATS.OWNER_AND_FIRM_SEATS, summary: "Mark a client as checked: the person's own check point for the 'changed since' count, the moment the Day book showed (seen_to); a firm seat, never the client's owner, no look is logged and the client never sees it", gates: ['grant_user'], ok: 201, inline: [400, 403, 503], body: { client: UUID_TEXT, seen_to: { type: 'string', examples: ['2026-01-01T00:00:00.000Z'] } }, required: ['client', 'seen_to'], rules: { additionalProperties: false }, out: object(['client', 'seen_to', 'made_at'], { client: text, seen_to: text, made_at: text }, true) },
  'POST /': { seats: SEATS.OWNER_ONLY, summary: 'Give the network parent access to these books: preset auditor (read only, the default) or adviser (the firm acts for the owner); owner only; purpose in words, an end date, a yes to the consent', gates: ['owner'], ok: 201, inline: [403, 409, 422, 503], body: { grantee: UUID_TEXT, preset: { type: 'string', enum: ['auditor', 'adviser'] }, posting: { type: 'string', enum: ['owner_approves', 'adviser_posts'] }, posting_cap_minor: { type: 'integer', minimum: 1 }, posting_cap_currency: text, purpose: text, expires_at: text, can_see_costs: { type: 'boolean' }, consent: { type: 'boolean' } }, required: ['grantee', 'consent'], rules: { additionalProperties: false }, out: GRANT },
  'PATCH /:id': { seats: SEATS.OWNER_ONLY, summary: 'Change the end date of an open access (owner only)', gates: ['owner'], inline: [403, 422, 503], params: IDS, body: { expires_at: text, posting: { type: 'string', enum: ['owner_approves', 'adviser_posts'] }, posting_cap_minor: { type: ['integer', 'null'], minimum: 1 }, posting_cap_currency: { type: ['string', 'null'] } }, rules: { additionalProperties: false }, out: GRANT },
  'POST /:id/revoke': { seats: SEATS.OWNER_ONLY, summary: 'End an access now: the auditor is refused on its very next request (owner only)', gates: ['owner'], inline: [403, 503], params: IDS, body: {}, rules: { additionalProperties: false }, out: GRANT },
  'GET /log': { seats: SEATS.OWNER_ONLY, summary: 'Who looked at these books, newest first: the route, the shape of the question and what was answered, never the figures', gates: ['owner'], inline: [503], query: ['limit', 'grant_id'], queryBounds: { limit: Object.assign({}, bounds.limit(), { 'x-words': { type: 'limit must be a string.' } }) } /* the released sentence for a limit sent twice stays */, out: object(['looks'], { looks: array() }) }
};

module.exports = Object.assign({ ROUTES, consentWords, READS_IN_WORDS }, contractOf({ mount: '/api/books-grants', routes: ROUTES, gateStatus: { owner: 403, grant_user: 403 } }));
