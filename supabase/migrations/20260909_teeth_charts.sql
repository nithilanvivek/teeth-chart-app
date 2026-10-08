begin;
create table if not exists public.teeth_charts (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  annotations jsonb not null default '{}'::jsonb,
  history jsonb not null default '{"version":1,"entries":[]}'::jsonb,
  general_access text not null default 'restricted' check (general_access in ('restricted','anyone')),
  link_role text not null default 'viewer' check (link_role in ('viewer','editor')),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.teeth_chart_members (
  chart_id uuid not null references public.teeth_charts(id) on delete cascade,
  email text not null,
  role text not null check (role in ('viewer','editor')),
  primary key (chart_id,email)
);
create index if not exists teeth_charts_owner_idx on public.teeth_charts(owner_id);
create index if not exists teeth_members_email_idx on public.teeth_chart_members(email);
alter table public.teeth_charts enable row level security;
alter table public.teeth_chart_members enable row level security;
-- No direct table access: UUID-scoped RPCs below enforce chart permissions.
-- In particular, public links do not grant permission to enumerate public charts.
revoke all on public.teeth_charts,public.teeth_chart_members from public,anon,authenticated;

create or replace function public.teeth_role(p_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare c public.teeth_charts; e text; r text;
begin
  select * into c from public.teeth_charts where id=p_id;
  if not found then return null; end if;
  if c.owner_id=auth.uid() then return 'owner'; end if;
  select lower(email) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select role into r from public.teeth_chart_members where chart_id=p_id and email=e;
  if r='editor' then return r; end if;
  if c.general_access='anyone' then
    if c.link_role='editor' and auth.uid() is not null then return 'editor'; end if;
    return 'viewer';
  end if;
  return r;
end $$;
revoke all on function public.teeth_role(uuid) from public,anon,authenticated;

create or replace function public.teeth_get_chart(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.teeth_charts; r text; people jsonb;
begin
  r:=public.teeth_role(p_id);
  if r is null then raise exception 'Chart unavailable or access denied' using errcode='42501'; end if;
  select * into c from public.teeth_charts where id=p_id;
  if r='owner' then
    select coalesce(jsonb_agg(jsonb_build_object('email',email,'role',role) order by email),'[]'::jsonb) into people from public.teeth_chart_members where chart_id=p_id;
  end if;
  return jsonb_build_object('id',c.id,'name',c.name,'annotations',c.annotations,
    'history',case when r in ('owner','editor') then c.history else '{"version":1,"entries":[]}'::jsonb end,
    'revision',c.revision,'access_role',r,'createdAt',c.created_at,'updatedAt',c.updated_at,
    'general_access',case when r='owner' then c.general_access else null end,
    'link_role',case when r='owner' then c.link_role else null end,'members',people);
end $$;
revoke all on function public.teeth_get_chart(uuid) from public,anon,authenticated;
grant execute on function public.teeth_get_chart(uuid) to anon,authenticated;

create or replace function public.teeth_list_charts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e text; result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to view your charts' using errcode='42501'; end if;
  select lower(email) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'updatedAt',c.updated_at,'access_role',public.teeth_role(c.id)) order by c.updated_at desc),'[]'::jsonb) into result
  from public.teeth_charts c where c.owner_id=auth.uid() or exists(select 1 from public.teeth_chart_members m where m.chart_id=c.id and m.email=e);
  return result;
end $$;
revoke all on function public.teeth_list_charts() from public,anon,authenticated;
grant execute on function public.teeth_list_charts() to authenticated;

create or replace function public.teeth_save_chart(p_id uuid,p_name text,p_annotations jsonb,p_history jsonb,p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.teeth_charts; r text;
begin
  if auth.uid() is null then raise exception 'Sign in to save a chart' using errcode='42501'; end if;
  if p_id is null or p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'Invalid chart name'; end if;
  if p_annotations is null or jsonb_typeof(p_annotations)<>'object' or octet_length(p_annotations::text)>1000000 then raise exception 'Invalid annotations'; end if;
  if exists(select 1 from jsonb_each(p_annotations) a where a.key !~ '^(upper|lower)_(tooth|space)_([1-9]|1[0-6])$' or jsonb_typeof(a.value)<>'object') then raise exception 'Invalid chart positions'; end if;
  if p_history is null or jsonb_typeof(p_history)<>'object' or p_history->>'version' is distinct from '1' or jsonb_typeof(p_history->'entries') is distinct from 'array' then raise exception 'Invalid history'; end if;
  if jsonb_array_length(p_history->'entries')>64 or octet_length(p_history::text)>8000000 then raise exception 'Chart history is too large'; end if;
  select * into c from public.teeth_charts where id=p_id for update;
  if found then
    r:=public.teeth_role(p_id);
    if r is null or r not in ('owner','editor') then raise exception 'You do not have edit access' using errcode='42501'; end if;
    if p_revision is distinct from c.revision then raise exception 'A newer version exists. Reload before saving.' using errcode='40001'; end if;
    update public.teeth_charts set name=trim(p_name),annotations=p_annotations,history=p_history,revision=revision+1,updated_at=now() where id=p_id;
  else
    if p_revision is distinct from 0 then raise exception 'Chart unavailable or access denied' using errcode='42501'; end if;
    insert into public.teeth_charts(id,owner_id,name,annotations,history) values(p_id,auth.uid(),trim(p_name),p_annotations,p_history);
  end if;
  return public.teeth_get_chart(p_id);
end $$;
revoke all on function public.teeth_save_chart(uuid,text,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.teeth_save_chart(uuid,text,jsonb,jsonb,integer) to authenticated;

create or replace function public.teeth_set_sharing(p_id uuid,p_general_access text,p_link_role text,p_members jsonb,p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.teeth_charts; member jsonb; e text; owner_email text;
begin
  select * into c from public.teeth_charts where id=p_id for update;
  if not found or auth.uid() is null or c.owner_id<>auth.uid() then raise exception 'Only the owner can change sharing' using errcode='42501'; end if;
  if p_revision is distinct from c.revision then raise exception 'Sharing changed elsewhere. Reopen this dialog.' using errcode='40001'; end if;
  if p_general_access is null or p_general_access not in ('restricted','anyone') or p_link_role is null or p_link_role not in ('viewer','editor') then raise exception 'Invalid sharing options'; end if;
  if p_members is null or jsonb_typeof(p_members)<>'array' then raise exception 'Invalid people list'; end if;
  if jsonb_array_length(p_members)>100 then raise exception 'A chart can be shared with up to 100 people'; end if;
  select lower(email) into owner_email from auth.users where id=c.owner_id;
  for member in select * from jsonb_array_elements(p_members) loop
    e:=lower(trim(member->>'email'));
    if e is null or char_length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or member->>'role' is null or member->>'role' not in ('viewer','editor') then raise exception 'Enter a valid email and role'; end if;
  end loop;
  delete from public.teeth_chart_members where chart_id=p_id;
  for member in select * from jsonb_array_elements(p_members) loop
    e:=lower(trim(member->>'email'));
    if e<>owner_email then insert into public.teeth_chart_members(chart_id,email,role) values(p_id,e,member->>'role') on conflict(chart_id,email) do update set role=excluded.role; end if;
  end loop;
  update public.teeth_charts set general_access=p_general_access,link_role=p_link_role,revision=revision+1,updated_at=now() where id=p_id;
  return public.teeth_get_chart(p_id);
end $$;
revoke all on function public.teeth_set_sharing(uuid,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.teeth_set_sharing(uuid,text,text,jsonb,integer) to authenticated;
commit;
