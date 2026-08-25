-- Opa! Tulik — replaces the hardcoded "Total Available" placeholder
-- (₪35,000 + ₪7,850, made up) with a real number: the household enters the
-- shared account's actual balance once, and the app shows that balance
-- minus 'shared'-account spending logged since then — see
-- computeTotalAvailable() in src/utils/insights.ts.
--
-- Single-row table (one household, one shared-account balance) — always
-- updated in place via upsert on the fixed SINGLETON_ID, rather than kept
-- as a history, same spirit as balanceSettleSettings' "just the latest
-- marker" — except this one is shared across both people/devices instead
-- of being local-only, since both Reut and Keren need to see the same
-- balance. Run after 0006_installment_rules.sql.

create table if not exists account_balance (
  id uuid primary key default gen_random_uuid(),
  starting_balance numeric(12, 2) not null,
  set_at date not null,
  updated_at timestamptz not null default now()
);

alter table account_balance enable row level security;

create policy "Household members only (account_balance)" on account_balance
  for all
  using ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'));
