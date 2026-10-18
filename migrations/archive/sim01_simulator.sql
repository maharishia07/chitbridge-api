-- sim01_simulator.sql — DB-backed content for the public /tour showcase page (SimulatorPage).
-- SEPARATE from the cb_* network tables and the legacy identities tables.
-- Content tables (sim_layers/items/shapes/rules/compare/usps) are read by GET /api/simulator/content.
-- Capture tables (sim_leads/sim_feedback) are written by POST /api/simulator/lead and /feedback.
--
-- ⚠️ DRAFT SEED — every row of copy below is authored from the Chit & Bridge design canon as a
--    working placeholder so the page renders end to end. REVIEW AND REPLACE before showing publicly.
--    Readiness values are best-effort; confirm each against the actual build.
-- Idempotent: safe to re-run. Re-seeds content tables from scratch; never touches captured leads/feedback.

-- ===== content tables (integer PKs — the page keys on layer_id===3 etc.) =====
create table if not exists sim_layers (
  id   int primary key,
  ord  int not null,
  name text not null,
  purpose text not null
);

create table if not exists sim_items (
  id       int primary key,
  layer_id int not null references sim_layers(id),
  name     text not null,
  meaning  text not null,
  readiness text not null default 'designed' check (readiness in ('working','designed','soon')),
  ex_pharmacy   text,
  ex_restaurant text,
  -- future "why it sits here" lens — left empty for now (the plain map stays plain):
  pleasure text,
  pain     text,
  decisive text
);

create table if not exists sim_shapes (
  id   int primary key,
  name text not null,
  customer_home text not null,
  discovery text not null,
  note text
);

create table if not exists sim_rules (
  id   int primary key,
  ord  int not null,
  question text not null,
  disposition text not null check (disposition in ('exclude','defer','configure','pass')),
  detail text not null
);

create table if not exists sim_compare (
  id   int primary key,
  ord  int not null,
  neighbour text not null,
  does text not null,
  difference text not null
);

create table if not exists sim_usps (
  id   int primary key,
  ord  int not null,
  name text not null,
  why  text not null,
  readiness text not null default 'designed' check (readiness in ('working','designed','soon')),
  -- pleasure/pain lens (section 1 of the build doc):
  pleasure text,
  pain     text
);

-- ===== capture tables (uuid PKs; never truncated by re-seed) =====
create extension if not exists "pgcrypto";

create table if not exists sim_leads (
  id    uuid primary key default gen_random_uuid(),
  name  text not null,
  email text not null,
  org   text,
  created_at timestamptz not null default now()
);

create table if not exists sim_feedback (
  id      uuid primary key default gen_random_uuid(),
  lead_id uuid references sim_leads(id),
  section text,
  rating  int,
  message text not null,
  created_at timestamptz not null default now()
);

-- ===== re-seed content (delete children before parents) =====
truncate sim_items, sim_compare, sim_rules, sim_shapes, sim_usps, sim_layers restart identity cascade;

-- 7 user-facing parts (the engine underneath is the same for everyone) ---------
insert into sim_layers (id, ord, name, purpose) values
 (1,1,'Identity & network','Who you are, and the tree of organisations you connect to — by invitation and consent.'),
 (2,2,'The rulebook','The constitution every deal inherits — a tightening-only set of rules that can only get stricter downstream.'),
 (3,3,'Catalogue','What you offer, and at which price tier each buyer sees.'),
 (4,4,'Deals (chits)','The actual transaction — an offer that either completes in full or cleanly stops and compensates.'),
 (5,5,'Permissions','Who may do what: standing authority (a grant) versus a single expiring deal (a chit).'),
 (6,6,'Receipts','A frozen, point-in-time record once a deal is struck — corrections are new records, never edits.'),
 (7,7,'Your setup','The vertical, jurisdiction and shape you inherit — the same engine, configured for your trade.');

