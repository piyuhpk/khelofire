-- ============ 006: create the first admin ============
--
-- Run this ONCE on a new project, after 001-005, from the Supabase SQL editor.
-- It is separate from the rest of the schema on purpose: it is the only script
-- here that creates a login, and it is not something a fresh install should run
-- twice or carry into production.
--
-- There is no 'admin' flag on a profile and no client-side PIN. A session is not
-- enough: the admin panel reads is_staff() through RLS, so without a row in
-- public.staff the account is an ordinary player no matter what the UI shows.
--
-- Usage (SQL editor - you are postgres there, so the revoke below does not
-- stop you):
--   select public.create_first_admin('khelofire@app.com', 'a-real-password');
--
-- The password is not hardcoded here on purpose. Do not commit a filled-in copy,
-- and do not paste the real one into chat. The admin can change it afterwards
-- from Admin -> Settings, which asks for the current one first.

create or replace function public.create_first_admin(p_email text, p_password text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
begin
  -- Who is allowed to run a bootstrap that creates users and grants superadmin?
  -- Only the database owner, from the SQL editor. Two refusals, and both matter:
  --
  --   * any signed-in session is rejected outright, so this can never be used as
  --     a self-promotion API by somebody who already has an account
  --   * current_user must be a superuser, which rules out anon/authenticated even
  --     if the revoke below were dropped by mistake
  --
  -- Checking auth.uid() alone would not be enough - auth.uid() is NULL for the
  -- service_role key too, so that check on its own would not stop an edge
  -- function from calling this.
  if auth.uid() is not null then
    raise exception 'refusing: create_first_admin cannot be called from a signed-in session';
  end if;
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'refusing: create_first_admin is restricted to the database owner';
  end if;

  if p_email is null or btrim(p_email) = '' then raise exception 'email is required'; end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'password must be at least 8 characters';
  end if;

  -- Already registered? Then stop. Supabase owns the credential, and a bootstrap
  -- script has no business overwriting a password somebody already chose - and no
  -- way to do it correctly, since it cannot know the plaintext hashing settings
  -- of an existing account. Grant staff with the statement at the bottom instead.
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is not null then
    raise exception 'a user with % already exists - do not reset it here, just run the staff insert at the bottom', p_email;
  end if;

  -- Only the columns that are stable across Supabase versions are named here.
  -- An earlier version of this script listed the full auth.users column set
  -- (instance_id, confirmation_token, recovery_token,
  -- email_change_token_new, recovery_token_expires_at, ...) and it failed on
  -- projects where those columns do not exist - auth.users is Supabase's own
  -- table and its shape differs between versions. Everything not named falls
  -- back to the column default, which is the right default for each of them.
  --
  -- id is named explicitly because auth.users.id is `not null` with no default on
  -- some projects, and the insert failed with 23502 where it does have one.
  --
  -- crypt/gen_salt are called as extensions.crypt because pgcrypto lives in the
  -- `extensions` schema on Supabase, and this function sets search_path to
  -- public - the unqualified names do not resolve.
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    gen_random_uuid(),
    lower(btrim(p_email)),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"provider":"email","providers":["email"]}'
  )
  returning id into v_uid;

  -- the profile row the app reads for name/avatar/balance
  insert into public.profiles (id, username, available_minor, locked_minor, wins, games)
  values (v_uid, 'Khelofire Admin', 0, 0, 0, 0)
  on conflict (id) do nothing;

  insert into public.staff (user_id, role) values (v_uid, 'superadmin')
  on conflict (user_id) do update set role = 'superadmin';

  return v_uid;
end; $$;

-- Deliberately not callable from the app. If a client could reach this it could
-- mint itself a superadmin, so anon/authenticated get nothing; the SQL editor
-- runs as postgres and is unaffected.
revoke all on function public.create_first_admin(text, text) from public, anon, authenticated;

-- If the account already exists (you made it in the dashboard, or it came in
-- through Google sign-in), just grant staff on it:
--
--   insert into public.staff (user_id, role)
--   select id, 'superadmin' from auth.users where lower(email) = 'khelofire@app.com'
--   on conflict (user_id) do update set role = 'superadmin';

-- Check it worked:
--   select u.email, s.role from auth.users u join public.staff s on s.user_id = u.id;
