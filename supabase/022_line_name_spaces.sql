-- ============================================================
-- BarryTech Repair Lab — "Jamie  Rivera" is the same as "Jamie Rivera".
-- 021 only trimmed spaces at the ends of a name, so adding a space in
-- the middle got a second line number. Now names are saved with single
-- spaces and compared that way (like the staff search), so the same
-- person always gets their same number back.
-- Same function signature as 021: safe any time. Safe to re-run.
-- ============================================================

create or replace function request_drop_off(p_session text, p_name text, p_class text, p_room text, p_device text)
returns table (result text, code int)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_today date := (now() at time zone 'America/New_York')::date;
    v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
    v_code int;
begin
    if extract(isodow from v_today) > 5 then
        return query select 'closed'::text, null::int;
        return;
    end if;
    if p_session is null or p_session not in ('AM', 'PM')
       or v_name = '' or coalesce(trim(p_class), '') = '' or coalesce(trim(p_room), '') = '' then
        return query select 'invalid'::text, null::int;
        return;
    end if;

    -- One at a time, so two people never get the same number.
    perform pg_advisory_xact_lock(hashtext('drop_off_requests'));

    delete from drop_off_requests d where d.visit_date < v_today - 30;

    select d.line_code into v_code from drop_off_requests d
    where d.visit_date = v_today
      and lower(regexp_replace(trim(d.name), '\s+', ' ', 'g')) = lower(v_name);
    if found then
        return query select 'duplicate'::text, v_code;
        return;
    end if;

    select coalesce(max(d.line_code), 100) + 1 into v_code from drop_off_requests d where d.visit_date = v_today;

    insert into drop_off_requests (visit_date, session, name, class_name, room_number, device, line_code)
    values (v_today, p_session, v_name, trim(p_class), trim(p_room), p_device, v_code);
    return query select 'ok'::text, v_code;
exception when check_violation then
    return query select 'invalid'::text, null::int;
end;
$$;

notify pgrst, 'reload schema';
