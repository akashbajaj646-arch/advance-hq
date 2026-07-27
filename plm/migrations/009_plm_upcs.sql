-- ============================================================
-- PLM 009 — UPCs per variant + master pack
-- Colors get their own list on the sample (sizes already come
-- from tp_sizes). Each size x color variant gets a UPC row;
-- the master pack UPC lives on the sample. Manual entry for
-- now; automation later.
-- Idempotent.
-- ============================================================

alter table samples add column if not exists colors text[] default '{}';
alter table samples add column if not exists master_pack_upc text;

create table if not exists sample_upcs (
  id          uuid primary key default gen_random_uuid(),
  sample_id   uuid not null references samples(id) on delete cascade,
  color       text not null,
  size        text not null,
  upc         text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (sample_id, color, size)
);

create index if not exists idx_sample_upcs_sample on sample_upcs(sample_id);

drop trigger if exists trg_sample_upcs_updated on sample_upcs;
create trigger trg_sample_upcs_updated before update on sample_upcs
  for each row execute function set_updated_at();

alter table sample_upcs enable row level security;

-- Verify:
--   select count(*) from information_schema.tables where table_name='sample_upcs';
