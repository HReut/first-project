-- Opa! Tulik — household-editable card-suffix -> person mapping, so PDF
-- import's cardholder detection (see pdfImportService.ts) no longer needs a
-- code change + redeploy every time someone gets a new physical card (which
-- happens every few years and changes the last-4-digits).
--
-- Seeded with the mapping the code had hardcoded until now — corrected here
-- too, since it had Reut/Keren backwards (3925 is Reut's, 4022 is Keren's).
-- Run after 0013_credit_transactions.sql.

create table if not exists card_person_mapping (
  id uuid primary key default gen_random_uuid(),
  card_suffix text not null unique check (card_suffix ~ '^\d{4}$'),
  person text not null check (person in ('Reut', 'Keren')),
  created_at timestamptz not null default now()
);

alter table card_person_mapping enable row level security;

create policy "Household members only (card_person_mapping)" on card_person_mapping
  for all
  using ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('reut.hefetz@gmail.com', 'kerenfr12@gmail.com'));

insert into card_person_mapping (card_suffix, person) values
  ('3925', 'Reut'),
  ('4022', 'Keren')
on conflict (card_suffix) do nothing;
