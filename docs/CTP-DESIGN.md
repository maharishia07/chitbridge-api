# CTP — Chit Transfer Protocol (design note)

**Status:** design, for review. **Nothing is built.** Captured 2026-09-15 (Athi).

> *"we have to create a way of cross bordering, means CTP, chit transfer protocol, so we should be able to call
> another region by some means… how do we cross within same engine or maybe a different installation altogether
> including infra and IP?"*

This note continues [DATA-RESIDENCY-DESIGN.md](DATA-RESIDENCY-DESIGN.md) (2026-07-04), which established that
per-copy replication makes geographic separation feasible and left **three questions open**. CTP has to answer
them, and they are picked up by name in §9.

---

## 0. The one-paragraph version

A chit is not a shared row; it is **N per-entity copies**. Each party holds their own and cannot read anyone
else's. That is already the shape of a federation protocol — it just runs inside one database today. **CTP is
`mint.deliver()` with an addressable transport.** Nothing about what a chit *is* changes; only how a copy
reaches the entity that owns it.

---

## 1. The distinction everything rests on

The single most important correction to the framing, and it should be settled before anything is built:

| | what it bounds | enforced by |
|---|---|---|
| **population** | **who may transact with whom** — the sealed books | `chit_populations_must_match()` (b247), a database trigger |
| **installation** | **character** — region, currency, timezone, languages, vertical | `lib/govresolve.js` cascade, `bounded()` tighten-only |

**A region is not a boundary.** An Indian shop and a German buyer are *both* `population='live'` on different
installations, so b247 does not block them. **Cross-border trade is already permitted today and always was.**

What is missing is not permission. It is **meaning** — whose tax, whose currency, whose jurisdiction, which
documents. That is a resolution problem, and it is a different problem from moving bytes between machines.

So there are two problems, and they should not be solved at the same time:

- **A — cross-region, one engine.** Permitted today. Needs resolution rules. §4.
- **B — cross-installation, separate infra and IP.** Needs a wire. §5–§8.

---

## 2. What already exists, unused

Everything below is declared in the codebase and read by nobody. CTP is mostly *connecting* these.

| piece | where | state |
|---|---|---|
| per-copy delivery | `lib/mint.js → deliver(sender, chit_id, copies)` | live, the only delivery path |
| canonical serialisation | `lib/canon.js → canon / hash / seal / verify` | built 2026-09-12, for the seal |
| per-installation key | `installation.root_key_ref` — b74: *"the sovereignty anchor"* | column, no reader |
| per-installation address | `installation.domain` (`mx.chitandbridge.com`) | column, no reader |
| the governance cascade | `lib/govresolve.js`: universe → constitution → installation → entity | live, but `entity_governance` had **zero rows** until b254 |
| region jurisdictions | `region_layer` — 11 regions with real tax slabs and authorities | live, used by `lib/regional.js` |
| the boundary | b247 trigger | live, **local-only — see §7** |

⚠️ **`canon.js` is the reason a signature is even possible.** Two representations of the same value must hash
the same, or a signature verifies on the sender and fails on the receiver for no reason anybody can see.

---

## 3. What a "copy" is, precisely

`mint.deliver` is handed an array of copies, one per party. Each is built by `mint.party(headerCommon, {...})`
and carries `entity_id · direction · role · current_status · business_json · log`, over a shared
`headerCommon` (`summary_json`, subjects, `all_recipients`, money).

**This matters for CTP because the unit that crosses the wire is one copy, not one chit.** The envelope in §6
is therefore *addressed to one entity* and contains exactly that entity's copy plus the shared header.

---

## 4. Problem A — cross-region inside one engine

Permitted today; unproven, because `entity_governance` was empty until b254 and every resolve fell back to
`base` + `platform-0`. Once two entities carry different installations, these questions become live:

1. **Whose currency is the chit in?** The seller's installation currency, with the buyer's as a presentation.
   `money.js` and `CBPricing` already treat currency as a value, not a global.
2. **Whose tax applies?** `region_layer.jurisdiction.tax` per region. The existing rule in the base
   constitution is `jurisdiction.mode = 'supplier'` — *"the platform is the provider, not the custodian; disputes
   are handled within the supplier's jurisdiction."* So: **the supplier's region decides**, and it is already
   written down.
