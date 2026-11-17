/* app/cap-legend.js — the 🔑 LEGEND capability: a live map of "what we serve". · CARD 20-settings-governance-and-plan/capability-legend
 * Loaded lazily by ensureCap('legend') on first 🔑 click (rarely opened → dogfoods on-demand loading).
 * CAP_CATALOGUE = the capability → features catalogue (keep TRUE to what's built; honesty rule). The panel
 * shows each capability's LOAD kind (eager / lazy / planned) with LIVE state from Core's CAP_LOADED, and every
 * feature's status (done / partial / backlog). Core keeps only the gated stub (openLegend/closeLegend/_legendOpen).
 * Update this whenever a capability or feature lands. Mirrors the catalogue in project-capability-modularisation.
 * CALLED BY public/app.html   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 * OWNS      CAP_CATALOGUE (capability -> features) and the legend panel: _openLegendImpl and its tab painters; Core keeps only the gated stub
 * FLOW      openLegend (app.html) -> ensureCap(legend) -> _openLegendImpl paints the tabs from CAP_CATALOGUE + live CAP_LOADED
 * CARD      20-settings-governance-and-plan/capability-legend
 */

// TWO AXES per capability (SPEC-governance-in-legend.md):
//   maturity 1-5 (what it DOES): 1 Proven · 2 Packaged · 3 Itemised&Isolated · 4 Governed · 5 Productized.
//   gov 1-5 (how it's GOVERNED): 1 declared · 2 designed · 3 enforced+isolated · 4 governed+provable · 5 audited/certified.
//   gov RIDES ON the capability — governedUnder (the cascade layer) · governedBy (mechanisms in force) · govGap (= the L4 lever).
//   RULE: gov usually LAGS maturity, and that lag IS the distance to L4. gov:null → N/A (nothing to govern; static/read-only).
const CAP_CATALOGUE = [
  /* ⭐ THE CART AS A CAPABILITY (Athi, 2026-09-05: "the cart is a single view we should be able to embed anywhere so we get the
     same style and response everywhere — single source of truth; what if we convert cart as a capability?"). The difference
     from a library is what is ENFORCED: a contract (catalogue payload in · engine lines + money out), one implementation,
     a guard that fails on a second copy (e2e/one-cart.cjs), and this grade. */
  {
    id: 'cart',
    name: 'Cart — one basket, everywhere',
    icon: '🛒',
    load: 'eager',
    maturity: 2,
    target: 3,
    gov: 2,
    govTarget: 3,
    governedUnder: 'the catalogue contract (the same payload the storefront, Suppliers, Compose and the API read)',
    governedBy: [
      'ONE FILE: app/cart.js (state · money · basket panel · rows · chip · picker) — merged 2026-09-05 from cart-ui.js + catalogue-ui.js; the globals CBCart and CBCatUI are its two doors',
      "CBCart.money / moneyRowsHTML / reviewHTML — the only place a buyer's money is computed and printed (offers → after offers → GST per rate → total incl. tax)",
      'guard e2e/one-cart.cjs: a second total, a bare cart total or a basket evaluation outside the file fails the run',
      'the server re-prices every order with the same engines at send (CJ-07)'
    ],
    govGap: [
      'the Compose typed lines carry no seller tax until send (the review shows offers and any rate the line already has)',
      'maturity 3 needs the parity spec [PAR-01] green on every run and the file in the inventory as its own group'
    ],
    blurb:
      'One basket embedded in every buying surface — storefront, Suppliers, Compose, Network — with one money math, so an attached offer or slab shows the same outcome wherever the buyer stands.',
    features: [
      { n: "Rows — listed price · the tax a buyer will pay (+5% GST · ₹210 incl.) · the offer badge from the catalogue's own offers", s: 'done' },
      { n: 'Basket — offers → After offers → GST per rate → Total incl. tax, the same rows on the storefront and in the app', s: 'done' },
      { n: 'Order models — unit · pack · bulk · offer (name your price) · payload · service, one stepper each', s: 'done' },
      { n: 'Storefront rows and bar through the shared renderer (stock stamp in the row, gallery as a hook)', s: 'done' },
      { n: "Every review prints the cart's own money block (Suppliers · Network · Record a sale · Compose) — reviewHTML", s: 'done' },
      { n: 'One file, one capability: app/cart.js', s: 'done' },
      { n: 'Parity spec across surfaces [PAR-01] + exposure [EXP-01]', s: 'done' }
    ]
  },
  /**
   * ⭐⭐⭐ MONEY AND LANGUAGE AS A CAPABILITY (Athi, 2026-09-11: *"the currency handling and the language handling,
   * can we keep it as a capability, its rules and convention etc — because any application we develop, if it has
   * to follow currency, then these conventions would be useful"*).
   *
   * ⭐ HE IS NAMING SOMETHING THAT WAS ALREADY TRUE AND UNDECLARED. One renderer, one string layer and one set of
   * conventions were already serving the app, the counter, the shop screen, the storefront and the lab — but
   * nothing said so, so each new surface rediscovered them. promo.html hard-coded '₹' and en-IN and shipped a
   * rupee sign to a Dubai customer, and offer-lab.html read Number(price) on a stamped money value; both were
   * written by someone who had no list of the rules to follow.
   *
   * ⚠️⚠️ THE FAULTS THIS CAPABILITY EXISTS TO PREVENT ARE ALL INVISIBLE TO THE AUTHOR. A wrong currency symbol is
   * a wrong price and it is correct in the one currency the developer tests in. A dropped bidi mark scrambles an
   * Arabic price only on an Arabic device. A missing translation looks like English working fine. None of them
   * throws, and the person who would notice is the one nobody asked.
   *
   * ⚠️ maturity 2 (designed), NOT 3: the rules are written down and the guards exist, but there are FIVE copies
   * of the stamped-price reader and only one of them is named (backlog). L3 needs one exported reader and the
   * others deleted — an enforced single implementation, which is what separates a capability from a convention.
   */
  {
    id: 'money-language',
    name: 'Money & language — one renderer, one string layer',
    icon: '💱',
    load: 'eager',
    maturity: 3,
    target: 4,
    gov: 3,
    govTarget: 4,
    governedUnder: 'the standards register (ECMA-402 · CLDR · BCP 47 · RFC 4647 · ISO 4217)',
    governedBy: [
      'ONE RENDERER: CBLocale.money(amount, code) — engine/locale.js, vendored to /engine/locale.js for the counter and the shop screen',
      "THE READER GROUPS, THE CURRENCY DOES NOT: grouping and separators come from the reader's locale (India is 2-2-3, not 3-3-3); the currency sets only the symbol and the decimals (JPY 0 · INR/USD/AED 2 · KWD/BHD 3)",
      'ltr() strips the LRM/RLM/ALM marks an Arabic-region format inserts — they serve an RTL paragraph and mislead the bidi algorithm on an LTR page (a price once read "10 / ₹ 620.00KG")',
      'A PRICE IS A STAMPED VALUE — { amount, currency } — never a bare number; reading one with Number() is NaN and silently drops the product',
      'English IS the key (gettext): tx() takes the English string, so a missing translation degrades to readable English rather than to a key',
      'Region bounds language (RFC 4647, at most 3 per region) — a shop is not offered a language its region does not use',
      'guard snapshot-wire: no shipped screen may print a currency symbol inside a string it emits'
    ],
    govGap: [
      'the two engines (cart.js · pricing.js) keep a GUARDED fallback: they forward to CBMoney and only unwrap inline if the engine failed to load. Defensible for an engine that must run alone, and still two places where the rule is written — L4 decides whether an engine may hard-depend on another',
      "the counter's fallback when CBLocale fails to load still prints two decimals for every currency — wrong for JPY and KWD, right for the rest",
      'no spec drives a non-INR shop end to end: the renderer is proven per currency, the SCREENS are proven only in rupees'
    ],
    blurb:
      "Money is not a number with a symbol in front of it, and a language is not a lookup table. One renderer carries the shop's currency and the reader's grouping to every surface; one string layer keeps English as the key so a missing translation is still readable.",
    features: [
      { n: 'CBLocale.money — symbol, grouping, decimals and bidi marks, from one place (55 call sites on the counter alone)', s: 'done' },
      { n: 'Per-currency decimals: JPY none · INR/USD/AED/GBP/EUR two · KWD/BHD three — verified across all eight', s: 'done' },
      { n: 'An unknown currency code still prints (code + number) rather than throwing mid-sale', s: 'done' },
      { n: 'RTL as structure, not translation — 4 language packs (ar/fr/hi/ta), 617 labels each', s: 'done' },
      { n: 'tx() adopts gettext: the English string IS the key', s: 'done' },
      { n: 'The shop screen and the offer lab joined the renderer (both were hard-coding ₹)', s: 'done' },
      { n: 'Guard: no screen prints its own currency symbol', s: 'done' },
      { n: 'ONE reader: lib/money.js vendored as the ninth engine (CBMoney) — the five browser copies now forward to it', s: 'done' },
      {
        n: '⚠️ strict vs loose: amountOf() THROWS on a legacy bare number (right for the server), amountOfLoose() returns NaN — every browser reader uses loose, because a counter must never fail to show a price',
        s: 'done'
      },
      { n: 'A spec that drives a non-INR shop through counter, screen and slip', s: 'next' }
    ]
  },

  {
    id: 'testing',
    name: 'Test lab — cases, results and the spec they cite',
    icon: '🧪',
    load: 'lazy',
    maturity: 2,
    target: 3,
    gov: 3,
    govTarget: 4,
    governedUnder: 'the same definition/version rail every declared rule uses, plus the b219 append-only grant',
    governedBy: [
      "A TEST CASE IS A DEFINITION (kind testcase), versioned like a tax slab — so a result records WHICH WORDING was in front of the tester, and editing a case cannot retroactively claim that today's words passed on a day they did not exist",
      'A SPEC CLAUSE IS A DEFINITION TOO (kind spec). A case cites it AT A VERSION, so editing the clause makes every case citing the old one exactly the set to look at again — no hash, no sweep, no flag to remember',
      'APPEND-ONLY BY GRANT: cb_app may INSERT and SELECT on test_result and nothing else. A re-test is a NEW ROW and the latest wins; the earlier one stays readable, so a flaky case shows as pass/fail/pass instead of collapsing',
      "RLS entity isolation (FORCE) on test_result — one shop never sees another shop's testing",
      'tested_by comes from the token and is never read from the request body; tester_name is a courtesy label beside it, for when one login is shared',
      'ADOPTED FORMATS, not invented ones: JUnit XML in (Playwright, any CI), Gherkin .feature in and out (the Feature description IS the spec clause)',
      'guard test-board: the statuses, run kinds and layers are written in THREE places (CHECK constraints, route arrays, two screens) and the guard asserts all three agree',
      'guard gherkin: all 110 real cases round-trip through export and import unchanged'
    ],
    govGap: [
      "⚠️ NO API-KEY SCOPE YET — an external CI server cannot post results without a person's token. The scope exists as of today; nothing has been issued or proven against it",
      'a result is entity-scoped, so "has this FUNCTIONALITY been tested" is answered per shop. Coverage weights by the case\'s declared priority, which travels with the document — but there is no cross-entity view and no release gate',
      'nothing verifies that a case was actually EXERCISED — a person can tap Pass without doing the steps. The evidence (the API calls the case made) is attached only while spec is on',
      'the spec clause is only as good as the Feature description somebody wrote; no clause is yet cited by the code it governs'
    ],
    blurb:
      'The test cases as a thing you tap, not a PDF you cannot write on. A panel that follows you across every screen, a ledger that never overwrites a result, and a spec clause each case cites by version — so when the spec moves, the cases that need re-reading name themselves.',
    features: [
      { n: 'The panel, on top of the app — the area is inferred from the screen you are on; movable, minimisable, five sizes', s: 'done' },
      { n: '110 documented cases load from a button (data/test-cases.json ships with the API) — no terminal, no token', s: 'done' },
      { n: 'Four verdicts, and Blocked is deliberately not Fail — it says nothing about the case itself', s: 'done' },
      { n: 'Append-only ledger (b219): who, when, which run, which layer, which version of the case', s: 'done' },
      { n: "Focus: each area with how many cases nobody has run, ranked by the case's own priority; it pins and counts down, it never locks", s: 'done' },
      { n: 'Gherkin export/import — the Feature description is the spec clause, the Scenarios are the cases against it', s: 'done' },
      {
        n: '"Spec moved": a case citing an older version of its clause is badged, because a green case whose clause changed proves nothing about today',
        s: 'done'
      },
      { n: "JUnit XML ingest — an automated run lands on the same board as a person's tap, and the board shows the WORSE of the two", s: 'done' },
      { n: '+ writes a new case without leaving the screen you found the fault on', s: 'done' },
      { n: "An API-key scope so a CI server can post results without a person's login", s: 'next' },
      { n: 'A release gate: which areas must be green before a build ships', s: 'next' }
    ]
  },

  {
    id: 'core',
    name: 'Core — Governance rail',
    icon: '🛤️',
    load: 'eager',
    maturity: 2,
    target: 3,
    gov: 3,
    govTarget: 4,
    governedUnder: 'the constitution + the RLS isolation floor',
    governedBy: ['RLS entity isolation (FORCE, per-copy)', 'append-only state_log', 'governed delivery fns (SECURITY DEFINER)'],
    govGap: ['governed provenance is thin', 'seal / version-freeze not tamper-tested'],
    blurb:
      'The governance RAIL, in the familiar form of a mailbox — the lean always-on shell every role starts with (loaded with app.html). As easy as an inbox; governed underneath.',
    features: [
      { n: 'The tracks + lists — Task (coming to you) · Order (going from you) · Drafts · Trash · Archive', s: 'done' },
      {
        n: 'Read & advance — open a chit and move it through its statuses (open · act · close · reopen): single-step, governed, stamped on the append-only log',
        s: 'done'
      },
      { n: 'Compose — load a wagon: author a chit = your business (line items, attachments, delivery, live summary)', s: 'done' },
      { n: 'Assign to your co-assists (the crew) — human, and machine: IoT · ERP · AI: single push · bulk · pool pull · hat-gated', s: 'done' },
      { n: 'Disputes — the private siding, extracted to its own lazy Disputes capability (Core is dispute-blind, 2026-07-05)', s: 'done' },
      { n: 'Relations — your network: Suppliers · Catalogue · Network (reachable destinations — public map, private yards)', s: 'done' },
      {
        n: 'Retention & auto-purge — per-record retention period → governed auto-delete (settled-only · hold-aware · keep a receipt) + cold-archive (specified — backlog)',
        s: 'backlog'
      },
      {
        n: 'Message — a first-class subject, per-copy scoping: INTERNAL (single copy, private to the entity + its co-assists) · EXTERNAL (replicated to each participant entity) · DISPUTE (to the roster only — one or more participants)',
        s: 'done'
      },
      { n: 'Notifications bell + message centre (derived from state_log)', s: 'partial' }
    ]
  },
  {
    id: 'dispute',
    name: 'Disputes — the USP',
    icon: '⚑',
    load: 'lazy',
    maturity: 3,
    target: 4,
    gov: 3,
    govTarget: 4,
    governedUnder: 'the constitution (per-copy confidential scoping)',
    governedBy: ['per-copy chit_disputes (FORCE RLS)', 'roster-scoped delivery (chit_dispute_deliver)', 'raiser-only resolution'],
    govGap: ['governed provenance → L4', 'frontend module live-run'],
    blurb:
      'The confidential, per-party dispute rail — its own lazy, capability-gated module (cap-dispute.js); Core is dispute-blind. HARDENED PER-COPY (b68, 2026-07-08): each party holds its OWN chit_disputes copy (FORCE RLS), dispute_participants retired, dispute messages replicated to the roster only. L3 (itemised & isolated) is now PROVEN by automated regression (dispute-scope 7/0 — a chit party NOT in the dispute sees nothing). L4 gate = governed provenance + the frontend module live-run.',
    features: [
      { n: 'Per-party scoped raise / resolve (raiser-only) + duplicate guard (Model A — SPEC-dispute)', s: 'done' },
      { n: 'Per-ENTITY dispute copies + roster-scoped messages — PROVEN (b68, dispute-scope 7/0)', s: 'done' },
      { n: 'On-record banner — ALL concurrent disputes under one roof (multi-party count header)', s: 'done' },
      { n: 'Per-dispute threading keyed on dispute_id (filter chips + composer binds to the selection)', s: 'done' },
      { n: 'Dispute [raised]/[resolved] badges · entity-name + actor byline · dispute-mode composer', s: 'done' },
      { n: 'List-row count — ⚑ N open · M resolved at a glance', s: 'done' },
      { n: 'Advanced-search dispute filter (chip + modal) + capability-gated nav', s: 'done' },
      { n: 'Live-run of the lazy FRONTEND module (Athi) → locks the UI at L3', s: 'partial' },
      { n: 'Automated regression suite (dispute-scope/regression) — DONE; governed provenance → L4', s: 'partial' }
    ]
  },
  {
    id: 'admin',
    name: 'Admin',
    icon: '⚙️',
    load: 'lazy',
    maturity: 2,
    target: 3,
    gov: 2,
    govTarget: 4,
    governedUnder: 'the 7-layer block (declared) + per-entity policy flags (enforced)',
    governedBy: [
      'settings surface (assignment model)',
      'policy flags stored ON THE ENTITY and validated against a server-side whitelist (b130)',
      'platform-BOUND flags refuse a PATCH — dispute scoping is not a preference'
    ],
    govGap: ['the 7-layer cascade is still DECLARED, not enforced', 'chit expiry + retention are declared, not yet enforced'],
    blurb: 'Loads on first open of MIS / Profile / Settings.',
    features: [
      { n: 'MIS dashboard (client-side rollup — summary endpoint pending)', s: 'partial' },
      { n: 'Profile — entity + actor variants', s: 'done' },
      { n: 'Settings — assignment model + auto-assign on receipt', s: 'done' },
      /* ⚠️ WAS 'partial' AND WAS BEING GENEROUS. The card wrote to localStorage: it said "set", nothing left the
         browser, and self_copy_pref had a real enforced column that the UI wrote past. b130 made it real. */
      {
        n: 'Policy flags — REAL (b130): stored on the entity, whitelisted server-side, and they GOVERN (trade_side decides whether inbound lines are priced from your catalogue; self_copy_pref decides which copies exist). Was a localStorage prototype that reported success and stored nothing (15/0)',
        s: 'done'
      },
      { n: 'Channels — the inbound number/address map, per-line verification, templates and auto-raise (b123–b131)', s: 'done' },
      { n: 'Governance — 7-layer block: declared, not enforced', s: 'partial' },
      { n: 'Chit expiry + retention flags — declared in the policy layer, enforcement not wired', s: 'backlog' }
    ]
  },
  {
    id: 'workforce',
    name: 'Co-assists',
    icon: '🧑‍🤝‍🧑',
    load: 'lazy',
    maturity: 2,
    target: 3,
    gov: 2,
    govTarget: 3,
    governedUnder: 'hats + the assignability gate',
    governedBy: ['hat capability gate', 'assignability check', 'leave-cover concurrency guard'],
    govGap: ['governed role provenance (who granted a hat, when)'],
    blurb: 'Loads on first open of Co-assists. Grows into leave / shift / wage.',
    features: [
      { n: 'Create + invite (OTP) → set-PIN → PIN login', s: 'done' },
      { n: 'Re-invite / Reset-PIN lifecycle', s: 'done' },
      { n: 'Hats (view/act/audit/mis/manager) + assignability gate', s: 'done' },
      { n: 'Leave-cover (buddy pairs) + concurrency check', s: 'done' },
      { n: 'Duty / Break shift', s: 'done' },
      { n: 'Deactivate / reactivate / remove — full binding cleanup', s: 'done' },
      { n: 'Roster tabs + covers badges', s: 'done' },
      { n: 'Leave calendar · shift rotation · wage / salary', s: 'backlog' },
      { n: 'Non-human co-assist types (connector / IoT / AI) auth', s: 'backlog' }
    ]
  },
  {
    id: 'connector',
    name: 'Connector · IoT / ERP',
    icon: '🛰️',
    load: 'lazy',
    maturity: 2,
    target: 3,
    gov: 2,
    govTarget: 3,
    governedUnder: 'the capability-gate + per-connection retention policy',
    governedBy: ['capability-gated routing (403 if off)', 'receipt-only retention (process-then-forget)', 'per-connection kill switch'],
    govGap: ['governed fleets (allowlisted devices, per-device control)', 'real-ERP pilot'],
    blurb:
      'Non-human actors — a Pi (IoT) or a system (ERP) — that exchange chits over the rail, managed INSIDE Co-assists (one panel, same shell as people). A Pi holds its connection string; its devices/endpoints are connections under it. b62 = connection-string schema + provisioning + cascading health; device-key ingest = the Pi authenticates with its OWN ActorKey. ✅ L1→L2 CLEARED 2026-07-06 — a real Raspberry Pi 4 read its CPU temp, authenticated by its ActorKey, went live + delivered a co-held chit. ✅ ERP TRANSFER MODE LIVE 2026-07-08 — process-then-forget: receipt-only (hash + outcome), never the raw payload; owner test-cycle + receipt ledger (harness 23/0, b69). L3 = governed fleets (registered devices, per-device control) + a real-ERP pilot; L5 = billed at scale.',
    features: [
      { n: 'Connector = a co-assist grouped by SITE; connection string on it (b62)', s: 'done' },
      { n: 'Devices/endpoints per Pi (own bridge_id + config); enable/disable; add inline', s: 'done' },
      { n: 'Provisioning — CB-issued ActorKey (shown once) + Regenerate; push/pull; ERP base-url + auth-ref', s: 'done' },
      { n: 'Cascading health (Pi offline → devices no-signal) + ping / Test-connection', s: 'done' },
      { n: 'MERGED into Co-assists — click a Pi → device cockpit (sticky-top icons + scroll)', s: 'done' },
      { n: 'Device-key INGEST — Pi auths with its own ActorKey → heartbeat live + co-held signal chit (real Pi verified)', s: 'done' },
      {
        n: 'ERP process-then-forget — receipt-only (hash+outcome, never raw payload) + idempotent + cockpit test-cycle & receipt ledger (harness 23/0, b69)',
        s: 'done'
      },
      { n: 'Registered fleets — allowlisted devices, per-device governance / metering (L3)', s: 'backlog' },
      { n: 'AI actor cockpit — sibling of the Pi cockpit (prompt / guardrails / activity)', s: 'backlog' }
    ]
  },
  {
    id: 'intake',
    name: 'Capture connector — a message becomes a chit',
    icon: '📥',
    load: 'lazy',
    maturity: 2,
    target: 3,
    gov: 2,
    govTarget: 4,
    governedUnder: 'the verified number→entity binding + the per-line auto-raise switch',
    governedBy: [
      'HMAC signature on every inbound POST (a verify-token guards only the handshake)',
      'the entity comes from the BINDING, never from the payload',
      'verified-only bindings (b124) — a declared line receives nothing',
      'provider-message-id dedupe (b129) — a redelivery is not a second order',
      'raised as an INQUIRY, Task-only — a record, never an obligation',
      'provenance frozen on the chit (summary_json.via) incl. sender NOT verified'
    ],
    govGap: [
      'NOT EXERCISED AGAINST A REAL PROVIDER — transport is stood in for; needs a WhatsApp Business account',
      'email inbound captures TEXT ONLY — no attachments, multipart is not parsed',
      'media on a captured message stays at the provider, not carried onto the chit'
    ],
    blurb:
      'WhatsApp / email / any channel → a chit, through ONE pipeline where every channel is only an adapter: channel → capture → co-assist reads it → chit on the rail. ⚠️ THE CHIT IS UNI-DIRECTIONAL — it lands as a TASK in the entity\'s inbox and never as an Order, because the entity did not raise it; someone outside asked. The sender is the ORIGIN, not a party: a phone number is not an entity, and the send path still refuses any recipient that does not resolve. Priced from the catalogue only when the entity is set to SELL (a catalogue price is a sell-side price — a factory receiving milk must not price it off its own shelf). Works with NO catalogue at all: "milk 10 l" from a farmer is a complete chit. ⚠️ TRANSPORT IS SIMULATED — everything from the webhook inward is real and proven; that Meta carried the message is not.',
    features: [
      { n: 'Intake inbox — raw captures, per-entity WITH RLS (b104); a message is a NOTICE, a chit is an OBLIGATION', s: 'done' },
      { n: 'Settings → Channels — the number/address → entity map (b123); GLOBAL-unique, verified-only, SECURITY DEFINER lookup', s: 'done' },
      { n: 'WhatsApp webhook — HMAC-verified, entity from the binding, raw-body parsed BEFORE express.json', s: 'done' },
      { n: 'Co-assist reads the message into line items — proposed, not evidence', s: 'done' },
      {
        n: 'Raise as a request — an inquiry, TASK-ONLY (Order copy suppressed + declared in copy_policy), with the original message ATTACHED as evidence (52/0)',
        s: 'done'
      },
      {
        n: 'AUTO-RAISE, nobody present (b131) — per verified line, off by default; runs AFTER the 200 so Meta never retries; an unreadable message is LEFT IN INTAKE, never an empty chit (17/0)',
        s: 'done'
      },
      { n: 'Photo → items — the vision skill reads a photographed order (b127); engine change contained to lib/ai.js (8/0)', s: 'done' },
      { n: 'Outbound reply — free text inside the 24h window, pre-approved template outside it, refusal otherwise (9/0)', s: 'partial' },
      {
        n: 'Email inbound — TEXT ONLY. No attachments, no to_ref, multipart/form-data not parsed: an email WITH an attachment may capture nothing',
        s: 'partial'
      },
      { n: 'A real provider — a Meta/BSP account so a genuine message is carried end to end (the L2 gate)', s: 'backlog' },
      { n: 'Bind a number to a CO-ASSIST rather than the entity (parts exist: actor identities, created_by_actor_id, auto-assign)', s: 'backlog' }
    ]
  },
  {
    id: 'catalogue',
    name: 'Catalogue — source-governed distribution',
    icon: '🏬',
    load: 'lazy',
    maturity: 3,
    target: 4,
    gov: 2,
    govTarget: 4,
    governedUnder: 'the source@v blueprint (cascades from the source entity)',
    governedBy: [
      'version-freeze (chit pins the version)',
      'source-rule enforcement (distributor cannot override)',
      'resolve-at-mint seal',
      'two-class RLS (share-read reference · per-copy handoff)'
    ],
    govGap: ['tighten-only enforcement test', 'plan-ceiling / quota'],
    blurb:
      'The storefront rail: a SOURCE (brand) authors its catalogue + experience + rules ONCE, and that governance TRAVELS to any distributor that serves it — the item always runs under the SOURCE, never the host. CB provides INFORMATION + the governed rail only (catalogue, order-as-chit, penetration heatmap, nearest-distributor INFO); next-level ERP does logistics (receipt-only handoff). Live-verified 2026-07-10 (Athi applied b75–b84 + confirmed the storefront). Stones 1–6b + visualize-apply + spin-the-globe, all live. Held at L3 (no tighten-only enforcement test, no metering/plan-ceiling → the L4 gate is not cleared). 2026-07-26: a self-serve SETUP WIZARD landed — any store authors a catalogue (CSV/photos/manual), AI-enriches it (local/botanical names, b113), PUBLISHES it as a blueprint (exposes b78), and distributors adopt it by reference with own unit/price; items persist real (catalogue_items) + face persists cross-device (b112); blueprint picker is searchable + vertical-family filtered. Proven end-to-end in prod for veg + meat. 2026-07-28: the DISPLAY gap that held non-paint rollout is CLOSED (SPEC-adoption-generalize) — the referenced display in both the app and the customer storefront is now PRESENCE-DRIVEN (a block renders only if the item carries that data, so paint keeps swatches/combos and veg shows no paint artifacts), per-product units are wired (step-1 units = the allowed SET, each item picks its own), and commercials are generic {price, unit} with a price_per_litre fallback so existing adoptions keep rendering AND pricing; the API order-pricing read was widened to match (additive — it would otherwise have priced non-paint orders as NaN). Both halves deployed to prod. Regression: scripts/check-adoption.js lifts the real renderers out of app.html — 11/0, run against the DEPLOYED file, and proven to FAIL against the pre-fix build. STILL L3, deliberately: no HUMAN live-run of a real veg/meat adoption + storefront order yet, and the L4 gate (tighten-only enforcement test, metering/plan-ceiling) is untouched by this pass.',
    features: [
      {
        n: 'Source-as-entity — a brand AUTHORS its own catalogue source + experience + formatting (owner-gated); the item runs under the source, not the host (b78)',
        s: 'done'
      },
      {
        n: 'Source RULES enforced at order — the distributor CANNOT override (e.g. min-order set by the brand); stamped governed{} on each order line (b78)',
        s: 'done'
      },
      { n: 'Multi-source in one distributor — items namespaced by source, each runs under its own source@v; a mixed cart splits per source', s: 'done' },
      {
        n: 'Container model — a mutable product pointer over IMMUTABLE write-once versions; enhance moves the pointer, every chit PINS the exact version it saw (verifiable forever) (b80)',
        s: 'done'
      },
      {
        n: 'Regional scatter ("spin the globe") — resolve-at-mint into a SEALED regional blueprint (currency · units · language · jurisdiction); runtime is O(1) dereference (b81)',
        s: 'done'
      },
      {
        n: 'Multilingual storefront — UI labels per region language (en/es/zh/ja/fr/de/ta/hi); 11 regions live incl. Tamil TN + Hindi HI (b83 + b84)',
        s: 'done'
      },
      { n: 'Consent location → AGGREGATE-only penetration heatmap — structurally no customer PII (no customer-id column); owner-gated read (b79)', s: 'done' },
      { n: 'ERP handoff — receipt-only (refs + routing + sha256, never the raw payload), process-then-forget; per-distributor RLS (b82)', s: 'done' },
      { n: 'Visualize-apply — "see it on your wall": a cheap client-side recolor loop today; real vision model behind the same UI later', s: 'partial' },
      {
        n: '⚙ SELF-SERVE SETUP WIZARD — any store authors a catalogue in a 6-step wizard → committed face; standards-adopted (JSON Schema · RFC 7386 merge-patch · MDM golden-record · GS1 SKU via catalogue-model.js)',
        s: 'done'
      },
      {
        n: 'PUBLISH-as-blueprint — a store exposes its catalogue as an adoptable source (drives b78 from the UI); distributors adopt by reference (own unit/price) or by value (copy) — mutually exclusive, no double-create',
        s: 'done'
      },
      {
        n: 'AI-ENRICH — item names → local names · botanical name · category via the catalogue-enrich skill (b113) over the deployed /ai-draft; enrichment travels in the blueprint',
        s: 'done'
      },
      {
        n: 'Real CRUD + persistence — owned items → catalogue_items (prodAdd); face config → catalogue_face cross-device (b112); photos matched by filename → thumbnails travel in the blueprint',
        s: 'done'
      },
      { n: 'Searchable + vertical-FAMILY-filtered blueprint picker (food/materials/precious…) — ask meat, see the edible family', s: 'done' },
      {
        n: 'Vertical-agnostic referenced DISPLAY — presence-driven in app + storefront (paint keeps swatches/combos; veg shows name · local/botanical · photo · price, no empty chips or COLOUR COMBINATIONS header); per-product units (allowed SET → per-item pick, Tomato kg + Egg count in one catalogue); generic {price, unit} commercials with price_per_litre fallback (SPEC-adoption-generalize, deployed)',
        s: 'done'
      },
      {
        n: '⏳ HUMAN live-run of a non-paint adoption end-to-end (adopt → two units → storefront ORDER) — the last unproven step of the above; renderers verified by contract test against the deployed file, but nobody has driven it in a browser',
        s: 'partial'
      },
      { n: 'Real FX · metering / plan-ceiling · real-ERP adapter behind the seam — the L4→L5 gate', s: 'backlog' },
      // ── 2026-08-06 · the catalogue round trip, variants, and the three-tier visibility ──
      { n: 'TEMPLATE — a blank sheet that IS the declaration (cart→price · range→band · payload→none); no template file exists to drift', s: 'done' },
      {
        n: 'PREFLIGHT — an upload is READ before it becomes data: exact · synonym · contains · fuzzy · ambiguous · not-accepted · unmatched · BLOCKED, each with a reason (65 assertions)',
        s: 'done'
      },
      {
        n: 'IMPORT with a DECISION PER COLUMN — map · create · ignore; a column with no decision is ignored, never imported on a suggestion. Never deletes; new fields are always OPTIONAL',
        s: 'done'
      },
      {
        n: '⚠ GOVERNANCE NEVER TRAVELS IN A CELL — order_input · quantity · *_currency · ids are refused at any confidence, in the template AND on import',
        s: 'done'
      },
      {
        n: 'VARIANTS + declared IDENTITY — one product, many purchasable lines, each with its OWN price; key is a LIST (pharma batch_no, hs_code+origin). No migration: catalogue_face.face.identity',
        s: 'done'
      },
      {
        n: 'ONE READ (catalogue-read.lines) — owned + adopted in one list with PER-FIELD provenance; edit_scope all|overlay + i_own_source. Two stores, one read',
        s: 'done'
      },
      {
        n: 'The catalogue follows the CONTAINER, the chit pins the VERSION — release v2 and every distributor reflects it while an existing chit stays on what it saw (prove-one-roof 17/17)',
        s: 'done'
      },
      { n: 'CSV EXPORT — a merchant can leave the way they arrived; money splits into amount + currency so a spreadsheet can still sum it', s: 'done' },
      {
        n: 'STANDARD SETS per trade — an empty catalogue is not a blank page; each field declares WHERE its value comes from (four legs), and customer/compute fields never become product columns',
        s: 'done'
      },
      {
        n: '⚠ An unpriced adopted line is NOT advertised — hidden from a price-showing shop, never deleted, and the count is reported to the owner',
        s: 'done'
      },
      { n: '☐ IMPORT still reads catalogue_items directly, not lines() — so an ADOPTED catalogue does not appear in its owner CSV export', s: 'backlog' },
      {
        n: '☐ Reorder / delete-or-hide a field; identity key hardcoded per-entity has no UI; price OVERLAY (time dimension) for offers + a daily gold rate',
        s: 'backlog'
      }
    ]
  },
  {
    id: 'network',
    name: 'Network — one shopfront, many entities',
    icon: '🏬',
    load: 'lazy',
    maturity: 2,
    target: 4,
    gov: 2,
    govTarget: 4,
    governedUnder: 'the network tree (cb_entity ltree) + each member’s own visibility',
    governedBy: [
      'three tiers public|network|private, enforced at READ with the viewer in hand',
      'membership is BILATERAL (placed on the tree), unlike a self-asserted supplier link',
      'the operator cap closes the network tier too',
      'a refusal is byte-identical to a shop that never existed'
    ],
    govGap: [
      'no HUMAN live-run of the build or the network storefront page — by the review gate, a script is not a live-run',
      'an entity can be MOVED off the tree only by SQL; there is no “leave the network”',
      'a partner who accepts is connected but still not PLACED on the tree — accepting an invitation does not yet make them a member'
    ],
    blurb:
      'A departmental store: clothing, pharmacy, grocery and a warehouse, each its own entity with its own catalogue, currency and order mode. A shopper calls the NETWORK and browses all of it; the warehouse is invisible outside and visible to its siblings. The chit goes to the department with the network on CC.',
    features: [
      { n: 'THREE TIERS — public · network · private (b115). network = members of the same network only: the warehouse case', s: 'done' },
      { n: '⚠ Enforced at READ, not only at write — an entity capped AFTER it published still resolves closed', s: 'done' },
      {
        n: 'The supplier hop is the ROUTE; network membership is the AUTHORITY. An outsider taking the identical path sees nothing (dept-store-demo 12/0)',
        s: 'done'
      },
      { n: 'Membership is ONE query whatever the depth — cb_entity.path is an ltree, so a network is a shared root', s: 'done' },
      {
        n: 'NETWORK STOREFRONT — one page over every public department: DEPARTMENT → CATEGORY → PRODUCT → LINE, searchable, each department keeping its own currency (network-view 17/0)',
        s: 'done'
      },
      {
        n: 'A category is NEVER invented — declared ones group, the rest fall to “Everything else”. A shopper cannot tell a classification from a guess',
        s: 'done'
      },
      { n: 'A private department is ABSENT from the payload — its name appears nowhere, so searching for it cannot confirm it exists', s: 'done' },
      {
        n: '“Your place in the network” — the live tree in-app with this store in bold and the value chain root→you; kept separate from the DESIGN draft',
        s: 'done'
      },
      { n: 'Operator cap (params_override.caps) — a provisioned node cannot open itself; the switch renders LOCKED with who capped it', s: 'done' },
      {
        n: 'ARCHIVED — cb_catalogue_item/category (a third catalogue model nothing read). A network aggregates its members and holds no catalogue of its own',
        s: 'done'
      },
      {
        n: 'THE BUILD MINTS — the design page creates the stores it drew: an entity, a place on the tree and a sign-in code per owned node, in one transaction (network-build 15/0)',
        s: 'done'
      },
      {
        n: 'HUMAN-READABLE HANDLES — athi.clothing, ALWAYS two levels however deep the store sits; depth lives in the tree, not the name, so a co-assist stays ravi@athi.mens (handle 18/0)',
        s: 'done'
      },
      {
        n: '★ WHO MAY JOIN A NETWORK — answered. An OWNED node is created by the operator; a PARTNER is only ever INVITED and must accept. Nothing places an outsider on the tree unilaterally, which is what keeps the network tier honest',
        s: 'done'
      },
      {
        n: 'The provisioning cap is written AT THE MINT — a warehouse designed network-only is capped network-only and cannot publish itself from its own Settings screen',
        s: 'done'
      },
      {
        n: '⚠ A cap of “network” used to be silently ignored (capOf answered only public|private) — the middle rung is now enforced by rank, found while wiring this',
        s: 'done'
      },
      { n: 'Build twice = nothing twice — the result is written back into the design in the same transaction', s: 'done' },
      { n: 'Codes expire in 7 days and are shown once; the operator re-issues, exactly like a co-assist key', s: 'done' },
      { n: '☐ The chit does not yet CC the network automatically at order time (TO+CC already exists; the routing decision does not)', s: 'backlog' },
      { n: '☐ Accepting a partner invitation does not PLACE them on the tree — the consent exists, the placement does not', s: 'backlog' },
      { n: '☐ Multi-network entities (network visibility would then need to be per-network); leaving a network', s: 'backlog' }
    ]
  },
  {
    id: 'readiness',
    name: 'Trade ready — compliance + commerce',
    icon: '🛡️',
    load: 'lazy',
    maturity: 2,
    target: 4,
    gov: 2,
    govTarget: 4,
    governedUnder: 'the destination trade-lane rules + per-copy clearance isolation',
    governedBy: [
      'derive-not-enumerate lane predicate (origin ∪ destination ∪ universal)',
      'per-entity clearances WITH RLS',
      'honest trust ladder (registry-confirm ≠ format-check)',
      'commerce standards as SEALED source-entities (Incoterms/UCP/FRM, b93)'
    ],
    govGap: ['registry verification is format-only until a KYB key is connected', 'versioned evidence store (b94) not built', 'frontend live-run'],
    blurb:
      'The supplier’s readiness + the buyer’s confidence: per-destination clearances (spin the globe), a trust ladder (declared→documented→attested→verified), a self-proving reference, and the invariant commercial spine (instruments by FRM risk + the settlement chain). Each topic opens to its lifecycle. Backend harness-proven; the screen needs a human live-run.',
    features: [
      {
        n: 'Spin the globe — readiness resolved per DESTINATION (origin ∪ destination ∪ universal); derived, never enumerated (prove-readiness / prove-lanes)',
        s: 'done'
      },
      { n: 'Trust ladder per clearance — declared → documented → attested → verified (the RUNG is shown, not just met/not-met)', s: 'done' },
      {
        n: 'Machine-verify registry IDs (IEC/GSTN/PAN) — HONEST + KEY-READY: real KYB confirm → verified · format-only → declared · bad → 422 (prove-verify 8/0)',
        s: 'partial'
      },
      { n: 'Self-proving reference — supplier track record DERIVED from own settled chits, un-fakeable (prove-reference 9/0)', s: 'done' },
      {
        n: 'Commercial cover — EXIM instrument CLUSTER by risk; Incoterm routes cargo cover; mapped to canonical FRM classes (prove-commerce 18/0)',
        s: 'done'
      },
      { n: 'End-to-end settlement chain — partner type + de-risking instrument per stage', s: 'done' },
      { n: 'Commerce standards as SEALED source-entities — Incoterms 2020 / UCP 600 / FRM (b93, prove-commerce-standards 8/0)', s: 'done' },
      {
        n: 'Each topic is a LIFECYCLE — expand → stepper (you-are-here) + evidence + how you use it + how AI enables it (level + gate) + partner + snapshot-on-fold versioning',
        s: 'done'
      },
      { n: 'Real registry verification — drop a KYB key (Sandbox.co.in etc.); external integration, human-gated', s: 'backlog' },
      {
        n: 'Versioned evidence store (b94) — issuing-body cert link + shareable link + audit outcome + maintenance milestones, frozen on fold (SPEC-versioned-evidence)',
        s: 'backlog'
      },
      { n: 'Governing-partner delegation + opt-in buyer-facing track-record exposure', s: 'backlog' }
    ]
  },
  /**
   * ⭐⭐⭐ SIGN-IN AS A CAPABILITY (Athi, 2026-09-23, mid-fix on "entity OTP is not accepting": *"can you keep
   * it as a helper function, always implemented in one go everywhere... is it a capability, if so can you note
   * it down as a capability so you can search there very quickly."*)
   *
   * The proof it qualifies is the same test 'cart' and 'money-language' passed above: a CONTRACT (one lookup,
   * one verify, whatever the identity type), ONE implementation two routes now call instead of two divergent
   * copies, and real branch coverage (tests/identity-auth.test.js, 13 checks, in GUARDS).
   *
   * ⚠️ maturity 2 (packaged), not yet 3: chitbridge-api/lib/identity-auth.js is the one place — built
   * 2026-09-23, including the counter's own PIN prompt (usignPaint()/usignAsk() in till.html) — but nothing
   * yet FAILS A BUILD if a THIRD route grows its own OTP/PIN branch the way routes/actors.js's did for two
   * months before this. That guard, not the module, is the L3 lever.
   */
  {
    id: 'sign-in',
    name: 'Sign-in — one identity, entity or coassist',
    icon: '🔑',
    load: 'eager',
    maturity: 2,
    target: 3,
    /* ⭐ its CMDB record (2026-09-28, Athi: "linked in the cmdb database as part of this capability, so anyone can look
       at this"): stored in the cloud (definition kind 'cmdb'), drawn by the one page /cmdb/record.html */
    record: '/cmdb/record.html#CAP-SIGNIN',
    gov: 2,
    govTarget: 3,
    governedUnder: "the identities table (one row shape for entity and actor alike) + lib/resolveuserid.js's namespace grammar (docs/NAMESPACE.md)",
    governedBy: [
      "ONE FILE: chitbridge-api/lib/identity-auth.js — findLoginIdentity (adopts resolveuserid.classify(), never re-splits '@' by hand) · needsPin · issueOtp (routed through lib/dev-otp.js's fixedOtp, so a sealed environment cannot leak a fixed code) · verifyCredential (OTP or PIN, one attempt-lock shape) · personShape (one response shape both routes hand a client)",
      "routes/entities.js (/register · /verify — what the counter's Sign in dialog calls) and routes/actors.js (/login — OTP first time, PIN returning) both call it instead of each keeping its own copy",
      "the counter's own rules (chitbridge-api/lib/signin.js, TILL-183/187/188): door()/leave() decide which of four acts a button means; code()/verify() tell a 4-digit PIN from a 6-digit code by length; nothing on a selling screen ever prints a server sentence, an id or an HTTP code",
      'tests/identity-auth.test.js (13 checks: entity by email/handle, a coassist by the b260 form AND by the unsuffixed form a person actually types, ambiguity refused, the PIN lockout, personShape parity) + tests/signin.test.js (3 checks added the same day) — both in GUARDS'
    ],
    govGap: [
      'no guard yet fails a build if a new route grows its own OTP/PIN branch instead of calling this file — the exact drift that put routes/actors.js two months behind lib/dev-otp.js'
    ],
    blurb:
      'One lookup and one verify for whoever is signing in — a business by its handle or real email, a coassist by the b260 form or the name they naturally type — so an entity and a coassist stop being two authentication systems that happen to share a database column.',
    features: [
      { n: 'Entity sign-in — OTP, fixed to 123456 in dev via lib/dev-otp.js, a real code once sealed', s: 'done' },
      { n: 'Coassist sign-in — OTP the first time, their own PIN every time after, through the SAME counter box', s: 'done' },
      { n: 'The counter prompts for a PIN, not a code, once the server says use_pin — usignPaint()/usignAsk()', s: 'done' },
      { n: 'A guard that fails if a route re-implements OTP/PIN instead of calling this file', s: 'backlog' }
    ]
  },
  {
    id: 'help',
    name: 'Assistant',
    icon: '💬',
    load: 'eager',
    maturity: 1,
    target: 3,
    gov: null,
    governedUnder: '— static / read-only Q&A (nothing to govern)',
    blurb:
      'One context-sensitive Assistant (engine in Core). Q&A is served from the DB (GET /api/assist/questions) — nothing static in the frontend; the same store feeds the AI when wired.',
    features: [
      { n: 'Context-sensitive Q&A — page-aware to the SUB-VIEW (context chain: cockpit / dispute / chit → parent → nav), served from the DB', s: 'done' },
      { n: 'Honest tiered answer (deterministic library floor → LLM)', s: 'done' },
      { n: 'Tier-1 LLM over the /api/assist proxy', s: 'backlog' }
    ]
  },
  {
    id: 'legend',
    name: 'Legend (this map)',
    icon: '🔑',
    load: 'lazy',
    maturity: 2,
    target: 2,
    gov: null,
    governedUnder: '— read-only map (nothing to govern)',
    blurb: 'You are here. The live capability/feature catalogue — loads on demand.',
    features: [{ n: 'Capability → feature map with load + status + maturity', s: 'done' }]
  },
  // ── Planned capabilities (not built yet) — so the map also shows what is coming ──
  {
    id: 'relations-x',
    name: 'Relations (extract)',
    icon: '🔗',
    load: 'planned',
    blurb: 'Suppliers / Catalogue / Network to move OUT of Core into their own lazy cap.',
    features: [{ n: 'cap-relations extraction', s: 'backlog' }]
  },
  {
    id: 'employee',
    name: 'Employee / HR',
    icon: '🗂️',
    load: 'planned',
    blurb: 'People-management layer above co-assist basics — hours, pay, shifts, roster.',
    features: [{ n: 'Working hours · pay · roster', s: 'backlog' }]
  },
  {
    id: 'api-service',
    name: 'API as a service',
    icon: '🔌',
    load: 'planned',
    blurb: 'Machine-auth + OpenAPI so other systems connect. Design specced (prioritised).',
    features: [
      { n: 'M2M auth — OAuth2 client-credentials / API key + scopes', s: 'backlog' },
      { n: 'OpenAPI 3.1 + /docs + uniform envelope + /v1', s: 'backlog' },
      { n: 'Webhooks + per-key metering', s: 'backlog' }
    ]
  }
];

