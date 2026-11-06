'use strict';
/**
 * OWNS      `node tools/live-trips.cjs --cleanup [--apply]`: take back, on sit-in, exactly what the live-trips harness left, by its lt- TAG (SPD-39). Without --apply it only prints the plan.
 * CALLED BY tools/live-trips.cjs (main). Tests/tooling only; sit-in is a TEST server and the HOSTS list there has no other.
 * FLOW      plan: tagged connection rows (note 'lt-%') · connector keys the csv kit download minted (name 'kit csv · <run day>') · lt- write-offs not yet reversed (daybook)
 *           apply: delete only the tagged connection rows by id · revoke the keys (DELETE /api/keys/:jti) · reverse each write-off with the product's own POST /api/books/entries/:id/reverse.
 * NOT TAKEN BACK, said in the output: connection rows with a pool shop that carry no lt- note (an earlier run did not tag them, so they cannot be told from a real connection: a person decides);
 *           the GST close of 2026-27/1 (the product has NO reopen route for a tax close: it stays; a re-run keeps the earlier measurement instead of failing).
 * CARD      speed · round trips
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the connection rows between the load shop and anyone: tagged (note lt-%) and untagged pool-shop ones */
function connectionRows(api, loadId) {
  const me = "(c.from_entity_id = '" + loadId + "' or c.to_entity_id = '" + loadId + "')";
  const tagged = api.sql("select c.connection_id from connections c where " + me + " and coalesce(c.note, '') like 'lt-%'").map((r) => r[0]);
  const other = "case when c.from_entity_id = '" + loadId + "' then c.to_entity_id else c.from_entity_id end";
  const untagged = api.sql("select c.connection_id from connections c join identities i on i.identity_id = " + other + " where " + me + " and i.user_id like 'cbt-in-%' and coalesce(c.note, '') not like 'lt-%'").map((r) => r[0]);
  return { tagged: tagged.filter((x) => UUID.test(x)), untagged: untagged.filter((x) => UUID.test(x)) };
}
/** the csv-kit keys minted on the run days (a download of the csv kit mints a key named 'kit csv · <day>') */
async function kitKeys(api, days) {
  const body = (await api.call('GET', '/api/keys')).body || {};
  return (body.keys || []).filter((k) => k && k.jti && days.some((d) => String(k.name || '').startsWith('kit csv · ' + d)));
}
/** lt- write-offs still standing: event write_off, not reversed, not itself a reversal, carrying the lt- tag somewhere in the entry */
async function writeOffs(api, from, to) {
  const body = (await api.call('GET', '/api/books/daybook?from=' + from + '&to=' + to)).body || {};
  return (body.entries || []).filter((e) => e.event_type === 'write_off' && !e.reversed_by_id && !e.reverses_entry_id && /\blt-/.test(JSON.stringify(e)) && UUID.test(String(e.entry_id)));
}

/** plan (apply false) or do (apply true); returns the lines printed so a test can read them */
async function cleanup(api, o) {
  const out = [];
  const say = (s) => { out.push(s); console.log(s); };
  const days = [...new Set([o.at, o.day].filter(Boolean))];
  const rows = connectionRows(api, o.loadId);
  const keys = await kitKeys(api, days);
  const wos = await writeOffs(api, days.slice().sort()[0], days.slice().sort().pop());
  say((o.apply ? 'removing ' : 'would remove ') + rows.tagged.length + ' tagged connection row(s) (note lt-), revoke ' + keys.length + ' csv kit key(s), reverse ' + wos.length + ' lt- write-off(s)');
  say('left alone: ' + rows.untagged.length + ' untagged pool-shop connection row(s) (an earlier run did not tag them; a person decides) · the GST close of 2026-27/1 (no reopen route in the product; a re-run keeps its earlier measurement)');
  if (!o.apply) return out;
  if (rows.tagged.length) api.sql("delete from connections where connection_id in ('" + rows.tagged.join("','") + "')");
  for (const k of keys) say('revoke key ' + String(k.jti).slice(0, 8) + ' → ' + (await api.call('DELETE', '/api/keys/' + k.jti)).status);
  for (const e of wos) say('reverse write-off ' + e.entry_no + ' → ' + (await api.call('POST', '/api/books/entries/' + e.entry_id + '/reverse', { reason: 'lt- live-trips cleanup' })).status);
  return out;
}
module.exports = { cleanup, connectionRows, kitKeys, writeOffs };
