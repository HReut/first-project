-- Opa! Tulik — multi-currency transactions (USD alongside ILS).
--
-- `amount` keeps meaning "ILS-equivalent" — every existing total/budget/
-- chart sums it unchanged. `original_amount` is what the person actually
-- paid, in `currency` — that's what the Transactions table/cards display.
-- For existing ILS rows the two are identical. Converting a USD row's
-- original_amount into amount happens client-side at save time using
-- whatever rate is in exchange_rates then — see computeIlsAmount() in
-- src/utils/currency.ts — so past transactions keep the rate that was
-- actually in effect when they were entered, rather than being silently
-- re-priced whenever the household updates the rate. Run after
-- 0010_savings_goals.sql.

alter table transactions add column if not exists currency text not null default 'ILS' check (currency in ('ILS', 'USD'));
alter table transactions add column if not exists original_amount numeric(12, 2);
update transactions set original_amount = amount where original_amount is null;
alter table transactions alter column original_amount set not null;

-- Single most-recent-row-wins table, same pattern as account_balance:
-- setting a new rate just inserts another row rather than updating in
-- place, and loadExchangeRate() always reads the latest one.
create table if not exists exchange_rates (
  id uuid primary key default gen_random_uuid(),
  usd_to_ils numeric(10, 4) not null check (usd_to_ils > 0),
  set_at date not null,
  updated_at timestamptz not null default now()
);

alter table exchange_rates enable row level security;

create policy "Household members only (exchange_rates)" on exchange_rates
  for all
  using ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'));
