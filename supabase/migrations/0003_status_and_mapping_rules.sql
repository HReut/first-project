-- Opa! Tulik — merge the review-workflow status with budget standing, and
-- add the "learning memory" mapping-rules table used by CSV import.
-- Run this in the Supabase SQL editor after 0001_init.sql and 0002_tighten_rls.sql.
--
-- Status used to be a pure review-workflow flag ('approved' / 'needs_review').
-- It's now three values: 'pending' (awaiting review — replaces
-- 'needs_review'), and 'on_budget' / 'exceeded' — a snapshot, taken at review
-- time, of whether the transaction's category was within its monthly budget
-- at that moment (src/utils/budget.ts's budgetStatus()). Existing 'approved'
-- rows are backfilled to 'on_budget' since we have no historical budget data
-- to know which of them would have been 'exceeded'.

update transactions set status = 'pending' where status = 'needs_review';
update transactions set status = 'on_budget' where status = 'approved';

alter table transactions drop constraint if exists transactions_status_check;
alter table transactions add constraint transactions_status_check
  check (status in ('pending', 'on_budget', 'exceeded'));
alter table transactions alter column status set default 'pending';

alter table transactions drop constraint if exists transactions_source_check;
alter table transactions add constraint transactions_source_check
  check (source in ('manual', 'email_auto', 'import'));

-- Imported rows with no detectable category fall back to this one —
-- category_id is not null, so there must be somewhere real to point at.
insert into categories (name, color_code, icon, monthly_budget_limit)
values ('Uncategorized', '#9ca3af', '❔', null)
on conflict (name) do nothing;

-- ---------- user_mapping_rules ----------
-- One remembered category/person choice per merchant, keyed by a normalized
-- (trimmed, lowercased) merchant string — see normalizeMerchantKey() in
-- src/data/mappingRulesRepo.ts.

create table if not exists user_mapping_rules (
  id uuid primary key default gen_random_uuid(),
  merchant_key text not null unique,
  category_id uuid references categories (id) on delete set null,
  person text check (person in ('Reut', 'Keren')),
  updated_at timestamptz not null default now()
);

alter table user_mapping_rules enable row level security;

-- Matches the household-whitelist policy already applied to the other
-- tables in 0002_tighten_rls.sql, rather than starting from the permissive
-- "allow all" 0001 used before RLS was tightened.
create policy "Household members only (user_mapping_rules)" on user_mapping_rules
  for all
  using ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'));
