# Data residency / geo-partitioning — feasibility & the seam (design note)

**Status:** discussion / feasibility — **NOT built.** Captured 2026-07-04 (Athi). Enable **per installation, on demand**
(regulation or a customer's requirement). This note records *why it's feasible*, *where it plugs in*, and *the open
questions* — so it can be picked up without re-deriving it.

## The question

Entities A and B transact. A wants **its** copy stored in Europe; B wants **its** copy in Asia. When we write the
data, can each participant's copy live in a different geographic zone — with clean separation by provenance?

## Short answer: yes, and the current architecture is unusually well-suited for it

Because a chit is **not one shared row** — it's **N per-entity copies**, one row per participant keyed by `entity_id`.
A's copy and B's copy are *already separate rows with separate owners*. So "A's copy in EU, B's copy in Asia" is just
**placing each entity's rows in that entity's region** — the unit of residency (the per-entity copy) already exists.
The B1 RLS work reinforces it: every access is `withEntity(me)` on your *own* rows, so if those rows live in your
region, isolation becomes **logical *and* geographic** with the same primitive.

## Granularity — three tiers (residency can be installation-dependent, not just per-entity)

Residency isn't one setting; it's a spectrum, and the **installation-level tier is the simplest and the likely
first one**:

1. **Installation-homed (whole deployment in one region) — simplest, near-free.** An entire installation (all its
   entities) runs in one region: a "Chit & Bridge EU" deployment lives in Europe, a "Chit & Bridge Asia" deployment
   in Asia. This is essentially **already possible** — deploy to the region and point `DATABASE_URL` there (config,
   Athi's rule). No intra-install cross-region delivery, because every entity is in the same region. Most customers
   who ask for residency actually want exactly this ("our whole deployment in the EU"). The **constitution/constellation**
   is the natural home for the setting: an installation declares its region as a governed attribute.
2. **Per-entity within one installation** — A in EU and B in Asia inside the *same* deployment. This is the harder
   case (cross-region delivery within one system) — the body of this note.
3. **Cross-installation federation** — two regional installations that transact (A on the EU install sends to B on
   the Asia install). Conceptually the *same* delivery seam (`chit_deliver`) extended **across installation
   boundaries** — the chit-as-bridge between installs, i.e. a *constellation of regional installations*. Biggest
   lift, but it reuses the same primitive.

Recommendation: offer **tier 1 first** (installation-homed, mostly config + regional deploy), and treat tiers 2–3 as
the deeper build the seam already anticipates.

## Foundations already in place that point the right way

- **Per-entity copies** — the natural residency unit (one row = one owner = one region).
- **`withEntity(me)` / RLS** — per-entity access, so a request can be *routed* to the entity's region.
- **The delivery agent (`chit_deliver`)** — the single seam where cross-region delivery plugs in (see below).
- **Connection-behind-config** — the DB connection lives only in `DATABASE_URL` (Athi's platform-configurability
  rule), so "which region's database" is a **routing/config decision, not hardcoded**.

## Implementation options (tradeoffs)

- **(a) Region-homed databases + routing — cleanest for true residency.** Each entity carries a `home_region`; its
  rows live in that region's Postgres; a request routes to the entity's home DB (`DATABASE_URL` per region). Data
  physically never leaves the region.
- **(b) Distributed SQL with row-level geo-partitioning** (CockroachDB / YugabyteDB) — tag a row with a region column
  and it's pinned there; purpose-built for this. **BUT: these REPLACE Postgres — they are not a layer on top of it.**
  They speak the Postgres *wire protocol* (so the `pg` driver/`DATABASE_URL` connect with little change), but they're
  independent engines and are **not 100% Postgres-compatible.** For us that's the crux, because we lean hard on
  Postgres-specific features: **RLS**, **SECURITY DEFINER PL/pgSQL** (the whole `b50–b52` delivery layer), and
  **triggers** (the assist projection). Feature parity for those is newer/partial on Cockroach and varies on
  Yugabyte — **must be verified before betting on it**, and it means leaving **Supabase** (auth/storage/managed PG).
  So (b) is a genuine engine migration, not a drop-in. (Yugabyte forks the actual Postgres query layer, so it tends
  to be more compatible than Cockroach — but still verify.)
- **Because of that, (a) region-homed Postgres + app routing is the lower-risk path for our stack** — it keeps
  Postgres/Supabase and every feature we've built (RLS, definers, triggers) unchanged; you add regions *around* the
  DB, not by swapping the DB. Reach for (b) only if native row-level geo-partitioning inside one logical cluster is a
  hard requirement.
- Single-cluster Postgres partitioning gives *logical* separation only — weaker for a cross-continent compliance story.

## The key mechanic: delivery becomes cross-region (and the mailing model already fits)

When A (EU) sends to B (Asia), A's copy must be written in EU and B's copy in Asia — no longer one local transaction.
`chit_deliver` is the seam: today it writes all copies in one local tx; tomorrow it writes the **local** copy
immediately and **delivers the remote copy asynchronously** to the recipient's region (a queue, retried) — exactly
like SMTP delivering to a mailbox in another country. That trades strict cross-copy atomicity (INV-2) for **eventual
delivery**, which is the *correct* semantics for a mailing model. So this *completes* the design rather than fighting it.

## Provenance / clean separation

Each copy already carries `entity_id` (whose copy) + the sender snapshot (provenance). Add a `residency_region`
derived from the owner's home region → **each copy lives in its owner's region, tagged with its owner.** The
**protected/governance layer** (the constellation) is the natural owner of the residency *policy*: it declares each
entity's home region as a governed, cascading attribute the entity can't quietly change.

## Open questions / honest caveats (settle before promising residency)

1. **Cross-region shared reads.** The participants panel (`chit_participants`, "who has read/accepted") reads all
   participants' status. If B's copy is in Asia and A asks from EU, that's a cross-region read — latency + a small
   data-crossing question. Likely a cached projection or a federated read.
2. **The real compliance sub-question — whose PII sits in which copy?** "A's copy in EU" is clean *if* A's copy holds
   A's data; but a copy also holds the counterparty's name/contact. Residency law cares about personal data of a
   region's residents, so a deliberate rule is needed on **what PII rides in each copy**. This is a legal/design
   decision, not just technical — resolve it before a residency promise.
3. **Cost & ops.** N regional databases (or a distributed engine) is materially more expensive and more complex to
   run, back up, and migrate than one Supabase. Real and ongoing.

## Where it sits

A **residency layer on top** — after B1 RLS and the delivery-agent are solid. Nothing in the current direction blocks
it; if anything it's teed up (per-copy + RLS + delivery seam + config-driven connection). Build only when an
installation demands it. A user-facing assistant Q&A records the capability (governance category) — see
`migration_b53_assist_residency_qa.sql`.
