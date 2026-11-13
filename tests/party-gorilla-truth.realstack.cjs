'use strict';
/**
 * tests/party-gorilla-truth.realstack.cjs — GORILLA PACK 4: PATCH /api/relationships/customers/:id and /suppliers/:id, hammered
 * (docs/api/COLUMN-13-ADDS-UP.md §4a, fourth in its order; row ADDS-PARTY-2).
 *
 * owns: the edits a shop makes to a party on its lists, and the checks every one must pass. The generator is tests/lib/gorilla.cjs;
 *       the doors, the case runner and the fresh shop are tests/lib/truth-harness.cjs. Pack 1 (send-gorilla) is the pattern.
 * FLOW  fresh shop, books on, one SIBLING party (a merge target on my list), and another shop with a customer of its own → per record:
 *       before() makes the party to edit (a fresh local customer or supplier · or a business on the rail added by its User ID · or
 *       the other shop's row · an id that is no row · an id that is no id) and snapshots it → send() PATCHes (sometimes twice) and
 *       snapshots it again → GT-1..GT-10 graded over every record → one case each
 * CARD 01-rail-core-the-chit/README
 *
 * What a record varies: the side (customer · supplier); 1–4 of the keys the contract declares, each a value that is valid, invalid,
 * one only an exact store or a refusal can honour (too long, a fraction of a day or of a paisa, true for a number), or a merge
 * into a party that is not on my list; sometimes a key the contract does not know; and the same body again.
 *
 * What every record must do (ADDS-PARTY-2: a field the caller sent is kept, and named in `changed`, or refused by name — never
 * silently dropped; Q10: a write never names a party that is not on my list):
 *   GT-1  never a 500: kept, or refused with a sentence
 *   GT-2  a key the contract does not know is refused by name (400 UNKNOWN_FIELD naming it), and nothing changes
 *   GT-3  a valid body is kept: 200, each field stored as sent (trimmed · upper-cased state · lower-cased e-mail · rupees in paise ·
 *         the phone through the one phone check), and each field that changed is named in `changed`
 *   GT-4  a value only an exact store can honour (260 characters · 2.7 days · 12.5 paise · true days) is refused, or stored
 *         exactly — never cut or rounded
 *   GT-5  an invalid value (negative days or limit · a word for a number · a state code that is not one · a tax id that does not
 *         check out or is not a list · a malformed e-mail or phone · a supply kind or segment not on the list) is refused in
 *         words, and nothing changes
 *   GT-6  merged_into names a party on my list: an unknown party or my own shop is refused, and nothing changes
 *   GT-7  a row that is not mine (the other shop's · no such row) is refused, never kept, and the other shop's row is untouched
 *   GT-11 gap CRM-48 · a party id that is no id is a 400 or 404, never a 500 (TODAY it reaches the uuid cast: 500)
 *   TODAY (gaps, filed 2026-10-29): GT-2 CRM-44 · GT-3 CRM-45 + CRM-42 · GT-4 CRM-46 · GT-5 CRM-47 · GT-6 CRM-43 · GT-11 CRM-48
 *   GT-8  a business on the rail keeps its own phone and e-mail: refused 403, nothing changes
 *   GT-9  every name in `changed` has its row in books_change_log
 *   GT-10 the same body again is a 200 that changes nothing (`changed` empty)
 *
 * Fixed seed 20261101 · budget 180 s · GORILLA_N (default 200) · GORILLA_SEED=<n>|random · GORILLA_ONLY=<i> replays one.
 * Run: node tests/party-gorilla-truth.realstack.cjs
 * ⚠️ LOCAL ONLY (the harness refuses anything else). Writes go through the routes; the database is only SELECTed.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const G = require('./lib/gorilla.cjs');
const { DB, j, ok, kase, freshShop, finish } = H;

/* the run tag names the fresh SHOPS and parties only (the world); nothing in a record reads it */
const RUN = 'gt' + (Date.now() % 1e10).toString(36);
const FIXED_SEED = 20261101;
const textOf = (reply) => [reply && reply.error, reply && reply.message, reply && reply.why, reply && reply.detail].find((said) => typeof said === 'string' && said.trim());

