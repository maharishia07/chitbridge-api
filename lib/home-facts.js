'use strict';
/**
 * lib/home-facts.js — WHAT EACH HOME CARD SAYS (GET /api/facts/:card, N18). "A number is the server's or it is not there."
 *
 * Every answer is `{ lines: [{ text, value?, tone?, money?, at? }], figures? }` — the contract shell.js reads (at most two lines are drawn).
 * ⭐ THE SERVER NEVER FORMATS MONEY OR TIME (lib/money states the code, never a symbol; the reader's locale owns the look): a line that has an amount
 *   or a moment says `{money}` / `{time}` / `{when}` / `{date}` in its text and carries `money: { amount, currency }` and `at` (ISO) — shell.js fills them
 *   with CBLocale, so Home reads "₹420", "09:33", "today 09:40", never "INR 420.00" or "2026-10-10".
 * `rail` answers `{ suppliers, customers, in, out, stuck }` (digits) instead. A figure the server cannot compute is OMITTED,
 * never 0 — and what is omitted, and why, is written beside each card below.
 *
 * ⭐ NOTHING HERE IS A SECOND CALCULATION. The statements are the ones the old reads ran: lib/till-summary (the summary chits →
 * rollup.acrossCounters), books.settingOf + books-store.waitingCount (the ledger's health), item-cost.NO_COST_SQL (costOf, in SQL),
 * select.rows + measure.measure (the folders' MIS), customer-groups.NOT_A_SUPPLIER_SQL (the customers list). One round trip each,
 * two where a permission is asked first (lib/cost.canRead).
 * ⚠️ COST NEVER TRAVELS. product-lab counts items whose cost is unknown; no cost VALUE is selected or sent.
 */
const { withEntity, readBatch } = require('../db');

const n0 = (v) => Number(v) || 0;
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const notProvisioned = (e) => e && (e.code === '42P01' || e.code === '42703');
const none = (why) => ({ lines: [], unavailable: why });

/** the identity row's counter register + the key list, projected to what "is it open" needs — no secret leaves the database */
const REGISTER_SQL = `SELECT country, currency_code,
       COALESCE(policy_flags->'counters', '{}'::jsonb) AS counters,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('jti', k->>'jti', 'scopes', k->'scopes',
                  'till', jsonb_build_object('id', k->'till'->>'id', 'closed_at', k->'till'->'closed_at')))
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(policy_flags->'api_keys') = 'array' THEN policy_flags->'api_keys' ELSE '[]'::jsonb END) k), '[]'::jsonb) AS keys
  FROM identities WHERE identity_id = $1`;

/**
 * how many counters are open now — the rule of routes/counters.js view(): a counter is open while the key that holds it is not closed;
 * a till key that numbers under a prefix and is not closed is an open counter of that id even before it was adopted into the register.
 * (counters.js does not export view(); it was out of bounds for this change — keys.isClosed IS the shared test.)
 */
/** the counter whose day was closed most recently on `today` (the shop's day) — { id, at } or null. A closed key keeps till.closed_at. */
function closedToday(reg, today, country) {
  const H = require('./books-hooks');
  const keys = Array.isArray(reg && reg.keys) ? reg.keys : [];
  let best = null;
  for (const k of keys) {
    const at = k && k.till && k.till.closed_at; if (!at || !k.till.id) continue;
    if (H.dayOf(at, country) !== today) continue;
    if (!best || Date.parse(at) > Date.parse(best.at)) best = { id: String(k.till.id).toUpperCase(), at: typeof at === 'string' ? at : new Date(at).toISOString() };
  }
  return best;
}
function openCounters(reg) {
  const isClosed = require('../routes/keys').isClosed;
  const keys = Array.isArray(reg && reg.keys) ? reg.keys : [];
  const open = new Set();
  const counters = (reg && reg.counters) || {};
  for (const id of Object.keys(counters)) {
    const c = counters[id] || {};
    const held = c.held_by && String(c.held_by).indexOf('pending:') !== 0 ? keys.find((k) => k && String(k.jti) === String(c.held_by)) : null;
    if (held && !isClosed(held)) open.add(String(id).toUpperCase());
  }
  for (const k of keys) {
    if (!k || !Array.isArray(k.scopes) || k.scopes.indexOf('till') < 0 || !k.till || !k.till.id || isClosed(k)) continue;
    open.add(String(k.till.id).toUpperCase());
  }
  return open.size;
}

/**
 * till — bills and takings of the newest day the counters have sent up, and how many counters are open.
 * OMITTED: "bills not sent up" — that queue lives on the counter's own PC; the server only knows what arrived.
 * "Today" is the shop's calendar day (books-hooks.dayOf, the one day rule); a newest day that is not today is named by its date, never called today.
 * Takings are not cost: GET /api/till/summary never hid them, so neither does this.
 */