/* ── LIFECYCLE tab — requirements traceability (BR→SR→FR→Test). Mirrors TRACEABILITY.md.
 *    st: ok = verified-live · built = built, runtime-unverified (human gate) · todo = backlog. ── */
const TRACE_MATRIX = [
  {
    area: 'Dispute (the USP)',
    br: 'Two parties resolve a disagreement confidentially & per-party, no third party sees it.',
    sr: 'Per-party scoping (participant roster + visibility predicate) + per-party resolution on the isolated rail.',
    rows: [
      { id: 'FR-D1', fr: 'Only the raiser can resolve', test: 'Non-raiser resolve → 403', st: 'built' },
      { id: 'FR-D2', fr: 'Dispute message visible to participants only', test: 'dispute-scope.js: 3rd chit-party sees 0 (7/0)', st: 'ok' },
      { id: 'FR-D3', fr: 'Entity-name + who-raised attribution', test: 'Message shows entity + raiser', st: 'built' },
      { id: 'FR-D4', fr: 'Dispute [raised]/[resolved] + colour', test: 'Resolve → badge flips green', st: 'built' },
      { id: 'FR-D5', fr: 'Composer can reply AS a dispute', test: 'Toggle → stored is_dispute', st: 'built' },
      { id: 'FR-D6', fr: 'Close disputed = warn (allow); archive = block', test: 'Close → warning; archive → 409', st: 'built' },
      { id: 'FR-D7', fr: 'Per-entity dispute copies (nothing shared)', test: 'b68: own copy per party; cross-entity FK dropped', st: 'ok' }
    ]
  },
  {
    area: 'Connector (IoT / ERP)',
    br: 'External systems exchange records over the rail, processing then FORGETTING raw payloads (receipt-only).',
    sr: 'Connector = first-class actor (identities row) + connections; capability-gated (API-enforced); per-connection retention.',
    rows: [
      { id: 'FR-C1', fr: 'Create connector actor → shows in Co-assists', test: 'Create → lists + visible', st: 'todo' },
      { id: 'FR-C2', fr: 'Add endpoint (direction, ref, retention)', test: 'Add → endpoint shows', st: 'todo' },
      { id: 'FR-C3', fr: 'Enable/disable endpoint (kill switch)', test: 'Toggle → state flips', st: 'todo' },
      { id: 'FR-C4', fr: 'Emit signal → chit lands in Task', test: 'lifecycle-iot 45/0 + real Pi: received co-held', st: 'ok' },
      { id: 'FR-C5', fr: 'Routes capability-gated (403 if off)', test: 'Capability off → 403', st: 'built' },
      {
        id: 'FR-C6',
        fr: 'ERP process-then-forget: receipt-only, raw payload never stored, idempotent',
        test: 'erp-connector.js 23/0: hash+outcome kept, no raw payload, retry=1 effect, RLS-isolated',
        st: 'ok'
      }
    ]
  },
  {
    area: 'Catalogue — source-governed distribution',
    br: 'A brand governs the experience + rules of its catalogue, and that governance TRAVELS to any distributor that serves it — the item always runs under the source; CB does information + governed rail only, ERP does logistics.',
    sr: 'Source-as-entity authors catalogue_source (experience/rules); governance resolves from source@v not host; container = mutable pointer over immutable versions (each chit pins the version); regional resolve-at-mint sealed; two-class RLS (catalogue = share-read reference, erp_handoff = per-copy WITH RLS); penetration structurally PII-free (b75-b84).',
    rows: [
      {
        id: 'FR-K1',
        fr: 'Brand authors its own source + experience (owner-gated)',
        test: 'source-entity.js 6/0 — owner stamped, experience read back',
        st: 'ok'
      },
      {
        id: 'FR-K2',
        fr: 'Source rule enforced at order; distributor cannot override',
        test: 'source-rules.js 3/0 — below-min <span class=arw>→</span> 422 "set by <source>"',
        st: 'ok'
      },
      {
        id: 'FR-K3',
        fr: 'Multi-source per-source governance in one distributor',
        test: 'multi-source.js 6/0 — same finish name, different source rule',
        st: 'ok'
      },
      {
        id: 'FR-K4',
        fr: 'Enhance moves the pointer; a pinned chit still resolves its original version',
        test: 'container-model 8/0 + container-wiring 6/0 — v1 pinned resolves after v2',
        st: 'ok'
      },
      {
        id: 'FR-K5',
        fr: 'Spin the globe — region resolves currency/units/language/jurisdiction, sealed',
        test: 'regional-scatter.js 8/0 — IN/MX/US/EU + sealed cache-hit',
        st: 'ok'
      },
      { id: 'FR-K6', fr: 'Penetration is aggregate-only (no customer PII)', test: 'penetration.js 6/0 — owner-gated, no customer-id column', st: 'ok' },
      { id: 'FR-K7', fr: 'ERP handoff receipt-only (no raw payload), per-distributor RLS', test: 'erp-handoff.js 7/0 — hash+status, RLS-isolated', st: 'ok' },
      { id: 'FR-K8', fr: 'Catalogue / blueprint structural conformance', test: 'conform-check.js 10/0', st: 'ok' },
      {
        id: 'FR-K9',
        fr: 'Storefront renders region language + visualize-apply',
        test: 'MANUAL — Athi storefront confirm 2026-07-10 (frontend, human-gated)',
        st: 'built'
      }
    ]
  },
  {
    area: 'Foundation — RLS isolation',
    br: "Every entity's data is its own — a governance leveler, same isolation solo→multinational.",
    sr: 'Postgres RLS: app = cb_app (NOBYPASSRLS); withEntity() sets app.current_entity; ALL entity-data tables enforce FORCE rls_entity, per-copy (b48-b68).',
    rows: [
      { id: 'FR-F1', fr: 'Entity reads only its own rows', test: 'regression suite: non-participant sees 0 across all tables', st: 'ok' },
      { id: 'FR-F2', fr: 'Cross-entity write only via governed fns', test: 'chit_deliver rejects bad sender', st: 'ok' },
      { id: 'FR-F3', fr: 'Schema reproducible + change-controlled', test: 'Baseline rebuilds prod on scratch DB', st: 'todo' }
    ]
  },
  {
    area: 'Core — the mailbox rail',
    br: 'Parties exchange sealed, co-held REPLICATED records ("chits") — each holds its own copy, nothing shared.',
    sr: 'Per-entity copy keyed (chit_id, entity_id, direction); every related table per-copy too (messages/attachments/disputes); append-only state_log; seal = schema snapshot.',
    rows: [
      { id: 'FR-M1', fr: 'Compose → deliver co-held chit', test: 'Send → both copies, right direction', st: 'built' },
      { id: 'FR-M2', fr: 'Advance status (direction-scoped) + logged', test: 'Advance → state_log + badge', st: 'built' },
      { id: 'FR-M3', fr: 'Assign (push/bulk/pool, hat-gated)', test: 'Assign → bound, gate respected', st: 'built' }
    ]
  }
];

