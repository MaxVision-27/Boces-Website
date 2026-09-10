-- ============================================================
-- BarryTech Repair Lab — ticket tracking codes
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query)
-- Safe to re-run.
-- ============================================================

alter table repair_requests
    add column if not exists tracking_code text;

-- Partial unique index (ignores existing rows where it's still null)
-- so this is safe to apply to a table that already has data.
create unique index if not exists repair_requests_tracking_code_idx
    on repair_requests (tracking_code)
    where tracking_code is not null;
