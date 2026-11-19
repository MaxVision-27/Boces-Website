-- ============================================================
-- BarryTech Repair Lab — the line has no time limit.
--   * Anyone can join the line any day, at any hour. Their spot stays
--     until a tech checks them in (makes their ticket) or the admin
--     takes them out. No more "your spot clears after today".
--   * No class choice: both classes see every spot (session is null
--     for new spots).
--   * Line numbers keep counting up (#101, #102, ...) and never start
--     over, so every waiting customer has their own number.
--   * Joining again with the same name while still waiting gives back
--     the same number. At most 50 people can wait at once ('full'), so
--     the public form can't fill the line forever.
--   * Checked-in spots are cleared 30 days after they joined; waiting
--     ones are never cleared on their own.
--   * The TV shows every waiting spot, in both classes.
-- (040 is held for email_log on the on-hold direct-email branch.)
-- Additive for the live site (same function signatures; the old page's
-- class pick is ignored): run it right before merging. Safe to re-run.
-- ============================================================

alter table drop_off_requests alter column session drop not null;

-- result: 'ok', 'duplicate' (already waiting under that name: same
-- number back), 'full' (50 waiting) or 'invalid'. p_session is ignored.
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
    if v_name = '' or coalesce(trim(p_class), '') = '' or coalesce(trim(p_room), '') = '' then
        return query select 'invalid'::text, null::int;
        return;
    end if;

    -- One at a time, so two people never get the same number.
    perform pg_advisory_xact_lock(hashtext('drop_off_requests'));

    delete from drop_off_requests d
    where d.visit_date < v_today - 30
      and exists (select 1 from repair_requests r where r.drop_off_id = d.id);

    select d.line_code into v_code from drop_off_requests d
    where lower(regexp_replace(trim(d.name), '\s+', ' ', 'g')) = lower(v_name)
      and not exists (select 1 from repair_requests r where r.drop_off_id = d.id)
    order by d.created_at desc
    limit 1;
    if found then
        return query select 'duplicate'::text, v_code;
        return;
    end if;

    if (select count(*) from drop_off_requests d
        where not exists (select 1 from repair_requests r where r.drop_off_id = d.id)) >= 50 then
        return query select 'full'::text, null::int;
        return;
    end if;

    select coalesce(max(d.line_code), 100) + 1 into v_code from drop_off_requests d;

    insert into drop_off_requests (visit_date, session, name, class_name, room_number, device, line_code)
    values (v_today, null, v_name, trim(p_class), trim(p_room), p_device, v_code);
    return query select 'ok'::text, v_code;
exception when check_violation then
    return query select 'invalid'::text, null::int;
end;
$$;

grant execute on function request_drop_off(text, text, text, text, text) to anon, authenticated;

-- The TV (from 036): the line is every waiting spot, any day, both classes.
create or replace function display_board(p_class text default null)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
    v_group text := coalesce(upper(nullif(trim(p_class), '')), current_staff_group());
begin
    if current_staff_role() is null or v_group not in ('AM', 'PM') then
        return null;
    end if;
    return json_build_object(
        'class', v_group,
        'repaired', (select paper_repairs from stats limit 1)
                    + (select count(*) from repair_requests where status in ('completed', 'picked_up') and deleted_at is null),
        'line', (
            select coalesce(json_agg(json_build_object('code', d.line_code, 'name', short_name(d.name), 'device', d.device)
                                     order by d.line_code nulls last, d.created_at), '[]')
            from drop_off_requests d
            where not exists (select 1 from repair_requests r where r.drop_off_id = d.id)),
        'tickets', (
            select coalesce(json_agg(json_build_object(
                       'id', r.id, 'name', short_name(r.name), 'device', r.device, 'status', r.status, 'priority', r.priority,
                       'reply_needed', r.review_note is not null and r.review_reply is null,
                       'techs', (select array_agg(t.name order by t.name) from techs t where t.id = any(r.assigned_tech_ids)))
                     order by r.priority desc, r.created_at), '[]')
            from repair_requests r
            where r.deleted_at is null
              and r.status in ('pending', 'assigned', 'in_progress', 'waiting_part', 'review', 'completed'))
    );
end;
$$;

notify pgrst, 'reload schema';
