-- Puntenjacht testversie: database + toegangsregels + voorbeeldspel.
-- Voer dit bestand één keer volledig uit in Supabase > SQL Editor.

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (game_id, name)
);

-- Codes staan apart zodat ze nooit via de gewone website-query zichtbaar zijn.
create table if not exists public.team_join_codes (
  team_id uuid primary key references public.teams(id) on delete cascade,
  join_code text not null unique
);

-- In deze testversie gebruikt elk team één account. Dat account kan op meerdere
-- telefoons worden gebruikt. Later kunnen we dit uitbreiden naar individuele leden.
create table if not exists public.team_accounts (
  team_id uuid primary key references public.teams(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  title text not null,
  description text not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  points integer not null check (points > 0),
  category text not null default 'Algemeen',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  claimed_by uuid not null references auth.users(id),
  awarded_points integer not null check (awarded_points > 0),
  claimed_at timestamptz not null default now(),
  unique (task_id, team_id)
);

create index if not exists teams_game_id_idx on public.teams(game_id);
create index if not exists tasks_game_id_idx on public.tasks(game_id);
create index if not exists claims_team_id_idx on public.claims(team_id);
create index if not exists claims_task_id_idx on public.claims(task_id);

-- De app kan lezen volgens de policies hieronder. Alle wijzigingen lopen via
-- gecontroleerde databasefuncties, zodat deelnemers zelf geen punten kunnen invullen.
revoke all on public.games, public.teams, public.team_join_codes,
  public.team_accounts, public.tasks, public.claims from anon, authenticated;
grant select on public.games, public.teams, public.team_accounts,
  public.tasks, public.claims to authenticated;

alter table public.games enable row level security;
alter table public.teams enable row level security;
alter table public.team_join_codes enable row level security;
alter table public.team_accounts enable row level security;
alter table public.tasks enable row level security;
alter table public.claims enable row level security;

-- Policy helper is created before the policies that call it.
create or replace function public.is_member_of_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_accounts ta
    join public.teams t on t.id = ta.team_id
    where ta.user_id = auth.uid()
      and t.game_id = p_game_id
  );
$$;

drop policy if exists games_read_for_team on public.games;
create policy games_read_for_team on public.games
  for select to authenticated
  using (public.is_member_of_game(id));

drop policy if exists teams_read_for_game_members on public.teams;
create policy teams_read_for_game_members on public.teams
  for select to authenticated
  using (public.is_member_of_game(game_id));

drop policy if exists team_accounts_read_own on public.team_accounts;
create policy team_accounts_read_own on public.team_accounts
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists tasks_read_for_game_members on public.tasks;
create policy tasks_read_for_game_members on public.tasks
  for select to authenticated
  using (public.is_member_of_game(game_id));

drop policy if exists claims_read_for_game_members on public.claims;
create policy claims_read_for_game_members on public.claims
  for select to authenticated
  using (
    exists (
      select 1
      from public.teams t
      where t.id = claims.team_id
        and public.is_member_of_game(t.game_id)
    )
  );

