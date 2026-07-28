-- Opa! Tulik — initial schema.
-- Run this in the Supabase SQL editor (or `supabase db push`) once you've
-- created a project and dropped its URL/anon key into `.env`.

create extension if not exists "pgcrypto";

-- ---------- categories ----------

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color_code text not null,
  icon text not null default '',
  monthly_budget_limit numeric(12, 2),
  created_at timestamptz not null default now()
);

-- ---------- transactions ----------

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  merchant text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  category_id uuid not null references categories (id) on delete restrict,
  person text not null check (person in ('Reut', 'Keren')),
  status text not null default 'approved' check (status in ('approved', 'needs_review')),
  source text not null default 'manual' check (source in ('manual', 'email_auto')),
  created_at timestamptz not null default now()
);

create index if not exists transactions_date_idx on transactions (date desc);
create index if not exists transactions_category_id_idx on transactions (category_id);
create index if not exists transactions_status_idx on transactions (status);

-- ---------- email_sync_rules ----------

create table if not exists email_sync_rules (
  id uuid primary key default gen_random_uuid(),
  target_email text not null,
  merchant_keyword text not null,
  default_category_id uuid not null references categories (id) on delete restrict,
  default_person text not null check (default_person in ('Reut', 'Keren')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Row Level Security ----------
-- Enabled here with a permissive "allow all" policy as a starting point.
-- Tightened to the household's Google account whitelist in
-- 0002_tighten_rls.sql — run that migration too before exposing this
-- project's anon key beyond this household.

alter table categories enable row level security;
alter table transactions enable row level security;
alter table email_sync_rules enable row level security;

create policy "Allow all (categories)" on categories for all using (true) with check (true);
create policy "Allow all (transactions)" on transactions for all using (true) with check (true);
create policy "Allow all (email_sync_rules)" on email_sync_rules for all using (true) with check (true);

-- ---------- Seed categories ----------
-- Carried over from the prototype's fixed 8-category palette.

insert into categories (name, color_code, icon, monthly_budget_limit) values
  ('Groceries', '#2a78d6', '🛒', 2000),
  ('Dining', '#eb6834', '🍽️', 900),
  ('Transport', '#1baf7a', '🚗', 700),
  ('Utilities', '#eda100', '💡', 1200),
  ('Shopping', '#e87ba4', '🛍️', 1000),
  ('Entertainment', '#008300', '🎬', 500),
  ('Health', '#4a3aa7', '💊', 800),
  ('Housing', '#e34948', '🏠', 6000)
on conflict (name) do nothing;
