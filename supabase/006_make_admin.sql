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
  -- id, created_at and updated_at are named explicitly for the same reason: on
  -- some projects they are `not null` with NO default, and relying on one gave
  -- 23502 for id and a row with created_at = null. A null created_at is not
  -- cosmetic - the dashboard's user list orders by it, so the account becomes
  -- effectively invisible there and cannot be given a password.
  --
  -- crypt/gen_salt are called as extensions.crypt because pgcrypto lives in the
  -- `extensions` schema on Supabase, and this function sets search_path to
  -- public - the unqualified names do not resolve.
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    gen_random_uuid(),
    lower(btrim(p_email)),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"provider":"email","providers":["email"]}',
    now(), now()
  )
  returning id into v_uid;

  -- Same repair for an account an older run of this script left behind with a
  -- null created_at: without it the account cannot be managed in the dashboard.
  update auth.users
     set created_at = coalesce(created_at, now()),
         updated_at = coalesce(updated_at, now())
   where id = v_uid;

  -- No profile insert here on purpose. handle_new_user() is an AFTER INSERT
  -- trigger on auth.users and it already creates the row, filling in player_id
  -- and referral_code - both of which are NOT NULL with no default. Inserting
  -- again from here was both redundant and wrong: it named a `games` column that
  -- does not exist, and it would have fought the trigger for the same row.
  --
  -- The only thing left to do is the grant.

  insert into public.staff (user_id, role) values (v_uid, 'superadmin')
  on conflict (user_id) do update set role = 'superadmin';

  -- Fail loudly if the trigger ever stops firing, rather than leaving an account
  -- that can sign in but has no profile and 500s on every query.
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'user % was created but no profile row exists - the handle_new_user trigger did not run', p_email;
  end if;

  return v_uid;
end; $$;

-- Deliberately not callable from the app. If a client could reach this it could
-- mint itself a superadmin, so anon/authenticated get nothing; the SQL editor
-- runs as postgres and is unaffected.
revoke all on function public.create_first_admin(text, text) from public, anon, authenticated;

-- ============ grant_staff: the second half of the job ============
--
-- create_first_admin stops on purpose when the account already exists, which
-- leaves a real and common half-state: the user is in auth.users (signed up in
-- the app, or made in the dashboard) but has no staff row, so the admin panel
-- sees an ordinary player. Before this existed the only way out was to hand-paste
-- a UUID into an INSERT.
--
-- Passwords are deliberately not touchable here. A SQL script cannot reset one
-- correctly across Supabase versions - that is what went wrong three times while
-- writing the file above - and it must not be able to, because a function that
-- can set any account's password is a backdoor. Use Reset password in
-- Authentication -> Users for that.
create or replace function public.grant_staff(p_email text, p_role text default 'superadmin')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
begin
  -- Same caller proof as create_first_admin: no signed-in session, owner only.
  if auth.uid() is not null then
    raise exception 'refusing: grant_staff cannot be called from a signed-in session';
  end if;
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'refusing: grant_staff is restricted to the database owner';
  end if;

  if p_role not in ('admin', 'superadmin', 'support') then
    raise exception 'unknown role %', p_role;
  end if;

  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then raise exception 'no user with the email %', p_email; end if;

  -- An account created by an earlier version of create_first_admin can have a
  -- null created_at, which puts it at the wrong end of the dashboard's user list
  -- and makes it look like it does not exist. Repair it before granting.
  update auth.users
     set created_at = coalesce(created_at, now()),
         updated_at = coalesce(updated_at, now())
   where id = v_uid;

  insert into public.staff (user_id, role) values (v_uid, p_role)
  on conflict (user_id) do update set role = excluded.role;

  if not exists (select 1 from public.profiles where id = v_uid) then
    insert into public.profiles (id, username, player_id, referral_code)
    values (v_uid, coalesce(nullif(split_part(v_uid::text, '-', 1), ''), 'Admin'),
            'KV' || lpad((floor(random() * 900000) + 100000)::text, 6, '0'),
            'KV' || upper(substr(md5(v_uid::text), 1, 4)));
  end if;

  return v_uid;
end; $$;

revoke all on function public.grant_staff(text, text) from public, anon, authenticated;

-- If the account already exists (you made it in the dashboard, or it came in
-- through Google sign-in), just grant staff on it:
--
--   select public.grant_staff('khelofire@app.com', 'superadmin');

-- Check it worked:
--   select u.email, s.role from auth.users u join public.staff s on s.user_id = u.id;