-- map items (layer 3 carries the pharmacy/restaurant examples the "See it work" tab switches on) --
insert into sim_items (id, layer_id, name, meaning, readiness, ex_pharmacy, ex_restaurant) values
 (101,1,'Bridge ID','A portable identifier for each organisation — point to it, do not copy it.','working',null,null),
 (102,1,'Tree-only network','Connections form a tree: down-only, no cycles, consent on both sides.','working',null,null),
 (103,2,'Tightening-only cascade','A downstream rule can make an inherited rule stricter, never looser.','working',null,null),
 (104,2,'Stop-and-name on clash','Two rules that cannot both hold halt the deal and name the pair — the engine never guesses.','working',null,null),
 (105,3,'Product catalogue','Your sellable items, by category.','working','Paracetamol 500mg — batch & expiry tracked','Margherita pizza — allergens listed'),
 (106,3,'Price tiers','The same item shows a different price to different buyer classes.','working','trade price to the chemist vs MRP','aggregator price vs dine-in'),
 (107,3,'Stock state','An out-of-stock item is hidden, not deleted.','designed','out-of-stock SKU hides from the order pad','86''d dish greys out on the menu'),
 (108,4,'Aggregator-path chit','A deal chains hop-by-hop through the network; the far origin stays masked from the end node.','working',null,null),
 (109,4,'Complete-or-compensate','A deal fully completes, or stops and runs the compensation path declared up front.','designed',null,null),
 (110,5,'Grant (standing authority)','A durable permission an entity holds until revoked.','designed',null,null),
 (111,5,'Chit (single deal)','A one-shot, expiring permission scoped to one transaction.','working',null,null),
 (112,6,'Frozen receipt','The record is fixed at the moment of agreement and cannot be edited after the fact.','working',null,null),
 (113,6,'Dispute flag','A frozen receipt plus a named forum is what a dispute attaches to.','designed',null,null),
 (114,7,'Platform shape','Distribution chain, marketplace, or buyers'' circle — chosen as a setting, not rebuilt.','designed',null,null),
 (115,7,'Vertical inheritance','Your trade''s fields and defaults fold onto the same engine.','working','distributor feed adds supplier_ref','menu feed adds prep-station');

-- platform shapes (the "Change the platform shape" control) --------------------
insert into sim_shapes (id, name, customer_home, discovery, note) values
 (1,'Distribution chain (B2B)','inside the network — each tier sells to the tier below','by invitation up the chain','The classic aggregator → distributor → retailer tree.'),
 (2,'Open marketplace','the public','search and browse','Buyers discover sellers directly; the host does not capture the customer.'),
 (3,'Buyers'' circle','vetted members only','membership, not open search','A closed group transacting under one shared rulebook.');

-- "Will it work for my business?" — a rule fires when answered YES ------------
-- worst disposition wins: exclude > defer > configure > pass
insert into sim_rules (id, ord, question, disposition, detail) values
 (1,1,'Do you need to mix consumer and business buyers inside one shared network?','exclude','Not supported — that is excluded by design. Run one shape per network, or two networks.'),
 (2,2,'Do you require cross-border settlement with a hard guarantee today?','defer','The cross-border protocol is designed but not built yet — this would wait on it.'),
 (3,3,'Do you run a multi-tier distribution chain (aggregator → distributor → retailer)?','configure','Strong fit — set the platform shape to Distribution (B2B).'),
 (4,4,'Do you sell the same item at different price tiers (trade vs retail)?','configure','Supported — enable price tiers on the catalogue.'),
 (5,5,'Do you transact mostly with other organisations, not end consumers?','pass','Core fit — this is exactly what the platform is for.'),
 (6,6,'Do you need an auditable record of who agreed to what, and when?','pass','Core fit — the frozen receipt is built for this.');

