'use strict';
/**
 * tests/crossing/lib/db.cjs — READ-ONLY database questions to a SIT installation, over ssh + psql in the db container.
 * OWNS      the read-only guard on the SQL · the JSON wrapping of a result · the uuid/word quoting every scenario uses
 * CALLED BY the scenarios (verify BOTH sides after an API call) · tests/ctp-crossing-pack.test.cjs
 * FLOW      q(topo, installation, sql) → rows[] (objects) ; the session is opened read-only (PGOPTIONS default_transaction_read_only) AND the text must be one SELECT/WITH
 * The tests never write through here: a write the product makes is read back, and a statement that is not a SELECT is refused before ssh is touched.
 * Runs as the postgres user so RLS does not hide the other copy: that is the point (both copies of a chit are compared).
 */
const ssh = require('./ssh.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** refuse anything that is not a single read statement */
function assertReadOnly(sql) {
  const text = String(sql).trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(text)) throw new Error('db guard: only SELECT/WITH is allowed here');
  if (text.includes(';')) throw new Error('db guard: one statement only');
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum)\b/i.test(text.replace(/'[^']*'/g, "''"))) throw new Error('db guard: a write word in the statement');
  return text;
}

/** a uuid as a SQL literal, or throws */
function uuid(value) {
  if (!UUID.test(String(value))) throw new Error('db: not a uuid: ' + value);
  return "'" + String(value).toLowerCase() + "'";
}
/** a text as a SQL literal (quotes doubled; no backslash escapes needed because standard_conforming_strings is on) */
function lit(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

/** the SQL as psql will run it: one JSON array of the rows */
function wrap(sql) {
  return 'SELECT coalesce(json_agg(t), \'[]\'::json) FROM (' + assertReadOnly(sql) + ') t;';
}

async function q(topo, key, sql) {
  const text = wrap(sql);
  const dbc = ssh.container(topo, key, 'db');
  const remote = 'sudo docker exec -i -e PGOPTIONS="-c default_transaction_read_only=on" ' + dbc + ' psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d chitbridge -f -';
  const out = await ssh.run(topo, key, remote, { stdin: text });
  if (out.code !== 0) throw new Error('db ' + key + ': psql failed: ' + out.stderr.trim().split('\n').slice(-2).join(' | '));
  return JSON.parse(out.stdout.trim() || '[]');
}

module.exports = { q, assertReadOnly, uuid, lit, wrap, UUID };
