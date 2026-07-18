-- ============================================================
-- PLM 002 — Phase A: Sample -> Product (PLM core + T&A)
-- Requires: 001_plm_foundation.sql
--
-- Note on `group`/`class`: AM uses columns named group/class,
-- which are awkward reserved words in Postgres. We store them
-- here as product_group / product_class and map them back to
-- AM's group/class at promotion/push time.
-- ============================================================

-- ------------------------------------------------------------
-- samples — the single sample object
-- promoted_product_id / am_style_number are SOFT references to
-- the AM-synced products table (text keys). No hard FK: products
-- is upserted/deleted by sync and we don't want that to cascade
-- into or block PLM rows.
-- ------------------------------------------------------------
create table if not exists samples (
  id                   uuid primary key default gen_random_uuid(),
  sample_code          text not null unique,
  name                 text,
  description          text,
  status               text not null default 'in_development'
                         check (status in ('in_development','approved','rejected','archived')),
  current_version      integer not null default 1,
  product_group        text,
  product_class        text,
  category             text,
  collection           text,                       -- optional; continuous replenishment by default
  colorway             text,
  print_notes          text,
  source_type          text check (source_type in ('internal_factory','external_supplier')),
  source_id            uuid references partners(id),
  promoted_product_id  text,                        -- soft ref -> products.product_id (AM id)
  am_style_number      text,                        -- assigned at push
  created_by           text,
  approved_by          text,
  approved_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_samples_status on samples(status);
create index if not exists idx_samples_promoted on samples(promoted_product_id) where promoted_product_id is not null;

drop trigger if exists trg_samples_updated on samples;
create trigger trg_samples_updated before update on samples
  for each row execute function set_updated_at();

alter table samples enable row level security;

-- ------------------------------------------------------------
-- sample_versions — v1, v2, v3...
-- BOM and tech pack hang off the VERSION, not the sample, so
-- each revision owns its own material list and measurement set.
-- ------------------------------------------------------------
create table if not exists sample_versions (
  id             uuid primary key default gen_random_uuid(),
  sample_id      uuid not null references samples(id) on delete cascade,
  version_number integer not null,
  change_summary text,
  presented_by   text,
  presented_at   timestamptz,
  status         text not null default 'draft'
                   check (status in ('draft','presented','approved','superseded')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (sample_id, version_number)
);

create index if not exists idx_sample_versions_sample on sample_versions(sample_id);

drop trigger if exists trg_sample_versions_updated on sample_versions;
create trigger trg_sample_versions_updated before update on sample_versions
  for each row execute function set_updated_at();

alter table sample_versions enable row level security;

-- ------------------------------------------------------------
-- sample_timeline_events — image / video / voice progression
-- version_bump and status_change events are written automatically
-- by app logic so the timeline reads as one chronological story.
-- media_url points at a Supabase Storage object.
-- ------------------------------------------------------------
create table if not exists sample_timeline_events (
  id          uuid primary key default gen_random_uuid(),
  sample_id   uuid not null references samples(id) on delete cascade,
  version_id  uuid references sample_versions(id) on delete set null,
  event_type  text not null
                check (event_type in ('note','image','video','voice','version_bump','status_change','measurement_update')),
  media_url   text,
  body        text,                                -- note text or voice transcription
  author      text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_timeline_sample on sample_timeline_events(sample_id, created_at desc);

alter table sample_timeline_events enable row level security;

-- ------------------------------------------------------------
-- tech_pack_measurements — sizes offered + target measurement
-- No tolerances (cutting by hand). Keyed to the VERSION so specs
-- evolve with the sample (v1 specs vs v2 specs coexist).
-- ------------------------------------------------------------
create table if not exists tech_pack_measurements (
  id                uuid primary key default gen_random_uuid(),
  sample_version_id uuid not null references sample_versions(id) on delete cascade,
  size              text not null,                 -- S / M / L / XL ...
  point_of_measure  text not null,                 -- chest width, body length, sleeve ...
  target_value      numeric,
  unit              text not null default 'in',    -- in / cm
  sort_order        integer default 0,
  created_at        timestamptz not null default now()
);

create index if not exists idx_techpack_version on tech_pack_measurements(sample_version_id);

alter table tech_pack_measurements enable row level security;

-- ------------------------------------------------------------
-- sample_bom — BOM with fabric consumption
-- One row per material. Multi-fabric styles (shell, lining, rib)
-- get one row each and each deducts independently at cut time.
-- material_id is a HARD FK (raw_materials is HQ-native).
-- consumption is stored net; wastage_pct is added when a PO
-- reserves fabric: reserved = consumption_net * (1 + wastage_pct/100).
-- ------------------------------------------------------------
create table if not exists sample_bom (
  id                uuid primary key default gen_random_uuid(),
  sample_version_id uuid not null references sample_versions(id) on delete cascade,
  material_id       uuid references raw_materials(id) on delete restrict,
  material_type     text,                          -- denormalized for display
  consumption_net   numeric,                       -- meters per garment for fabric
  wastage_pct       numeric not null default 0,
  unit              text,
  cost_per_unit     numeric,
  currency          text check (currency in ('INR','USD','THB')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_bom_version on sample_bom(sample_version_id);
create index if not exists idx_bom_material on sample_bom(material_id);

drop trigger if exists trg_sample_bom_updated on sample_bom;
create trigger trg_sample_bom_updated before update on sample_bom
  for each row execute function set_updated_at();

alter table sample_bom enable row level security;

-- ------------------------------------------------------------
-- routing_steps — per-style operation sequence with owners
-- Defined ONCE per sample; every PO for the promoted product
-- inherits it. Toggle is_active off to skip a step (e.g. printed
-- fabric skips dye). owner_type in_house | outsourced; owner_id
-- points at a partner (nullable until assigned).
-- ------------------------------------------------------------
create table if not exists routing_steps (
  id          uuid primary key default gen_random_uuid(),
  sample_id   uuid not null references samples(id) on delete cascade,
  sequence    integer not null,
  operation   text not null
                check (operation in ('cut','print','dye','stitch','finish','qc','pack')),
  owner_type  text not null check (owner_type in ('in_house','outsourced')),
  owner_id    uuid references partners(id),
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (sample_id, sequence)
);

create index if not exists idx_routing_sample on routing_steps(sample_id);

drop trigger if exists trg_routing_updated on routing_steps;
create trigger trg_routing_updated before update on routing_steps
  for each row execute function set_updated_at();

alter table routing_steps enable row level security;

-- ------------------------------------------------------------
-- sample_milestones — T&A / critical-path calendar
-- Powers the on-time / at-risk / late view on the sample list.
-- milestone is free-form-ish but seed a standard set in the app:
-- sample_requested, fit_approved, bom_locked, promoted.
-- ------------------------------------------------------------
create table if not exists sample_milestones (
  id           uuid primary key default gen_random_uuid(),
  sample_id    uuid not null references samples(id) on delete cascade,
  milestone    text not null,
  owner        text,
  due_date     date,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_milestones_sample on sample_milestones(sample_id);
create index if not exists idx_milestones_due on sample_milestones(due_date) where completed_at is null;

drop trigger if exists trg_milestones_updated on sample_milestones;
create trigger trg_milestones_updated before update on sample_milestones
  for each row execute function set_updated_at();

alter table sample_milestones enable row level security;
