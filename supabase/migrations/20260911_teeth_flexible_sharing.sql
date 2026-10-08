-- Independent domain roles and explicit anonymous link editing. Existing links keep their permissions.
begin;
alter table public.teeth_charts add column if not exists anonymous_edit boolean not null default false;
create table if not exists public.teeth_chart_domains (
  chart_id uuid not null references public.teeth_charts(id) on delete cascade,
  domain text not null check (char_length(domain)<=253 and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'),
  role text not null check (role in ('viewer','editor')),
  primary key(chart_id,domain)
);
alter table public.teeth_chart_domains enable row level security;
revoke all on public.teeth_chart_domains from public,anon,authenticated;
insert into public.teeth_chart_domains(chart_id,domain,role)
  select id,access_domain,link_role from public.teeth_charts where general_access='domain'
  on conflict do nothing;

create or replace function public.teeth_role(p_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare c public.teeth_charts; e text; r text; d text;
begin
  select * into c from public.teeth_charts where id=p_id;
  if not found then return null; end if;
  if c.owner_id=auth.uid() then return 'owner'; end if;
  select lower(email) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select role into r from public.teeth_chart_members where chart_id=p_id and email=e;
  select role into d from public.teeth_chart_domains where chart_id=p_id and domain=split_part(e,'@',2);
  -- Combine grants: a named viewer never downgrades a domain/public editor.
  if r='editor' or d='editor' then return 'editor'; end if;
  if c.general_access='anyone' then
    if c.link_role='editor' and (c.anonymous_edit or e is not null) then return 'editor'; end if;
    return 'viewer';
  end if;
  return coalesce(r,d);
end $$;
revoke all on function public.teeth_role(uuid) from public,anon,authenticated;

create or replace function public.teeth_get_chart(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.teeth_charts; r text; people jsonb; domains jsonb;
begin
  -- Serialize visits against deletion and sharing changes. Failed access checks
  -- do not update activity; the library listing never calls this function.
  select * into c from public.teeth_charts where id=p_id for update;
  r:=public.teeth_role(p_id);
  if r is null then raise exception 'Chart unavailable or access denied' using errcode='42501'; end if;
  update public.teeth_charts set last_viewed_at=now() where id=p_id;
  delete from teeth_private.retention_notices where chart_id=p_id;
  if r='owner' then
    select coalesce(jsonb_agg(jsonb_build_object('email',email,'role',role) order by email),'[]'::jsonb) into people from public.teeth_chart_members where chart_id=p_id;
    select coalesce(jsonb_agg(jsonb_build_object('domain',domain,'role',role) order by domain),'[]'::jsonb) into domains from public.teeth_chart_domains where chart_id=p_id;
  end if;
  return jsonb_build_object('id',c.id,'name',c.name,'annotations',c.annotations,
    'history',case when r in ('owner','editor') then c.history else '{"version":1,"entries":[]}'::jsonb end,
    'revision',c.revision,'access_role',r,'createdAt',c.created_at,'updatedAt',c.updated_at,
    'general_access',case when r='owner' then c.general_access else null end,
    'access_domain',case when r='owner' then c.access_domain else null end,
    'domain_rules',domains,'anonymous_edit',c.general_access='anyone' and c.link_role='editor' and c.anonymous_edit,
    'link_role',case when r='owner' then c.link_role else null end,'members',people);
end $$;
revoke all on function public.teeth_get_chart(uuid) from public,anon,authenticated;
grant execute on function public.teeth_get_chart(uuid) to anon,authenticated;

create or replace function public.teeth_set_sharing_v3(p_id uuid,p_general_access text,p_link_role text,p_members jsonb,p_revision integer,p_domains jsonb,p_anonymous_edit boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.teeth_charts; member jsonb; e text; owner_email text; domain_name text; rule jsonb;
begin
  select * into c from public.teeth_charts where id=p_id for update;
  if not found or auth.uid() is null or c.owner_id<>auth.uid() then raise exception 'Only the owner can change sharing' using errcode='42501'; end if;
  if p_revision is distinct from c.revision then raise exception 'Sharing changed elsewhere. Reopen this dialog.' using errcode='40001'; end if;
  if p_general_access is null or p_general_access not in ('restricted','anyone','domain') or p_link_role is null or p_link_role not in ('viewer','editor') then raise exception 'Invalid sharing options'; end if;
  if p_domains is null or jsonb_typeof(p_domains)<>'array' or jsonb_array_length(p_domains)>100 then raise exception 'Use up to 100 domain rules'; end if;
  if p_general_access='domain' and jsonb_array_length(p_domains)=0 then raise exception 'Add at least one domain'; end if;
  if p_general_access='restricted' and jsonb_array_length(p_domains)>0 then raise exception 'Restricted access cannot include domains'; end if;
  if p_anonymous_edit is null or (p_anonymous_edit and (p_general_access<>'anyone' or p_link_role<>'editor')) then raise exception 'Anonymous editing requires anyone with the link to be an editor'; end if;
  for rule in select * from jsonb_array_elements(p_domains) loop
    domain_name:=lower(trim(rule->>'domain'));
    if domain_name is null or char_length(domain_name)>253 or domain_name !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' or rule->>'role' is null or rule->>'role' not in ('viewer','editor') then raise exception 'Enter a valid domain and role'; end if;
  end loop;
  if (select count(distinct lower(trim(value->>'domain'))) from jsonb_array_elements(p_domains))<>jsonb_array_length(p_domains) then raise exception 'Use each domain only once'; end if;
  domain_name:=case when p_general_access='domain' then lower(trim(p_domains->0->>'domain')) else null end;
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
  update public.teeth_charts set general_access=p_general_access,access_domain=domain_name,link_role=p_link_role,anonymous_edit=p_anonymous_edit,revision=revision+1,updated_at=now() where id=p_id;
  delete from public.teeth_chart_domains where chart_id=p_id;
  for rule in select * from jsonb_array_elements(p_domains) loop
    insert into public.teeth_chart_domains(chart_id,domain,role) values(p_id,lower(trim(rule->>'domain')),rule->>'role');
  end loop;
  return public.teeth_get_chart(p_id);
end $$;
revoke all on function public.teeth_set_sharing_v3(uuid,text,text,jsonb,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.teeth_set_sharing_v3(uuid,text,text,jsonb,integer,jsonb,boolean) to authenticated;

-- Old tabs must not silently remove rules they cannot display.
create or replace function public.teeth_set_sharing_v2(p_id uuid,p_general_access text,p_link_role text,p_members jsonb,p_revision integer,p_domain text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.teeth_charts;
begin
  select * into c from public.teeth_charts where id=p_id for update;
  if not found or c.owner_id is distinct from auth.uid() then raise exception 'Only the owner can change sharing' using errcode='42501'; end if;
  if c.anonymous_edit or (select count(*) from public.teeth_chart_domains where chart_id=p_id)>1
    or (c.general_access='anyone' and exists(select 1 from public.teeth_chart_domains where chart_id=p_id)) then
    raise exception 'Refresh the app to manage these sharing options';
  end if;
  return public.teeth_set_sharing_v3(p_id,p_general_access,p_link_role,p_members,p_revision,
    case when p_general_access='domain' then jsonb_build_array(jsonb_build_object('domain',p_domain,'role',p_link_role)) else '[]'::jsonb end,false);
end $$;
revoke all on function public.teeth_set_sharing_v2(uuid,text,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.teeth_set_sharing_v2(uuid,text,text,jsonb,integer,text) to authenticated;

create or replace function public.teeth_save_chart(p_id uuid,p_name text,p_annotations jsonb,p_history jsonb,p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.teeth_charts; r text;
begin
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
    if auth.uid() is null then raise exception 'Sign in to create a cloud chart' using errcode='42501'; end if;
    if p_revision is distinct from 0 then raise exception 'Chart unavailable or access denied' using errcode='42501'; end if;
    insert into public.teeth_charts(id,owner_id,name,annotations,history) values(p_id,auth.uid(),trim(p_name),p_annotations,p_history);
  end if;
  return public.teeth_get_chart(p_id);
end $$;
revoke all on function public.teeth_save_chart(uuid,text,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.teeth_save_chart(uuid,text,jsonb,jsonb,integer) to anon,authenticated;

commit;
