create extension if not exists pgcrypto;

create table if not exists quote_drafts (
  id uuid primary key default gen_random_uuid(),
  quote_no text unique,
  company_name text,
  tax_id text,
  insurance_type text not null,
  insurance_period text,
  policy_start_date date,
  policy_end_date date,
  locations jsonb not null default '[]'::jsonb,
  case_data jsonb not null,
  status text not null default 'draft',
  archive_path text,
  original_quote_html_path text,
  original_quote_word_path text,
  original_quote_pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quote_drafts_company_name_idx on quote_drafts (company_name);
create index if not exists quote_drafts_tax_id_idx on quote_drafts (tax_id);
create index if not exists quote_drafts_insurance_type_idx on quote_drafts (insurance_type);
create index if not exists quote_drafts_status_idx on quote_drafts (status);
create index if not exists quote_drafts_created_at_idx on quote_drafts (created_at desc);

alter table quote_drafts
  drop constraint if exists quote_drafts_status_check;

alter table quote_drafts
  add constraint quote_drafts_status_check
  check (status in (
    'draft',
    'sent_to_insurer',
    'received_quotes',
    'summary_completed',
    'waiting_customer',
    'converted',
    'cancelled'
  ));

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists quote_drafts_set_updated_at on quote_drafts;
create trigger quote_drafts_set_updated_at
before update on quote_drafts
for each row execute function set_updated_at();
