-- ============================================================
-- BarryTech Repair Lab — staff-only data. Until now every table was
-- readable and writable with the public anon key that ships in the
-- site's JS, so anyone could pull ticket notes, customer names and
-- emails, or edit/delete tickets straight from the API. After this:
--   * repair_requests, techs, time_logs: staff only (a valid session
--     from 007's staff_login), for reads and writes
--   * reviews: the public can read and leave reviews; only staff delete
--   * stats: the public can read the repair count; only staff update
--   * public ticket tracking goes through track_repair() from 007
-- Apply AFTER the site JS that sends x-staff-token is deployed, or the
-- live site loses access to tickets until it is.
-- Safe to re-run.
-- ============================================================

drop policy if exists "Allow public all on repair_requests" on repair_requests;
drop policy if exists "repair_requests_staff_all" on repair_requests;
create policy "repair_requests_staff_all" on repair_requests
    for all using ((select is_staff())) with check ((select is_staff()));

drop policy if exists "techs_select_anon" on techs;
drop policy if exists "techs_insert_anon" on techs;
drop policy if exists "techs_update_anon" on techs;
drop policy if exists "techs_delete_anon" on techs;
drop policy if exists "techs_staff_all" on techs;
create policy "techs_staff_all" on techs
    for all using ((select is_staff())) with check ((select is_staff()));

drop policy if exists "time_logs_select_anon" on time_logs;
drop policy if exists "time_logs_insert_anon" on time_logs;
drop policy if exists "time_logs_update_anon" on time_logs;
drop policy if exists "time_logs_delete_anon" on time_logs;
drop policy if exists "time_logs_staff_all" on time_logs;
create policy "time_logs_staff_all" on time_logs
    for all using ((select is_staff())) with check ((select is_staff()));

drop policy if exists "Allow public all on reviews" on reviews;
drop policy if exists "reviews_public_read" on reviews;
drop policy if exists "reviews_public_insert" on reviews;
drop policy if exists "reviews_staff_delete" on reviews;
create policy "reviews_public_read" on reviews for select using (true);
create policy "reviews_public_insert" on reviews for insert with check (true);
create policy "reviews_staff_delete" on reviews for delete using ((select is_staff()));

-- "Allow public read on stats" stays as-is.
drop policy if exists "stats_staff_update" on stats;
create policy "stats_staff_update" on stats
    for update using ((select is_staff())) with check ((select is_staff()));
