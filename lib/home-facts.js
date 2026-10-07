'use strict';
/**
 * lib/home-facts.js — WHAT EACH HOME CARD SAYS (GET /api/facts/:card, N18). "A number is the server's or it is not there."
 *
 * Every answer is `{ lines: [{ text, value?, tone? }], figures? }` — the contract shell.js reads (at most two lines are drawn).
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
    const when = day.key === today ? 'today' : 'on ' + day.key;
    const cur = row.currency_code || '';
    const bills = n0(t.count), took = money.round(n0(t.total));
    Object.assign(figures, { day: day.key, bills, takings: took, currency: cur || null });
    lines.push({ text: plural(bills, 'bill') + ' ' + when + ' · ' + (cur ? cur + ' ' : '') + took.toFixed(2) + ' taken', value: bills });
  }
  const open = openCounters(row);
  figures.counters_open = open;
  lines.push({ text: open ? plural(open, 'counter') + ' open' : 'No counter open', value: open });
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
  if (at) lines.push(lc.ok === false ? { text: 'Checked ' + at + ' · a difference was found', tone: 'dn' } : { text: 'Checked ' + at });
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
 * rail — { suppliers, customers, in, out, stuck }. suppliers/customers are the two lists' lengths (a customer who is also a supplier counts once, as a supplier).
 * in / out = chits still open that came to you / went from you; stuck = open and older than the shop's own overdue_days (lib/measure — the MIS read).
 * OMITTED: in/out/stuck when the shop has more chit copies than the 5,000 the read takes — a count over a truncated read would be wrong, so none is given.
 */
async function rail(ctx) {
  const select = require('./select'), measure = require('./measure'), policy = require('./policy'), cg = require('./customer-groups');
  /* readBatch sets app.current_entity inside its own BEGIN…COMMIT — entity-scoped like withEntity, in ONE wire trip instead of four (tests/supplier-list-scope allows this one statement by name) */
  const [c] = await readBatch(ctx.entity, ctx.actor, [{ params: [ctx.entity], text:
    `SELECT (SELECT count(*)::int FROM supplier_list WHERE owner_entity_id = $1) AS suppliers,
            (SELECT count(*)::int FROM customer_list cl WHERE cl.owner_entity_id = $1 AND ${cg.NOT_A_SUPPLIER_SQL}) AS customers,
            (SELECT policy_flags->'overdue_days' FROM identities WHERE identity_id = $1) AS overdue_days` }]);
  const row = (c.rows && c.rows[0]) || {};
  const out = { suppliers: n0(row.suppliers), customers: n0(row.customers) };
  const LIMIT = 5000;
  const rows = await select.rows(ctx.entity, { limit: LIMIT });
  if (rows.length < LIMIT) {
    const od = policy.coerce('overdue_days', row.overdue_days != null ? Number(row.overdue_days) : undefined);
    const opts = { overdue_days: od !== undefined ? od : policy.FLAGS.overdue_days.def, now: ctx.now };
    const mine = (d) => measure.measure(rows.filter((x) => x.direction === d), opts);
    out.in = mine('received').open; out.out = mine('sent').open;
    out.stuck = measure.measure(rows, opts).overdue;
  }
  return out;
}

const BUILD = { till, accounts, 'product-lab': productLab, 'combo-lab': comboLab, 'offer-lab': offerLab, rail };

module.exports = { BUILD, openCounters };