/* a value is { v, cls, want? }: cls valid (kept as `want`) · invalid (refused) · exact (refused, or stored exactly as `v`) · stranger (a
   merge into a party not on my list: refused). `want` is what the row holds after a kept save; a function of the world when it needs one. */
const valid = (v, want) => ({ v, cls: 'valid', want: want === undefined ? v : want });
const invalid = (v) => ({ v, cls: 'invalid' });
const exact = (v) => ({ v, cls: 'exact', want: v });
const COMMON = {
  legal_name: (h) => h.pick([valid('Sri Ganesh Traders Pvt Ltd'), valid('  Spaced   Name  ', 'Spaced Name'), valid('श्री गणेश स्टोर्स'), exact('L'.repeat(260))]),
  credit_days: (h) => h.pick([valid(0), valid(30), valid('45', 45), valid(null), invalid(-1), invalid(4000), invalid('abc'), exact(2.7), exact(true)]),
  credit_limit: (h) => h.pick([valid(5000, 500000), valid('1234.50', 123450), invalid(-5), invalid('lots')]),
  credit_limit_minor: (h) => h.pick([valid(250000), valid(0), invalid(-1), exact(12.5)]),
  state_code: (h) => h.pick([valid('33'), valid('tn', 'TN'), valid('IN-TN'), invalid('!!'), invalid('TAMIL NADU')]),
  merged_into: (h) => h.pick([valid('@sibling'), invalid('not-a-party'), invalid('@self'), { v: '@unknown', cls: 'stranger' }, { v: '@shop', cls: 'stranger' }]),
  tax_ids: (h, i) => h.pick([valid([{ scheme: 'PAN', value: 'abcde' + String(1000 + i).slice(-4) + 'f' }]), invalid([{ scheme: 'GSTIN', value: '33AAAAA0000A1Z' }]), invalid([{ scheme: 'XYZ', value: '1' }]), invalid({ scheme: 'PAN', value: 'ABCDE1234F' })]),
  /* a phone and an e-mail are one per party on the whole platform: @phone / @email are made unique per RUN in wireOf, not by the seed */
  phone: (h) => h.pick([valid('@phone'), valid('@phone+91'), invalid('12'), invalid('phone')]),
  email: (h) => h.pick([valid('@email:sam{}@shop.com'), valid('@email:ravi{}@kadai.in'), valid('@email:  Ravi.K{}@Mail.IN '), invalid('not-an-email'), invalid('a@b')])
};
const SIDE_KEYS = {
  customer: Object.assign({}, COMMON, {
    nickname: (h) => h.pick([valid('Ganesh anna'), valid('', null), exact('N'.repeat(100))]),
    segment_override: (h) => h.pick([valid('high_value'), valid('regular'), invalid('vip')])
  }),
  supplier: Object.assign({}, COMMON, {
    nickname: (h) => h.pick([valid('Ganesh anna'), valid('', null), exact('N'.repeat(100))]),
    category: (h) => h.pick([valid('Grocery'), exact('C'.repeat(70))]),
    notes: (h) => h.pick([valid('Delivers on Tuesdays'), valid('', null)]),
    supply_kind: (h) => h.pick([valid('own_use'), valid('resale'), invalid('barter')]),
    preferred: (h) => h.pick([valid(true), valid(false), invalid('maybe')])
  })
};
const TARGETS = ['rail', 'theirs', 'unknownId', 'badId'];
const CONTACT = new Set(['phone', 'email']);

