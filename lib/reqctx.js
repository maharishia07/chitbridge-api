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

const als = new AsyncLocalStorage();

/**
 * Run the rest of the request with `actorId` in scope. Called once, from `middleware/auth.js`, at the single
 * point where it hands control on — so the store is established before any route code runs.
 */
function runWithActor(actorId, fn) {
  /* E07: keep the request already in scope (its id, its res.locals) — the actor is added to it, never replaces it */
  return als.run(Object.assign({}, als.getStore() || {}, { actorId: actorId ? String(actorId) : null }), fn);
}

/**
 * E07 · THE REQUEST IN SCOPE — its id and its res.locals, so the database layer can put the request id on a slow
 * query's log line and a cancelled statement's code on the request's. Mounted once in server.js, AFTER the body
 * parsers (a parser's stream callback would leave the context behind).
 */
function runWithRequest(id, locals, fn) {
  return als.run(Object.assign({}, als.getStore() || {}, { requestId: id || null, locals: locals || null }), fn);
}

/** { id, locals } for the request in flight, or null (jobs, tests, migrations) */
function currentRequest() {
  const store = als.getStore();
  return store && store.requestId ? { id: store.requestId, locals: store.locals } : null;
}

/** The actor for the request in flight, or null when there is no request (jobs, tests, migrations). */
function currentActor() {
  const store = als.getStore();
  return (store && store.actorId) || null;
}

module.exports = { runWithActor, currentActor, runWithRequest, currentRequest };
