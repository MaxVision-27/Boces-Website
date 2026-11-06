-- ============================================================
-- BarryTech Repair Lab — each student signs in with their own login.
--   * A student signs in with their school email (@nasboces.org) and a
--     password only the admin sets or changes. The session remembers
--     which student it is (staff_sessions.tech_id), so the database knows
--     who is who: no more shared AM/PM class passwords or name picker.
--   * Passwords are bcrypt hashes in student_passwords, which nobody can
--     read through the API; only the functions below touch it.
--   * 10 wrong passwords lock that login for 15 minutes. The admin
--     setting a new password unlocks it.
--   * With a real identity, the database now checks that a student logs
--     work only as themselves and edits only their own notes, and that
--     a student can only change their own look (theme).
--   * The AM/PM class passwords stop working, and everyone signed in
--     with one is signed out.
-- Changes the login the live site uses: run it right before merging.
-- Safe to re-run.
-- ============================================================

-- 1) Logins ----------------------------------------------------------------
alter table techs add column if not exists email text;
alter table techs drop constraint if exists techs_email_nasboces;
alter table techs add constraint techs_email_nasboces check (email ~ '^[a-z0-9._%+-]+@nasboces\.org$');
create unique index if not exists techs_email_unique on techs (email);

create table if not exists student_passwords (
    tech_id bigint primary key references techs(id) on delete cascade,
    password_hash text not null,
    failed_attempts int not null default 0,
    locked_until timestamptz
);
alter table student_passwords enable row level security;
revoke all on student_passwords from anon, authenticated;

alter table staff_sessions add column if not exists tech_id bigint references techs(id) on delete cascade;

