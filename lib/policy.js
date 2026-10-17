// lib/policy.js — THE per-entity policy flags, server-side and real (b130).   CARD 28-platform-and-operations/policy
// FLOW  FLAGS (the whitelist) → get / read → coerce → set (validate · patch · proxied column) → schemaFor (the pack's words)
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
const logger = require('./logger');

/**
 * ⚠️ `trade_side` — AN ENTITY IS CREATED FOR A PURPOSE. Athi, 2026-08-09: *"we are creating entity for a purpose,
 * sell and purchase never been the same entity. while testing we are trying to test all the possibility in the
 * same business, so for us it seems the same entity will do everything, but that is not going to be the case."*
 *
 * That is why this is an ENTITY setting and not the per-message toggle I first built. A catalogue price is a
 * SELL-SIDE price: right for a shop taking an order, wrong for a factory receiving milk, where it would price an
 * inbound supply notice off what the factory sells at. Which one an entity is does not change message to message.
 */
const SHOWCASE_TEMPLATES = require('../data/pages.json').pages.filter((r) => r.name.startsWith('showcase.')).map((r) => require('./versionref').format(r.name, r.version));   /* the one composer of thing@version (namespace guard) */
const FLAGS = {
  /* S2 (2026-10-10) — THE SHOWCASE TEMPLATE the public shop page wears (REQUIREMENT "a template collection"). One of the registered
     showcase.<vertical>.<template>@1.0 rows in data/pages.json (the enum is DERIVED from it — a new template is one registry row, not a code
     change here); `showcase_sections` is the mix: a subset of that template's sections (an empty list is refused — the template's own stands).
     Read by lib/catalogue-view → shop.showcase; the owner sets it in Settings › Policy. Stored in policy_flags: NO MIGRATION. */
  showcase_template: { type: 'enum', options: SHOWCASE_TEMPLATES, def: SHOWCASE_TEMPLATES[0] },
  showcase_sections: { type: 'set', options: ['strip', 'facts', 'find', 'gallery', 'menu', 'specs', 'services', 'found'], max: 8, def: [] },
  trade_side:        { type: 'enum',   options: ['sell', 'receive'], def: 'sell' },
  /* 2026-09-06 — the chit's Summary shows clearances + commercial cover only when the trade wants them (Athi: "not useful for all trades") */
  trade_cover:       { type: 'enum',   options: ['off', 'on'], def: 'off' },
  /* 2026-09-06 — when a connector books an order (Athi: "there must be some trigger to be allowed to go to Tally, from the task") */
  books_at:          { type: 'enum',   options: ['received', 'accepted', 'completed', 'manual'], def: 'accepted' },
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
  /**
   * ⭐⭐ HOW MUCH DIFFERENCE IS NOT A DISPUTE (2026-09-08). Loose goods do not arrive to the gram: moisture, dust and the weighbridge
   * move a lorry of rice by a few kilos, and a counter that called every one of those a shortage would teach the shop to ignore the
   * word. So a trade sets, once, what it will absorb — and everything outside it is named.
   *
   * ⚠️ IN BASIS POINTS, BECAUSE A POLICY NUMBER IS AN INTEGER. 50 = 0.50%. The flag type truncates, and half a percent stored as
   * "0" would silently mean no tolerance at all — the failure would look like the feature was never built.
   * ⚠️ A RATE DIFFERENCE DEFAULTS TO ZERO AND SHOULD STAY THERE. A quantity can be short by weather; a price cannot. "Close enough"
   * on a rate is a decision somebody made, and it belongs in front of a person.
   */
  /**
   * ⭐⭐ DOES THE SHELF PRICE ALREADY INCLUDE GST? (2026-09-08, Athi: *"tax included in the product / marker?"*)
   *
   * India's retail norm is INCLUSIVE — the price on the packet is what the customer pays, and the tax is split out of it for the
   * invoice. That is what the counter has always done, and for a shop that prices ex-tax it was silently wrong by the tax amount on
   * every bill. It was an assumption; it is a question now.
   * ⚠️ THE DEFAULT STAYS INCLUSIVE, because that is what almost every shop here means by "price" — but it is now visible, said in
   * words on the counter's health panel, rather than buried in a comment.
   */
  /* ⭐ TILL-B2 (2026-10-17): UNSET → THE COUNTRY'S CONVENTION (packKey → pack.tax.prices_include_tax, engines v1.65.0): a US shelf price excludes sales
     tax ('no'); India, Australia, the UAE, Singapore, Japan include it; Malaysia leaves it to the shop (null → def). flagOf / read() apply it. */
  price_includes_tax: { type: 'enum', options: ['yes', 'no'], def: 'yes', packKey: 'prices_include_tax' },
  /* ⭐ SET-WALK1 · W28: the WORDS for big numbers on a bill — "twelve lakh" or "1.2 million". The grouping of the figure itself is the currency's
     (CBLocale.MONEY_LOCALE: ₹12,34,567 · A$1,234,567 — not a choice); the words are the shop's. 'pack' = what the pack's money does (INR lakh, else
     million). Edited in CB Settings › Country (one place; no `ui` on purpose, so the Policy list does not show it a second time). */
  number_words:      { type: 'enum', options: ['pack', 'lakh', 'million'], def: 'pack' },
  tol_weight_bp:     { type: 'number', def: 50, min: 0, max: 2000 },   /* loose / weighed goods — 0.50% */
  tol_count_units:   { type: 'number', def: 0,  min: 0, max: 100 },    /* packed goods: a packet is a packet */
  tol_rate_bp:       { type: 'number', def: 0,  min: 0, max: 2000 },   /* the rate against the order */
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
   * ⭐⭐⭐ WHAT EACH OF THOSE UNITS ALLOWS — Athi, 2026-09-12: *"we have selection, what are the units applied for
   * this entity. for each entity we can set decimal allowed, if so tollerance and min qty. that will be
   * perfect. and each product obeys that."*
   *
   * Three answers per unit, and the first is the gate:
   *   decimals   may this unit be halved at all
   *   tol        how far above a whole number still counts as that whole number   (only if decimals)
   *   min_qty    the quantity from which that rounding applies at all             (only if decimals)
   *
   * ⚠️⚠️ THIS IS NOT THE TOLERANCE ALREADY IN THIS FILE. `tol_weight_bp` (2026-09-08) answers *"ordered 1000 kg,
   * 998 arrived — is that a dispute?"* and is a PERCENTAGE, because a lorry's variance scales with the lorry.
   * This one answers *"the scale reads 1.010 — what goes on the bill?"* and is FLAT, because ten grams is ten
   * grams whether the sale is one kilo or one tonne. Two questions that sound alike and must not be merged;
   * the screens name them apart — "Round to the nearest whole" here, "tolerance" there.
   *
   * ⚠️ MIN_QTY IS WHAT MAKES A FLAT MARGIN SAFE. Ten grams on a kilo is 1%; the same ten grams on a fifty-gram
   * sale is 20%. Below it, a number means itself exactly.
   *
   * ⚠️⚠️ A COUNT CANNOT BE HALF, and that is a rule rather than a preference (Athi: *"no, the count cannot be
   * half"*). Rows for piece · count · unit · dozen · pack · box · bunch · roll are accepted into storage but the
   * cart refuses a fraction on them regardless — a setting the data can hold but the world cannot is how a bill
   * ends up reading 2.5 boxes. The screen does not offer the switch for those units at all.
   */
  unit_rules: { type: 'rules', def: {},
                keys: ['kg','gram','litre','ml','piece','count','unit','pack','box','dozen','tonne','barrel','metre','sqft','roll','bunch'] },
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
  /**
   * ⭐ WHICH OUTSIDE SYSTEMS THIS ACCOUNT ACTUALLY RUNS (2026-09-07). Settings › Integrations › Connectors shows these first and folds
   * the rest away — the catalogue grows, and a shop that runs Tally should not read four cards to find it.
   * ⚠️ IT CONNECTS NOTHING. A connector carries data because a kit is running and approved, never because of a tick here.
   * ⚠️ 'none' IS THE SENTINEL for "I unticked them all": an empty set is refused by coerce (an accidental clear-all must not read as a
   * deliberate choice), so the screen stores ['none'] and treats it as no preference — every connector shown.
   */
  connectors_in_use: { type: 'set', max: 12, options: ['none', 'tally', 'zoho', 'csv', 'gofrugal'], def: [] },
  /**
   * ⭐⭐ WHO OWNS WHICH STREAM (2026-09-07). An account may run several connectors — a POS for stock, Tally for the books, a CRM for
   * parties — but a STREAM belongs to exactly one of them, or the same order becomes a voucher in two ledgers and nobody can say
   * which is the record. The map is { stream: kit_id }; the first connector that carries a stream claims it on its heartbeat, so an
   * account with one system is never asked. Settings › Integrations is where a migration hands a stream over.
   * ⚠️ NOT A LIST OF WHAT EXISTS — a stream with no owner simply has no connector carrying it yet.
   */
  stream_owner: { type: 'map', keys: ['products', 'stock', 'profile', 'order', 'purchase', 'receipt', 'party'], def: {} },
  /**
   * ⚠️ WHEN AN ORDER THAT SHOULD BE IN THE BOOKS COUNTS AS LATE (Athi, 2026-09-07: "do we have a mechanism to check if not posted
   * before the next day?"). Hours from the moment the trigger released it — not from when it arrived, because an order waiting for
   * acceptance is not late, it is waiting. Reconciliation counts anything past this as overdue and says so in one place.
   */
  books_overdue_hours: { type: 'number', def: 12, min: 1, max: 720 },
  /**
   * ⭐ WHEN LEVEL 2 QUICK-KEY STATE (a counter's own active groups, sold-out items) CLEARS ITSELF. Athi,
   * 2026-09-18, decision 2 of the quick-keys handoff's open questions: *"keep it as a choice in settings"* —
   * not the doc's own hardcoded "shift close" default.
   *
   * ⚠️ 'shift_close' HAS NO EFFECT YET. There is no shift/clock-in concept anywhere in this codebase — till.html's
   * existing Level 2 sold-out ([TILL-28]) already resets on `business_day` (its own bizDay(), the counter's
   * day-roll hour) and nothing else exists to close against. The option is here so Settings can offer the
   * choice honestly (and so a future shift feature has something to attach to) without pretending it works
   * today. Until shifts exist, 'shift_close' behaves exactly like 'business_day'.
   */
  quick_key_reset_at: { type: 'enum', options: ['business_day', 'shift_close'], def: 'business_day' },
  /**
   * ⭐ WHICH SYSTEM FOLDERS THIS SHOP SHOWS (Athi, 2026-10-01: "enabled or disabled using a checkbox, so it won't unnecessarily
   * fill the task"). { 'B-2100': 'on' | 'off', … } over the inventory's switchable codes (lib/folder-inventory); a code never
   * set keeps the inventory's default. ⚠️ Changed by the OWNER only (routes/folders.js PUT /inventory/:code; the generic
   * PATCH /entities/policy refuses this key from anyone else). Off hides the folder — never brings its bills back into Task.
   */
  /* ⭐ each code: { on, msg } (2026-10-01 — msg: the folder's messaging level, external · internal · none, never above the
     ceiling in lib/folder-inventory); the older 'on'/'off'
     string is still read. Fixed rows (Tasks, Orders, the dispute) are not keys at all — nothing here can switch them. */
  system_folders: { type: 'switches', keys: require('./folder-inventory').INVENTORY.filter((f) => !f.fixed).map((f) => f.code), def: {},
                    may: 'owner', may_why: 'Only the owner may switch folders on or off.' },
  /* M34 (2026-10-08): `books.auto_post` — 'on' lets the nightly sweep POST what it would otherwise only PROPOSE (auto templates, accrual reversals). Absent = OFF:
     nothing posts by itself (DECISIONS). The owner's alone (refusalFor below). Read by lib/books-recurring autoPostOn. */
  books: { type: 'switches', keys: ['auto_post'], def: {}, may: 'owner', may_why: 'Only the owner may let the books post by themselves.' },
};
// Platform-bound: presented so the cascade is visible, never writable. A relaxable USP is not a USP.
const BOUND = { dispute_scope: 'per-party' };
/**
 * ⭐⭐ T2-POLICY (POL1, 2026-10-14) · THE BUSINESS RULES CARD, DEFINED HERE ONCE. Its rows were a second FLAGS table in the web
 * (cap-admin.js POLICY_FLAGS: label · help · level · gov · labels · scale), and the two drifted (self_copy_pref's default was stated
 * three times, two of them wrong). Now each flag carries its own `ui`; GET /entities/policy sends it as `schema[key].ui` and the
 * card paints from that. `order` is the card's row order; `options`, when set, is only the order the choices are SHOWN in.
 * gov: entity (set freely) · chosen (tighten-only) · bound (platform, shown locked). level: who it belongs to, as the card says.
 */
const CARD = {
  trade_side:          { label: 'This entity', level: 'entity', gov: 'entity',
    help: 'SELL — inbound messages are priced from your catalogue where the item matches. RECEIVE — they are not: a catalogue price is what you SELL at, and pricing goods coming IN off it puts a figure on the record nobody agreed.' },
  gst_registration:    { label: 'Tax registration', level: 'entity', gov: 'entity',
    help: 'Whether the shop is registered for tax, and how. The choices and their words come from its country (schemaFor).' },
  books_at:            { label: 'Orders go to the books', level: 'entity', gov: 'entity',
    help: 'When a connector (Tally · Zoho · GoFrugal) books an order as a voucher. received — the moment it arrives. accepted — once you accept it (the usual case). completed — once it is done. manual — only when you press "Send to books" on the Task. The Task always says whether and when it was written.' },
  books_overdue_hours: { label: 'Overdue after (hours)', level: 'entity', gov: 'entity',
    help: 'How long an order released by the trigger may go unbooked before reconciliation calls it overdue. 12 = by the next morning.' },
  /* WALK-REG R48 (2026-10-16 sweep): read by tax-copy · till · chits · catalogue-view, but NO screen could change them — now card rows */
  price_includes_tax:  { label: 'Shelf price includes tax', level: 'entity', gov: 'entity', labels: { yes: 'Includes tax', no: 'Tax added on top' },
    help: 'Includes tax — the price on the shelf is what the customer pays; the bill works the tax out of it. Tax added on top — the bill adds the tax to the price. Applies to new bills only; a bill already made keeps its figures.' },
  overdue_days:        { label: 'Order overdue after (days)', level: 'entity', gov: 'entity', suffix: 'days',
    help: 'How many days an open order may wait before it is shown as overdue in your folders and reports.' },
  qty_zero_hides:      { label: 'Hide items at zero stock', level: 'entity', gov: 'entity', labels: { off: 'Show them', on: 'Hide them' },
    help: 'Hide them — an item with no stock left drops off the counter and the online shop until stock arrives. Show them — it stays, marked sold out.' },
  /* basis points stored, a percentage shown: `scale` renders the human number and the card stores the integer */
  tol_weight_bp:       { label: 'Short delivery allowed (weighed goods)', level: 'entity', gov: 'entity', scale: 100, suffix: '%', step: 0.01,
    help: 'How much less than ordered may arrive on WEIGHED goods before the counter calls it short. 0.50% is the usual figure — moisture, dust and the weighbridge move a lorry by a few kilos. Set 0 to call every gram.' },
  tol_count_units:     { label: 'Short delivery allowed (counted goods)', level: 'entity', gov: 'entity', suffix: 'units',
    help: 'The same question for goods that are COUNTED, in whole units rather than a percentage. 0 is right for almost every shop — a packet is a packet, and one missing is one missing.' },
  tol_rate_bp:         { label: 'Rate difference allowed', level: 'entity', gov: 'entity', scale: 100, suffix: '%', step: 0.01,
    help: 'How far a supplier\'s billed RATE may differ from the order before it is named. ⚠️ Keep this at 0 unless you mean it: a quantity can be short by weather, a price cannot. "Close enough" on a rate is a decision somebody made, and it belongs in front of a person.' },
  trade_cover:         { label: 'Trade cover on chits', level: 'entity', gov: 'entity',
    help: 'ON — the Summary of a chit also shows the supplier clearances and the commercial-cover (FRM) frame. OFF — the financial summary of the cart and the delivery only (most trades).' },
  self_copy_pref:      { label: 'Self-chit copy', level: 'entity', gov: 'entity', options: ['received', 'both', 'sent'],
    labels: { received: 'Task only', both: 'Both Task and Order', sent: 'Order only' }, help: '' },
  detail_design:       { label: 'Detail page', level: 'entity', gov: 'entity', labels: { chit: 'Order level', lines: 'Line level' },
    help: 'Order level — the chit is the unit of work. Line level — each line has its own person, parts and cost. Applies to new chits.' },
  /* AU-WORDS: a 0 is shown as its WORD (`labels[0]`), never "0 days"; retention's word carries the pack's records floor (schemaFor) */
  chit_expiry_days:    { label: 'Chit expiry (days)', level: 'work-pattern', gov: 'chosen', labels: { 0: 'No expiry' }, help: 'How many days a chit stays open before it lapses. No expiry — a chit stays until it is closed.' },
  retention_days:      { label: 'Retention (days)', level: 'entity', gov: 'chosen', labels: { 0: 'Keep' }, help: 'How long a closed chit is kept. Keep — for as long as the law asks; a shorter number never cuts under the records floor.' },
  dispute_scope:       { label: 'Dispute messages', level: 'platform', gov: 'bound', help: 'Set by the platform' },
  quick_key_reset_at:  { label: 'Counter sold-out marks clear', level: 'entity', gov: 'entity',
    labels: { business_day: 'At the day roll', shift_close: 'At shift close' },
    help: 'When a counter\'s sold-out marks on its quick keys clear themselves. At the day roll — the usual case. At shift close works like the day roll until shifts are recorded.' },
};
/* the bound rows are presented too — locked, their platform value as the default (GET /entities/policy sends this as `bound_schema`) */
const BOUND_SCHEMA = { dispute_scope: { type: 'enum', options: ['per-party', 'shared'], def: BOUND.dispute_scope } };
Object.keys(CARD).forEach((k, i) => { (FLAGS[k] || BOUND_SCHEMA[k]).ui = Object.assign({ order: i + 1 }, CARD[k]); });

/**
 * refusalFor(patch, isOwner) → null, or the sentence for a key only the owner may change (FLAGS[k].may === 'owner').
 * ⭐ WHO MAY CHANGE A FLAG IS DATA ON THE FLAG — it was two hard-coded ifs in routes/entities.js PATCH /policy.
 */
function refusalFor(patch, isOwner) {
  if (isOwner) return null;
  for (const k of Object.keys(patch || {})) if (FLAGS[k] && FLAGS[k].may === 'owner') return FLAGS[k].may_why || 'Only the owner may change this.';
  return null;
}
/**
 * ⚠️⚠️ CO3 (2026-10-13) · THE STATUTORY RECORDS FLOOR — under `retention_floor_days`, and no flag can lower it.
 * A copy is a business record, and records law sets a minimum the shop cannot choose away:
 *   IN  Companies Act 2013 s.128(5): eight financial years after the year · CGST s.36: 72 months from the annual-return due date
 *   AU  TAA 1953 Sch 1 s.382-5: 5 years · Corporations Act s.286(2): 7 years
 *   AE  Tax Procedures DL 28/2022: 5 years · Corporate Tax DL 47/2022 Art.56: 7 years after the tax period
 * Counted from the day a copy is minted, the longest of these (IN, a record from the first day of a financial year) is 9 years,
 * so 9 is the ONE floor: every country's law is met without knowing the shop's country or legal form. Per-country precision
 * belongs to the packs (`retentionYears`, engines) — when every pack states it, this may drop to the pack's figure.
 * Read by routes/chits.js `retainDaysFor` (the mint) and lib/retention.js `planRetirement` (the sweep). Proved by tests/records-keeping.test.cjs.
 */
const RECORDS_FLOOR_YEARS = 9;
const RECORDS_FLOOR_DAYS = RECORDS_FLOOR_YEARS * 366;   /* whole leap-safe days: never a day short of nine calendar years */

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
  /**
   * ⚠️ A MAP IS A FIXED SET OF KEYS WITH FREE-ISH VALUES — the keys are the whitelist (a stream we do not have cannot be owned), the
   * values are ids and are shape-checked, never trusted as text that reaches a screen unescaped. An EMPTY map is legitimate, unlike an
   * empty set: "nobody has claimed anything yet" is the state every new account is in.
   */
  /**
   * ⚠️ RULES IS A MAP WHOSE VALUES ARE A DECLARED SHAPE, not ids. Three fields, each clamped: a boolean, and two
   * numbers that cannot be negative or absurd. ⭐ Anything else in the object is DROPPED rather than stored —
   * a policy row is read by the counter and the cart, and a key nobody validated is a key nobody can trust.
   * ⚠️ An empty object is legitimate ("nothing declared yet"), the same as `map`.
   */
  if (f.type === 'rules') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    for (const k of f.keys) {
      const r = v[k];
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
      const row = {};
      if (r.decimals != null) row.decimals = !!r.decimals;
      const num = (x, max) => { const n = Number(x); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : undefined; };
      const tol = num(r.tol, 1000);          /* a band wider than a thousand units is a typo, not a policy */
      const min = num(r.min_qty, 1000000);
      if (tol !== undefined) row.tol = tol;
      if (min !== undefined) row.min_qty = min;
      if (Object.keys(row).length) out[k] = row;
    }
    return out;
  }
  /**
   * ⚠️ SWITCHES: a fixed set of keys, each 'on' | 'off' (the first form) or { on?: boolean, msg?: level }. Anything else
   * in the object is DROPPED, and a key whose value says nothing valid is left out (its default stands).
   */
  if (f.type === 'switches') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    for (const k of f.keys) {
      const raw = v[k];
      if (raw === 'on' || raw === 'off') { out[k] = raw; continue; }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const row = {};
      if (typeof raw.on === 'boolean') row.on = raw.on;
      if (raw.msg === 'external' || raw.msg === 'internal' || raw.msg === 'none') row.msg = raw.msg;
      if (Object.keys(row).length) out[k] = row;
    }
    return out;
  }
  if (f.type === 'map') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    for (const k of f.keys) {
      const raw = v[k]; if (raw == null || raw === '') continue;
      /* control characters out (they belong to no id and break a log line); everything else is the id as we minted it */
      const val = String(raw).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
      if (val) out[k] = val;
    }
    return out;
  }
  return undefined;
}