async function till(ctx) {
  const ts = require('./till-summary'), H = require('./books-hooks'), rollup = require('./rollup'), money = require('./money');
  const [sum, reg] = await readBatch(ctx.entity, ctx.actor, [ts.summaryStatement(ctx.entity, 'day', 2), { text: REGISTER_SQL, params: [ctx.entity] }]);
  const row = (reg.rows && reg.rows[0]) || {};
  const day = ts.foldSummaries(sum.rows, 1)[0] || null;
  const lines = [], figures = {};
  if (day) {
    const t = day.totals || {}, now = ctx.now || Date.now();
    const today = H.dayOf(new Date(now), row.country) || rollup.dayKey(now);
    const isToday = day.key === today;
    const cur = row.currency_code || '';
    const bills = n0(t.count), took = money.round(n0(t.total));
    Object.assign(figures, { day: day.key, bills, takings: took, currency: cur || null });
    lines.push({ text: plural(bills, 'bill') + (isToday ? '' : ' on {date}') + (cur ? ' · {money}' : ''), value: bills, at: day.key, money: cur ? { amount: took, currency: cur } : undefined });
  }
  const open = openCounters(row);
  figures.counters_open = open;
  const shut = open ? null : closedToday(row, H.dayOf(new Date(ctx.now || Date.now()), row.country), row.country);
  if (shut) { figures.counter_closed = shut; lines.push({ text: 'Counter ' + shut.id + ' closed {time}', value: 0, at: shut.at }); }
  else lines.push({ text: open ? plural(open, 'counter') + ' open' : 'No counter open', value: open });
  return { lines, figures };
}

/**
 * accounts — when the ledger was last checked, and how many posts are waiting. A shop whose ledger is off, or not provisioned, gets no lines.
 * OMITTED: nothing is guessed; "checked" is the date books_setting.last_check holds, absent until the first check ran.
 */
async function accounts(ctx) {
  const B = require('./books'), S = require('./books-store');
  let s, waiting = 0;
  try {
    await withEntity(ctx.entity, async (h) => { s = await B.settingOf(h, ctx.entity); if (s && s.enabled) waiting = await S.waitingCount(h, ctx.entity); });
  } catch (e) { if (notProvisioned(e)) return none('the ledger is not provisioned'); throw e; }
  if (!s || !s.enabled) return none('the ledger is off');
  const lines = [], lc = s.last_check || null;
  const at = lc && lc.at ? String(lc.at).slice(0, 10) : null;
  /* "Checked today 09:40" — the moment travels as ISO and the page words it (shell.js {when}) */
  const atFull = lc && lc.at ? new Date(lc.at).toISOString() : null;
  if (at) lines.push(lc.ok === false ? { text: 'Checked {when} · a difference was found', tone: 'dn', at: atFull || at } : { text: 'Checked {when}', at: atFull || at });
  lines.push(waiting ? { text: plural(waiting, 'post') + ' waiting', value: waiting, tone: 'dn' } : { text: 'Nothing waiting', value: 0 });
  return { lines, figures: { last_check: at, waiting } };
}

/**
 * product-lab — how many items there are, and how many have no cost. A COUNT; no cost value is read.
 * The no-cost line is the owner's (and an actor with can_see_costs): lib/cost.canRead, fail-closed — who may see costs is who may be nagged about them.
 */
async function productLab(ctx) {
  const cost = require('./cost'), ic = require('./item-cost');
  const may = ctx.req ? await cost.canRead(ctx.req, ctx.entity) : true;
  const [r] = await readBatch(ctx.entity, ctx.actor, [{ params: [ctx.entity],
    text: `SELECT count(*)::int AS items, (count(*) FILTER (WHERE ${ic.NO_COST_SQL}))::int AS no_cost FROM catalogue_items WHERE entity_id = $1 AND is_active = true` }]);
  const row = (r.rows && r.rows[0]) || {};
  const items = n0(row.items);
  if (!items) return { lines: [], figures: {} };
  const lines = [{ text: plural(items, 'item'), value: items }], figures = { items };
  if (may) {
    const nc = n0(row.no_cost); figures.no_cost = nc;
    lines.push(nc ? { text: plural(nc, 'item') + ' with no cost', value: nc, tone: 'dn' } : { text: 'Every item has a cost', value: 0 });
  }
  return { lines, figures };
}

/**
 * combo-lab — the saved sets in the library (combo_templates). OMITTED: a "combos · modifiers" split — the table stores one shape for both
 * (`{name, required, max, options}` groups), so any split would be invented.
 */
