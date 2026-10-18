-- b105a: make the dispute-floor trigger read config as OWNER (SECURITY DEFINER), so the configured grace_days is honoured
-- REGARDLESS of whether retention_config has RLS. Without this, if retention_config is RLS-enabled, cb_app reads 0 rows →
-- the floor silently falls back to the default 30 (via COALESCE) and any configured grace is ignored. Idempotent; run after
-- b105. SAFE: this trigger only ever reads retention_config and updates chit_status for the SAME (chit_id, entity_id) as the
-- dispute row that changed — it takes no external params, so SECURITY DEFINER cannot be abused to touch arbitrary rows.
CREATE OR REPLACE FUNCTION retention_apply_dispute_floor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_grace int;
BEGIN
  IF NEW.status = 'resolved' AND COALESCE(OLD.status,'') <> 'resolved' THEN
    SELECT grace_days INTO v_grace FROM retention_config WHERE id = 1;
    UPDATE chit_status cs
       SET retire_at = GREATEST(cs.retention_expires_at, COALESCE(NEW.resolved_at, now()) + make_interval(days => COALESCE(v_grace,30)))
     WHERE cs.chit_id = NEW.chit_id AND cs.entity_id = NEW.entity_id;
  END IF;
  RETURN NEW;
END $$;
-- trigger definition itself is unchanged (b105 created trg_retention_dispute_floor pointing at this function).