/** one seeded record: the side, the target, the body (as values with classes), maybe an unknown key and a second press */
function makeRecord(h, index) {
  const side = h.chance(0.5) ? 'customer' : 'supplier';
  const target = h.chance(0.15) ? h.pick(TARGETS) : 'own';
  const keys = Object.keys(SIDE_KEYS[side]);
  const fields = {};
  for (let n = h.int(1, 4); Object.keys(fields).length < n; ) {
    const key = h.pick(keys);
    fields[key] = SIDE_KEYS[side][key](h, index);
  }
  const unknown = h.chance(0.1) ? h.pick(['zz_unknown', 'gstin', 'display', 'credit']) : null;
  const classes = new Set(Object.values(fields).map((value) => value.cls));
  /* the ONE answer a record is graded for, in the order a door must decide it */
  const verdict =
    target !== 'own' && target !== 'rail' ? 'notMine'
      : unknown ? 'unknown'
        : classes.has('invalid') ? 'invalid'
          : classes.has('stranger') ? 'stranger'
            : target === 'rail' && Object.keys(fields).some((key) => CONTACT.has(key)) ? 'railContact'
              : classes.has('exact') ? 'exact'
                : 'valid';
  return { index, side, target, fields, unknown, verdict, again: verdict === 'valid' && h.chance(0.3) };
}

/** the value a body carries, the world's placeholders resolved (@sibling · @self · @unknown · @shop) */
function wireOf(value, world, made) {
  const v = value.v;
  if (v === '@sibling') return made.sibling;
  if (v === '@self') return made.party;
  if (v === '@unknown') return '00000000-0000-4000-8000-' + String(400000000000 + made.index);
  if (v === '@shop') return world.shop.entity;
  const local = '9' + world.phoneBase + String(made.index).padStart(4, '0');
  if (v === '@phone') return local;
  if (v === '@phone+91') return '+91 ' + local.slice(0, 5) + ' ' + local.slice(5);
  if (typeof v === 'string' && v.indexOf('@email:') === 0) return v.slice(7).replace('{}', world.phoneBase + made.index);
  return v;
}
const bodyOf = (record, world, made) => {
  const body = {};
  for (const [key, value] of Object.entries(record.fields)) body[key] = wireOf(value, world, made);
  if (record.unknown) body[record.unknown] = 'x';
  return body;
};

/* what the row holds, per side: the list row, the identity's contact and name, the tax ids */
const LIST = {
  customer: { table: 'customer_list', id: 'customer_list_id', party: 'customer_identity_id', cols: 'legal_name, nickname, credit_days, credit_limit_minor, state_code, merged_into, segment_override' },
  supplier: { table: 'supplier_list', id: 'supplier_list_id', party: 'supplier_entity_id', cols: 'legal_name, nickname, credit_days, credit_limit_minor, state_code, merged_into, category, notes, supply_kind, preferred' }
};
async function snapshot(pg, side, listId) {
  const t = LIST[side];
  if (!/^[0-9a-f-]{36}$/i.test(String(listId))) return null;
  const row = (await pg.query(`SELECT ${t.party} AS party, ${t.cols} FROM ${t.table} WHERE ${t.id} = $1`, [listId])).rows[0];
  if (!row) return null;
  const who = (await pg.query('SELECT otp_contact AS phone, email FROM identities WHERE identity_id = $1', [row.party])).rows[0] || {};
  const tax = (await pg.query('SELECT scheme, value FROM party_tax_id WHERE party_id = $1 ORDER BY scheme', [row.party])).rows;
  return Object.assign({}, row, { phone: who.phone, email: who.email, tax_ids: tax.map((x) => x.scheme + ':' + x.value).join(',') });
}

