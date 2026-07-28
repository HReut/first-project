-- Opa! Tulik — tighten RLS to the household's Google account whitelist.
-- Run this in the Supabase SQL editor after 0001_init.sql.
--
-- Prerequisite (dashboard step, not SQL): enable the Google provider under
-- Supabase Dashboard → Authentication → Providers, so `auth.jwt()` carries a
-- real Google-verified email for signed-in users.
--
-- This app has exactly two household members, matching the fixed
-- Person = 'Reut' | 'Keren' union in src/types.ts — the whitelist is
-- hardcoded here rather than pulled from a table for the same reason.

drop policy if exists "Allow all (categories)" on categories;
drop policy if exists "Allow all (transactions)" on transactions;
drop policy if exists "Allow all (email_sync_rules)" on email_sync_rules;

create policy "Household members only (categories)" on categories
  for all
  using ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'));

create policy "Household members only (transactions)" on transactions
  for all
  using ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'));

create policy "Household members only (email_sync_rules)" on email_sync_rules
  for all
  using ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'));
