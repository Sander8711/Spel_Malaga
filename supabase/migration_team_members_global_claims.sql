-- Apply this once to the existing Supabase project.
-- It changes from one shared account per team to individual player accounts,
-- and makes each task claim unique across the whole game.

begin;

create table if not exists public.team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  joined_at timestamptz not null default now()
);

-- Preserve existing team-account assignments.
insert into public.team_members(user_id, team_id, joined_at)
select user_id, team_id, joined_at
from public.team_accounts
on conflict (user_id) do nothing;

revoke all on public.team_members from anon, authenticated;
grant select on public.team_members to authenticated;
alter table public.team_members enable row level security;

drop policy if exists team_members_read_own on public.team_members;
create policy team_members_read_own on public.team_members
  for select to authenticated
  using (user_id = auth.uid());

create or replace function public.is_member_of_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.user_id = auth.uid()
      and t.game_id = p_game_id
  );
$$;

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
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  join public.games g on g.id = t.game_id
  where tm.user_id = auth.uid()
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
  v_existing_team_id uuid;
  v_inserted integer;
begin
  if auth.uid() is null then
    raise exception 'Log eerst in om een team te koppelen.';
  end if;

  select c.team_id into v_team_id
  from public.team_join_codes c
  where lower(trim(c.join_code)) = lower(trim(p_code))
  limit 1;

  if v_team_id is null then
    raise exception 'Deze teamcode is niet geldig.';
  end if;

  select tm.team_id into v_existing_team_id
  from public.team_members tm
  where tm.user_id = auth.uid();

  if v_existing_team_id is not null and v_existing_team_id <> v_team_id then
    raise exception 'Dit account is al aan een ander team gekoppeld.';
  end if;

  insert into public.team_members(user_id, team_id)
  values (auth.uid(), v_team_id)
  on conflict (user_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select tm.team_id into v_existing_team_id
    from public.team_members tm
    where tm.user_id = auth.uid();
    if v_existing_team_id <> v_team_id then
      raise exception 'Dit account is al aan een ander team gekoppeld.';
    end if;
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
  select tm.team_id into v_team_id
  from public.team_members tm
  where tm.user_id = auth.uid();

  if v_team_id is null then
    raise exception 'Koppel eerst je account aan een team.';
  end if;

  select task.points into v_points
  from public.tasks task
  join public.games game on game.id = task.game_id
  join public.teams team on team.id = v_team_id and team.game_id = task.game_id
  where task.id = p_task_id
    and task.active = true
    and game.status = 'active'
  limit 1;

  if v_points is null then
    raise exception 'Deze opdracht is niet beschikbaar.';
  end if;

  insert into public.claims(task_id, team_id, claimed_by, awarded_points)
  values (p_task_id, v_team_id, auth.uid(), v_points)
  on conflict (task_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'Deze opdracht is al geclaimd door een ander team.';
  end if;

  return query select v_points, v_team_id;
end;
$$;

-- Keep the earliest claim for each card, then enforce the new global rule.
with ranked_claims as (
  select id,
         row_number() over (partition by task_id order by claimed_at asc, id asc) as claim_rank
  from public.claims
)
delete from public.claims c
using ranked_claims r
where c.id = r.id and r.claim_rank > 1;

alter table public.claims drop constraint if exists claims_task_id_team_id_key;
alter table public.claims drop constraint if exists claims_task_id_key;
alter table public.claims add constraint claims_task_id_key unique (task_id);

drop policy if exists team_accounts_read_own on public.team_accounts;
revoke all on public.team_accounts from anon, authenticated;
drop table public.team_accounts;

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

commit;