/**
 * ⭐⭐⭐ [REV-01] THE SAME DEFAULT get() APPLIES, WITHOUT A QUERY — for a caller that already has the raw
 * `policy_flags` jsonb in hand (routes/chits.js and lib/tax-copy.js both already SELECT it, for other
 * fields, in the one query the code around them is proud of not repeating per line — "his 'why do you need
 * another query?'"). A second round trip just to re-read a column already sitting in memory would be the
 * exact query-per-line mistake this codebase has already been burned by once.
 *
 * ⚠️ THIS IS THE FIX FOR: "Every server-side invoice is 18% too high, and it is frozen permanently." Both
 * invoiceFor() callers built their input object by hand and never asked what price_includes_tax was — so it
 * arrived as `undefined`, and `!!undefined` is `false`, taxing a GST-inclusive shelf price as if it were
 * ex-tax. Neither caller was missing a query; they were missing this one line. [[feedback-adopt-dont-reinvent]]
 */
function flagOf(policy_flags, key, country) {
  const f = FLAGS[key];
  if (!f) return undefined;
  const v = coerce(key, (policy_flags || {})[key]);
  return v !== undefined ? v : packDefaultOf(key, country);
}
/**
 * ⭐ TILL-B2: a flag's default for a shop that never set it — the flag's own `def`, or, for a flag with a `packKey`, the shop's COUNTRY
 * convention (pack.tax[packKey]: true → 'yes', false → 'no'; null or no pack → `def`). ONE place: flagOf (every invoice path: tax-copy,
 * services, chits, catalogue-view, the till snapshot) and read() (the settings screen) both answer through here, so the counter and the
 * server never disagree about a US shelf price.
 */
