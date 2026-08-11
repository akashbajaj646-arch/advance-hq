-- Module-level permissions for Advance HQ users and invites
-- permissions = NULL      -> full access (all modules) — admins and all existing users
-- permissions = jsonb []  -> explicit allowlist of module keys, e.g. '["orders","shipments"]'

alter table hq_users   add column if not exists permissions jsonb;
alter table hq_invites add column if not exists permissions jsonb;

comment on column hq_users.permissions   is 'NULL = all modules; jsonb array of module keys = restricted allowlist. Admins always bypass.';
comment on column hq_invites.permissions is 'Copied to hq_users.permissions when the invite is accepted.';
