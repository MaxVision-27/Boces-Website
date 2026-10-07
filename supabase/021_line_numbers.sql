-- ============================================================
-- BarryTech Repair Lab — line numbers for today's line, no limit.
--   * Joining the line gives the customer a line number, like a fast
--     food order: 101, 102, 103 ... starting over each day. They show it
--     to the tech, who finds them by number (or by exact full name).
--   * No cap on the line: the 5-per-class limit could be filled by one
--     person adding a letter to their name. Each name still gets one
--     spot a day; joining again with the same name returns the same
--     number, so a lost number can be looked up.
--   * full_drop_off_days() has nothing left to report and is dropped.
-- Replaces request_drop_off() from 019 (it now returns the number too),
-- so run it right before merging the site update that uses it.
-- Safe to re-run.
-- ============================================================

alter table drop_off_requests add column if not exists line_code int;
create unique index if not exists drop_off_requests_day_line_code on drop_off_requests (visit_date, line_code);

drop function if exists request_drop_off(text, text, text, text, text);
drop function if exists full_drop_off_days();

-- result: 'ok' (code = their new number), 'duplicate' (that name is
-- already in today's line; code = their number), 'closed' (weekend)
-- or 'invalid' (a field is missing or too long).
create function request_drop_off(p_session text, p_name text, p_class text, p_room text, p_device text)
returns table (result text, code int)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_today date := (now() at time zone 'America/New_York')::date;
    v_code int;
begin
    if extract(isodow from v_today) > 5 then
        return query select 'closed'::text, null::int;
        return;
    end if;
    if p_session is null or p_session not in ('AM', 'PM')
       or coalesce(trim(p_name), '') = '' or coalesce(trim(p_class), '') = '' or coalesce(trim(p_room), '') = '' then
        return query select 'invalid'::text, null::int;
        return;
    end if;

    -- One at a time, so two people never get the same number.
    perform pg_advisory_xact_lock(hashtext('drop_off_requests'));

    delete from drop_off_requests d where d.visit_date < v_today - 30;

    select d.line_code into v_code from drop_off_requests d
    where d.visit_date = v_today and lower(trim(d.name)) = lower(trim(p_name));
    if found then
        return query select 'duplicate'::text, v_code;
        return;
    end if;

    select coalesce(max(d.line_code), 100) + 1 into v_code from drop_off_requests d where d.visit_date = v_today;

    insert into drop_off_requests (visit_date, session, name, class_name, room_number, device, line_code)
    values (v_today, p_session, trim(p_name), trim(p_class), trim(p_room), p_device, v_code);
    return query select 'ok'::text, v_code;
exception when check_violation then
    return query select 'invalid'::text, null::int;
end;
$$;

grant execute on function request_drop_off(text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
