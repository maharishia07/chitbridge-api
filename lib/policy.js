// lib/policy.js — THE per-entity policy flags, server-side and real (b130).
//
// Athi, 2026-08-09: *"make the policy flags real, move it to settings."*
//
// They were a localStorage prototype: the card said "set ✓", nothing left the browser, and the server that is
// supposed to ENFORCE them never heard. This is the one place they are defined, validated and read.
//
// ── ⚠️ THE SCHEMA IS THE WHITELIST ──────────────────────────────────────────────────────────────────────────────
// A flag not in FLAGS does not exist. `policy_flags` is a jsonb column and a PATCH that could spread arbitrary keys
// into it would make an entity's own governance a place callers can write.
//
// ── ⚠️ self_copy_pref IS PROXIED, NOT COPIED ────────────────────────────────────────────────────────────────────
// It has its own column, and that column is what /api/chits/send reads to suppress a copy. Storing it here as well
// would create two facts about one entity that drift the first time one write path is missed. So it is read from
// and written to the column, and merely PRESENTED alongside the rest.
const { query } = require('../db');

/**
 * ⚠️ `trade_side` — AN ENTITY IS CREATED FOR A PURPOSE. Athi, 2026-08-09: *"we are creating entity for a purpose,
 * sell and purchase never been the same entity. while testing we are trying to test all the possibility in the
 * same business, so for us it seems the same entity will do everything, but that is not going to be the case."*
 *
 * That is why this is an ENTITY setting and not the per-message toggle I first built. A catalogue price is a
 * SELL-SIDE price: right for a shop taking an order, wrong for a factory receiving milk, where it would price an
 * inbound supply notice off what the factory sells at. Which one an entity is does not change message to message.
 */
