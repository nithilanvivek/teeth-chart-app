const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Store}=require('../tools/teeth-chart/model.js');
const {requiresSessionCheck,openChart,latestChart}=require('../tools/teeth-chart/navigation.js');
const {chartUrl,routeId}=require('../tools/teeth-chart/cloud.js');

test('new shared links use /teeth and both new and legacy chart paths identify the same chart',()=>{
  const id='00000000-0000-4000-8000-000000000099',previous=globalThis.location;
  try{
    assert.equal(chartUrl(id),'https://nithi.land/teeth/'+id);
    for(const pathname of ['/teeth/'+id,'/teeth/'+id+'/', '/t/'+id]){
      globalThis.location={pathname};assert.equal(routeId(),id);
    }
    for(const pathname of ['/teeth','/teeth/','/teeth/invalid']){
      globalThis.location={pathname};assert.equal(routeId(),null);
    }
  }finally{
    if(previous===undefined)delete globalThis.location;else globalThis.location=previous;
  }
});
function store(){const data=new Map();return new Store({getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)});}

test('startup chooses the last edited/created chart, without preloading other chart content',async()=>{
  const data=store();assert.equal(latestChart(data.data.charts),null);
  data.rename('Older');data.current.updatedAt='2026-01-01';data.current._cloud={role:'owner',revision:1};
  const newest=data.create('Latest');newest.updatedAt='2026-09-11';newest._cloud={role:'owner',unloaded:true};
  data.create('Viewed most recently');data.current.updatedAt='2026-02-01';
  const id=latestChart(data.data.charts).id,calls=[];
  await openChart({store:data,id,loadCloud:async target=>{calls.push(target);return newest;}});
  assert.deepEqual(calls,[newest.id]);
});

test('ordinary guest navigation skips auth startup but remembered accounts and email callbacks do not',()=>{
  assert.equal(requiresSessionCheck(()=>null,'https://nithi.land/teeth/local'),false);
  assert.equal(requiresSessionCheck(()=>'{"session":"present"}','https://nithi.land/teeth/local'),true);
  assert.equal(requiresSessionCheck(()=>{throw new Error('blocked storage');}),true);
  for(const suffix of ['?code=abc','#access_token=abc','#refresh_token=abc','?error=expired'])assert.equal(requiresSessionCheck(()=>null,'https://nithi.land/teeth'+suffix),true);
});

test('local chart URLs reopen full annotations and history without a cloud call, including back and forward',async()=>{
  const data=store(),first=data.current.id;data.annotate('upper_tooth_8',{status:'milk',note:'first local chart'});
  data.create('Second local chart');const second=data.current.id;data.annotate('lower_tooth_8',{status:'wisdom',wobbly:true});
  const unavailable=()=>{throw new Error('Cloud must not be used for browser-only charts');};
  for(const id of [first,second,first,second]){
    const opened=await openChart({store:data,id,loadCloud:unavailable});assert.equal(opened.source,'browser');assert.equal(data.current.id,id);assert.ok(data.current.history.length);
    if(id===first)assert.equal(opened.chart.annotations.upper_tooth_8.note,'first local chart');
    else assert.equal(opened.chart.annotations.lower_tooth_8.wobbly,true);
  }
});

test('cached cloud charts always recheck access, and an unknown URL never opens the current local chart',async()=>{
  const data=store(),id=data.current.id;data.current._cloud={role:'owner',revision:1};
  let calls=0;const denied=async()=>{calls++;throw new Error('Access denied');};
  await assert.rejects(openChart({store:data,id,loadCloud:denied}),/Access denied/);
  await assert.rejects(openChart({store:data,id:'unknown',loadCloud:denied}),/Access denied/);
  assert.equal(calls,2);
  const updated={id,name:'Authorized cloud chart'};assert.deepEqual(await openChart({store:data,id,loadCloud:async()=>updated}),{chart:updated,source:'cloud'});
});

test('local loading uses the loading gate without exposing chart content or offering cloud access requests',()=>{
  const {render}=require('../tools/teeth-chart/access.js'),nodes=new Map(),document={querySelector(key){if(!nodes.has(key))nodes.set(key,{});return nodes.get(key);}};
  render(document,{loading:true,blocked:false,local:true});
  assert.equal(nodes.get('.app-shell').hidden,true);assert.equal(nodes.get('[data-access-spinner]').hidden,false);
  assert.equal(nodes.get('[data-access-help]').textContent,'Opening the chart saved in this browser.');assert.equal(nodes.get('[data-access-actions]').hidden,true);
  render(document,{loading:false,blocked:false,local:true});assert.equal(nodes.get('.app-shell').hidden,false);assert.equal(nodes.get('[data-access-gate]').hidden,true);
});
