-- Add exact verified-email domain access without changing existing chart data.
begin;
alter table public.teeth_charts add column if not exists access_domain text;
alter table public.teeth_charts drop constraint if exists teeth_charts_general_access_check;
alter table public.teeth_charts add constraint teeth_charts_general_access_check check (general_access in ('restricted','anyone','domain'));
alter table public.teeth_charts drop constraint if exists teeth_charts_domain_check;
alter table public.teeth_charts add constraint teeth_charts_domain_check check (
  (general_access='domain' and access_domain is not null and char_length(access_domain)<=253
    and access_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$')
  or (general_access<>'domain' and access_domain is null)
);

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
  if c.general_access='domain' and e is not null and split_part(e,'@',2)=c.access_domain then return c.link_role; end if;
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
    'access_domain',case when r='owner' then c.access_domain else null end,
    'link_role',case when r='owner' then c.link_role else null end,'members',people);
end $$;
revoke all on function public.teeth_get_chart(uuid) from public,anon,authenticated;
grant execute on function public.teeth_get_chart(uuid) to anon,authenticated;

create or replace function public.teeth_set_sharing_v2(p_id uuid,p_general_access text,p_link_role text,p_members jsonb,p_revision integer,p_domain text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.teeth_charts; member jsonb; e text; owner_email text; domain_name text;
begin
  select * into c from public.teeth_charts where id=p_id for update;
  if not found or auth.uid() is null or c.owner_id<>auth.uid() then raise exception 'Only the owner can change sharing' using errcode='42501'; end if;
  if p_revision is distinct from c.revision then raise exception 'Sharing changed elsewhere. Reopen this dialog.' using errcode='40001'; end if;
  if p_general_access is null or p_general_access not in ('restricted','anyone','domain') or p_link_role is null or p_link_role not in ('viewer','editor') then raise exception 'Invalid sharing options'; end if;
  domain_name:=case when p_general_access='domain' then lower(trim(p_domain)) else null end;
  if p_general_access='domain' and (domain_name is null or char_length(domain_name)>253 or domain_name !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$') then raise exception 'Enter a valid domain, such as example.com'; end if;
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
  update public.teeth_charts set general_access=p_general_access,access_domain=domain_name,link_role=p_link_role,revision=revision+1,updated_at=now() where id=p_id;
  return public.teeth_get_chart(p_id);
end $$;
revoke all on function public.teeth_set_sharing_v2(uuid,text,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.teeth_set_sharing_v2(uuid,text,text,jsonb,integer,text) to authenticated;

-- Older tabs may still use the original RPC; retain it for a rolling deployment.
create or replace function public.teeth_set_sharing(p_id uuid,p_general_access text,p_link_role text,p_members jsonb,p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_general_access is null or p_general_access not in ('restricted','anyone') then raise exception 'Invalid sharing options'; end if;
  return public.teeth_set_sharing_v2(p_id,p_general_access,p_link_role,p_members,p_revision,null);
end $$;
revoke all on function public.teeth_set_sharing(uuid,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.teeth_set_sharing(uuid,text,text,jsonb,integer) to authenticated;
commit;
