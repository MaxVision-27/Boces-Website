-- ============================================================
-- BarryTech Repair Lab — remember which students each WBL Hours
-- sheet belongs to, since an admin can hand a ticket to other
-- students later:
--   * repair_requests.creation_tech_ids: who was on the ticket when it
--     was created (the "Ticket Creation" sheet)
--   * time_logs.team_tech_ids: who was on the ticket when a session was
--     logged. A handoff changes the team, and each team gets its own
--     "Repair Work" sheet(s).
-- Set by triggers, so every insert records them. Additive.
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table repair_requests add column if not exists creation_tech_ids bigint[];
alter table time_logs add column if not exists team_tech_ids bigint[];

create or replace function set_creation_team()
returns trigger
language plpgsql
as $$
begin
    new.creation_tech_ids := coalesce(new.creation_tech_ids, new.assigned_tech_ids);
    return new;
end;
$$;

drop trigger if exists creation_team on repair_requests;
create trigger creation_team
    before insert on repair_requests
    for each row execute function set_creation_team();

create or replace function set_time_log_team()
returns trigger
language plpgsql
as $$
begin
    new.team_tech_ids := (select assigned_tech_ids from repair_requests where id = new.ticket_id);
    return new;
end;
$$;

drop trigger if exists time_log_team on time_logs;
create trigger time_log_team
    before insert on time_logs
    for each row execute function set_time_log_team();

-- Existing tickets: the student who created it (matched by name);
-- tickets customers submitted before tech-only intake have none.
update repair_requests r
set creation_tech_ids = array(select t.id from techs t where t.name = r.created_by)
where creation_tech_ids is null;

-- Existing sessions: whoever is on the ticket now.
update time_logs l
set team_tech_ids = r.assigned_tech_ids
from repair_requests r
where r.id = l.ticket_id and l.team_tech_ids is null;
