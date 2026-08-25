-- Opa! Tulik — add 'ai_capture' as a transaction source: a transaction
-- created from the "Paste invoice" AI quick-capture flow (see
-- supabase/functions/parse-invoice and src/data/invoiceParseService.ts).
-- Run after 0006_installment_rules.sql.

alter table transactions drop constraint if exists transactions_source_check;
alter table transactions add constraint transactions_source_check
  check (source in ('manual', 'email_auto', 'import', 'recurring', 'ai_capture'));
