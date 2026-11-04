-- ============================================================
-- BarryTech Repair Lab — council improvements.
--   * "Picked up": a new last status, set only by the admin when the
--     customer takes the device home. Completed now means "ready for
--     pickup"; the TV's Ready for pickup column shows every completed
--     ticket until it's picked up (no 7-day cutoff), with its ticket
--     number. Picked-up repairs still count as devices repaired and can
--     still be reviewed.
--   * repair_requests.shelf: where the device is kept (shelf or bin).
--   * Join today's line: only on school days from 6:00 AM until that
--     class ends (AM 10:20, PM 2:20), and only for a class that has
--     students. open_classes() tells the homepage which classes do.
-- Replaces several functions the live site calls; run it right before
-- merging the site update. Safe to re-run.
-- ============================================================

-- 1) Picked up -----------------------------------------------------------
do $$
declare
    con_name text;
begin
    select con.conname into con_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'repair_requests'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
      and pg_get_constraintdef(con.oid) ilike '%in_progress%';

    if con_name is not null then
        execute format('alter table repair_requests drop constraint %I', con_name);
    end if;

    alter table repair_requests
        add constraint repair_requests_status_check
        check (status in ('flagged', 'pending', 'assigned', 'in_progress', 'waiting_part', 'review', 'completed', 'picked_up'));
end $$;

alter table repair_requests add column if not exists shelf text check (char_length(shelf) <= 40);

-- Only the admin completes a repair or records its pickup (from 014).
create or replace function only_admin_completes()
returns trigger
language plpgsql
as $$
begin
    -- Requests from the site run as anon; the SQL Editor (postgres) is left alone.
    if new.status in ('completed', 'picked_up')
       and (tg_op = 'INSERT' or old.status is distinct from new.status)
       and current_user in ('anon', 'authenticated')
       and current_staff_role() is distinct from 'admin' then
        raise exception 'Only an admin can mark a repair completed or picked up';
    end if;
    return new;
end;
$$;

-- completed_at stays when a completed repair is picked up (from 025).
create or replace function track_status_history()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'INSERT' then
        new.status_history := array[new.status];
    elsif new.status is distinct from old.status then
        new.status_history := coalesce(old.status_history, array[old.status]) || new.status;
    else
        new.status_history := old.status_history;
    end if;
    if new.status in ('completed', 'picked_up') then
        new.completed_at := coalesce(new.completed_at, now());
    else
        new.completed_at := null;
    end if;
    return new;
end;
$$;

-- Customer passwords go once the repair is done or the ticket is deleted (from 030).
create or replace function clear_computer_password()
returns trigger
language plpgsql
as $$
begin
    if new.status in ('completed', 'picked_up') or new.deleted_at is not null then
        new.computer_password := null;
    end if;
    return new;
end;
$$;

-- A picked-up repair can still be reviewed (from 024).
create or replace function submit_review(p_code text, p_rating int, p_comment text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ticket bigint;
    v_status text;
begin
    if p_rating is null or p_rating not between 1 and 5 or char_length(coalesce(p_comment, '')) > 500 then
        return 'invalid';
    end if;

    select id, status into v_ticket, v_status from repair_requests
    where tracking_code = upper(trim(p_code)) and deleted_at is null;
    if v_ticket is null then
        return 'bad_code';
    end if;
    if v_status not in ('completed', 'picked_up') then
        return 'not_done';
    end if;

    insert into reviews (rating, comment, ticket_id) values (p_rating, p_comment, v_ticket);
    return 'ok';
exception when unique_violation then
    return 'used';
end;
$$;

-- The TV (from 026): Ready for pickup = completed and not picked up yet,
-- shown by ticket number; repaired counts picked-up repairs too.
create or replace function display_board(p_class text default null)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
    v_group text := coalesce(upper(nullif(trim(p_class), '')), current_staff_group());
    v_today date := (now() at time zone 'America/New_York')::date;
begin
    if current_staff_role() is null or v_group not in ('AM', 'PM') then
        return null;
    end if;
    return json_build_object(
        'class', v_group,
        'repaired', (select count(*) from repair_requests where status in ('completed', 'picked_up') and deleted_at is null),
        'line', (
            select coalesce(json_agg(json_build_object('code', d.line_code, 'name', short_name(d.name), 'device', d.device)
                                     order by d.line_code nulls last, d.created_at), '[]')
            from drop_off_requests d
            where d.visit_date = v_today
              and (v_group is null or d.session = v_group)
              and not exists (select 1 from repair_requests r where r.drop_off_id = d.id)),
        'tickets', (
            select coalesce(json_agg(json_build_object(
                       'id', r.id, 'name', short_name(r.name), 'device', r.device, 'status', r.status, 'priority', r.priority,
                       'techs', (select array_agg(t.name order by t.name) from techs t where t.id = any(r.assigned_tech_ids)))
                     order by r.priority desc, r.created_at), '[]')
            from repair_requests r
            where r.deleted_at is null
              and r.status in ('pending', 'assigned', 'in_progress', 'waiting_part', 'review', 'completed'))
    );
end;
$$;

-- 2) Join today's line: school days, until the class ends ----------------
-- Which classes have students (the homepage hides the others).
create or replace function open_classes()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(array_agg(distinct session order by session), '{}')
    from techs where removed_at is null and session in ('AM', 'PM')
$$;

grant execute on function open_classes() to anon, authenticated;

-- result adds 'too_late' (before 6 AM or after that class ends) and
-- 'no_class' (that class has no students yet). Otherwise as in 022.
create or replace function request_drop_off(p_session text, p_name text, p_class text, p_room text, p_device text)
returns table (result text, code int)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamp := now() at time zone 'America/New_York';
    v_today date := v_now::date;
    v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
    v_closes time := case p_session when 'AM' then '10:20'::time else '14:20'::time end;
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
    if v_now::time < '06:00' or v_now::time > v_closes then
        return query select 'too_late'::text, null::int;
        return;
    end if;
    if not p_session = any(open_classes()) then
        return query select 'no_class'::text, null::int;
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
