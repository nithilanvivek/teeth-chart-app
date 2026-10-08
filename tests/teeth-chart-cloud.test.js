const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {Store,STORAGE_KEY}=require('../tools/teeth-chart/model.js');
const {packHistory,unpackHistory,signature,validDomain,normalizeDomain}=require('../tools/teeth-chart/cloud.js');
function memoryStorage(){const data=new Map();return{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
test('64 newest entries survive trimming, persistence and compact JSON reconstruction',()=>{
  const storage=memoryStorage(),store=new Store(storage);
  for(let i=1;i<=90;i++)store.annotate('upper_tooth_1',{status:'milk',note:String(i)});
  assert.equal(store.current.history.length,64);
  assert.equal(store.current.history[0].snapshot.upper_tooth_1.note,'90');
  assert.equal(store.current.history[63].snapshot.upper_tooth_1.note,'27');
  const packed=packHistory(store.current.history);
  assert.deepEqual(unpackHistory(JSON.parse(JSON.stringify(packed))),store.current.history);
  assert.deepEqual(new Store(storage).current.history,store.current.history);
  store.remove('upper_tooth_1');
  assert.deepEqual(unpackHistory(packHistory(store.current.history)),store.current.history);
  assert.equal(store.current.history[63].snapshot.upper_tooth_1.note,'28');
  store.restore(store.current.history[63]);assert.equal(store.current.annotations.upper_tooth_1.note,'28');
  assert.equal(store.current.history.length,64);
  const raw=JSON.parse(storage.getItem(STORAGE_KEY));raw.charts[0].history.push(...raw.charts[0].history);
  storage.setItem(STORAGE_KEY,JSON.stringify(raw));assert.equal(new Store(storage).current.history.length,64);
});
test('JSONB key ordering does not change cloud signatures',()=>{
  const store=new Store(memoryStorage());store.annotate('upper_tooth_1',{status:'milk',note:'hello'});
  const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,sorted(value[key])])):value;
  assert.equal(signature(store.current),signature(sorted(store.current)));
});
test('database permissions enforce restricted, public, viewer, editor and owner access',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated;
      insert into auth.users values ('00000000-0000-4000-8000-000000000001','owner@example.test',now()),('00000000-0000-4000-8000-000000000002','viewer@example.test',now()),('00000000-0000-4000-8000-000000000003','editor@example.test',now()),('00000000-0000-4000-8000-000000000004','stranger@example.test',now());`);
    await db.exec(readFileSync('supabase/migrations/20260909_teeth_charts.sql','utf8'));
    await db.exec(readFileSync('supabase/migrations/20260911_teeth_domain_sharing.sql','utf8'));
    await db.exec(readFileSync('supabase/migrations/20260911_teeth_access_requests.sql','utf8'));
    await db.exec(readFileSync('supabase/migrations/20260911_teeth_delete_chart.sql','utf8'));
    await db.exec(readFileSync('supabase/migrations/20260911_teeth_retention.sql','utf8'));
    const id='10000000-0000-4000-8000-000000000001';
    const as=async who=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who?'00000000-0000-4000-8000-'+String(who).padStart(12,'0'):'']);await db.exec('set role '+(who?'authenticated':'anon'));};
    const get=async()=> (await db.query('select public.teeth_get_chart($1) as chart',[id])).rows[0].chart;
    const save=async(rev=1,history={version:1,entries:[]})=>(await db.query('select public.teeth_save_chart($1,$2,$3,$4,$5) as chart',[id,'Chart',{},history,rev])).rows[0].chart;
    const share=async(general,role,rev)=>(await db.query('select public.teeth_set_sharing($1,$2,$3,$4,$5) as chart',[id,general,role,[{email:'viewer@example.test',role:'viewer'},{email:'editor@example.test',role:'editor'}],rev])).rows[0].chart;
    await as(1);let chart=await save(0);assert.equal(chart.access_role,'owner');assert.equal(chart.general_access,'restricted');
    await assert.rejects(()=>db.exec('select * from public.teeth_charts'),/permission denied/);
    await as(null);await assert.rejects(get,/access denied/);await assert.rejects(save,/permission denied/);
    await as(4);await assert.rejects(get,/access denied/);await assert.rejects(save,/edit access/);assert.deepEqual((await db.query('select public.teeth_list_charts() as charts')).rows[0].charts,[]);
    await as(1);chart=await share('restricted','viewer',1);assert.equal(chart.revision,2);
    await as(2);chart=await get();assert.equal(chart.access_role,'viewer');assert.equal(chart.members,null);assert.deepEqual(chart.history.entries,[]);await assert.rejects(()=>save(2),/edit access/);await assert.rejects(()=>share('anyone','viewer',2),/Only the owner/);
    await as(3);chart=await save(2);assert.equal(chart.revision,3);await assert.rejects(()=>save(2),/newer version/);
    await as(1);await share('anyone','viewer',3);
    await as(null);chart=await get();assert.equal(chart.access_role,'viewer');await assert.rejects(()=>db.exec('select * from public.teeth_charts'),/permission denied/);await assert.rejects(()=>db.exec('select public.teeth_list_charts()'),/permission denied/);
    await as(1);await share('anyone','editor',4);
    await as(null);assert.equal((await get()).access_role,'viewer');
    await as(4);assert.equal((await get()).access_role,'editor');chart=await save(5);assert.equal(chart.revision,6);
    await as(1);await assert.rejects(()=>save(6,{version:1,entries:Array(65).fill({})}),/history is too large/);await share('restricted','viewer',6);
    await as(null);await assert.rejects(get,/access denied/);
    await as(4);await assert.rejects(get,/access denied/);
    const domainShare=async(domain,role='viewer',rev=7,members=[])=>(await db.query('select public.teeth_set_sharing_v2($1,$2,$3,$4,$5,$6) as chart',[id,'domain',role,members,rev,domain])).rows[0].chart;
    await assert.rejects(()=>domainShare('example.test'),/Only the owner/);
    await as(1);
    for(const domain of ['',null,'https://example.test','@example.test','example.test/path','-bad.test','bad..test','a'.repeat(64)+'.test'])await assert.rejects(()=>domainShare(domain),/valid domain/);
    chart=await domainShare(' Example.Test ');assert.equal(chart.access_domain,'example.test');assert.equal(chart.revision,8);
    await as(null);await assert.rejects(get,/access denied/);await assert.rejects(()=>domainShare('example.test'),/permission denied/);
    await as(4);assert.equal((await get()).access_role,'viewer');assert.equal((await get()).access_domain,null);await assert.rejects(()=>save(8),/edit access/);
    assert.deepEqual((await db.query('select public.teeth_list_charts() as charts')).rows[0].charts,[]); // Link access doesn't enumerate an organization's charts.
    await db.exec('reset role');
    for(const email of ['stranger@badexample.test','stranger@example.test.attacker.test','stranger@sub.example.test']){
      await db.query("update auth.users set email=$1 where email like 'stranger@%'",[email]);await as(4);await assert.rejects(get,/access denied/);await db.exec('reset role');
    }
    await db.exec("update auth.users set email='stranger@example.test',email_confirmed_at=null where email like 'stranger@%'");await as(4);await assert.rejects(get,/access denied/);
    await db.exec('reset role');await db.exec("update auth.users set email_confirmed_at=now() where email='stranger@example.test'");
    await as(1);await assert.rejects(()=>domainShare('example.test','editor',7),/Sharing changed/);await domainShare('example.test','editor',8);
    await as(4);assert.equal((await get()).access_role,'editor');chart=await save(9);assert.equal(chart.revision,10);await assert.rejects(()=>domainShare('example.test','viewer',10),/Only the owner/);
    await as(1);await domainShare('another.test','viewer',10,[{email:'editor@example.test',role:'editor'},{email:'viewer@example.test',role:'viewer'}]);
    await as(3);assert.equal((await get()).access_role,'editor');await as(2);assert.equal((await get()).access_role,'viewer');await as(4);await assert.rejects(get,/access denied/);
    await as(1);chart=await share('restricted','viewer',11);assert.equal(chart.access_domain,null); // Old RPC remains safe after a domain change.
    await as(4);await assert.rejects(get,/access denied/);
    const request=async(chartId=id)=>(await db.query('select public.teeth_request_access($1) as result',[chartId])).rows[0].result;
    const requests=async()=>(await db.query('select public.teeth_list_access_requests($1) as result',[id])).rows[0].result;
    const resolve=async(role,rev)=>(await db.query('select public.teeth_resolve_access_request($1,$2,$3,$4) as result',[id,'00000000-0000-4000-8000-000000000004',role,rev])).rows[0].result;
    await as(null);await assert.rejects(request,/permission denied/);await assert.rejects(requests,/permission denied/);
    await as(4);assert.equal((await request()).status,'requested');await request();await assert.rejects(get,/access denied/);await assert.rejects(requests,/Only the owner/);await assert.rejects(()=>resolve('editor',12),/Only the owner/);await assert.rejects(()=>db.exec('select * from public.teeth_access_requests'),/permission denied/);
    assert.deepEqual(await request('99999999-0000-4000-8000-000000000000'),{status:'requested'});
    await as(1);assert.equal((await requests()).length,1);assert.equal((await requests())[0].email,'stranger@example.test');await assert.rejects(()=>resolve('editor',11),/Sharing changed/);await assert.rejects(()=>resolve('owner',12),/Invalid access role/);await resolve('viewer',12);assert.equal((await requests()).length,0);
    await as(4);assert.equal((await get()).access_role,'viewer');await assert.rejects(()=>save(13),/edit access/);assert.equal((await request()).status,'has_access');
    await as(1);await share('restricted','viewer',13);await as(4);await request();
    await db.exec('reset role');await db.exec("update auth.users set email='changed@example.test' where email='stranger@example.test'");await as(1);assert.equal((await requests()).length,0);await assert.rejects(()=>resolve('editor',14),/no longer available/);
    await db.exec('reset role');await db.exec("update auth.users set email='stranger@example.test' where email='changed@example.test'");await as(1);await resolve('dismiss',14);assert.equal((await requests()).length,0);await as(4);await assert.rejects(get,/access denied/);
    await db.exec('reset role');await db.exec("update auth.users set email_confirmed_at=null where email='stranger@example.test'");await as(4);await assert.rejects(request,/verified email/);
    const remove=rev=>db.query('select public.teeth_delete_chart($1,$2)',[id,rev]);
    await as(null);await assert.rejects(()=>remove(15),/permission denied/);
    await as(3);await assert.rejects(()=>remove(15),/Only the owner/);
    await as(1);await assert.rejects(()=>remove(14),/Reload before deleting/);await remove(15);await assert.rejects(get,/access denied/);
    await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from public.teeth_chart_members where chart_id=$1',[id])).rows[0].n,0);
  }finally{await db.close();}
});

test('domain validation accepts exact hostnames and rejects URLs, wildcards and malformed labels',()=>{
  for(const name of ['formularacingcamp.com','EXAMPLE.COM','sub.example.com',' example.com '])assert.equal(validDomain(name),true,name);
  assert.equal(normalizeDomain(' Example.COM '),'example.com');
  for(const name of ['',null,'@example.com','https://example.com','*.example.com','example.com/path','-a.com','a-.com','a..com','a'.repeat(64)+'.com'])assert.equal(validDomain(name),false,String(name));
});

test('cloud sharing sends normalized domains and preserves them in owner metadata',async()=>{
  const cloud=require('../tools/teeth-chart/cloud.js'),calls=[];
  global.TeethModel=require('../tools/teeth-chart/model.js');
  const raw={id:'chart',name:'Chart',annotations:{},history:{version:1,entries:[]},revision:2,access_role:'owner',general_access:'domain',link_role:'editor',access_domain:'example.test',members:[]};
  global.TeethAuth={session:{user:{id:'owner'}},client:{rpc(name,args){calls.push({name,args});return {abortSignal:async()=>({data:raw})};}}};
  try{
    const chart=cloud.hydrate(raw);assert.equal(chart._cloud.domain,'example.test');
    await cloud.setSharing(chart,{general:'domain',domain:' EXAMPLE.TEST ',linkRole:'editor',members:[]});
    assert.equal(calls[0].name,'teeth_set_sharing_v2');assert.equal(calls[0].args.p_domain,'example.test');assert.equal(calls[0].args.p_revision,2);assert.equal(chart._cloud.domain,'example.test');
    raw.access_domain=null;raw.general_access='restricted';await cloud.setSharing(chart,{general:'restricted',linkRole:'viewer',members:[]});assert.equal(calls[1].name,'teeth_set_sharing');assert.equal(chart._cloud.domain,null);
  }finally{delete global.TeethAuth;delete global.TeethModel;}
});

test('an auth or transport stall is bounded even when the underlying operation never settles',async()=>{
  const {deadline}=require('../tools/teeth-chart/cloud.js');let cancelled=false;
  await assert.rejects(deadline(new Promise(()=>{}),10,()=>{cancelled=true;}),error=>error.code==='TIMEOUT');assert.equal(cancelled,true);
});
test('opening a signed-in chart does not wait for the library and a library error does not hide the chart',async()=>{
  const cloud=require('../tools/teeth-chart/cloud.js'),calls=[];let failList;const library=new Promise((_,reject)=>failList=reject);
  global.TeethModel=require('../tools/teeth-chart/model.js');
  const raw={id:'chart',name:'Requested chart',annotations:{},history:{version:1,entries:[]},revision:1,access_role:'owner',general_access:'restricted',link_role:'viewer',members:[]};
  global.TeethAuth={session:{user:{id:'owner'}},client:{rpc(name){calls.push(name);return {abortSignal:()=>name==='teeth_get_chart'?Promise.resolve({data:raw}):library};}}};
  let errorSeen=false;
  try{const chart=await cloud.openRoute('chart',{onLibraryError:()=>{errorSeen=true;}});assert.equal(chart.name,'Requested chart');assert.deepEqual(calls,['teeth_get_chart','teeth_list_charts']);assert.equal(errorSeen,false);failList(new Error('Library unavailable'));await new Promise(resolve=>setImmediate(resolve));assert.equal(errorSeen,true);}
  finally{delete global.TeethAuth;delete global.TeethModel;}
});
