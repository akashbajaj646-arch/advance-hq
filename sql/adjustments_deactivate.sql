-- Phase 2: track deactivation in the adjustments audit log
alter table inventory_adjustments
  add column if not exists deactivated boolean not null default false;