/* ── SECURITY tab — verified from code/package-lock 2026-07-05. lvl: strong ✓ · partial ◐ · gap ○ ── */
const SEC_POSTURE = [
  {
    area: 'In transit',
    lvl: 'strong',
    what: 'TLS everywhere — HTTPS on web (Vercel) + API (Railway); TLS to Postgres (Supabase).',
    raise: 'DB uses rejectUnauthorized:false (encrypted, cert NOT verified) — pin the cert to fully close MITM.'
  },
  {
    area: 'At rest',
    lvl: 'partial',
    what: 'Provider disk encryption (Supabase/AWS, AES-256). No app/column-level encryption — payloads, messages, PII (GSTN/address/phone) are plaintext in Postgres, protected by RLS + disk crypto.',
    raise: 'Add column-level encryption (pgcrypto/pgsodium) for PII + chit payloads.'
  },
  {
    area: 'Auth secrets',
    lvl: 'strong',
    what: 'PINs & passwords bcrypt-hashed (bcryptjs). JWT HS256, server-side only, never in browser, boot-time secret guard. OTP is ephemeral (6-digit, expiring) + attempt-capped + rate-limited.',
    raise: 'Hash/short-TTL OTP is fine; consider rotating JWT to asymmetric (RS256) for multi-service.'
  },
  {
    area: 'Perimeter',
    lvl: 'strong',
    what: 'helmet security headers + express-rate-limit (auth + assist brute-force blunting).',
    raise: 'Add per-account lockout metrics + WAF at the edge.'
  },
  {
    area: 'Access control',
    lvl: 'strong',
    what: 'RLS entity isolation LIVE + per-copy — cb_app is NOSUPERUSER NOBYPASSRLS; every query scoped by app.current_entity; ALL entity tables FORCE-RLS (b48-b68).',
    raise:
      'DONE 2026-07-08 — RLS now covers folder/attachments/messages/disputes too (per-copy); only identities is the deliberate directory carve-out. Next: external pen-test → L5.'
  },
  {
    area: 'Secrets & audit',
    lvl: 'gap',
    what: 'Secrets in Railway env vars, not a vault/KMS. No external pen-test yet (so security honestly ≤ L4).',
    raise: 'Move secrets to a KMS/vault; commission an external pen-test → the L5 gate.'
  }
];