3. **Which documents?** `project-compliance-by-catalogue` — the catalogue already declares what a lane needs.
4. **What does the buyer SEE?** Their own language and their own currency, over the supplier's tax. That is
   exactly `bounded()` — the buyer's installation may narrow presentation, never the governing regime.

⭐ **Doing A first is the recommendation.** It is real value, it exercises the cascade end-to-end for the first
time, and it settles *meaning* while both parties are still in one database where everything is observable.

---

## 5. Problem B — the wire

### 5.1 Addressing

An address must answer *which installation holds this entity*.

**Decision: a directory lookup, never a prefix in the id.** A `bridge_id` that encodes its installation
(`CB…@in`) becomes wrong the day a world moves machines — and moving a world is the whole point of §10. The
`bridge_id` stays an opaque, stable public name; the directory says where it currently lives.

```
resolve(bridge_id) -> { installation_key, domain, public_key, population }
```

#### DNS discovery — DECIDED 2026-09-15

**Nobody runs the namespace. Each installation publishes its own record, and we cache it.**

Athi first said CBINC should run the directory, then said in the same breath: *"we are thinking of creating
something like SMTP? we can ride on this for cross border… that will find the other end."* The second instinct
beats the first, and the reason is positioning, not engineering: **an installation whose address book we control
is not sovereign**, and sovereignty is what `installation.root_key_ref` was called an anchor for.

So, MX-style:

- each installation publishes a signed manifest at a well-known path on its own `installation.domain`
  (`https://<domain>/.well-known/ctp.json`) — its `installation_key`, public key, populations it will accept,
  and the endpoint that takes envelopes
- a `bridge_id` resolves to a domain by the sender asking the recipient's domain, exactly as a mail server asks
  DNS for an MX record
- **we run a cache and a member registry, not the namespace** — so *"is he a member of me"* is still checked on
  arrival, which was Athi's point, but a stranger installation can still be reached without our permission

⚠️ **This removes open decision §9.4 and replaces it with a smaller one:** how does a sender learn the *domain*
for a bridge id it has never seen? A bridge id is not a domain. Either the address a person types is
`bridge_id@domain` (the SMTP shape, human-legible, no lookup needed), or there is a discovery hop. **The
`@domain` form is recommended** — it keeps the id opaque, puts the routing in the address where a person can
read it, and needs no global index of any kind.

### 5.2 One deliver(), two transports

```
deliver(sender, chit_id, copies)
  for each copy:
    where = resolve(copy.entity_id)
    where.local ? writeLocally(copy)          // today's path, unchanged
                : queueForTransfer(copy, where)
```

⚠️ **Not `if (remote) …` scattered through the code.** One interface, transport chosen by the address. The
alternative is two delivery semantics that drift, and the drift is invisible until a world is split out.

### 5.3 Why not make everything go over the wire

Considered and rejected: routing local deliveries through HTTP "for consistency" would pay protocol cost on
every chit in the product to make a rare path tidy. **Consistency is bought by the conformance test in §8, not
by making the common case slow.**

---

## 6. The envelope

One envelope carries **one copy, to one entity**.

```jsonc
{
  "ctp": "1",
  "chit_id": "uuid",                  // the natural key — idempotency rests on it
  "from": {
    "installation_key": "platform-0",
    "population": "live",             // §7 — the boundary, carried
    "bridge_id": "CB…",               // the SENDING ENTITY, not the installation
    "display_name": "…"
  },
  "to":   { "bridge_id": "CB…" },     // exactly one recipient
  "header": { /* summary_json, subjects, all_recipients, money */ },
  "copy":   { /* direction, role, current_status, business_json, log */ },
  "attachments": [ { "id": "…", "sha256": "…", "href": "https://…signed", "bytes": 12345 } ],
  "sealed": { "alg": "ed25519", "hash": "…", "sig": "…", "at": "2026-09-15T…Z" }
}
```

**Rules:**

1. **Only the recipient's copy crosses.** Never the sender's, never a third party's. Per-copy discipline has to
   survive the wire or the protocol quietly undoes the product's central promise.
