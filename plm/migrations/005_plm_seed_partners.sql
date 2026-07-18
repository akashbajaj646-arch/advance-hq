-- ============================================================
-- PLM 005 — Seed: partners (placeholder names)
-- Requires: 001_plm_foundation.sql
--
-- Generic names on purpose — rename freely in the UI later.
-- partners.name is plain text with no dependants, so renaming is
-- safe; the uuid ids are what everything else references.
--
-- Idempotent: re-running will not create duplicates.
--
-- capabilities[] drives which partner appears in the dropdown for
-- an outsourced routing step. Internal factories run everything
-- except stitch and dye (both go out).
-- ============================================================

insert into partners (partner_type, name, capabilities, location, notes)
select v.partner_type, v.name, v.capabilities::text[], v.location, v.notes
from (values
  ('internal_factory', 'Factory 1',        '{cut,print,finish,qc,pack}', 'India', 'Placeholder name — rename in UI'),
  ('internal_factory', 'Factory 2',        '{cut,print,finish,qc,pack}', 'India', 'Placeholder name — rename in UI'),
  ('external_vendor',  'Stitching Unit 1', '{stitch}',                   'India', 'Placeholder name — rename in UI'),
  ('external_vendor',  'Stitching Unit 2', '{stitch}',                   'India', 'Placeholder name — rename in UI'),
  ('external_vendor',  'Dye House 1',      '{dye}',                      'India', 'Placeholder name — rename in UI')
) as v(partner_type, name, capabilities, location, notes)
where not exists (
  select 1 from partners p where p.name = v.name
);

-- Verify:
--   select id, partner_type, name, capabilities from partners order by partner_type, name;
