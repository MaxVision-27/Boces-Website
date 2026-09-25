-- ============================================================
-- BarryTech Repair Lab — time tracking (hours worked per ticket,
-- per day, per student). Backs the "Log time worked" control on a
-- tech's assigned tickets and their "My Hours" tab.
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query)
-- Safe to re-run.
-- ============================================================

create table if not exists time_logs (
    id bigint generated always as identity primary key,
    ticket_id bigint not null references repair_requests(id) on delete cascade,
    tech_id bigint not null references techs(id) on delete cascade,
    work_date date not null,
    start_time time not null,
    end_time time not null,
    created_at timestamptz not null default now(),
    constraint time_logs_end_after_start check (end_time > start_time)
);

create index if not exists time_logs_tech_id_idx on time_logs(tech_id);
create index if not exists time_logs_ticket_id_idx on time_logs(ticket_id);

alter table time_logs enable row level security;

-- Matches the existing trust model used by techs/repair_requests/reviews:
-- the anon key is used for all reads/writes, gated client-side.
drop policy if exists "time_logs_select_anon" on time_logs;
create policy "time_logs_select_anon" on time_logs for select using (true);

drop policy if exists "time_logs_insert_anon" on time_logs;
create policy "time_logs_insert_anon" on time_logs for insert with check (true);

drop policy if exists "time_logs_update_anon" on time_logs;
create policy "time_logs_update_anon" on time_logs for update using (true);

drop policy if exists "time_logs_delete_anon" on time_logs;
create policy "time_logs_delete_anon" on time_logs for delete using (true);