create or replace function public.get_my_team()
returns table (
  team_id uuid,
  team_name text,
  game_id uuid,
  game_name text,
  game_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name, g.id, g.name, g.status
  from public.team_accounts ta
  join public.teams t on t.id = ta.team_id
  join public.games g on g.id = t.game_id
  where ta.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.join_team_by_code(p_code text)
returns table (
  team_id uuid,
  team_name text,
  game_id uuid,
  game_name text,
  game_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_inserted integer;
begin
  if auth.uid() is null then
    raise exception 'Log eerst in om een team te koppelen.';
  end if;

  select t.id
    into v_team_id
  from public.team_join_codes c
  join public.teams t on t.id = c.team_id
  where lower(trim(c.join_code)) = lower(trim(p_code))
  limit 1;

  if v_team_id is null then
    raise exception 'Deze teamcode is niet geldig.';
  end if;

  if exists (
    select 1 from public.team_accounts ta
    where ta.user_id = auth.uid() and ta.team_id <> v_team_id
  ) then
    raise exception 'Dit account is al aan een ander team gekoppeld.';
  end if;

  if exists (
    select 1 from public.team_accounts ta
    where ta.team_id = v_team_id and ta.user_id <> auth.uid()
  ) then
    raise exception 'Deze teamcode is al in gebruik.';
  end if;

  insert into public.team_accounts(team_id, user_id)
  values (v_team_id, auth.uid())
  on conflict (team_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 and not exists (
    select 1 from public.team_accounts ta
    where ta.team_id = v_team_id and ta.user_id = auth.uid()
  ) then
    raise exception 'Deze teamcode is al in gebruik.';
  end if;

  return query
    select t.id, t.name, g.id, g.name, g.status
    from public.teams t
    join public.games g on g.id = t.game_id
    where t.id = v_team_id;
end;
$$;

create or replace function public.claim_task(p_task_id uuid)
returns table (awarded_points integer, team_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_points integer;
  v_inserted integer;
begin
  select ta.team_id
    into v_team_id
  from public.team_accounts ta
  where ta.user_id = auth.uid();

  if v_team_id is null then
    raise exception 'Koppel eerst een team aan dit account.';
  end if;

  select task.points
    into v_points
  from public.tasks task
  join public.games game on game.id = task.game_id
  join public.teams team on team.game_id = game.id
  where task.id = p_task_id
    and team.id = v_team_id
    and task.active = true
    and game.status = 'active'
  limit 1;

  if v_points is null then
    raise exception 'Deze opdracht is niet beschikbaar.';
  end if;

  insert into public.claims(task_id, team_id, claimed_by, awarded_points)
  values (p_task_id, v_team_id, auth.uid(), v_points)
  on conflict (task_id, team_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'Dit team heeft deze opdracht al geclaimd.';
  end if;

  return query select v_points, v_team_id;
end;
$$;

create or replace function public.get_leaderboard(p_game_id uuid)
returns table (
  team_id uuid,
  team_name text,
  score bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_member_of_game(p_game_id) then
    raise exception 'Je hebt geen toegang tot dit klassement.';
  end if;

  return query
    select t.id, t.name, coalesce(sum(c.awarded_points), 0)::bigint
    from public.teams t
    left join public.claims c on c.team_id = t.id
    where t.game_id = p_game_id
    group by t.id, t.name
    order by coalesce(sum(c.awarded_points), 0) desc, t.name asc;
end;
$$;

revoke all on function public.is_member_of_game(uuid) from public, anon;
revoke all on function public.get_my_team() from public, anon;
revoke all on function public.join_team_by_code(text) from public, anon;
revoke all on function public.claim_task(uuid) from public, anon;
revoke all on function public.get_leaderboard(uuid) from public, anon;
grant execute on function public.is_member_of_game(uuid) to authenticated;
grant execute on function public.get_my_team() to authenticated;
grant execute on function public.join_team_by_code(text) to authenticated;
grant execute on function public.claim_task(uuid) to authenticated;
grant execute on function public.get_leaderboard(uuid) to authenticated;

-- Voorbeeldspel. Vervang deze teamcodes voordat je de website met anderen deelt.
insert into public.games(id, name, status)
values ('11111111-1111-4111-8111-111111111111', 'Testspel', 'active')
on conflict (id) do update set name = excluded.name, status = excluded.status;

insert into public.teams(id, game_id, name) values
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'Team Raaf'),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Team Otter'),
  ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111', 'Team Vos')
on conflict (id) do update set name = excluded.name, game_id = excluded.game_id;

insert into public.team_join_codes(team_id, join_code) values
  ('22222222-2222-4222-8222-222222222221', 'RAAF-7D4F9'),
  ('22222222-2222-4222-8222-222222222222', 'OTTER-3B8Q1'),
  ('22222222-2222-4222-8222-222222222223', 'FOX-6K2M4')
on conflict (team_id) do update set join_code = excluded.join_code;

insert into public.tasks(id, game_id, title, description, difficulty, points, category, active) values
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111111', 'Teamfoto: overwinningspose', 'Maak met het hele team een foto waarop iedereen een overwinningspose doet.', 'easy', 5, 'Creatief', true),
  ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111111', 'Vind drie ronde voorwerpen', 'Zoek drie ronde voorwerpen en leg ze samen op één foto vast.', 'easy', 10, 'Zoeken', true),
  ('33333333-3333-4333-8333-333333333303', '11111111-1111-4111-8111-111111111111', 'Bouw een vrijstaande toren', 'Bouw met maximaal tien voorwerpen de hoogste toren die zelfstandig blijft staan.', 'medium', 20, 'Bouwen', true),
  ('33333333-3333-4333-8333-333333333304', '11111111-1111-4111-8111-111111111111', 'Maak een levend standbeeld', 'Beeld met je team een bekend standbeeld of monument uit. De spelleider moet het raden.', 'hard', 35, 'Uitbeelden', true)
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  difficulty = excluded.difficulty,
  points = excluded.points,
  category = excluded.category,
  active = excluded.active;
