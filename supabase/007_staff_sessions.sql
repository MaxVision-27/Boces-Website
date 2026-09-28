-- ============================================================
-- BarryTech Repair Lab — staff sessions. Staff login now hands back a
-- random session token; the site sends it on every request in an
-- x-staff-token header, and current_staff_role() looks it up so row
-- level security can tell staff apart from the public (policies are
-- in 008). Also adds track_repair(), the one ticket lookup the public
-- keeps once tickets are staff-only.
-- Purely additive: safe to run before the new site JS is deployed.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists staff_sessions (
    token_hash text primary key,
    role text not null check (role in ('admin', 'tech')),
    expires_at timestamptz not null
);

alter table staff_sessions enable row level security;
revoke all on staff_sessions from anon, authenticated;

-- Hashes the password exactly like the old admin-login edge function
-- (unsalted SHA-256, hex) so the passwords already in admin_auth work.
create or replace function staff_login(p_role text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_token text;
begin
    if not exists (
        select 1 from admin_auth
        where role = p_role
          and password_hash = encode(digest(p_password, 'sha256'), 'hex')
    ) then
        return null;
    end if;

    delete from staff_sessions where expires_at < now();

    v_token := encode(gen_random_bytes(32), 'hex');
    insert into staff_sessions (token_hash, role, expires_at)
    values (encode(digest(v_token, 'sha256'), 'hex'), p_role, now() + interval '7 days');

    return v_token;
end;
$$;

-- nullif: on a pooled connection that has already served a request,
-- an unset request.headers comes back as '' instead of null, and
-- ''::json would throw.
create or replace function current_staff_role()
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
    select role from staff_sessions
    where token_hash = encode(digest(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-staff-token', ''), 'sha256'), 'hex')
      and expires_at > now()
$$;

create or replace function is_staff()
returns boolean
language sql
stable
set search_path = public
as $$
    select current_staff_role() is not null
$$;

create or replace function staff_logout()
returns void
language sql
security definer
set search_path = public, extensions
as $$
    delete from staff_sessions
    where token_hash = encode(digest(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-staff-token', ''), 'sha256'), 'hex')
$$;

create or replace function track_repair(p_code text)
returns table (device text, issue text, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
    select r.device::text, r.issue::text, r.status::text, r.created_at
    from repair_requests r
    where r.tracking_code = upper(trim(p_code))
      and r.deleted_at is null
$$;
