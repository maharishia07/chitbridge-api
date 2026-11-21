// OWNS      who is acting on this request, carried down the stack without a parameter (AsyncLocalStorage): runWithActor, currentActor, runWithRequest, currentRequest
// CALLED BY middleware/auth.js, server.js, db/index.js, lib/dbwatch.js, lib/limits.js, lib/raida.js, routes/network-offers.js
// FLOW      middleware runs the request inside an AsyncLocalStorage store → lower layers read who is acting.
// CARD      28-platform-and-operations/api-standard
/**
 * lib/reqctx.js — WHO is making this request, carried to the bottom of the stack without threading a parameter.
 *
 * Backlog: *"`app.current_actor` is set by nothing. b146 stamps `changed_by` from it, so the catalogue version
 * history has no author on any row."*
 *
 * ⚠️⚠️ THE TRIGGER WAS ALWAYS RIGHT AND ALWAYS EMPTY. b146 writes
 * `NULLIF(current_setting('app.current_actor', true), '')` into `changed_by` on every catalogue item version.
 * `current_setting(..., true)` returns `''` when the setting was never made, `NULLIF` turns that into NULL, and
 * the insert succeeds. So every version row records a change with **no author**, forever, and nothing
 * anywhere reports a problem. A provenance column that is always NULL is worse than no column: the schema
 * promises an answer the data never had.
 *
 * ⭐ TWO DIFFERENT QUESTIONS, TWO DIFFERENT SETTINGS.
 *     `app.current_entity` — WHOSE data this is. `auth.entityOf(req)`: a co-assist acts FOR its parent, so
 *                            everything it touches belongs to the business. This is what RLS scopes on.
 *     `app.current_actor`  — WHO did it. `req.identity.identity_id`: the co-assist themselves, or the entity
 *                            when an owner is signed in directly.
 *   Getting these the same way round would make `changed_by` say "the business changed it", which is the one
 *   thing the column already knew.
 *
 * ⭐⭐ WHY AsyncLocalStorage RATHER THAN A PARAMETER. `withEntity` is called from hundreds of places. Adding an
 * actor argument would stamp only the call sites someone remembered to update, and the ones they missed would
 * keep writing NULL — indistinguishable from today, and now with a mechanism that looks finished. ALS is Node's
 * own request-scoped context (`async_hooks`), so EVERY transaction opened during a request carries the actor
 * whether or not its author knew this existed. Nothing to remember is the only kind of rule that holds.
 *
 * ⚠️ ABSENT CONTEXT IS NOT AN ERROR. Migrations, cron jobs, tests and the webhook path open transactions with
 * no request behind them; `currentActor()` returns null, `set_config` writes `''`, and the trigger's NULLIF
 * produces exactly the NULL it produces today. This can only add authorship, never remove or falsify it.
 */
const { AsyncLocalStorage } = require('async_hooks');

const requestStore = new AsyncLocalStorage();

/**
 * Run the rest of the request with `actorId` in scope. Called once, from `middleware/auth.js`, at the single
 * point where it hands control on — so the store is established before any route code runs.
 */
function runWithActor(actorId, fn) {
  /* E07: keep the request already in scope (its id, its res.locals) — the actor is added to it, never replaces it */
  return requestStore.run(Object.assign({}, requestStore.getStore() || {}, { actorId: actorId ? String(actorId) : null }), fn);
}

/**
 * E07 · THE REQUEST IN SCOPE — its id and its res.locals, so the database layer can put the request id on a slow
 * query's log line and a cancelled statement's code on the request's. Mounted once in server.js, AFTER the body
 * parsers (a parser's stream callback would leave the context behind).
 */
function runWithRequest(id, locals, fn, ip) {
  return requestStore.run(Object.assign({}, requestStore.getStore() || {}, { requestId: id || null, locals: locals || null, ip: ip || null }), fn);
}
/** the caller address of the request in flight (lib/client-ip, the trusted-proxy rule), or null (jobs, tests): the per-caller tester guess budget keys on it */
function currentIp() {
  const store = requestStore.getStore();
  return (store && store.ip) || null;
}

/** { id, locals } for the request in flight, or null (jobs, tests, migrations) */
function currentRequest() {
  const store = requestStore.getStore();
  return store && store.requestId ? { id: store.requestId, locals: store.locals } : null;
}

/** The actor for the request in flight, or null when there is no request (jobs, tests, migrations). */
function currentActor() {
  const store = requestStore.getStore();
  return (store && store.actorId) || null;
}

/**
 * ACC-176 · READ ONLY FOR THE REST OF THE REQUEST. A grantee reading a member's books runs inside this: db/index.js opens every transaction of the request
 * with BEGIN READ ONLY, so Postgres itself refuses a write even if a route were wrongly listed or a GET quietly wrote. Nothing is added to a request that never calls it.
 */
function runReadOnly(fn) {
  return requestStore.run(Object.assign({}, requestStore.getStore() || {}, { readOnly: true }), fn);
}
/** true while the request in flight was put under runReadOnly (never in jobs, tests or migrations) */
function isReadOnly() {
  const store = requestStore.getStore();
  return !!(store && store.readOnly);
}

/**
 * ACC-176b · THE REST OF THE REQUEST ACTS UNDER AN ADVISER GRANT. A firm's team member writes in a member's books in one NORMAL transaction (never BEGIN READ ONLY); the grant's id rides the request so the one writer of each
 * books row can stamp it (lib/books-store insertEntry · logChange) with no argument threaded through the posting engine. Set only by middleware/books-grant, from the live grant row.
 */
function runActingFor(grantId, fn, who) {
  return requestStore.run(Object.assign({}, requestStore.getStore() || {}, { grantId: String(grantId), actingWho: who || null }), fn);
}
/** the grant the request in flight acts under, or null (every request that is not an adviser's) */
function actingGrantId() {
  const store = requestStore.getStore();
  return (store && store.grantId) || null;
}

/** who acts under the grant in flight ({ name, firm }), kept on the entry beside grant_id (b871) so the owner reads "by <person>, <firm>" with no read into the firm's identities; null when none was given */
function actingWho() {
  const store = requestStore.getStore();
  return (store && store.actingWho) || null;
}

module.exports = { currentIp, actingWho, runWithActor, currentActor, runWithRequest, currentRequest, runReadOnly, isReadOnly, runActingFor, actingGrantId };
