-- Opa! Tulik — allow refund/credit transactions (negative amounts).
--
-- 0001_init.sql's `check (amount >= 0)` blocked any negative-amount row at
-- the database level. A refund/reversal parsed from a PDF/CSV import (or
-- entered by hand) is now a real transaction with a negative amount —
-- correctly subtracted from its category's total, budget usage, and charts
-- — so that constraint needs to allow it too. Run after 0012_eur_currency.sql.

alter table transactions drop constraint if exists transactions_amount_check;
