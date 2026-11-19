-- ============================================================
-- BarryTech Repair Lab — students pick the date when they log hours.
--   * A work session can be for any day up to today (no limit on how far
--     back, weekends allowed). Before, it had to be today.
--   * Everything else stays: inside the student's class times, nothing
--     past 2:15 PM, only their own sessions, only the note can change
--     later. "Ends later than now" only applies to today.
--   * The site tags a session "Logged later" when it was saved on a later
--     day than the work (from created_at; no new column).
-- Loosens the rule the live site uses, so it's safe to run before the
-- merge (the current page still logs today). Safe to re-run.
-- ============================================================

-- From 033, with the date rule changed.
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
        if old.tech_id is distinct from current_tech_id() then
            raise exception 'You can only edit your own notes.';
        end if;
        if (new.ticket_id, new.tech_id, new.work_date, new.start_time, new.end_time)
           is distinct from (old.ticket_id, old.tech_id, old.work_date, old.start_time, old.end_time) then
            raise exception 'Only the note can be changed. Ask the admin to fix the date or times.';
        end if;
        return new;
    end if;

    if new.tech_id is distinct from current_tech_id() then
        raise exception 'You can only log your own work.';
    end if;
    if new.work_date is null or new.work_date > v_now::date then
        raise exception 'Pick a date up to today.';
    end if;
    if new.end_time > '14:15' then
        raise exception 'Sessions can''t go past 2:15 PM.';
    end if;
    if v_from is not null and (new.start_time < v_from or new.end_time > v_to) then
        raise exception 'Log time during your class (% to %).', to_char(v_from, 'FMHH12:MI AM'), to_char(v_to, 'FMHH12:MI AM');
    end if;
    if new.work_date = v_now::date and new.end_time > (v_now + interval '15 minutes')::time then
        raise exception 'That session ends later than now.';
    end if;
    return new;
end;
$$;
