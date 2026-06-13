-- ============================================================
-- CHIT AND BRIDGE MVP — PostgreSQL Schema
-- Version 1.0 — June 2026
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLE 1: identities
-- All participants — entities only for MVP
-- Actors, devices, processes deferred to iteration 2
-- ============================================================
CREATE TABLE IF NOT EXISTS identities (
  identity_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_id          VARCHAR(32) UNIQUE NOT NULL,
  display_name       VARCHAR(255) NOT NULL,
  email              VARCHAR(255) UNIQUE NOT NULL,
  email_verified     BOOLEAN DEFAULT FALSE,
  phone              VARCHAR(20),
  country            VARCHAR(2) DEFAULT 'IN',
  currency_code      VARCHAR(3) DEFAULT 'INR',
  identity_type      VARCHAR(20) DEFAULT 'entity',
  -- entity | actor | customer | device | process
  -- MVP: entity only
  parent_entity_id   UUID REFERENCES identities(identity_id),
  -- NULL for entity type
  auth_method        VARCHAR(30) DEFAULT 'otp',
  -- oauth | otp | api_key | service_token
  -- MVP: otp for simplicity
  status             VARCHAR(20) DEFAULT 'active',
  -- active | inactive | suspended | blocked
  otp_code           VARCHAR(6),
  otp_expires_at     TIMESTAMP,
  last_active_at     TIMESTAMP,
  created_at         TIMESTAMP DEFAULT NOW(),
  created_by         UUID
);

-- Indexes for identities
CREATE INDEX IF NOT EXISTS idx_identities_email
  ON identities(email);

CREATE INDEX IF NOT EXISTS idx_identities_bridge_id
  ON identities(bridge_id);

CREATE INDEX IF NOT EXISTS idx_identities_display_name
  ON identities(LOWER(display_name));

-- ============================================================
-- TABLE 2: connections
-- Handshake between two entities
-- Request → Accept or Reject
-- ============================================================
CREATE TABLE IF NOT EXISTS connections (
  connection_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity_id       UUID NOT NULL REFERENCES identities(identity_id),
  from_display_name    VARCHAR(255) NOT NULL,
  -- snapshot at request time
  from_bridge_id       VARCHAR(32) NOT NULL,
  -- snapshot at request time
  to_entity_id         UUID NOT NULL REFERENCES identities(identity_id),
  to_display_name      VARCHAR(255) NOT NULL,
  -- snapshot at request time
  to_bridge_id         VARCHAR(32) NOT NULL,
  -- snapshot at request time
  status               VARCHAR(20) DEFAULT 'pending',
  -- pending | accepted | rejected | blocked
  note                 TEXT,
  -- introduction note from sender
  responded_at         TIMESTAMP,
  created_at           TIMESTAMP DEFAULT NOW(),
  UNIQUE (from_entity_id, to_entity_id)
  -- one connection per pair
);

-- Indexes for connections
CREATE INDEX IF NOT EXISTS idx_connections_from
  ON connections(from_entity_id, status);

CREATE INDEX IF NOT EXISTS idx_connections_to
  ON connections(to_entity_id, status);

-- ============================================================
-- TABLE 3: chit_header
-- One row per entity per chit
-- Composite unique: chit_id + entity_id
-- Immutable after send — snapshot everything
-- ============================================================
CREATE TABLE IF NOT EXISTS chit_header (
  header_id                  UUID DEFAULT gen_random_uuid(),
  chit_id                    UUID NOT NULL,
  -- same across all participants
  entity_id                  UUID NOT NULL REFERENCES identities(identity_id),
  -- whose record this is

  -- Sender snapshot — immutable
  sender_entity_id           UUID NOT NULL,
  sender_entity_bridge_id    VARCHAR(32) NOT NULL,
  sender_entity_display_name VARCHAR(255) NOT NULL,

  -- Actor snapshot — NULL for MVP iteration 1
  created_by_actor_id        UUID,
  created_by_actor_display_name VARCHAR(255),

  -- All recipients inline — snapshot
  all_recipients             JSONB NOT NULL DEFAULT '[]',
  -- [{entity_id, bridge_id, display_name, role}]
  -- role: sender | receiver | cc

  -- Purpose and classification
  purpose                    VARCHAR(50) NOT NULL DEFAULT 'general',
  -- order | invoice | receipt | inquiry | general

  -- Subject fields — four types
  auto_subject               VARCHAR(255),
  -- platform generated from purpose + sender + date
  manual_subject             VARCHAR(500),
  -- written by sender — optional
  summary_json               JSONB,
  -- calculated from line items at send time
  business_json              JSONB,
  -- business layer metadata — platform carries as-is

  -- Chit chain
  chit_ref                   UUID,
  -- groups related chits — like email thread
  previous_chit_id           UUID,
  -- forward chain link

  -- Timestamps — immutable
  created_at                 TIMESTAMP DEFAULT NOW(),
  sent_at                    TIMESTAMP,
  schema_version             VARCHAR(20) DEFAULT '1.0',

  PRIMARY KEY (chit_id, entity_id)
);

