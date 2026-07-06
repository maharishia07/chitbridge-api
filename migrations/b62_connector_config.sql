-- b62 — connector connection-string enrichment (Model 1: one entity, many Pis/systems grouped by site).
-- The ACTOR (Pi / ERP system) holds the connection string; CONNECTIONS (devices/endpoints) hold per-endpoint
-- config + a bridge_id. Health is last_seen-based and CASCADES (actor offline => all its connections no-signal).

-- actor-level (identities already has connector_type from b57):
ALTER TABLE identities ADD COLUMN IF NOT EXISTS site               text;                                 -- Model 1 grouping (branch/location)
ALTER TABLE identities ADD COLUMN IF NOT EXISTS connector_config   jsonb NOT NULL DEFAULT '{}'::jsonb;    -- IoT: {mode,endpoint,host,port} · ERP: {base_url,auth_type,auth_ref}
ALTER TABLE identities ADD COLUMN IF NOT EXISTS provision_key_hash text;                                  -- sha256 of the CB-issued ActorKey (raw shown once, never stored)
ALTER TABLE identities ADD COLUMN IF NOT EXISTS last_seen          timestamptz;                            -- heartbeat/ping → drives health

-- connection-level (endpoint/device under an actor):
ALTER TABLE connector_connection ADD COLUMN IF NOT EXISTS bridge_id   text;                               -- identifies THIS device/endpoint under the actor
ALTER TABLE connector_connection ADD COLUMN IF NOT EXISTS conn_config jsonb NOT NULL DEFAULT '{}'::jsonb;  -- IoT: {protocol,host,port,topic,device_id} · ERP: {path}
ALTER TABLE connector_connection ADD COLUMN IF NOT EXISTS last_seen   timestamptz;                         -- per-endpoint freshness (gated by the actor's health)

CREATE INDEX IF NOT EXISTS cc_actor_bridge_idx ON connector_connection (actor_id, bridge_id);