/** before each record: the row to edit, and what it holds now */
function partyMaker(world, pg) {
  return async (record, index) => {
    const { shop } = world;
    if (record.target === 'theirs') return { index, listId: world.theirs.listId, side: 'customer', before: await snapshot(pg, 'customer', world.theirs.listId) };
    if (record.target === 'unknownId') return { index, listId: '00000000-0000-4000-8000-' + String(500000000000 + index), side: record.side, before: null };
    if (record.target === 'badId') return { index, listId: 'not-a-row-' + index, side: record.side, before: null };
    const name = 'Gorilla ' + record.side + ' ' + index;
    let party;
    if (record.target === 'rail') {
      const tag = RUN + 'r' + index;
      const railShop = await freshShop(tag, 'Gorilla Rail');
      const body = record.side === 'customer' ? { handle: tag } : { supplier_bridge_id: railShop.bridge, supply_kind: 'resale' };
      const added = await j('/api/relationships/' + record.side + 's', { method: 'POST', token: shop.token, body });
      if (added.status >= 300) throw new Error('the rail ' + record.side + ' was not added: HTTP ' + added.status + ' ' + (textOf(added.b) || ''));
      party = record.side === 'customer' ? added.b.customer.customer_identity_id : railShop.entity;
    } else {
      const body = record.side === 'customer' ? { name } : { name, supply_kind: 'resale' };
      const added = ok(await j('/api/relationships/' + record.side + 's', { method: 'POST', token: shop.token, body }), 'add ' + name).b;
      party = record.side === 'customer' ? added.customer.customer_identity_id : added.supplier.supplier_entity_id;
    }
    const t = LIST[record.side];
    const listId = (await pg.query(`SELECT ${t.id} AS id FROM ${t.table} WHERE owner_entity_id = $1 AND ${t.party} = $2`, [shop.entity, party])).rows[0].id;
    return { index, listId, side: record.side, party, sibling: world.sibling, before: await snapshot(pg, record.side, listId) };
  };
}

/** PATCH (and maybe again), then read the row and its change log back */
function patcher(world, pg) {
  return async (record, index, made) => {
    const body = bodyOf(record, world, made);
    const url = '/api/relationships/' + made.side + 's/' + encodeURIComponent(made.listId);
    const first = await j(url, { method: 'PATCH', token: world.shop.token, body });
    const seen = { status: first.status, said: textOf(first.b), body: first.b, sent: body, made };
    if (record.again && first.status === 200) {
      const again = await j(url, { method: 'PATCH', token: world.shop.token, body });
      Object.assign(seen, { againStatus: again.status, againBody: again.b });
    }
    seen.after = await snapshot(pg, made.side, made.listId);
    if (made.party) {
      const log = await pg.query('SELECT field FROM books_change_log WHERE entity_id = $1 AND row_id = $2', [world.shop.entity, String(made.party)]);
      seen.logged = log.rows.map((row) => row.field);
    }
    return seen;
  };
}

/** what a kept field must read back as */
function wantOf(key, value, sent) {
  if (key === 'tax_ids') return sent.map((x) => x.scheme + ':' + String(x.value).toUpperCase()).join(',');
  if (key === 'email') return String(sent).trim().toLowerCase();
  if (key === 'merged_into') return sent;
  return value.want;
}
const column = (key) => (key === 'credit_limit' ? 'credit_limit_minor' : key);
const same = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);
/* a phone is kept when its last ten digits are the ones sent (the one phone check may add the country code) */
const samePhone = (stored, sent) => String(stored || '').replace(/\D/g, '').slice(-10) === String(sent || '').replace(/\D/g, '').slice(-10);
const unchanged = (seen) => JSON.stringify(seen.after) === JSON.stringify(seen.made.before);
const said = (seen) => (seen.said ? ' "' + seen.said.slice(0, 80) + '"' : '');
const changedOf = (seen) => (seen.body && seen.body.party && seen.body.party.changed) || [];
const show = (record) => Object.entries(record.fields).map(([key, value]) => key + '=' + JSON.stringify(value.v).slice(0, 24)).join(' ');

/** a refusal that writes nothing */
function refusedClean(record, seen, statuses) {
  if (statuses.indexOf(seen.status) < 0) return record.side + ' ' + show(record) + ' answered HTTP ' + seen.status + said(seen) + (seen.status === 200 ? ' · changed ' + JSON.stringify(changedOf(seen)) : '');
  return unchanged(seen) ? null : 'refused, but the row changed: ' + JSON.stringify(seen.made.before) + ' → ' + JSON.stringify(seen.after);
}