-- Indexes for chit_header
CREATE INDEX IF NOT EXISTS idx_chit_header_entity_created
  ON chit_header(entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chit_header_sender
  ON chit_header(sender_entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chit_header_chit
  ON chit_header(chit_id);

-- GIN index for JSONB recipient search
CREATE INDEX IF NOT EXISTS idx_chit_header_recipients_gin
  ON chit_header USING GIN(all_recipients);

-- ============================================================
-- TABLE 4: chit_detail
-- One row per entity per chit
-- Line items deleted after delivery
-- Structural metadata always remains
-- ============================================================
CREATE TABLE IF NOT EXISTS chit_detail (
  detail_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id              UUID NOT NULL,
  entity_id            UUID NOT NULL REFERENCES identities(identity_id),

  -- Structural metadata — NEVER deleted
  detail_type          VARCHAR(50) DEFAULT 'general',
  line_item_count      INTEGER DEFAULT 0,
  total_value          DECIMAL(15,2) DEFAULT 0.00,
  currency_code        VARCHAR(3) DEFAULT 'INR',

  -- Business payload — DELETED after delivery
  line_items           JSONB,
  -- single JSONB row — all items together
  -- set to NULL after fire and forget delivery
  -- [{name, quantity, unit, price, total, category}]

  -- Lifecycle audit — NEVER deleted
  payload_delivered_at TIMESTAMP,
  payload_deleted_at   TIMESTAMP,
  created_at           TIMESTAMP DEFAULT NOW(),

  UNIQUE (chit_id, entity_id)
);

-- Indexes for chit_detail
CREATE INDEX IF NOT EXISTS idx_chit_detail_chit
  ON chit_detail(chit_id);

CREATE INDEX IF NOT EXISTS idx_chit_detail_entity
  ON chit_detail(entity_id);

-- ============================================================
-- TABLE 5: chit_status
-- One row per entity per chit
-- Mutable — changes as chit progresses
-- Each entity owns their own state independently
-- ============================================================
CREATE TABLE IF NOT EXISTS chit_status (
  status_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id              UUID NOT NULL,
  entity_id            UUID NOT NULL REFERENCES identities(identity_id),

  -- Mutable operational state
  current_status       VARCHAR(30) DEFAULT 'pending',
  -- pending | delivered | read | accepted | rejected
  -- in_progress | partial | completed | cancelled

  -- Actor assignment — NULL for MVP iteration 1
  assigned_to_actor_id          UUID,
  assigned_to_actor_display_name VARCHAR(255),
  assignment_type               VARCHAR(20) DEFAULT 'default',
  -- sender_specified | default | manual

  -- Per entity personal state
  read_at              TIMESTAMP,
  star_flag            BOOLEAN DEFAULT FALSE,
  priority_flag        VARCHAR(10) DEFAULT 'normal',
  -- normal | high | urgent
  snoozed_until        TIMESTAMP,
  deleted_at           TIMESTAMP,
  -- soft delete — removed from inbox view

  -- Retention
  retention_expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '90 days'),
  legal_hold           BOOLEAN DEFAULT FALSE,

  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP DEFAULT NOW(),

  UNIQUE (chit_id, entity_id)
);

-- Indexes for chit_status
CREATE INDEX IF NOT EXISTS idx_chit_status_entity_status
  ON chit_status(entity_id, current_status);

CREATE INDEX IF NOT EXISTS idx_chit_status_chit
  ON chit_status(chit_id);

CREATE INDEX IF NOT EXISTS idx_chit_status_entity_read
  ON chit_status(entity_id, read_at);

-- ============================================================
-- TABLE 6: state_log
-- Append only — never update, never delete
-- Full audit trail per entity per chit
-- Composite unique: chit_id + entity_id + log entry
-- ============================================================
CREATE TABLE IF NOT EXISTS state_log (
  log_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id       UUID NOT NULL,
  entity_id     UUID NOT NULL REFERENCES identities(identity_id),
  -- whose log entry this is

  -- What happened
  action        VARCHAR(50) NOT NULL,
  -- created | delivered | read | accepted | rejected
  -- assigned | reassigned | completed | cancelled
  -- connection_requested | connection_accepted | connection_rejected

  -- Who did it
  action_by_identity_id    UUID,
  action_by_display_name   VARCHAR(255),

  -- Context
  previous_status  VARCHAR(30),
  new_status       VARCHAR(30),
  detail           TEXT,
  -- human readable description of what happened

  -- Always immutable
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Indexes for state_log
CREATE INDEX IF NOT EXISTS idx_state_log_chit_entity
  ON state_log(chit_id, entity_id, created_at);

CREATE INDEX IF NOT EXISTS idx_state_log_entity
  ON state_log(entity_id, created_at DESC);

-- ============================================================
-- HELPER FUNCTION: Generate bridge_id
-- Format: CB + 8 random alphanumeric characters
-- ============================================================
CREATE OR REPLACE FUNCTION generate_bridge_id()
RETURNS VARCHAR(32) AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := 'CB';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Schema verification query
-- Run after setup to confirm all tables created
-- ============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
-- Expected: chit_detail, chit_header, chit_status,
--           connections, identities, state_log

SELECT 'Schema created successfully' AS status,
       COUNT(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'identities', 'connections',
  'chit_header', 'chit_detail',
  'chit_status', 'state_log'
);