2. **`all_recipients` is a problem, not a field.** It names every party. Sending it whole tells the recipient
   who else is on the chit — which is correct for an order with a CC and wrong for some lanes. **Open decision,
   §9.1.**
3. **Attachments by reference, never by value.** A signed, expiring URL plus a `sha256`. Bytes in an envelope
   make the envelope unbounded and duplicate storage that `project-object-storage` already solved.
4. **`sealed` covers the canonical form of everything above it** — `canon.hash({ctp, chit_id, from, to, header,
   copy, attachments})`. Signed with the sending installation's `root_key_ref`.

---

## 6.1 The sender's constitution — resolved from its installation, never assumed (2026-09-16)

Athi: *"verify the constitution matrix, so it resolves correctly here; if not, bring it to the same place, so
it works for CTP"* … *"i hope you are keeping it as a single source and nothing to be found from sweeping the
entire code base?"*

**It did not work for CTP, and it failed silently.** `resolveEntityGovernance` is keyed by a *local* entity and
reads `entity_governance` under RLS. A party arriving over the wire has no row here, so its stamp came back
null and the cascade quietly answered `base @ platform-0` — the way a brand-new local shop resolves. An Emirati
supplier's chit would have been governed as a default Indian one, with nothing on screen saying so.

**The rule already existed, in SQL.** `identities_stamp_world()` (b254) stamps a new entity by reading
`installation.vertical_key` and using *that* as the constitution: **installation → vertical → constitution**. A
remote peer has an `installation` row here (b257, `hosted_locally = false`) carrying exactly that column.

So `lib/govresolve.js` now has **one cascade and two doors**:

| door | keyed by | reads | for |
|---|---|---|---|
| `resolveEntityGovernance(entity_id)` | a local entity | its `entity_governance` stamp, under RLS | everything local |
| `resolveInstallationGovernance(key)` | an installation | its `installation` row alone — no entity, no RLS | **a party that is not here** |

Both return `resolved_from` (`entity_stamp` · `installation` · `fallback`) and `fallback: true|false`, so a
default is a *stated* default, never a quiet substitution. `POST /api/ctp/deliver` resolves the sender from
`from.installation_key` and puts the answer on the response as `sender_governance` — **an annotation, never a
gate**. Which constitution governs a cross-border chit is §9's open decision, not this route's.

**The sweep** (the single-source question) found one more resolver and three writers:

- ⚠️ `lib/workpattern.js` resolved the constitution itself, with a **different fallback** — `is_default` where
  govresolve says `base`. Two answers to "who governs this entity". It now asks the one cascade; an unstamped
  entity's work pattern is governed by `base`. Only legacy rows are unstamped.
- The **stamp has three writers with three defaults**, and this is left open rather than changed unattended:
  the b254 trigger (population → installation → vertical, else `base`), registration in `routes/entities.js`
  (chosen constitution else `is_default`, then the *inverse* lookup installation-by-vertical; runs
  `ON CONFLICT DO UPDATE`, so it wins over the trigger), and boilerplate adoption in `routes/governance.js`
  (`is_default`, else the literal `'trade'`). → **§9.10.**

`tests/govresolve-ctp.test.cjs` (10 checks) holds all of this: the remote door resolves the *sender's* own
constitution, the two doors agree for the same world, tighten-only survives, an unknown installation is a
stated fallback, and — in `lib/` — only `govresolve` may resolve a constitution from the governance tables.

## 6.2 The read verb — a catalogue is PULLED, by store id (DECIDED 2026-09-16)

Athi: *"catalogue pull I guess. currently, within the platform, we are just pulling the catalogue based on the
store id, the store is not pushing the catalogue; the same resolves in cross platform also."*

**This settles §9.6 the other way from what it recommended.** §9.6 said *"push status changes as further
envelopes rather than invent a read path"* — and for *status* that still stands. For a *catalogue* the local
shape is a pull (`GET /api/catalogue/:bridge_id`, answered with the anonymous public view), so the
cross-installation shape is the same pull, over a signed question:

```
POST <peer>/api/ctp/query
{ ctp:'1', kind:'query', from:{installation_key, population, bridge_id}, to:{domain},
  ask:{ want:'resolve', handle } | { want:'catalogue', bridge_id }, nonce, at, sealed }
```

