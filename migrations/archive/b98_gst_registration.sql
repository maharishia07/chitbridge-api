-- b98: a GSTIN clearance so the LIVE source-check shows in the UI. GSTIN is verifiable at source (GST registry via
-- Sandbox.co.in) — the Verify-at-source button appears on it, the platform confirms it live, and the rung flips to
-- verified with the real registered name. Standing (entity scope) → Certification tab; applies to India-origin entities.
-- Shared reference (WITHOUT RLS). doc_key = 'gstn' so the frontend maps it to the live registry check.

INSERT INTO standard_source (standard_key, version, title, facet, template) VALUES
 ('gst-registration','v1','GST Registration (India)','identity','{"required":["gstn"],"scope":"entity"}'::jsonb)
ON CONFLICT (standard_key, version) DO NOTHING;

INSERT INTO standard_document (standard_key, doc_key, title, mandate, clause, capture_type, scope, frequency, form, display_order) VALUES
 ('gst-registration','gstn','GSTIN — GST Registration','Your GST Identification Number — verified live against the GST registry.','GST','field','entity','once','{}'::jsonb,1)
ON CONFLICT (standard_key, doc_key) DO NOTHING;

UPDATE standard_source SET applicability='{"origin":["IN"]}'::jsonb,
  guidance='Hold a valid GSTIN — the platform verifies it live against the GST registry (verified at source).'
  WHERE standard_key='gst-registration';