function packDefaultOf(key, country) {
  const flag = FLAGS[key];
  if (!flag.packKey || !country) return flag.def;
  let said = null;
  try { const pack = require('./regulation').packFor(String(country).trim().toUpperCase()); said = pack && pack.tax ? pack.tax[flag.packKey] : null; }
  catch (e) { logger.fellBack('policy packDefaultOf: the pack could not be read — the flag’s own default stands', e); }
  return said === true ? 'yes' : said === false ? 'no' : flag.def;
}

// Read the effective flags — and, for the policy route only, the shop's country in the same trip (AU-WORDS: the schema is worded
// by the country's pack). ⚠️ The chit-send path's SQL is golden (tests/send-golden): get() keeps its exact text; read() adds `country`.
// ⚠️ Never throws on a missing column: pre-b130 it answers the same defaults the code used before b130 existed, so an
// unmigrated environment behaves exactly as it did rather than 500ing on settings.  → { flags, country }
async function readFlags(entity_id, withCountry) {
  const out = defaults();
  const countryCol = withCountry ? ', country' : '';
  try {
    const result = await query('SELECT policy_flags, self_copy_pref' + countryCol + ' FROM identities WHERE identity_id = $1', [entity_id]);
    const row = result.rows[0] || {};
    applyStored(out, row);
    if (withCountry) applyPackDefaults(out, row);
    out._migrated = true;
    return { flags: out, country: row.country || null };
  } catch (e) {
    if (!(e && e.code === '42703')) throw e;                   // 42703 = pre-b130; anything else is a real fault
    const country = await readPreMigration(entity_id, out, countryCol);
    out._migrated = false;
    return { flags: out, country };
  }
}
/** the stored jsonb flags over the defaults (a stored value that does not coerce keeps the default), plus the proxied self-copy column */
function applyStored(out, row) {
  const stored = row.policy_flags || {};
  for (const key of Object.keys(FLAGS)) {
    if (FLAGS[key].column) continue;                           // proxied below, not read from jsonb
    const value = coerce(key, stored[key]);
    if (value !== undefined) out[key] = value;
  }
  if (row.self_copy_pref) out.self_copy_pref = row.self_copy_pref;
}
/** TILL-B2: the flags this shop never set take its country's convention (packDefaultOf) — read() only, which has the country */
function applyPackDefaults(out, row) {
  const stored = row.policy_flags || {};
  for (const key of Object.keys(FLAGS)) {
    if (FLAGS[key].packKey && coerce(key, stored[key]) === undefined) out[key] = packDefaultOf(key, row.country);
  }
}
/** pre-b130 (no policy_flags column): the proxied column still answers; a failed read is logged and the defaults stand → the shop's country, or null */
async function readPreMigration(entity_id, out, countryCol) {
  try {
    const result = await query('SELECT self_copy_pref' + countryCol + ' FROM identities WHERE identity_id = $1', [entity_id]);
    const row = result.rows[0] || {};
    if (row.self_copy_pref) out.self_copy_pref = row.self_copy_pref;
    return row.country || null;
  } catch (e) { logger.fellBack('policy get: the read failed — carried on without it', e); return null; }
}
/** the effective flags alone — every reader but the policy route (the golden SQL text) */
async function get(entity_id) { return (await readFlags(entity_id, false)).flags; }
/** the flags with the shop's country, one trip — GET /entities/policy and the registration-kind check in set() */
async function read(entity_id) { return readFlags(entity_id, true); }

