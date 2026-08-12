-- Product Description module: copy queue + editable brand voice / category rules
-- seo_* columns are dormant until the Shopify SEO phase.

create table if not exists product_copy (
  id uuid primary key default gen_random_uuid(),
  product_id text not null unique,          -- AM product_id
  style_number text,
  category text,
  image_url text,                            -- first image (thumbnail)
  images jsonb,                              -- all image URLs
  current_description text,
  current_web_title text,
  current_web_description text,
  missing_copy boolean not null default false,
  all_caps boolean not null default false,
  status text not null default 'ok',         -- ok | pending | drafted | pushed | skipped
  keywords text,                              -- per-product user keywords fed to generation
  draft_description text,                     -- max 5 words
  draft_web_title text,
  draft_web_description text,
  draft_seo_title text,                       -- dormant (Shopify-only, future)
  draft_seo_meta_description text,            -- dormant (Shopify-only, future)
  generated_at timestamptz,
  generation_model text,
  generation_error text,
  approved_at timestamptz,
  approved_by uuid,
  pushed_at timestamptz,
  push_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_copy_status on product_copy(status);
create index if not exists idx_product_copy_category on product_copy(category);

create table if not exists copy_guidelines (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'category',     -- 'global' | 'category'
  category text,                               -- null for global
  guidelines text,
  seo_guidelines text,                         -- dormant (future SEO rules)
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists uq_copy_guidelines_scope_cat
  on copy_guidelines (scope, coalesce(category, ''));
