-- ============================================================
-- BarryTech Repair Lab — drop-off requests ("tell us you're coming").
--   * A customer picks a class day (AM or PM, weekdays, up to 14 days
--     ahead) and says what they're bringing. It is NOT a ticket and has
--     no tracking code: the ticket is still made in person.
--   * At most 5 requests per class day, and one upcoming request per
--     contact number, so the public form can't be flooded.
--   * Staff can read requests; only the admin can delete them. A tech
--     checks a customer in by creating their ticket with drop_off_id,
--     which marks the ticket as priority (served and repaired first).
--   * Requests are removed 30 days after their day.
-- Run this in the Supabase SQL Editor BEFORE the site update that uses
-- it. Safe to re-run.
-- ============================================================

-- 1) Requests ------------------------------------------------------------
create table if not exists drop_off_requests (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    visit_date date not null,
    session text not null check (session in ('AM', 'PM')),
    name text not null check (char_length(name) between 1 and 100),
    contact_number text not null check (char_length(contact_number) between 7 and 40),
    class_name text check (char_length(class_name) <= 100),
    room_number text check (char_length(room_number) <= 40),
    device text not null check (device in ('Laptop', 'Desktop', 'Tablet', 'Smartphone', 'Other')),
    make_model text check (char_length(make_model) <= 100),
    issue text not null check (char_length(issue) between 1 and 1000)
);

alter table drop_off_requests enable row level security;

drop policy if exists "drop_offs_staff_read" on drop_off_requests;
create policy "drop_offs_staff_read" on drop_off_requests
    for select using ((select is_staff()));

drop policy if exists "drop_offs_admin_delete" on drop_off_requests;
create policy "drop_offs_admin_delete" on drop_off_requests
    for delete using ((select current_staff_role()) = 'admin');

-- 2) Tickets remember the request they came from -------------------------
-- unique: a request can only be checked in once.
alter table repair_requests
    add column if not exists drop_off_id bigint unique references drop_off_requests(id) on delete set null,
    add column if not exists priority boolean not null default false;

-- 3) The public form -----------------------------------------------------
-- Returns 'ok', 'bad_day' (not a weekday within 14 days), 'full'
-- (5 requests already), 'duplicate' (this contact already has one
-- coming up) or 'invalid' (a required field is missing or too long).
create or replace function request_drop_off(
    p_visit_date date, p_session text, p_name text, p_contact text, p_class text,
    p_room text, p_device text, p_model text, p_issue text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_today date := (now() at time zone 'America/New_York')::date;
    v_digits text := regexp_replace(coalesce(p_contact, ''), '\D', '', 'g');
begin
    if p_visit_date is null or p_visit_date < v_today or p_visit_date > v_today + 14
       or extract(isodow from p_visit_date) > 5 or p_session not in ('AM', 'PM') then
        return 'bad_day';
    end if;
    if coalesce(trim(p_name), '') = '' or coalesce(trim(p_issue), '') = '' or length(v_digits) < 7 then
        return 'invalid';
    end if;

    -- One request at a time, so two people can't both take the 5th spot.
    perform pg_advisory_xact_lock(hashtext('drop_off_requests'));

    delete from drop_off_requests where visit_date < v_today - 30;

    if exists (select 1 from drop_off_requests
               where visit_date >= v_today
                 and regexp_replace(contact_number, '\D', '', 'g') = v_digits) then
        return 'duplicate';
    end if;
    if (select count(*) from drop_off_requests where visit_date = p_visit_date and session = p_session) >= 5 then
        return 'full';
    end if;

    insert into drop_off_requests (visit_date, session, name, contact_number, class_name, room_number, device, make_model, issue)
    values (p_visit_date, p_session, trim(p_name), trim(p_contact), nullif(trim(p_class), ''), nullif(trim(p_room), ''),
            p_device, nullif(trim(p_model), ''), trim(p_issue));
    return 'ok';
exception when check_violation then
    return 'invalid';
end;
$$;

grant execute on function request_drop_off(date, text, text, text, text, text, text, text, text) to anon, authenticated;

-- Which class days are full, so the form can grey them out. No names.
create or replace function full_drop_off_days()
returns table (visit_date date, session text)
language sql
stable
security definer
set search_path = public
as $$
    select d.visit_date, d.session from drop_off_requests d
    where d.visit_date >= (now() at time zone 'America/New_York')::date
    group by d.visit_date, d.session
    having count(*) >= 5
$$;

grant execute on function full_drop_off_days() to anon, authenticated;

notify pgrst, 'reload schema';
