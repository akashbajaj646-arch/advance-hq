-- ============================================================
-- PLM 008 — Persist tech pack axes on the sample
-- Sizes (Y) and measurements (X) are defined independently and
-- must survive even when no cells are filled yet, so they're
-- stored on the sample rather than inferred from measurement rows.
-- Idempotent.
-- ============================================================

alter table samples add column if not exists tp_sizes text[] default '{}';
alter table samples add column if not exists tp_poms  text[] default '{}';

-- Verify:
--   select column_name from information_schema.columns
--   where table_name='samples' and column_name in ('tp_sizes','tp_poms');