/* ── FOUNDATIONS — the SECOND axis: what the subject STANDS ON. Capabilities need only WORK; a foundation needs
 *    EVIDENCE, so each carries a PROOF. Ladder (security flavor): L1 exists · L2 clean mechanism · L3 enforced &
 *    isolated · L4 governed & provable · L5 audited/certified. Mirrors FOUNDATIONS-SCORECARD.md. ── */
const FOUNDATION_CATALOGUE = [
  {
    name: 'Multitenant isolation (RLS)',
    icon: '🔒',
    level: 4,
    target: 5,
    what: 'App connects as cb_app (NOSUPERUSER NOBYPASSRLS); EVERY entity-data table has FORCE RLS + an rls_entity policy; every query runs on withEntity(app.current_entity); cross-entity writes ONLY via SECURITY DEFINER fns.',
    proof:
      'Live regression suite (100+ assertions across regression / dispute-scope / actor / lifecycle-iot / erp) — a non-participant reads 0. Live in prod since 2026-07-04; per-copy hardened 2026-07-08 (b48–b69).'
  },
  {
    name: 'Sealed co-held record (the rail)',
    icon: '📜',
    level: 3,
    target: 4,
    what: 'A chit is delivered as per-entity REPLICATED copies (nothing shared) + an append-only state_log; delivery via chit_deliver / chit_message_deliver / chit_dispute_deliver.',
    proof: 'regression.js — per-copy delivery, cross-entity isolation, and INDEPENDENT delete (one party deletes; the other party’s copy survives).'
  },
  {
    name: 'Transaction atomicity',
    icon: '⚛️',
    level: 3,
    target: 4,
    what: 'The per-copy fan-out is ALL-OR-NOTHING: a SECURITY DEFINER delivery fn writes every participant’s copy inside ONE transaction, so a mid-fan-out failure leaves NO partial copies. Dispute + timeline commit together (INV-2); the ERP path uses a receipt-as-lock for exactly-once.',
    proof:
      'chit_deliver / chit_dispute_deliver are single-statement definer calls (one tx); the regression suite never observes a partial delivery; erp-connector.js proves receipt-lock idempotency (retry = one receipt, one effect).'
  },
  {
    name: 'Dispute confidentiality (the USP)',
    icon: '⚑',
    level: 3,
    target: 4,
    what: 'Per-copy: each party holds its OWN chit_disputes copy (b68, FORCE RLS); dispute_participants retired; dispute messages replicated to the roster ONLY.',
    proof: 'dispute-scope.js — a 3-party chit + a targeted dispute → the chit party NOT in the dispute sees 0 (7/0).'
  },
  {
    name: 'Governance cascade',
    icon: '🏛️',
    level: 2,
    target: 4,
    what: 'Constitution + version-freeze + provenance; unified mint path (b47). Tighten-only intent across the 7 governance layers.',
    proof: 'To build: tighten-only enforcement test + provenance on minted entities (design specced, not yet enforced).'
  }
];

