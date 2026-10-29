'use strict';
/**
 * tests/stock-gorilla-truth.realstack.cjs — GORILLA PACK 6: POST /api/supplies/purchase, POST /api/till/stock (+ /bulk) and
 * PUT /api/products/:id/availability, hammered (docs/api/COLUMN-13-ADDS-UP.md §4a, sixth and last in its order; ADDS-STOCK-1).
 *
 * owns: the three doors that move a count or say what is on the shelf, and the checks every press must pass. The generator is
 *       tests/lib/gorilla.cjs; the doors, the case runner and the fresh shop are tests/lib/truth-harness.cjs. Pack 1 (send-gorilla) is the pattern.
 * FLOW  three fresh shops (the products limiter is 240 a minute per caller), each with a supply it counts (Tape, in rolls, bought once
 *       on its own bill number) and one it expenses (Paper), and another shop with a product of its own → per record: before() makes
 *       what the press needs (a fresh product · the other shop's · an id that is no row · an id that is no id) and snapshots the counts
 *       and the product → send() presses one door (a purchase sometimes twice) and snapshots again → GS-1..GS-14 → one case each
 * CARD 13-inventory-stock-and-traceability/README
 *
 * What a record varies: the door; for a purchase 1–3 lines (the counted supply · the expensed one · a new one · no name), each with a
 * quantity (valid · not a number · true) and a cost (valid · none · invalid), sometimes a unit the count is not kept in, a cost of 1e20,
 * a date that is no date, the same bill again, or a bill number used before; at the counter a status (either case, or one the counter
 * may not set) with or without a return day; for availability a quantity, an as_of and a source; and the target.
 *
 * What every press must do (ADDS-STOCK-1: a stock write names its item, a quantity above zero, its unit and reason; it moves the count
 * once, and says so — never a count the answer did not report, never a figure nobody typed):
 *   GS-1  never a 500: kept, or refused with a sentence
 *   GS-2  every purchase line is recorded or refused with a why; none is dropped
 *   GS-3  the count moves by exactly what the answer recorded as counted; an expensed or refused line moves nothing
 *   GS-4  a bill number used before moves nothing unless the answer says it moved: the same bill again says so, never "counted" twice
 *   GS-5  a quantity that is no number (true) is refused, never read as 1
 *   GS-6  a line with no cost is said, never a silent ₹0 on the count
 *   GS-7  a cost of 1e20, or a date that is no date, is refused in words, never a 500
 *   GS-8  at the counter: available or unavailable (either case) is kept; any other status is refused, and nothing changes
 *   GS-9  at the counter: a return day that is no day, or one on "available", is refused 400 in words, never a 500
 *   GS-10 the counter's bulk answers what moved against what was asked, and says what could not be found
 *   GS-11 availability: a quantity is kept to three places; one that is no number (negative · a word · blank · true · []) is refused
 *   GS-12 availability: an as_of that is no moment or still to come, or a source not on the list, is refused in words
 *   GS-13 a product that is not mine (the other shop's · no such row) is refused, and the other shop's product is untouched
 *   GS-14 a product id that is no id is a 400 or 404, never a 500 (alone, or one among many in a bulk)
 *   TODAY (gaps, filed 2026-10-29): GS-4 OPS-69 · GS-5 OPS-70 · GS-6 OPS-70 · GS-7 OPS-71 · GS-9 CTR-169 · GS-11 CAT-232 ·
 *   GS-12 CAT-232 · GS-14 CAT-230
 *
 * Fixed seed 20261103 · budget 180 s · GORILLA_N (default 200) · GORILLA_SEED=<n>|random · GORILLA_ONLY=<i> replays one.
 * Run: node tests/stock-gorilla-truth.realstack.cjs
 * ⚠️ LOCAL ONLY (the harness refuses anything else). Writes go through the routes; the database is only SELECTed.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const G = require('./lib/gorilla.cjs');
const { DB, j, ok, kase, freshShop, finish } = H;

/* the run tag names the fresh SHOPS, supplies and products only (the world); nothing in a record reads it */
const RUN = 'gs' + (Date.now() % 1e10).toString(36);
const FIXED_SEED = 20261103;
const SHOPS = 3;
const ownOf = (world, index) => world.shops[index % SHOPS];
const textOf = (reply) => [reply && reply.error, reply && reply.message, reply && reply.why, reply && reply.detail].find((said) => typeof said === 'string' && said.trim());

