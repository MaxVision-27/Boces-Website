-- ============================================================
-- BarryTech Repair Lab — ticket pool (replaces group/project-based
-- ticket assignment with direct, multi-student assignment)
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query)
-- Safe to re-run.
-- ============================================================

-- A ticket can now have more than one student working it.
alter table repair_requests
    add column if not exists assigned_tech_ids bigint[] not null default '{}';

-- Tickets no longer route through a group/project.
alter table repair_requests drop column if exists group_id;
alter table repair_requests drop column if exists group_name;

-- Students are no longer grouped into projects.
alter table techs drop column if exists group_id;

-- Projects/groups are gone entirely — drop the table last, after the
-- column that referenced it (techs.group_id) has already been dropped.
drop table if exists groups;
