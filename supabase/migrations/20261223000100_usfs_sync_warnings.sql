-- Missing upstream agreement PDFs are warnings, not failed DPL refreshes.
-- Existing partial records are intentionally retried before being reclassified.
alter table public.usfs_priority_lists
  add column if not exists last_warning text;

comment on column public.usfs_priority_lists.last_warning is
  'Non-fatal warnings from the latest successful DPL parse, including unavailable USDA agreement PDFs. Existing rates may be older.';
