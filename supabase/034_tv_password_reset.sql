-- ============================================================
-- BarryTech Repair Lab — the admin resets the TV password from the
-- staff page (Admin Panel → TV Password), no SQL needed. It's saved as
-- the SHA-256 hash staff_login() checks, and every TV signed in with the
-- old password is signed out. Additive: the current site keeps working.
-- Safe to re-run.
-- ============================================================

-- result: 'ok', 'not_admin' or 'short_password' (under 8 characters).
create or replace function admin_set_tv_password(p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if current_staff_role() is distinct from 'admin' then
        return 'not_admin';
    end if;
    if char_length(coalesce(p_password, '')) < 8 then
        return 'short_password';
    end if;

    update admin_auth set password_hash = encode(digest(p_password, 'sha256'), 'hex') where role = 'display';
    if not found then
        insert into admin_auth (role, password_hash) values ('display', encode(digest(p_password, 'sha256'), 'hex'));
    end if;
    delete from staff_sessions where role = 'display';
    return 'ok';
end;
$$;

grant execute on function admin_set_tv_password(text) to anon, authenticated;

notify pgrst, 'reload schema';
