-- ============================================================
-- BarryTech Repair Lab — two small rules.
--   * Work sessions start and end on a quarter hour (2:15, 2:30, ...).
--     NOT VALID: sessions already logged are left alone.
--   * A review needs a repair's tracking code, and each repair can be
--     reviewed once. The public can no longer insert reviews directly;
--     submit_review() checks the code and records which repair it was.
-- Run this right before the site update that uses submit_review().
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- 1) Quarter-hour sessions ------------------------------------------------
alter table time_logs drop constraint if exists time_logs_quarter_hours;
alter table time_logs add constraint time_logs_quarter_hours check (
    extract(minute from start_time)::int % 15 = 0 and extract(second from start_time) = 0
    and extract(minute from end_time)::int % 15 = 0 and extract(second from end_time) = 0
) not valid;

-- 2) One review per repair, by tracking code -------------------------------
alter table reviews add column if not exists ticket_id bigint unique references repair_requests(id) on delete set null;

drop policy if exists "reviews_public_insert" on reviews;

-- Returns 'ok', 'bad_code' (no such repair), 'used' (already reviewed),
-- or 'invalid' (rating or comment out of range).
create or replace function submit_review(p_code text, p_rating int, p_comment text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ticket bigint;
begin
    if p_rating is null or p_rating not between 1 and 5 or char_length(coalesce(p_comment, '')) > 500 then
        return 'invalid';
    end if;

    select id into v_ticket from repair_requests
    where tracking_code = upper(trim(p_code)) and deleted_at is null;
    if v_ticket is null then
        return 'bad_code';
    end if;

    insert into reviews (rating, comment, ticket_id) values (p_rating, p_comment, v_ticket);
    return 'ok';
exception when unique_violation then
    return 'used';
end;
$$;

grant execute on function submit_review(text, int, text) to anon, authenticated;

notify pgrst, 'reload schema';
