-- ============================================================
-- PLM 007 — Timeline threading
-- Adds reply_to_event_id so timeline events can be replies to
-- other events (WhatsApp-style discussion under a photo/note).
-- Idempotent.
-- ============================================================

alter table sample_timeline_events
  add column if not exists reply_to_event_id uuid references sample_timeline_events(id) on delete cascade;

create index if not exists idx_timeline_reply on sample_timeline_events(reply_to_event_id)
  where reply_to_event_id is not null;

-- Verify:
--   select column_name from information_schema.columns
--   where table_name = 'sample_timeline_events' and column_name = 'reply_to_event_id';
