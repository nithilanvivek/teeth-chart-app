begin;
alter table public.teeth_charts add column if not exists deleted_at timestamptz;
create index if not exists teeth_deleted_at_idx on public.teeth_charts(deleted_at) where deleted_at is not null;
create or replace function teeth_private.active_chart_role(p_id uuid) returns text
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
revoke all on function teeth_private.active_chart_role(uuid) from public,anon,authenticated;

create or replace function public.teeth_role(p_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare r text; removed timestamptz;
begin
  select deleted_at into removed from public.teeth_charts where id=p_id;
  if removed is not null and removed+interval '30 days'<=now() then return null; end if;
  r:=teeth_private.active_chart_role(p_id);
  if removed is not null and r is not null then return 'viewer'; end if;
  return r;
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
    'delete_after',c.deleted_at+interval '30 days','revision',c.revision,'access_role',r,'createdAt',c.created_at,'updatedAt',c.updated_at,
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
  if c.deleted_at is not null then raise exception 'Deleted charts are read-only' using errcode='42501'; end if;
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
create or replace function public.teeth_delete_chart(p_id uuid,p_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare c public.teeth_charts;
begin
  if auth.uid() is null then raise exception 'Sign in to delete a cloud chart' using errcode='42501'; end if;
  select * into c from public.teeth_charts where id=p_id for update;
  if not found then return; end if;
  if c.owner_id<>auth.uid() then raise exception 'Only the owner can delete this chart' using errcode='42501'; end if;
  if c.deleted_at is not null then return; end if;
  if p_revision is distinct from c.revision then raise exception 'This chart changed. Confirm deletion of the latest version.' using errcode='40001'; end if;
  update public.teeth_charts set deleted_at=now(),last_viewed_at=now(),revision=revision+1 where id=p_id;
  delete from teeth_private.retention_notices where chart_id=p_id;
end $$;
revoke all on function public.teeth_delete_chart(uuid,integer) from public,anon,authenticated;
grant execute on function public.teeth_delete_chart(uuid,integer) to authenticated;

create or replace function teeth_private.purge_deleted_charts() returns void
language sql security definer set search_path='' as $$
  delete from public.teeth_charts where deleted_at+interval '30 days'<=now();
$$;
revoke all on function teeth_private.purge_deleted_charts() from public,anon,authenticated;

create or replace function public.teeth_copy_chart(p_id uuid,p_new_id uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.teeth_charts;
begin
  if auth.uid() is null then raise exception 'Sign in to own a cloud copy' using errcode='42501'; end if;
  select * into c from public.teeth_charts where id=p_id for update;
  if public.teeth_role(p_id) is null then raise exception 'Chart unavailable or access denied' using errcode='42501'; end if;
  if p_new_id is null or p_new_id=p_id or p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'Invalid copy'; end if;
  insert into public.teeth_charts(id,owner_id,name,annotations,history)
    values(p_new_id,auth.uid(),trim(p_name),c.annotations,'{"version":1,"entries":[]}');
  return public.teeth_get_chart(p_new_id);
end $$;
revoke all on function public.teeth_copy_chart(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.teeth_copy_chart(uuid,uuid,text) to authenticated;

create table if not exists teeth_private.collaborator_suggestions(
  id uuid primary key default gen_random_uuid(),chart_id uuid not null references public.teeth_charts(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  email text not null,role text not null check(role in ('viewer','editor')),created_at timestamptz not null default now(),
  unique(chart_id,requester_id,email)
);
alter table teeth_private.collaborator_suggestions enable row level security;
revoke all on teeth_private.collaborator_suggestions from public,anon,authenticated;

create or replace function public.teeth_suggest_collaborator(p_id uuid,p_email text,p_role text) returns void
language plpgsql security definer set search_path='' as $$
declare e text:=lower(trim(p_email));r text;
begin
  perform 1 from public.teeth_charts where id=p_id and deleted_at is null for update;
  if not found then raise exception 'Chart unavailable' using errcode='42501'; end if;
  r:=public.teeth_role(p_id);
  if auth.uid() is null or r is null or r not in ('viewer','editor') then raise exception 'Sign in with viewing or editing access' using errcode='42501'; end if;
  if e is null or length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_role is null or p_role not in ('viewer','editor') then raise exception 'Enter an email and Viewer or Editor access'; end if;
  if (select count(*) from teeth_private.collaborator_suggestions where chart_id=p_id)>=100 then raise exception 'Too many pending requests'; end if;
  insert into teeth_private.collaborator_suggestions(chart_id,requester_id,email,role) values(p_id,auth.uid(),e,p_role)
    on conflict(chart_id,requester_id,email) do update set role=excluded.role;
end $$;
create or replace function public.teeth_list_suggestions(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if public.teeth_role(p_id) is distinct from 'owner' then raise exception 'Only the owner can review requests' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'role',role) order by created_at),'[]'::jsonb) from teeth_private.collaborator_suggestions where chart_id=p_id);
end $$;
create or replace function public.teeth_resolve_suggestion(p_id uuid,p_request uuid,p_approve boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare suggestion teeth_private.collaborator_suggestions;
begin
  perform 1 from public.teeth_charts where id=p_id for update;
  if public.teeth_role(p_id) is distinct from 'owner' then raise exception 'Only the owner can review requests' using errcode='42501'; end if;
  select * into suggestion from teeth_private.collaborator_suggestions where id=p_request and chart_id=p_id;
  if not found then raise exception 'Request is no longer available'; end if;
  if p_approve then
    if (select count(*) from public.teeth_chart_members where chart_id=p_id)>=100 and not exists(select 1 from public.teeth_chart_members where chart_id=p_id and email=suggestion.email) then raise exception 'A chart can be shared with up to 100 people'; end if;
    insert into public.teeth_chart_members(chart_id,email,role) values(p_id,suggestion.email,suggestion.role)
      on conflict(chart_id,email) do update set role=case when teeth_chart_members.role='editor' then 'editor' else excluded.role end;
    update public.teeth_charts set revision=revision+1,updated_at=now() where id=p_id;
  end if;
  delete from teeth_private.collaborator_suggestions where id=p_request;
  return public.teeth_get_chart(p_id);
end $$;
revoke all on function public.teeth_suggest_collaborator(uuid,text,text),public.teeth_list_suggestions(uuid),public.teeth_resolve_suggestion(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.teeth_suggest_collaborator(uuid,text,text),public.teeth_list_suggestions(uuid),public.teeth_resolve_suggestion(uuid,uuid,boolean) to authenticated;
create or replace function public.teeth_list_charts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e text; result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to view your charts' using errcode='42501'; end if;
  select lower(email) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'updatedAt',c.updated_at,'access_role',public.teeth_role(c.id)) order by c.updated_at desc),'[]'::jsonb) into result
  from public.teeth_charts c where c.deleted_at is null and (c.owner_id=auth.uid() or exists(select 1 from public.teeth_chart_members m where m.chart_id=c.id and m.email=e));
  return result;
end $$;
revoke all on function public.teeth_list_charts() from public,anon,authenticated;
grant execute on function public.teeth_list_charts() to authenticated;

commit;
