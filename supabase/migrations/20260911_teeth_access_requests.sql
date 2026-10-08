-- Private, verified-email access requests. No notification emails are sent.
begin;
create table if not exists public.teeth_access_requests (
  chart_id uuid not null references public.teeth_charts(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key(chart_id,requester_id)
);
create index if not exists teeth_access_requests_user_idx on public.teeth_access_requests(requester_id);
alter table public.teeth_access_requests enable row level security;
revoke all on public.teeth_access_requests from public,anon,authenticated;

create or replace function public.teeth_request_access(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e text;
begin
  select lower(email) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if e is null then raise exception 'Sign in with a verified email to request access' using errcode='42501'; end if;
  -- Identical response for missing and inaccessible IDs avoids an existence oracle.
  if not exists(select 1 from public.teeth_charts where id=p_id) then return '{"status":"requested"}'::jsonb; end if;
  if public.teeth_role(p_id) is not null then return '{"status":"has_access"}'::jsonb; end if;
  if exists(select 1 from public.teeth_access_requests where chart_id=p_id and requester_id=auth.uid()) then
    update public.teeth_access_requests set email=e where chart_id=p_id and requester_id=auth.uid() and email is distinct from e;
    return '{"status":"requested"}'::jsonb; end if;
  if (select count(*) from public.teeth_access_requests where requester_id=auth.uid())>=100 then raise exception 'Too many pending access requests'; end if;
  if (select count(*) from public.teeth_access_requests where chart_id=p_id)>=100 then return '{"status":"requested"}'::jsonb; end if;
  insert into public.teeth_access_requests(chart_id,requester_id,email) values(p_id,auth.uid(),e) on conflict do nothing;
  return '{"status":"requested"}'::jsonb;
end $$;
revoke all on function public.teeth_request_access(uuid) from public,anon,authenticated;
grant execute on function public.teeth_request_access(uuid) to authenticated;

create or replace function public.teeth_list_access_requests(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.teeth_role(p_id) is distinct from 'owner' then raise exception 'Only the owner can review requests' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id',r.requester_id,'email',r.email) order by r.created_at),'[]'::jsonb) into result
    from public.teeth_access_requests r join auth.users u on u.id=r.requester_id
    where r.chart_id=p_id and u.email_confirmed_at is not null and lower(u.email)=r.email;
  return result;
end $$;
revoke all on function public.teeth_list_access_requests(uuid) from public,anon,authenticated;
grant execute on function public.teeth_list_access_requests(uuid) to authenticated;

create or replace function public.teeth_resolve_access_request(p_id uuid,p_requester_id uuid,p_role text,p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.teeth_charts; e text;
begin
  select * into c from public.teeth_charts where id=p_id for update;
  if not found or c.owner_id is distinct from auth.uid() then raise exception 'Only the owner can review requests' using errcode='42501'; end if;
  if c.revision is distinct from p_revision then raise exception 'Sharing changed elsewhere. Reopen this dialog.' using errcode='40001'; end if;
  if p_role is null or p_role not in ('viewer','editor','dismiss') then raise exception 'Invalid access role'; end if;
  select r.email into e from public.teeth_access_requests r join auth.users u on u.id=r.requester_id
    where r.chart_id=p_id and r.requester_id=p_requester_id and lower(u.email)=r.email and u.email_confirmed_at is not null;
  if e is null then raise exception 'This request is no longer available'; end if;
  if p_role<>'dismiss' then
    if not exists(select 1 from public.teeth_chart_members where chart_id=p_id and email=e) and (select count(*) from public.teeth_chart_members where chart_id=p_id)>=100 then raise exception 'A chart can be shared with up to 100 people'; end if;
    insert into public.teeth_chart_members(chart_id,email,role) values(p_id,e,p_role) on conflict(chart_id,email) do update set role=excluded.role;
  end if;
  delete from public.teeth_access_requests where chart_id=p_id and requester_id=p_requester_id;
  update public.teeth_charts set revision=revision+1,updated_at=now() where id=p_id;
  return public.teeth_get_chart(p_id);
end $$;
revoke all on function public.teeth_resolve_access_request(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.teeth_resolve_access_request(uuid,uuid,text,integer) to authenticated;
commit;
