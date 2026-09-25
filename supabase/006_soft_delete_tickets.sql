-- ============================================================
-- BarryTech Repair Lab — soft-delete tickets instead of hard-deleting
-- them, so clicking "Delete" in the Ticket Pool doesn't silently and
-- permanently destroy a ticket (and its tracking code) with no way to
-- recover it if it was a mistake.
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query)
-- Safe to re-run.
-- ============================================================

alter table repair_requests
    add column if not exists deleted_at timestamptz;

create index if not exists repair_requests_deleted_at_idx on repair_requests(deleted_at);
