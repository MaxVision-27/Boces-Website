-- ============================================================
-- BarryTech Repair Lab — remove ticket availability/time. Devices are
-- dropped off in person at C220, so the old "Availability" day and
-- "Time" slot on each ticket were never used for scheduling.
-- Technician hours (time_logs: work_date/start_time/end_time) are a
-- separate table and are not affected.
-- Apply AFTER the site JS that no longer sends date/time is deployed;
-- the older JS still writes these columns when creating a ticket.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table repair_requests drop column if exists date;
alter table repair_requests drop column if exists time;