/* a value is { v, cls }: valid · invalid (refused today too) · noNumber (true, [] — read as 1 or 0 today) · none (no cost) · huge */
const QTY = [{ v: 5, cls: 'valid' }, { v: 2.5, cls: 'valid' }, { v: '3', cls: 'valid' }, { v: 0, cls: 'invalid' }, { v: -1, cls: 'invalid' }, { v: 'abc', cls: 'invalid' }, { v: true, cls: 'noNumber' }];
const COST = [{ v: 10, cls: 'valid' }, { v: 12.5, cls: 'valid' }, { v: '8', cls: 'valid' }, { v: undefined, cls: 'none' }, { v: -5, cls: 'invalid' }, { v: 'abc', cls: 'invalid' }];
const STATUS = [{ v: 'available', ok: true }, { v: 'unavailable', ok: true }, { v: 'AVAILABLE', ok: true }, { v: 'retired', ok: false }, { v: '', ok: false }, { v: 'gone', ok: false }];
const UNTIL = [{ v: undefined, cls: 'none' }, { v: undefined, cls: 'none' }, { v: '2026-12-01', cls: 'day' }, { v: 'tomorrow', cls: 'noDay' }];
const AVAIL_QTY = [{ v: 5, cls: 'valid' }, { v: 2.5, cls: 'valid' }, { v: 0, cls: 'valid' }, { v: '7', cls: 'valid' }, { v: 0.125, cls: 'valid' }, { v: -1, cls: 'invalid' }, { v: 'abc', cls: 'invalid' }, { v: null, cls: 'invalid' }, { v: '', cls: 'invalid' }, { v: true, cls: 'noNumber' }, { v: [], cls: 'noNumber' }];
const AS_OF = [{ v: undefined, cls: 'none' }, { v: undefined, cls: 'none' }, { v: '2026-10-01T10:00:00.000Z', cls: 'valid' }, { v: 'garbage', cls: 'bad' }, { v: '2030-01-01T00:00:00.000Z', cls: 'bad' }];
const SOURCE = [{ v: undefined, cls: 'none' }, { v: 'erp', cls: 'valid' }, { v: 'manual', cls: 'valid' }, { v: 'magic', cls: 'bad' }];
const TARGETS = ['theirs', 'unknownId', 'badId'];

/* a fresh supply is counted on even lines, expensed on odd ones */
const counted = (line, at) => line.supply === 'kept' || (line.supply === 'fresh' && at % 2 === 0);
/** the ONE answer a line is graded for: refused (today too) · noNumber (a quantity of true, or a bad cost on an expensed line: kept today) · kept */
function verdictOf(line, at) {
  if (line.supply === 'blank' || line.qty.cls === 'invalid' || line.wrongUnit) return 'refused';
  if (line.cost.cls === 'invalid') return counted(line, at) ? 'refused' : 'noNumber';
  return line.qty.cls === 'noNumber' ? 'noNumber' : 'kept';
}
/** one purchase line: which supply, its quantity and cost, maybe a unit the count is not kept in */
function lineOf(h) {
  const supply = h.pick(['kept', 'kept', 'expensed', 'fresh', 'blank']);
  return { supply, qty: h.pick(QTY), cost: h.pick(COST), wrongUnit: supply === 'kept' && h.chance(0.12) };
}

