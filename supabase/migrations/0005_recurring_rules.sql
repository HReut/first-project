-- Opa! Tulik — recurring transaction rules (rent, internet, building
-- committee…) that repeat every N months. Run after 0004_add_account.sql.
--
-- A rule is "due" for a given month when that month is anchor_month plus a
-- whole multiple of interval_months (interval_months = 1 means every month,
-- 2 means every other month, etc.) — see isRuleDueForMonth() in
-- src/utils/recurring.ts. On app load, due rules whose last_generated_month
-- isn't already the current month get one 'pending' transaction created for
-- them, dated day_of_month of the current month, and last_generated_month is
-- updated to match — see generateDueRecurringTransactions() in App.ts.

alter table transactions drop constraint if exists transactions_source_check;
alter table transactions add constraint transactions_source_check
  check (source in ('manual', 'email_auto', 'import', 'recurring'));

create table if not exists recurring_rules (
  id uuid primary key default gen_random_uuid(),
  merchant text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  category_id uuid not null references categories (id) on delete restrict,
  account text not null check (account in ('reut_personal', 'keren_personal', 'shared')),
  person text not null check (person in ('Reut', 'Keren')),
  interval_months int not null default 1 check (interval_months >= 1),
  anchor_month text not null, -- YYYY-MM
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  is_active boolean not null default true,
  last_generated_month text, -- YYYY-MM
  created_at timestamptz not null default now()
);

alter table recurring_rules enable row level security;

create policy "Household members only (recurring_rules)" on recurring_rules
  for all
  using ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'));
