-- ============================================================
-- BarryTech Repair Lab — the students who made a ticket can edit it.
--   * The details from New Ticket (customer name, contact number, email,
--     class, teacher, room, device, school or personal, make/model,
--     serial tag, computer password, problem) can be changed by the
--     students on the New Ticket (creation_tech_ids, from 013) until the
--     repair is completed, and by the admin on any ticket at any time.
--   * Other students on the ticket keep doing everything else (status,
--     parts, shelf, invoice, students) as before.
-- The site already lets staff write these columns, so this only adds
-- the rule. (041 is the line change on its own branch.) Safe to re-run.
-- ============================================================

-- Named with "a_" so it runs before the other "before update" triggers
-- and sees only what the student changed.
create or replace function a_only_creators_edit_details()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    -- Requests from the site run as anon; the SQL Editor (postgres) is left alone.
    if current_user in ('anon', 'authenticated')
       and current_staff_role() is distinct from 'admin'
       and (new.name, new.contact_number, new.email, new.class_name, new.teacher_name, new.room_number,
            new.device, new.device_owner, new.make_model, new.serial_tag, new.computer_password, new.issue)
           is distinct from
           (old.name, old.contact_number, old.email, old.class_name, old.teacher_name, old.room_number,
            old.device, old.device_owner, old.make_model, old.serial_tag, old.computer_password, old.issue) then
        if current_tech_id() is null or not current_tech_id() = any(coalesce(old.creation_tech_ids, '{}')) then
            raise exception 'Only the students who made this ticket can change its details.';
        end if;
        if old.status in ('completed', 'picked_up') then
            raise exception 'This repair is finished. Ask your teacher to change its details.';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists a_only_creators_edit_details on repair_requests;
create trigger a_only_creators_edit_details
    before update on repair_requests
    for each row execute function a_only_creators_edit_details();
