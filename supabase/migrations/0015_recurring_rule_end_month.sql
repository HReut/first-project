-- Opa! Tulik — lets a recurring rule specify an explicit end month, not just
-- an occurrence count. Covers a bill whose amount changed on a known
-- calendar date (e.g. an old rate that applied through a specific month,
-- replaced by a new rule from the next month on) — total_occurrences alone
-- can't express "until this date" without counting months by hand. Run
-- after 0006_installment_rules.sql.
--
-- Independent of total_occurrences: a rule can use end_month, total_occurrences,
-- both, or neither. isRuleDueForMonth() in src/utils/recurring.ts stops
-- generating for a month once it's past end_month, the same way
-- dueMonthsForRule() already stops once total_occurrences is reached.

alter table recurring_rules add column if not exists end_month text; -- YYYY-MM, inclusive; null = open-ended
