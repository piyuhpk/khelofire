-- 011: stop the server offering games that have no live engine
--
-- Why this file exists.
--
-- Only Ludo has a board the server can drive: the ludo-game edge function speaks
-- Ludo's dice, tokens and turn rules, and create_live_match is the single entry
-- point that reaches it. Chess, Guti and Dice play well against the local bot, which
-- is why they are in the app - but their paid modes (chess_1v1, guti_1v1, dice_1v1)
-- were sitting in match_modes with an entry price and active = true.
--
-- That combination was the most expensive bug in the app. A player tapped a paid
-- tile, was forwarded to the live tables screen - which is Ludo only and would have
-- created a Ludo table - and the client would have taken money for a Chess match it
-- could never deliver. It was reachable three ways: the lobby list, the in-game mode
-- switcher, and a deep link to /play/chess/chess_1v1, where the component ran a solo
-- bot game and credited that mode's real 36tk prize locally with no entry debited.
--
-- The client now refuses all of these (see catalog.canPlayLive, ConfirmJoin, and the
-- per-game deep-link guard). This file is the server half, and it is the half that
-- matters, because APKs already installed on customer phones run the old code and
-- will keep running it until they are updated. An old APK must not be able to buy a
-- Chess match.
--
-- Two changes:
--   1. list_match_modes only returns active rows, so an inactive mode cannot be
--      shown or bought at all.
--   2. The paid modes for the three games without an engine are deactivated. Their
--      practice modes are left active - those are a real local game and they work.

-- ---------- 1. active rows only ----------
-- The old body had no `where` clause at all: it returned deactivated modes exactly
-- like live ones, so switching a mode off in the admin panel changed nothing a
-- player could see. That is the whole meaning of the flag, so it is applied here.
--
-- Kept as a full replace rather than a new overload because the return type is
-- unchanged and callers select the same columns by name.
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
   where m.active
   order by m.sort_order, m.id;
$$;
grant execute on function public.list_match_modes() to anon, authenticated;

-- ---------- 2. deactivate the undeliverable paid modes ----------
-- Narrow on purpose. This does not guess at ids: it touches only rows whose game is
-- not ludo AND which charge money, which is exactly the set of modes that promise a
-- real-money match the server cannot run. A practice mode has entry_minor = 0 and is
-- left alone. An ludo mode is left alone, including any an admin adds later.
--
-- Idempotent: re-running only re-asserts the same state for the same rows.
update public.match_modes
   set active = false
 where game <> 'ludo'
   and entry_minor > 0
   and active;