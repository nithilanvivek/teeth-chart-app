const {test}=require('node:test');
const assert=require('node:assert/strict');
const cloud=require('../tools/teeth-chart/cloud.js');
const chart=id=>({id,name:id,annotations:{},history:[],_cloud:{role:'owner',revision:1}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(handler){global.TeethAuth={session:{user:{id:'delete-test-owner'}},client:{rpc(name,args){return {abortSignal:()=>handler(name,args)};}}};}

test('deletion ignores an unrelated stalled upload and uses only lightweight metadata for a sidebar chart',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),calls=[];
  setup(async(name,args)=>{calls.push({name,args});if(name==='teeth_save_chart'){await gate;return {data:{revision:2,access_role:'owner'}};}if(name==='teeth_delete_info')return {data:{id:args.p_id,name:'Sidebar',revision:9}};if(name==='teeth_delete_chart')return {data:null};throw new Error('Unexpected full chart request');});
  const other=cloud.save(chart('other-pending'));
  try{
    await tick();const target=chart('sidebar-delete');target._cloud={role:'owner',unloaded:true};
    await cloud.deadline(cloud.deleteChart(target),500);
    assert.equal(calls.find(c=>c.name==='teeth_delete_chart').args.p_revision,9);
    assert.equal(calls.some(c=>c.name==='teeth_get_chart'),false);assert.equal(cloud.isDeleted(target.id),true);
  }finally{release();await other;delete global.TeethAuth;}
});

test('deletion waits for its own in-flight save, uses its new revision and rejects saves that could recreate it',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),calls=[];
  setup(async(name,args)=>{calls.push({name,args});if(name==='teeth_save_chart'){await gate;return {data:{revision:2,access_role:'owner'}};}return {data:null};});
  const target=chart('own-pending'),save=cloud.save(target);await tick();
  const remove=cloud.deleteChart(target);assert.equal(cloud.isDeleting(target.id),true);await tick();assert.equal(calls.length,1);
  release();await save;await remove;
  assert.equal(calls[1].args.p_revision,2);assert.equal(cloud.isDeleting(target.id),false);
  await assert.rejects(()=>cloud.save(target),error=>error.code==='CHART_DELETING');assert.equal(calls.length,2);
  delete global.TeethAuth;
});

test('failed pending saves do not block deletion, while stale revisions remain explicit conflicts',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);let stale=false;
  setup(async(name)=>{if(name==='teeth_save_chart'){await gate;return {error:{code:'OFFLINE',message:'Offline'}};}return stale?{error:{code:'40001'}}:{data:null};});
  const target=chart('failed-save'),save=cloud.save(target);save.catch(()=>{});await tick();const remove=cloud.deleteChart(target);release();await assert.rejects(save);await remove;
  stale=true;await assert.rejects(()=>cloud.deleteChart(chart('conflict')),error=>error.code==='40001');assert.equal(cloud.isDeleted('conflict'),false);assert.equal(cloud.isDeleting('conflict'),false);
  delete global.TeethAuth;
});