/** one seeded record: the door and what it carries */
function makeRecord(h, index) {
  const door = h.pick(['purchase', 'purchase', 'stock', 'bulk', 'avail', 'avail']);
  const record = { index, door };
  if (door === 'purchase') {
    record.lines = Array.from({ length: h.int(1, 3) }, () => lineOf(h));
    record.bill = h.chance(0.1) ? 'again' : h.chance(0.1) ? 'reused' : 'fresh';
    record.extra = h.chance(0.06) ? 'hugeCost' : h.chance(0.06) ? 'badAt' : null;
    if (record.extra === 'hugeCost') record.lines[0].cost = { v: 1e20, cls: 'huge' };
    record.lines.forEach((line, at) => (line.verdict = verdictOf(line, at)));
    return record;
  }
  record.target = h.chance(0.15) ? h.pick(TARGETS) : 'own';
  if (door === 'avail') return Object.assign(record, { qty: h.pick(AVAIL_QTY), asOf: h.pick(AS_OF), source: h.pick(SOURCE) });
  record.status = h.pick(STATUS);
  record.until = door === 'stock' ? h.pick(UNTIL) : { v: undefined, cls: 'none' };
  return record;
}

/* ── what the database holds ─────────────────────────────────────────────────────────────────────────────────────────── */
/** every supply of a shop and its count: { name: qty } (a supply never counted reads 0) */
async function counts(pg, entity) {
  const rows = (await pg.query(
    `SELECT s.name, COALESCE(SUM(b.qty), 0)::float AS qty FROM supply_item s
       LEFT JOIN stock_balance b ON b.entity_id = s.entity_id AND b.item_id = s.supply_item_id AND b.item_kind = 'supply'
      WHERE s.entity_id = $1 GROUP BY s.name`, [entity])).rows;
  return Object.fromEntries(rows.map((row) => [row.name, row.qty]));
}
async function itemOf(pg, itemId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(itemId))) return null;
  const row = (await pg.query('SELECT item_data FROM catalogue_items WHERE item_id = $1', [itemId])).rows[0];
  return row ? row.item_data : null;
}
const newProduct = async (token, name) => ok(await j('/api/products', { method: 'POST', token, body: { item_data: { name, unit: 'kg', price: 60 } } }), name).b.item.item_id;

/* ── before and the press ─────────────────────────────────────────────────────────────────────────────────────────────── */
function maker(world, pg) {
  return async (record, index) => {
    const own = ownOf(world, index);
    if (record.door === 'purchase') return { index, own, before: await counts(pg, own.shop.entity) };
    if (record.target === 'theirs') return { index, own, itemId: world.theirs, before: await itemOf(pg, world.theirs) };
    if (record.target === 'unknownId') return { index, own, itemId: '00000000-0000-4000-8000-' + String(800000000000 + index), before: null };
    /* a bulk with an id that is no id carries one product of mine beside it: one bad id among good ones */
    if (record.target === 'badId') return { index, own, itemId: 'not-a-product-' + index, before: null, second: record.door === 'bulk' ? await newProduct(own.shop.token, 'Gorilla dal ' + RUN + ' ' + index + 'b') : undefined };
    const itemId = await newProduct(own.shop.token, 'Gorilla dal ' + RUN + ' ' + index);
    const made = { index, own, itemId, before: await itemOf(pg, itemId) };
    /* a bulk carries a second product of mine, and sometimes an id that is no row */
    if (record.door === 'bulk') made.second = await newProduct(own.shop.token, 'Gorilla dal ' + RUN + ' ' + index + 'b');
    return made;
  };
}

const nameOf = (line, own, index, at) => ({ kept: own.kept, expensed: own.expensed, fresh: 'Gorilla twine ' + RUN + ' ' + index + '-' + at, blank: '  ' })[line.supply];
/** the purchase body a record sends */
function purchaseOf(record, made) {
  const own = made.own;
  const lines = record.lines.map((line, at) => {
    const body = { name: nameOf(line, own, record.index, at), qty: line.qty.v, keep_stock: counted(line, at) };
    if (line.cost.v !== undefined) body.cost = line.cost.v;
    if (line.supply === 'kept') body.unit = line.wrongUnit ? 'kg' : 'roll';
    return body;
  });
  const body = { ref: record.bill === 'reused' ? own.usedRef : 'GS-' + RUN + '-' + record.index, from: 'Gorilla Mayur', lines };
  if (record.extra === 'badAt') body.at = 'garbage';
  return body;
}
/** the press a record makes, as { url, method, body } */
function pressOf(record, made) {
  if (record.door === 'purchase') return { url: '/api/supplies/purchase', method: 'POST', body: purchaseOf(record, made) };
  if (record.door === 'avail') {
    const body = {};
    for (const [key, value] of [['qty', record.qty], ['as_of', record.asOf], ['source', record.source]]) if (value.v !== undefined) body[key] = value.v;
    return { url: '/api/products/' + encodeURIComponent(made.itemId) + '/availability', method: 'PUT', body };
  }
  if (record.door === 'stock') {
    const body = { item_id: made.itemId, status: record.status.v };
    if (record.until.v !== undefined) body.until = record.until.v;
    return { url: '/api/till/stock', method: 'POST', body };
  }
  const ids = [made.itemId].concat(made.second ? [made.second] : []);
  return { url: '/api/till/stock/bulk', method: 'POST', body: { item_ids: ids, status: record.status.v } };
}

