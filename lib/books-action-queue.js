'use strict';
/**
 * lib/books-action-queue.js — THE QUEUE READS of the maker-checker store (split out of lib/books-action.js so that file stays under the 500-line ceiling).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      queueAsked(query, actor) → what a queue asks for · queuePage(handle, store, asked) → one page of it on the caller's transaction (the ONE read the queue, the To-do and the Home line share) ·
 *           waitingForOwner(handle, store, limit) → the actions waiting for the owner's accept · returnedFor(handle, store, identityId, limit, shopDay) → what the owner returned to this preparer in the last 14 days
 * CALLED BY lib/books-action.js (listActions; waitingForOwner and returnedFor are re-exported there) · lib/books-todo.js · lib/home-waiting.js
 * FLOW      the asked shape → ONE count + ONE page of heads + ONE read of their steps (books_action_step) → views (books-action.viewOf, grant liveness asked once per grant); nothing is counted a second way
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * The row shapes (STEP_COLUMNS, viewOf, grantLiveOf, sameId) stay books-action's: read here through its exports at call time (no second copy).
 */
const pageLimit = require('./page-limit'); /* the one pager: a page past the ceiling is clamped */
const schema = require('./schema');
const actions = () => require('./books-action'); /* the row shapes stay books-action's, read at call time */
const LAST_OF_STATE = { waiting_review: ['prepared'], waiting_accept: ['reviewed'], open: ['prepared', 'reviewed'], returned: ['returned'], accepted: ['accepted'], withdrawn: ['withdrawn'] };
const MAX_PAGE = 100;
const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/; /* a day, or a day with a time */
/** a query word that is true, as text or as a boolean */
const isTrue = (value) => value === 'true' || value === true;
/** a query word that is a whole day (or a day with a time), as text; null otherwise */
const dayOrNull = (value) => (DAY_SHAPE.test(String(value || '')) ? String(value) : null);
/** what a queue asks for: the page, the latest steps it wants (none = every state; no word = the open ones) and, for `mine`, the person */
function queueAsked(query, actor) {
  const states = query.state === 'all' ? null : (Object.prototype.hasOwnProperty.call(LAST_OF_STATE, query.state) && LAST_OF_STATE[query.state]) || LAST_OF_STATE.open;
  return {
    limit: Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), MAX_PAGE),
    page: pageLimit.pageOf(query.page),
    states,
    mine: isTrue(query.mine) ? actor.identity_id : null,
    delegated: isTrue(query.delegated),
    since: dayOrNull(query.since), /* MONEY-01 A25: the whole day, no trailing text */
    closed_since: dayOrNull(query.closed_since), /* MONEY-01 A4: filter on the LAST step's day (the return), not when it was prepared */
    grant: actor.grant_id || null /* a firm person sees only the actions of the grant it works under; the owner sees all */
  };
}
/** the view of each action of a page, with whether its grant is live (asked once per grant) */
async function viewsOfPage(handle, store, heads, rows) {
  const live = new Map();
  const views = [];
  for (const id of heads) {
    const steps = rows.filter((row) => actions().sameId(row.action_id, id));
    const grantId = steps[0].grant_id; /* null = the shop's own staff action: no grant to expire */
    const key = String(grantId);
    if (!live.has(key)) live.set(key, await actions().grantLiveOf(handle, store, grantId));
    views.push(actions().viewOf(steps, live.get(key)));
  }
  return views;
}
/** one page of the queue on the caller's transaction, by the asked shape (states, mine, grant, since, delegated, page, limit): the ONE read the queue, the To-do and the Home line share */
async function queuePage(handle, store, asked) {
  const { limit, page, states, mine, grant, delegated, since, closed_since: closedSince } = asked;
  const base = `FROM books_action_step p WHERE p.store = $1 AND p.step = 'prepared' AND ($3::uuid IS NULL OR p.actor_identity_id = $3) AND ($4::uuid IS NULL OR p.grant_id = $4) AND ($5::timestamptz IS NULL OR p.at >= $5)
    AND ($7::timestamptz IS NULL OR (SELECT t.at FROM books_action_step t WHERE t.action_id = p.action_id ORDER BY t.step_id DESC LIMIT 1) >= $7)
    AND (NOT $6::boolean OR EXISTS (SELECT 1 FROM books_action_step d WHERE d.action_id = p.action_id AND d.step = 'accepted' AND d.role = 'delegated'))
    AND ($2::text[] IS NULL OR (SELECT CASE WHEN t.step = 'prepared' AND p.role = 'staff' THEN 'reviewed' ELSE t.step END FROM books_action_step t WHERE t.action_id = p.action_id ORDER BY t.step_id DESC LIMIT 1) = ANY($2::text[]))`;
  const total = (await handle.query(`SELECT count(*)::int AS n ${base}`, [store, states, mine, grant, since, delegated, closedSince || null])).rows[0].n;
  const heads = (await handle.query(`SELECT p.action_id ${base} ORDER BY p.at DESC, p.step_id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, [store, states, mine, grant, since, delegated, closedSince || null])).rows.map((row) => row.action_id);
  const rows = heads.length ? (await handle.query(`SELECT ${actions().STEP_COLUMNS} FROM books_action_step WHERE store = $1 AND action_id = ANY($2::uuid[]) ORDER BY step_id`, [store, heads])).rows : [];
  return { actions: await viewsOfPage(handle, store, heads, rows), total, page, limit };
}
/**
 * waitingForOwner(handle, store, limit) → { total, actions } the actions waiting for the OWNER's accept (state waiting_accept: reviewed firm actions and the shop's own staff's held entries), on the caller's transaction; { total: 0, actions: [] } while b867 has not run.
 * The To-do kind "Entries waiting your OK" and the Home line read this one queue (REQ item 6); nothing is counted a second way.
 */
async function waitingForOwner(handle, store, limit) {
  if (!(await schema.hasTable('books_action_step'))) return { total: 0, actions: [] };
  const out = await queuePage(handle, store, queueAsked({ state: 'waiting_accept', limit }, {}));
  return { total: out.total, actions: out.actions };
}
/**
 * returnedFor(handle, store, identityId, limit, shopDay) → { total, actions } the actions THIS person prepared that the owner returned in the last 14 days (the note is on `closed.reason`), on the caller's transaction: the Bookkeeper's own To do line.
 * The same queue read (queuePage) with a preparer filter; nothing else of the store is visible through it.
 */
async function returnedFor(handle, store, identityId, limit, shopDay) {
  if (!identityId || !(await schema.hasTable('books_action_step'))) return { total: 0, actions: [] };
  const since = require('./books-engines').addDays(shopDay || require('./shop-clock').today(), -14); /* the shop's day, read by the one date reader */
  const out = await queuePage(handle, store, queueAsked({ state: 'returned', mine: true, closed_since: since, limit }, { identity_id: identityId }));
  return { total: out.total, actions: out.actions };
}
module.exports = { queueAsked, queuePage, waitingForOwner, returnedFor };