-- "How we compare" table -------------------------------------------------------
insert into sim_compare (id, ord, neighbour, does, difference) values
 (1,1,'ERP','Runs the internals of one company.','We govern across companies, not inside one.'),
 (2,2,'Marketplace','Matches buyers and sellers and takes a cut.','We do not sit on the money or capture the customer — the host''s power is capped.'),
 (3,3,'EDI','Exchanges documents between firms.','We add a rulebook and a complete-or-compensate guarantee, not just message passing.'),
 (4,4,'Payments rail','Moves the money.','We govern the agreement; we are not the rail and do not issue identity.'),
 (5,5,'Smart contracts','Immutable code-is-law on a shared ledger.','Exact, human-attested rules — a person is accountable — with no token required.');

-- USPs (name + pain text are from the build-doc delta; why/pleasure/readiness authored here) --
insert into sim_usps (id, ord, name, why, readiness) values
 (1,1,'Complete-or-compensate','A deal either fully completes, or cleanly stops and pays out a pre-agreed compensation — on the record.','designed'),
 (2,2,'Stop-and-name rule','When two rules cannot both hold, the platform halts the deal and names the exact pair that clash.','working'),
 (3,3,'Dispute flag','A disagreement attaches to a frozen receipt and a named forum — structured, not a free-for-all.','designed'),
 (4,4,'Frozen receipt','The record is fixed at the moment of agreement; corrections are new records, never silent edits.','working'),
 (5,5,'Four cascades, one engine','Floor, tighten, advise and add all fold through a single resolver in a defined order.','working'),
 (6,6,'Two permissions','Standing authority (a grant) and a single expiring deal (a chit) are modelled as distinct things.','designed'),
 (7,7,'Point-don''t-copy','Shared facts are referenced at a versioned source, not duplicated, so they cannot silently drift.','designed'),
 (8,8,'Platform shape as a setting','Distribution, marketplace or circle is a configuration of one engine, not a separate build.','designed'),
 (9,9,'Certificate cascade','Audit certificates cascade down the tree to a capped depth, and their existence is checked.','designed'),
 (10,10,'Default-deny visibility','Nothing is shared across the network unless a share is explicitly allowed.','designed'),
 (11,11,'Host-power cap','The platform owner deliberately gives up the capture levers a marketplace would normally grab.','designed'),
 (12,12,'AI harness','AI proposes and maps; a qualified human attests; the engine disposes — a safe harness for agents in commerce.','soon'),
 (13,13,'Cross-border protocol','A path for cross-border deals with an end-to-end guarantee — designed, not yet built.','soon');

-- ===== section 1 of the build doc: pleasure (upside) + pain (honest trade-off) =====
update sim_usps set pleasure = why where pleasure is null;

update sim_usps set pain = 'the compensation path must be defined up front, and the guarantee is record-level, not the physical world' where name='Complete-or-compensate';
update sim_usps set pain = 'a clash halts the deal until it is resolved — the friction is deliberate' where name='Stop-and-name rule';
update sim_usps set pain = 'needs the frozen receipt and a named forum to exist first' where name='Dispute flag';
update sim_usps set pain = 'a receipt can''t be edited after the fact — corrections are new records' where name='Frozen receipt';
update sim_usps set pain = 'every rule must declare its kind so it folds correctly — authoring discipline' where name='Four cascades, one engine';
update sim_usps set pain = 'two concepts to model (standing authority vs an expiring chit), not one simple role' where name='Two permissions';
update sim_usps set pain = 'you depend on the source staying available and versioned; a broken reference is a real failure mode' where name='Point-don''t-copy';
update sim_usps set pain = 'only a supported set of shapes; mixing business and consumer in one network is excluded' where name='Platform shape as a setting';
update sim_usps set pain = 'depth is capped, and we check that a certificate exists — not how good the audit was' where name='Certificate cascade';
update sim_usps set pain = 'every share must be explicitly allowed — more setup than open-by-default' where name='Default-deny visibility';
update sim_usps set pain = 'the platform owner gives up capture levers a marketplace would normally grab' where name='Host-power cap';
update sim_usps set pain = 'a human attester stays in the loop — not full autonomy — and who is accountable is still open' where name='AI harness';
update sim_usps set pain = 'not built yet, and genuinely hard' where name='Cross-border protocol';
