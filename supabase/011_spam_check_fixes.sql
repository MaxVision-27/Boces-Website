-- ============================================================
-- BarryTech Repair Lab — two fixes to the spam check (check_spam,
-- the enforce_spam_limit BEFORE INSERT trigger on repair_requests,
-- max 2 tickets per email per 24 hours):
--   * deleted tickets no longer count (since 006, "Delete" only sets
--     deleted_at, so a mistaken ticket that was deleted and re-created
--     could get the customer refused)
--   * tickets with no email skip the check. Email is optional and the
--     site stores a blank one as '', so every no-email ticket matched
--     every other and the third walk-in without an email in a day was
--     refused as spam.
-- Limit and message are unchanged.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

create or replace function check_spam()
returns trigger
language plpgsql
as $$
begin
    if coalesce(trim(new.email), '') = '' then
        return new;
    end if;

    if (
        select count(*) from repair_requests
        where lower(email) = lower(new.email)
          and created_at > now() - interval '24 hours'
          and deleted_at is null
    ) >= 2 then
        raise exception 'Too many submissions. You can only submit 2 tickets per day.';
    end if;

    return new;
end;
$$;
