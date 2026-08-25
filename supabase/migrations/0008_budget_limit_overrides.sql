-- Opa! Tulik — lets a budget-limit edit choose its scope instead of always
-- overwriting the category's one flat number. Run after 0007_account_balance.sql.
--
-- category.monthly_budget_limit is still the "default" limit used for any
-- month with no override. A row here is a scoped exception:
--   - "This month only"  -> start_month = end_month = that month
--   - "From now on"      -> start_month = that month, end_month = null (open-ended)
-- "All months" doesn't insert a row at all — it just updates
-- category.monthly_budget_limit directly and clears this category's
-- existing overrides (a full reset to one flat number).
--
-- Looking up the limit for a given month: the override with the latest
-- start_month that covers that month wins; falls back to
-- category.monthly_budget_limit if none apply — see resolveBudgetLimitForMonth()
-- in src/utils/insights.ts.

create table if not exists budget_limit_overrides (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories (id) on delete cascade,
  start_month text not null, -- YYYY-MM, inclusive
  end_month text, -- YYYY-MM, inclusive; null = open-ended ("from now on")
  limit_amount numeric(12, 2), -- null = "no limit" for the covered month(s)
  created_at timestamptz not null default now()
);

create index if not exists budget_limit_overrides_category_id_idx on budget_limit_overrides (category_id);

alter table budget_limit_overrides enable row level security;

create policy "Household members only (budget_limit_overrides)" on budget_limit_overrides
  for all
  using ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'));
