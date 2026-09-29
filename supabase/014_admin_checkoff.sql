-- ============================================================
-- BarryTech Repair Lab — an admin checks off every finished repair.
--   * New status 'review': the students say it's done and it waits for
--     the admin to check it. Customers tracking it see "Final Check".
--   * repair_requests.review_note: why the admin sent it back, shown to
--     the students on the ticket. Cleared when they send it in again.
--   * Only an admin session can mark a ticket completed through the
--     site's API. Enforced here, so an old copy of the site or a
--     hand-made request can't skip it.
-- Run it with or after the site update that adds "Ready for Check-Off":
-- from then on a tech's "Mark Completed" is refused, which is the point.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- 1) Allow 'review' (looks up the constraint by definition, like 001) --
do $$
declare
    con_name text;
begin
    select con.conname into con_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'repair_requests'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%';

    if con_name is not null then
        execute format('alter table repair_requests drop constraint %I', con_name);
    end if;

    alter table repair_requests
        add constraint repair_requests_status_check
        check (status in ('flagged', 'pending', 'assigned', 'in_progress', 'review', 'completed'));
end $$;

-- 2) The admin's reason for sending a repair back ---------------------
alter table repair_requests add column if not exists review_note text;

-- 3) Only an admin marks a repair completed ---------------------------
create or replace function only_admin_completes()
returns trigger
language plpgsql
as $$
begin
    -- Requests from the site run as anon; the SQL Editor (postgres) is left alone.
    if new.status = 'completed'
       and (tg_op = 'INSERT' or old.status is distinct from 'completed')
       and current_user in ('anon', 'authenticated')
       and current_staff_role() is distinct from 'admin' then
        raise exception 'Only an admin can mark a repair completed';
    end if;
    return new;
end;
$$;

drop trigger if exists only_admin_completes on repair_requests;
create trigger only_admin_completes
    before insert or update on repair_requests
    for each row execute function only_admin_completes();

notify pgrst, 'reload schema';