function presser(world, pg) {
  return async (record, index, made) => {
    const press = pressOf(record, made);
    const token = made.own.shop.token;
    const first = await j(press.url, { method: press.method, token, body: press.body });
    const seen = { status: first.status, said: textOf(first.b), body: first.b || {}, made, sent: press.body };
    if (record.door === 'purchase') {
      seen.mid = await counts(pg, made.own.shop.entity);
      if (record.bill === 'again' && first.status === 200) {
        const again = await j(press.url, { method: press.method, token, body: press.body });
        Object.assign(seen, { againStatus: again.status, againBody: again.b || {} });
      }
      seen.after = await counts(pg, made.own.shop.entity);
    } else {
      seen.after = await itemOf(pg, made.itemId);
      if (made.second) seen.afterSecond = await itemOf(pg, made.second);
    }
    return seen;
  };
}

/* ── the checks ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
const said = (seen) => (seen.said ? ' "' + seen.said.slice(0, 80) + '"' : '');
const same = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 1e-6;
const unchanged = (seen) => JSON.stringify(seen.after) === JSON.stringify(seen.made.before);
const show = (record) => record.door + (record.door === 'purchase' ? ' ' + record.bill + (record.extra ? ' ' + record.extra : '') + ' ' + record.lines.map((line) => line.supply + ':' + JSON.stringify(line.qty.v) + '@' + JSON.stringify(line.cost.v) + (line.wrongUnit ? '/kg' : '')).join(',') : ' ' + record.target);
/** the count each supply should move by: what the answer recorded as counted */
function recordedMoves(body) {
  const moves = {};
  for (const line of body.recorded || []) if (line.kept) moves[line.name] = (moves[line.name] || 0) + Number(line.qty);
  return moves;
}
function movedWrong(before, after, moves) {
  for (const name of new Set(Object.keys(after).concat(Object.keys(moves)))) {
    const moved = Number(after[name] || 0) - Number(before[name] || 0);
    if (!same(moved, moves[name] || 0)) return name + ' moved ' + moved + ', the answer recorded ' + (moves[name] || 0) + ' as counted';
  }
  return null;
}
const plain = (record) => record.door === 'purchase' && !record.extra && record.bill === 'fresh';
/** a refusal that writes nothing */
function refusedClean(record, seen, statuses) {
  if (statuses.indexOf(seen.status) < 0) return show(record) + ' answered HTTP ' + seen.status + said(seen);
  if (!seen.said) return show(record) + ' refused HTTP ' + seen.status + ' with no sentence';
  return unchanged(seen) ? null : 'refused, but it changed: ' + JSON.stringify(seen.made.before).slice(0, 120) + ' → ' + JSON.stringify(seen.after).slice(0, 120);
}
/** an availability or counter press graded on one class */
const counterOwn = (record, door) => record.door === door && record.target === 'own';

