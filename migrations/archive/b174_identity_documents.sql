-- b174 — an employee's own identity record: phone, email, and government IDs, with a verification stamp.
--
-- Athi, 2026-08-20: *"his phone number, and any email id, pan card, voter id, aadhar card, which he can
-- submit here for verification so it become his record."*
--
-- ⭐⭐ THIS IS THE SAME SHAPE AS THE ENTITY'S LICENCE, NOT A NEW IDEA. IAM-SPEC §3 already settled it for the
-- business: country is the PIVOT, and what it pivots to is a (scheme, value) pair — GSTIN in India, TRN in the
-- UAE, VAT in the UK. A person's documents are that same pair with a different catalogue: PAN, Voter ID,
-- Aadhaar, driving licence, passport. One mechanism, two catalogues — so this table is deliberately NOT
-- five columns named pan/voter_id/aadhaar/dl/passport, which would need a migration per country forever.
--
-- ⚠️⚠️ AADHAAR IS NOT STORED. NOT ENCRYPTED, NOT AT ALL — ONLY THE LAST FOUR DIGITS.
--
--   The Aadhaar Act 2016 and the UIDAI regulations restrict a private body from storing Aadhaar numbers, and
--   §29(4) restricts publishing or displaying one. "We encrypted it" is not the exemption people assume it is:
--   the restriction is on HOLDING and DISPLAYING the number, not on holding it badly. The lawful pattern is to
--   verify against UIDAI (offline eKYC XML / QR, or a Virtual ID) and keep only the OUTCOME plus a reference.
--
--   ⭐ AND THAT IS WHAT THIS PLATFORM ALREADY BELIEVES. [[reference-cb-core-principle]]: never hold what you can
--   attest to. [[project-attestation-layer]]: VERIFIED, not self-asserted. The employer does not need the
--   number — the employer needs to know a competent party checked it and when. Storing the digits would be
--   holding a liability to answer a question we can answer without it.
--
--   `value_enc` therefore stays NULL for AADHAAR, enforced by a CHECK. Not convention, not a comment — a
--   constraint, because a convention is what the next contributor will not know about.
--
-- ⚠️ EVERYTHING ELSE IS ENCRYPTED WITH THE EXISTING VAULT, NOT A NEW SCHEME. lib/vaultcrypto.js is AES-256-GCM
-- with the key in VAULT_ENC_KEY (env only, never in the DB) and it already returns a clean 503 when that key
-- is absent. So this table inherits a decision that was already reviewed rather than opening a second one.
--
-- ⚠️ VAULT_ENC_KEY IS NOT SET ANYWHERE TODAY. Until it is, the route refuses the write with 503 and stores
-- nothing. That is the correct posture: a half-configured secret store that accepts data is worse than one
-- that refuses it, because the refusal is visible and the plaintext is not.
--
-- ⭐ WHOSE RECORD IS IT. Athi said *"so it become HIS record"* — the employee's. The employer sees the VERDICT
-- (verified / when / by whom), never the document. That is the per-copy rule applied to a person: the fact
-- travels, the source does not.
--
-- WITH ROW LEVEL SECURITY — a new table holding entity data defaults to RLS, and this one holds the most
-- personal data in the system.

