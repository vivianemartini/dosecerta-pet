-- DoseCerta Pet — esquema do banco (Supabase / Postgres)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run".
-- Pode rodar de novo sem problema: ele não apaga dados existentes.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------

-- Nome que aparece nos registros ("Ju deu às 20:05")
create table if not exists public.profiles (
  id   uuid primary key references auth.users on delete cascade,
  nick text check (char_length(nick) <= 30)
);

-- Uma "casa" agrupa pets e as pessoas que cuidam deles
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6)),
  created_by  uuid references auth.users on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'member' check (role in ('owner','member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.pets (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name         text not null check (char_length(name) between 1 and 40),
  species      text not null default 'cao' check (species in ('cao','gato','ave','roedor','coelho','outro')),
  color        text not null default 'laranja',
  photo        text,              -- imagem pequena (data URL, ~30 KB)
  created_at   timestamptz not null default now()
);

create table if not exists public.meds (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  pet_id       uuid not null references public.pets on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  dose         text,
  kind         text not null default 'daily' check (kind in ('daily','interval')),
  every_days   int  not null default 1 check (every_days between 1 and 365),
  times        text[] not null check (cardinality(times) between 1 and 12),
  start_date   date not null default current_date,
  end_date     date,
  notes        text,
  active       boolean not null default true,
  archived_on  date,
  created_at   timestamptz not null default now()
);

-- Cada dose programada (remédio + dia + horário) só pode ser registrada UMA vez.
-- É isso que impede dose duplicada, mesmo se duas pessoas tocarem ao mesmo tempo.
create table if not exists public.doses (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  med_id       uuid not null references public.meds on delete cascade,
  pet_id       uuid not null references public.pets on delete cascade,
  date         date not null,
  slot         text not null,          -- "08:00"
  given_by     uuid references auth.users on delete set null default auth.uid(),
  given_at     timestamptz not null default now(),
  note         text,
  skipped      boolean not null default false,
  late_entry   boolean not null default false,
  unique (med_id, date, slot)
);

create index if not exists doses_household_date on public.doses (household_id, date);
create index if not exists meds_household on public.meds (household_id);
create index if not exists pets_household on public.pets (household_id);

-- ---------------------------------------------------------------
-- Funções auxiliares (security definer evita recursão nas regras)
-- ---------------------------------------------------------------

create or replace function public.is_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_members where household_id = hid and user_id = auth.uid());
$$;

create or replace function public.shares_household(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from household_members a
    join household_members b on a.household_id = b.household_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

create or replace function public.create_household(p_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into households (name, created_by) values (trim(p_name), auth.uid()) returning * into h;
  insert into household_members (household_id, user_id, role) values (h.id, auth.uid(), 'owner');
  return h;
end $$;

create or replace function public.join_household(p_code text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into h from households where invite_code = upper(trim(p_code));
  if not found then raise exception 'codigo_invalido'; end if;
  insert into household_members (household_id, user_id) values (h.id, auth.uid())
    on conflict do nothing;
  return h;
end $$;

-- Gera um código novo (o antigo deixa de funcionar)
create or replace function public.reset_invite_code(hid uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare c text;
begin
  if not is_member(hid) then raise exception 'sem_permissao'; end if;
  c := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
  update households set invite_code = c where id = hid;
  return c;
end $$;

revoke all on function public.create_household(text)  from public, anon;
revoke all on function public.join_household(text)    from public, anon;
revoke all on function public.reset_invite_code(uuid) from public, anon;
grant execute on function public.create_household(text)  to authenticated;
grant execute on function public.join_household(text)    to authenticated;
grant execute on function public.reset_invite_code(uuid) to authenticated;

-- Projetos novos do Supabase não liberam as tabelas para a API sozinhos.
-- Só quem está logado acessa; o RLS abaixo limita a cada casa.
grant usage on schema public to authenticated;
grant execute on function public.is_member(uuid), public.shares_household(uuid) to authenticated;
grant select, insert, update, delete on
  public.profiles, public.households, public.household_members,
  public.pets, public.meds, public.doses
to authenticated;

-- ---------------------------------------------------------------
-- Regras de acesso (RLS): cada casa só vê os próprios dados
-- ---------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.pets              enable row level security;
alter table public.meds              enable row level security;
alter table public.doses             enable row level security;

drop policy if exists profiles_read  on public.profiles;
drop policy if exists profiles_write on public.profiles;
drop policy if exists profiles_upd   on public.profiles;
create policy profiles_read  on public.profiles for select using (id = auth.uid() or public.shares_household(id));
create policy profiles_write on public.profiles for insert with check (id = auth.uid());
create policy profiles_upd   on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists households_read on public.households;
drop policy if exists households_upd  on public.households;
create policy households_read on public.households for select using (public.is_member(id));
create policy households_upd  on public.households for update using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_read  on public.household_members;
drop policy if exists members_leave on public.household_members;
create policy members_read  on public.household_members for select using (public.is_member(household_id));
create policy members_leave on public.household_members for delete using (user_id = auth.uid());

drop policy if exists pets_all on public.pets;
create policy pets_all on public.pets for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));

drop policy if exists meds_all on public.meds;
create policy meds_all on public.meds for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));

drop policy if exists doses_read   on public.doses;
drop policy if exists doses_insert on public.doses;
drop policy if exists doses_delete on public.doses;
create policy doses_read   on public.doses for select using (public.is_member(household_id));
create policy doses_insert on public.doses for insert
  with check (public.is_member(household_id) and given_by = auth.uid());
create policy doses_delete on public.doses for delete using (public.is_member(household_id));

-- ---------------------------------------------------------------
-- Tempo real: quando a Ju marca, o celular da Maiara atualiza sozinho
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pets','meds','doses','household_members'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