const CHECKS = [
  { id: 'GS-1', title: 'never a 500: every press is kept, or refused with a sentence', check: (record, seen) => {
    if (seen.thrown) return 'the call threw: ' + seen.thrown;
    if (record.extra || record.target === 'badId' || (record.door === 'stock' && record.until.cls === 'noDay') || (record.door === 'stock' && record.until.cls === 'day' && record.status.v.toLowerCase() !== 'unavailable')) return null; /* GS-7, GS-14, GS-9 hold these */
    for (const status of [seen.status, seen.againStatus]) {
      if (status === undefined) continue;
      if (status >= 500) return show(record) + ': HTTP ' + status + said(seen);
      if (status >= 400 && !seen.said) return show(record) + ': HTTP ' + status + ' with no sentence';
    }
    return null;
  } },
  { id: 'GS-2', title: 'every purchase line is recorded or refused with a why; none is dropped', check: (record, seen) => {
    if (seen.thrown || record.door !== 'purchase' || record.extra || seen.status !== 200) return null;
    const recorded = (seen.body.recorded || []).length,
      failed = seen.body.failed || [];
    if (recorded + failed.length !== record.lines.length) return show(record) + ': ' + record.lines.length + ' lines sent, ' + recorded + ' recorded + ' + failed.length + ' refused';
    const silent = failed.find((line) => !line.why);
    if (silent) return 'line ' + silent.line + ' refused with no why';
    const missed = record.lines.findIndex((line, at) => line.verdict === 'refused' && !failed.some((f) => f.line === at));
    return missed < 0 ? null : show(record) + ': line ' + missed + ' should be refused, and is not in failed[]';
  } },
  { id: 'GS-3', title: 'the count moves by exactly what the answer recorded as counted; an expensed or refused line moves nothing', check: (record, seen) => {
    if (seen.thrown || !plain(record) || seen.status !== 200) return null;
    const wrong = movedWrong(seen.made.before, seen.mid, recordedMoves(seen.body));
    return wrong ? show(record) + ': ' + wrong : null;
  } },
  { id: 'GS-4', title: 'a bill number used before moves nothing unless the answer says it moved: the same bill again says so, never "counted" twice', gap: 'OPS-69 · the ledger keys a purchase on (ref, line); a second bill with the same number is answered "recorded · counted" and moves nothing', check: (record, seen) => {
    if (seen.thrown || record.door !== 'purchase' || record.extra || record.bill === 'fresh' || seen.status !== 200) return null;
    if (record.bill === 'reused') {
      const wrong = movedWrong(seen.made.before, seen.mid, recordedMoves(seen.body));
      return wrong ? 'a bill number used before: ' + wrong : null;
    }
    if (seen.againStatus === undefined) return null;
    const moved = movedWrong(seen.mid, seen.after, {});
    if (moved) return 'the same bill again: ' + moved;
    return (seen.againBody.stocked || 0) === 0 ? null : 'the same bill again moved nothing, and answered "' + (seen.againBody.says || '') + '" (stocked ' + seen.againBody.stocked + ')';
  } },
  { id: 'GS-5', title: 'a quantity or a cost that is no number (qty true · a cost of -5 or a word on an expensed line) is refused, never read as a number', gap: 'OPS-70 · Number(true) is 1, and an expensed line\'s cost is never checked: both are recorded', check: (record, seen) => {
    if (seen.thrown || record.door !== 'purchase' || record.extra || seen.status !== 200) return null;
    const read = record.lines.findIndex((line, at) => line.verdict === 'noNumber' && !(seen.body.failed || []).some((f) => f.line === at));
    return read < 0 ? null : show(record) + ': line ' + read + ' (qty ' + JSON.stringify(record.lines[read].qty.v) + ' cost ' + JSON.stringify(record.lines[read].cost.v) + ') was recorded';
  } },
  { id: 'GS-6', title: 'a line with no cost is said, never a silent ₹0 on the count', gap: 'OPS-70 · a line with no cost is counted at rate 0, and the answer does not say so', check: (record, seen) => {
    if (seen.thrown || record.door !== 'purchase' || record.extra || seen.status !== 200) return null;
    const free = (seen.body.recorded || []).filter((line) => line.kept && line.cost == null);
    return !free.length || /cost/i.test(seen.body.says || '') ? null : free.length + ' counted line(s) with no cost, and the answer says only "' + (seen.body.says || '') + '"';
  } },
  { id: 'GS-7', title: 'a cost of 1e20, or a date that is no date, is refused in words, never a 500', gap: 'OPS-71 · both reach the database and answer 500', check: (record, seen) => {
    if (seen.thrown || !record.extra) return null;
    /* judged only where the cost or the date is reached: a 1e20 on a line kept on every other count, a bad date beside a line that is kept */
    const reached = record.extra === 'hugeCost' ? verdictOf(Object.assign({}, record.lines[0], { cost: { cls: 'valid' } }), 0) === 'kept' : record.lines.some((line) => line.verdict === 'kept');
    if (!reached) return null;
    if ([400, 422].indexOf(seen.status) < 0 || !seen.said) return show(record) + ' answered HTTP ' + seen.status + said(seen);
    return movedWrong(seen.made.before, seen.after, {});
  } },
  { id: 'GS-8', title: 'at the counter: available or unavailable (either case) is kept; any other status is refused, and nothing changes', check: (record, seen) => {
    if (seen.thrown || !counterOwn(record, 'stock') || record.until.cls !== 'none') return null;
    if (!record.status.ok) return refusedClean(record, seen, [400]);
    const want = record.status.v.toLowerCase();
    return seen.status === 200 && seen.after.status === want && seen.body.status === want ? null : show(record) + ' ' + record.status.v + ': HTTP ' + seen.status + said(seen) + ' · the product holds ' + (seen.after && seen.after.status);
  } },
  { id: 'GS-9', title: 'at the counter: a return day that is no day, or one on "available", is refused 400 in words, never a 500', gap: 'CTR-169 · itemstatus.stamp throws a 400, and the counter answers it as a 500', check: (record, seen) => {
    if (seen.thrown || !counterOwn(record, 'stock') || !record.status.ok) return null;
    const wrongDay = record.until.cls === 'noDay' || (record.until.cls === 'day' && record.status.v.toLowerCase() !== 'unavailable');
    if (!wrongDay) return record.until.cls === 'day' && (seen.status !== 200 || seen.after.status_until !== record.until.v) ? 'unavailable until ' + record.until.v + ': HTTP ' + seen.status + ' · status_until ' + (seen.after && seen.after.status_until) : null;
    return refusedClean(record, seen, [400]);
  } },
  { id: 'GS-10', title: 'the counter\'s bulk answers what moved against what was asked, and says what could not be found', check: (record, seen) => {
    if (seen.thrown || record.door !== 'bulk' || record.target === 'badId') return null;
    if (!record.status.ok) return refusedClean(record, seen, [400]);
    const asked = seen.sent.item_ids.length,
      mine = record.target === 'own' ? 2 : 0;
    if (seen.status !== 200 || seen.body.asked !== asked || seen.body.moved !== mine) return show(record) + ': HTTP ' + seen.status + ' moved ' + seen.body.moved + ' of ' + seen.body.asked + ' (want ' + mine + ' of ' + asked + ')' + said(seen);
    if (mine < asked && !/could not be found/.test(seen.body.message || '')) return 'fewer moved than asked, and the answer does not say so: "' + seen.body.message + '"';
    return mine && seen.after.status !== record.status.v.toLowerCase() ? 'the product holds ' + seen.after.status : null;
  } },
  { id: 'GS-11', title: 'availability: a quantity is kept to three places; one that is no number (negative · a word · blank · true · []) is refused', gap: 'CAT-232 · Number(true) is 1 and Number([]) is 0: both are kept', check: (record, seen) => {
    if (seen.thrown || !counterOwn(record, 'avail') || record.asOf.cls === 'bad' || record.source.cls === 'bad') return null;
    if (record.qty.cls !== 'valid') return refusedClean(record, seen, [400]);
    const want = Math.round(Number(record.qty.v) * 1000) / 1000;
    const avail = seen.after && seen.after.avail;
    return seen.status === 200 && avail && avail.qty === want && seen.body.availability.qty === want ? null : 'qty ' + JSON.stringify(record.qty.v) + ': HTTP ' + seen.status + ' · avail ' + JSON.stringify(avail);
  } },
  { id: 'GS-12', title: 'availability: an as_of that is no moment or still to come, or a source not on the list, is refused in words', gap: 'CAT-232 · a bad as_of becomes now, a future one is kept, an unknown source becomes "unknown" — all 200', check: (record, seen) => {
    if (seen.thrown || !counterOwn(record, 'avail') || record.qty.cls !== 'valid') return null;
    if (record.asOf.cls === 'bad' || record.source.cls === 'bad') return refusedClean(record, seen, [400]);
    const avail = (seen.after && seen.after.avail) || {};
    if (record.asOf.cls === 'valid' && avail.as_of !== record.asOf.v) return 'as_of ' + record.asOf.v + ' kept as ' + avail.as_of;
    return record.source.cls === 'valid' && avail.source !== record.source.v ? 'source ' + record.source.v + ' kept as ' + avail.source : null;
  } },
  { id: 'GS-13', title: 'a product that is not mine (the other shop\'s · no such row) is refused, and the other shop\'s product is untouched', check: (record, seen) => {
    if (seen.thrown || record.door === 'purchase' || (record.target !== 'theirs' && record.target !== 'unknownId')) return null;
    if (record.door === 'bulk') return seen.body.moved === 0 || seen.status >= 400 ? (unchanged(seen) ? null : 'their product changed') : 'a bulk of products not mine moved ' + seen.body.moved;
    /* 404 for a press the door has nothing against; a value it refuses on its own may be refused first */
    return refusedClean(record, seen, [400, 404]);
  } },
  { id: 'GS-14', title: 'a product id that is no id is a 400 or 404, never a 500 (alone, or one among many in a bulk)', gap: 'CAT-230 · the id reaches the uuid cast at the counter, its bulk and availability', check: (record, seen) => {
    if (seen.thrown || record.target !== 'badId') return null;
    if (record.door === 'bulk') return seen.status < 500 ? null : 'a bulk holding an id that is no id: HTTP ' + seen.status + said(seen);
    return refusedClean(record, seen, [400, 404]);
  } }
];

