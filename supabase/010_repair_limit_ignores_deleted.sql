-- ============================================================
-- BarryTech Repair Lab — the "max 20 active repairs" limit ignores
-- deleted tickets. Since 006, "Delete" in the Ticket Pool only sets
-- deleted_at, so deleted-but-not-completed tickets were still being
-- counted and could block new tickets. Same function as before
-- (enforce_repair_limit, BEFORE INSERT on repair_requests) with only
-- the deleted_at filter added.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

create or replace function check_repair_limit()
returns trigger
language plpgsql
as $$
begin
    if (select count(*) from repair_requests where status != 'completed' and deleted_at is null) >= 20 then
        raise exception 'Repair limit reached. Maximum 20 active repairs allowed.';
    end if;
    return new;
end;
$$;