| question | answers | why it exists |
|---|---|---|
| `resolve` | `bridge_id`, `display_name`, `address` | a person types a **handle**; the wire wants a **bridge id**; the handle is a name in the *other* database. Asked once, at add-supplier time — then the bridge id is stored. Closes **NS-3.** |
| `catalogue` | the public storefront view | the pull itself |

**Door-keeping is the same as `deliver`, in the same order:** is the asker an installation we deal with (b257
row, remote, active, with a domain) → verify the signature against the key on *their* domain → answer. A
stranger installation gets nothing; discovery stays open. ⚠️ **The population rule is not applied to a read** —
b247 bounds who may *transact*, and a public catalogue is public to the whole web already.

⭐ **The answer is the same function an anonymous visitor gets.** `routes/catalogue.js` now has one
`publicViewFor(entity, asOwner)`; the local `/:bridge_id` route and the CTP `/query` door both call it, the
latter always with `asOwner: false`. A peer is never the owner, so a cross-installation pull can never show
more than `/shop.html?s=<store>` shows — and `tests/ctp-query.test.cjs` asserts `buildPublicView` is called
from exactly one place. `resolve` answers only for a **business**: the grammar (`lib/resolveuserid`) refuses an
employee, a customer or a minted party before the database is asked.

**Replay:** every question carries a nonce and a time; one older than five minutes is refused. **The answer is
not signed** — the asker reached the endpoint it resolved for that domain over TLS with `redirect: 'error'` —
recorded as **§9.11** rather than done quietly.

`lib/ctpquery.js` is the module (build · sign · open · `ask()`); `tests/ctp-query.test.cjs` is the proof.

## 6.3 Does a chit know it came from another domain? — no, and that is the point (2026-09-16)

Athi: *"how does the chit know this request is from another domain? does it need to know? … put some indicator
so we know the difference."*

**It does not need to know.** Past the door, `mint.deliver` writes a cross-installation copy **byte-for-byte
the way it writes a local one** — the sender is named by `bridge_id`, which is true whether they are next door
or across the world. The chit machinery is domain-blind on purpose: if delivery had to branch on origin, every
downstream reader — the inbox, the dispute flow, the ledger — would have to as well. Proven live: a chit from
`domaintst` sits in tallytest's books as `received/pending`, the same shape as any local one, and **domaintst
has zero identity rows here** — the recipient copy names it by bridge id alone.

**But a person wants to see the difference**, so the fact is *recorded, not acted on*. On arrival the copy's
`business_json` gains:

```
ctp_arrival: { via_ctp: true, from_installation, from_domain, sender_bridge_id, at }
```

A screen can render *"arrived from mx.chitandbridge.com"* from that. Nothing in the delivery path reads it or
behaves differently because of it — **a marker, not a switch** — and a locally-delivered chit has no
`ctp_arrival` key at all, so its absence *is* the "local" state. It rides in `business_json` (jsonb, already on
`chit_header` per copy), so there is no migration and no new column.

## 6.4 Is an address also access? — no (the question of 2026-09-16)

Athi: *"when you share your id with someone else, you always share the domain too — so any domain can access
your entity?"*

**No. An address is discovery; it is not authorization.** `bridge_id@domain` lets someone *find and reach* your
installation's door, exactly like an email address. Two independent gates stand behind it, both default-deny:

1. **The installation registry (b257).** The sender's `installation_key` must already be a row in *your*
   `installation` table, `active`, remote. A stranger installation you have never recorded is refused —
   *"installation X is not one we deal with"* (403) — at both the deliver and the query door. Registering a peer
   is a deliberate act.
2. **The population rule (b258, `ops.f_ctp_may_deliver`).** `live` is universally shared between *registered*
   installations — two live worlds trading is ordinary cross-border commerce — but every sandbox population
   accepts nobody until it names that installation in `ctp_peers`.

So the domain in your address grants nothing on its own: a chit can only be delivered from an installation you
have registered, and then only where the population rule allows. *"Is he a member of me?"* is still asked on
arrival, which was the original requirement. The one thing any registered peer can read is the **public**
catalogue — the same data already on your public storefront, and never the owner-only view.

