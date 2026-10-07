-- ============================================================
-- BarryTech Repair Lab — only finished repairs can be reviewed.
-- submit_review() (017) checked the tracking code and allowed one review
-- per repair. Now the repair must also be completed: a code for a repair
-- that is still in progress gets 'not_done' and nothing is saved.
-- Same function signature: safe before or after the site update.
-- Safe to re-run.
-- ============================================================

-- Returns 'ok', 'bad_code' (no such repair), 'not_done' (the repair isn't
-- finished yet), 'used' (it already has a review) or 'invalid' (rating
-- or comment out of range).
create or replace function submit_review(p_code text, p_rating int, p_comment text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ticket bigint;
    v_status text;
begin
    if p_rating is null or p_rating not between 1 and 5 or char_length(coalesce(p_comment, '')) > 500 then
        return 'invalid';
    end if;

    select id, status into v_ticket, v_status from repair_requests
    where tracking_code = upper(trim(p_code)) and deleted_at is null;
    if v_ticket is null then
        return 'bad_code';
    end if;
    if v_status <> 'completed' then
        return 'not_done';
    end if;

    insert into reviews (rating, comment, ticket_id) values (p_rating, p_comment, v_ticket);
    return 'ok';
exception when unique_violation then
    return 'used';
end;
$$;

grant execute on function submit_review(text, int, text) to anon, authenticated;

notify pgrst, 'reload schema';
