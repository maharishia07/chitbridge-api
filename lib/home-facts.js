'use strict';
/**
 * CALLED BY routes/facts.js (GET /api/facts/:card — each Home card's one read).
 * CARD 28-platform-and-operations/home-facts
 * lib/home-facts.js — WHAT EACH HOME CARD SAYS (GET /api/facts/:card, N18). "A number is the server's or it is not there."
 *
 * Every answer is `{ lines: [{ text, value?, tone?, money?, at? }], figures?, state }` — state ∈ needs_you (a line has tone 'dn') · in_use (running) · not_started (the
 *   shop never used the area; each card states it from its own figure, withState below fills the default) — the contract shell.js reads — the contract shell.js reads (at most two lines are drawn).
 * ⭐ THE SERVER NEVER FORMATS MONEY OR TIME (lib/money states the code, never a symbol; the reader's locale owns the look): a line that has an amount
 *   or a moment says `{money}` / `{time}` / `{when}` / `{date}` in its text and carries `money: { amount, currency }` and `at` (ISO) — shell.js fills them
 *   with CBLocale, so Home reads "₹420", "09:33", "today 09:40", never "INR 420.00" or "2026-10-10".
 * `rail` answers `{ suppliers, customers, may_sample, in, out, stuck }` (digits + the Rail Lab's may/why) instead. A figure the server cannot compute is OMITTED,
 * never 0 — and what is omitted, and why, is written beside each card below.
 *
 * ⭐ NOTHING HERE IS A SECOND CALCULATION. The statements are the ones the old reads ran: lib/till-summary (the summary chits →
 * rollup.acrossCounters), books.settingOf + books-store.waitingCount (the ledger's health, by todo), item-cost.NO_COST_SQL (costOf, in SQL),
 * select.rows + measure.measure (the folders' MIS), customer-groups.NOT_A_SUPPLIER_SQL (the customers list). One round trip each,
 * two where a permission is asked first (lib/cost.canRead).
 * ⚠️ COST NEVER TRAVELS. product-lab counts items whose cost is unknown; no cost VALUE is selected or sent.
 */
const { withEntity, readBatch } = require('../db');
const { connectorsOf } = require('./connector-rows'); /* the Connectors card's one read (SET-35) */

const n0 = (v) => Number(v) || 0;
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const notProvisioned = (e) => e && (e.code === '42P01' || e.code === '42703');
const none = (why) => ({ lines: [], unavailable: why });
const notStarted = (reason) => Object.assign(none(reason), { state: 'not_started' }); /* the area is off / not set up: never used */
/** the card's own word that the shop never used the area: 'not_started' when every figure is zero / empty, else undefined (withState then fills the default) */
const neverUsed = (...figures) => (figures.some(Boolean) ? undefined : 'not_started');
const tillNeverUsed = (dayRow, shutToday, openCount, register) =>
  neverUsed(dayRow, shutToday, openCount, Object.keys(register.counters || {}).length); /* no day sent up, no counter registered or open */

