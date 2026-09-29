-- ============================================================
-- BarryTech Repair Lab — a note on each logged work session ("what I
-- did, what's next"). One entry now fills both printed forms: the
-- Service Log's dated notes and the WBL Hours sheet's dates/times.
-- Staff-only like the rest of time_logs (008). Additive.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table time_logs add column if not exists note text;
