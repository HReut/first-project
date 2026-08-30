-- Opa! Tulik — add EUR alongside USD/ILS as a transaction currency.
--
-- Same model as 0011_currency.sql: `amount` stays the ILS-equivalent every
-- total/budget/chart sums; `original_amount`/`currency` hold what was
-- actually paid. exchange_rates gains eur_to_ils as a second fallback rate
-- column on the same most-recent-row-wins table, instead of a second table
-- — setExchangeRate() carries forward whichever currency's rate wasn't
-- just changed, so one row always holds the household's current fallback
-- for both currencies. Run after 0011_currency.sql.

alter table transactions drop constraint if exists transactions_currency_check;
alter table transactions add constraint transactions_currency_check check (currency in ('ILS', 'USD', 'EUR'));

alter table exchange_rates alter column usd_to_ils drop not null;
alter table exchange_rates add column if not exists eur_to_ils numeric(10, 4) check (eur_to_ils > 0);
