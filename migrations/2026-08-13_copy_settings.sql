-- Descriptions module settings: style rules, em-dash ban, example templates

create table if not exists copy_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Defaults (only inserted if not already set)
insert into copy_settings (key, value)
values ('ban_em_dashes', 'true'::jsonb)
on conflict (key) do nothing;

insert into copy_settings (key, value)
values ('rules', '["Never use em dashes or en dashes anywhere in the copy; use commas or periods instead."]'::jsonb)
on conflict (key) do nothing;

insert into copy_settings (key, value)
values ('examples', '[]'::jsonb)
on conflict (key) do nothing;
