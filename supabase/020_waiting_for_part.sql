-- ============================================================
-- BarryTech Repair Lab — "Waiting for part".
--   * New status 'waiting_part': a tech marks it when the customer has
--     to buy a part, before the repair starts or partway through, and
--     marks "Part arrived" (back to in_progress) when it comes in.
--   * status_history: every status a ticket has been in, in order,
--     kept by a trigger (clients can't edit it). The customer's tracker
--     uses it to show each wait: ... Repairing → Waiting for part →
--     Repairing → Final check.
--   * track_repair() also returns the history, and the part's name
--     while the ticket is waiting for it.
-- Additive: the current site keeps working before and after this runs.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- 1) Allow 'waiting_part' (looks up the constraint by definition, like 014)
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
        check (status in ('flagged', 'pending', 'assigned', 'in_progress', 'waiting_part', 'review', 'completed'));
end $$;

-- 2) Status history --------------------------------------------------
alter table repair_requests add column if not exists status_history text[];
update repair_requests set status_history = array[status] where status_history is null;

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
    return new;
end;
$$;

drop trigger if exists track_status_history on repair_requests;
create trigger track_status_history
    before insert or update on repair_requests
    for each row execute function track_status_history();

-- 3) The public tracker gets the history and the part being waited on
drop function if exists track_repair(text);
create function track_repair(p_code text)
returns table (device text, issue text, status text, created_at timestamptz, history text[], part text)
language sql
stable
security definer
set search_path = public
as $$
    select r.device::text, r.issue::text, r.status::text, r.created_at, r.status_history,
           case when r.status = 'waiting_part' then r.parts_used end
    from repair_requests r
    where r.tracking_code = upper(trim(p_code))
      and r.deleted_at is null
$$;

grant execute on function track_repair(text) to anon, authenticated;

notify pgrst, 'reload schema';
