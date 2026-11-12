'use strict';
/**
 * c11-10b-rail-shape.test.cjs — C11 input-shape sweep 10b (rail send/read), no database:
 *  RAIL-81  a price/quantity under a name the engine does not read is NAMED in the send answer (200), never refused: the till's queue would retry a refusal for ever
 *  RAIL-177 a top-level line_id that is not a uuid, or is repeated, is a 400 naming the line (the till sends none)
 *  RAIL-212 retention past a hundred years is refused (schema for retention_days, handler for expires_at), never clamped
 *  RAIL-223 the ONE writer mint.deliver refuses a total/quantity/price past its column before any write (400 CHIT_AMOUNT_TOO_LARGE)
 *  RAIL-214 CTP_UNRESOLVABLE is a refusal lib/knownerr answers in words (503), not "Send failed"
 *  RAIL-186 a cost row without a currency is refused in words
 *  RAIL-135 ?fstatus=constructor is no bucket; a bad assigned_to / date_from is a 400
 *  RAIL-189 a non-Latin-1 attachment name makes a header Node accepts
 * CARD 01-rail-core-the-chit/chits-routes
 * Run: node tests/c11-10b-rail-shape.test.cjs
 */
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const reply = () => { const r = { code: 200, body: null, locals: {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, setHeader() {}, type() { return r; }, set() { return r; } }; return r; };
const lineShape = require('../lib/line-shape');
const chits = require('../routes/chits');
const mint = require('../lib/mint');
const knownerr = require('../lib/knownerr');
const input = require('../lib/chits-input');

(async () => {
  console.log('\n-- RAIL-81 · RAIL-177: the lines of a send');
  const till = [{ particulars: 'Tea', quantity: 2, unit: 'piece', price: 10, total: 20, item_id: 'x', hsn: '0902', gst_rate: 5, mods: [], offer: null, offers: [], item_data: { line_id: 'a', lot: 'b' } }, { particulars: 'Short', quantity: 0, unit: 'kg', price: null, total: null }];
  ok("the counter's own keys name nothing", lineShape.ignoredFigures(till).length === 0, JSON.stringify(lineShape.ignoredFigures(till)));
  ok('a shift or summary chit with no lines names nothing', lineShape.ignoredFigures([]).length === 0 && lineShape.ignoredFigures(undefined).length === 0);
  ok('a price under an unread name is named once', JSON.stringify(lineShape.ignoredFigures([{ quantity: 1, selling_price: 5 }, { selling_price: 6, amount: 3 }])) === '["selling_price","amount"]');
  ok('a note key is not a figure', lineShape.ignoredFigures([{ particulars: 'x', comment: 'hi', sku: 'a' }]).length === 0);
  ok('the till sends no line_id on a bill: none found', lineShape.badLineId(till) === null);
  ok('a non-uuid line_id is found on its line', JSON.stringify(lineShape.badLineId([{}, { line_id: 'abc' }])) === '{"line":2,"why":"not_uuid"}');
  const id = '11111111-1111-4111-8111-111111111111';
  ok('a repeated line_id is found', JSON.stringify(lineShape.badLineId([{ line_id: id }, { line_id: id.toUpperCase() }])) === '{"line":2,"why":"repeated"}');
  ok('a uuid line_id is fine', lineShape.badLineId([{ line_id: id }]) === null);

  const send = async (body) => { const res = reply(); const st = {}; const out = await chits.sendLineShape(st, { body, id: 'r1' }, res); return { res, st, out }; };
  const bad = await send({ line_items: [{ particulars: 'a', line_id: 'nope', quantity: 1 }] });
  ok('the send step answers 400 BAD_LINE_ID naming line 1', bad.res.code === 400 && JSON.stringify(bad.res.body).includes('BAD_LINE_ID') && /Line 1/.test(JSON.stringify(bad.res.body)), JSON.stringify(bad.res.body));
  const named = await send({ line_items: [{ particulars: 'a', quantity: 1, unit_cost: 4 }] });
  ok('the send step lets the line through and names the key (no refusal)', !named.out && named.res.body === null && JSON.stringify(named.st.ignored) === '["unit_cost"]', JSON.stringify(named.st.ignored));

  console.log('\n-- RAIL-212: retention');
  ok('retention_days is capped at a hundred years in days', input.SEND_BODY.retention_days.maximum === 36500);
  let refused = null;
  try { chits.declaredRetention({ expires_at: '9999-12-31T00:00:00Z' }); } catch (e) { refused = e; }
  ok('an expiry past a hundred years is refused 400, not clamped', refused && refused.status === 400 && refused.refused === true && refused.code === 'RETENTION_TOO_LONG');
  ok('knownerr answers it in words', (knownerr.known(refused) || {}).status === 400);
  ok('an ordinary expiry still reads', !!chits.declaredRetention({ expires_at: new Date(Date.now() + 86400000 * 30).toISOString() }));

  console.log('\n-- RAIL-223: the one writer');
  let queried = 0;
  const client = { query: async () => { queried++; return { rows: [] }; } };
  const copy = (total, lines) => ({ entity_id: 'e1', total_value: total, currency_code: 'AUD', line_items: lines || [] });
  for (const [what, copies] of [['a total of 1e13', [copy(1e13)]], ['a quantity of 1e15', [copy(10, [{ quantity: 1e15, price: 1 }])]], ['a price of 1e16', [copy(10, [{ quantity: 1, price: 1e16 }])]]]) {
    let err = null;
    try { await mint.deliver('e1', 'c1', copies, { arrived: true, client }); } catch (e) { err = e; }
    ok(what + ' is refused 400 CHIT_AMOUNT_TOO_LARGE at the writer', err && err.status === 400 && err.code === 'CHIT_AMOUNT_TOO_LARGE' && err.refused === true, err && err.message);
  }
  ok('nothing was written for any of them', queried === 0, 'queries: ' + queried);
  await mint.deliver('e1', 'c1', [copy(9999999999999.99, [{ quantity: 1, price: 1 }])], { arrived: true, client });
  ok('the largest total the column holds still goes to the write', queried === 1);

  console.log('\n-- RAIL-214: CTP_UNRESOLVABLE');
  const addr = require('../lib/ctpaddress');
  const real = addr.resolveAll;
  addr.resolveAll = async (ids) => new Map(ids.map((i) => [String(i), { resolved: false }]));
  let thrown = null;
  try { await mint.deliver('e1', 'c1', [copy(10)], { client }); } catch (e) { thrown = e; }
  addr.resolveAll = real;
  const answer = thrown && knownerr.known(thrown);
  ok('deliver throws CTP_UNRESOLVABLE and knownerr answers 503 with the code', thrown && thrown.code === 'CTP_UNRESOLVABLE' && answer && answer.status === 503 && answer.body.code === 'CTP_UNRESOLVABLE', JSON.stringify(answer) + (thrown && thrown.message));

  console.log('\n-- RAIL-186: a cost row names its currency');
  const Ajv = require('ajv');
  const v = new Ajv({ strict: false, allErrors: true });
  const costOk = v.compile(input.COST_BODY);
  ok('a row without currency is refused (single, list, rows)', !costOk({ amount: 5 }) && !costOk([{ amount: 5 }]) && !costOk({ rows: [{ amount: 5 }] }));
  ok('a row with currency passes (single, list, rows)', costOk({ amount: 5, currency: 'AUD' }) && costOk([{ amount: 5, currency: 'AUD' }]) && costOk({ rows: [{ amount: 5, currency: 'AUD' }] }));

  console.log('\n-- RAIL-135: list filters');
  const params = [];
  const where = chits.statusBucketFilter({ query: { fstatus: 'constructor' } }, params);
  ok('?fstatus=constructor is the literal status, not a bucket function', params.length === 1 && params[0] === 'constructor' && /IN \(\$1\)/.test(where), where);
  const run = (query) => { const res = reply(); let nexted = false; chits.filtersReadable({ query, id: 'r' }, res, () => { nexted = true; }); return { res, nexted }; };
  ok('a good day, an instant, me and a uuid pass', run({ date_from: '2026-11-01', date_to: '2026-11-12T10:00:00Z', assigned_to: 'me' }).nexted && run({ assigned_to: id }).nexted);
  const badDay = run({ date_from: '2026-02-30' });
  ok('2026-02-30 is a 400 naming date_from', !badDay.nexted && badDay.res.code === 400 && /date_from/.test(JSON.stringify(badDay.res.body)));
  ok('garbage assigned_to and date_to are 400', !run({ assigned_to: 'x' }).nexted && !run({ date_to: 'junk' }).nexted);

  console.log('\n-- the readers beside the doors (RAIL-135 · RAIL-79)');
  const filters = require('../lib/list-filters');
  ok('list-filters: nothing asked is nothing unreadable', filters.unreadable({}).length === 0 && filters.unreadable({ date_from: '' }).length === 0);
  ok('list-filters: a feb-30 day, a junk instant and a junk person are named in order', JSON.stringify(filters.unreadable({ assigned_to: 'x', date_from: '2026-02-30', date_to: 'junk' })) === '["assigned_to","date_from","date_to"]');
  ok('list-filters: all and an instant are readable', filters.unreadable({ assigned_to: 'all', date_to: '2026-11-12T10:00:00Z' }).length === 0);
  const alert = require('../lib/dispute-alert');
  ok('dispute alert: an absent party is named as not on this chit', alert.said({ mode: 'one_sided', parity_state: 'absent', target_display_name: 'Acme' }, false).startsWith('Acme is not on this chit.'));
  ok('dispute alert: a defunct party keeps the old words', /no longer reachable \(defunct\)/.test(alert.said({ mode: 'one_sided', parity_state: 'defunct', target_display_name: 'Acme' }, false)));
  ok('dispute alert: two-sided answers who was told', alert.said({ mode: 'two_sided' }, true).includes('chit-wide') && alert.said({ mode: 'two_sided' }, false).includes('selected party'));
  ok('line-shape: the answer carries nothing when nothing was ignored', JSON.stringify(lineShape.answerOf([])) === '{}' && lineShape.answerOf(['amount']).ignored[0] === 'amount' && /amount/.test(lineShape.answerOf(['amount']).says));

  console.log('\n-- RAIL-189: attachment names');
  const att = require('../routes/attachments');
  const http = require('http');
  const header = att.contentDisposition('Rechnung über €5 中.pdf');
  let setOk = true;
  try { new http.ServerResponse({ method: 'GET' }).setHeader('Content-Disposition', 'inline; ' + header); } catch (e) { setOk = false; }
  ok('a non-Latin-1 name sets a header (it threw before)', setOk, header);
  ok('ASCII fallback plus filename*=UTF-8 percent-encoded', /^filename="[\x20-\x7e]+"; filename\*=UTF-8''[A-Za-z0-9%._-]+$/.test(header), header);
  ok('a plain name is unchanged', att.contentDisposition('a.pdf') === 'filename="a.pdf"');
  let threw = false;
  try { new http.ServerResponse({ method: 'GET' }).setHeader('Content-Disposition', 'inline; filename="中.pdf"'); } catch (e) { threw = true; }
  ok('control: the old header for that name throws', threw);

  console.log('\n' + pass + ' checks, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
