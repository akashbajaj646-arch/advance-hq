-- ============================================================
-- PLM 006 — Storage bucket for sample timeline media
--
-- Private bucket; all access via signed URLs generated
-- server-side (service role), so no storage RLS policies are
-- needed — signed URLs bypass RLS by design.
-- 100MB per file; images, video, audio only.
-- Idempotent (on conflict do nothing).
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sample-media',
  'sample-media',
  false,
  104857600,  -- 100 MB
  array['image/*','video/*','audio/*']
)
on conflict (id) do nothing;

-- Verify:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'sample-media';