/**
 * AU-WORDS (2026-10-15) · schemaFor(country) → FLAGS as THIS shop's pack words them. The registration row offers only the kinds the
 * pack has (pack-words.registrationKindsFor — the STORED enum is unchanged) under the pack's name for the tax (GST · VAT registration);
 * retention's 0 says the pack's records floor. GET /entities/policy sends it as `schema`; no country → neutral words, never India's.
 */
function schemaFor(country) {
  const words = require('./pack-words');
  const kinds = words.registrationKindsFor(country), said = words.wordsFor(country), keep = words.retentionWordsFor(country);
  const labels = {};
  kinds.forEach((kind) => { labels[kind.key] = kind.label; });
  const registrationUi = Object.assign({}, FLAGS.gst_registration.ui, {
    label: said.registration, options: kinds.map((kind) => kind.key), labels,
    help: kinds.map((kind) => kind.label.toUpperCase() + ' — ' + kind.help).join(' '),
  });
  const retentionUi = Object.assign({}, FLAGS.retention_days.ui, { labels: { 0: keep.words } });
  return Object.assign({}, FLAGS, {
    gst_registration: Object.assign({}, FLAGS.gst_registration, { ui: registrationUi }),
    retention_days: Object.assign({}, FLAGS.retention_days, { ui: retentionUi }),
  });
}
const REG_KIND_NOT_OFFERED = 'REG_KIND_NOT_OFFERED';
/** the sentence when a patch names a registration kind the shop's pack does not offer (a counter or connector might send India's) */
function kindRefusal(country, kind) {
  const offered = require('./pack-words').registrationKindsFor(country);
  if (offered.some((choice) => choice.key === kind)) return null;
  return 'That registration kind is not one this country has. Choose: ' + offered.map((choice) => choice.label).join(' · ') + '.';
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
  /* AU-WORDS: a registration kind the shop's pack does not offer is refused with the pack's choices (one read — only when the patch names it) */
  if (clean.gst_registration !== undefined) {
    const refusal = kindRefusal((await read(entity_id)).country, clean.gst_registration);
    if (refusal) { const e = new Error(refusal); e.status = 400; e.code = REG_KIND_NOT_OFFERED; throw e; }
  }
  if (proxied) await query(`UPDATE identities SET ${proxied.column} = $1 WHERE identity_id = $2`, [proxied.value, entity_id]);
  if (Object.keys(clean).length) {
    try {
      // Merge, never replace: a PATCH of one flag must not blank the others.
      await patchKey(null, entity_id, [], clean, { op: 'merge' });
    } catch (e) {
      if (e && e.code === '42703') { const err = new Error('Policy flags are not migrated on this environment (b130).'); err.status = 503; throw err; }
      throw e;
    }
  }
  return get(entity_id);
}

