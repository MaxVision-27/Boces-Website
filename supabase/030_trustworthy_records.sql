-- ============================================================
-- BarryTech Repair Lab — records the teacher can trust (council fixes).
--   * Hours (time_logs): a tech can only log TODAY, inside their class
--     (AM 7:30–10:30, PM 11:30–2:30, a little room either side of the
--     bell), not ending in the future, and not overlapping a session
--     they already logged. A tech can only delete today's sessions.
--     The admin can still fix anything.
--   * Deleting a ticket forever no longer erases the hours logged on
--     it: time_logs.ticket_id becomes "on delete restrict", so a ticket
--     with logged sessions stays in Deleted instead.
--   * The public tracker (track_repair) no longer returns the problem
--     description; anyone with a code could read it.
--   * A customer's computer password is cleared when the ticket is
--     deleted, not only when it's completed.
-- Replaces track_repair() from 020: run it right before merging the
-- site update (the current page just shows no problem line). Safe to re-run.
-- ============================================================

-- 1) Hours ---------------------------------------------------------------
create or replace function check_time_log()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_now timestamp := now() at time zone 'America/New_York';
    v_group text := current_staff_group();
    v_from time := case v_group when 'AM' then '07:30' when 'PM' then '11:30' end;
    v_to time := case v_group when 'AM' then '10:30' when 'PM' then '14:30' end;
begin
    if current_staff_role() is distinct from 'tech' then
        return coalesce(new, old); -- the admin can fix anything
    end if;

    if tg_op = 'DELETE' then
        if old.work_date <> v_now::date then
            raise exception 'Only today''s sessions can be deleted. Ask the admin to fix older ones.';
        end if;
        return old;
    end if;

    if new.work_date <> v_now::date then
        raise exception 'Log today''s work only.';
    end if;
    if v_from is not null and (new.start_time < v_from or new.end_time > v_to) then
        raise exception 'Log time during your class (% to %).', to_char(v_from, 'FMHH12:MI AM'), to_char(v_to, 'FMHH12:MI AM');
    end if;
    if new.end_time > (v_now + interval '15 minutes')::time then
        raise exception 'That session ends later than now.';
    end if;
    if exists (select 1 from time_logs t
               where t.tech_id = new.tech_id and t.work_date = new.work_date and t.id is distinct from new.id
                 and t.start_time < new.end_time and t.end_time > new.start_time) then
        raise exception 'You already logged time that overlaps this session.';
    end if;
    return new;
end;
$$;

drop trigger if exists check_time_log on time_logs;
create trigger check_time_log
    before insert or update or delete on time_logs
    for each row execute function check_time_log();

-- 2) Deleting a ticket keeps its hours (looks the FK up by definition) ---
do $$
declare
    con_name text;
begin
    select con.conname into con_name
    from pg_constraint con
    where con.conrelid = 'time_logs'::regclass
      and con.contype = 'f'
      and con.confrelid = 'repair_requests'::regclass;

    if con_name is not null then
        execute format('alter table time_logs drop constraint %I', con_name);
    end if;

    alter table time_logs
        add constraint time_logs_ticket_id_fkey
        foreign key (ticket_id) references repair_requests(id) on delete restrict;
end $$;

-- 3) The public tracker leaves out the problem ---------------------------
drop function if exists track_repair(text);
create function track_repair(p_code text)
returns table (device text, status text, created_at timestamptz, history text[], part text)
language sql
stable
security definer
set search_path = public
as $$
    select r.device::text, r.status::text, r.created_at, r.status_history,
           case when r.status = 'waiting_part' then r.parts_used end
    from repair_requests r
    where r.tracking_code = upper(trim(p_code))
      and r.deleted_at is null
$$;

grant execute on function track_repair(text) to anon, authenticated;

-- 4) Customer passwords go when the ticket is completed or deleted -------
create or replace function clear_computer_password()
returns trigger
language plpgsql
as $$
begin
    if new.status = 'completed' or new.deleted_at is not null then
        new.computer_password := null;
    end if;
    return new;
end;
$$;

update repair_requests set computer_password = null
where computer_password is not null and (status = 'completed' or deleted_at is not null);

notify pgrst, 'reload schema';
