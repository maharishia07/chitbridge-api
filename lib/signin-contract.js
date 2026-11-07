/*
 * OWNS      the contract of routes/signin.js (/api/signin, the routes that read an input): each one's OpenAPI operation (S9) and the statuses the handlers write themselves.
 * CALLED BY routes/signin.js (schemaValidate on the five routes below, router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-signin.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      18-identity-sign-in-and-access/sign-in
 * This file shapes NO answer and moves no refusal: every sentence a sign-in door says stays in routes/signin.js, byte for byte (tests/signin-routes.test.cjs holds the golden).
 *
 * ⚠️ TWO ROUTES ARE NOT HERE ON PURPOSE: GET /sessions and GET /devices read no body, no query and no path value (the session is the token), so they have no input to declare.
 *    Their only refusals are the door's (a key 403 · the owner's 403 on /devices · a fault 500). POST /logout reads no body either, but a write declares its body: an empty closed one (API-47).
 * ⚠️ BEHAVIOUR FROZEN. Every body field is declared as anything and the body may be a list (`list`): the handlers read a missing or odd value in their own sentence, and `ask` and `verify` answer
 *    one refusal for an unknown account and a wrong secret alike (SEC-81). A schema that refused a value would tell a caller what an account is; this one refuses nothing the handlers took before.
 */
'use strict';
const { contractOf, object } = require('./contract-kit');
const { refusalFor } = require('./storefront-contract'); // the one 400 "Validation failed" body (an unknown key is named in details)

const GATE_STATUS = { session: 403 };
const SESSION = ['session'];
const DOOR_BODY = ['id', 'email', 'user_id', 'shop'];
/** S33: the body is closed to the keys the web sends (the sign-in window adds device_id and surface to every post: app/signin-ui.js httpPost; the till renew sends surface); any other key is refused by name */
const CLOSED = { additionalProperties: false };

const ROUTES = {
  'POST /renew': { summary: 'A new session on this device: the old one is gone, the device stays (a legacy token names its device in X-Device-Id)', gates: SESSION, invalid: 400, inline: [400], list: true, body: ['surface'], rules: CLOSED, out: object(['token', 'jti', 'exp', 'device_id']) },
  'POST /logout': { summary: 'End THIS session (the token is the whole request: no body is read)', gates: SESSION, invalid: 400, list: true, body: [], rules: CLOSED, out: object(['ok', 'removed']) },
  'POST /sessions/revoke': { summary: "End one session ({ jti }: your own, or anyone's for the owner) or every session on one device ({ device_id }, the owner alone)", gates: SESSION, invalid: 400, inline: [400, 403, 404], list: true, body: ['jti', 'device_id'], rules: CLOSED, out: object(['ok']) },
  'POST /ask': { summary: 'Ask for a sign-in: the same answer for everyone (a code is made and sent to a person who can sign in); nothing says who they are or what they need', public: true, invalid: 400, inline: [400], list: true, body: [...DOOR_BODY, 'display_name', 'mode', 'device_id', 'surface'], rules: CLOSED, out: object(['message']) },
  'POST /verify': { summary: 'Sign in with a code or a PIN; { username, pin|otp } is the key@Display Name door; a wrong secret and an unknown account get the one sign-in sentence', public: true, invalid: 400, inline: [400, 403, 409, 503], list: true, body: [...DOOR_BODY, 'username', 'otp', 'pin', 'context', 'agreed_at', 'constitution', 'device_id', 'surface', 'mode'], rules: CLOSED, out: object(['message', 'token', 'identity']) },
  'POST /pin': { summary: 'A co-assist sets their PIN after the first code', invalid: 400, inline: [400], list: true, body: ['pin', 'confirm_pin', 'device_id', 'surface'], rules: CLOSED, out: object(['message']) }
};
const contract = contractOf({ mount: '/api/signin', routes: ROUTES, gateStatus: GATE_STATUS });

/*
 * THE ALIASES (M06): routes/actors.js POST /login, POST /set-pin, GET /check-login and routes/entities.js POST /verify run routes/signin.js's handlers, each at its own address, so each carries its own
 * operation (lib/actors-contract.js, lib/entities-contract.js) built from the pieces below. Every refusal of theirs is a Problem that keeps the old body's keys (routes/signin.js).
 * The refusals a handler writes inside routes/signin.js are declared by a gate (declaresStatuses), and the body is CLOSED to the keys the web sends (S33).
 */
const BOOL = { type: 'boolean' };
/** what the key@Display Name door answers when it lets a person in */
const ACTOR_LOGIN_ANSWER = object(
  ['message', 'token', 'requires_pin_setup', 'actor'],
  { message: { type: 'string' }, token: { type: 'string' }, requires_pin_setup: BOOL, actor: {} },
  true
);
/** what the e-mail or User ID door answers when it lets a person in (requires_pin_setup only for a person who has no PIN yet) */
const ENTITY_VERIFY_ANSWER = object(
  ['message', 'token', 'entity', 'identity'],
  { message: { type: 'string' }, token: { type: 'string' }, requires_pin_setup: BOOL, entity: {}, identity: {}, constitution: {} },
  true
);
/** the statuses routes/signin.js's verify handler answers beyond the 400 the schema and the chain give: a choice of account, a removed device, a session list that failed */
const VERIFY_REFUSALS = [403, 409, 503];

/** the schemaValidate options of the closed bodies: the old 400 "Validation failed" body, code INVALID_INPUT (a sign-in screen has always read a 400, never a 422) */
const schemaOptions = refusalFor([]);

module.exports = { contract, schemaOptions, ROUTES, GATE_STATUS, ACTOR_LOGIN_ANSWER, ENTITY_VERIFY_ANSWER, VERIFY_REFUSALS, VERIFY_BODY: ['id', 'email', 'user_id', 'shop', 'username', 'otp', 'pin', 'context', 'agreed_at', 'constitution', 'device_id', 'surface'] };
