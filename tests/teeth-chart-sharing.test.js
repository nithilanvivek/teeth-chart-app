const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

for(const automaticTableGrants of [true,false])test(`sharing and account permissions with ${automaticTableGrants?'legacy':'October 30 explicit'} table grants`,async()=>{
  const db=new PGlite(),id='10000000-0000-4000-8000-000000000001';
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated;
      insert into auth.users values
      ('00000000-0000-4000-8000-000000000001','owner@private.test',now()),
      ('00000000-0000-4000-8000-000000000002','editor@racing.test',now()),
      ('00000000-0000-4000-8000-000000000003','viewer@school.test',now()),
      ('00000000-0000-4000-8000-000000000004','stranger@other.test',now()),
      ('00000000-0000-4000-8000-000000000005','unverified@racing.test',null),
      ('00000000-0000-4000-8000-000000000006','sub@sub.racing.test',now());`);
    // Reproduce both Supabase defaults before creating the application's tables.
    await db.exec(`alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant usage,select on sequences to anon,authenticated,service_role;`);
    if(!automaticTableGrants)await db.exec(`
      alter default privileges in schema public revoke select,insert,update,delete on tables from anon,authenticated,service_role;
      alter default privileges in schema public revoke usage,select on sequences from anon,authenticated,service_role;`);
    for(const name of ['20260909_teeth_charts','20260911_teeth_domain_sharing','20260911_teeth_access_requests','20260911_teeth_delete_chart','20260911_teeth_retention','20260911_teeth_flexible_sharing','20260911_teeth_delete_fast','20260911_teeth_delete_account'])await db.exec(readFileSync('supabase/migrations/'+name+'.sql','utf8'));
    const tables=['teeth_charts','teeth_chart_members','teeth_access_requests','teeth_chart_domains'];
    for(const table of tables){
      const {rows:[permissions]}=await db.query(`select
        has_table_privilege('anon',$1,'SELECT,INSERT,UPDATE,DELETE') as anonymous_access,
        has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') as signed_in_access,
        has_table_privilege('service_role',$1,'SELECT,INSERT,UPDATE,DELETE') as service_access,
        (select relrowsecurity from pg_class where oid=$1::regclass) as rls`,['public.'+table]);
      assert.deepEqual(permissions,{anonymous_access:false,signed_in_access:false,service_access:automaticTableGrants,rls:true});
    }
    const as=async who=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who?'00000000-0000-4000-8000-'+String(who).padStart(12,'0'):'']);await db.exec('set role '+(who?'authenticated':'anon'));};
    for(const who of [null,1]){
      await as(who);
      for(const table of tables)await assert.rejects(()=>db.query('select * from public.'+table),/permission denied/);
      await assert.rejects(()=>db.query('select public.teeth_role($1)',[id]),/permission denied/);
    }
    const get=async()=> (await db.query('select public.teeth_get_chart($1) as c',[id])).rows[0].c;
    const save=async(revision,chartId=id)=>(await db.query('select public.teeth_save_chart($1,$2,$3,$4,$5) as c',[chartId,'Chart',{}, {version:1,entries:[]},revision])).rows[0].c;
    let revision=1;
    const share=async(general,role,domains,anonymous=false,members=[])=>{const result=(await db.query('select public.teeth_set_sharing_v3($1,$2,$3,$4,$5,$6,$7) as c',[id,general,role,members,revision,domains,anonymous])).rows[0].c;revision=result.revision;return result;};
    const domains=[{domain:' Racing.Test ',role:'editor'},{domain:'school.test',role:'viewer'}];
    await as(1);await save(0);const info=(await db.query('select public.teeth_delete_info($1) as d',[id])).rows[0].d;assert.deepEqual(Object.keys(info).sort(),['id','name','revision']);assert.equal(info.revision,1);let c=await share('domain','viewer',domains);assert.equal(c.domain_rules.length,2);assert.equal(c.domain_rules[0].domain,'racing.test');
    await as(2);c=await get();assert.equal(c.access_role,'editor');assert.equal(c.domain_rules,null);assert.equal(c.members,null);revision=(await save(revision)).revision;
    await as(3);await assert.rejects(()=>db.query('select public.teeth_delete_info($1)',[id]),/Only the owner/);assert.equal((await get()).access_role,'viewer');await assert.rejects(()=>save(revision),/edit access/);
    for(const who of [null,4,5,6]){await as(who);await assert.rejects(get,/access denied/);}
    await as(1);await share('anyone','viewer',domains,false,[{email:'editor@racing.test',role:'viewer'}]);
    await as(null);assert.equal((await get()).access_role,'viewer');await assert.rejects(()=>save(revision),/edit access/);
    await as(2);assert.equal((await get()).access_role,'editor');
    await as(4);assert.equal((await get()).access_role,'viewer');await assert.rejects(()=>share('anyone','editor',[],true),/Only the owner/);
    await as(1);await assert.rejects(()=>db.query('select public.teeth_set_sharing_v2($1,$2,$3,$4,$5,$6)',[id,'restricted','viewer',[],revision,null]),/Refresh the app/);
    await share('anyone','editor',[],false);await as(null);assert.equal((await get()).access_role,'viewer');
    await as(1);await share('anyone','editor',[],true);await as(null);c=await get();assert.equal(c.access_role,'editor');assert.equal(c.anonymous_edit,true);assert.equal(c.domain_rules,null);
    revision=(await save(revision)).revision;await assert.rejects(()=>save(revision-1),/newer version/);
    await assert.rejects(()=>save(0,'10000000-0000-4000-8000-000000000099'),/Sign in to create/);
    await assert.rejects(()=>db.query('select public.teeth_delete_chart($1,$2)',[id,revision]),/permission denied/);
    await assert.rejects(()=>share('restricted','viewer',[]),/permission denied/);
    await assert.rejects(()=>db.exec('select * from public.teeth_chart_domains'),/permission denied/);
    await as(1);await share('restricted','viewer',[]);await as(null);await assert.rejects(get,/access denied/);await assert.rejects(()=>save(revision),/edit access/);
    await as(1);
    for(const bad of [[{domain:'*.test',role:'viewer'}],[{domain:'ok.test',role:'owner'}],[{domain:'a.test',role:'viewer'},{domain:'A.TEST',role:'editor'}],[]])await assert.rejects(()=>share('domain','viewer',bad));
    await assert.rejects(()=>share('restricted','viewer',domains));await assert.rejects(()=>share('anyone','viewer',[],true));
    assert.equal((await get()).general_access,'restricted');
    await share('domain','viewer',domains);await db.query('select public.teeth_delete_chart($1,$2)',[id,revision]);await db.query('select public.teeth_delete_chart($1,$2)',[id,revision]);assert.equal((await db.query('select public.teeth_delete_info($1) as d',[id])).rows[0].d,null);await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from public.teeth_chart_domains')).rows[0].n,0);
    // Content saves must preserve all access settings, regardless of editor type.
    const accessState=async()=>{
      await db.exec('reset role');
      return {
        chart:(await db.query('select owner_id,general_access,link_role,access_domain,anonymous_edit from public.teeth_charts where id=$1',[id])).rows[0],
        members:(await db.query('select email,role from public.teeth_chart_members where chart_id=$1 order by email',[id])).rows,
        domains:(await db.query('select domain,role from public.teeth_chart_domains where chart_id=$1 order by domain',[id])).rows
      };
    };
    await as(1);revision=(await save(0)).revision;
    const people=[{email:'stranger@other.test',role:'editor'},{email:'viewer@school.test',role:'viewer'}];
    for(const [general,role,rules,anonymous,editors] of [
      ['restricted','viewer',[],false,[1,4]],['domain','viewer',domains,false,[1,2,4]],
      ['anyone','viewer',domains,false,[1,2,4]],['anyone','editor',domains,false,[1,2,3,4]],
      ['anyone','editor',domains,true,[1,2,4,null]]
    ]){
      await as(1);await share(general,role,rules,anonymous,people);const before=await accessState();
      for(const editor of editors){await as(editor);revision=(await save(revision)).revision;assert.deepEqual(await accessState(),before,'content upload changed access for '+general+'/'+role+'/'+editor);}
    }
    // Account deletion can target only the caller and removes only their data.
    await db.exec('reset role');await db.exec(`create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);insert into auth.sessions values('90000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');`);
    const other='10000000-0000-4000-8000-000000000002';await as(4);await save(0,other);
    await as(1);await db.query('select public.teeth_request_access($1)',[other]);
    await as(4);await db.query('select public.teeth_set_sharing_v3($1,$2,$3,$4,$5,$6,$7)',[other,'restricted','viewer',[{email:'owner@private.test',role:'editor'},{email:'viewer@school.test',role:'viewer'}],1,[],false]);
    await as(null);await assert.rejects(()=>db.query('select public.teeth_delete_account($1)',['owner@private.test']),/permission denied/);
    await as(1);await assert.rejects(()=>db.query('select public.teeth_delete_account($1)',['stranger@other.test']),/signed-in email/);
    await db.query('select public.teeth_delete_account($1)',[' OWNER@PRIVATE.TEST ']);
    await assert.rejects(get,/access denied/);await assert.rejects(()=>db.query('select public.teeth_get_chart($1)',[other]),/access denied/);
    await db.query('select public.teeth_delete_account($1)',['owner@private.test']); // Lost-response retry.
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int n from auth.users where id=$1',['00000000-0000-4000-8000-000000000001'])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from public.teeth_charts where id=$1',[id])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from public.teeth_access_requests')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from public.teeth_chart_domains where chart_id=$1',[id])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from public.teeth_chart_members where chart_id=$1',[id])).rows[0].n,0);
    assert.deepEqual((await db.query('select email,role from public.teeth_chart_members where chart_id=$1',[other])).rows,[{email:'viewer@school.test',role:'viewer'}]);
    await as(4);const remaining=(await db.query('select public.teeth_get_chart($1) c',[other])).rows[0].c;assert.equal(remaining.access_role,'owner');assert.equal(remaining.revision,3);assert.equal(remaining.general_access,'restricted');
  }finally{await db.close();}
});

test('anonymous cloud saves require an explicit server-provided editing grant',async()=>{
  const cloud=require('../tools/teeth-chart/cloud.js'),{Store}=require('../tools/teeth-chart/model.js'),data=new Map();
  const chart=new Store({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}).current,calls=[];
  global.TeethAuth={session:null,client:{rpc(name,args){calls.push({name,args});return {abortSignal:async()=>({data:{revision:2,access_role:'editor',anonymous_edit:true}})};}}};
  try{
    await assert.rejects(()=>cloud.save(chart),/Sign in/);chart._cloud={role:'viewer',revision:1};await assert.rejects(()=>cloud.save(chart),/Sign in/);assert.equal(calls.length,0);
    chart._cloud={role:'editor',revision:1,anonymousEdit:true};await cloud.save(chart);assert.equal(calls.length,1);assert.equal(calls[0].args.p_revision,1);assert.equal(chart._cloud.anonymousEdit,true);
  }finally{delete global.TeethAuth;}
});


test('the upload client sends content only and retains server sharing metadata',async()=>{
  const cloud=require('../tools/teeth-chart/cloud.js');const metadata={general_access:'anyone',link_role:'editor',anonymous_edit:true,domain_rules:[{domain:'racing.test',role:'editor'},{domain:'school.test',role:'viewer'}],members:[{email:'friend@other.test',role:'viewer'}]};
  const chart={id:'upload-access-test',name:'Chart',annotations:{},history:[],_cloud:{role:'owner',revision:5}},calls=[];
  global.TeethAuth={session:{user:{id:'owner'}},client:{rpc(name,args){calls.push({name,args});return {abortSignal:async()=>({data:{revision:6,access_role:'owner',...metadata}})};}}};
  try{await cloud.save(chart);assert.deepEqual(calls.map(c=>c.name),['teeth_save_chart']);assert.deepEqual(Object.keys(calls[0].args).sort(),['p_annotations','p_history','p_id','p_name','p_revision']);assert.equal(chart.id,'upload-access-test');assert.equal(chart._cloud.general,'anyone');assert.equal(chart._cloud.linkRole,'editor');assert.equal(chart._cloud.anonymousEdit,true);assert.deepEqual(chart._cloud.domains,metadata.domain_rules);assert.deepEqual(chart._cloud.members,metadata.members);}finally{delete global.TeethAuth;}
});
