const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('library privacy, collaborator suggestions, owned copies and the 30-day deletion boundary',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to anon,authenticated;
   insert into auth.users values('00000000-0000-4000-8000-000000000001','owner@private.test',now()),('00000000-0000-4000-8000-000000000002','viewer@test.com',now()),('00000000-0000-4000-8000-000000000003','other@test.com',now());`);
  for(const name of ['20260909_teeth_charts','20260911_teeth_domain_sharing','20260911_teeth_access_requests','20260911_teeth_delete_chart','20260911_teeth_retention','20260911_teeth_flexible_sharing','20260911_teeth_delete_fast','20260911_teeth_copy_window','20260911_teeth_library_cards'])await db.exec(readFileSync('supabase/migrations/'+name+'.sql','utf8'));
  const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),id='10000000-0000-4000-8000-000000000001',copy='10000000-0000-4000-8000-000000000002';
  const as=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await db.exec('set role '+(n?'authenticated':'anon'));};
  const rpc=async(name,args=[])=>{const result=await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as data',args);return result.rows[0].data;};
  await as(1);await rpc('teeth_save_chart',[id,'Original',{upper_tooth_8:{status:'milk',note:'private note'}},{version:1,entries:[]},0]);
  await rpc('teeth_set_sharing_v3',[id,'restricted','viewer',[{email:'viewer@test.com',role:'viewer'}],1,[],false]);
  await as(2);const cards=await rpc('teeth_library_cards',[[]]);assert.equal(cards.length,1);assert.equal(cards[0].shared_with_people,true);assert.equal(cards[0].preview.upper_tooth_8.status,'milk');assert.doesNotMatch(JSON.stringify(cards),/private note|owner@|viewer@|history|members|owner_email/);
  assert.equal((await rpc('teeth_get_chart',[id])).members,null);
  await rpc('teeth_suggest_collaborator',[id,'new@test.com','editor']);await assert.rejects(()=>rpc('teeth_list_suggestions',[id]),/Only the owner/);
  await as(3);assert.deepEqual(await rpc('teeth_library_cards',[[id]]),[]);await assert.rejects(()=>rpc('teeth_copy_chart',[id,copy,'Stolen copy']),/access denied/);await assert.rejects(()=>rpc('teeth_suggest_collaborator',[id,'new@test.com','editor']),/access/);
  await as(1);let suggestions=await rpc('teeth_list_suggestions',[id]);assert.equal(suggestions.length,1);assert.equal(suggestions[0].email,'new@test.com');assert.equal(suggestions[0].requester_id,undefined);await rpc('teeth_resolve_suggestion',[id,suggestions[0].id,true]);assert.equal((await rpc('teeth_get_chart',[id])).members.find(m=>m.email==='new@test.com').role,'editor');
  const revision=(await rpc('teeth_get_chart',[id])).revision;await rpc('teeth_delete_chart',[id,revision]);await rpc('teeth_delete_chart',[id,revision]);assert.deepEqual(await rpc('teeth_library_cards',[[id]]),[]);assert.equal((await rpc('teeth_get_chart',[id])).access_role,'viewer');
  await as(2);const removed=await rpc('teeth_get_chart',[id]);assert.ok(removed.delete_after);assert.equal((await rpc('teeth_library_cards',[[]])).length,1);
  await assert.rejects(()=>rpc('teeth_save_chart',[id,'No edits',{}, {version:1,entries:[]},removed.revision]),/edit access/);
  const copied=await rpc('teeth_copy_chart',[id,copy,'My copy']);assert.equal(copied.access_role,'owner');assert.equal(copied.general_access,'restricted');assert.deepEqual(copied.members,[]);assert.equal(copied.annotations.upper_tooth_8.note,'private note');
  await as(1);await assert.rejects(()=>rpc('teeth_get_chart',[copy]),/access denied/);await assert.rejects(()=>rpc('teeth_set_sharing_v3',[id,'anyone','editor',[],removed.revision,[],true]),/read-only/);
  await db.exec('reset role');await db.query("update public.teeth_charts set deleted_at=now()-interval '30 days' where id=$1",[id]);
  await as(2);await assert.rejects(()=>rpc('teeth_get_chart',[id]),/access denied/);await assert.rejects(()=>rpc('teeth_copy_chart',[id,'10000000-0000-4000-8000-000000000003','Too late']),/access denied/);
  await as(null);await assert.rejects(()=>rpc('teeth_library_cards',[[]]),/permission denied/);
  await db.exec('reset role');await db.exec('select teeth_private.purge_deleted_charts()');assert.equal((await db.query('select count(*)::int as n from public.teeth_charts where id=$1',[id])).rows[0].n,0);assert.equal((await db.query('select owner_id from public.teeth_charts where id=$1',[copy])).rows[0].owner_id,uid(2));
 }finally{await db.close();}
});
