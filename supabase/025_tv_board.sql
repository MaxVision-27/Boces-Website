-- ============================================================
-- BarryTech Repair Lab — classroom TV board (tv.html).
--   * A view-only 'display' login: one password, and the TV picks AM
--     or PM when it signs in (staff_login 'tv_am' / 'tv_pm'). It is NOT
--     staff: is_staff() is false for it, so every table stays closed to
--     it. It can only call display_board(). Signed in for 90 days, so
--     the TV doesn't ask every week.
--   * display_board(): today's line for that class, open tickets,
--     tickets finished in the last 7 days, and how many devices we've
--     repaired in all. Customers show as first name + last initial;
--     no contact info, tracking codes or problems.
--   * repair_requests.completed_at: when it was marked completed, so
--     "Ready for pickup" can drop old tickets. Tickets completed before
--     this runs have none and don't show there.
-- The password is NOT in this file (the repo is public): set it in the
-- SQL Editor with the statement sent separately. Until then nobody can
-- sign in to the TV.
-- Additive: the current site keeps working. Safe to re-run.
-- ============================================================

-- 1) Display sessions are not staff ------------------------------------
alter table staff_sessions drop constraint if exists staff_sessions_role_check;
alter table staff_sessions add constraint staff_sessions_role_check check (role in ('admin', 'tech', 'display'));

create or replace function is_staff()
returns boolean
language sql
stable
set search_path = public
as $$
    select coalesce(current_staff_role() in ('admin', 'tech'), false)
$$;

create or replace function staff_login(p_role text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_auth_role text := case p_role when 'admin' then 'admin' when 'am' then 'tech_am' when 'pm' then 'tech_pm'
                                    when 'tv_am' then 'display' when 'tv_pm' then 'display' end;
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
            case when p_role in ('am', 'tv_am') then 'AM' when p_role in ('pm', 'tv_pm') then 'PM' end,
            now() + case when v_auth_role = 'display' then interval '90 days' else interval '7 days' end);

    return v_token;
end;
$$;

-- 2) When a ticket was completed (kept by the status trigger from 020) --
alter table repair_requests add column if not exists completed_at timestamptz;

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
    if new.status <> 'completed' then
        new.completed_at := null;
    elsif tg_op = 'INSERT' or old.status is distinct from 'completed' then
        new.completed_at := now();
    end if;
    return new;
end;
$$;

-- 3) The board -----------------------------------------------------------
-- "Jordan Smith" -> "Jordan S."; one-word names stay as they are.
create or replace function short_name(p_name text)
returns text
language sql
immutable
as $$
    select regexp_replace(trim(p_name), '^(\S+).*\s(\S)\S*$', '\1 \2.')
$$;

-- Null unless a signed-in session (TV, tech or admin) asks. The admin
-- has no class, so it sees both lines.
create or replace function display_board()
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
    v_group text := current_staff_group();
    v_today date := (now() at time zone 'America/New_York')::date;
begin
    if current_staff_role() is null then
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

grant execute on function display_board() to anon, authenticated;

notify pgrst, 'reload schema';
