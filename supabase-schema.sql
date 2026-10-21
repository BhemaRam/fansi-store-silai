-- MVP sync transport table. Run in Supabase SQL Editor.
-- IMPORTANT: This starter schema is not production-secure multi-user auth by itself.
-- Configure Supabase Auth and RLS policies before putting real customer/shop data here.
create table if not exists public.sync_records (
  id text primary key,
  table_name text not null check (table_name in ('products','sales','tailoring','customers','expenses','payments','suppliers','settings')),
  record jsonb not null,
  operation text not null default 'upsert',
  updated_at timestamptz not null default now()
);

alter table public.sync_records enable row level security;

-- Do not add permissive public policies for real business data.
-- For a private prototype, test only with non-sensitive dummy data and configure
-- authenticated policies that restrict records to the correct shop/tenant.
-- The browser app intentionally does not include a service_role key.