/* ── SUBJECT tab — the core reframe: the sealed co-held record is a SUBJECT (a noun), not a functionality. The
 *    capabilities are lifecycles (verbs) that act ON it. The clearest contrast is a shared-document tool. ── */
function _subjectTabHtml() {
  const vs = (them, us) =>
    '<tr style="border-top:1px solid var(--line)"><td style="padding:6px 9px;color:var(--grey);vertical-align:top">' +
    them +
    '</td><td style="padding:6px 9px;color:var(--ink);font-weight:600;vertical-align:top">' +
    us +
    '</td></tr>';
  const g = (t, m, alt) =>
    '<div style="display:flex;gap:10px;padding:6px 10px;font-size:var(--fs-1);' +
    (alt ? 'background:var(--blue-tint-bg);' : '') +
    ';color:var(--on-card)"><span style="flex:0 0 122px;font-weight:700;color:var(--blue)">' +
    t +
    '</span><span style="color:var(--ink);line-height:1.45">' +
    m +
    '</span></div>';
  return (
    '<div style="padding:14px 16px;overflow:visible">' +
    // RAIL — the hero picture (public asset; scalable vector)
    '<img src="/rail-metaphor.svg" alt="Chit &amp; Bridge — a governed rail: two tracks (Task, Order), wagon = your business, private yards, dispute siding, network" loading="lazy" style="width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--on-card)"/>' +
    '<div style="border:1px solid #cbd8ec;background:linear-gradient(180deg,#f6f9fe,#fff);border-radius:13px;padding:14px 16px;margin:10px 0 14px">' +
    '<div style="font-family:\'Space Grotesk\';font-weight:800;font-size:var(--fs-4);color:var(--ink)">Chit &amp; Bridge is a governed rail</div>' +
    '<div style="font-size:var(--fs-2);color:var(--ink);line-height:1.55;margin-top:6px"><b>Content-neutral, governance-absolute.</b> You decide <b>what</b> moves between two entities — the business defines that; we guarantee that <b>whatever moves is governed</b>. A train can\'t leave the track.</div>' +
    '<div style="font-size:var(--fs-2);color:var(--blue-2);background:var(--blue-tint);border:1px solid var(--blue-tint-line);border-radius:9px;padding:8px 11px;margin-top:10px">🧭 <b>' +
    tx('As easy as a mailbox') +
    '</b> for the end user — zero learning curve. The mailbox is how it <i>feels</i>; the rail is what it <i>is</i>.</div>' +
    '</div>' +
    '<div style="font-size:var(--fs-1);font-weight:700;color:var(--ink);margin-bottom:5px">The subject — the sealed, co-held record <span style="color:var(--grey);font-weight:600">(the &ldquo;chit&rdquo;)</span></div>' +
    '<div style="font-size:var(--fs-2);color:var(--ink);line-height:1.55;margin-bottom:11px">Each item is a <b>governed obligation, replicated per party</b> — your own sealed copy, disputable on divergence. It is the <b>noun</b> everything else acts on; the capabilities are the <b>verbs</b>. Two tracks — <b>' +
    tx('Task') +
    '</b> (coming to you) and <b>' +
    tx('Order') +
    '</b> (going from you) — carry it; the <b>wagon is your business</b>, and the rail never opens it.</div>' +
    '<div style="font-size:var(--fs-1);font-weight:700;color:var(--ink);margin-bottom:5px">Why it isn&rsquo;t just email — or a shared workspace</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:var(--fs-1);border:1px solid var(--line);border-radius:9px;overflow:hidden">' +
    '<tr style="background:var(--neutral-tint);color:var(--grey);font-weight:700;font-size:var(--fs-1)"><td style="padding:6px 9px">' +
    tx('Them') +
    '</td><td style="padding:6px 9px">Chit &amp; Bridge — the governed rail</td></tr>' +
    vs('<b>Email:</b> carries anything, guarantees nothing', 'Every item <b>sealed, isolated, disputable</b>') +
    vs('<b>Confluence:</b> one shared document', 'N sealed copies — one per party') +
    vs('Edit-in-place, last-writer-wins', 'Append-only; atomic per-copy fan-out') +
    vs('Access control = who may see it', 'Isolation = you only ever hold YOUR copy') +
    vs('Divergence is a merge conflict', 'Divergence is a DISPUTE — a private siding') +
    '</table>' +
    '<div style="font-size:var(--fs-1);font-weight:700;color:var(--ink);margin:14px 0 5px">' +
    tx('Rail glossary — the whole vocabulary in one place') +
    '</div>' +
    '<div style="border:1px solid var(--line);border-radius:9px;overflow:hidden">' +
    g('🛤️ Rail', 'governance itself — the track a train cannot leave', false) +
    g('Two tracks', 'Task (coming to you) · Order (going from you)', true) +
    g('Wagon / bogie', 'your business — the form you define; the rail never opens it', false) +
    g('Cargo', 'your data inside the wagon — never inspected', true) +
    g('Private yard', 'your isolated copy (RLS) — your wagons, yours alone', false) +
    g('Travel together', 'coupled on the journey, yet each keeps its own wagon (co-held AND per-copy)', true) +
    g('Signals', 'statuses — open · act · close · reopen; governed, stamped on the log', false) +
    g('Service', 'a scheduled multi-stop run (vs a one-hop parcel = a goods order)', true) +
    g('Private siding', 'a dispute — confidential, per-party; the network runs past', false) +
    g('Network', 'reachable destinations — public map, private yards', true) +
    g('Crew', 'co-assists: human · IoT · ERP · AI — same rail, same rules', false) +
    g('Roam the bogies', 'one connection, many facilities — never tied to one', true) +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:11px;line-height:1.5">We <b>replicate ownership</b> instead of <b>sharing access</b> — and it still feels like an inbox. See <b>' +
    tx('🧱 Foundations') +
    '</b> for the proofs, and <b>⬢ Capabilities</b> for the lifecycles built on it.</div>' +
    '</div>'
  );
}

/* ── FOUNDATIONS tab — the trust floor as maturity + PROOF (core hardening + atomicity now first-class). ── */
function _foundTabHtml() {
  const lvlBadge = (l, t) => {
    const tt = t && t > l ? '<span class=arw>→</span>L' + t : '';
    return (
      '<span title="Foundation maturity — L1 to L5, see the Legend" style="font-size:var(--fs-1);font-weight:800;color:var(--ok-2);background:var(--ok-tint);border:1px solid #bfe0cf;border-radius:6px;padding:1px 7px">L' +
      l +
      tt +
      '</span>'
    );
  };
  const card = (f) =>
    '<div style="border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-bottom:10px">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:var(--fs-3)">' +
    f.icon +
    '</span><span style="font-family:\'Space Grotesk\';font-weight:700;font-size:var(--fs-3)">' +
    esc(f.name) +
    '</span><span style="margin-inline-start:auto">' +
    lvlBadge(f.level, f.target) +
    '</span></div>' +
    '<div style="font-size:var(--fs-2);color:var(--ink);line-height:1.5;margin-bottom:6px">' +
    esc(f.what) +
    '</div>' +
    '<div style="font-size:var(--fs-2);color:var(--grey);line-height:1.5;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:8px 10px"><b style="color:var(--ok-3)">PROOF:</b> ' +
    esc(f.proof) +
    '</div>' +
    '</div>';
  return (
    '<div style="padding:12px 13px;overflow:visible">' +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:10px">What the <b>subject</b> stands on — the trust floor. A capability needs only to WORK; a <b>foundation needs EVIDENCE</b>, so each carries the PROOF that makes its level evident, not asserted. Ladder: L1 exists · L2 clean mechanism · L3 enforced &amp; isolated · L4 governed &amp; provable · L5 audited/certified.</div>' +
    FOUNDATION_CATALOGUE.map(card).join('') +
    '<div style="font-size:var(--fs-1);color:var(--grey);text-align:center;padding-top:2px">Security foundations are honestly capped <b>' +
    tx('≤ L4') +
    '</b> until an external pen-test exists — that’s the L5 gate.</div>' +
    '</div>'
  );
}

/* ── GOVERNANCE STACK tab — the full architecture, universe → chit (the governance-stack.svg). ── */
function _stackTabHtml() {
  return (
    '<div style="padding:12px 13px">' +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:9px;line-height:1.55">The full governance stack — <b>universe <span class=arw>→</span> chit</b>, one spine. Every value is an <b>attribute (data)</b> the engine reads; nothing governance lives in code. Colour: <span style="color:var(--ok-3);font-weight:700">proven live</span> · <span style="color:var(--warn-2);font-weight:700">vision / design</span>. Spinning a new platform (e.g. AWS · Mexico · service-desk) = one row.</div>' +
    '<img src="/governance-stack.svg" alt="Chit &amp; Bridge governance stack — universe to chit" loading="lazy" style="width:100%;height:auto;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--on-card)"/>' +
    '</div>'
  );
}

function _lbTabBar() {
  const tab = typeof _lbTab !== 'undefined' ? _lbTab : 'subject';
  const btn = (id, label) =>
    `<button data-cbsid="SCR006-B01" onclick="setLbTab('${id}')" style="border:0;background:none;cursor:pointer;padding:8px 15px;font-size:var(--fs-3);font-weight:${tab === id ? '700' : '500'};color:${tab === id ? 'var(--ink)' : 'var(--grey)'};border-bottom:2px solid ${tab === id ? 'var(--accent,var(--blue))' : 'transparent'}">${label}</button>`;
  return `<div style="display:flex;gap:2px;border-bottom:1px solid var(--line);padding:0 8px;flex-wrap:wrap">${btn('subject', '📜 The subject')}${btn('stories', '📖 The Life of…')}${btn('found', '🧱 Foundations')}${btn('stack', '🏛️ Governance stack')}${btn('work', '⬡ Work patterns')}${btn('std', '📐 Standards')}${btn('cap', '⬢ Capabilities')}${btn('edge', '🎯 The edge')}${btn('life', '🔀 Lifecycle')}${btn('sec', '🔒 Security')}${btn('real', '🔬 Reality')}</div>`;
}
function setLbTab(t) {
  _lbTab = t;
  _openLegendImpl();
}
/**
 * ⚠️⚠️ THE LEGEND HAD ITS OWN A− / A+ — a SECOND implementation of panel zoom, with its own storage key
 * (`cb_lb_fs`) and its own clamp, beside makeMovable's. Both are gone as of 2026-08-29. Athi: *"A+, A- as font
 * resizing is not required any more as we have the visuals standards."*
 *
 * ⭐ Two copies of a control is the argument against it in miniature: they disagreed. makeMovable clamped
 * 0.8–1.6, this clamped 0.85–1.6, and neither knew about Settings › Appearance, which is the one that actually
 * governs text size across all 2,372 tokenised declarations.
 *
 * ⚠️ THE STORED VALUE IS CLEARED, NOT JUST IGNORED. A reader who had shrunk the Legend would otherwise keep a
 * permanently small board with nothing left on screen to undo it.
 */
try {
  localStorage.removeItem('cb_lb_fs');
} catch (_) { /* storage blocked or full: the page works without it */ }

function _lifeTabHtml() {
  const SS = { ok: ['var(--ok-3)', '✅'], built: ['var(--warn-2)', '◐'], todo: ['var(--grey-4)', '○'] };
  const row = (r) => {
    const [c, ic] = SS[r.st] || SS.todo;
    return `<div style="display:flex;gap:8px;align-items:flex-start;font-size:var(--fs-1);padding:3px 0;border-bottom:1px dashed var(--line)"><span style="color:${c};flex:none">${ic}</span><span class="mono" style="flex:none;color:var(--grey);width:46px">${esc(r.id)}</span><span style="flex:1">${esc(r.fr)}</span><span style="flex:1;color:var(--grey)">${esc(r.test)}</span></div>`;
  };
  const grp = (g) => `<div style="border:1px solid var(--line);border-radius:12px;padding:12px 13px;margin-bottom:11px">
      <div style="font-family:'Space Grotesk';font-weight:700;font-size:var(--fs-2);margin-bottom:4px">${esc(g.area)}</div>
      <div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:2px"><b>BR:</b> ${esc(g.br)}</div>
      <div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:8px"><b>SR:</b> ${esc(g.sr)}</div>
      <div style="display:flex;gap:8px;font-size:var(--fs-1);color:var(--grey);font-weight:700;padding-bottom:2px"><span style="width:54px">&nbsp;</span><span style="flex:1">${tx('FUNCTIONAL (FR)')}</span><span style="flex:1">${tx('TEST')}</span></div>
      ${g.rows.map(row).join('')}
    </div>`;
  return `<div style="padding:12px 13px;overflow:visible">
    <div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:10px">How we work the lifecycle: every behaviour traces <b>Business <span class=arw>→</span> System <span class=arw>→</span> Functional <span class=arw>→</span> ${tx('Test')}</b>. <span style="color:var(--ok-3)">${tx('✅ verified-live')}</span> · <span style="color:#a9791f">◐ built, needs a live run</span> · <span style="color:var(--grey-4)">${tx('○ backlog')}</span>.</div>
    ${TRACE_MATRIX.map(grp).join('')}
    <div style="font-size:var(--fs-1);color:var(--grey);text-align:center;padding-top:2px">Most rows are ◐ — built + parse/boot-checked; each ✅ needed a human live-run or a script. Automated tests turn ◐ <span class=arw>→</span> ✅ at scale.</div>
  </div>`;
}

