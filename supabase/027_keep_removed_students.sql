-- ============================================================
-- BarryTech Repair Lab — removing a student keeps their work.
-- Remove used to delete the student, and time_logs' "on delete
-- cascade" deleted every session they logged (their WBL hours). Now
-- Remove sets removed_at instead: the student disappears from every
-- list and login, but their hours, their name on paperwork and forum
-- posts stay.
-- Additive: the current site keeps working. Safe to re-run.
-- ============================================================

alter table techs add column if not exists removed_at timestamptz;

notify pgrst, 'reload schema';