## 7. ⚠️⚠️ The boundary becomes a protocol rule

**This is the most dangerous thing in the design and the reason to write the note before the code.**

b247 enforces population isolation with a **database trigger that can see both entities**. Across installations
it cannot — the remote entity is not in this database. So:

- the envelope **carries** `from.population`
- the receiving installation **refuses** any envelope whose population does not match the recipient's
- the refusal is a **hard reject**, not a warning, and not a fallback to "live"

Without this, a test world on one machine can deliver into a live world on another and there is nothing
anywhere to stop it. Every other guarantee in the product is downstream of that boundary.

⭐ **And it must be tested by attempting it.** A conformance case that sends `population: 'test'` to a live
installation and asserts a 409 — the same discipline b247 itself used, which refused to install without proving
the trigger fired.

### 7.1 ⚠️ A population code is a LOCAL name — matching on the string is a trap

Athi, 2026-09-15: *"only for LIVE to Live, test to test? is that correct?"* — right for live, and a trap for
everything else.

`live` is a **universally shared meaning**: live is live, on any installation, and two live worlds trading is
exactly cross-border commerce. But `test` on our engine and `test` on a customer's engine are **two unrelated
sealed worlds that happen to share a word**. Matching on the code would wire a stranger's sandbox to ours
because we both typed the obvious thing.

| sender | recipient | |
|---|---|---|
| `live` | `live` | **allowed, always** — one live world, spanning installations |
| non-live | same code, other installation | **refused by default** — a shared name is not a shared world |
| non-live | non-live | allowed **only** where both sides have declared an explicit pairing |

⭐ The pairing is not a chore, it is a feature people will want: two companies deliberately wiring their
sandboxes together to rehearse an integration before either goes live. It just has to be *said* by both, rather
than inferred from a string.

⚠️ This also means the manifest in §5.1 must list **which populations an installation will accept envelopes
for** — refusing at the door is better than accepting and rejecting after the bytes have crossed a border.

---

## 8. Trust, and the rule that keeps the two transports honest

### 8.1 Trust model

- each installation holds a key pair; the public half is published in the directory (`root_key_ref`)
- the sender signs `canon.hash(envelope)` with its private half
- the receiver verifies against the directory's copy of the sender's public key
- **an unsigned or unverifiable envelope is rejected**, with no "accept and warn" mode

⚠️ **Key rotation and revocation are not optional extras.** A protocol with no way to retire a compromised
installation key is a protocol with one very bad day in it. **Open decision, §9.3.**

### 8.2 The conformance rule

From Athi's own constraint:

> *"this can be a completely different new machinery or a part of an existing engine — **the behaviour should be
> the same**."*

**Therefore: the same delivery, run locally and run over the wire, must produce identical rows.** Not similar —
identical, field by field, excluding only timestamps and transport metadata.

This is a test, not an aspiration: build the same chit twice, deliver one locally and one through a loopback CTP
endpoint into a second schema, and diff `chit_header` + `chit_status` + `state_log`. It is the only thing that
makes §8's promise checkable, and it is what makes a world liftable in §10.

---

## 9. Open decisions — settle these before implementation

1. **What does the recipient learn about other parties?** `all_recipients` names everyone. Send whole, send
   redacted, or send a count? Affects CC'd orders and any multi-party lane.
2. **Whose PII rides in a copy?** — *carried over unanswered from
   [DATA-RESIDENCY-DESIGN.md](DATA-RESIDENCY-DESIGN.md) §2.* A copy holds the counterparty's name and contact;
   residency law cares about personal data of a region's residents. **Legal decision, not technical.** CTP makes
   it urgent because the data now physically crosses a border.
3. **Key rotation and revocation.** How is a compromised installation key retired, and what happens to
   envelopes already in flight and already accepted?
4. ~~**Who runs the directory?**~~ **DECIDED 2026-09-15: nobody.** DNS-style discovery — each installation
   publishes a signed manifest on its own domain and we run a cache plus the member registry, never the
   namespace. See §5.1. What remains is smaller: the human-typed address form, where `bridge_id@domain` is
   recommended.