/** the identity row's counter register + the key list, projected to what "is it open" needs — no secret leaves the database */
const REGISTER_SQL = `SELECT country, currency_code, timezone,
       COALESCE(policy_flags->'counters', '{}'::jsonb) AS counters,
       COALESCE(policy_flags->'devices', '{}'::jsonb) AS devices,
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
    const at = k && k.till && k.till.closed_at;
    if (!at || !k.till.id) continue;
    if (H.dayOf(at, country) !== today) continue;
    if (!best || Date.parse(at) > Date.parse(best.at))
      best = { id: String(k.till.id).toUpperCase(), at: typeof at === 'string' ? at : new Date(at).toISOString() };
  }
  return best;
}
function openCounterIds(reg) {
  const isClosed = require('../routes/keys').isClosed;
  const keys = Array.isArray(reg && reg.keys) ? reg.keys : [];
  const open = new Set();
  const nestedCounters = (reg && reg.counters) || {};
  for (const id of Object.keys(nestedCounters)) {
    const c = nestedCounters[id] || {};
    const held = c.held_by && String(c.held_by).indexOf('pending:') !== 0 ? keys.find((item) => item && String(item.jti) === String(c.held_by)) : null;
    if (held && !isClosed(held)) open.add(String(id).toUpperCase());
  }
  for (const k of keys) {
    if (!k || !Array.isArray(k.scopes) || k.scopes.indexOf('till') < 0 || !k.till || !k.till.id || isClosed(k)) continue;
    open.add(String(k.till.id).toUpperCase());
  }
  return open;
}

/** the Day book entry kinds the Till card counts (books-store.BILL_EVENTS + the walk-in day + a return); a payment against dues is none of these */
const DAY_KINDS = ['walkin_day', 'sale_bill', 'credit_given', 'return'];
/** what came in across the counter: the roles every pack maps its ways of paying to (reg-in/au/ae paymentModes) */
const TENDER_ROLES = ['cash', 'upi', 'card', 'bank'];
/** what was sold: the tenders and the customer's account — a credit bill is Dr debtors (the one receivable role across packs) */
const SOLD_ROLES = TENDER_ROLES.concat('debtors');
/**
 * booksDay — today's SOLD and TAKINGS as the Day book holds them (M144, REP-52): the shop day's entries of kind walk-in day (one closing covering
 * many bills, or a late walk-in posted on its own: books-hooks walkin-late, covers NULL, one bill) · sale_bill · credit_given · return, read through
 * books-store.entryLines — the Day book's one read, never recomputed from the bills. Reversed entries and the reversals are left out, so the
 * card follows the books, not a stale summary chit.
 *   sales    = net Dr − Cr on cash · upi · card · bank · debtors — the bill value incl. tax, net of returns, paid OR on credit (G-MONEY's word: sold)
 *   takings  = the same on the tender roles only — what came in across the counter; a credit_given (Dr debtors, Cr the tender) adds a bill,
 *              sells 0 and LOWERS takings. Money collected later against dues is CB Finance's figure, not this one.
 * null when the ledger is off / not provisioned / has no such entry that day — the card then falls back to the summary chit.
 */
async function booksDay(ctx, day, currency) {
  const S = require('./books-store'),
    money = require('./money');
  let lines;
  try {
    lines = await withEntity(ctx.entity, (h) => S.entryLines(h, ctx.entity, day, day, null, null));
  } catch (e) {
    if (notProvisioned(e)) return null;
    throw e;
  }
  const reversed = new Set(lines.filter((item) => item.reverses_entry_id).map((item) => String(item.reverses_entry_id)));
  const by = new Map();
  for (const l of lines) {
    if (l.reverses_entry_id || reversed.has(String(l.entry_id)) || DAY_KINDS.indexOf(l.event_type) < 0) continue;
    const k = String(l.entry_id);
    /* a closing names how many bills it covers; a bill of its own is one; a return is not a bill */
    const x = by.get(k) || { bills: l.covers != null ? n0(l.covers) : l.event_type === 'return' ? 0 : 1, sold: 0, taken: 0 };
    const lineNet = n0(l.dr_minor) - n0(l.cr_minor);
    if (SOLD_ROLES.indexOf(l.account_role) >= 0) x.sold += lineNet;
    if (TENDER_ROLES.indexOf(l.account_role) >= 0) x.taken += lineNet;
    by.set(k, x);
  }
  if (!by.size) return null;
  const all = [...by.values()],
    major = (minor) => money.round(minor / Math.pow(10, money.decimals(currency)), currency || undefined);
  return {
    bills: all.reduce((total, x) => total + x.bills, 0),
    sales: major(all.reduce((total, x) => total + x.sold, 0)),
    takings: major(all.reduce((total, x) => total + x.taken, 0))
  };
}

/**
 * soldLines — the Till card's day as figures and lines (REP-52): Sold with the bills, then Takings when the books gave the day.
 * The books' figures (bk) win; the fallback is the summary chit's bill value net of returns (gross − refunds) — never rollup `total`,
 * which also nets the drawer's EXPENSES — and no takings, since a summary does not split its tenders (omitted, never 0).
 * A day that is not today is named by its date. No currency on the shop → bills only, no money placeholder.
 */
function soldLines(summaryDay, isToday, booksFigures, currency) {
  const money = require('./money'),
    totals = summaryDay.totals || {};
  const bills = booksFigures ? booksFigures.bills : n0(totals.count),
    sold = booksFigures ? booksFigures.sales : money.round(n0(totals.gross) - n0(totals.refunds)),
    took = booksFigures ? booksFigures.takings : undefined;
  const figures = { day: summaryDay.key, bills, sales: sold, currency: currency || null };
  if (took != null) figures.takings = took;
  const lines = [
    {
      text: (currency ? 'Sold {money} · ' : '') + plural(bills, 'bill') + (isToday ? '' : ' on {date}'),
      value: bills,
      at: summaryDay.key,
      money: currency ? { amount: sold, currency } : undefined
    }
  ];
  if (took != null && currency) lines.push({ text: 'Takings {money}', money: { amount: took, currency } });
  return { figures, lines };
}

/**
 * till — SOLD (and, from the books, TAKINGS) of the newest day the counters have sent up, its bills, and how many counters are open.
 * REP-52: the owner asks "how much did I sell" and "how much came in" — two figures, each named: "Sold {money} · 9 bills" leads the tile,
 * "Takings {money}" follows (only when the books gave today's entries; the summary chit cannot split tenders, so it is omitted, never 0).
 * OMITTED: "bills not sent up" — that queue lives on the counter's own PC; the server only knows what arrived.
 * "Today" is the shop's calendar day (books-hooks.dayOf, the one day rule); a newest day that is not today is named by its date, never called today.
 * Takings are not cost: GET /api/till/summary never hid them, so neither does this.
 * RPT2: figures.trend = { spark: 8 weeks' sales (minor units, oldest first, null = no record), vs_last_year_pct } — rollup.series through
 * lib/till-summary.teaser; its two statements ride in this one readBatch (no trip of its own). Omitted, never 0: teaser() answers
 * undefined then, and JSON leaves an undefined key out.
 */
async function till(ctx) {
  const ts = require('./till-summary'),
    H = require('./books-hooks'),
    rollup = require('./rollup');
  const [sum, reg, shopYear, weeks] = await readBatch(
    ctx.entity,
    ctx.actor,
    [ts.summaryStatement(ctx.entity, 'day', 2), { text: REGISTER_SQL, params: [ctx.entity] }].concat(ts.teaserStatements(ctx.entity))
  );
  const row = (reg.rows && reg.rows[0]) || {};
  const day = ts.foldSummaries(sum.rows, 1)[0] || null;
  const lines = [],
    figures = {};
  if (day) {
    const now = ctx.now || Date.now();
    const today = H.dayOf(new Date(now), row) || rollup.dayKey(now); /* the shop's zone (row.timezone, else country) — M210 */
    const isToday = day.key === today;
    const bk = isToday
      ? await booksDay(ctx, day.key, row.currency_code)
      : null; /* M144: today's figure is the Day book's (the books' entries), not the older summary chit */
    const sold = soldLines(day, isToday, bk, row.currency_code || '');
    Object.assign(figures, sold.figures);
    lines.push(...sold.lines);
  }
  const openIds = openCounterIds(row),
    open = openIds.size;
  figures.counters_open = open;
  /* M144: the counter that closed today is named with its time ("C5 closed 10:35") even while another counter is open — the open ones are only those NOT it */
  const shut = closedToday(row, H.dayOf(new Date(ctx.now || Date.now()), row), row);
  const others = shut ? [...openIds].filter((id) => id !== shut.id).length : open;
  /* M144: the closed mark is ALWAYS shown (it was dropped whenever another key was still open); the open ones are named after it */
  if (shut) {
    figures.counter_closed = shut;
    if (!others) figures.counters_open = 0;
    lines.push({ text: 'Counter ' + shut.id + ' closed {time}', value: 0, at: shut.at });
  }
  /* M144c: name WHICH counters are open ("C1 open"), up to three; more than that is a count */
  const names = [...openIds].filter((id) => !shut || id !== shut.id).sort();
  if (!shut || others)
    lines.push({
      text: !open
        ? 'No counter open'
        : names.length && names.length <= 3
          ? names.join(', ') + ' open'
          : plural(open, shut ? 'other counter' : 'counter') + ' open',
      value: open
    });
  return { lines, figures: Object.assign(figures, { trend: ts.teaser(shopYear, weeks, ctx.now) }), state: tillNeverUsed(day, shut, open, row) };
}

/**
 * counters — CB Settings › Counters & keys (T3-SETTINGS): how many counters the shop keeps, how many are open, and how many keys other
 * systems sign in with. The till card's register read (REGISTER_SQL, one trip) and its open rule (openCounterIds), never a second one.
 * OMITTED: who holds each counter — that is the list's, not Home's. A shop with no counters says so in words ("No counters yet").
 */
async function counters(ctx) {
  const isClosed = require('../routes/keys').isClosed;
  const [reg] = await readBatch(ctx.entity, ctx.actor, [{ text: REGISTER_SQL, params: [ctx.entity] }]);
  const row = (reg.rows && reg.rows[0]) || {};
  const n = Object.keys(row.counters || {}).length,
    open = openCounterIds(row).size;
  const keys = (Array.isArray(row.keys) ? row.keys : []).filter(
    (item) => item && !isClosed(item) && !(Array.isArray(item.scopes) && item.scopes.indexOf('till') >= 0)
  ).length;
  const lines = [{ text: n ? plural(n, 'counter') + ' · ' + open + ' open' : 'No counters yet', value: n }];
  if (keys) lines.push({ text: plural(keys, 'key') + ' for other systems', value: keys });
  return { lines, figures: { counters: n, counters_open: open, keys }, state: neverUsed(n, keys) }; /* not_started: no counter, no key */
}

/**
 * account — CB Settings › Account (T3-P4-ACCOUNT): how many devices hold a live person session now, and how many keys other systems sign in with.
 * The till card's register read (REGISTER_SQL, widened by the `devices` column lib/person-session.js keeps) and the counters card's key rule — one trip.
 * A device counts while it is not revoked and holds a session whose exp is still ahead (the same test GET /api/signin/devices applies).
 * OMITTED: which person is on which device — that is the list's. "Nothing signed in on a listed device" is said in words (a legacy token lists no device).
 */
async function account(ctx) {
  const isClosed = require('../routes/keys').isClosed;
  const [reg] = await readBatch(ctx.entity, ctx.actor, [{ text: REGISTER_SQL, params: [ctx.entity] }]);
  const row = (reg.rows && reg.rows[0]) || {};
  const t = Math.floor((ctx.now || Date.now()) / 1000);
  const devices = Object.values(row.devices || {}).filter(
    (item) => item && !item.revoked_at && (item.sessions || []).some((entry) => entry && Number(entry.exp) > t)
  ).length;
  const keys = (Array.isArray(row.keys) ? row.keys : []).filter(
    (item) => item && !isClosed(item) && !(Array.isArray(item.scopes) && item.scopes.indexOf('till') >= 0)
  ).length;
  const lines = [{ text: devices ? 'Signed in on ' + plural(devices, 'device') : 'No device holds a sign-in now', value: devices }];
  if (keys) lines.push({ text: plural(keys, 'key') + ' for other systems', value: keys });
  return { lines, figures: { devices, keys } };
}

/**
 * reports — CB Finance › Reports (T3-P4-ACCOUNT): the rail measured — how many chits are open, how many of them are stuck. The rail card's own
 * read (railScope: the shop's overdue_days + select.rows, one batch) through lib/measure — the same engine GET /api/folders/mis answers the tab with,
 * so the card and the tab cannot disagree. OMITTED: both figures when the shop has more chit copies than one read takes (truncated), as the rail omits them.
 */
async function reports(ctx) {
  const sc = await railScope(ctx);
  if (sc.truncated) return none('more chits than one read takes');
  const m = railMeasure(sc.rows, ctx.entity, sc.opts);
  const lines = [{ text: m.open ? plural(m.open, 'chit') + ' open' : 'Nothing open', value: m.open }];
  if (m.overdue) lines.push({ text: plural(m.overdue, 'chit') + ' stuck', value: m.overdue, tone: 'dn' });
  return {
    lines,
    figures: { open: m.open, overdue: m.overdue, overdue_days: m.overdue_days },
    state: neverUsed(sc.rows.length)
  }; /* not_started: the shop holds no chit at all */
}

/**
 * accounts — when the ledger was last checked, and what waits on the owner (to accept · to add · to record). A shop whose ledger is off, or not provisioned, gets no lines.
 * OMITTED: nothing is guessed; "checked" is the date books_setting.last_check holds, absent until the first check ran.
 */
async function accounts(ctx) {
  const B = require('./books'),
    S = require('./books-store');
  let s,
    n = { total: 0, accept: 0, add_supplier: 0, record: 0 };
  try {
    await withEntity(ctx.entity, async (h) => {
      s = await B.settingOf(h, ctx.entity);
      if (s && s.enabled) n = await S.waitingCount(h, ctx.entity);
    });
  } catch (e) {
    if (notProvisioned(e)) return notStarted('the ledger is not provisioned');
    throw e;
  }
  if (!s || !s.enabled) return notStarted('the ledger is off');
  const lines = [],
    lc = s.last_check || null;
  const at = lc && lc.at ? String(lc.at).slice(0, 10) : null;
  /* "Checked today 09:40" — the moment travels as ISO and the page words it (shell.js {when}) */
  const atFull = lc && lc.at ? new Date(lc.at).toISOString() : null;
  if (at)
    lines.push(
      lc.ok === false ? { text: 'Checked {when} · a difference was found', tone: 'dn', at: atFull || at } : { text: 'Checked {when}', at: atFull || at }
    );
  /* FX-F10W · STD1: what the waiting rows ask of the owner, in Books' To do words — the ONE count (books-store waitingCount: GROUP BY todo, every row) */
  const waiting = n.total,
    said = [];
  if (n.accept) said.push(plural(n.accept, 'supplier bill') + ' to accept');
  if (n.add_supplier) said.push(plural(n.add_supplier, 'supplier') + ' to add');
  if (n.record) said.push(n.record + ' waiting to be recorded');
  lines.push(waiting ? { text: said.join(' · '), value: waiting, tone: 'dn' } : { text: 'Nothing waiting', value: 0 });
  return { state: neverUsed(at, waiting), lines, figures: { last_check: at, waiting, accept: n.accept, add_supplier: n.add_supplier, record: n.record } };
}

/**
 * product-lab — how many items there are, and how many have no cost. A COUNT; no cost value is read.
 * The no-cost line is the owner's (and an actor with can_see_costs): lib/cost.canRead, fail-closed — who may see costs is who may be nagged about them.
 */
async function productLab(ctx) {
  const cost = require('./cost'),
    ic = require('./item-cost');
  const may = ctx.req ? await cost.canRead(ctx.req, ctx.entity) : true;
  const [r] = await readBatch(ctx.entity, ctx.actor, [
    {
      params: [ctx.entity],
      text: `SELECT count(*)::int AS items, (count(*) FILTER (WHERE ${ic.NO_COST_SQL}))::int AS no_cost FROM catalogue_items WHERE entity_id = $1 AND is_active = true`
    }
  ]);
  const row = (r.rows && r.rows[0]) || {};
  const items = n0(row.items);
  if (!items) return { lines: [], figures: {}, state: 'not_started' }; /* no active product */
  const lines = [{ text: plural(items, 'item'), value: items }],
    figures = { items };
  if (may) {
    const nc = n0(row.no_cost);
    figures.no_cost = nc;
    lines.push(nc ? { text: plural(nc, 'item') + ' with no cost', value: nc, tone: 'dn' } : { text: 'Every item has a cost', value: 0 });
  }
  return { lines, figures };
}

/**
 * tax-lab — how many products have NO tax slab: the shelf's own rule (tax-lines.resolveItem → tax-slab.resolve source 'none': nothing on the
 * product, its categories or the catalogue answers). ⚠️ 'none' is not 0% — a nil-rated slab is an answer and is not counted (TAX-SRV1 G7).
 * The shelf is read once (services.shelfOf, the read /api/tax/compute uses); only the COUNT leaves — no item_data, no cost.
 * OMITTED: the count for a GST shop with no GSTIN — it charges no tax ("no GSTIN, no GST", lib/tax-shelf), so no slab is missing.
 */
async function taxLab(ctx) {
  const sh = await require('./services').shelfOf(ctx.entity),
    T = require('./tax-lines');
  const items = sh.items.length;
  if (!items) return { lines: [], figures: {}, state: 'not_started' }; /* no product on the shelf */
  if (!sh.shelf) return none('the shop charges no tax (no tax number)');
  const noSlab = sh.items.filter((item) => T.resolveItem(item.item_data, sh.shelf).source === 'none').length;
  return {
    lines: [
      noSlab
        ? { text: plural(noSlab, 'product') + (noSlab === 1 ? ' has' : ' have') + ' no tax slab', value: noSlab, tone: 'dn' }
        : { text: 'Every product has a tax slab', value: 0 }
    ],
    figures: { products: items, no_slab: noSlab }
  };
}

/**
 * combo-lab — the saved sets in the library (combo_templates). OMITTED: a "combos · modifiers" split — the table stores one shape for both
 * (`{name, required, max, options}` groups), so any split would be invented.
 */
async function comboLab(ctx) {
  let r;
  try {
    [r] = await readBatch(ctx.entity, ctx.actor, [{ text: 'SELECT count(*)::int AS n FROM combo_templates WHERE entity_id = $1', params: [ctx.entity] }]);
  } catch (e) {
    if (notProvisioned(e)) return notStarted('saved combos are not provisioned');
    throw e;
  }
  const n = n0(r.rows && r.rows[0] && r.rows[0].n);
  return { lines: [{ text: n ? plural(n, 'saved set') : 'No saved sets yet', value: n }], figures: { saved: n }, state: neverUsed(n) };
}

/**
 * country-lab (CTRY-1) — the shop's own country pack, and how many packs the registry holds. Nothing is typed here: the pack is the engines
 * registry's (regulation.packFor: a pack or null, never lookup's India fallback), the counts are its list(). A shop whose country has no pack is SAID, never
 * shown another country's rules ("no pack, no shop"). One trip: the identity row's country.
 */
async function countryLab(ctx) {
  const registry = require('./regulation');
  const [read] = await readBatch(ctx.entity, ctx.actor, [{ text: 'SELECT country FROM identities WHERE identity_id = $1', params: [ctx.entity] }]);
  const code = String((read.rows && read.rows[0] && read.rows[0].country) || '').toUpperCase();
  const packs = registry.list(),
    checked = packs.filter((pack) => pack.verified).length,
    shopPack = code ? registry.packFor(code) : null;
  const lines = [{ text: plural(packs.length, 'country pack') + ' · ' + checked + ' checked by a local accountant', value: packs.length }];
  if (code) lines.unshift(shopPack ? { text: shopPack.name + ' pack ' + shopPack.version, value: 1 } : { text: 'No pack for ' + code + ' yet', value: 0, tone: 'dn' });
  return { lines, figures: { packs: packs.length, checked, shop_country: code || null, shop_pack: shopPack ? shopPack.version : null } };
}

/** offer-lab — offers waiting as drafts, and how many are live (definitions, kind 'offer'; retired ones are neither). */
async function offerLab(ctx) {
  let r;
  try {
    [r] = await readBatch(ctx.entity, ctx.actor, [
      {
        params: [ctx.entity],
        text: `SELECT (count(*) FILTER (WHERE status = 'draft'))::int AS drafts, (count(*) FILTER (WHERE status = 'live'))::int AS live FROM definition WHERE entity_id = $1 AND kind = 'offer'`
      }
    ]);
  } catch (e) {
    if (notProvisioned(e)) return notStarted('definitions are not provisioned');
    throw e;
  }
  const row = (r.rows && r.rows[0]) || {},
    drafts = n0(row.drafts),
    live = n0(row.live);
  return {
    lines: [
      drafts ? { text: plural(drafts, 'draft') + ' waiting', value: drafts, tone: 'dn' } : { text: 'No drafts waiting', value: 0 },
      { text: plural(live, 'offer') + ' live', value: live }
    ],
    figures: { drafts, live },
    state: neverUsed(drafts, live)
  };
}

/**
 * railScope — the chit rows and the clock that "in / out / stuck" are measured with. ONE place, so the Home rail's chips and the list
 * behind them (railChits) can never disagree: stuck = open and at least the shop's own overdue_days old (lib/measure).
 * truncated = the shop has more chit copies than the 5,000 one read takes, so no count over it would be right.
 */
const RAIL_LIMIT = 5000;
async function railScope(ctx) {
  const select = require('./select'),
    policy = require('./policy');
  /* readBatch sets app.current_entity inside its own BEGIN…COMMIT — entity-scoped like withEntity, in ONE wire trip */
  /* RAIL-LAB-SRV1: the shop's population rides the SAME statement (to_jsonb: a NULL before b249, never a failed query) — the rail
     card's may_sample is lib/istest's one lab rule over it; no second identities read */
  const [od, rows] = await Promise.all([
    readBatch(ctx.entity, ctx.actor, [
      {
        params: [ctx.entity],
        text: `SELECT policy_flags->'overdue_days' AS overdue_days, to_jsonb(i)->>'population' AS population FROM identities i WHERE identity_id = $1`
      }
    ]),
    select.rows(ctx.entity, { limit: RAIL_LIMIT })
  ]);
  const row = (od[0].rows && od[0].rows[0]) || {};
  const d = policy.coerce('overdue_days', row.overdue_days != null ? Number(row.overdue_days) : undefined);
  return {
    rows,
    truncated: rows.length >= RAIL_LIMIT,
    population: row.population == null ? null : String(row.population),
    opts: { overdue_days: d !== undefined ? d : policy.FLAGS.overdue_days.def, now: ctx.now }
  };
}

/**
 * rail — { suppliers, customers, in, out, tasks, stuck }.
 * ⭐ suppliers / customers are the CRM's own count: lib/crm.rows + crm.assemble (the same filters — merged, hidden, another population,
 *   the shop itself), so the Home rail and CB CRM's Suppliers / Customers filters can never differ. A party on both lists counts under both
 *   roles, exactly as CRM's role filter lists it.
 * in / out / tasks = the Tasks & Orders folder counts (lib/work-rows classify · countsOf — Orders in · Orders out · Tasks, TOUR-FIX1); stuck = open and
 *   older than the shop's own overdue_days (lib/measure — the MIS read).
 * OMITTED: in/out/stuck when the shop has more chit copies than the 5,000 the read takes — a count over a truncated read would be wrong, so none is given.
 * may_sample (RAIL-LAB-SRV1): the SERVER's may/why for "may this shop try a sample chit on the rail" — { ok: true } on a lab shop
 *   (population not live, lib/istest.maySample: b249's one axis), { ok: false, why: 'live_shop', say } on a live one. The Rail Lab shows the
 *   action greyed with `say`; it branches on `why`, never on the words. Always present — a shop whose population is unstated is live.
 */
async function rail(ctx) {
  const crm = require('./crm'),
    istest = require('./istest');
  const [raw, sc] = await Promise.all([crm.rows(ctx.entity), railScope(ctx)]);
  const parties = crm.assemble(raw).parties;
  if (ctx.keep) ctx.keep.parties = parties; /* CB Sides asks the same question of the same parties - one read, not two (H31-r) */
  const out = {
    suppliers: parties.filter((item) => item.roles.supplier).length,
    customers: parties.filter((item) => item.roles.customer).length,
    may_sample: istest.maySample(sc.population)
  };
  if (!sc.truncated) {
    /* ⭐ TOUR-FIX1 (Home said 187 in, Tasks › Orders in said 0): in / out / tasks are the Tasks list's OWN folder counts — lib/work-rows
       classify + countsOf over this same select read — so the rail and the list it opens can never be two answers */
    const W = require('./work-rows'),
      c = W.countsOf(W.classify(sc.rows, ctx.entity));
    out.in = c.orders_in;
    out.out = c.orders_out;
    out.tasks = c.tasks;
    out.stuck = railMeasure(
      sc.rows,
      ctx.entity,
      sc.opts
    ).overdue; /* T3-P4-ACCOUNT: the ONE rail measure (own notes never overdue) — rail · reports · folders/mis */
  }
  /* state (the rail has no lines): stuck -> needs_you; no party and no chit counted -> not_started; else in_use */
  out.state =
    out.stuck > 0
      ? 'needs_you'
      : !out.suppliers && !out.customers && !n0(out.in) && !n0(out.out) && !n0(out.tasks) && !sc.rows.length
        ? 'not_started'
        : 'in_use';
  return out;
}

const DAY = 86400000;
/**
 * ⭐ A CHIT THE SHOP SENT TO ITSELF IS NEVER "STUCK" (Athi, 2026-10-09: stuck ideally zero). Nobody else can answer it, so "nobody answered"
 * is not an exception — it is a note to self, a counter sale or a summary. The ones with a defined end (a counter sale, a day / week /
 * month summary) are CLOSED by the books when they post (lib/books-hooks closeDone); the ones with none stay open as "in" — your own
 * to-do — and are listed on the In tab, never as stuck. A chit from anyone else keeps lib/measure's test.
 */
function isOwnNote(x, entity) {
  return String(x.sender_entity_id) === String(entity) && x.direction === 'received';
}
/**
 * railMeasure — lib/measure over the rows, with the rail's one rule on top: the shop's OWN notes are never overdue (they stay open as "in", a to-do).
 * The ONE helper (T3-P4-ACCOUNT): Home's rail (stuck), the reports card and GET /api/folders/mis (CB Finance › Reports) all count overdue with it,
 * so a number on Reports opens CB CRM's stuck list and finds the same chits. Every other figure is measure's own.
 */
function railMeasure(rows, entity, opts) {
  const measure = require('./measure');
  const m = measure.measure(rows, opts);
  m.overdue = measure.measure(
    (rows || []).filter((x) => !isOwnNote(x, entity)),
    opts
  ).overdue;
  return m;
}
/* W2-RAIL R2: the status words are the ONE table (lib/rail-actions BUCKETS / OPEN_STATES) — never spelled here */
const { OPEN_STATES: OPEN, BUCKETS } = require('./rail-actions');
const nameOf = (x) => {
  if (x.direction === 'received') return x.sender_entity_display_name || null;
  const r = Array.isArray(x.all_recipients) ? x.all_recipients[0] : null;
  return (r && (r.display_name || r.name || r.entity_display_name)) || null;
};
/** a stuck chit's reason, in a shopkeeper's words: what is waiting, on whom, for how long */
function whyStuck(x, days) {
  const d = days === 1 ? '1 day' : days + ' days';
  if ((+x.open_disputes || 0) > 0) return 'A dispute is open, and the chit is ' + d + ' old.';
  const unanswered = BUCKETS.open.includes(x.current_status);
  if (x.direction === 'received')
    return unanswered ? 'They sent it ' + d + ' ago and you have not answered.' : 'You accepted it, but it is not finished after ' + d + '.';
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
  const items = sc.rows
    .filter((x) => OPEN.includes(x.current_status))
    .map((x) => {
      const age = Math.round(((now - new Date(x.created_at).getTime()) / DAY) * 10) / 10;
      const self = isOwnNote(x, ctx.entity);
      const stuck = !self && age >= sc.opts.overdue_days; /* lib/measure: days(created_at, now) >= overdue_days — and never your own note */
      /* WHO: select.rows resolves the other side by direction (counterparty_name); the first recipient of a SENT copy is the shop itself, which read "To <your own shop>" */
      const who = x.counterparty_name || (x.counterparty_id ? null : nameOf(x));
      /* AMOUNT: the quoted total, else what the chit's own body carries (an advice's payment, an expense's amount); none -> null, never a made-up 0.00 */
      const pick = [x.value, x.alt_value].find((item) => item != null && Number(item) > 0);
      /* OWN: the shop's own counter sale, expense, income or credit note, or a note to self - not a thing with another party (CRM is about parties) */
      const own =
        self ||
        ['expense', 'income', 'credit_note'].includes(x.purpose) ||
        x.doc_kind === 'bill_issued' ||
        (x.counterparty_id != null && String(x.counterparty_id) === String(ctx.entity)) ||
        (x.counterparty_id == null && !who && x.sender_entity_id != null && String(x.sender_entity_id) === String(ctx.entity));
      return {
        chit_id: x.chit_id,
        direction: x.direction,
        tab: x.direction === 'received' ? 'in' : 'out',
        stuck,
        status: x.current_status,
        created_at: x.created_at,
        age_days: age,
        subject: x.manual_subject || x.auto_subject || null,
        who: who || null,
        kind: x.biz_kind === 'payment_advice' ? 'payment_advice' : x.purpose || null,
        value: pick == null ? null : Number(pick),
        currency: x.currency || null,
        self,
        own,
        why: stuck ? whyStuck(x, Math.floor(age)) : null
      };
    });
  /* M168: the orders the Orders card counts — lib/open-orders, the till's own list — are flagged so CRM can list exactly them (only when an order is among the items) */
  if (items.some((x) => x.kind === 'order')) {
    const open = new Set((await require('./open-orders').tasks(ctx.entity, 'despatch', RAIL_LIMIT)).map((item) => String(item.chit_id)));
    items.forEach((x) => {
      x.open_order = open.has(String(x.chit_id));
    });
  }
  items.sort((first, second) => second.stuck - first.stuck || new Date(second.created_at) - new Date(first.created_at));
  return { overdue_days: sc.opts.overdue_days, truncated: false, items };
}

/**
 * orders — the orders waiting to be sent: lib/open-orders.tasks(despatch), the SAME list the till's 🛒 and its order list read (M168: Home said 19,
 * the till said 2 — two definitions). Never the whole CRM In list. none open says so in words, never a bare 0.
 */
async function orders(ctx) {
  const n = (await require('./open-orders').tasks(ctx.entity, 'despatch', RAIL_LIMIT)).length;
  return { lines: [n ? { text: plural(n, 'order') + ' open', value: n, tone: 'dn' } : { text: 'No open orders', value: 0 }], figures: { open: n } };
}

/**
 * operations — CB Operations' card (T3-OPS): how many products are on the shelf, and how many went below zero — the one stock reader
 * (lib/stock-store.onHand), the same figure CB Operations › Stock lists. OMITTED: a "low stock" count — no reorder level is kept, so "low"
 * would be invented; below zero is a fact (sold with no receipt behind it) and is what a count corrects.
 */
async function operations(ctx) {
  if (!(await require('./schema').hasTable('stock_balance'))) return notStarted('the stock ledger is not provisioned');
  /* R104: a dish made to order is not counted (lib/stocked) — the SAME filter Stock applies, so Home never says "3 below zero" while Stock says none */
  const by = await require('./stock-store').onHand(ctx.entity, withEntity, { counted_only: true });
  const ids = Object.keys(by);
  if (!ids.length) return { lines: [{ text: 'No stock moved yet', value: 0 }], figures: { items: 0, below_zero: 0 }, state: 'not_started' };
  const on = ids.filter((id) => by[id].qty > 0).length,
    below = ids.filter((id) => by[id].qty < 0).length;
  return {
    lines: [
      { text: plural(on, 'item') + ' on the shelf', value: on },
      below ? { text: plural(below, 'item') + ' below zero', value: below, tone: 'dn' } : { text: 'None below zero', value: 0 }
    ],
    figures: { items: on, below_zero: below }
  };
}

/**
 * disputes — T3-DISPUTES-ASSIST: the open disputes on the shop's own copies, split "against you" (work to answer) · "you raised" (work to chase).
 * The SAME rows GET /chits/disputes/queue counts (chit_disputes under RLS = my copies), one read. None open says so in words, never a bare 0;
 * a shop whose dispute table is missing gets no lines (the card shows no figure, never an invented one).
 */
async function disputes(ctx) {
  let r;
  try {
    r = await withEntity(ctx.entity, (db) =>
      db.query(
        `SELECT count(*) FILTER (WHERE raised_by_entity_id = $1)::int AS mine, count(*) FILTER (WHERE raised_by_entity_id <> $1)::int AS against
         FROM chit_disputes WHERE status = 'open'`,
        [ctx.entity]
      )
    );
  } catch (e) {
    if (/chit_disputes/.test(String(e && e.message))) return { lines: [] };
    throw e;
  }
  const x = (r.rows && r.rows[0]) || {},
    mine = +x.mine || 0,
    against = +x.against || 0,
    lines = [];
  if (against) lines.push({ text: plural(against, 'dispute') + ' against you', value: against, tone: 'dn' });
  if (mine) lines.push({ text: plural(mine, 'dispute') + ' you raised', value: mine });
  if (!lines.length) lines.push({ text: 'No open disputes', value: 0 });
  return { lines, figures: { open: mine + against, mine, against } };
}

/**
 * assist — T3-DISPUTES-ASSIST: CB Assist's published answers (assist_qa, active — the SAME rows GET /api/assist/questions serves), one count.
 * The library is the platform's, not the shop's, so it is read without a shop context. No table → no lines.
 */
async function assist() {
  let r;
  try {
    r = await require('../db').query(`SELECT count(*)::int AS n FROM assist_qa WHERE active = true`);
  } catch (e) {
    if (/assist_qa/.test(String(e && e.message))) return { lines: [] };
    throw e;
  }
  const n = +((r.rows && r.rows[0] && r.rows[0].n) || 0);
  return {
    lines: [n ? { text: plural(n, 'answer') + ' live', value: n } : { text: 'No answers published yet', value: 0 }],
    figures: { answers: n },
    state: neverUsed(n)
  };
}

/**
 * marketing (MKT-SRV1 G3) — who may be sent offers, from the consent rows (b306): a party counts as AGREED when its newest marketing row on any
 * channel is a yes; as SAID NO when it has marketing rows and none of them is a standing yes. ONE statement (the newest row per party × channel).
 * OMITTED before b306 runs: `unavailable` in words, never 0 (a 0 would say "nobody agreed", which nobody can know yet).
 */
async function marketing(ctx) {
  let r;
  try {
    r = await withEntity(ctx.entity, (h) =>
      h.query(
        `WITH last AS (SELECT DISTINCT ON (party_id, channel) party_id, allowed FROM party_contact_pref
        WHERE owner_entity_id = $1 AND purpose = 'marketing' ORDER BY party_id, channel, noted_at DESC),
      per AS (SELECT party_id, bool_or(allowed) AS yes FROM last GROUP BY party_id)
      SELECT (count(*) FILTER (WHERE yes))::int AS agreed, (count(*) FILTER (WHERE NOT yes))::int AS said_no FROM per`,
        [ctx.entity]
      )
    );
  } catch (e) {
    if (notProvisioned(e)) return notStarted('Consent records need migration b306 — not run yet.');
    throw e;
  }
  const x = r.rows[0] || {},
    agreed = n0(x.agreed),
    said_no = n0(x.said_no);
  const lines = [
    agreed
      ? { text: plural(agreed, 'party', 'parties') + ' agreed to offers', value: agreed }
      : { text: 'Nobody has agreed to offers yet. Ask first.', value: 0 }
  ];
  if (said_no) lines.push({ text: plural(said_no, 'party', 'parties') + ' said no to offers', value: said_no, tone: 'dn' });
  return { lines, figures: { agreed, said_no }, state: neverUsed(agreed, said_no) };
}

/**
 * people — PEOPLE-SRV1 (G5): who is at work, away, switched off. The same people GET /api/people lists (lib/people.peopleSql) and
 * the same three words (lib/people.stateOf) — one count, grouped in SQL, one trip. Any signed-in person of the shop may read it
 * (colleagues read the list too); a key is refused by routes/facts.js. No people → said in words, never a bare 0.
 */
async function people(ctx) {
  const P = require('./people');
  const [r] = await readBatch(ctx.entity, ctx.actor, [
    {
      params: [ctx.entity],
      text: `SELECT i.break_status, count(*)::int AS n FROM identities i WHERE i.parent_entity_id = $1 AND ${P.peopleSql('i')} GROUP BY i.break_status`
    }
  ]);
  const f = { at_work: 0, away: 0, off: 0 };
  for (const row of (r && r.rows) || []) {
    const st = P.stateOf(row.break_status);
    f[st === 'on' ? 'at_work' : st] += n0(row.n);
  }
  const total = f.at_work + f.away + f.off;
  if (!total) return { lines: [{ text: 'No people added yet', value: 0 }], figures: Object.assign({ total }, f), state: 'not_started' };
  const lines = [{ text: plural(f.at_work, 'person', 'people') + ' at work' + (f.away ? ' · ' + f.away + ' away' : ''), value: f.at_work }];
  if (f.off) lines.push({ text: f.off + ' switched off', value: f.off });
  return { lines, figures: Object.assign({ total }, f) };
}

/**
 * finance (T3-P1-MONEY) — the cheques in hand that want a step: how many to deposit today or overdue for deposit (and their sum), else the next post-dated
 * one. The SAME rows and the SAME engine read GET /api/books/cheques answers (books-store.cheques → receivables.pdcReminders, the shop's switch from its stored
 * terms) — one transaction: setting · terms · cheques. A shop whose ledger is off, or not provisioned, gets no lines.
 * OMITTED: who owes you (the dues read is the Collections tab's own, heavier than a card should cost); nothing is guessed.
 */
async function finance(ctx) {
  const B = require('./books'),
    S = require('./books-store'),
    E = require('./books-engines'),
    T = require('./finance-terms'),
    CLOCK = require('./shop-clock');
  const { fromMinor } = require('./books-cashflow'); /* minor → the pack's major unit (the one rounder); the page words the symbol */
  let s,
    rows = [],
    remind = null,
    day = null;
  try {
    /* the b298 probe failing is not a reason to lose the card: the switch reads as "never set" (on, 7 days) and the miss is logged */
    const mig = await T.migrated().catch((e) => {
      require('./logger').warn('facts/finance: terms probe failed, reminder read as unset', { err: e && e.message });
      return false;
    });
    await withEntity(ctx.entity, async (h) => {
      s = await B.settingOf(h, ctx.entity);
      if (!s || !s.enabled) return;
      remind = T.pdcRemind(mig ? await T.shopTerms(h, ctx.entity) : {});
      day = CLOCK.today(s);
      rows = await S.cheques(h, ctx.entity, false, 200);
    });
  } catch (e) {
    if (notProvisioned(e)) return notStarted('the ledger is not provisioned');
    throw e;
  }
  if (!s || !s.enabled) return notStarted('the ledger is off');
  const cur = B.curOf(s);
  const list = rows.filter((item) => item.direction === 'in');
  const pdc =
    E.receivables().pdcReminders(
      list.map((item) => ({
        id: String(item.payment_id),
        amount: Number(item.amount_minor),
        cheque: { no: item.cheque_no || null, date: E.ymd(item.cheque_date), status: item.status || 'received' }
      })),
      day,
      { on: true, lead_days: remind.lead_days }
    ) || [];
  const due = pdc.filter((item) => item.state !== 'not_yet'),
    late = due.filter((item) => item.state === 'overdue_for_deposit');
  const next = pdc.filter((item) => item.state === 'not_yet').sort((first, second) => String(first.date).localeCompare(String(second.date)))[0] || null;
  const held = list.filter((item) => (item.status || 'received') !== 'cleared' && (item.status || 'received') !== 'bounced');
  const lines = [];
  if (due.length)
    lines.push({
      text: plural(due.length, 'cheque') + ' to deposit · {money}' + (late.length ? ' · ' + late.length + ' overdue' : ''),
      value: due.length,
      tone: 'dn',
      money: {
        amount: fromMinor(
          due.reduce((total, item) => total + n0(item.amount), 0),
          cur
        ),
        currency: cur
      }
    });
  else if (next)
    lines.push({ text: 'Next cheque {date} · {money}', value: 1, at: next.date, money: { amount: fromMinor(n0(next.amount), cur), currency: cur } });
  else lines.push({ text: held.length ? plural(held.length, 'cheque') + ' in hand' : 'No cheque waiting', value: held.length });
  /* the switch, for the card's words only when the owner turned it off: the reminders above are still COUNTED (the card never hides a figure) */
  if (remind && !remind.on) lines.push({ text: 'Cheque reminders off', value: 0 });
  return {
    lines,
    figures: { as_of: day, to_deposit: due.length, late: late.length, in_hand: held.length, remind_on: remind ? remind.on : null },
    state: neverUsed(rows.length)
  };
}

/**
 * WALK2 W3 (walk 18 Oct: "these tiles have NO status line — silence is the bug"): four cards that said nothing now say one line each,
 * every figure from the read the screen behind the tile already makes. A tile with nothing to read says not_started (the shell words it).
 */
/** crm — how many customers and suppliers CB CRM lists: lib/crm.rows + crm.assemble, the same parties the rail counts (one rule) */
async function crmCard(ctx) {
  const crmLib = require('./crm');
  const parties = crmLib.assemble(await crmLib.rows(ctx.entity)).parties;
  const customers = parties.filter((party) => party.roles.customer).length,
    suppliers = parties.filter((party) => party.roles.supplier).length;
  return {
    lines: [{ text: plural(customers, 'customer') + ' · ' + plural(suppliers, 'supplier'), value: customers }],
    figures: { customers, suppliers },
    state: neverUsed(customers, suppliers)
  };
}

/** trend — the Till card's 8-week teaser (lib/till-summary.teaser, the rollup the Trend page uses); the shell draws it. Too few weeks → not_started. */
async function trend(ctx) {
  const ts = require('./till-summary');
  const [shopYear, weeks] = await readBatch(ctx.entity, ctx.actor, ts.teaserStatements(ctx.entity));
  const teaser = ts.teaser(shopYear, weeks, ctx.now);
  if (!teaser) return { lines: [], figures: {}, state: 'not_started' };
  return { lines: teaser.vs_last_year_pct == null ? [{ text: 'Last 8 weeks' }] : [], figures: { trend: teaser } };
}

/* the storefront's three tiers in a shopkeeper's words (lib/catalogue-view.catalogueVisibility decides which; closed reads as private) */
const SHOP_WORDS = { public: 'Open to everyone', network: 'Open to your network only' };
/** storefront — who can see the online shop now: catalogueVisibility, the ONE gate the shop page itself passes. Private (the default) = not set up. */
async function storefront(ctx) {
  const view = require('./catalogue-view');
  const seen = await view.catalogueVisibility({
    entity_id: ctx.entity,
    query: require('../db').query,
    visibilityCap: require('./visibility-cap'),
    viewer: null
  });
  if (!SHOP_WORDS[seen]) return notStarted('only the owner can see the shop');
  return { lines: [{ text: SHOP_WORDS[seen] }], figures: { visibility: seen } };
}

/** compare (Parallel run) — how many of their period snapshots are kept: books-store.compareSnapshots, the list GET /api/books/compare shows */
async function compare(ctx) {
  const books = require('./books'),
    store = require('./books-store');
  let setting,
    snapshots = [];
  try {
    await withEntity(ctx.entity, async (handle) => {
      setting = await books.settingOf(handle, ctx.entity);
      if (setting && setting.enabled && (await store.compareReady())) snapshots = await store.compareSnapshots(handle, ctx.entity);
    });
  } catch (e) {
    if (notProvisioned(e)) return notStarted('the ledger is not provisioned');
    throw e;
  }
  if (!setting || !setting.enabled) return notStarted('the ledger is off');
  if (!snapshots.length) return notStarted('none of their figures loaded yet');
  return {
    lines: [{ text: plural(snapshots.length, 'period') + ' of their books loaded', value: snapshots.length }],
    figures: { snapshots: snapshots.length }
  };
}

/**
 * ── SET-35 (T3-SETTINGS 2nd run, carried over from closed api #230): the CB Settings doors' Home cards — connectors · governance · plan ───────
 * Each is the section's OWN read, projected to one or two lines; the section paints the whole. Nothing is a second rule:
 *   connectors — lib/connector-rows.connectorsOf, the statement GET /api/integrations/status answers with (one trip)
 *   governance — lib/policy.get against lib/policy.defaults: how many rules the shop set away from the default (one trip)
 *   plan       — identities.plan · the active constitution's plan_menu (routes/governance) · countChitsToday (the quota's own counter)
 * OMITTED: a key's last-seen (the section says it), a connector's own-system health (the row says it), a limit the constitution does not
 * declare (said in words — "Limits not declared" — never 0, never unlimited).
 */
async function connectors(ctx) {
  const rows = await connectorsOf(ctx.entity);
  if (!rows.length) return { lines: [{ text: 'No connector has checked in', value: 0 }], figures: { connectors: 0, live: 0 }, state: 'not_started' };
  const live = rows.filter((row) => row.health === 'live').length,
    last = rows.find((row) => row.last_seen) || null;
  const lines = [
    { text: plural(rows.length, 'connector') + ' · ' + (live ? plural(live, 'live', 'live') : 'none live'), value: rows.length, tone: live ? undefined : 'dn' }
  ];
  if (last) lines.push({ text: (last.name || last.adapter || 'A connector') + ' seen {when}', at: last.last_seen });
  return { lines, figures: { connectors: rows.length, live } };
}
async function governance(ctx) {
  const policy = require('./policy');
  const flags = await policy.get(ctx.entity),
    defaults = policy.defaults();
  const all = Object.keys(policy.FLAGS);
  const changed = all.filter((flagKey) => flags[flagKey] !== undefined && JSON.stringify(flags[flagKey]) !== JSON.stringify(defaults[flagKey]));
  const line = changed.length
    ? { text: plural(changed.length, 'rule') + ' set by you', value: changed.length }
    : { text: 'Every rule at its default', value: 0 };
  return { lines: [line], figures: { changed: changed.length, rules: all.length } };
}
/** the constitution's limits for a plan code — null when the menu or the code's entry is not declared (the card says so, never 0) */
const limitsOf = (menu, code) => {
  const entry = menu && code ? menu[code] : null;
  return entry && typeof entry === 'object' ? entry : null;
};
/** the plan code, today's chits and the constitution's menu for the code (limits null when not declared); an unprovisioned table reads as "not there" — 2 trips */
async function planAndUse(ctx) {
  const governanceRoute = require('../routes/governance');
  let code = null,
    used = 0,
    menu = null;
  try {
    const [planRead, usedRead] = await readBatch(ctx.entity, ctx.actor, [
      { text: 'SELECT plan FROM identities WHERE identity_id = $1', params: [ctx.entity] },
      { text: governanceRoute.CHITS_TODAY_SQL, params: [ctx.entity] }
    ]);
    code = (planRead.rows[0] && planRead.rows[0].plan) || null;
    used = (usedRead.rows[0] && usedRead.rows[0].n) || 0;
  } catch (e) {
    if (!notProvisioned(e)) throw e;
  }
  try {
    const active = await governanceRoute.loadActiveConstitution();
    menu = active && active.plan_menu;
  } catch (e) {
    if (!notProvisioned(e)) throw e;
  }
  return { code, used, limits: limitsOf(menu, code) };
}
async function plan(ctx) {
  const { code, used, limits } = await planAndUse(ctx);
  const lines = [code ? { text: code.charAt(0).toUpperCase() + code.slice(1) + ' plan', value: 1 } : { text: 'No plan recorded', value: 0 }];
  if (!limits) lines.push({ text: 'Limits not declared for this plan' });
  else if (limits.chits_per_day == null) lines.push({ text: plural(used, 'chit') + ' today · no daily limit', value: used });
  else lines.push({ text: plural(used, 'chit') + ' today of ' + limits.chits_per_day, value: used, tone: used >= limits.chits_per_day ? 'dn' : undefined });
  return { lines, figures: { plan: code, limits, used: { chits_today: used } } };
}

/* ⭐ ONE registry — every round adds its card here */
const CARDS = {
  till,
  counters,
  account,
  reports,
  accounts,
  orders,
  operations,
  disputes,
  assist,
  people,
  finance,
  'product-lab': productLab,
  'combo-lab': comboLab,
  'offer-lab': offerLab,
  'tax-lab': taxLab,
  'country-lab': countryLab,
  rail,
  marketing,
  crm: crmCard,
  trend,
  storefront,
  compare,
  connectors,
  governance,
  plan
};

/**
 * withState — THE ONE PLACE the default lives. A card that knows the shop never used the area says state: 'not_started' itself (beside its figures);
 * one that did not say gets 'needs_you' when any line carries tone 'dn' (something to act on), else 'in_use' (running, even if nothing is pending).
 * Decided from the lines' tone, a field the card set from its figures - never from the line text.
 */
const STATES = ['needs_you', 'in_use', 'not_started'];
function withState(answer) {
  const body = answer || {};
  if (STATES.indexOf(body.state) >= 0) return body;
  const pending = Array.isArray(body.lines) && body.lines.some((line) => line && line.tone === 'dn');
  return Object.assign({}, body, { state: pending ? 'needs_you' : 'in_use' });
}
const BUILD = {};
for (const name of Object.keys(CARDS)) BUILD[name] = async (ctx) => withState(await CARDS[name](ctx));

module.exports = { BUILD, withState, railChits, isOwnNote, railMeasure };
