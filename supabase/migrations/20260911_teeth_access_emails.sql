-- Queue approval messages in the same transaction as the access grant.
begin;
create table if not exists teeth_private.access_emails (
  id uuid primary key default gen_random_uuid(),
  chart_id uuid not null references public.teeth_charts(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  kind text not null default 'approved' check(kind in ('requested','approved')),
  request_created_at timestamptz not null,
  access_role text not null check(access_role in ('viewer','editor')),
  created_at timestamptz not null default now(),
  retry_after timestamptz not null default now(),
  first_attempt_at timestamptz,
  finished_at timestamptz,
  provider_id text,
  last_error text,
  unique(chart_id,requester_id,kind,request_created_at)
);
create index if not exists teeth_access_email_pending_idx on teeth_private.access_emails(retry_after) where finished_at is null;
alter table teeth_private.access_emails enable row level security;
revoke all on teeth_private.access_emails from public,anon,authenticated;
create or replace function public.teeth_resolve_access_request(p_id uuid,p_requester_id uuid,p_role text,p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.teeth_charts; e text; requested_at timestamptz;
begin
  select * into c from public.teeth_charts where id=p_id for update;
  if not found or c.owner_id is distinct from auth.uid() then raise exception 'Only the owner can review requests' using errcode='42501'; end if;
  if c.deleted_at is not null then raise exception 'Deleted charts are read-only' using errcode='42501'; end if;
  if c.revision is distinct from p_revision then raise exception 'Sharing changed elsewhere. Reopen this dialog.' using errcode='40001'; end if;
  if p_role is null or p_role not in ('viewer','editor','dismiss') then raise exception 'Invalid access role'; end if;
  select r.email,r.created_at into e,requested_at from public.teeth_access_requests r join auth.users u on u.id=r.requester_id
    where r.chart_id=p_id and r.requester_id=p_requester_id and lower(u.email)=r.email and u.email_confirmed_at is not null;
  if e is null then raise exception 'This request is no longer available'; end if;
  if p_role<>'dismiss' then
    if not exists(select 1 from public.teeth_chart_members where chart_id=p_id and email=e) and (select count(*) from public.teeth_chart_members where chart_id=p_id)>=100 then raise exception 'A chart can be shared with up to 100 people'; end if;
    insert into public.teeth_chart_members(chart_id,email,role) values(p_id,e,p_role) on conflict(chart_id,email) do update set role=excluded.role;
  end if;
  if p_role<>'dismiss' then
    insert into teeth_private.access_emails(chart_id,requester_id,email,access_role,request_created_at) values(p_id,p_requester_id,e,p_role,requested_at) on conflict do nothing;
  end if;
  delete from public.teeth_access_requests where chart_id=p_id and requester_id=p_requester_id;
  update public.teeth_charts set revision=revision+1,updated_at=now() where id=p_id;
  return public.teeth_get_chart(p_id);
end $$;
revoke all on function public.teeth_resolve_access_request(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.teeth_resolve_access_request(uuid,uuid,text,integer) to authenticated;

-- Only the verified access-request RPC can insert into the source table.
create or replace function teeth_private.queue_access_request_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into teeth_private.access_emails(chart_id,requester_id,email,access_role,kind,request_created_at)
    select new.chart_id,new.requester_id,lower(u.email),'viewer','requested',new.created_at
    from public.teeth_charts t join auth.users u on u.id=t.owner_id
    where t.id=new.chart_id and t.deleted_at is null and u.email_confirmed_at is not null
    on conflict do nothing;
  return new;
end $$;
revoke all on function teeth_private.queue_access_request_email() from public,anon,authenticated;
drop trigger if exists teeth_access_request_email on public.teeth_access_requests;
create trigger teeth_access_request_email after insert on public.teeth_access_requests
  for each row execute function teeth_private.queue_access_request_email();
-- Notify owners about requests already waiting when this feature is installed.
insert into teeth_private.access_emails(chart_id,requester_id,email,access_role,kind,request_created_at)
  select r.chart_id,r.requester_id,lower(u.email),'viewer','requested',r.created_at
  from public.teeth_access_requests r join public.teeth_charts t on t.id=r.chart_id
  join auth.users u on u.id=t.owner_id join auth.users requester on requester.id=r.requester_id
  where t.deleted_at is null and u.email_confirmed_at is not null
    and requester.email_confirmed_at is not null and lower(requester.email)=r.email
  on conflict do nothing;

-- Private cron worker; slow mail delivery never holds up an approval in the UI.
create or replace function teeth_private.send_access_emails() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare api_key text; n record; reply record; current_email text; verified_at timestamptz; recipient_role text; response_body jsonb; payload jsonb;
  link text; sent integer:=0; attempted integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('teeth-access-emails',0)) then
    return jsonb_build_object('status','already_running');
  end if;
  delete from teeth_private.access_emails where finished_at<now()-interval '7 days';
  -- Never retry beyond the provider's 24-hour idempotency window. A missing key
  -- does not start that clock. Stop old unsent messages after seven days.
  update teeth_private.access_emails set finished_at=now(),last_error='delivery_unconfirmed'
    where finished_at is null and (first_attempt_at<now()-interval '23 hours' or created_at<now()-interval '7 days');
  select decrypted_secret into api_key from vault.decrypted_secrets where name='teeth_resend_api_key' limit 1;
  if nullif(trim(api_key),'') is null then return jsonb_build_object('status','missing_email_key'); end if;
  for n in select q.*,t.deleted_at,t.owner_id
    from teeth_private.access_emails q join public.teeth_charts t on t.id=q.chart_id
    where q.finished_at is null and q.retry_after<=now()
    order by q.created_at limit 5 for update of t,q skip locked
  loop
    select lower(u.email),u.email_confirmed_at into current_email,verified_at from auth.users u
      where u.id=case when n.kind='requested' then n.owner_id else n.requester_id end;
    select m.role into recipient_role from public.teeth_chart_members m where m.chart_id=n.chart_id and m.email=n.email;
    if n.deleted_at is not null or verified_at is null or current_email is distinct from n.email
      or (n.kind='approved' and recipient_role is distinct from n.access_role)
      or (n.kind='requested' and not exists(select 1 from public.teeth_access_requests r join auth.users u on u.id=r.requester_id
        where r.chart_id=n.chart_id and r.requester_id=n.requester_id and r.created_at=n.request_created_at
        and u.email_confirmed_at is not null and lower(u.email)=r.email)) then
      update teeth_private.access_emails set finished_at=now(),last_error='access_changed' where id=n.id;
      continue;
    end if;
    link:='https://nithi.land/t/'||n.chart_id::text;
    -- Immutable payload contains no owner/collaborator identity or chart notes.
    if n.kind='requested' then
      payload:=jsonb_build_object('from','Teeth Chart App <noreply@teeth.nithi.land>',
        'to',jsonb_build_array(n.email),'subject','Someone requested access to your Teeth Chart',
        'text','Someone requested access to a chart you own. Open the chart, then choose Share to review the request: '||link||E'\n\nYou can approve them as a viewer or editor, or dismiss the request. Sign in with the email address that received this message.',
        'html','<div style="font-family:Arial,sans-serif;max-width:520px;margin:32px auto;color:#243044;line-height:1.6"><h2>Someone requested access</h2><p>A new access request is waiting for a chart you own. Open your chart, then choose <strong>Share</strong> to review it.</p><p style="margin:28px 0"><a style="background:#087fff;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;display:inline-block" href="'||link||'">Review access request</a></p><p>You can approve them as a viewer or editor, or dismiss the request.</p><p>Sign in with the email address that received this message.</p><p style="font-size:13px">Or copy this link:<br><a href="'||link||'">'||link||'</a></p></div>');
    else
      payload:=jsonb_build_object('from','Teeth Chart App <noreply@teeth.nithi.land>',
        'to',jsonb_build_array(n.email),'subject','Your Teeth Chart access request was approved',
        'text','Your request to access a Teeth Chart has been approved. You now have '||n.access_role||' access. Open your chart: '||link||E'\n\nSign in with the email address that received this message.',
        'html','<div style="font-family:Arial,sans-serif;max-width:520px;margin:32px auto;color:#243044;line-height:1.6"><h2>Your access request was approved</h2><p>You now have <strong>'||n.access_role||'</strong> access to the chart you requested.</p><p style="margin:28px 0"><a style="background:#087fff;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;display:inline-block" href="'||link||'">Open chart</a></p><p>Sign in with the email address that received this message.</p><p style="font-size:13px">Or copy this link:<br><a href="'||link||'">'||link||'</a></p></div>');
    end if;
    attempted:=attempted+1;
    update teeth_private.access_emails set first_attempt_at=coalesce(first_attempt_at,now()),retry_after=now()+interval '5 minutes' where id=n.id;
    begin
      perform set_config('http.curlopt_timeout_ms','5000',true);
      perform set_config('http.curlopt_connecttimeout_ms','2000',true);
      select * into reply from extensions.http(('POST','https://api.resend.com/emails',
        array[row('Authorization','Bearer '||api_key)::extensions.http_header,
              row('Idempotency-Key','teeth-access-'||n.id::text)::extensions.http_header],
        'application/json',payload::text)::extensions.http_request);
      begin response_body:=reply.content::jsonb; exception when others then response_body:='{}'::jsonb; end;
      if reply.status between 200 and 299 and nullif(response_body->>'id','') is not null then
        update teeth_private.access_emails set finished_at=now(),provider_id=response_body->>'id',last_error=null where id=n.id;
        sent:=sent+1;
      else
        update teeth_private.access_emails set last_error='send_failed_'||coalesce(reply.status::text,'network') where id=n.id;
      end if;
    exception when others then
      update teeth_private.access_emails set last_error='send_unconfirmed' where id=n.id;
    end;
  end loop;
  return jsonb_build_object('status','ok','attempted',attempted,'sent',sent);
end $$;
revoke all on function teeth_private.send_access_emails() from public,anon,authenticated;
commit;