(async () => {
  console.log('\n══ GORILLA · POST /api/supplies/purchase · POST /api/till/stock(/bulk) · PUT /api/products/:id/availability · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  let report = null;
  await pg.connect();
  try {
    const shops = [];
    for (let n = 0; n < SHOPS; n++) {
      const shop = await freshShop(RUN + 's' + n, 'Gorilla Stock ' + n);
      const own = { shop, kept: 'Gorilla tape ' + RUN + ' ' + n, expensed: 'Gorilla paper ' + RUN + ' ' + n, usedRef: 'GS-USED-' + RUN + '-' + n };
      /* the counted supply and the expensed one, made by a first purchase on a bill number a record may reuse */
      const first = ok(await j('/api/supplies/purchase', { method: 'POST', token: shop.token, body: { ref: own.usedRef, from: 'Gorilla Mayur', lines: [
        { name: own.kept, qty: 10, cost: 10, unit: 'roll', keep_stock: true }, { name: own.expensed, qty: 1, cost: 50, keep_stock: false }] } }), 'first purchase').b;
      if ((first.recorded || []).length !== 2) throw new Error('the first purchase did not record both supplies: ' + JSON.stringify(first).slice(0, 200));
      shops.push(own);
    }
    /* the OTHER shop's own product: a row no press of mine may reach */
    const other = await freshShop(RUN + 'o', 'Gorilla Other');
    const theirs = await newProduct(other.token, 'Their dal ' + RUN);
    const world = { shops, theirs };
    report = await G.hammer({ label: 'POST /api/supplies/purchase · /api/till/stock(/bulk) · PUT /api/products/:id/availability', file: 'tests/stock-gorilla-truth.realstack.cjs', fixedSeed: FIXED_SEED, budgetMs: 180000,
      make: makeRecord, before: maker(world, pg), send: presser(world, pg), checks: CHECKS, kase });
  } finally {
    await pg.end();
  }
  /* finish writes GORILLA_JSON last, so the gorilla's failing indexes ride along with the cases */
  finish('stock-gorilla', process.env.GORILLA_JSON, { gorilla: report });
})().catch((e) => { console.error('stock-gorilla could not run: ' + e.message); process.exit(1); });
