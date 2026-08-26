-- Opa! Tulik — savings goals: a name, a target, and how much is saved so
-- far (edited directly, same "just re-enter the true number" model as the
-- shared account balance — not derived from transactions, since savings
-- aren't necessarily parked in the same account this app already tracks).
-- Run after 0009_activity_log.sql.

create table if not exists savings_goals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_amount numeric(12, 2) not null check (target_amount > 0),
  saved_amount numeric(12, 2) not null default 0 check (saved_amount >= 0),
  created_at timestamptz not null default now()
);

alter table savings_goals enable row level security;

create policy "Household members only (savings_goals)" on savings_goals
  for all
  using ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'));

-- Widen the activity log to cover savings goals too (create/update/delete,
-- delete undoable) — see HistoryView.ts.
alter table activity_log drop constraint if exists activity_log_entity_type_check;
alter table activity_log add constraint activity_log_entity_type_check
  check (entity_type in ('transaction', 'budget_limit', 'settlement', 'category', 'recurring_rule', 'account_balance', 'savings_goal'));
