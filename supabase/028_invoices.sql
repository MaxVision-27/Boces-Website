-- ============================================================
-- BarryTech Repair Lab — Prism Bench invoices (replace the WBL Hours
-- sheets). Each ticket keeps its invoice lines:
--   { "customer": "student" | "school",
--     "tasks": [{ "id": "phone-screen", "qty": 1 }],
--     "parts": [{ "name": "iPhone 15 screen", "store": "Amazon", "price": 50 }] }
-- The task list (hours and prices) is built into the site (main.js).
-- Staff already update tickets (008), so no new policy is needed.
-- Additive: the current site keeps working. Safe to re-run.
-- ============================================================

alter table repair_requests add column if not exists invoice jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