const FLAGS = {
  trade_side:        { type: 'enum',   options: ['sell', 'receive'], def: 'sell' },
  /**
   * ⭐ HOW THIS ENTITY IS REGISTERED FOR GST — Tally's "registration type" on the company and on every party
   * (STUDY-gst-structure-2026-09-04 §1, M1/M2). It decides what an invoice may CHARGE, before any rate does:
   *   regular       — charges GST, claims ITC (the default; a GSTIN on the profile).
   *   composition   — pays a flat % on turnover, charges NO GST on the invoice, cannot claim ITC.
   *   unregistered  — no GSTIN; as a BUYER makes every sale to them B2C; as a seller charges nothing.
   *   sez           — a supply TO an SEZ unit is zero-rated (under LUT): rate 0 on the invoice, credit retained.
   * A policy flag, not a vault row: lib/tax.js reads it on every determination and must not decrypt a vault to
   * do so. The GSTIN itself stays on the profile; this is what KIND of taxpayer holds it.
   */
  gst_registration:  { type: 'enum',   options: ['regular', 'composition', 'unregistered', 'sez'], def: 'regular' },
  /**
   * ⭐⭐ WHICH DETAIL PAGE THIS BUSINESS READS ITS WORK ON. Athi, 2026-08-24: *"I guess we have to attach design
   * 1 or design 2 per entity so we can attach only one design for a store."*
   *
   * `chit` — **Order level**: the chit is the unit of work. One state, one value, one person answerable.
   * `lines` — **Line level**: each line is the unit, with its own assignee, parts, cost and state.
   *
   * ⭐ The names are ERP's, not ours (SAP, Oracle, every dealer system): the distinction is the ATOM OF WORK,
   * and it is the same distinction in a workshop, a kitchen and a trading desk. The stored value never changes
   * when a label does.
   *
   * ⚠️ THIS IS A DEFAULT, NOT THE RECORD. A chit is STAMPED with the design when it is created, and keeps it
   * for life — *"so we avoid complication of moving from one record type to another"*. Changing this setting
   * decides how the NEXT job reads, never how an existing one does.
   *
   * ⚠️ And it governs the INTERPRETATION only, which is the receiving end's business — Athi, same day: *"the
   * customer copy and supplier copy should be the same, but the interpretation can be in another tab."* The
   * customer's request reads identically whichever design the workshop chose.
   */
  detail_design:     { type: 'enum',   options: ['chit', 'lines'], def: 'chit' },
  /**
   * ⚠️ `received`, NOT `both` — THIS DEFAULT DISAGREED WITH THE ENGINE FOR MONTHS (Athi's call, 2026-08-16).
   *
   * `routes/chits.js:302` has always done `|| 'received'`. This file presented `both`. So an entity that never
   * opened Settings was TOLD one thing and BEHAVED as another — the worst kind of policy bug, because the screen
   * is the only place anyone would look to find out, and it was the wrong place.
   *
   * The engine's reasoning is the stronger one and is why it won: filing a self-chit in Order asserts *"I sent
   * this to a counterparty"*, which is false. A self-chit is work you gave yourself.
   *
   * ⚠️ ONLY THE UNSET DEFAULT MOVES. An entity that explicitly saved `both` keeps it — the column is read first
   * and this value is the fallback. Nothing is rewritten.
   */
  self_copy_pref:    { type: 'enum',   options: ['both', 'sent', 'received'], def: 'received', column: 'self_copy_pref' },
  /**
   * ⭐⭐ DOES A COUNTED ZERO MEAN "NOT AVAILABLE"? OFF BY DEFAULT, AND THE DEFAULT IS THE POINT.
   *
   * Athi, 2026-09-01: *"zero doesn't mean that stock not available, there are business no stock gets updated…
   * ours is not an inventory system, so we don't handle the quantity, so explicit marker is best."*
   *
   * ⚠️ THAT IS THE WHOLE ARGUMENT FOR `off`. CB does not run stock — `item_data.avail.qty` is a FEED somebody
   * else keeps, and for most businesses nobody keeps it at all. Deriving availability from a number nothing
   * maintains would retire live products the moment a count went stale, and the screen would give no reason.
   * So the explicit flag stays the source of truth, exactly as `itemstatus.js` argues: *a shelf can be empty
   * without the product being retired.*
   *
   * ⭐ AND FOR THE BUSINESSES THAT DO KEEP COUNTS, this says so — his *"if possible we can set a flag to confirm
   * does zero means product unavailable"*. Turning it on means: a line whose feed says 0 is not OFFERED.
   *
   * ⚠️ IT HIDES, IT NEVER STAMPS. The status column is untouched, so nothing is silently retired and nothing has
   * to be manually put back: the product returns the instant the count does. A derived answer that writes itself
   * into stored state is how a temporary condition becomes a permanent one nobody remembers causing.
   *
   * ⚠️ AND ONLY A REAL ZERO COUNTS. An ABSENT feed is unknown, not empty — the same distinction the catalogue
   * screen draws between "0" and "N/A". Treating "nobody said" as "none left" would take out every shop that
   * has never reported stock, which is most of them.
   */
  qty_zero_hides:    { type: 'enum',   options: ['off', 'on'], def: 'off' },
  chit_expiry_days:  { type: 'number', def: 0, min: 0, max: 3650 },
  retention_days:    { type: 'number', def: 0, min: 0, max: 3650 },
  /**
   * ⚠️⚠️ THE RECEIVER'S FLOOR — how long I keep MY OWN copy, regardless of what the sender asked for.
   *
   * Found during a spoofing sweep (Athi: *"if there a chance to change the setting in the middle then we have to
   * guard those… otherwise spoofing will be possible"*). Retention is stored PER COPY, so without a floor owned
   * by the copy's owner, "how long I keep my own records" is decided by whoever sent them.
   *
   * ⚠️ THE DEFAULT IS 90 BECAUSE THAT IS ALREADY THE SCHEMA'S DEFAULT (b105: `retention_expires_at` DEFAULT
   * now() + 90 days). It is not a new policy chosen here — it is the existing behaviour made explicit and
   * governable, so turning per-copy retention on cannot shorten anyone's retention on the day it ships.
   *
   * ⚠️ IT ONLY EVER RAISES. `MAX(requested, floor)` — a counterparty may ask you to keep a record LONGER than
   * your floor and you will; they can never persuade your copy to disappear sooner. A floor that could be
   * argued downwards is not a floor.
   */
  retention_floor_days: { type: 'number', def: 90, min: 0, max: 3650 },
  /**
   * ⭐ THE UNITS THIS ENTITY ACTUALLY TRADES IN (Athi, 2026-08-17: *"here we have to give selection as well, so
   * what has been selected will be used in the catalogue"*).
   *
   * `CBCatalogue.UNITS` is the MAXIMUM the platform knows; this is the entity's slice of it. Same shape as
   * METHOD_MODELS narrowing order models: declare once, and every picker downstream offers only that.
   *
   * ⚠️ FAILS OPEN. The default is EVERY unit, so an entity that has never chosen sees exactly what it sees
   * today. A stored empty list is refused by coerce() — an accidental clear-all must not empty every unit
   * dropdown in the product form with nothing on screen to explain it.
   * ⚠️ NARROWS WHAT IS OFFERED, NEVER WHAT IS STORED. A product already saved in `barrel` keeps its barrel even
   * if barrel is later deselected — the same rule as a retired category. Deselecting is "stop offering this",
   * not "rewrite history".
   */
  units: { type: 'set', def: ['kg','gram','litre','ml','piece','count','unit','pack','box','dozen','tonne','barrel','metre','sqft','roll','bunch'],
           options: ['kg','gram','litre','ml','piece','count','unit','pack','box','dozen','tonne','barrel','metre','sqft','roll','bunch'], max: 40 },
  /**
   * ⭐ THE REST OF THE CATALOGUE VOCABULARY THIS ENTITY USES (Athi, 2026-08-17: *"also the check box wherever
   * required, so those only can be used in the catalogue"*). Same contract as `units` throughout: the registry
   * in code is the MAXIMUM, this is the entity's slice, every picker downstream offers only the slice, the
   * default is everything, and an empty set is refused.
   *
   * ⚠️ NOT EVERY REGISTRY GETS ONE, and the omissions are deliberate:
   *   · `method`      — ONE selling method per catalogue. That is a single choice, already made in the wizard
   *                     and editable under Storefront; a set would imply you can have several, which you cannot.
   *   · `ordermodel`  — already narrowed by the selling method (METHOD_MODELS, backlog 18). A second, independent
   *                     narrowing would let the two disagree, and nothing on screen would say which one won.
   * Offering a checkbox that cannot mean anything is worse than offering none.
   */
  /**
   * ⭐ THE LANGUAGES THIS ENTITY WORKS IN (Athi, 2026-08-17: *"language picker comes from the entity settings…
   * example, english default and tamil, hindi, or malayalam, hindi"*). English plus its own two or three.
   *
   * ⚠️⚠️ THIS GOVERNS WHAT IS SHOWN, NEVER WHAT IS UNDERSTOOD. `lib/units.js normUnit()` folds spellings across
   * EVERY language regardless of this setting, and must keep doing so — otherwise setting the screen to Hindi
   * would silently stop `கிலோ` resolving, a WhatsApp message would arrive looking fine, and its quantity would
   * quietly fail to total. A display preference must never become a parsing rule.
   * ⚠️ ISO 639-1, matching lib/units.js LANGS.
   */
  languages:    { type: 'set', max: 27,
                  options: ['en','ta','hi','ml','te','kn','mr','gu','bn','pa','or','ur',
                            'ar','zh','es','fr','de','pt','ru','it','nl','tr','id','vi','th','ja','ko'],
                  def:     ['en'] },
  datatypes:    { type: 'set', max: 40,
                  options: ['text','longtext','number','integer','boolean','date','datetime','choice','multichoice','range','money','quantity','unit','standard_ref','external_ref','media','url','geo','formula','composition'],
                  def:     ['text','longtext','number','integer','boolean','date','datetime','choice','multichoice','range','money','quantity','unit','standard_ref','external_ref','media','url','geo','formula','composition'] },
  pricing_models: { type: 'set', max: 20, options: ['fixed','range','tiered','market-ref','negotiated'],
                                          def:     ['fixed','range','tiered','market-ref','negotiated'] },
  price_origins:  { type: 'set', max: 20, options: ['url','publisher','exchange','system','contract','manual'],
                                          def:     ['url','publisher','exchange','system','contract','manual'] },
  offer_kinds:    { type: 'set', max: 20, options: ['percent_off','amount_off','tier_price','threshold','buy_x_get_y','shipping','price_range'],
                                          def:     ['percent_off','amount_off','tier_price','threshold','buy_x_get_y','shipping','price_range'] },
  facets:         { type: 'set', max: 20, options: ['identity','variants','units','standards','media','bom','pricing','loop','feedback'],
                                          def:     ['identity','variants','units','standards','media','bom','pricing','loop','feedback'] },
  /**
   * ⚠️ "OVERDUE" IS A POLICY, NOT A CONSTANT IN A REPORT. Folder metrics and the counterparty scorecard both need
   * to say how old an OPEN chit must be before it counts as late. Baked into the query it is a rule nobody can see
   * or change; declared here it is one number, visible in Settings, and both surfaces read the same one.
   */
  overdue_days:      { type: 'number', def: 7, min: 1, max: 365 },
  /**
   * ⚠️ THE TOLERANCE THRESHOLD — from the procurement three-way-match research. Within this variance a mismatch is
   * absorbed; beyond it, it is an exception worth a human. It is the honest answer to "when does a mismatch become
   * a dispute?", and because it decides that, it MUST be declared and governed rather than hard-coded — which is
   * exactly what every AP system means by a tolerance rule.
   *
   * ⚠️ DECLARED BUT NOT YET ENFORCED. Nothing reads it to raise an exception; the matching engine does not exist.
   * It is here so the number has one home when it does — and it is reported as unenforced rather than implied.
   */
  match_tolerance_pct: { type: 'number', def: 2, min: 0, max: 50 },
};
// Platform-bound: presented so the cascade is visible, never writable. A relaxable USP is not a USP.
const BOUND = { dispute_scope: 'per-party' };

