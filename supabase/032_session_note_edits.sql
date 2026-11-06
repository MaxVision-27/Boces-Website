-- ============================================================
-- BarryTech Repair Lab — work session changes (replaces check_time_log from 030).
--   * Techs can't delete a work session any more. The student who logged
--     it can edit its note (the site only shows Edit to them); the date,
--     times and ticket stay as logged.
--   * Sessions may overlap (two tickets at once, or teammates).
--   * No session ends after 2:15 PM: the PM class logs 11:30 AM to
--     2:15 PM (AM stays 7:30 to 10:30).
-- The admin (and the SQL Editor) can still fix anything.
-- Run it right before merging the site update. Safe to re-run.
-- ============================================================

create or replace function check_time_log()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_now timestamp := now() at time zone 'America/New_York';
    v_group text := current_staff_group();
    v_from time := case v_group when 'AM' then '07:30' when 'PM' then '11:30' end;
    v_to time := case v_group when 'AM' then '10:30' when 'PM' then '14:15' end;
begin
    if current_staff_role() is distinct from 'tech' then
        return coalesce(new, old); -- the admin can fix anything
    end if;

    if tg_op = 'DELETE' then
        raise exception 'Work sessions can''t be deleted. Edit the note instead, or ask the admin.';
    end if;

    if tg_op = 'UPDATE' then
        if (new.ticket_id, new.tech_id, new.work_date, new.start_time, new.end_time)
           is distinct from (old.ticket_id, old.tech_id, old.work_date, old.start_time, old.end_time) then
            raise exception 'Only the note can be changed. Ask the admin to fix the date or times.';
        end if;
        return new;
    end if;

    if new.work_date <> v_now::date then
        raise exception 'Log today''s work only.';
    end if;
    if new.end_time > '14:15' then
        raise exception 'Sessions can''t go past 2:15 PM.';
    end if;
    if v_from is not null and (new.start_time < v_from or new.end_time > v_to) then
        raise exception 'Log time during your class (% to %).', to_char(v_from, 'FMHH12:MI AM'), to_char(v_to, 'FMHH12:MI AM');
    end if;
    if new.end_time > (v_now + interval '15 minutes')::time then
        raise exception 'That session ends later than now.';
    end if;
    return new;
end;
$$;

notify pgrst, 'reload schema';