CREATE TABLE IF NOT EXISTS identity_documents (
  doc_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHOSE document. The person, and the employer whose tenant it sits in.
  identity_id      uuid NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,

  -- WHAT it is. Free-form scheme + country, so a new jurisdiction is a row, never a migration.
  country          varchar(2)  NOT NULL DEFAULT 'IN',
  scheme           varchar(24) NOT NULL,     -- PAN · AADHAAR · VOTER_ID · DL · PASSPORT · PHONE · EMAIL

  -- THE VALUE, in three parts that serve three different jobs.
  value_masked     varchar(64) NOT NULL,     -- what a human is shown:  XXXXXX1234
  value_hash       varchar(64),              -- sha256, for "is this the same document" WITHOUT holding it
  value_enc        text,                     -- lib/vaultcrypto ciphertext. NULL for AADHAAR, always.

  -- THE VERDICT — the part the employer actually consumes.
  status           varchar(16) NOT NULL DEFAULT 'unverified',
  verified_at      timestamptz,
  verified_by      varchar(64),              -- 'uidai-offline' · 'nsdl' · 'manual:<actor>' — WHO said so
  verification_ref varchar(128),             -- the counterfoil: a receipt id, never the document

  /**
   * ⭐⭐ WHO FILED IT, AND DID THE PERSON AGREE. Athi, 2026-08-20: *"we have to add as part of coassist
   * registration"* — so the OWNER types these while creating an employee, not only the employee themselves.
   *
   * ⚠️ THAT REMOVES THE PROPERTY THAT MADE THE ROUTE SAFE. As first written the route took no identity_id at
   * all: the subject was always the caller, so no shape of the request could file a document against another
   * person. Owner-side capture is a real need — HR collects documents, that is simply how hiring works — but it
   * reopens exactly that shape, so the fact of it has to be RECORDED rather than assumed away.
   *
   * `submitted_by` is 'self' or the identity that typed it. A document nobody can attribute is not evidence of
   * anything, and an employee querying their own record deserves to see who entered it.
   *
   * ⚠️ consent_at EXISTS BECAUSE OF AADHAAR SPECIFICALLY. Collecting an Aadhaar number requires the holder's
   * informed consent — an employer typing one unasked is the problem the Act is about, and it is not cured by
   * our not storing it. NULL means nobody has recorded consent, which the screen must show as such.
   */
  submitted_by     varchar(64) NOT NULL DEFAULT 'self',
  consent_at       timestamptz,

  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT idoc_status_check CHECK (status IN ('unverified','pending','verified','rejected','expired')),

  /* ⚠️⚠️ THE AADHAAR RULE, AS A CONSTRAINT. A comment saying "do not store it" is an instruction to a reader
     who may never arrive. This is a rule the database keeps whether anyone read the file or not. */
  CONSTRAINT idoc_aadhaar_never_stored CHECK (scheme <> 'AADHAAR' OR value_enc IS NULL),

  /* ⚠️ AND IF SOMEONE ELSE FILED AN AADHAAR, CONSENT MUST BE ON THE ROW. Self-submission is its own consent;
     an employer typing another person's number without it is the thing the Act is about. A constraint, so it
     holds for any writer — including one written next year that never read this file. */
  CONSTRAINT idoc_aadhaar_needs_consent
    CHECK (scheme <> 'AADHAAR' OR submitted_by = 'self' OR consent_at IS NOT NULL),

  /* One live row per person per scheme. A second PAN is a correction, not a second PAN. */
  CONSTRAINT idoc_one_per_scheme UNIQUE (identity_id, scheme)
);

CREATE INDEX IF NOT EXISTS idoc_identity_idx ON identity_documents (identity_id);
CREATE INDEX IF NOT EXISTS idoc_entity_idx   ON identity_documents (entity_id, status);

ALTER TABLE identity_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_documents FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idoc_tenant ON identity_documents;
CREATE POLICY idoc_tenant ON identity_documents
  USING       (entity_id = current_setting('app.entity_id', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.entity_id', true)::uuid);

/* ⚠️ NO UPDATE OR DELETE POLICY ON THE VERDICT COLUMNS BY DESIGN — a verification stamp that can be quietly
   rewritten is not evidence. Corrections are a new row after the old one is marked 'expired', which is the
   same reasoning b172's access_events rests on. */

-- What exists now. ONE result set — the Supabase editor shows only the last.
SELECT 'b174' AS report,
       (SELECT count(*) FROM information_schema.columns WHERE table_name = 'identity_documents') AS columns_created,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'identity_documents')                 AS policies,
       (SELECT count(*) FROM identity_documents)                                                 AS rows_present;