/* ── THE LIFE OF… tab — the business-narrative reference set (followable stories, not feature ads) ── */
function _storiesTabHtml() {
  const list = [
    {
      icon: '📜',
      name: 'The Life of a Chit',
      blurb: 'How one obligation travels the governed rail — composed, delivered per-copy, acted, disputed, settled. The conceptual anchor.',
      url: 'https://claude.ai/code/artifact/c4696068-9bfd-4079-a425-6c8d81592bdc?via=auto_preview'
    },
    {
      icon: '🏛️',
      name: 'The Life of an Entity',
      blurb: 'DDL → DML: author the source-entities → the boilerplate → mint an entity → its chits. Define the mould once, mint many.',
      url: 'https://claude.ai/code/artifact/93ccd05b-fd3a-4068-a47f-9faa41d6e4b0?via=auto_preview'
    },
    {
      icon: '🌍',
      name: 'The Life of a Trade',
      blurb:
        'One chemical shipment, buyer → seller: real template evidence moving across the engine. Swap the industry and the standards change; the commercial spine and the rail do not.',
      url: '/docs/life-of-a-trade.html'
    }
  ];
  const card = (
    x
  ) => `<a href="${x.url}" target="_blank" rel="noopener" style="display:block;text-decoration:none;border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:11px;background:var(--card);color:var(--on-card)">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px"><span style="font-size:var(--fs-5)">${x.icon}</span><span style="font-family:'Space Grotesk';font-weight:700;font-size:var(--fs-3);color:var(--ink)">${esc(x.name)}</span><span style="margin-inline-start:auto;font-size:var(--fs-2);color:var(--accent,var(--blue));font-weight:700">${tx('Open ↗')}</span></div>
    <div style="font-size:var(--fs-2);color:var(--grey);line-height:1.5">${esc(x.blurb)}</div></a>`;
  return `<div style="padding:12px 13px;overflow:visible">
    <div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:12px">The <b>business narratives</b> — the product told from the value side, followable end-to-end (not feature ads). Open each in a new tab.</div>
    ${list.map(card).join('')}
    <div style="font-size:var(--fs-1);color:var(--grey);text-align:center;padding-top:2px">Companion set to the ⬢ Capabilities map — the “what it feels like” beside the “what’s built”.</div>
  </div>`;
}

function _secTabHtml() {
  const LV = { strong: ['var(--ok-3)', '✓ strong'], partial: ['var(--warn-2)', '◐ partial'], gap: ['var(--disp)', '○ gap'] };
  const row = (s) => {
    const [c, lbl] = LV[s.lvl] || LV.gap;
    return `<div style="border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-bottom:9px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-family:'Space Grotesk';font-weight:700;font-size:var(--fs-2)">${esc(s.area)}</span><span style="margin-inline-start:auto;font-size:var(--fs-1);font-weight:800;color:${c}">${lbl}</span></div>
      <div style="font-size:var(--fs-1);color:var(--ink);line-height:1.45;margin-bottom:4px">${esc(s.what)}</div>
      <div style="font-size:var(--fs-1);color:var(--grey);line-height:1.4"><b>Raise it:</b> ${esc(s.raise)}</div>
    </div>`;
  };
  return `<div style="padding:12px 13px;overflow:visible">
    <div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:10px">What protects your data today (verified from code, 2026-07-05). Honest levels: <span style="color:var(--ok-3)">${tx('✓ strong')}</span> · <span style="color:#a9791f">${tx('◐ partial')}</span> · <span style="color:var(--disp)">${tx('○ gap')}</span>.</div>
    ${SEC_POSTURE.map(row).join('')}
    <div style="font-size:var(--fs-1);color:var(--grey);text-align:center;padding-top:2px">Encryption in transit (TLS) is solid; at-rest is provider disk-level (not per-column) and there is no external pen-test yet — so security is honestly capped ≤ L4 until audited.</div>
  </div>`;
}

/* ── EDGE tab — positioning hypothesis vs alternatives (NOT a scoreboard; our dot is a TARGET) ── */
function _edgeTabHtml() {
  const pt = (x, y, label, hl) =>
    '<div style="position:absolute;inset-inline-start:' +
    x +
    '%;bottom:' +
    y +
    '%;transform:translate(-50%,50%);text-align:center;z-index:2">' +
    '<div style="width:' +
    (hl ? 15 : 10) +
    'px;height:' +
    (hl ? 15 : 10) +
    'px;border-radius:50%;margin:0 auto;background:' +
    (hl ? 'var(--blue)' : 'var(--grey-4)') +
    ';' +
    (hl ? 'box-shadow:0 0 0 5px rgba(63,102,166,.16)' : '') +
    '"></div>' +
    '<div style="font-size:var(--fs-1);margin-top:3px;white-space:nowrap;color:' +
    (hl ? 'var(--blue-2)' : 'var(--grey)') +
    ';font-weight:' +
    (hl ? '700' : '500') +
    '">' +
    esc(label) +
    '</div></div>';
  const stage = (l, s, k) => {
    const on = k === 'now',
      nx = k === 'next',
      dn = k === 'done';
    const bg = on ? 'var(--blue-tint)' : nx ? '#fff' : 'var(--card)',
      bd = on ? 'var(--blue)' : 'var(--line)',
      col = on ? 'var(--blue-2)' : dn ? 'var(--grey-2)' : 'var(--ink)';
    return (
      '<div style="border:1px solid ' +
      bd +
      ';background:' +
      bg +
      ';border-radius:9px;padding:5px 8px;text-align:center;min-width:66px">' +
      '<div style="font-size:var(--fs-1);font-weight:700;color:' +
      col +
      '">' +
      (dn ? '✓ ' : '') +
      esc(l) +
      '</div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey)">' +
      esc(s) +
      '</div></div>'
    );
  };
  const arrow = () => '<span style="color:var(--grey);font-size:var(--fs-1)"><span class=arw>→</span></span>';
  const _mk = (v) => {
    const m = { y: ['var(--ok-3)', '✓'], p: ['var(--warn-2)', '~'], n: ['var(--disp)', '✗'] },
      c = m[v] || m.n;
    return '<span style="color:' + c[0] + ';font-weight:700">' + c[1] + '</span>';
  };
  const crow = (n, a, b, c, d, hl) =>
    '<tr style="' +
    (hl ? 'background:var(--blue-tint);' : '') +
    'border-top:1px solid var(--line);color:var(--on-card)"><td style="text-align:start;padding:4px;font-weight:' +
    (hl ? '700' : '500') +
    ';color:' +
    (hl ? 'var(--blue-2)' : 'var(--ink)') +
    '">' +
    n +
    '</td><td style="text-align:center;padding:4px">' +
    _mk(a) +
    '</td><td style="text-align:center;padding:4px">' +
    _mk(b) +
    '</td><td style="text-align:center;padding:4px">' +
    _mk(c) +
    '</td><td style="text-align:center;padding:4px">' +
    _mk(d) +
    '</td></tr>';
  return (
    '<div style="padding:14px 16px;overflow:visible">' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:8px">Where we aim vs the alternatives. <b>' +
    tx('This is a positioning hypothesis') +
    '</b> — our dot is a <b>target</b> (we are early/unproven); the others are established.</div>' +
    '<div style="position:relative;height:270px;margin:22px 34px 30px;border-inline-start:1.5px solid var(--line);border-bottom:1.5px solid var(--line)">' +
    '<div style="position:absolute;inset-inline-start:50%;top:0;bottom:0;border-inline-start:1px dashed var(--line)"></div>' +
    '<div style="position:absolute;top:50%;inset-inline-start:0;inset-inline-end:0;border-top:1px dashed var(--line)"></div>' +
    '<div style="position:absolute;inset-inline-end:4px;top:4px;font-size:var(--fs-1);color:#8fae86;font-weight:700;text-align:end">governed<br>+ accessible<br>= the gap</div>' +
    pt(15, 84, 'Email · chat · sheets', false) +
    pt(84, 15, 'ServiceNow · SAP · EDI', false) +
    pt(68, 27, 'Blockchain B2B', false) +
    pt(80, 80, 'Chit & Bridge', true) +
    '<div style="position:absolute;inset-inline-start:-2px;bottom:-22px;font-size:var(--fs-1);color:var(--grey)">weak <span class=arw>←</span> <b>governance &amp; trust</b> <span class=arw>→</span> strong</div>' +
    '<div style="position:absolute;inset-inline-start:-24px;top:-16px;font-size:var(--fs-1);color:var(--grey)">' +
    tx('↑ accessible / leveling') +
    '</div>' +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--ink);line-height:1.5">' +
    '<b>The edge:</b> the top-right — <b>enterprise-grade governance a small player can actually use</b> — is empty. Email is accessible but ungoverned; SAP/ServiceNow/EDI are governed but heavy &amp; costly; blockchain B2B is trust-heavy but hard. We aim at <b>governed AND leveling</b>: a solo trader transacts on the same rail as a multinational.' +
    '</div>' +
    '<div style="margin-top:16px"><div style="font-size:var(--fs-1);font-weight:700;color:var(--ink);margin-bottom:5px">' +
    tx('Communication lens — two-way between entities') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:6px">Two-way exists elsewhere; being two-way <i>and</i> peer <i>and</i> governed <i>and</i> affordable does not.</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:var(--fs-1)">' +
    '<tr style="color:var(--grey);font-weight:700;font-size:var(--fs-1)"><td style="text-align:start;padding:3px 4px">' +
    tx('Channel') +
    '</td><td style="padding:3px 4px">' +
    tx('2-way') +
    '</td><td style="padding:3px 4px">' +
    tx('Peer') +
    '</td><td style="padding:3px 4px">' +
    tx('Governed') +
    '</td><td style="padding:3px 4px">' +
    tx('Affordable') +
    '</td></tr>' +
    crow('Email', 'y', 'y', 'n', 'y', false) +
    crow('Slack Connect / Teams', 'y', 'p', 'n', 'y', false) +
    crow('EDI', 'y', 'n', 'p', 'n', false) +
    crow('Ariba / Coupa / Tradeshift', 'y', 'n', 'p', 'n', false) +
    crow('Blockchain B2B', 'y', 'y', 'y', 'n', false) +
    crow('Chit &amp; Bridge', 'y', 'y', 'y', 'p', true) +
    '</table>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:5px">✓ yes · ~ partial · ✗ no. Ours is the only row combining <b>governed + peer + two-way</b> (all real/built); <b>affordability is the aim</b>, not yet proven — hence the ~.</div>' +
    '</div>' +
    '<div style="margin-top:16px"><div style="font-size:var(--fs-1);font-weight:700;color:var(--ink);margin-bottom:5px">' +
    tx('Distribution lens — the same edge, a second domain') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:6px">Source-governed distribution competes with catalogue/commerce tools, not email. A brand&rsquo;s governance <b>rides to any distributor</b>; CB carries the <b>information + rules</b>, ERP does the logistics — no marketplace lock-in, no logistics grab.</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:var(--fs-1)">' +
    '<tr style="color:var(--grey);font-weight:700;font-size:var(--fs-1)"><td style="text-align:start;padding:3px 4px">' +
    tx('Channel') +
    '</td><td style="padding:3px 4px">' +
    tx('Gov travels') +
    '</td><td style="padding:3px 4px">' +
    tx('Neutral') +
    '</td><td style="padding:3px 4px">' +
    tx('Info-only') +
    '</td><td style="padding:3px 4px">' +
    tx('Dispute') +
    '</td></tr>' +
    crow('Brand storefront (Shopify)', 'n', 'n', 'n', 'n', false) +
    crow('Marketplace / distributor portal', 'p', 'n', 'n', 'n', false) +
    crow('PIM (Salsify / Akeneo)', 'p', 'y', 'y', 'n', false) +
    crow('EDI / ERP distribution', 'p', 'n', 'n', 'n', false) +
    crow('Chit &amp; Bridge', 'y', 'y', 'y', 'p', true) +
    '</table>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:5px">Cols: <b>' +
    tx('Gov travels') +
    '</b> to the distributor · <b>' +
    tx('Neutral') +
    '</b> = distributor-neutral, no host lock · <b>' +
    tx('Info-only') +
    '</b> = no logistics grab · <b>' +
    tx('Dispute') +
    '</b> = per-copy. Only CB combines governance-travels + neutral + information-only (built + harness-verified) — but <b>not yet adopted by a real brand+distributor pair</b>, so it&rsquo;s a target, not a trophy.</div>' +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);text-align:center;padding-top:10px;border-top:1px solid var(--line);margin-top:14px">Closest analog: <b>' +
    tx('ServiceNow') +
    '</b> — one records/workflow facility, many classified lifecycles (ITSM/HR/dev). It proves the model has takers — and it won by starting <i>narrow</i> (an ITIL desk) then generalizing. Our claimed differentiator vs it: accessibility &amp; cost for the small player.</div>' +
    '<div style="border:1px solid var(--line);border-radius:9px;padding:11px 12px;margin-top:14px;background:var(--card);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:700;color:var(--warn-2);margin-bottom:5px">🧭 Critic&rsquo;s lens (we hold ourselves to it)</div>' +
    '<div style="font-size:var(--fs-1);color:var(--ink);line-height:1.5">The honest risk: the <b>model is ahead of adoption</b> — elegant &ne; adopted. The proof that counts is <b>one real user on one blueprint</b>, not a better diagram. As a <b>concept/POC this existed for years</b>; as a <b>product it is ~2 weeks old</b> — so it is early <i>by timeline</i>, and we name what is unproven rather than oversell it.</div>' +
    '</div>' +
    '<div style="margin-top:13px"><div style="font-size:var(--fs-1);font-weight:700;color:var(--ink);margin-bottom:6px">' +
    tx('Path to confident validation') +
    '</div>' +
    '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">' +
    stage('Concept / POC', 'years', 'done') +
    arrow() +
    stage('Product build', '~2 wks · now', 'now') +
    arrow() +
    stage('One test lifecycle', 'prove it works', 'next') +
    arrow() +
    stage('Volume test', 'scale', '') +
    arrow() +
    stage('Pen test', 'security', '') +
    arrow() +
    stage('External validation', 'confident sign-off', '') +
    '</div></div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:11px"><b>First taker?</b> The one who feels the gap most — a small supplier who needs credible, governed dealings with a large buyer, or a service desk wanting ITIL-grade handling without ServiceNow cost.</div>' +
    '</div>'
  );
}