/**
 * ⭐⭐⭐ T2-POLICY (POL1, 2026-10-14) · patchSql / patchKey — THE ONE WRITER OF identities.policy_flags.
 * Twenty-two statements in ten files each wrote this column with their own jsonb_set / || / #- (keys, counters, devices,
 * network_*, profile_provenance, storefront_exposure, gst_registration …) — one of them (country-setup) a FLAGS key with no
 * coerce. Now every write is one statement built here; scripts/guards.cjs (policy-one-writer) fails on any other.
 *   path   [] = the top level · ['a', 'b', …] = a key inside it (missing parents are created as {} unless opts.parents === false)
 *   opts.op  'set' (default)  the value at path
 *            'merge'          shallow jsonb `||` of an object into the object at path (a null VALUE is stored, as every writer did)
 *            'remove'         the key at path removed
 *            'merge_item'     the array at path: the element whose [opts.match[0]] = opts.match[1] gets `|| value` (one statement,
 *                             so two concurrent writers stack instead of overwriting — keys.patchKey's reason)
 *   opts.when  { path, equals } | { path, exists: true } — the write lands only then (patchKey's RETURNING says whether it did)
 * A FLAGS key is coerced (an invalid value is a 400, as set() says); a column-proxied flag or a BOUND key is refused here.
 * patchSql(path, value, opts, at) → { sql: 'policy_flags = …', params } with placeholders from $at — for a caller that writes other
 * columns in the SAME statement (country-setup), so no route gains a trip. patchKey(db|null, entity_id, path, value, opts) runs it
 * alone (db = the caller's transaction client; null = the pool) → the pg result.
 */
