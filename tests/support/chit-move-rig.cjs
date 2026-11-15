/**
 * tests/support/chit-move-rig.cjs — a rig that loads lib/chit-move.js with its neighbours replaced, so moveStatus runs with no database:
 * the db hands out a recording client, the rail gate says yes, one open dispute is counted. Used by the RAIL-171 and RAIL-179 proofs.
 * CARD 01-rail-core-the-chit/chit-move
 */
'use strict';
const path = require('path');
const LIB = path.join(__dirname, '..', '..', 'lib');
const DB = path.join(__dirname, '..', '..', 'db', 'index.js');

function stub(file, exports) {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
/** { move, sql, warnings }: sql = every statement run, as { entity, text }; header = the sender of the chit (what the move reads) */
function load({ from, openDisputes, sender }) {
  const sql = [];
  const warnings = [];
  const client = (entity) => ({ query: async (text, params) => { sql.push({ entity, text: String(text).replace(/\s+/g, ' ').trim(), params }); const head = /FROM chit_header/.test(text) ? [{ sender_entity_id: sender, purpose: 'order', business_json: {}, all_recipients: [] }] : []; return { rows: head, rowCount: 1 }; } });
  stub(DB, { withEntity: async (entity, fn) => fn(client(entity)), withTransaction: async (fn) => fn(client(null)), query: async () => ({ rows: [] }) });
  stub(path.join(LIB, 'schema.js'), { hasTable: async () => true });
  stub(path.join(LIB, 'rail-status.js'), { statusGate: async () => ({ ok: true, from, write: async () => {} }) });
  stub(path.join(LIB, 'dispute-may.js'), { openOn: async () => openDisputes });
  stub(path.join(LIB, 'tax-copy.js'), { copyOn: async () => null, freezeOnComplete: async () => {} });
  stub(path.join(LIB, 'folder-inventory.js'), { docOf: () => 'order' });
  stub(path.join(LIB, 'bill-privacy.js'), { isBill: () => false, writeStep: async () => {} });
  stub(path.join(LIB, 'chit-crossing.js'), { crossing: () => null, postMessageCopies: async () => {} });
  stub(path.join(LIB, 'ctpreturn.js'), { onStatusMoved: async () => null, answerOf: () => ({}) });
  stub(path.join(LIB, 'books-hooks.js'), { takeBackCancelled: async () => null });
  stub(path.join(LIB, 'chit-proposal.js'), { usesRfq: async () => false });
  const logger = require(path.join(LIB, 'logger.js'));
  logger.fellBack = (what) => warnings.push(what);
  delete require.cache[require.resolve(path.join(LIB, 'chit-move.js'))]; /* a fresh copy each time: it binds its neighbours when it loads */
  const real = require(path.join(LIB, 'chit-move.js'));
  return { move: real, sql, warnings };
}
module.exports = { load };
