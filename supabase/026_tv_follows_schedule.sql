-- ============================================================
-- BarryTech Repair Lab — the TV board follows the class schedule.
--   * tv.html now picks the class itself from the time of day (AM
--     7:45–10:20, PM 11:45–2:20) and asks display_board() for it, so
--     one TV login covers both classes. display_board(p_class) takes
--     'AM' or 'PM'; with none it uses the session's class as before
--     (the admin, with no class, still sees both lines).
--   * The TV signs in as 'tv' (no class). The old 'tv_am' / 'tv_pm'
--     logins are gone; a TV already signed in keeps working.
-- Replaces staff_login() and display_board() from 025. Run it right
-- before merging the site update: the old page's AM/PM sign-in stops
-- working (a TV that's already signed in is fine). Safe to re-run.
-- ============================================================

create or replace function staff_login(p_role text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_auth_role text := case p_role when 'admin' then 'admin' when 'am' then 'tech_am' when 'pm' then 'tech_pm'
                                    when 'tv' then 'display' end;
    v_token text;
begin
    if v_auth_role is null or not exists (
        select 1 from admin_auth
        where role = v_auth_role
          and password_hash = encode(digest(p_password, 'sha256'), 'hex')
    ) then
        return null;
    end if;

    delete from staff_sessions where expires_at < now();

    v_token := encode(gen_random_bytes(32), 'hex');
    insert into staff_sessions (token_hash, role, session_group, expires_at)
    values (encode(digest(v_token, 'sha256'), 'hex'),
            case when p_role = 'admin' then 'admin' when v_auth_role = 'display' then 'display' else 'tech' end,
            case p_role when 'am' then 'AM' when 'pm' then 'PM' end,
            now() + case when v_auth_role = 'display' then interval '90 days' else interval '7 days' end);

    return v_token;
end;
$$;

drop function if exists display_board();
drop function if exists display_board(text);
create function display_board(p_class text default null)
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
        'repaired', (select count(*) from repair_requests where status = 'completed' and deleted_at is null),
        'line', (
            select coalesce(json_agg(json_build_object('code', d.line_code, 'name', short_name(d.name), 'device', d.device)
                                     order by d.line_code nulls last, d.created_at), '[]')
            from drop_off_requests d
            where d.visit_date = v_today
              and (v_group is null or d.session = v_group)
              and not exists (select 1 from repair_requests r where r.drop_off_id = d.id)),
        'tickets', (
            select coalesce(json_agg(json_build_object(
                       'name', short_name(r.name), 'device', r.device, 'status', r.status, 'priority', r.priority,
                       'techs', (select array_agg(t.name order by t.name) from techs t where t.id = any(r.assigned_tech_ids)))
                     order by r.priority desc, r.created_at), '[]')
            from repair_requests r
            where r.deleted_at is null
              and (r.status in ('pending', 'assigned', 'in_progress', 'waiting_part', 'review')
                   or (r.status = 'completed' and r.completed_at > now() - interval '7 days')))
    );
end;
$$;

grant execute on function display_board(text) to anon, authenticated;

notify pgrst, 'reload schema';
