-- ============================================================
-- PLM 001 — Foundation
-- Shared updated_at trigger, partners, raw_materials (master).
-- Run this first. Safe to re-run (idempotent).
--
-- RLS convention: RLS is ENABLED with no anon/authenticated
-- policies. The service_role key bypasses RLS, so only server
-- code (via /api/data/route.ts using SUPABASE_SERVICE_ROLE_KEY)
-- can read/write. Never expose these tables to the anon key.
-- ============================================================

create extension if not exists pgcrypto;

-- Shared trigger to maintain updated_at on any table that has it.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- partners
-- Single home for BOTH internal factories and external vendors.
-- Every owner_id / producer_id / factory_id / vendor_id in the
-- PLM points here. capabilities lets us filter which vendor can
-- run an outsourced step (e.g. only stitch-capable vendors show
-- up in the stitch dropdown).
-- ------------------------------------------------------------
create table if not exists partners (
  id            uuid primary key default gen_random_uuid(),
  partner_type  text not null check (partner_type in ('internal_factory','external_vendor')),
  name          text not null,
  capabilities  text[] default '{}',           -- e.g. {'cut','stitch','dye','print','finish','pack'}
  location      text,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_partners_type on partners(partner_type) where is_active;

drop trigger if exists trg_partners_updated on partners;
create trigger trg_partners_updated before update on partners
  for each row execute function set_updated_at();

alter table partners enable row level security;

-- ------------------------------------------------------------
-- raw_materials (master)
-- The material definition, location-agnostic. Physical balances
-- live per-factory in raw_material_stock (Phase B). Created here
-- in the foundation because sample_bom (Phase A) FKs into it.
-- Fabric is tracked in meters; no roll- or dye-lot granularity.
-- ------------------------------------------------------------
create table if not exists raw_materials (
  id            uuid primary key default gen_random_uuid(),
  material_type text not null check (material_type in ('fabric','trim','packaging','carton','label')),
  name          text not null,
  description   text,
  unit          text not null default 'meters',  -- fabric=meters; others pieces/kg
  attributes    jsonb default '{}'::jsonb,        -- optional: content, color, gsm, width
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_raw_materials_type on raw_materials(material_type) where is_active;

drop trigger if exists trg_raw_materials_updated on raw_materials;
create trigger trg_raw_materials_updated before update on raw_materials
  for each row execute function set_updated_at();

alter table raw_materials enable row level security;
