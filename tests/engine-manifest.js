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
  /* ⚠️ THE SIBLING OF money.js, AND FOR THE SAME REASON: it never converts. units.js folds spellings of one unit
     onto one name (கிலோ → kg) and is forbidden from ever relating two DIFFERENT units (crate → kg), because that
     needs a factor and a factor is entity-specific. A rename is engine vocabulary; a conversion is a declaration.
     Zero dependencies, pure data + one fold — Tier A. */
  'lib/units.js',            // unit aliases: one unit, many spellings; never converts
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
  'ai.js', 'assist-kb.js', 'capture.js', 'catalogue-build.js', 'catalogue-view.js', 'compliance.js',
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
const INFRA_LIBS = [      // plumbing: neither identity nor adoption. Replaceable without changing what CB is.
  'logger.js', 'notify.js', 'respond.js', 'storage.js', 'schema-bootstrap.js', 'otp.js', 'dev-otp.js',
  'confcache.js',   // a TTL memo over migration-only config tables — holds no rule, decides nothing
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
  'stores.js',             // store lookup helpers
  'transcribe.js',         // audio → text; an outside service behind one function
  'whatsapp-media.js',     // provider media fetch
  'whatsapp-out.js',       // provider send
  'whatsapp-templates.js', // provider template shapes
];
const ENGINE_OTHER = [
  'offers-engine.js',
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