const defaults = () => {
  const o = {};
  for (const k of Object.keys(FLAGS)) o[k] = FLAGS[k].def;
  return Object.assign(o, BOUND);
};

function coerce(key, v) {
  const f = FLAGS[key];
  if (!f) return undefined;                                    // not in the schema → does not exist
  if (f.type === 'enum') return f.options.includes(String(v)) ? String(v) : undefined;
  if (f.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(f.min, Math.min(f.max, Math.trunc(n)));
  }
  /**
   * ⚠️ A SET IS A CHOICE FROM A FIXED LIST, NOT FREE TEXT. Every member is checked against `options`, so a
   * junk value cannot be stored and later handed to a picker as if it were a real unit.
   * ⚠️ AN EMPTY ARRAY IS REFUSED (returns undefined → the default stands). "I trade in nothing" is never what
   * someone means; it is what an accidental clear-all looks like, and honouring it would empty every unit
   * dropdown in the product form with no way to tell why.
   */
  if (f.type === 'set') {
    if (!Array.isArray(v)) return undefined;
    const cleaned = v.map((x) => String(x)).filter((x) => f.options.includes(x));
    const uniq = [...new Set(cleaned)];
    return uniq.length ? uniq.slice(0, f.max || 200) : undefined;
  }
  return undefined;
}

