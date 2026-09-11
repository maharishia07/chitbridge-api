'use strict';
/**
 * tests/engine-manifest.js — THE DECLARATION. Which module is engine, which is someone else's idea, which is
 * plumbing. Extracted from engine-boundary.test.js on 2026-08-22, unchanged.
 *
 * ⭐⭐ IT MOVED BECAUSE IT GREW A SECOND READER. The platform inventory (C:devinventory.cjs) needs exactly
 * these lists, and copying them there would have created the thing this codebase refuses everywhere else — two
 * sets of truth that agree on the day they are written and quietly disagree forever after. A classification
 * that disagrees with itself is worse than none, because both copies still look authoritative.
 *
 * ⚠️ So this file DECLARES and nothing else. It runs no test and reads no filesystem; engine-boundary.test.js
 * enforces it, inventory.cjs reports it. Add a lib/ file to a list here and both follow.
 */

const TIER_A = [
  'lib/order-input.js',      // the declaration: 7 presets, schema fragment, documents, sources
  'lib/form-handshake.js',   // document → field, with provenance; coverage() at design time
  'lib/money.js',            // { amount, currency }; never converts
  /* ⚠⚠ THE COUNTERPART OF money.js, AND THE REASON IT IS A SEPARATE FILE. Athi, 2026-09-11: *"the reward
     point also one of the currency, correct?"* — and then the part that decided the design: *"my only view is
     it gets guarded."* A symbol cannot guard anything; strings concatenate. What guards money here is its
     SHAPE, so points get a deliberately DIFFERENT shape — { points, programme } — and each refuses the other.
     ⚠ The hole is narrow and real: money's CODE_RE is /^[A-Z]{3}$/, so { amount: 50, currency: 'PTS' } would
     pass every check money makes and be summed with rupees. One file holding both types would make that a typo
     away at all times. Zero dependencies, pure predicates — Tier A. */
  'lib/points.js',           // { points, programme }; never money, never converts
  /* ⭐⭐ THE FOURTH OF THE SAME FAMILY, and the one Athi asked for by name, 2026-09-11: *"first set a
     country and see how that can be globalised"*. docnumber.js holds what a document NUMBER may look like,
     per jurisdiction — the 16-character cap, the April–March year and the annual reset are ALL India GST
     rules, and every one of them was about to be written into the counter where nothing would announce it.
     ⚠ Every rule set carries `verified`. India is studied; everything else is a permissive default that
     enforces only what all jurisdictions agree on (unique + sequential) and REFUSES TO INVENT the rest — a
     guessed limit would refuse a number that is perfectly legal where the shop actually is. Tier A. */
  'lib/docnumber.js',        // what a document number may look like, per country; never guesses an unstudied rule
  /* ⚠️ THE SIBLING OF money.js, AND FOR THE SAME REASON: it never converts. units.js folds spellings of one unit
     onto one name (கிலோ → kg) and is forbidden from ever relating two DIFFERENT units (crate → kg), because that
     needs a factor and a factor is entity-specific. A rename is engine vocabulary; a conversion is a declaration.
     Zero dependencies, pure data + one fold — Tier A. */
  'lib/units.js',            // unit aliases: one unit, many spellings; never converts. Vendored to app/units.js; the connector maps by UN/ECE Rec 20 code.
  /* ⚠️ THE THIRD OF THE SAME FAMILY (2026-09-10). Athi: *"can we convert the country, currency, ie the
     localisation as a capability so it can be used in any product?"* — so where a party is, and what a shop there
     can be PAID by, moved out of lib/profile.js. A module that opens a vault cannot be picked up by another
     product; this one has no database, no network and no state, which is what makes it shippable.
     Like its two siblings it NEVER CONVERTS: it says which country and which schemes, never what a currency is
     worth. The governed facts per region stay in the region_layer table (lib/regional.js, Tier B), and formatting
     stays with CBLocale — collapsing those in would cost this file its purity and with it its portability. */
  'lib/jurisdiction.js',     // country → what a party may be paid by, as (scheme, value); pure, vendorable
  /* ⚠️ THE FOURTH, AND IT NEVER CONVERTS EITHER (2026-09-10). Athi: *"how anyone knows the value of the rewards
     and its interpretation."* rewards.js turns a BALANCE plus a declared programme into a sentence — worth this
     much off, or that item, or 180 more for the next one. It holds no balance (a liability belongs in a ledger,
     not a module), invents no worth (a guessed conversion is a number a shop would be held to), and formats no
     money (it takes ctx.money, the shape the offers engine already uses). */
  'lib/rewards.js',          // what a reward point is worth, said in words; pure, holds nothing
  /* ⚠️ TIER A AND IT MATTERS THAT IT IS. inventory.js decides what a movement does to a balance — the weighted
     average, the sign a reason implies, what happens when quantity reaches zero or goes below it. That is
     arithmetic about an obligation (what the shop holds and what it cost), so it must behave identically on a
     counter that is offline and on the server that re-applies the same movement. No database, no clock it does
     not receive, no locale: the moment it needs any of those it stops being answerable in two places at once. */
  'lib/inventory.js',        // perpetual stock, weighted average (Ind AS 2); pure, holds nothing
];

