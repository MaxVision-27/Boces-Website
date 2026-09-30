-- ============================================================
-- BarryTech Repair Lab — AM and PM classes, and Help Desk Ticket intake.
--   * Tech logins are per class: 'am' and 'pm' each have a password
--     (admin_auth roles tech_am / tech_pm). The session remembers the
--     class, so "Who are you?" only lists that class's students. The old
--     shared 'tech' password is no longer accepted.
--   * techs.session: which class a student is in (existing students
--     start in PM, the class the site was built for).
--   * repair_requests gets the Help Desk Ticket fields. The computer
--     password is cleared once a repair is completed.
-- Passwords are NOT in this file (the repo is public): set them in the
-- SQL Editor with the statement sent separately. Until tech_am/tech_pm
-- have passwords, only the admin can log in.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- 1) Students belong to a class ---------------------------------------
alter table techs add column if not exists session text check (session in ('AM', 'PM'));
update techs set session = 'PM' where session is null;

-- 2) Sessions remember the class --------------------------------------
alter table staff_sessions add column if not exists session_group text check (session_group in ('AM', 'PM'));

create or replace function staff_login(p_role text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_auth_role text := case p_role when 'admin' then 'admin' when 'am' then 'tech_am' when 'pm' then 'tech_pm' end;
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
            case when p_role = 'admin' then 'admin' else 'tech' end,
            case p_role when 'am' then 'AM' when 'pm' then 'PM' end,
            now() + interval '7 days');

    return v_token;
end;
$$;

create or replace function current_staff_group()
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
    select session_group from staff_sessions
    where token_hash = encode(digest(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-staff-token', ''), 'sha256'), 'hex')
      and expires_at > now()
$$;

-- 3) Help Desk Ticket fields --------------------------------------------
alter table repair_requests
    add column if not exists contact_number text,
    add column if not exists class_name text,
    add column if not exists room_number text,
    add column if not exists make_model text,
    add column if not exists serial_tag text,
    add column if not exists computer_password text;

-- The customer's password is only needed while the device is here.
create or replace function clear_computer_password()
returns trigger
language plpgsql
as $$
begin
    if new.status = 'completed' then
        new.computer_password := null;
    end if;
    return new;
end;
$$;

drop trigger if exists clear_computer_password on repair_requests;
create trigger clear_computer_password
    before insert or update on repair_requests
    for each row execute function clear_computer_password();

notify pgrst, 'reload schema';
