-- ============================================================
-- BarryTech Repair Lab — repairs done on paper count too.
--   * Before the site, the shop used paper tickets: 37 repairs were
--     completed that way. stats.paper_repairs keeps that number; the
--     repair count everywhere (homepage, TV) is paper_repairs plus the
--     repairs completed on the site. Admin → Update Stats edits it.
--   * Ticket (intake) numbers continue from the paper tickets: the next
--     ticket is #38.
-- Additive: the current site keeps working. Re-running sets paper repairs back to 37.
-- ============================================================

alter table stats add column if not exists paper_repairs int not null default 0 check (paper_repairs >= 0);
update stats set paper_repairs = 37;
update stats set total_repairs = paper_repairs
    + (select count(*) from repair_requests where status in ('completed', 'picked_up') and deleted_at is null);

-- Intake numbers pick up after the 37 paper tickets.
select setval(pg_get_serial_sequence('repair_requests', 'id'), greatest(38, coalesce((select max(id) from repair_requests), 0) + 1), false);

-- The TV's "Devices repaired" (from 031) counts the paper repairs too.
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
                       'techs', (select array_agg(t.name order by t.name) from techs t where t.id = any(r.assigned_tech_ids)))
                     order by r.priority desc, r.created_at), '[]')
            from repair_requests r
            where r.deleted_at is null
              and r.status in ('pending', 'assigned', 'in_progress', 'waiting_part', 'review', 'completed'))
    );
end;
$$;

notify pgrst, 'reload schema';