/* ── REALITY tab — full-honesty writedown: where each edge stands + how we EARN it ── */
function _realTabHtml() {
  const S = {
    real: ['var(--ok-3)', 'LIVE'],
    built: ['var(--warn-2)', 'BUILT · unverified'],
    part: ['var(--warn-2)', 'PARTIAL'],
    aim: ['var(--disp)', 'ASPIRATION']
  };
  const row = (claim, st, now, earn) => {
    const [c, lbl] = S[st] || S.aim;
    return (
      '<div style="border:1px solid var(--line);border-radius:9px;padding:11px 12px;margin-bottom:9px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><span style="font-size:var(--fs-2);font-weight:700">' +
      esc(claim) +
      '</span><span style="margin-inline-start:auto;font-size:var(--fs-1);font-weight:800;color:' +
      c +
      ';white-space:nowrap">' +
      lbl +
      '</span></div>' +
      '<div style="font-size:var(--fs-1);color:var(--ink);line-height:1.45;margin-bottom:3px"><b>Now:</b> ' +
      esc(now) +
      '</div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.4"><b>To earn it:</b> ' +
      esc(earn) +
      '</div></div>'
    );
  };
  return (
    '<div style="padding:14px 16px;overflow:visible">' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:10px">Full honesty — for each edge, where we genuinely stand and what it takes to <b>earn</b> that level. Nothing counts as done until a human proved it (our review-gate rule).</div>' +
    row(
      'Governed peer two-way (the communication edge)',
      'built',
      'Per-entity co-held copies, messages both ways, per-party dispute threads — ALL replicated per-copy (nothing shared), proven by the regression suite.',
      'Run one live A↔B loop with a real user; then volume-test it.'
    ) +
    row(
      'Multitenant isolation (RLS)',
      'real',
      'Live in prod, PER-COPY across ALL entity tables — cb_app cannot bypass RLS; the regression suite proves a non-participant reads 0 (100+ assertions).',
      'Commission an external pen-test to move from self-verified to attested (the L5 gate).'
    ) +
    row(
      'Sealed co-held record + provenance',
      'part',
      'Freeze-at-send + an append-only state log exist.',
      'Add an immutability / tamper test proving history cannot be rewritten.'
    ) +
    row(
      'Dispute confidentiality (the USP)',
      'real',
      'Per-COPY: each party owns its dispute; messages scoped to the roster — PROVEN (dispute-scope 7/0: in a 3-party chit the non-dispute party sees 0).',
      'Human live-run of the dispute UI; then external pen-test.'
    ) +
    row(
      'Governed + accessible (the quadrant)',
      'aim',
      'The rail is governed; affordability/ease for a solo player is designed, not proven.',
      'One real small-player user completes a real loop cheaply — the decisive wedge.'
    ) +
    row(
      'Self-measuring maturity (this Legend)',
      'part',
      'An honest hand-authored scoreboard (these very tabs).',
      'Wire it to real Delivery Records + test results so it reads automatically (the L4 step).'
    ) +
    '<div style="font-size:var(--fs-1);color:var(--grey);text-align:center;padding-top:9px;border-top:1px solid var(--line);margin-top:6px">The ladder that earns all of it: <b>one test lifecycle <span class=arw>→</span> volume <span class=arw>→</span> pen-test <span class=arw>→</span> external validation.</b> Concept: years · Product: ~2 weeks. Early by timeline, honest by choice.</div>' +
    '</div>'
  );
}

/* ── WORK PATTERNS tab — each pattern is a minted governed JOURNEY, framed by the higher objective it achieves.
 *    Mirrors SPEC-work-patterns.md + the rail map. Authored (like the other tabs); the live registry is
 *    WORK_PATTERNS in Core — keep in sync when patterns change. ── */
function _workTabHtml() {
  const R = 'var(--accent,var(--blue))';
  const seal = (t) => `<span style="font-size:var(--fs-1);color:var(--ok-3);background:var(--ok-tint);border-radius:5px;padding:1px 7px">🔒 ${t}</span>`;
  const lic = (t) =>
    `<span style="font-size:var(--fs-1);color:var(--warn-3);background:var(--gold-soft,#f4eeda);border:1px solid var(--gold-line,#e0d4a8);border-radius:5px;padding:1px 7px">🎫 ${t}</span>`;
  /* ⚠️ WAS A HARDCODED #9a6d1a ON A THEMED GROUND — the defect Athi spotted on this tab. The ink was fixed
     while --warn-tint moved with the theme, so it measured 3.91:1 on every light theme and 3.36:1 on Dark:
     BELOW AA in all fifteen. --warn-2 is the ink this tint exists to carry, and it is measured in every theme. */
  const knob = (t) => `<span style="font-size:var(--fs-1);color:var(--warn-2);background:var(--warn-tint);border-radius:5px;padding:1px 7px">✎ ${t}</span>`;
  const up = (t) => `<span style="font-size:var(--fs-1);color:var(--grey)">↑ ${t}</span>`;
  const chain = (t) => `<span style="font-size:var(--fs-1);color:${R};background:var(--blue-tint);border-radius:5px;padding:1px 7px">${t}</span>`;
  const stage = (t, d, tag) =>
    `<span style="display:inline-flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:5px 9px;vertical-align:top;max-width:158px;color:var(--on-card)"><b style="font-size:var(--fs-1)">${esc(t)}${tag ? ` <span style="font-family:'Space Mono';font-size:var(--fs-1);color:${R};background:var(--blue-tint);border-radius:4px;padding:0 4px">${tag}</span>` : ''}</b>${d ? `<span style="color:var(--grey);font-size:var(--fs-1);line-height:1.35;margin-top:2px">${d}</span>` : ''}</span>`;
  const arr = `<span style="color:var(--grey);font-size:var(--fs-1);padding:0 1px"><span class=arw>→</span></span>`;
  const journey = (icon, name, sub, stages) =>
    `<div style="border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-bottom:10px"><div style="font-weight:700;font-size:var(--fs-2);margin-bottom:8px">${icon} ${name} <span style="color:var(--grey);font-weight:500">— ${sub}</span></div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:stretch">${stages.join(arr)}</div></div>`;
  const line = (o) => `<div style="border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:11px">
    <div style="display:flex;align-items:center;gap:9px">
      <span style="width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-size:15px;background:var(--blue-tint);border:1px solid var(--line);color:var(--on-card)">${o.icon}</span>
      <span style="font-family:'Space Grotesk';font-weight:700;font-size:var(--fs-3)">${esc(o.name)}</span>
      <span style="font-family:'Space Mono';font-size:var(--fs-1);color:${R};background:var(--blue-tint);border:1px solid var(--line);border-radius:6px;padding:1px 6px">${esc(o.pid)}</span>
      <span style="margin-inline-start:auto;font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:${o.live ? 'var(--ok-3)' : 'var(--grey-2)'};border:1px ${o.live ? 'solid #bfe0cf' : 'dashed #c2c6cc'};border-radius:5px;padding:1px 6px">${o.live ? 'Live' : 'Designed'}</span>
    </div>
    <div style="font-size:var(--fs-2);color:var(--ink);background:var(--blue-tint);border-inline-start:3px solid ${R};border-radius:0 8px 8px 0;padding:7px 11px;margin:9px 0 8px;line-height:1.5"><b style="font-family:'Space Mono';font-size:var(--fs-1);letter-spacing:.08em;text-transform:uppercase;color:${R};margin-inline-end:7px">${tx('Achieves')}</b>${o.obj}</div>
    <div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:8px;line-height:1.55">${o.flow}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">${o.chips.join('')}</div>
  </div>`;
  const lines = [
    {
      icon: '🛰️',
      name: 'IoT signal',
      pid: 'iot-signal@v1',
      live: true,
      obj: "Turns a <b>physical event into a governed, owned, actionable record</b> — an exception can't be lost, missed, or denied.",
      flow:
        'Device telemetry (ActorKey) <span class=arw>→</span> <b>resolve</b> folder·assignee·copy <span class=arw>→</span> seal · file · assign · notify <span class=arw>→</span> <b>' +
        tx('Task-only signal chit') +
        '</b> <span class=arw>→</span> escalation (SMS · AI · robot <span class=arw>→</span>∞)',
      chips: [seal('Copy · Task-only'), seal('Isolation · per-copy'), lic('Connector · ≤25 devices'), up('health · last-seen · exceptions/day')]
    },
    {
      icon: '✉️',
      name: 'Send a chit',
      pid: 'send-chit@v1',
      live: true,
      obj: 'Two entities <b>transact on a sealed, co-held record neither can unilaterally rewrite</b> — trust without a middleman.',
      flow: 'Line items / terms (compose) <span class=arw>→</span> <b>deliver co-held</b> copies <span class=arw>→</span> advance signals (open<span class=arw>→</span>act<span class=arw>→</span>close) <span class=arw>→</span> co-held record <span class=arw>→</span> invoice · dispute · forward',
      chips: [seal('Isolation · per-copy (RLS)'), knob('self-copy: both / order / task'), lic('Core · unlimited'), up('delivered · status advances')]
    },
    {
      icon: '⚑',
      name: 'Raise a dispute',
      pid: 'raise-dispute@v1',
      live: true,
      obj: 'Resolves disagreement <b>confidentially and per-party, with no third party</b> — the relationship survives the conflict. <i>The USP.</i>',
      flow: 'Reason / category (a party) <span class=arw>→</span> <b>private siding</b> <span class=arw>→</span> raiser resolves its own <span class=arw>→</span> resolution (per-party copies) <span class=arw>→</span> roster only',
      chips: [seal('Confidentiality · roster-only'), lic('Dispute · included'), up('raised · resolved · open count')]
    },
    {
      icon: '🧾',
      name: 'The commercial run',
      pid: 'order → invoice → receipt',
      live: false,
      obj: 'Carries a <b>whole trade — request to proof — with unbroken provenance at every hop</b>.',
      flow: "order <span class=arw>→</span> delivery_note <span class=arw>→</span> invoice <span class=arw>→</span> payment <span class=arw>→</span> receipt — each hop's <b>output is the next hop's input</b>",
      chips: [chain('Purposes today · pattern-ize next')]
    }
  ];
  const spine = [
    ['Constitution', 'base@v1'],
    ['↳ Capability', 'connector@v1'],
    ['↳ Work-pattern', 'iot-signal@v1'],
    ['↳ Chit', 'stamped']
  ]
    .map(
      (item, index) =>
        `<div style="flex:1 1 118px;min-width:110px;padding:9px 11px;${index ? 'border-inline-start:1px solid var(--line)' : ''};${index === 3 ? 'background:var(--blue-tint)' : ''};color:var(--on-card)"><div style="font-family:'Space Mono';font-size:var(--fs-1);letter-spacing:.07em;text-transform:uppercase;color:var(--grey)">${item[0]}</div><div style="font-weight:700;font-size:var(--fs-2);${index === 3 ? 'color:' + R : ''}">${item[1]}</div></div>`
    )
    .join('');
  const notif = [
    ['🏢 Entity', 'a copy delivered to Task / Order', 'mailbox lists; entity-scoped RLS'],
    ['🧑 Actor', 'assigned / visible change — delivery·status·message·dispute', 'per-actor <b>unread</b> + bell + message centre'],
    ['🛰️ IoT', "<i>emits</i>, doesn't receive", 'auto-file to folder + assign to resolved actor (+ optional email); health in cockpit'],
    ['🔌 ERP', 'a handoff receipt lands', 'receipt ledger, per-distributor RLS; process-then-forget'],
    ['🤖 AI', 'a proposal to authorize', 'human authorize → confirm (in-loop)'],
    ['🛍️ Customer', 'order confirmation', 'OTP on the order — not a full mailbox']
  ]
    .map(
      (item) =>
        `<tr style="border-top:1px solid var(--line)"><td style="padding:7px 9px;font-weight:600;white-space:nowrap;vertical-align:top">${item[0]}</td><td style="padding:7px 9px;color:var(--ink);vertical-align:top">${item[1]}</td><td style="padding:7px 9px;color:var(--grey);vertical-align:top">${item[2]}</td></tr>`
    )
    .join('');
  return `<div style="padding:13px 15px;overflow:visible">
    <div style="font-size:var(--fs-2);color:var(--grey);line-height:1.6;margin-bottom:12px">A work pattern isn't a form — it's a <b style="color:var(--ink)">governed journey</b>: a minted, version-frozen blueprint a chit runs end-to-end, stamped with everything that governed it. Each is framed by the <b style="color:var(--ink)">higher objective it achieves</b> — no outcome <span class=arw>→</span> not a work pattern; the flow shows how.</div>
    <div style="display:flex;flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:16px">${spine}</div>
    ${lines.map(line).join('')}
    <div style="border:1px solid ${R};background:linear-gradient(180deg,var(--blue-tint),var(--bg,#fff));border-radius:13px;padding:14px 16px;margin:6px 0 16px">
      <div style="font-family:'Space Grotesk';font-weight:800;font-size:var(--fs-3);color:${R}">A catalogue is a contract, not a list</div>
      <div style="font-size:var(--fs-2);color:var(--ink);background:var(--card);border-inline-start:3px solid ${R};border-radius:0 8px 8px 0;padding:7px 11px;margin:9px 0;line-height:1.5"><b style="font-family:'Space Mono';font-size:var(--fs-1);letter-spacing:.08em;text-transform:uppercase;color:${R};margin-inline-end:7px">${tx('Achieves')}</b>Extends a <b>brand's governance to every customer through any distributor</b> — control without custody.</div>
      <div style="font-size:var(--fs-2);color:var(--ink);line-height:1.55">The source's governance amalgamated into one construct that <b>travels</b>: the order runs under the source's minted rules wherever served, the distributor <b>can't override</b>, and the chit <b>freezes the exact version</b> seen. Bogie line-up public (browse), cargo private (order), source rules = the sealed wagon-spec that binds every yard.</div>
    </div>
    <div style="font-family:'Space Grotesk';font-weight:700;font-size:var(--fs-3);margin:14px 0 8px">${tx('The journeys that travel')}</div>
    ${journey('🏷️', 'Source journey', "a brand's governance reaches every customer, through any distributor", [
      stage('Author', 'brand writes its source — experience + rules, owner-gated', 'b78'),
      stage('Cascade', 'to every distributor that references it'),
      stage('Travel', "item runs under source@v; distributor can't override"),
      stage('Order', 'the chit freezes the exact version seen', 'container@v'),
      stage('Penetration', 'aggregate heatmap back to the brand — no PII', 'b79')
    ])}
    ${journey('🧬', 'Schema journey', "the wagon's shape is version-frozen, provenance kept", [
      stage('Define', 'the entity owns its schema — the wagon shape'),
      stage('Freeze at send', 'snapshot the governing schema@v'),
      stage('Travel', 'the frozen schema rides with every copy'),
      stage('Pin', 'the chit records schema@version — verifiable forever')
    ])}
    <div style="font-family:'Space Grotesk';font-weight:700;font-size:var(--fs-3);margin:16px 0 7px">${tx('Notifications — who gets told, and how')}</div>
    <div style="overflow-x:auto;border:1px solid var(--line);border-radius:12px"><table style="width:100%;border-collapse:collapse;font-size:var(--fs-1);min-width:520px"><tr style="background:var(--blue-tint);color:var(--on-card)"><td style="padding:6px 9px;font-family:'Space Mono';font-size:var(--fs-1);letter-spacing:.06em;text-transform:uppercase;color:var(--grey)">${tx('Crew')}</td><td style="padding:6px 9px;font-family:'Space Mono';font-size:var(--fs-1);letter-spacing:.06em;text-transform:uppercase;color:var(--grey)">${tx('Notified by')}</td><td style="padding:6px 9px;font-family:'Space Mono';font-size:var(--fs-1);letter-spacing:.06em;text-transform:uppercase;color:var(--grey)">${tx('Handled')}</td></tr>${notif}</table></div>
    <div style="font-size:var(--fs-1);color:var(--grey);line-height:1.55;margin-top:11px">Mechanism: per-actor unread = <b>chit_reads</b> vs <b>chit_status.updated_at</b>; bell + centre from the append-only <b>state_log</b>; cross-entity delivery only via the SECURITY DEFINER fns. · <b>Honest:</b> 3 patterns minted+live; the commercial run is real as purposes (not pattern-ized); AI &amp; customer rows are designed.</div>
  </div>`;
}

