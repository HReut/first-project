-- Opa! Tulik — add the "account" (paid from which pocket) field used by the
-- settlement calculation on Overview. Run after 0003_status_and_mapping_rules.sql.
--
-- 'shared' = paid from the joint pool, no effect on who-owes-who.
-- 'reut_personal' / 'keren_personal' = a household expense paid out of that
-- person's own pocket, so the other person owes half of it back — see
-- computeSplitBalance() in src/utils/insights.ts.
-- Existing rows default to 'shared' since that was the only mode before this.

alter table transactions add column if not exists account text not null default 'shared'
  check (account in ('reut_personal', 'keren_personal', 'shared'));