async function comboLab(ctx) {
  let r;
  try { [r] = await readBatch(ctx.entity, ctx.actor, [{ text: 'SELECT count(*)::int AS n FROM combo_templates WHERE entity_id = $1', params: [ctx.entity] }]); }
  catch (e) { if (notProvisioned(e)) return none('saved combos are not provisioned'); throw e; }
  const n = n0(r.rows && r.rows[0] && r.rows[0].n);
  return { lines: [{ text: n ? plural(n, 'saved set') : 'No saved sets yet', value: n }], figures: { saved: n } };
}

/** offer-lab — offers waiting as drafts, and how many are live (definitions, kind 'offer'; retired ones are neither). */
async function offerLab(ctx) {
  let r;
  try {
    [r] = await readBatch(ctx.entity, ctx.actor, [{ params: [ctx.entity],
      text: `SELECT (count(*) FILTER (WHERE status = 'draft'))::int AS drafts, (count(*) FILTER (WHERE status = 'live'))::int AS live FROM definition WHERE entity_id = $1 AND kind = 'offer'` }]);
  } catch (e) { if (notProvisioned(e)) return none('definitions are not provisioned'); throw e; }
  const row = (r.rows && r.rows[0]) || {}, drafts = n0(row.drafts), live = n0(row.live);
  return { lines: [drafts ? { text: plural(drafts, 'draft') + ' waiting', value: drafts, tone: 'dn' } : { text: 'No drafts waiting', value: 0 },
                   { text: plural(live, 'offer') + ' live', value: live }], figures: { drafts, live } };
}

/**
 * railScope — the chit rows and the clock that "in / out / stuck" are measured with. ONE place, so the Home rail's chips and the list
 * behind them (railChits) can never disagree: stuck = open and at least the shop's own overdue_days old (lib/measure).
 * truncated = the shop has more chit copies than the 5,000 one read takes, so no count over it would be right.
 */
const RAIL_LIMIT = 5000;
async function railScope(ctx) {
  const select = require('./select'), policy = require('./policy');
  /* readBatch sets app.current_entity inside its own BEGIN…COMMIT — entity-scoped like withEntity, in ONE wire trip */
  const [od, rows] = await Promise.all([
    readBatch(ctx.entity, ctx.actor, [{ params: [ctx.entity], text: `SELECT policy_flags->'overdue_days' AS overdue_days FROM identities WHERE identity_id = $1` }]),
    select.rows(ctx.entity, { limit: RAIL_LIMIT })]);
  const row = (od[0].rows && od[0].rows[0]) || {};
  const d = policy.coerce('overdue_days', row.overdue_days != null ? Number(row.overdue_days) : undefined);
  return { rows, truncated: rows.length >= RAIL_LIMIT, opts: { overdue_days: d !== undefined ? d : policy.FLAGS.overdue_days.def, now: ctx.now } };
}

/**
 * rail — { suppliers, customers, in, out, stuck }.
 * ⭐ suppliers / customers are the CRM's own count: lib/crm.rows + crm.assemble (the same filters — merged, hidden, another population,
 *   the shop itself), so the Home rail and CB CRM's Suppliers / Customers filters can never differ. A party on both lists counts under both
 *   roles, exactly as CRM's role filter lists it.
 * in / out = chits still open that came to you / went from you; stuck = open and older than the shop's own overdue_days (lib/measure — the MIS read).
 * OMITTED: in/out/stuck when the shop has more chit copies than the 5,000 the read takes — a count over a truncated read would be wrong, so none is given.
 */
async function rail(ctx) {
  const measure = require('./measure'), crm = require('./crm');
  const [raw, sc] = await Promise.all([crm.rows(ctx.entity), railScope(ctx)]);
  const parties = crm.assemble(raw).parties;
  if (ctx.keep) ctx.keep.parties = parties;   /* CB Sides asks the same question of the same parties - one read, not two (H31-r) */
  const out = { suppliers: parties.filter((p) => p.roles.supplier).length, customers: parties.filter((p) => p.roles.customer).length };
  if (!sc.truncated) {
    const mine = (d) => measure.measure(sc.rows.filter((x) => x.direction === d), sc.opts);
    out.in = mine('received').open; out.out = mine('sent').open;
    out.stuck = measure.measure(sc.rows.filter((x) => !isOwnNote(x, ctx.entity)), sc.opts).overdue;
  }
  return out;
}

const DAY = 86400000;
/**
 * ⭐ A CHIT THE SHOP SENT TO ITSELF IS NEVER "STUCK" (Athi, 2026-10-09: stuck ideally zero). Nobody else can answer it, so "nobody answered"
 * is not an exception — it is a note to self, a counter sale or a summary. The ones with a defined end (a counter sale, a day / week /
 * month summary) are CLOSED by the books when they post (lib/books-hooks closeDone); the ones with none stay open as "in" — your own
 * to-do — and are listed on the In tab, never as stuck. A chit from anyone else keeps lib/measure's test.
 */