/** TIER B — CB logic, allowed a database handle and other ENGINE modules. Nothing else. */
const TIER_B = [
  'lib/regional.js',         // governed currency: entity → region → named fallback
  'lib/reporting.js',        // the network reporting LENS; structurally un-mintable output
];

/** Everything an engine module is permitted to reach for. Deliberately tiny. */
const ALLOWED_FOR_ENGINE = new Set(['../db', './money', './regional', './container', 'crypto']);

/**
 * EVERY lib/ file must be classified. This was the first version's real hole: it named 6 files and said NOTHING
 * about the other 30 — so `lib/forms.js`, which carries a seal hash, sat outside the manifest entirely. A boundary
 * that only covers what you remembered to list is not a boundary.
 *
 * PENDING is deliberate and allowed: an honest "not yet decided" is worth more than a confident wrong taxonomy.
 * The test PRINTS the pending count every run, so it is visible debt rather than silence.
 */
const ADOPTION_LIBS = [   // could be someone else's — see ENGINE-CORE.md "What is NOT engine"
  /* ⭐⭐ ADOPTION IN THE MOST LITERAL SENSE THE LIST HAS: gherkin.js implements SOMEBODY ELSE'S FORMAT, and the
     test for adoption — "if the standard changed tomorrow, this file changes and nothing else does" — is not
     an argument here, it is the definition. It decides nothing. Given/When/Then already IS what a test case
     is, so there was no rule of ours to encode: the file renders our shape as that text and reads it back.
     ⚠️ It is Tier-A pure (zero dependencies, asserted in its own test) and could sit in TIER_A on those
     grounds — but purity is not what makes something engine. Cucumber's grammar is not our judgement, and
     filing it as engine would put a third party's syntax under the engine lock. */
  'gherkin.js',
  'ai.js', 'assist-kb.js', 'capture.js', 'catalogue-build.js', 'catalogue-view.js', 'compliance.js',
  /* ADOPTION, not engine, and the split is the point: lib/rewards.js decides what a point is WORTH (pure, no DB,
     Tier A) while reward-store.js only knows where one is KEPT — four queries against an append-only table. Swap
     the store for another database and nothing about a customer's balance changes; swap the engine and it does. */
  'reward-store.js',
  /* ADOPTION, same split again: inventory.js decides what a movement DOES to a balance; stock-store.js knows where
     the balance is kept and holds the one transaction that moves the log and the cache together. The interesting
     rule it owns is not a business rule at all — it is the row lock, and a lock is infrastructure. */
  'stock-store.js',
  /* ADOPTION: it reads a CHIT and says which movements it implies. That is shape-reading plus one business
     rule ("stock moves when goods move"), and the rule lives in its header rather than in an algorithm —
     no arithmetic, no state. If the chit shape changed tomorrow this file changes and nothing else does,
     which is the test for adoption rather than engine. */
  'stock-from-chit.js',
  /* ADOPTION, and the name is exact: it decides what one shop may take into its own catalogue from another's
     delivery. Pure policy over shapes — the vertical gate, the resale/own-use split, the seed for a form.
     It decides no money and holds no state, and the day the chit shape changes this file changes alone. */
  'adopt.js',
  /* ADOPTION: the one chain by which a product enters a catalogue — declare the column, stamp the currency,
     insert, meter, ring the bell. It decides nothing about WHETHER a product may be created (adopt.js and
     the form do that); it is the act once the decision is made, extracted the day a third door appeared. */
  'mint-product.js',
  /* ADOPTION: the list of things a shop buys to USE, and the purchases against it. Its one real rule —
     stocked or expensed — is a materiality judgement the SHOP makes, so this only carries the answer. */
  'supply-store.js',
  /* ADOPTION: it mints an id for a party who is not on ChitBridge, so every join that addresses a supplier by id
     keeps working. Nothing in it is a business rule — it is one INSERT plus the find-first that keeps a repeat
     purchase on the same row. The one decision it does encode ('local', never 'entity') is a privacy fence around
     THIS platform's search, which is the definition of adoption rather than engine. */
  'local-identity.js',
  // ADOPTION: it assembles a SHOPFRONT — departments, categories, search. It decides no authority; the caller hands
  // it only members already resolved through buildPublicView. A storefront is a presentation of CB, not CB itself.
  'network-view.js',
  'conformance.js', 'instruments.js', 'kyb.js', 'readiness.js', 'reference.js', 'verify.js', 'profile.js',
  'boilerplate.js', 'plans.js', 'forms.js',
  // Beckn is a WIRE PROTOCOL — adoption by definition. Classified BEFORE it was written, so the guard existed
  // before the thing it guards. The engine may never import it; vocabulary drift is how a distinct thing becomes
  // a client of someone else's model.
  'beckn-map.js',
  // ADOPTION, not engine: "what a gold catalogue records" is the bullion trade's convention, not CB's idea. A
  // vertical could be added, replaced or wholly deleted and nothing about what ChitBridge IS would change. The
  // ENGINE part of the same question — that a field says WHERE its value comes from (the four legs), and that a
  // `customer` field is not a product column — is a rule, and it lives in csv-preflight/the schema, not here.
  'starter-fields.js',
];
const INFRA_LIBS = [
  'trips.js',          // INFRA: counts the database round trips one request makes, when CB_TRIPS=1 asks it to (2026-09-07)      // plumbing: neither identity nor adoption. Replaceable without changing what CB is.
  'logger.js', 'notify.js', 'respond.js', 'storage.js', 'schema-bootstrap.js', 'otp.js', 'dev-otp.js',
  'confcache.js',   // a TTL memo over migration-only config tables — holds no rule, decides nothing
  /* INFRA by this file's own test: it holds no rule and decides nothing. It says "the shop moved" down the pipe
     lib/events already owned, so a counter and a television stop waiting out a timer. Swap the transport and
     ChitBridge is unchanged — which is what makes it plumbing rather than an engine. (2026-09-09) */
  'shopchanged.js',
  /**
   * INFRA FOR NOW, AND THE "for now" IS THE POINT. Phase 0 of the register (b182) is an append-only note
   * table: six kinds, a body, and a closing row. It holds no rule and decides nothing, so it is replaceable
   * without changing what CB is — which is the infra test.
   *
   * It moves to ENGINE the day it starts GOVERNING rather than recording: when entries are DERIVED from the
   * fit-gap verdicts, or when a shared entry replicates to the counterparty. Both are designed and neither is
   * built. Classifying it engine today would lock a file that is expected to grow, and the engine lock means
   * default-no-change.
   */
  'raida.js',
  'vaultcrypto.js', 'retention.js',
  /**
   * ⚠️⚠️ THIRTY-ONE FILES HAD DRIFTED OUT OF EVERY BUCKET, which is this test failing at the thing it exists
   * to do: *"a new module must be declared engine or not-engine when it is written — deciding later means
   * never deciding."* Deciding later is exactly what happened, thirty-one times.
   *
   * ⚠️ AND THE LAZY FIX WOULD HAVE BEEN THE HARMFUL ONE. Dropping all thirty-one here would have quietly
   * reclassified `amend` · `assign` · `reprice` · `sla` · `deliverline` · `consolidate` — chit-lifecycle logic,
   * which is ENGINE and therefore LOCKED — as replaceable plumbing. A bucket that is wrong is worse than a
   * bucket that is missing, because the engine lock reads from it.
   *
   * ⭐ So they were split by what they DO. Below: things that could be swapped for another implementation
   * without changing what a chit means.
   */
  /**
   * ⚠️ `rates.js` IS A CLOSE CALL AND THE REASONING MATTERS MORE THAN THE VERDICT. The argument for ENGINE is
   * real: a stamped rate is frozen-at-the-moment evidence, the same discipline a chit applies to its terms, and
   * "why was this charged that?" is a disputable question.
   *
   * ⭐ Filed INFRA anyway, because the engine lock protects **what a chit MEANS between two trading parties**.
   * A rate card is what ChitBridge charges its own customer — commercial policy, changeable next month without
   * anything about a chit behaving differently. Locking it would make an ordinary price change need Athi's
   * sign-off as if it were chit semantics, which devalues the lock rather than strengthening it.
   */
  'rates.js',              // the stamped rate card — what CB charges, not what a chit means
  'access-events.js',      // writes the access audit trail — a record OF governance, not governance itself
  'access.js',             // reads role/permission; the rules it enforces live in IAM, not here
  'bridgeid.js',           // id formatting
  'channels.js',           // channel binding lookup — plumbing for an inbound number
  'cost.js',               // arithmetic over line costs
  'folder-rules.js',       // filing rules evaluation — a router, not a rule-maker
  /* ⭐ A RULE ABOUT THE CATALOGUE, NOT ABOUT A PRODUCT. It decides who may change a COLUMN and when —
     flexible while empty, tightened per column once used — and the routes and the screen both read it, so it
     sits here rather than being re-decided at either end. */
  'column-rules.js',       // may this column be removed, and if not, why not
  /**
   * ⭐ BESIDE column-rules FOR THE SAME REASON, and INFRA for the same reason as raida.js above — the "for now"
   * is the point. It decides what may become a column at all (a merchant's field yes, the system's bookkeeping
   * no), when two spellings are one column and when they are merely similar, and it binds the declaration to
   * the store so every write path answers identically. That is a rule about the CATALOGUE, which is PIM
   * mechanics — swappable without changing what a chit means between two trading parties, which is the test.
   *
   * ⚠️ IT BECOMES A CANDIDATE FOR ENGINE THE DAY A COLUMN CARRIES PROVENANCE. SPEC v2's FIX-4 would give a field
   * `leg` (system|customer|compute|cb) and `via` (ERP|IoT|AI) — at that point this file would be deciding WHERE
   * A VALUE COMES FROM, which is engine vocabulary, and the four-leg rule already lives in that language.
   * Classifying it engine TODAY would lock a file that FIX-2 and FIX-4 are both expected to change, and the
   * engine lock means default-no-change.
   */
  'catalogue-columns.js',  // what is a column, who declares it, and the one list every surface answers with
  /* ⭐ INFRA, and the reason is squarely the infra test: it is a PRESENTATION rule — what a spreadsheet shows a
     person, and how their answers become the system's records. Swap it for a different projection and nothing
     about what a chit means between two parties changes. The RECORDS it projects (money, availability) are
     defined elsewhere and keep their own rules; this only decides how they are shown and re-read. */
  'sheet.js',              // a spreadsheet carries answers, not records: flatten out, stamp in
  /* ⭐ INFRA beside sheet.js, and the same test: it decides how a catalogue-level default reaches a row and
     which of the two answered. A resolution rule, not a claim about what a chit means — swap it and nothing
     between two trading parties changes. It is the fourth coat on a pattern money.js, the face units and
     catalogue-read.referencedLine already wear. */
  'defaults.js',           // the catalogue declares, a row overrides, the system knows which
  /**
   * ⚠️ INFRA, AND THE CALL IS CLOSER THAN THE OTHERS. The argument for ENGINE: a tax determination is evidence
   * that gets sealed onto a chit and disputed later, which is chit semantics. Filed INFRA because it decides no
   * RATE and holds no table — it applies a rate it was handed and splits it by the supply type. The judgement
   * that matters (what rate does this HSN attract, in this jurisdiction, today) belongs to the entity or to a
   * provider, and this file exists precisely so that judgement can be swapped without touching CB.
   *
   * ⭐ It moves to ENGINE the day CB itself asserts a rate.
   */
  'tax.js',                // GST determination: two addresses in, INV-01 vocabulary out. No rate tables, ever.
  /**
   * ⭐ INFRA FOR THE SAME REASON AS tax.js, AND THE REASON IS WORTH RE-STATING because it looks like a close call.
   *
   * `tax-slab.js` decides WHICH of the entity's own declarations answers for a product — its slab, its category's,
   * or its catalogue's. That is a lookup over data the ENTITY authored, in the order Tally/Zoho/Odoo all use. CB
   * asserts nothing: it ships no rates, maps no HSN to any slab, and returns 'none' rather than guessing when
   * nobody has declared one.
   *
   * ⭐ It moves to ENGINE the day CB itself decides what a product attracts — the same trigger as tax.js.
   */
  'tax-slab.js',           // which declared slab answers for this product, and who declared it. No rate tables.
  /**
   * INFRA, BY THE SAME TEST. `tax-governance.js` serves the JURISDICTION's declared slabs (region_layer, put there
   * by a migration a person read) to the entities in it, as read-only rows. It still asserts no rate of CB's own —
   * the data is the jurisdiction's, the file only carries it. Same trigger to become ENGINE as its two siblings.
   */
  'tax-governance.js',     // the jurisdiction's slabs, inherited read-only; no rate of CB's own
  /**
   * INFRA, THE SAME TEST, THREE MORE TIMES (2026-09-04 night, STUDY §6 G1/G3/G4). `tax-lines.js` rates a line from
   * what the seller's catalogue answers and builds the INV-01 block from tax.js; `tax-shelf.js` is the one reader
   * of the shelves both order paths use; `tax-copy.js` is the DB-facing half — MY copy of a chit as a tax record,
   * the freeze at completed, the month's ledger. None asserts a rate of CB's own; all carry what a party declared.
   * ⚠️ The freeze writes business_json.invoice on a chit copy — a record OF the chit, not a change to what a chit
   * means: the lines, parties and status it reads are untouched. That is the line between INFRA and ENGINE here.
   */
  'tax-lines.js',          // rate on the line at send · INV-01 for a copy · the month's ledger · GSTR shapes
  'tax-shelf.js',          // one reader of slabs (own + governed) · categories · face
  'tax-copy.js', 'schedule.js', 'slab-cites.js',           // my copy as a tax record; freeze at completed; ledger over my copies
  'groupsum.js',           // aggregation for a pane
  'itemmatch.js',          // fuzzy matching a text line to a catalogue item
  'itemstatus.js',         // derives a display status
  'match.js',              // matching helpers
  'measure.js',            // unit handling
  'meter.js',              // usage ledger writes — billing plumbing, deliberately best-effort
  'numerals.js',           // digit shaping
  'policy.js',             // reads policy flags; the flags are the governance, this is the reader
  'reqctx.js',             // request-scoped actor context (AsyncLocalStorage)
  'schema.js',             // hasColumn/hasTable probes for the deploy-before-migration window
  'select.js',             // shaped SELECT builders
  'storage-object.js',     // object-store key/put/get
  'events.js',             // the mailbox bell: SSE subscribers + one-time tickets — plumbing, carries no meaning
  'services.js',           // the governed capabilities as services: shared plumbing behind /api/offers · pricing · tax · invoice
  'zip-store.js',          // a STORE-method zip writer, no dependency — hands a person the connector kit
  'profile-map.js',        // what we look for about a store · where it comes from · how trusted (declared → copied → checked → verified)
  /* ⚠️ units.js WAS ALSO LISTED HERE, and was for weeks — the original guess from 2026-08-16, when it was still
     built-but-unwired. It has been in TIER_A since it went live, with the reasoning written out there, and two
     classifications for one file is how a rule quietly becomes plumbing. Removed 2026-09-09 after checking that
     nothing reads it here: inventory.cjs tests TIER before INFRA, so the file already reported engine.tier. */
  'definition-check.js',   // the value a definition kind cannot do without (the form's sentences, refused by the API too)
  'public-facts.js',       // what a counterparty may see about an entity, with the rung (GSTIN · state · registration type; never the vault)
  'exposure.js',           // what a customer may see of an ITEM (tax · offers · stock · synonyms · hsn · description · media), enforced in the one projection
  'offers-live.js',        // the seller's live offers applied to a set of lines — the one function the storefront order AND the send path call
  'customer-groups.js',    // what the SELLER's customer list says about a viewer (segment · one customer) — the groups a customer-only offer may name
  'stores.js',             // store lookup helpers
  'transcribe.js',         // audio → text; an outside service behind one function
  'whatsapp-media.js',     // provider media fetch
  'whatsapp-out.js',       // provider send
  'whatsapp-templates.js', // provider template shapes
];
const ENGINE_OTHER = [
  'offers-engine.js',
  /* GENERATED, never edited by hand: scripts/vendor-tax.cjs writes it from tax.js + tax-slab.js so a TILL can price a bill with the
     internet unplugged. Same engine, second home — tests/tax-vendor.test.js fails the day the two differ (2026-09-07). */
  'tax-engine.browser.js',
  /* GENERATED, never edited by hand: scripts/vendor-till.cjs copies chitbridge-web/public/app/search.js so the COUNTER and the
     app's Catalogue answer a shopkeeper's own words ("ac co" → Aachi Coriander) identically. Served to the till at
     /api/till/engine/search; tests/search-engine.test.js fails the day the copies differ (2026-09-08). */
  'search-engine.js',
  /* GENERATED beside it: what /api/till/engine/gs1 serves a shop PC, so a pharma counter can read a batch and an expiry off a pack
     with the line down (scripts/vendor-till.cjs wraps lib/gs1.js for a browser). */
  'gs1.browser.js',
  /* ENGINE: what a VERTICAL must capture about a consignment — batch, expiry, serial — resolved from the sector governance already
     holds. It decides what goods-in refuses, which makes it a rule about obligations, not a helper. */
  'lotfields.js',
  /* GENERATED beside it, for the counter: the tolerance rule must have ONE definition, because the door decides and the match
     decides afterwards and those two must never disagree (scripts/vendor-till.cjs). */
  'lotfields.browser.js',
  /* GENERATED beside lib/numerals.js: the closed class — numerals in English and transliterated Tamil — so a counter that hears
     "two kilo" writes 2 and not a second opinion about a number (scripts/vendor-till.cjs). */
  'numerals.browser.js',
  /* ENGINE: what somebody SAID, as text — a seam with a provider behind it (lib/speech.js). It decides nothing about money, but it
     is the one place a second AI vendor enters the platform, which makes it a boundary rather than a helper. */
  'speech.js',
  'pricing-engine.js',    // ENGINE: the pricing structure a product cites → the unit price at a quantity (vendored from app/pricing.js)   // = web app/offers.js, vendored (cp) so a shop ORDER is priced by the SAME engine as the row; web owns the source    // CB identity, beyond the tiers above. Classified, not yet tier-graded.
  /**
   * ⭐⭐ THESE EIGHT ARE WHAT A CHIT *MEANS*, so they are engine and therefore LOCKED. They were held out of
   * the infra list on purpose: each one changes the state of an obligation between two parties, which is the
   * thing CB exists to carry. Swap any of them for another implementation and a chit no longer behaves the same.
   */
  'mint.js',           // ENGINE: the STAMP. Loose becomes authoritative here — the one irreversible moment
  'amend.js',          // ENGINE: how a stamped thing changes without losing what it was
  'assign.js',         // ENGINE: who carries the obligation next
  'autoraise.js',      // ENGINE: a rule raising a chit on its own — governance acting without a human
  'consolidate.js',    // ENGINE: many becoming one, and the traceability back to the many
  'deliverline.js',    // ENGINE: goods draw down / service accrues — the line-as-spine mechanism (b152)
  'reprice.js',        // ENGINE: price changing after the fact, which is a disputable event
  'sla.js',            // ENGINE: the PAUSE — the disputed object itself, not the resolution
  'csv.js',               // catalogue CSV round-trip — zero-dependency, a STANDARD (RFC 4180) we implement
  'visibility-cap.js',    // ENGINE: the CAP/CHOICE split — what an operator permits vs what an entity picks. Who
                          // may expose a catalogue to the world is governance, not a storefront preference.
  'catalogue-read.js',    // ENGINE: it decides WHO MAY CHANGE WHAT — owned is editable, referenced is not, per
                          // FIELD. That is the ownership rule the per-copy model rests on, not a display concern.
                          // (catalogue-view.js is adoption: it shapes a payload. This decides authority.)
  'availability.js',      // ENGINE: "absent is not zero" and "fresh outranks stale" are CB's rules about what may
                          // be asserted, not a trade's convention. A platform that lets a 200-day-old figure
                          // outrank a live one has taken a position on truth, and this is where that lives.
  'network-build.js',     // ENGINE: it decides that an OWNED node is created and a PARTNER is only ever invited.
                          // That asymmetry is what keeps `network` visibility legitimate — a network that could
                          // absorb an outsider unilaterally could read their warehouse. Governance, not plumbing.
  'handle.js',            // ENGINE: the NAME an entity is known by across networks. Format, reserved words, and the
                          // refusal to look like a bridge id are CB's rules — a store carries its handle into any
                          // network it later joins, so this is identity, not presentation.
  'identity.js',          // ENGINE: "which line is this, and which product does it belong to" is the question the
                          // per-copy record is keyed on. A partial identity being NO identity, and a variant being a
                          // line rather than a child row, are CB rules — not a trade's convention.
  'csv-preflight.js',     // ENGINE, not adoption: it decides what a file may NOT set (mode, currency, ids). The
                          // synonym table is throwaway; the refusal is CB's. Zero-dependency, proposes never decides.
  'gs1.js',               // GS1 keys — zero-dependency, but a STANDARD we implement rather than our own idea
  'trace.js',             // the doubly-linked, co-held, FROZEN handoff edge — settlement's sibling
  'container.js',         // the container model: blueprint + version
  'source.js',            // source-entity: a sealed entity that governs downstream
  'workpattern.js',       // the resolution seam — resolve-before-act
  'govresolve.js',        // governance resolution
];
/** Not yet classified. Keep this SMALL and shrinking. Empty is the goal, not the requirement. */
const PENDING_LIBS = [];

module.exports = { TIER_A, TIER_B, ALLOWED_FOR_ENGINE, ADOPTION_LIBS, INFRA_LIBS, ENGINE_OTHER, PENDING_LIBS };
