-- Track authorized chart views; warn owners before removing inactive cloud charts.
-- Existing charts start a fresh twelve-month period when this migration runs.
begin;
create schema if not exists teeth_private;
revoke all on schema teeth_private from public,anon,authenticated;
alter table public.teeth_charts add column if not exists last_viewed_at timestamptz not null default now();
create index if not exists teeth_charts_last_viewed_idx on public.teeth_charts(last_viewed_at);
create table if not exists teeth_private.retention_notices (
  chart_id uuid primary key references public.teeth_charts(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  inactive_since timestamptz not null,
  owner_email text not null,
  retry_after timestamptz not null default now(),
  warned_at timestamptz,
  delete_after timestamptz,
  provider_id text,
  last_error text,
  check ((warned_at is null and delete_after is null) or
    (warned_at is not null and delete_after >= warned_at + interval '28 days'))
);
alter table teeth_private.retention_notices enable row level security;
revoke all on teeth_private.retention_notices from public,anon,authenticated;

create or replace function public.teeth_get_chart(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c public.teeth_charts; r text; people jsonb;
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

-- Scheduler-only worker. It cannot be called through the public browser API.
-- Requires the http extension plus a Vault secret named teeth_resend_api_key.
-- Synchronous HTTP keeps Authorization headers out of shared transport tables.
create or replace function teeth_private.run_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  api_key text; c record; n teeth_private.retention_notices; reply record;
  reply_body jsonb; chart_link text; email_body jsonb; sent_at timestamptz;
  warned integer:=0; removed integer:=0; attempted integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('teeth-chart-retention',0)) then
    return jsonb_build_object('status','already_running');
  end if;
  select decrypted_secret into api_key from vault.decrypted_secrets where name='teeth_resend_api_key' limit 1;
  if nullif(trim(api_key),'') is null then
    return jsonb_build_object('status','missing_email_key');
  end if;

  -- Always lock chart first, matching teeth_get_chart and owner deletion.
  for c in
    select t.id,t.last_viewed_at,u.email,u.email_confirmed_at
    from public.teeth_charts t join teeth_private.retention_notices r on r.chart_id=t.id
    join auth.users u on u.id=t.owner_id
    where r.delete_after<=now()
      or r.owner_email is distinct from u.email or u.email_confirmed_at is null
      or r.inactive_since<>t.last_viewed_at
    order by r.retry_after limit 100 for update of t skip locked
  loop
    select * into n from teeth_private.retention_notices where chart_id=c.id;
    if n.owner_email is distinct from c.email or c.email_confirmed_at is null
      or n.inactive_since<>c.last_viewed_at then
      delete from teeth_private.retention_notices where chart_id=c.id;
      continue;
    end if;
    if n.warned_at is not null and n.delete_after<=now()
      and c.last_viewed_at<=now()-interval '12 months' and c.last_viewed_at=n.inactive_since then
      delete from public.teeth_charts where id=c.id;
      removed:=removed+1;
    end if;
  end loop;

  -- One warning per run avoids bursts; provider quota failures retry later.
  -- The payload and idempotency key remain unchanged across retries.
  for c in
    select t.id,t.last_viewed_at,u.email from public.teeth_charts t
    join auth.users u on u.id=t.owner_id
    left join teeth_private.retention_notices r on r.chart_id=t.id
    where t.last_viewed_at<=now()-interval '12 months' and u.email_confirmed_at is not null
      and u.email is not null and u.email<>''
      and (r.chart_id is null or (r.warned_at is null and r.retry_after<=now()))
    order by coalesce(r.retry_after,t.last_viewed_at),t.id limit 1 for update of t skip locked
  loop
    insert into teeth_private.retention_notices(chart_id,inactive_since,owner_email)
      values(c.id,c.last_viewed_at,c.email) on conflict(chart_id) do nothing;
    select * into n from teeth_private.retention_notices where chart_id=c.id;
    chart_link:='https://nithi.land/t/'||c.id::text;
    email_body:=jsonb_build_object(
      'from','Teeth Chart App <noreply@teeth.nithi.land>',
      'to',jsonb_build_array(n.owner_email),
      'subject','Open your Teeth Chart to keep it',
      'text','A chart you own has not been viewed for 12 months. It will be permanently deleted in 4 weeks unless you visit it. Open the chart to keep it: '||chart_link||E'\n\nSign in with this email address if asked. Opening the chart cancels deletion and restarts its 12-month inactivity period. Your chart and its history will be removed if nobody with access opens it within 4 weeks.',
      'html','<div style="font-family:Arial,sans-serif;max-width:520px;margin:32px auto;color:#243044;line-height:1.6"><h2>Keep your Teeth Chart</h2><p>A chart you own has not been viewed for <strong>12 months</strong>. It will be permanently deleted in <strong>4 weeks</strong> unless you visit it.</p><p style="margin:28px 0"><a style="background:#087fff;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;display:inline-block" href="'||chart_link||'">Open chart and keep it</a></p><p>Sign in with this email address if asked. Opening the chart cancels deletion and restarts its 12-month inactivity period.</p><p>Your chart and its history will be removed if nobody with access opens it within 4 weeks.</p><p style="font-size:13px">Or copy this link:<br><a href="'||chart_link||'">'||chart_link||'</a></p></div>'
    );
    attempted:=attempted+1;
    begin
      perform set_config('http.curlopt_timeout_ms','5000',true);
      perform set_config('http.curlopt_connecttimeout_ms','2000',true);
      select * into reply from extensions.http(('POST','https://api.resend.com/emails',
        array[row('Authorization','Bearer '||api_key)::extensions.http_header,
              row('Idempotency-Key','teeth-retention-'||n.id::text)::extensions.http_header],
        'application/json',email_body::text)::extensions.http_request);
      begin reply_body:=reply.content::jsonb; exception when others then reply_body:='{}'::jsonb; end;
      if reply.status between 200 and 299 and nullif(reply_body->>'id','') is not null then
        sent_at:=clock_timestamp();
        update teeth_private.retention_notices set warned_at=sent_at,delete_after=sent_at+interval '28 days',
          provider_id=reply_body->>'id',last_error=null where chart_id=c.id;
        warned:=warned+1;
      else
        update teeth_private.retention_notices set retry_after=now()+interval '1 hour',
          last_error='send_failed_'||coalesce(reply.status::text,'network') where chart_id=c.id;
      end if;
    exception when others then
      -- No positive send receipt means no deletion deadline. Never log headers.
      update teeth_private.retention_notices set retry_after=now()+interval '1 hour',last_error='send_unconfirmed' where chart_id=c.id;
    end;
  end loop;
  return jsonb_build_object('status','ok','attempted',attempted,'warned',warned,'deleted',removed);
end $$;
revoke all on function teeth_private.run_retention() from public,anon,authenticated;
commit;
