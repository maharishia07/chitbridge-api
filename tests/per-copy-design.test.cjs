/**
 * tests/per-copy-design.test.cjs — THE RECIPIENT'S COPY CARRIES THE RECIPIENT'S READING.
 *
 * Athi, 2026-08-24: *"the customer copy and supplier copy should be the same, but the interpretation can be in
 * another tab — how the customer request is interpreted can stay within the receiving end."*
 *
 * ⚠️⚠️ BOTH chit_header INSERTS WROTE THE SAME summary_json. So a recipient's copy carried the SENDER's
 * `detail_design`, and a fleet customer set to Order level silently decided that their workshop reads jobs at
 * order level too — the customer choosing how the supplier organises its mechanics. `chit_header` is per-copy
 * precisely so that it does not have to.
 *
 * ⭐ mint.party() is the seam the fix rides on: the operator's REDACTED oversight copy already proved a copy may
 * override summary_json. This asserts that passthrough holds — because it is a bare `indexOf(k) < 0` exclusion
 * list, and adding 'summary_json' to that list would silently re-fuse every copy to the sender's. No database:
 * building a copy is object arithmetic and is tested as object arithmetic.
 */
const mint = require('../lib/mint');

let pass = 0;
let fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  FAIL ' + name + (extra ? '   ' + extra : '')); }
};

const SENDER = 'cust-1';
const SUPPLIER = 'supp-1';

/* The shared record, exactly as the send path builds it — the sender here left the default alone, so it carries
   NO stamp at all (the flag is written only when it is not the default). */
const summary_json = { line_item_count: 1, total_value: 2400, currency_code: 'INR', purpose: 'order' };

const hdr = mint.header({
  sender_entity_id: SENDER, sender_entity_bridge_id: 'CBAAAA1111',
  sender_entity_display_name: 'cust-1', all_recipients: [], purpose: 'order',
  auto_subject: 'Service request', manual_subject: null, summary_json,
  schema_version: 1, schema_id: 'sch-1', created_by_actor_id: null,
  detail_type: 'order', line_item_count: 1, total_value: 2400, currency_code: 'INR',
});

/* The route's per-copy chooser, in the shape the route uses it: a resolved design per entity, and only that one
   key swapped onto the shared summary. */
const design = new Map([[SENDER, undefined], [SUPPLIER, 'lines']]);
const summaryFor = (eid) => {
  const d = design.get(eid);
  if (d === design.get(SENDER)) return summary_json;
  const s = Object.assign({}, summary_json);
  if (d) s.detail_design = d; else delete s.detail_design;
  return s;
};

const sent = mint.party(hdr, { entity_id: SENDER, direction: 'sent', role: 'Act', current_status: 'delivered' });
const recv = mint.party(hdr, {
  summary_json: summaryFor(SUPPLIER),
  entity_id: SUPPLIER, direction: 'received', role: 'Act', current_status: 'pending',
});

console.log('\nper-copy detail design');

t('the sender keeps their own reading (default, so no stamp)',
  sent.summary_json.detail_design === undefined,
  'got ' + JSON.stringify(sent.summary_json.detail_design));

t('⭐ the recipient carries THEIR OWN reading, not the sender\'s',
  recv.summary_json.detail_design === 'lines',
  'got ' + JSON.stringify(recv.summary_json.detail_design));

t('mint.party does not clobber a per-copy summary_json',
  recv.summary_json !== hdr.summary_json);

/* ⚠️ THE HALF THAT IS EASY TO BREAK BY BEING HELPFUL. Everything except the reading is the shared record — the
   value, the count, the currency, the purpose. A copy that diverges on any of those is two different trades. */
const shared = ['line_item_count', 'total_value', 'currency_code', 'purpose'];
t('every other key is still the SHARED record',
  shared.every((k) => sent.summary_json[k] === recv.summary_json[k]),
  shared.map((k) => k + '=' + recv.summary_json[k]).join(' '));

t('the sender\'s summary object was not mutated on the way past',
  summary_json.detail_design === undefined);

/* The other direction: a sender who chose Line level must not push it onto a recipient who did not. */
const design2 = new Map([[SENDER, 'lines'], [SUPPLIER, undefined]]);
const summaryFor2 = (eid) => {
  const d = design2.get(eid);
  const s = Object.assign({}, summary_json, { detail_design: 'lines' });
  if (d) s.detail_design = d; else delete s.detail_design;
  return s;
};
const recv2 = mint.party(hdr, {
  summary_json: summaryFor2(SUPPLIER),
  entity_id: SUPPLIER, direction: 'received', role: 'Act', current_status: 'pending',
});
/* ⚠️ AND THAT THE COPY WAS GENUINELY PER-COPY. Checking only for "no stamp" passes vacuously the moment
   summary_json stops being passed through at all — the exact regression this file exists to catch. */
t('⭐ a Line level SENDER does not stamp an Order level recipient',
  recv2.summary_json.detail_design === undefined && recv2.summary_json !== hdr.summary_json,
  'got ' + JSON.stringify(recv2.summary_json.detail_design)
    + (recv2.summary_json === hdr.summary_json ? ' — and it is the SHARED object, so this proved nothing' : ''));

console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
process.exitCode = fail ? 1 : 0;
