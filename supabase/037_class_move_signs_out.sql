-- ============================================================
-- BarryTech Repair Lab — moving a student to the other class signs
-- them out (from 033's sign_out_removed_student). A login remembers the
-- student's class, and the hours rules use it, so after a move the
-- student signs back in and gets the new class's time window.
-- Additive: the current site keeps working. Safe to re-run.
-- ============================================================

create or replace function sign_out_removed_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if (new.removed_at is not null and old.removed_at is null)
       or new.session is distinct from old.session then
        delete from staff_sessions where tech_id = new.id;
    end if;
    return new;
end;
$$;

notify pgrst, 'reload schema';