function isOwnNote(x, entity) { return String(x.sender_entity_id) === String(entity) && x.direction === 'received'; }
const OPEN = ['pending', 'delivered', 'read', 'accepted', 'in_progress', 'partial'];
const nameOf = (x) => {
  if (x.direction === 'received') return x.sender_entity_display_name || null;
  const r = Array.isArray(x.all_recipients) ? x.all_recipients[0] : null;
  return (r && (r.display_name || r.name || r.entity_display_name)) || null;
};
/** a stuck chit's reason, in a shopkeeper's words: what is waiting, on whom, for how long */
function whyStuck(x, days) {
  const d = days === 1 ? '1 day' : days + ' days';
  if ((+x.open_disputes || 0) > 0) return 'A dispute is open, and the chit is ' + d + ' old.';
  const unanswered = ['pending', 'delivered', 'read'].includes(x.current_status);
  if (x.direction === 'received') return unanswered ? 'They sent it ' + d + ' ago and you have not answered.' : 'You accepted it, but it is not finished after ' + d + '.';
  return unanswered ? 'You sent it ' + d + ' ago and they have not answered.' : 'They accepted it, but it is not finished after ' + d + '.';
}
/**
 * railChits — the chits behind the rail's numbers: { overdue_days, truncated, items:[{ chit_id, direction, tab, stuck, status, created_at, age_days,
 * subject, who, value, currency, why }] }, stuck first, then newest. Every item is OPEN (a closed chit is neither in, out nor stuck); stuck is
 * lib/measure's own overdue test, so the stuck items number the rail's "stuck". No items (truncated:true) when the shop has more chit copies
 * than one read takes — the same rule as the counts.
 */
async function railChits(ctx) {
  const sc = await railScope(ctx);
  if (sc.truncated) return { overdue_days: sc.opts.overdue_days, truncated: true, items: [] };
  const now = new Date(sc.opts.now || Date.now()).getTime();
  const items = sc.rows.filter((x) => OPEN.includes(x.current_status)).map((x) => {
    const age = Math.round(((now - new Date(x.created_at).getTime()) / DAY) * 10) / 10;
    const self = isOwnNote(x, ctx.entity);
    const stuck = !self && age >= sc.opts.overdue_days;          /* lib/measure: days(created_at, now) >= overdue_days — and never your own note */
    /* WHO: select.rows resolves the other side by direction (counterparty_name); the first recipient of a SENT copy is the shop itself, which read "To <your own shop>" */
    const who = x.counterparty_name || (x.counterparty_id ? null : nameOf(x));
    /* AMOUNT: the quoted total, else what the chit's own body carries (an advice's payment, an expense's amount); none -> null, never a made-up 0.00 */
    const pick = [x.value, x.alt_value].find((v) => v != null && Number(v) > 0);
    /* OWN: the shop's own counter sale, expense, income or credit note, or a note to self - not a thing with another party (CRM is about parties) */
    const own = self || ['expense', 'income', 'credit_note'].includes(x.purpose) || x.doc_kind === 'bill_issued'
      || (x.counterparty_id != null && String(x.counterparty_id) === String(ctx.entity)) || (x.counterparty_id == null && !who && x.sender_entity_id != null && String(x.sender_entity_id) === String(ctx.entity));
    return { chit_id: x.chit_id, direction: x.direction, tab: x.direction === 'received' ? 'in' : 'out', stuck, status: x.current_status,
      created_at: x.created_at, age_days: age, subject: x.manual_subject || x.auto_subject || null, who: who || null,
      kind: x.biz_kind === 'payment_advice' ? 'payment_advice' : (x.purpose || null),
      value: pick == null ? null : Number(pick), currency: x.currency || null, self, own, why: stuck ? whyStuck(x, Math.floor(age)) : null };
  });
  items.sort((a, b) => (b.stuck - a.stuck) || (new Date(b.created_at) - new Date(a.created_at)));
  return { overdue_days: sc.opts.overdue_days, truncated: false, items };
}

/**
 * orders — the online orders waiting on the shop: chits of purpose 'order' that came to it and are still open (lib/measure's own OPEN set, the
 * rail's rule). ONE read (select.rows). Orders are a live door with this count; none open says so in words, never a bare 0.
 */
async function orders(ctx) {
  const select = require('./select');
  const rows = await select.rows(ctx.entity, { purpose: 'order', direction: 'received', limit: RAIL_LIMIT });
  const n = rows.filter((x) => OPEN.includes(x.current_status)).length;
  return { lines: [n ? { text: plural(n, 'order') + ' open', value: n, tone: 'dn' } : { text: 'No open orders', value: 0 }], figures: { open: n } };
}

const BUILD = { till, accounts, orders, 'product-lab': productLab, 'combo-lab': comboLab, 'offer-lab': offerLab, rail };

module.exports = { BUILD, openCounters, railChits, isOwnNote };