function flagGate_(path, value, op) {
  const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };
  const tops = path.length ? [[path[0], value]] : Object.entries(value || {});
  for (const [k, v] of tops) {
    if (k in BOUND) throw bad(k + ' is platform-bound and cannot be changed');
    if (!FLAGS[k]) continue;                                   /* internal state (api_keys, counters, …) — not a flag */
    if (FLAGS[k].column) throw bad(k + ' lives in its own column — policy.set writes it');
    if (path.length > 1 || op === 'merge_item') throw bad(k + ' is a policy flag — it is written whole, through policy.set');
    if (op === 'remove') continue;
    if (op === 'merge' && path.length) throw bad(k + ' is a policy flag — it is written whole, through policy.set');
    if (coerce(k, v) === undefined) throw bad('Unknown or invalid policy flag: ' + k);
  }
  if (!path.length) return Object.assign({}, ...tops.map(([k, v]) => ({ [k]: FLAGS[k] ? coerce(k, v) : v })));
  return path.length === 1 && FLAGS[path[0]] && op !== 'remove' ? coerce(path[0], value) : value;
}
function patchSql(path, value, opts, at) {
  const o = opts || {}; const op = o.op || 'set'; const p = (path || []).map(String);
  let n = at || 1; const params = [];
  const arg = (v) => { params.push(v); return '$' + (n++); };
  const v = flagGate_(p, value, op);
  if (!p.length) {
    if (op !== 'merge') throw new Error('policy.patchSql: the top level is only ever merged');
    return { sql: `policy_flags = COALESCE(policy_flags,'{}'::jsonb) || ${arg(JSON.stringify(v))}::jsonb`, params };
  }
  const P = arg(p) + '::text[]';
  if (op === 'remove') return { sql: `policy_flags = policy_flags #- ${P}`, params };
  let base = `COALESCE(policy_flags, '{}'::jsonb)`;
  if (o.parents === false) base = 'policy_flags';
  else for (let k = 1; k < p.length; k++) base = `jsonb_set(${base}, (${P})[1:${k}], COALESCE(policy_flags #> (${P})[1:${k}], '{}'::jsonb))`;
  let val;
  if (op === 'set') val = `${arg(JSON.stringify(v === undefined ? null : v))}::jsonb`;
  else if (op === 'merge') val = `COALESCE(policy_flags #> ${P}, '{}'::jsonb) || ${arg(JSON.stringify(v || {}))}::jsonb`;
  else if (op === 'merge_item') {
    const [field, equals] = o.match || [];
    val = `COALESCE((SELECT jsonb_agg(CASE WHEN k->>${arg(String(field))}::text = ${arg(String(equals))}::text THEN k || ${arg(JSON.stringify(v || {}))}::jsonb ELSE k END)
             FROM jsonb_array_elements(COALESCE(policy_flags #> ${P}, '[]'::jsonb)) k), '[]'::jsonb)`;
  } else throw new Error('policy.patchSql: unknown op ' + op);
  return { sql: `policy_flags = jsonb_set(${base}, ${P}, ${val}${o.parents === false ? ', true' : ''})`, params };
}
async function patchKey(db, entity_id, path, value, opts) {
  const o = opts || {};
  const f = patchSql(path, value, o, 1);
  const params = f.params.slice(); const arg = (x) => { params.push(x); return '$' + params.length; };
  let where = `identity_id = ${arg(entity_id)}`;
  if (o.when && Array.isArray(o.when.path)) {
    const wp = arg(o.when.path.map(String)) + '::text[]';
    where += o.when.exists ? ` AND policy_flags #> ${wp} IS NOT NULL` : ` AND policy_flags #>> ${wp} = ${arg(String(o.when.equals))}::text`;
  }
  const run = db && typeof db.query === 'function' ? db.query.bind(db) : query;
  return run(`UPDATE identities SET ${f.sql} WHERE ${where} RETURNING identity_id`, params);
}

module.exports = { FLAGS, BOUND, BOUND_SCHEMA, RECORDS_FLOOR_YEARS, RECORDS_FLOOR_DAYS, REG_KIND_NOT_OFFERED, defaults, get, read, schemaFor, kindRefusal, set, coerce, flagOf, packDefaultOf, refusalFor, patchSql, patchKey };   /* coerce is exported for tests/policy-defaults.test.js — a value rule nobody can exercise is a value rule nobody notices breaking */
