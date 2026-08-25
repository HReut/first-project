-- Opa! Tulik — let a recurring rule be finite, so the same mechanism covers
-- both ongoing bills (rent) and installment purchases (a card purchase split
-- into N monthly payments). Run after 0005_recurring_rules.sql.
--
-- total_occurrences is null for an ongoing bill, or the installment count
-- for a finite plan. occurrences_generated counts how many transactions
-- this rule has produced so far; once it reaches total_occurrences,
-- findRulesDueForGeneration() in src/utils/recurring.ts stops generating
-- for that rule on its own — no separate "completed" flag needed.

alter table recurring_rules add column if not exists total_occurrences int check (total_occurrences is null or total_occurrences > 0);
alter table recurring_rules add column if not exists occurrences_generated int not null default 0;
