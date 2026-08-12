-- Quick-facts block: mandatory short fact lines appended to every web description

alter table product_copy add column if not exists quick_facts jsonb;

insert into copy_settings (key, value)
values ('quick_facts_enabled', 'true'::jsonb)
on conflict (key) do nothing;