const CHECKS = [
  { id: 'GT-1', title: 'never a 500: every edit is kept, or refused with a sentence', check: (record, seen) => {
    if (seen.thrown) return 'the call threw: ' + seen.thrown;
    if (record.target === 'badId') return null; /* GT-11 holds an id that is no id (CRM-48) */
    for (const status of [seen.status, seen.againStatus]) {
      if (status === undefined) continue;
      if (status >= 500) return record.side + ' ' + record.target + ' ' + show(record) + ': HTTP ' + status + said(seen);
      if (status >= 400 && !seen.said) return 'HTTP ' + status + ' with no sentence';
    }
    return null;
  } },
  { id: 'GT-2', title: 'a key the contract does not know is refused by name, and nothing changes', gap: 'CRM-44 · the supplier PATCH drops a key it does not know', check: (record, seen) => {
    if (seen.thrown || record.verdict !== 'unknown') return null;
    const named = seen.body && (seen.body.fields || []).indexOf(record.unknown) >= 0;
    /* a body that also carries a value the door refuses may be refused for that value first: refused, nothing saved, is enough */
    const alsoRefusable = Object.values(record.fields).some((value) => value.cls === 'invalid' || value.cls === 'exact');
    if (seen.status !== 400 || (!named && !alsoRefusable)) return record.side + ': "' + record.unknown + '" answered HTTP ' + seen.status + (seen.status === 200 ? ' · changed ' + JSON.stringify(changedOf(seen)) : said(seen));
    return unchanged(seen) ? null : 'refused, but the row changed';
  } },
  { id: 'GT-3', title: 'a valid body is kept as sent, and each field that changed is named in changed', gap: 'CRM-45 · segment_override and the supplier route\'s own fields are never named · CRM-42 · an e-mail with an "s" is refused', check: (record, seen) => {
    if (seen.thrown || record.verdict !== 'valid') return null;
    if (seen.status !== 200) return record.side + ' ' + show(record) + ' answered HTTP ' + seen.status + said(seen);
    const named = changedOf(seen).concat(seen.body.display_name ? ['display_name'] : []);
    for (const [key, value] of Object.entries(record.fields)) {
      const col = column(key);
      const want = wantOf(key, value, seen.sent[key]);
      if (key === 'phone' ? !samePhone(seen.after.phone, seen.sent.phone) : !same(seen.after[col], want)) return record.side + ' ' + key + ' sent ' + JSON.stringify(seen.sent[key]) + ', the row holds ' + JSON.stringify(seen.after[col]);
      const moved = !same(seen.made.before[col], seen.after[col]);
      const name = key === 'tax_ids' ? 'tax_id:' : col;
      if (moved && !named.some((item) => item === name || item.indexOf(name) === 0)) return record.side + ' ' + key + ' changed, but changed names ' + JSON.stringify(named);
    }
    return null;
  } },
  { id: 'GT-4', title: 'a value only an exact store can honour is refused, or stored exactly — never cut or rounded', gap: 'CRM-46 · days floored, paise rounded, names cut in silence', check: (record, seen) => {
    if (seen.thrown || record.verdict !== 'exact') return null;
    if (seen.status >= 400) return unchanged(seen) ? null : 'refused, but the row changed';
    for (const [key, value] of Object.entries(record.fields))
      if (value.cls === 'exact' && !same(seen.after[column(key)], value.want))
        return record.side + ' ' + key + ' sent ' + JSON.stringify(value.want).slice(0, 30) + ' (' + String(value.want).length + ' chars), kept as ' + JSON.stringify(seen.after[column(key)]).slice(0, 30) + ' (' + String(seen.after[column(key)]).length + ')';
    return null;
  } },
  { id: 'GT-5', title: 'an invalid value is refused in words, and nothing changes', gap: 'CRM-47 · a tax_ids that is not a list, and credit_limit beside credit_limit_minor, are dropped', check: (record, seen) => (seen.thrown || record.verdict !== 'invalid' ? null : refusedClean(record, seen, [400, 409, 422])) },
  { id: 'GT-6', title: 'merged_into names a party on my list: an unknown party or my own shop is refused, nothing changes', gap: 'CRM-43 · merged_into takes any uuid', check: (record, seen) => (seen.thrown || record.verdict !== 'stranger' ? null : refusedClean(record, seen, [400, 404, 409, 422])) },
  { id: 'GT-7', title: 'a row that is not mine (the other shop\'s · no such row) is refused, never kept, and the other shop\'s row is untouched', check: (record, seen) => {
    if (seen.thrown || record.verdict !== 'notMine' || record.target === 'badId') return null;
    /* 404 for a body the door has nothing against; a body it refuses on its own (a bad value, an unknown key) may be refused first */
    return refusedClean(record, seen, [400, 403, 404, 409, 422]);
  } },
  { id: 'GT-11', title: 'a party id that is no id is a 400 or 404, never a 500', gap: 'CRM-48 · the id reaches the uuid cast', check: (record, seen) =>
    seen.thrown || record.target !== 'badId' ? null : refusedClean(record, seen, [400, 403, 404, 409, 422]) },
  { id: 'GT-8', title: 'a business on the rail keeps its own phone and e-mail: refused 403, nothing changes', check: (record, seen) => (seen.thrown || record.verdict !== 'railContact' ? null : refusedClean(record, seen, [403])) },
  { id: 'GT-9', title: 'every name in changed has its row in books_change_log', check: (record, seen) => {
    if (seen.thrown || seen.status !== 200 || !seen.logged) return null;
    const missing = changedOf(seen).filter((name) => seen.logged.indexOf(name) < 0);
    return missing.length ? 'changed ' + JSON.stringify(missing) + ' with no change-log row' : null;
  } },
  { id: 'GT-10', title: 'the same body again is a 200 that changes nothing', check: (record, seen) => {
    if (seen.thrown || !record.again || seen.status !== 200) return null;
    const again = (seen.againBody && seen.againBody.party && seen.againBody.party.changed) || [];
    return seen.againStatus === 200 && !again.length ? null : 'the same body again answered HTTP ' + seen.againStatus + ' · changed ' + JSON.stringify(again);
  } }
];