-- The signed-in student (null for the admin, the TV, or no session).
create or replace function current_tech_id()
returns bigint
language sql
stable
security definer
set search_path = public, extensions
as $$
    select tech_id from staff_sessions
    where token_hash = encode(digest(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-staff-token', ''), 'sha256'), 'hex')
      and expires_at > now()
$$;

grant execute on function current_tech_id() to anon, authenticated;

-- result: 'ok' (with token, tech_id, class), 'wrong' (email or password),
-- 'not_set' (the admin hasn't given this student a password yet) or
-- 'locked' (too many wrong passwords; try again later).
create or replace function student_login(p_email text, p_password text)
returns table (result text, token text, tech_id bigint, class text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_tech techs%rowtype;
    v_auth student_passwords%rowtype;
    v_token text;
begin
    select * into v_tech from techs t
    where t.email = lower(trim(coalesce(p_email, ''))) and t.removed_at is null;
    if not found then
        return query select 'wrong'::text, null::text, null::bigint, null::text;
        return;
    end if;

    select * into v_auth from student_passwords s where s.tech_id = v_tech.id for update;
    if not found then
        return query select 'not_set'::text, null::text, null::bigint, null::text;
        return;
    end if;
    if v_auth.locked_until > now() then
        return query select 'locked'::text, null::text, null::bigint, null::text;
        return;
    end if;

    if crypt(coalesce(p_password, ''), v_auth.password_hash) <> v_auth.password_hash then
        update student_passwords s
        set failed_attempts = case when v_auth.failed_attempts + 1 >= 10 then 0 else v_auth.failed_attempts + 1 end,
            locked_until = case when v_auth.failed_attempts + 1 >= 10 then now() + interval '15 minutes' end
        where s.tech_id = v_tech.id;
        return query select (case when v_auth.failed_attempts + 1 >= 10 then 'locked' else 'wrong' end)::text, null::text, null::bigint, null::text;
        return;
    end if;

    update student_passwords s set failed_attempts = 0, locked_until = null where s.tech_id = v_tech.id;
    delete from staff_sessions where expires_at < now();
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into staff_sessions (token_hash, role, session_group, tech_id, expires_at)
    values (encode(digest(v_token, 'sha256'), 'hex'), 'tech', v_tech.session, v_tech.id, now() + interval '7 days');
    return query select 'ok'::text, v_token, v_tech.id, v_tech.session::text;
end;
$$;

grant execute on function student_login(text, text) to anon, authenticated;

-- Admin only: set a student's email and (unless blank) a new password,
-- which also unlocks the login. result: 'ok', 'not_admin', 'bad_email',
-- 'email_taken', 'short_password' (under 8 characters) or 'no_password'
-- (a new login needs one).
create or replace function admin_set_student_login(p_tech_id bigint, p_email text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_email text := lower(trim(coalesce(p_email, '')));
begin
    if current_staff_role() is distinct from 'admin' then
        return 'not_admin';
    end if;
    if v_email !~ '^[a-z0-9._%+-]+@nasboces\.org$' then
        return 'bad_email';
    end if;
    if exists (select 1 from techs where email = v_email and id <> p_tech_id) then
        return 'email_taken';
    end if;
    if coalesce(p_password, '') = '' and not exists (select 1 from student_passwords where tech_id = p_tech_id) then
        return 'no_password';
    end if;
    if coalesce(p_password, '') <> '' and char_length(p_password) < 8 then
        return 'short_password';
    end if;

    update techs set email = v_email where id = p_tech_id;
    if coalesce(p_password, '') <> '' then
        insert into student_passwords (tech_id, password_hash) values (p_tech_id, crypt(p_password, gen_salt('bf')))
        on conflict (tech_id) do update set password_hash = excluded.password_hash, failed_attempts = 0, locked_until = null;
        -- A new password signs the student out everywhere.
        delete from staff_sessions where tech_id = p_tech_id;
    end if;
    return 'ok';
end;
$$;

grant execute on function admin_set_student_login(bigint, text, text) to anon, authenticated;

-- Admin only: which students can sign in, and which are locked.
create or replace function admin_student_logins()
returns table (tech_id bigint, has_password boolean, locked boolean)
language sql
stable
security definer
set search_path = public
as $$
    select t.id, s.tech_id is not null, coalesce(s.locked_until > now(), false)
    from techs t left join student_passwords s on s.tech_id = t.id
    where current_staff_role() = 'admin'
$$;

grant execute on function admin_student_logins() to anon, authenticated;

-- 2) No more class passwords (from 026: admin and the TV stay) ------------
create or replace function staff_login(p_role text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_auth_role text := case p_role when 'admin' then 'admin' when 'tv' then 'display' end;
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
    insert into staff_sessions (token_hash, role, expires_at)
    values (encode(digest(v_token, 'sha256'), 'hex'),
            case when v_auth_role = 'display' then 'display' else 'admin' end,
            now() + case when v_auth_role = 'display' then interval '90 days' else interval '7 days' end);

    return v_token;
end;
$$;

-- Everyone signed in with a class password is signed out.
delete from staff_sessions where role = 'tech' and tech_id is null;

-- Removing a student signs them out.
create or replace function sign_out_removed_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.removed_at is not null and old.removed_at is null then
        delete from staff_sessions where tech_id = new.id;
    end if;
    return new;
end;
$$;

drop trigger if exists sign_out_removed_student on techs;
create trigger sign_out_removed_student
    after update on techs
    for each row execute function sign_out_removed_student();

-- 3) Students act only as themselves ---------------------------------------
-- Students: read every student, change only their own look. Admin: anything.
drop policy if exists "techs_staff_all" on techs;
drop policy if exists "techs_staff_read" on techs;
drop policy if exists "techs_admin_write" on techs;
drop policy if exists "techs_self_update" on techs;
create policy "techs_staff_read" on techs for select using ((select is_staff()));
create policy "techs_admin_write" on techs for all
    using ((select current_staff_role()) = 'admin') with check ((select current_staff_role()) = 'admin');
create policy "techs_self_update" on techs for update
    using (id = (select current_tech_id())) with check (id = (select current_tech_id()));

create or replace function techs_self_look_only()
returns trigger
language plpgsql
as $$
begin
    if current_staff_role() = 'tech'
       and (new.name, new.session, new.email, new.removed_at) is distinct from (old.name, old.session, old.email, old.removed_at) then
        raise exception 'Students can only change their own theme.';
    end if;
    return new;
end;
$$;

drop trigger if exists techs_self_look_only on techs;
create trigger techs_self_look_only
    before update on techs
    for each row execute function techs_self_look_only();

-- Work sessions (from 032): a student logs and edits only their own.
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
