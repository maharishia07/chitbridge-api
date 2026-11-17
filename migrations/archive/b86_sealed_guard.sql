-- b86: enforce identities.sealed at the DB — the backstop behind the app guards (P0-1).
-- `sealed=true` = a PROTECTED entity (governance / platform root / GOV-01-Help). The reviewer found `sealed` was
-- read NOWHERE, so it was decorative. App guards now exclude sealed from directory search + storefront/supplier
-- resolution and refuse erase; this trigger is defense-in-depth: a sealed identity cannot be DELETED, erased,
-- deactivated, or un-sealed by ANY path. Benign updates (last_active_at, otp, …) stay allowed. Idempotent.
CREATE OR REPLACE FUNCTION guard_sealed_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.sealed THEN RAISE EXCEPTION 'protected (sealed) identity % cannot be deleted', OLD.identity_id; END IF;
    RETURN OLD;
  END IF;
  IF OLD.sealed THEN
    IF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('erased','inactive','deleted','suspended'))
       OR (NEW.is_erased AND NOT OLD.is_erased)
       OR (NOT NEW.sealed) THEN
      RAISE EXCEPTION 'protected (sealed) identity % cannot be erased, deactivated, or un-sealed', OLD.identity_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_sealed ON identities;
CREATE TRIGGER trg_guard_sealed BEFORE UPDATE OR DELETE ON identities
  FOR EACH ROW EXECUTE FUNCTION guard_sealed_identity();
