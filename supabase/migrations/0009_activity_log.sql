-- Opa! Tulik — a household-wide activity log: every meaningful change gets
-- an entry (who, what, when), and the entries that are actually risky to
-- get wrong (deleting a transaction, changing a budget limit, settling up)
-- carry enough state in before_data to be undone with one click.
--
-- Settlement history is folded into this log rather than kept in its own
-- table: "currently settled as of" is just the performed_at of the latest
-- non-undone entity_type='settlement' row — see resolveSettledAfter() in
-- src/utils/activity.ts. This also fixes settlement being local-only
-- before (localStorage, so Reut and Keren didn't see each other's "Settle
-- Up" clicks) — it's now shared like everything else here.
--
-- Run after 0008_budget_limit_overrides.sql.

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('transaction', 'budget_limit', 'settlement', 'category', 'recurring_rule', 'account_balance')),
  action text not null,
  summary text not null,
  before_data jsonb,
  performed_by text not null check (performed_by in ('Reut', 'Keren')),
  performed_at timestamptz not null default now(),
  undone boolean not null default false
);

create index if not exists activity_log_performed_at_idx on activity_log (performed_at desc);
create index if not exists activity_log_entity_type_idx on activity_log (entity_type);

alter table activity_log enable row level security;

create policy "Household members only (activity_log)" on activity_log
  for all
  using ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'));
