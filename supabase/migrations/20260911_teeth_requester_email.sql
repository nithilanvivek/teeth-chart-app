-- Add requester identity only to the chart owner's request notification.
begin;
alter table teeth_private.access_emails add column if not exists requester_email text;
-- Leave attempted messages unchanged to preserve provider idempotency payloads.
update teeth_private.access_emails q set requester_email=r.email
  from public.teeth_access_requests r
  where q.kind='requested' and q.finished_at is null and q.first_attempt_at is null
    and q.chart_id=r.chart_id and q.requester_id=r.requester_id and q.request_created_at=r.created_at;
create or replace function teeth_private.queue_access_request_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into teeth_private.access_emails(chart_id,requester_id,email,access_role,kind,request_created_at,requester_email)
    select new.chart_id,new.requester_id,lower(u.email),'viewer','requested',new.created_at,new.email
    from public.teeth_charts t join auth.users u on u.id=t.owner_id
    where t.id=new.chart_id and t.deleted_at is null and u.email_confirmed_at is not null
    on conflict do nothing;
  return new;
end $$;
revoke all on function teeth_private.queue_access_request_email() from public,anon,authenticated;
create or replace function teeth_private.send_access_emails() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare api_key text; n record; reply record; current_email text; verified_at timestamptz; recipient_role text; response_body jsonb; payload jsonb;
  link text; requester_html text; sent integer:=0; attempted integer:=0;
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
    -- The owner sees the requester address; chart content and other collaborators stay private.
    if n.kind='requested' then
      requester_html:=replace(replace(replace(replace(replace(coalesce(n.requester_email,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;');
      payload:=jsonb_build_object('from','Teeth Chart App <noreply@teeth.nithi.land>',
        'to',jsonb_build_array(n.email),'subject','Someone requested access to your Teeth Chart',
        'text',case when n.requester_email is null then 'Someone' else n.requester_email end||' requested access to a chart you own. Open the chart, then choose Share to review the request: '||link||E'\n\nYou can approve them as a viewer or editor, or dismiss the request. Sign in with the email address that received this message.',
        'html','<div style="font-family:Arial,sans-serif;max-width:520px;margin:32px auto;color:#243044;line-height:1.6"><h2>Someone requested access</h2>'||case when n.requester_email is null then '' else '<p><strong>Requested by:</strong> '||requester_html||'</p>' end||'<p>A new access request is waiting for a chart you own. Open your chart, then choose <strong>Share</strong> to review it.</p><p style="margin:28px 0"><a style="background:#087fff;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;display:inline-block" href="'||link||'">Review access request</a></p><p>You can approve them as a viewer or editor, or dismiss the request.</p><p>Sign in with the email address that received this message.</p><p style="font-size:13px">Or copy this link:<br><a href="'||link||'">'||link||'</a></p></div>');
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
