'use strict';
// OWNS      the DOOR of the marks router: who is calling and for whose records (ctxOf), the plain run (read, or the owner's own reply) and the GRANT WRITE run: look + write + log row in ONE transaction (writeRun)
// CALLED BY routes/marks.js · tests/mark-door.test.cjs
// FLOW      read, or no header: the books-grant front already swapped the identity (reads run READ ONLY) → ctx → withEntity(record owner) → the core
//           write under a grant (middleware/books-grant markWrite named the member): ONE withEntity(the writer's own entity) → the grant row + verdict (lib/books-grant, the same SQL as a look) → refused: its log row is kept and the refusal is answered
//           → allowed: the core writes (the record side read under the owner's scope, the writer side under the writer's: scope()) → the log row, outcome 'written' → commit. A log row that cannot be written throws: the mark rolls back.
// CARD      04-network/ACC-176-AUDITOR-GRANT
const { withEntity } = require('../db');
const auth = require('../middleware/auth');
const grants = require('./books-grant');
const { isOwner, isManager } = require('./owner');

/** the person and the business of a plain request or a swapped read (the front put the member's synthetic identity on req.identity and kept the caller on req.realIdentity) */
function ctxOf(req) {
  const acting = !!req.acting_for_grant;
  const real = acting ? req.realIdentity : req.identity;
  const entity = auth.entityOf(req);
  return {
    entity_id: entity,
    real: { identity_id: real.identity_id, name: real.display_name || null, entity_id: acting ? real.parent_entity_id || real.identity_id : entity, entity_name: acting ? req.acting_firm_name || null : null },
    owner: !acting && isOwner(req),
    via: acting ? { kind: 'grant', id: req.acting_for_grant, preset: req.identity.acting_preset } : { kind: 'self', id: null, preset: null }
  };
}

/** run work(db, ctx) in one transaction scoped to the record owner (a read, the owner's own reply); a grant read is READ ONLY by the request's own store */
async function runInOwnerScope(req, work) {
  const ctx = ctxOf(req);
  return withEntity(ctx.entity_id, (db) => work(db, ctx));
}

/** move a transaction to an entity's scope (the trusted setting every row policy and every definer reads) */
const bind = (db, entity) => db.query("SELECT set_config('app.current_entity', $1, true)", [String(entity)]);

/**
 * writeRun(req, work) → { result } | { refused: { status, code, words } } — the marks WRITE under a grant (req.mark_door, set by the front's markWrite). The refusal of a look keeps its log row (committed) and is returned, not thrown.
 * `door` is the request's own route text for the log ('POST /api/marks'); the log row of an allowed write says outcome 'written'.
 */
async function writeRun(req, work) {
  const door = req.mark_door;
  const real = req.identity;
  const grantee = door.real_entity;
  const request = { actor: real.identity_id, actor_name: real.display_name, role: door.role || undefined, pattern: door.door.replace(/:[^ ]+/g, ':id'), method: 'POST', listed: true, write_door: true, query_shape: null, owner: !real.parent_entity_id && !req.api_key, manager: isManager({ identity: real, api_key: req.api_key }) };
  if (!door.role) return { refused: grants.answerOf('no_grant', null) };
  grants.tooMany(grantee, door.member);
  return grants.asEntity(grantee, async (transaction) => {
    const withRole = await grants.roleColumnsReady();
    const row = await grants.rowFor(transaction, grantee, door.member, door.role);
    const answer = await grants.answerNamed(transaction, await grants.finalOutcome(transaction, row, request), row);
    if (!grants.logsLook(row)) return { refused: answer };
    if (!answer.allowed) {
      await grants.writeLogRow(transaction, withRole, row, door.member, grantee, request, answer);
      return { refused: answer };
    }
    const written = Object.assign({}, answer, { outcome: 'written', status: 201 });
    const firm = await grants.firmNameOf(transaction, grantee);
    const ctx = {
      entity_id: door.member,
      owner: false,
      real: { identity_id: real.identity_id, name: real.display_name || null, entity_id: grantee, entity_name: firm },
      via: { kind: 'grant', id: row.grant_id, preset: row.preset },
      scope: (db, side) => bind(db, side === 'record' ? door.member : grantee),
      onWrite: async (db) => {
        try {
          await grants.writeLogRow(db, withRole, row, door.member, grantee, request, written);
        } catch (failure) {
          throw grants.refusal('BOOKS_GRANT_LOG_UNAVAILABLE', 503, 'We could not record this, so nothing was saved. Try again in a minute.'); /* the mark rolls back with it: one transaction */
        }
      }
    };
    const result = await work(transaction, ctx);
    await bind(transaction, grantee); /* leave the transaction on the writer's side for its own commit */
    return { result };
  });
}

module.exports = { ctxOf, run: runInOwnerScope, writeRun };