/**
 * ⭐⭐ WHY WE FOLLOW STANDARDS — in the Legend, because this is where the case gets MADE rather than checked.
 *
 * Athi, 2026-08-18: *"bring the why bother view into legend as well."*
 *
 * ⚠️ SAME RENDERER AS SETTINGS (stdWhyHTML in cap-standards.js), at a compact density. Two surfaces, one text —
 * writing a shorter second version for the Legend is exactly how the two would end up saying subtly different
 * things about the same commitment, and the Legend's would be the one a buyer had read.
 *
 * ⚠️ THE COUNTS ARE LIVE, not a sentence someone typed. A Legend claiming "26 standards" that had drifted from
 * the register would be the overclaim this whole area exists to prevent — on the one surface where it is being
 * used to persuade.
 *
 * ⚠️ IT LOADS ITS OWN DEPENDENCY. The register is a separate capability, so the first open re-enters this
 * function once the script lands rather than rendering an empty tab.
 */
function _stdTabHtml() {
  if (typeof stdWhyHTML !== 'function') {
    ensureCap('standards')
      .then(function () {
        _openLegendImpl();
      })
      .catch(function () {});
    return '<div style="padding:16px;color:var(--grey);font-size:var(--fs-2)">' + tx('Loading…') + '</div>';
  }
  var n = stdCounts();
  return (
    '<div style="padding:14px 16px">' +
    '<div style="font-size:var(--fs-5);font-weight:800;color:var(--ink);margin-bottom:2px">' +
    tx('Why we follow standards') +
    '</div>' +
    '<div style="font-size:var(--fs-2);color:var(--grey);line-height:1.55;margin-bottom:12px">' +
    '<b style="color:var(--ok-2)">' +
    n.live +
    ' in force</b> · ' +
    '<b style="color:var(--warn-2)">' +
    n.part +
    ' partly</b> · ' +
    n.plan +
    ' planned. ' +
    'Every one is listed with its status in <b>' +
    tx('Settings › Standards') +
    '</b>, and the partial ones say what is ' +
    'missing — because a page like this is quoted to buyers.' +
    '</div>' +
    stdWhyHTML({ compact: true }) +
    /* ⚠️ Compact here: in the Legend the record is SCANNED, not studied. Same fields, same honesty markers —
       the greyed "not built yet" rows especially, since this is the surface used to persuade. */
    (typeof stdRecordHTML === 'function' ? stdRecordHTML({ compact: true }) : '') +
    '</div>'
  );
}

function _openLegendImpl() {
  let host = document.getElementById('lbhost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'lbhost';
    document.body.appendChild(host);
  } // pre-auth: create the host if the app shell isn't mounted (shareable /#/legend)
  _legendOpen = true;
  if (typeof _lbTab === 'undefined') _lbTab = 'subject'; // open on THE SUBJECT (the conceptual anchor) — the sealed co-held record everything else acts on
  const LOADED = typeof CAP_LOADED !== 'undefined' ? CAP_LOADED : {};
  const SC = { done: ['var(--ok-3)', '✅'], partial: ['var(--warn-2)', '◐'], backlog: ['var(--grey-4)', '○'] };
  // tallies across every feature
  let count = 0,
    p = 0,
    b = 0,
    nf = 0;
  CAP_CATALOGUE.forEach((item) =>
    item.features.forEach((entry) => {
      nf++;
      if (entry.s === 'done') count++;
      else if (entry.s === 'partial') p++;
      else b++;
    })
  );
  const built = CAP_CATALOGUE.filter((item) => item.load !== 'planned').length;
  const loadBadge = (c) => {
    if (c.load === 'eager')
      return `<span style="font-size:var(--fs-1);font-weight:700;color:var(--ok-3);background:var(--ok-tint);border:1px solid #bfe0cf;border-radius:6px;padding:1px 7px">always on</span>`;
    if (c.load === 'planned')
      return `<span style="font-size:var(--fs-1);font-weight:700;color:var(--warn-3);background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:6px;padding:1px 7px">planned</span>`;
    const on = !!LOADED[c.id];
    return `<span style="font-size:var(--fs-1);font-weight:700;color:${on ? 'var(--blue-d)' : 'var(--grey-2)'};background:${on ? 'var(--blue-tint)' : 'var(--warn-tint)'};border:1px solid ${on ? 'var(--blue-tint-line)' : 'var(--line)'};border-radius:6px;padding:1px 7px">lazy · ${on ? 'loaded ✓' : 'on demand'}</span>`;
  };
  const recLink = (c) =>
    c.record
      ? `<a href="${esc(c.record)}" target="_blank" rel="noopener" data-testid="cap-record-${esc(c.id)}" title="Its CMDB record: ways in, what it does, what comes out, tests" style="font-size:var(--fs-1);font-weight:700;color:var(--blue-d);background:var(--blue-tint);border:1px solid var(--blue-tint-line);border-radius:6px;padding:1px 7px;text-decoration:none">📄 Record</a>`
      : '';
  const matBadge = (c) => {
    if (!c.maturity) return '';
    const t = c.target && c.target > c.maturity ? `<span class=arw>→</span>L${c.target}` : '';
    return `<span title="Capability maturity — 1 to 5, see the Legend" style="font-size:var(--fs-1);font-weight:800;color:var(--purple-2);background:var(--purple-tint);border:1px solid #cabdf0;border-radius:6px;padding:1px 7px">L${c.maturity}${t}</span>`;
  };
  const featRow = (f) => {
    const [col, ic] = SC[f.s] || SC.backlog;
    return `<div style="display:flex;gap:8px;align-items:flex-start;font-size:var(--fs-2);color:var(--ink);padding:4px 0;line-height:1.45"><span style="color:${col};flex:none">${ic}</span><span>${esc(f.n)}</span></div>`;
  };
  // GOVERNANCE BAND — the SECOND axis: gov maturity + what governs it + the L4 gap (SPEC-governance-in-legend.md).
  const govChips = (arr, col, bg, bd) =>
    (arr || [])
      .map((x) => `<span style="font-size:var(--fs-1);color:${col};background:${bg};border:1px solid ${bd};border-radius:5px;padding:1px 6px">${esc(x)}</span>`)
      .join(' ');
  const govBand = (c) => {
    if (c.load === 'planned') return ''; // planned → nothing to govern yet
    if (c.gov == null && !c.governedUnder) return '';
    const na = c.gov == null;
    const t = c.govTarget && c.govTarget > c.gov ? `→L${c.govTarget}` : '';
    const badge = na
      ? `<span style="font-size:var(--fs-1);font-weight:800;color:var(--grey);background:var(--neutral-tint);border:1px solid var(--line);border-radius:6px;padding:1px 7px">gov · N/A</span>`
      : `<span title="Governance maturity — 1 to 5, see the Legend" style="font-size:var(--fs-1);font-weight:800;color:var(--ink-2);background:var(--ok-tint);border:1px solid #bfe0cf;border-radius:6px;padding:1px 7px">gov · L${c.gov}${t}</span>`;
    const under = c.governedUnder
      ? `<span style="font-size:var(--fs-1);color:var(--grey)">under <b style="color:var(--ok-2);font-weight:600">${esc(c.governedUnder)}</b></span>`
      : '';
    const mech =
      c.governedBy && c.governedBy.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${govChips(c.governedBy, 'var(--ok-2)', 'var(--ok-tint)', 'var(--ok-tint)')}</div>`
        : '';
    const gap =
      c.govGap && c.govGap.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:5px"><span style="font-size:var(--fs-1);font-weight:700;color:var(--warn-2)">to L${c.govTarget || 4}:</span>${govChips(c.govGap, 'var(--warn-2)', 'var(--warn-tint)', 'var(--warn-tint)')}</div>`
        : '';
    return `<div style="border:1px solid #d7e6dc;background:var(--card);border-radius:9px;padding:7px 9px;margin:0 0 9px;color:var(--on-card)">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">${badge}${under}</div>${mech}${gap}
    </div>`;
  };
  const card = (
    c
  ) => `<div style="border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-bottom:10px;background:${c.load === 'planned' ? 'var(--card)' : 'var(--card)'};color:${c.load === 'planned' ? 'var(--on-card)' : 'var(--on-card)'}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><span style="font-size:var(--fs-3)">${c.icon}</span><span style="font-family:'Space Grotesk';font-weight:700;font-size:var(--fs-3)">${esc(c.name)}</span><span style="margin-inline-start:auto;display:flex;gap:6px;align-items:center">${recLink(c)}${matBadge(c)}${loadBadge(c)}</span></div>
    <div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:8px;line-height:1.5">${esc(c.blurb)}</div>
    ${govBand(c)}
    ${c.features.map(featRow).join('')}
  </div>`;
  const capBody = `
    <div style="padding:11px 13px 6px;font-size:var(--fs-1);color:var(--grey);border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <span><b style="color:var(--ink)">${built}</b> live capabilities · <b style="color:var(--ink)">${nf}</b> features</span>
      <span style="margin-inline-start:auto">Status: <span style="color:var(--ok-3)">✅ done ${count}</span> · <span style="color:#a9791f">◐ partial ${p}</span> · <span style="color:var(--grey-4)">○ backlog ${b}</span></span>
    </div>
    <div style="padding:12px 13px;overflow:visible">${CAP_CATALOGUE.map(card).join('')}
      <div style="font-size:var(--fs-1);color:var(--grey);text-align:center;padding-top:4px">Load: <b>always on</b> ships with the app · <b>lazy</b> loads on first use · <b>planned</b> not built yet. · <b>${tx('L1–5')}</b> maturity: 1 Proven · 2 Packaged · 3 Itemised · 4 Governed · 5 Productized (<span class=arw>→</span> = target). Kept true to the code.</div>
      <div style="font-size:var(--fs-1);color:var(--grey);text-align:center;padding-top:3px">🏛️ <b>${tx('Governance rides on each capability')}</b> — the green band is the SECOND axis: <b>gov L1–5</b> (1 declared · 2 designed · 3 enforced+isolated · 4 governed+provable · 5 audited) <b>under</b> its cascade layer, with the amber <b>“to L4”</b> gap. Gov usually LAGS maturity — that lag IS the distance to L4. <b>${tx('N/A')}</b> = static/read-only, nothing to govern.</div>
    </div>`;
  const body =
    _lbTab === 'subject'
      ? _subjectTabHtml()
      : _lbTab === 'stories'
        ? _storiesTabHtml()
        : _lbTab === 'found'
          ? _foundTabHtml()
          : _lbTab === 'stack'
            ? _stackTabHtml()
            : _lbTab === 'life'
              ? _lifeTabHtml()
              : _lbTab === 'sec'
                ? _secTabHtml()
                : _lbTab === 'edge'
                  ? _edgeTabHtml()
                  : _lbTab === 'real'
                    ? _realTabHtml()
                    : _lbTab === 'work'
                      ? _workTabHtml()
                      : _lbTab === 'std'
                        ? _stdTabHtml()
                        : capBody;
  const titles = {
    subject: 'the subject — the sealed co-held record',
    stories: 'the Life of… — business narratives',
    found: 'foundations — the trust floor + proof',
    stack: 'the governance stack — universe → chit',
    cap: 'capabilities &amp; features',
    life: 'lifecycle &amp; traceability',
    sec: 'security posture',
    edge: 'positioning &amp; edge',
    real: 'reality &amp; how we earn it',
    work: 'work patterns — the governed journeys'
  };
  host.innerHTML = `<div class="notifover" onclick="closeLegend()"><div class="notifpanel" style="position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;border-radius:0;overflow:hidden;display:flex;flex-direction:column;background:var(--card);color:var(--on-card)" onclick="event.stopPropagation()">
    <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;background:linear-gradient(180deg,#f7f9fc,#fff);border-bottom:1px solid var(--line);flex:none">
      <span style="font-size:var(--fs-5)">🔑</span>
      <div style="line-height:1.15"><div style="font-family:'Space Grotesk';font-weight:700;font-size:var(--fs-5);color:var(--ink)">${tx('What we serve')}</div><div style="font-size:var(--fs-2);color:var(--grey)">${titles[_lbTab] || titles.cap}</div></div>
      <div style="margin-inline-start:auto;display:flex;align-items:center;gap:6px">
        <button data-cbsid="CMP005" onclick="closeLegend()" style="border:0;background:none;cursor:pointer;font-size:26px;line-height:1;color:var(--grey);margin-inline-start:4px" aria-label="Close">✕</button>
      </div>
    </div>
    <div style="flex:none">${_lbTabBar()}</div>
    <div style="flex:1;overflow:auto;min-height:0"><div id="lbbody" style="max-width:1040px;margin:0 auto">${body}</div></div>
  </div></div>`;
}
