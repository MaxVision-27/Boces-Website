-- ============================================================
-- BarryTech Repair Lab — "Waiting for tech response".
--   * When the admin sends a ticket back with a note, it waits for a
--     student on it to write a reply (review_reply, review_replied_at).
--     The admin sees the reply on the ticket; staff only, the customer's
--     tracker doesn't change.
--   * The TV tags those tickets "Reply to teacher" (reply_needed).
-- Additive: the current site keeps working. Safe to re-run.
-- ============================================================

alter table repair_requests
    add column if not exists review_reply text check (char_length(review_reply) <= 1000),
    add column if not exists review_replied_at timestamptz;

-- Ticket numbers don't roll back, so testing this migration used one up:
-- the next ticket is #38 again (or follows the newest ticket, 035).
select setval(pg_get_serial_sequence('repair_requests', 'id'), greatest(38, coalesce((select max(id) from repair_requests), 0) + 1), false);

-- The TV (from 035) marks tickets whose Send Back note has no reply yet.
create or replace function display_board(p_class text default null)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
    v_group text := coalesce(upper(nullif(trim(p_class), '')), current_staff_group());
    v_today date := (now() at time zone 'America/New_York')::date;
begin
    if current_staff_role() is null or v_group not in ('AM', 'PM') then
        return null;
    end if;
    return json_build_object(
        'class', v_group,
        'repaired', (select paper_repairs from stats limit 1)
                    + (select count(*) from repair_requests where status in ('completed', 'picked_up') and deleted_at is null),
        'line', (
            select coalesce(json_agg(json_build_object('code', d.line_code, 'name', short_name(d.name), 'device', d.device)
                                     order by d.line_code nulls last, d.created_at), '[]')
            from drop_off_requests d
            where d.visit_date = v_today
              and (v_group is null or d.session = v_group)
              and not exists (select 1 from repair_requests r where r.drop_off_id = d.id)),
        'tickets', (
            select coalesce(json_agg(json_build_object(
                       'id', r.id, 'name', short_name(r.name), 'device', r.device, 'status', r.status, 'priority', r.priority,
                       'reply_needed', r.review_note is not null and r.review_reply is null,
                       'techs', (select array_agg(t.name order by t.name) from techs t where t.id = any(r.assigned_tech_ids)))
                     order by r.priority desc, r.created_at), '[]')
            from repair_requests r
            where r.deleted_at is null
              and r.status in ('pending', 'assigned', 'in_progress', 'waiting_part', 'review', 'completed'))
    );
end;
$$;

notify pgrst, 'reload schema';
