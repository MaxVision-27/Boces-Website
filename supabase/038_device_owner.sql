-- ============================================================
-- BarryTech Repair Lab — who owns the device: a school (BOCES or the
-- district) or the customer personally. Asked on New Ticket and shown
-- on the ticket and Help Desk Ticket. It doesn't change work-based
-- learning hours: that's the Invoice's customer choice, which is about
-- who the job is for, not who owns the device. Old tickets stay blank.
-- Additive: run it before merging the site update. Safe to re-run.
-- ============================================================

alter table repair_requests add column if not exists device_owner text check (device_owner in ('school', 'personal'));

notify pgrst, 'reload schema';
