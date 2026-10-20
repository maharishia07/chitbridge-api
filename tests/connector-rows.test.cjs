/**
 * connector-rows.test.cjs — lib/connector-rows: the ONE statement, row shape and read of the connectors that have checked in (SET-35).
 * Offline: the db is a stand-in. Held: the statement asks for the shop's active connector actors only, newest check-in first, in ONE query;
 * rowOut keeps the shape GET /api/integrations/status paints (health from routes/connectors, the one rule).
 */
const assert = require('assert');
const path = require('path');
const API = path.join(__dirname, '..');
let sent = [];
require.cache[require.resolve(API + '/db')] = { id: 'db', filename: 'db', loaded: true, exports: {
  query: async (text, params) => { sent.push({ text: String(text), params });
    return { rows: [{ identity_id: 'k1', display_name: 'Tally on OFFICE-PC', site: 'OFFICE-PC', last_seen: new Date().toISOString(), connector_type: 'erp', connector_config: { kit_id: 'tally@OFFICE-PC', adapter: 'tally', kit: true }, status: 'active' }] }; } } };
const { connectorsOf, rowOut, KIT_ROWS } = require('../lib/connector-rows');

let pass = 0, fail = 0;
const t = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (ok ? '' : ' ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };

(async () => {
  const rows = await connectorsOf('e1');
  t('one query, for the shop, newest check-in first', [sent.length, sent[0].params, /ORDER BY last_seen DESC NULLS LAST/.test(sent[0].text)], [1, ['e1'], true]);
  t('the statement is for active connector actors only', /identity_type = 'actor' AND connector_type IS NOT NULL AND status = 'active'/.test(KIT_ROWS), true);
  t('the row shape the status route paints', [rows[0].id, rows[0].name, rows[0].adapter, rows[0].host, rows[0].health, rows[0].kit], ['tally@OFFICE-PC', 'Tally on OFFICE-PC', 'tally', 'OFFICE-PC', 'live', true]);
  t('a kit that never checked in is offline, an erp actor without an adapter says erp', [rowOut({ identity_id: 'k2', connector_type: 'erp', last_seen: null }).health, rowOut({ identity_id: 'k2', connector_type: 'erp', last_seen: null }).adapter], ['offline', 'erp']);
  console.log('\n  ' + (pass + fail) + ' checks · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
