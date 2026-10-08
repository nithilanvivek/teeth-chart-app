const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const owner='00000000-0000-4000-8000-000000000001';
const stranger='00000000-0000-4000-8000-000000000002';
const id='10000000-0000-4000-8000-000000000001';

test('inactivity warnings and deletion obey permissions, send receipts, grace periods and visits',async t=>{
  const db=new PGlite();
  const query=(sql,args=[])=>db.query(sql,args);
  const one=async(sql,args=[])=>(await query(sql,args)).rows[0];
  const admin=()=>db.exec('reset role');
  const as=async user=>{await admin();await query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec('set role '+(user?'authenticated':'anon'));};
  const run=async()=>{await admin();return (await one('select teeth_private.run_retention() as result')).result;};
  const notice=()=>one('select * from teeth_private.retention_notices where chart_id=$1',[id]);
  const exists=async()=>!!await one('select id from public.teeth_charts where id=$1',[id]);
  const get=()=>query('select public.teeth_get_chart($1)',[id]);
  const makeOld=async()=>{await admin();await query("update public.teeth_charts set last_viewed_at=now()-interval '13 months' where id=$1",[id]);};
  const receipt=async(status=200,content='{"id":"test-message"}')=>query('update extensions.outcome set status=$1,content=$2,fail=false',[status,content]);
  const retry=()=>query("update teeth_private.retention_notices set retry_after=now()-interval '1 minute' where chart_id=$1",[id]);
  const ageNotice=async days=>query(`update teeth_private.retention_notices set warned_at=now()-($1::int*interval '1 day'),delete_after=now()-($1::int*interval '1 day')+interval '28 days' where chart_id=$2`,[days,id]);
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated;
      create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);
      create schema extensions;
      create type extensions.http_header as (field text,value text);
      create type extensions.http_request as (method text,uri text,headers extensions.http_header[],content_type text,content text);
      create table extensions.outcome(status integer,content text,fail boolean default false);
      insert into extensions.outcome values(429,'{}',false);
      create table extensions.requests(id bigint generated always as identity,url text,body jsonb,headers jsonb);
      create function extensions.http(request extensions.http_request) returns table(status integer,content text) language plpgsql as $$begin
        if (select fail from extensions.outcome) then raise exception 'simulated transport timeout';end if;
        insert into extensions.requests(url,body,headers) values(request.uri,request.content::jsonb,(select jsonb_object_agg(h.field,h.value) from unnest(request.headers) h));
        return query select o.status,o.content from extensions.outcome o;
      end$$;
      insert into auth.users values('${owner}','owner@example.test',now()),('${stranger}','other@example.test',now());`);
    for(const name of ['20260909_teeth_charts','20260911_teeth_domain_sharing','20260911_teeth_access_requests','20260911_teeth_delete_chart','20260911_teeth_retention'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
    await as(owner);await query('select public.teeth_save_chart($1,$2,$3,$4,0)',[id,'Private patient chart',{}, {version:1,entries:[]}]);await admin();

    await t.test('existing/new charts have a fresh period and missing credentials do not queue or delete',async()=>{
      assert.ok(Date.now()-new Date((await one('select last_viewed_at from public.teeth_charts where id=$1',[id])).last_viewed_at)<5000);
      await makeOld();assert.equal((await run()).status,'missing_email_key');assert.equal(await notice(),undefined);assert.equal(await exists(),true);
      await db.exec("insert into vault.decrypted_secrets values('teeth_resend_api_key','test-only-key')");
      await query("update public.teeth_charts set last_viewed_at=now()-interval '12 months'+interval '1 day' where id=$1",[id]);
      assert.equal((await run()).attempted,0);
    });
    await t.test('only successful chart access resets activity, without changing revision',async()=>{
      await makeOld();const before=await one('select last_viewed_at,revision from public.teeth_charts where id=$1',[id]);
      await as(null);await assert.rejects(get,/access denied/);
      await assert.rejects(()=>query('select teeth_private.run_retention()'),/permission denied/);
      await as(stranger);await assert.rejects(get,/access denied/);await assert.rejects(()=>query('select * from teeth_private.retention_notices'),/permission denied/);
      await as(owner);await query('select public.teeth_list_charts()');await admin();assert.deepEqual(await one('select last_viewed_at,revision from public.teeth_charts where id=$1',[id]),before);
      await as(owner);await get();await admin();const after=await one('select last_viewed_at,revision from public.teeth_charts where id=$1',[id]);assert.ok(after.last_viewed_at>before.last_viewed_at);assert.equal(after.revision,before.revision);
    });
    await t.test('warning contains only the chart link, and failed sends cannot start deletion',async()=>{
      await makeOld();assert.equal((await run()).attempted,1);
      let n=await notice();assert.equal(n.warned_at,null);assert.equal(n.delete_after,null);
      const req=await one('select * from extensions.requests order by id desc limit 1');
      assert.equal(req.url,'https://api.resend.com/emails');assert.deepEqual(req.body.to,['owner@example.test']);
      assert.ok(req.body.html.includes('href="https://nithi.land/t/'+id+'"'));assert.match(req.body.text,/12 months/);assert.match(req.body.text,/4 weeks/);assert.ok(!JSON.stringify(req.body).includes('Private patient chart'));
      assert.equal((await run()).attempted,0);assert.equal(await exists(),true);
      await retry();assert.equal((await run()).attempted,1);const repeated=await one('select * from extensions.requests order by id desc limit 1');assert.equal(repeated.headers['Idempotency-Key'],req.headers['Idempotency-Key']);assert.deepEqual(repeated.body,req.body);
    });
    await t.test('accepted warning starts a full 28 days; repeated runs do not resend',async()=>{
      await receipt();await retry();assert.equal((await run()).warned,1);const n=await notice();assert.equal(new Date(n.delete_after)-new Date(n.warned_at),28*86400000);
      assert.equal((await run()).attempted,0);await ageNotice(27);await run();assert.equal(await exists(),true);
    });
    await t.test('an authorized visit cancels the warning and keeps a chart past its former deadline',async()=>{
      await as(owner);await get();await admin();assert.equal(await notice(),undefined);assert.equal((await run()).deleted,0);assert.equal(await exists(),true);
    });
    await t.test('public access also keeps a chart and cancels a pending deletion',async()=>{
      await query("update public.teeth_charts set general_access='anyone' where id=$1",[id]);await makeOld();await run();assert.ok((await notice()).warned_at);
      await as(null);await get();await admin();assert.equal(await notice(),undefined);
      await run();assert.equal(await notice(),undefined);assert.equal(await exists(),true);
    });
    await t.test('missing or malformed receipts fail safely and retry without deletion',async()=>{
      await makeOld();await db.exec('update extensions.outcome set fail=true');await run();assert.equal((await notice()).delete_after,null);assert.equal((await notice()).last_error,'send_unconfirmed');
      await retry();await receipt(200,'not JSON');await run();assert.equal((await notice()).delete_after,null);assert.equal(await exists(),true);
    });
    await t.test('email changes invalidate an old warning and require a new warning to the current address',async()=>{
      await retry();await receipt();await run();await ageNotice(29);
      await query('update auth.users set email=$1 where id=$2',['new@example.test',owner]);const result=await run();assert.equal(result.deleted,0);assert.equal(result.attempted,1);const n=await notice();assert.equal(n.owner_email,'new@example.test');assert.ok(new Date(n.delete_after)>new Date());
    });
    await t.test('after the full grace period, deletion also removes sharing, requests and notice',async()=>{
      await receipt();await run();await ageNotice(29);
      await query('insert into public.teeth_chart_members values($1,$2,$3)',[id,'other@example.test','viewer']);
      await query('insert into public.teeth_access_requests(chart_id,requester_id,email) values($1,$2,$3)',[id,stranger,'other@example.test']);
      assert.equal((await run()).deleted,1);assert.equal(await exists(),false);assert.equal(await notice(),undefined);
      assert.equal((await one('select count(*)::int as n from public.teeth_chart_members')).n,0);assert.equal((await one('select count(*)::int as n from public.teeth_access_requests')).n,0);
    });
  }finally{await db.close();}
});
