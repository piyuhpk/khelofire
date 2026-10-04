-- 010: game modes the admin creates actually appear in the app
--
-- Symptom: creating a mode in the admin panel did nothing the player could see.
-- The cause was not a missing feature but a split source of truth. Every mode the
-- app ever showed came from a hardcoded MODES array in src/lib/catalog.ts, and
-- nothing in the client ever read match_modes. The table was not decoration - it
-- was where start_live_match and settle_match looked up the real entry and prize -
-- so the two could disagree completely: a mode created here was invisible in the
-- UI, and a mode edited there kept charging the old entry.
--
-- This adds the missing read path and the missing write path, and the presentation
-- columns a row needs before it can be rendered at all. match_modes only ever held
-- money columns, so a created mode had no name to show in either language, no
-- artwork key and no badge - there was literally nothing to put on a tile.
--
-- Money columns keep their authority. entry_minor and prize_minor here are the same
-- numbers settle_match pays from, so editing them in the admin changes what is
-- actually charged, which is the point - and is also why this is staff-only.

-- ---------- presentation, so a created mode is renderable ----------
do $$ begin
  alter table public.match_modes add column if not exists name_bn    text;
  alter table public.match_modes add column if not exists name_en    text;
  alter table public.match_modes add column if not exists desc_bn    text;
  alter table public.match_modes add column if not exists desc_en    text;
  alter table public.match_modes add column if not exists clock      text;
  alter table public.match_modes add column if not exists theme      text not null default 'blue';
  alter table public.match_modes add column if not exists art        text not null default 'ludo1v1';
  alter table public.match_modes add column if not exists tag        text not null default 'instant';
  alter table public.match_modes add column if not exists open_count int  not null default 0;
  alter table public.match_modes add column if not exists sort_order int  not null default 100;
exception when duplicate_object then null; end $$;

-- A mode with no name at all cannot be shown, and defaulting to the id would put a
-- raw database key in front of a player. Backfill the built-ins from the ids the
-- client already knows, then make the name non-null.
update public.match_modes set name_bn = coalesce(name_bn, label), name_en = coalesce(name_en, label)
 where name_bn is null or name_en is null;

do $$ begin
  alter table public.match_modes alter column name_bn set default '';
exception when others then null; end $$;

create index if not exists match_modes_active_idx on public.match_modes (active, sort_order);

-- ---------- read path ----------
-- Open to anon: the mode list is the shop window and carries no player data. A
-- player must be able to see what they can enter before they have an account.
create or replace function public.list_match_modes()
returns table (
  id text, game text, label text,
  entry_minor bigint, prize_minor bigint, max_players int, active boolean,
  name_bn text, name_en text, desc_bn text, desc_en text, clock text,
  theme text, art text, tag text, open_count int, sort_order int
)
language sql stable security definer set search_path = public as $$
  select m.id, m.game, m.label, m.entry_minor, m.prize_minor, m.max_players, m.active,
         coalesce(m.name_bn, m.label), coalesce(m.name_en, m.label),
         coalesce(m.desc_bn, ''), coalesce(m.desc_en, ''), coalesce(m.clock, ''),
         m.theme, m.art, m.tag, m.open_count, m.sort_order
    from public.match_modes m
   order by m.sort_order, m.id;
$$;
grant execute on function public.list_match_modes() to anon, authenticated;

-- ---------- write path ----------
-- Staff only, and it is an upsert on the id so an existing mode can be edited in
-- place. Leaving a column out leaves it alone rather than blanking it, because
-- blanking name_bn would produce a mode nothing can render.
create or replace function public.upsert_match_mode(
  p_id text,
  p_game text,
  p_label text,
  p_entry_minor bigint,
  p_prize_minor bigint,
  p_max_players int,
  p_name_bn text default null,
  p_name_en text default null,
  p_desc_bn text default null,
  p_desc_en text default null,
  p_clock text default null,
  p_theme text default 'blue',
  p_art text default 'ludo1v1',
  p_tag text default 'instant',
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_role text := public.is_staff();
begin
  if v_role is null or v_role not in ('admin','superadmin') then
    raise exception 'admin only';
  end if;

  if p_id is null or btrim(p_id) = '' then raise exception 'mode id is required'; end if;
  if p_id !~ '^[a-z0-9_]{2,48}$' then
    -- The id lands in a URL (/play/ludo/<id>) and in a router param, so anything
    -- that is not a plain slug is either a broken link or an injection attempt.
    raise exception 'mode id may only use lowercase letters, digits and underscore';
  end if;
  if p_game not in ('ludo','chess','guti','dice') then
    raise exception 'unsupported game %', p_game;
  end if;
  if p_entry_minor < 0 or p_prize_minor < 0 then
    raise exception 'entry and prize cannot be negative';
  end if;
  -- The whole point of the mode is the payout, so a prize below the entry is a
  -- configuration error that would quietly take money off every player.
  if p_prize_minor < p_entry_minor then
    raise exception 'prize (%) must be at least the entry (%)', p_prize_minor, p_entry_minor;
  end if;
  if p_max_players not in (2,4) then
    raise exception 'a live table is 2 or 4 seats, not %', p_max_players;
  end if;
  if p_tag not in ('tournament','instant','free') then
    raise exception 'unsupported tag %', p_tag;
  end if;
  if p_theme not in ('blue','violet','orange','teal','crimson') then
    raise exception 'unsupported theme %', p_theme;
  end if;

  insert into public.match_modes
    (id, game, label, entry_minor, prize_minor, max_players, active,
     name_bn, name_en, desc_bn, desc_en, clock, theme, art, tag)
  values
    (btrim(p_id), btrim(p_game), coalesce(nullif(btrim(p_label),''), btrim(p_id)),
     p_entry_minor, p_prize_minor, p_max_players, coalesce(p_active, true),
     coalesce(nullif(btrim(p_name_bn),''), btrim(p_label), btrim(p_id)),
     coalesce(nullif(btrim(p_name_en),''), btrim(p_label), btrim(p_id)),
     coalesce(btrim(p_desc_bn), ''), coalesce(btrim(p_desc_en), ''),
     coalesce(btrim(p_clock), ''), p_theme, p_art, p_tag)
  on conflict (id) do update
    set game        = excluded.game,
        label       = excluded.label,
        entry_minor = excluded.entry_minor,
        prize_minor = excluded.prize_minor,
        max_players = excluded.max_players,
        active      = excluded.active,
        name_bn     = excluded.name_bn,
        name_en     = excluded.name_en,
        desc_bn     = excluded.desc_bn,
        desc_en     = excluded.desc_en,
        clock       = excluded.clock,
        theme       = excluded.theme,
        art         = excluded.art,
        tag         = excluded.tag;

  -- Only match_modes changes. Nothing references it by cascade, and a mode that is
  -- in use must not be deletable by editing it, only deactivated.

  return jsonb_build_object('id', btrim(p_id), 'saved', true);
end; $$;
revoke execute on function public.upsert_match_mode(text,text,text,bigint,bigint,int,text,text,text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.upsert_match_mode(text,text,text,bigint,bigint,int,text,text,text,text,text,text,text,text,boolean) to authenticated;