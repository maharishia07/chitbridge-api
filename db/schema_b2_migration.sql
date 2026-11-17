-- Chit and Bridge B2 Migration
-- Run in Supabase SQL Editor BEFORE deploying B2
-- ============================================================

-- Add actor fields to identities table
ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS actor_key    VARCHAR(50)  NULL,
  ADD COLUMN IF NOT EXISTS actor_type   VARCHAR(30)  NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS user_id      VARCHAR(100) NULL;

-- Add schema reference to chit_header
ALTER TABLE chit_header
  ADD COLUMN IF NOT EXISTS schema_id UUID NULL;

-- Create entity_schemas table
CREATE TABLE IF NOT EXISTS entity_schemas (
  schema_id    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    UUID         NOT NULL REFERENCES identities(identity_id),
  schema_name  VARCHAR(255) NOT NULL DEFAULT 'Product Schema',
  schema_type  VARCHAR(50)  NOT NULL DEFAULT 'product'
               CHECK (schema_type IN ('product','service','custom','general')),
  source       VARCHAR(50)  NOT NULL DEFAULT 'manual'
               CHECK (source IN ('manual','template','import','sync')),
  status       VARCHAR(20)  NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','draft','archived')),
  is_default   BOOLEAN      NOT NULL DEFAULT TRUE,
  version      INTEGER      NOT NULL DEFAULT 1,
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_schemas_entity
  ON entity_schemas(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_schemas_default
  ON entity_schemas(entity_id, is_default);

-- Create schema_fields table
CREATE TABLE IF NOT EXISTS schema_fields (
  field_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_id      UUID         NOT NULL REFERENCES entity_schemas(schema_id),
  field_name     VARCHAR(255) NOT NULL,
  field_key      VARCHAR(100) NOT NULL,
  field_type     VARCHAR(50)  NOT NULL DEFAULT 'text'
                 CHECK (field_type IN ('text','number','radio','checkbox','boolean','date','dropdown','range')),
  required       BOOLEAN      NOT NULL DEFAULT TRUE,
  min_value      DECIMAL(15,2) NULL,
  max_value      DECIMAL(15,2) NULL,
  default_value  TEXT         NULL,
  options        JSONB        NULL,
  placeholder    VARCHAR(255) NULL,
  display_order  INTEGER      NOT NULL DEFAULT 0,
  xref           VARCHAR(255) NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schema_fields_schema
  ON schema_fields(schema_id);
CREATE INDEX IF NOT EXISTS idx_schema_fields_order
  ON schema_fields(schema_id, display_order);

-- Verify migration
SELECT 'entity_schemas table' as check, count(*) as rows FROM entity_schemas
UNION ALL
SELECT 'schema_fields table', count(*) FROM schema_fields;
