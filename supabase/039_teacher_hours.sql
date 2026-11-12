-- ============================================================
-- BarryTech Repair Lab — the admin adds and fixes students' hours on
-- the site (Manage Students → a student → Add hours / Edit).
--   * time_logs.edited_by_teacher_at: set whenever the admin adds or
--     changes a session, so the student sees "Edited by teacher" and
--     knows why a total changed. Students can't set or clear it.
--   * The admin already skips the hours rules (030/032/033), so they can
--     pick any date and time. Students' rules are unchanged.
-- Additive: run it before merging the site update. Safe to re-run.
-- ============================================================

alter table time_logs add column if not exists edited_by_teacher_at timestamptz;

create or replace function mark_teacher_hours()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if current_staff_role() = 'admin' then
        new.edited_by_teacher_at := now();
    elsif tg_op = 'UPDATE' then
        new.edited_by_teacher_at := old.edited_by_teacher_at;
    elsif current_staff_role() is not null then
        new.edited_by_teacher_at := null;
    end if;
    return new;
end;
$$;

drop trigger if exists mark_teacher_hours on time_logs;
create trigger mark_teacher_hours
    before insert or update on time_logs
    for each row execute function mark_teacher_hours();

notify pgrst, 'reload schema';
