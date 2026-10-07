-- ============================================================
-- BarryTech Repair Lab — each student's look on the staff page.
-- techs.look holds { mode: auto|light|dark, theme: navy|ocean|forest|
-- sunset|grape, bg: plain|gradient|pattern }, picked in the Appearance
-- popup and applied when they pick their name, so it follows them to
-- any class computer. (The admin's look is saved in their browser.)
-- Additive: safe before or after the site update. Safe to re-run.
-- ============================================================

alter table techs add column if not exists look jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
