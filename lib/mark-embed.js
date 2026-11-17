'use strict';
// OWNS      marksIn(db, req, adopterKey, ids) → { byId, actions, vocabulary } | null: the marks of the records a LIST already serves, read inside the list's own transaction (no extra trip, round-trips.budget.json stays flat)
// CALLED BY routes/books.js (GET /daybook, GET /ledger/:account: adopter acc.audit) · tests/mark-embed.test.cjs
// FLOW      review_mark not made yet (b868 not run) → null, the list answers as it always did, with no mark keys → else ONE marksFor read under a savepoint (a fault in marks never fails the list)
// CARD      capability/MARK-AND-QUERY-CAPABILITY
const schema = require('./schema');
const core = require('./review-mark');
const door = require('./mark-door');
const { adopterOf, vocabularyOf } = require('./mark-adopters');
const cbLog = require('./logger');

let savepointCount = 0;
/** the marks for `ids` of `adopterKey` as { byId: { id: Mark | null }, actions, vocabulary }, or null when marking is not switched on or cannot be read */
async function marksIn(db, req, adopterKey, ids) {
  const adopter = adopterOf(adopterKey);
  if (!adopter || !(await schema.hasTable('review_mark'))) return null;
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const ctx = door.ctxOf(req);
  const point = 'mark_embed_' + ++savepointCount;
  await db.query('SAVEPOINT ' + point);
  try {
    const found = await core.marksFor(db, adopterKey, ctx.entity_id, unique, ctx);
    await db.query('RELEASE SAVEPOINT ' + point);
    return { byId: found.marks, actions: core.actionsOf(adopter, ctx, null), vocabulary: vocabularyOf(adopter) };
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT ' + point).catch(cbLog.orElse('marks embed: the rollback after the failed read also failed', undefined));
    cbLog.fellBack('marks embed: the read failed, the list is answered without marks', err);
    return null;
  }
}

module.exports = { marksIn };
