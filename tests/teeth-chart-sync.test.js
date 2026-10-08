const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Store}=require('../tools/teeth-chart/model.js');
const {signature}=require('../tools/teeth-chart/cloud.js');
const {stage,finish,upload}=require('../tools/teeth-chart/sync.js');
function storage(){const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
function setup(){const disk=storage(),guest=new Store(disk),account=new Store(storage());return {guest,account,readGuest:()=>new Store(disk),signature};}
const saved=chart=>{chart._cloud={role:'owner',revision:1,savedHash:signature(chart)};};

test('sign-in stages every browser chart and 64-entry history, but never cloud caches or empty automatic starters',()=>{
  const t=setup();assert.equal(stage(t).length,0);
  for(let i=0;i<70;i++)t.guest.annotate('upper_tooth_8',{status:'milk',note:String(i)});
  const first=t.guest.current;t.guest.create('Second');t.guest.annotate('lower_tooth_8',{status:'wisdom'});
  t.guest.create('Someone else’s shared chart');t.guest.current._cloud={role:'viewer',revision:1};t.guest.persist();
  const charts=stage(t);assert.equal(charts.length,2);assert.equal(charts[0].history.length,64);assert.deepEqual(charts[0].annotations,first.annotations);
  assert.equal(t.account.data.charts.length,2);assert.equal(t.guest.data.charts.length,3);
  assert.deepEqual(stage(t).map(chart=>chart.id),charts.map(chart=>chart.id));assert.equal(t.account.data.charts.length,2);
});

test('only confirmed uploads retire browser originals; sign-out edits/new charts upload next time',async()=>{
  const t=setup();t.guest.rename('First');t.guest.annotate('upper_tooth_8',{status:'milk'});t.guest.create('Second');
  const charts=stage(t),cloud={save:async chart=>saved(chart)};
  assert.equal(t.readGuest().data.charts.length,2);
  await upload({chart:charts[0],cloud,isCurrent:()=>true});finish({...t,chart:charts[0]});assert.equal(t.readGuest().data.charts.length,1);
  await upload({chart:charts[1],cloud,isCurrent:()=>true});finish({...t,chart:charts[1]});assert.equal(t.readGuest().current._starter,true);
  t.guest=t.readGuest();t.guest.rename('Created while signed out');t.guest.annotate('upper_tooth_2',{status:'milk',note:'offline edit'});
  const next=stage(t);assert.equal(next.length,1);assert.equal(next[0].annotations.upper_tooth_2.note,'offline edit');
  assert.equal(t.account.data.charts.length,3);
});

test('failed uploads, account changes, and browser storage failures cannot discard local originals',async()=>{
  const t=setup();t.guest.rename('Keep me');const [chart]=stage(t);
  await assert.rejects(upload({chart,cloud:{save:async()=>{throw new Error('offline');}},isCurrent:()=>true}),/offline/);
  finish({...t,chart});assert.equal(t.readGuest().current.name,'Keep me');
  let calls=0;assert.equal(await upload({chart,cloud:{save:()=>calls++},isCurrent:()=>false}),false);assert.equal(calls,0);
  saved(chart);t.account.storage.setItem=()=>{throw new Error('quota');};assert.throws(()=>finish({...t,chart}),/could not save/);
  assert.equal(t.readGuest().current.name,'Keep me');
});

test('a browser edit in another tab during upload is retained for a later sign-in',()=>{
  const t=setup();t.guest.rename('Original');const [chart]=stage(t);
  const other=t.readGuest();other.annotate('upper_tooth_8',{status:'milk',note:'new edit'});
  saved(chart);finish({...t,chart});assert.equal(t.readGuest().current.annotations.upper_tooth_8.note,'new edit');
  t.guest=t.readGuest();assert.equal(stage(t).length,1);assert.equal(t.account.data.charts.length,2);
});

test('retrying an interrupted upload reuses an identical remote chart without duplicating it',async()=>{
  const t=setup();t.guest.rename('Retry me');const [chart]=stage(t),id=chart.id,remote=structuredClone(chart);saved(remote);Object.assign(remote._cloud,{general:'anyone',linkRole:'editor',anonymousEdit:true,domains:[{domain:'racing.test',role:'editor'}],members:[{email:'friend@test.example',role:'viewer'}]});
  const cloud={signature,save:async()=>{throw Object.assign(new Error('exists'),{code:'40001'});},load:async()=>remote};
  assert.equal(await upload({chart,cloud,isCurrent:()=>true}),true);assert.equal(chart.id,id);assert.equal(chart._cloud.revision,1);assert.deepEqual(chart._cloud,remote._cloud);
  finish({...t,chart});assert.equal(t.readGuest().current._starter,true);
});

test('different remote content is preserved, while the local version uploads as a separate copy',async()=>{
  const t=setup();t.guest.rename('Local version');const [chart]=stage(t),id=chart.id,remote=structuredClone(chart);remote.name='New cloud version';saved(remote);
  let resolve;const gate=new Promise(done=>resolve=done);
  const cloud={signature,load:async()=>remote,save:async value=>{if(value.id===id)throw Object.assign(new Error('exists'),{code:'40001'});await gate;saved(value);}};
  const pending=upload({chart,cloud,isCurrent:()=>true,uuid:()=> 'copy-id'});
  await new Promise(done=>setImmediate(done));assert.equal(chart.id,id);assert.equal(t.account.current.id,id);
  resolve();await pending;assert.equal(chart.id,'copy-id');assert.equal(remote.name,'New cloud version');assert.match(chart.name,/browser copy/);
});
