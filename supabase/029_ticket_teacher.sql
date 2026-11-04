-- ============================================================
-- BarryTech Repair Lab — the customer's teacher on each ticket.
-- Filled in on New Ticket (optional) and shown on the ticket and in
-- the Invoice's TO box. Additive: the current site keeps working.
-- Safe to re-run.
-- ============================================================

alter table repair_requests add column if not exists teacher_name text check (char_length(teacher_name) <= 100);

notify pgrst, 'reload schema';