5. **Delivery receipts and failure.** The sender's copy must not read *delivered* until the remote **accepted** —
   the receipt-reports-outcome rule at protocol scale. What is the state while queued? What is the state after
   permanent failure, and who is told?
6. **Cross-installation participant reads** — *carried over from
   [DATA-RESIDENCY-DESIGN.md](DATA-RESIDENCY-DESIGN.md) §1.* "Who has read / accepted" reads every party's
   status. Across a wire that is either a federated read or a pushed projection. CTP should push status changes
   as further envelopes rather than invent a read path.
7. **Amendments, disputes and state changes after delivery.** A chit is not write-once — statuses change,
   amendments are raised, disputes open. **Each of those is another envelope**, and the protocol must say so
   explicitly or it will be retrofitted badly.
8. **Ordering.** Envelope 2 (an amendment) must not apply before envelope 1 (the chit). Sequence per
   `chit_id`, and reject or park out-of-order arrivals.
9. **Cost and operations** — *carried over from [DATA-RESIDENCY-DESIGN.md](DATA-RESIDENCY-DESIGN.md) §3.* N
   installations is materially more to run, back up and migrate. Real and ongoing.

---

10. **The governance stamp has three writers with three defaults** — *carried in from §6.1, 2026-09-16.*
    The b254 trigger stamps `population → installation → vertical`, else `base`; registration in
    `routes/entities.js` stamps the chosen constitution else `is_default`, finds the installation by the
    *inverse* lookup (`installation WHERE vertical_key = …`) and runs `ON CONFLICT DO UPDATE`, so it wins over
    the trigger; boilerplate adoption in `routes/governance.js` stamps `is_default`, else the literal
    `'trade'`. **Resolution** is now single-source (`lib/govresolve`); **writing** is not. Which writer is
    the authority, and whether `base` / `is_default` / `'trade'` are one default or three, is a decision —
    left unchanged unattended because it is registration behaviour.

11. **The answer to a query is not signed** — *from §6.2, 2026-09-16.* The QUESTION is signed (so the answerer
    knows who is asking); the ANSWER rides back over TLS to the endpoint the asker resolved for that domain, with
    `redirect: 'error'`. A signed answer would add a second key ceremony for a public fact. Whether that is
    enough — or whether a peer should be able to prove *what it was told* to a third party — is undecided.

## 10. Why this makes a world liftable

A world is a `population` (boundary) paired with an `installation` (character) — b254. Today both are rows in
one database. With CTP and the conformance test of §8.2, moving one world onto its own machine is:

1. stand up the installation with its own database
2. move that population's rows
3. add it to the directory
4. every address that used to resolve local now resolves remote — **and nothing else changes**

That is the test of whether this design is right. If lifting a world requires touching anything other than the
directory, the transport boundary is in the wrong place.

---

## 11. Sequencing

| | | why |
|---|---|---|
| 1 | **A — cross-region in one engine** (§4) | settles *meaning* where everything is observable; first real exercise of the cascade |
| 2 | **`deliver()` gains an address resolver** — all local | the seam, with no behaviour change and no wire |
| 3 | **Loopback CTP + the conformance test** (§8.2) | proves the two transports agree *before* a second machine exists |
| 4 | **Directory + signing + the population reject** (§5.1, §7, §8.1) | the trust surface, alone, testable |
| 5 | **A second real installation** | by which point the protocol is the only new thing |

⚠️ Steps 1–3 need no second machine and no new infrastructure. **If the design is wrong, it will be wrong at
step 3**, which costs a day, not a deployment.

---

## Where it sits

- **Depends on:** b254 (worlds), b74 (installation), b73 (entity_governance), b247 (the boundary),
  `lib/canon.js`, `lib/mint.js`
- **Related:** [DATA-RESIDENCY-DESIGN.md](DATA-RESIDENCY-DESIGN.md) · `project-o1-seal` ·
  `project-chitbridge-canon-hardening` · `reference-rail-metaphor` · `project-jurisdiction-pivot`
- **Blocked on:** the nine decisions in §9. Four of them (2, 4, 5, 7) change the shape of the envelope or the
  trust model, so they are not implementation details to be discovered later.
