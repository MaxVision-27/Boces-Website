-- ============================================================
-- BarryTech Repair Lab — "Join today's line" replaces booking ahead.
-- Last year's appointments failed because people booked days ahead
-- and never came, and gave details we couldn't trust. Now:
--   * Same day only: the line is for today's morning (AM) or afternoon
--     (PM) class. The server picks the date; weekends are closed.
--   * The customer gives name, class name, room number (all required)
--     and device type. No phone, model or problem: the tech gets those
--     in person at drop-off.
--   * Still 5 per class per day; one spot per name per day.
-- Replaces request_drop_off() from 018. Run this in the Supabase SQL
-- Editor right before the site update that uses it. Safe to re-run.
-- ============================================================

-- Requests no longer carry a phone number or a problem.
alter table drop_off_requests
    alter column contact_number drop not null,
    alter column issue drop not null;

drop function if exists request_drop_off(date, text, text, text, text, text, text, text, text);

-- Returns 'ok', 'closed' (weekend), 'full' (5 already in that class
-- today), 'duplicate' (that name is already in today's line) or
-- 'invalid' (a field is missing or too long).
create or replace function request_drop_off(p_session text, p_name text, p_class text, p_room text, p_device text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_today date := (now() at time zone 'America/New_York')::date;
begin
    if extract(isodow from v_today) > 5 then
        return 'closed';
    end if;
    if p_session is null or p_session not in ('AM', 'PM')
       or coalesce(trim(p_name), '') = '' or coalesce(trim(p_class), '') = '' or coalesce(trim(p_room), '') = '' then
        return 'invalid';
    end if;

    -- One request at a time, so two people can't both take the 5th spot.
    perform pg_advisory_xact_lock(hashtext('drop_off_requests'));

    delete from drop_off_requests where visit_date < v_today - 30;

    if exists (select 1 from drop_off_requests
               where visit_date = v_today and lower(trim(name)) = lower(trim(p_name))) then
        return 'duplicate';
    end if;
    if (select count(*) from drop_off_requests where visit_date = v_today and session = p_session) >= 5 then
        return 'full';
    end if;

    insert into drop_off_requests (visit_date, session, name, class_name, room_number, device)
    values (v_today, p_session, trim(p_name), trim(p_class), trim(p_room), p_device);
    return 'ok';
exception when check_violation then
    return 'invalid';
end;
$$;

grant execute on function request_drop_off(text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