(async () => {
  console.log('\n══ GORILLA · PATCH /api/relationships/{customers,suppliers}/:id · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  let report = null;
  await pg.connect();
  try {
    const shop = await freshShop(RUN, 'Gorilla Party');
    ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
    /* the SIBLING: a party on my list, the one merge a record may make */
    const sibling = ok(await j('/api/relationships/customers', { method: 'POST', token: shop.token, body: { name: 'Gorilla Sibling ' + RUN } }), 'sibling').b.customer.customer_identity_id;
    /* the OTHER shop's own customer: a row no edit of mine may reach */
    const other = await freshShop(RUN + 'o', 'Gorilla Other');
    const theirs = ok(await j('/api/relationships/customers', { method: 'POST', token: other.token, body: { name: 'Their Customer ' + RUN } }), 'their customer').b.customer.customer_list_id;
    /* phoneBase: 5 digits of this run, so a phone or e-mail is new on a database that kept earlier runs (one per party, platform-wide) */
    const world = { shop, sibling, theirs: { listId: theirs }, phoneBase: String(Date.now()).slice(-5) };
    report = await G.hammer({ label: 'PATCH /api/relationships/{customers,suppliers}/:id', file: 'tests/party-gorilla-truth.realstack.cjs', fixedSeed: FIXED_SEED, budgetMs: 180000,
      make: makeRecord, before: partyMaker(world, pg), send: patcher(world, pg), checks: CHECKS, kase });
  } finally {
    await pg.end();
  }
  /* finish writes GORILLA_JSON last, so the gorilla's failing indexes ride along with the cases */
  finish('party-gorilla', process.env.GORILLA_JSON, { gorilla: report });
})().catch((e) => { console.error('party-gorilla could not run: ' + e.message); process.exit(1); });