// Read the effective flags. ⚠️ Never throws on a missing column: pre-b130 it answers the same defaults the code
// used before b130 existed, so an unmigrated environment behaves exactly as it did rather than 500ing on settings.
async function get(entity_id) {
  const out = defaults();
  try {
    const r = await query('SELECT policy_flags, self_copy_pref FROM identities WHERE identity_id = $1', [entity_id]);
    const row = r.rows[0] || {};
    const stored = row.policy_flags || {};
    for (const k of Object.keys(FLAGS)) {
      if (FLAGS[k].column) continue;                           // proxied below, not read from jsonb
      const v = coerce(k, stored[k]);
      if (v !== undefined) out[k] = v;
    }
    if (row.self_copy_pref) out.self_copy_pref = row.self_copy_pref;
    out._migrated = true;
  } catch (e) {
    if (!(e && e.code === '42703')) throw e;                   // 42703 = pre-b130; anything else is a real fault
    try {                                                      // the proxied column predates b130 and still answers
      const r2 = await query('SELECT self_copy_pref FROM identities WHERE identity_id = $1', [entity_id]);
      if (r2.rows[0] && r2.rows[0].self_copy_pref) out.self_copy_pref = r2.rows[0].self_copy_pref;
    } catch (_) {}
    out._migrated = false;
  }
  return out;
}

/**
 * Apply a patch. Returns the effective flags after the write.
 *
 * ⚠️ AN UNMIGRATED ENVIRONMENT REFUSES THE WRITE RATHER THAN SWALLOWING IT. The whole reason this file exists is
 * that the old card reported success and stored nothing. Answering 200 to a write that cannot land would rebuild
 * exactly that, one layer lower.
 */
async function set(entity_id, patch) {
  const clean = {};
  let proxied = null;
  for (const [k, raw] of Object.entries(patch || {})) {
    if (k in BOUND) { const e = new Error(k + ' is platform-bound and cannot be changed'); e.status = 400; throw e; }
    const v = coerce(k, raw);
    if (v === undefined) { const e = new Error('Unknown or invalid policy flag: ' + k); e.status = 400; throw e; }
    if (FLAGS[k].column) proxied = { column: FLAGS[k].column, value: v }; else clean[k] = v;
  }
  if (proxied) await query(`UPDATE identities SET ${proxied.column} = $1 WHERE identity_id = $2`, [proxied.value, entity_id]);
  if (Object.keys(clean).length) {
    try {
      // Merge, never replace: a PATCH of one flag must not blank the others.
      await query(`UPDATE identities SET policy_flags = COALESCE(policy_flags,'{}'::jsonb) || $1::jsonb WHERE identity_id = $2`,
        [JSON.stringify(clean), entity_id]);
    } catch (e) {
      if (e && e.code === '42703') { const err = new Error('Policy flags are not migrated on this environment (b130).'); err.status = 503; throw err; }
      throw e;
    }
  }
  return get(entity_id);
}

module.exports = { FLAGS, BOUND, defaults, get, set };
