const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Store,STORAGE_KEY,itemInfo,parseImport}=require('../tools/teeth-chart/model.js');
function memoryStorage(){const data=new Map();return{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
const annotation={status:'milk',wobbly:true,filled:true,cavity:true,painful:true,note:'Check next visit'};

test('all 64 positions retain their desktop IDs and FDI numbers',()=>{
  const keys=[];
  for(const arch of ['upper','lower'])for(const type of ['tooth','space'])for(let i=1;i<=16;i++){const key=`${arch}_${type}_${i}`;assert.ok(itemInfo(key));keys.push(key);}
  assert.equal(keys.length,64);
  assert.equal(itemInfo('upper_tooth_8').permanent,11);
  assert.equal(itemInfo('upper_tooth_8').primary,51);
  assert.equal(itemInfo('lower_tooth_1').permanent,48);
  assert.equal(itemInfo('upper_tooth_17'),null);
  assert.equal(itemInfo('upper_tooth_0'),null);
  assert.equal(itemInfo('__proto__'),null);
});
test('annotations, all modifiers, names, and histories survive reopening the browser store',()=>{
  const storage=memoryStorage(),store=new Store(storage);store.create('Patient A');store.annotate('upper_tooth_8',annotation);
  const reopened=new Store(storage);
  assert.equal(reopened.current.name,'Patient A');
  assert.deepEqual(reopened.exportPayload(),{chart_name:'Patient A',annotations:{upper_tooth_8:{item_type:'tooth',...annotation}}});
  assert.equal(reopened.current.history.length,2);
  assert.deepEqual(reopened.current.history[1].snapshot,{});
});
test('named charts stay isolated and existing names reopen without clearing them',()=>{
  const store=new Store(memoryStorage());const a=store.create('A');store.annotate('upper_tooth_1',{status:'permanent'});store.create('B');store.annotate('lower_space_16',{status:'empty'});
  store.create('a');assert.equal(store.current.id,a.id);assert.equal(store.current.annotations.upper_tooth_1.status,'permanent');assert.equal(store.current.annotations.lower_space_16,undefined);
});
test('JSON round-trips and unsupported entries cannot enter charts',()=>{
  const store=new Store(memoryStorage());const payload={chart_name:'Imported',annotations:{upper_tooth_8:{status:'milk',filled:true,note:'Desktop'},upper_space_8:{status:'fulfilled',wobbly:true},invalid_key:{status:'permanent'}}};
  const parsed=store.importChart(payload);assert.equal(parsed.skipped,1);assert.equal(store.current.annotations.upper_space_8.wobbly,false);
  assert.deepEqual(Object.keys(store.exportPayload().annotations),['upper_tooth_8','upper_space_8']);
  const other=new Store(memoryStorage());other.importChart(store.exportPayload());assert.deepEqual(other.exportPayload(),store.exportPayload());
});
test('invalid files are rejected without modifying existing charts',()=>{
  const store=new Store(memoryStorage());store.annotate('upper_tooth_1',{status:'permanent'});const before=store.exportPayload();
  for(const input of [null,[],{}, {annotations:[]}, {annotations:{upper_tooth_1:{status:'invalid'}}}])assert.throws(()=>store.importChart(input));
  assert.deepEqual(store.exportPayload(),before);
  assert.throws(()=>store.annotate('lower_tooth_17',annotation));
  assert.throws(()=>parseImport({annotations:'invalid'}));
});
test('clearing and removing are reversible through history without mutating old snapshots',()=>{
  const store=new Store(memoryStorage());store.annotate('upper_tooth_1',{status:'permanent'});const first=structuredClone(store.current.history[0]);
  store.annotate('upper_tooth_2',{status:'wisdom',painful:true});store.remove('upper_tooth_1');assert.equal(Object.keys(store.current.annotations).length,1);
  store.clear();assert.deepEqual(store.current.annotations,{});store.restore(first);
  assert.deepEqual(Object.keys(store.current.annotations),['upper_tooth_1']);assert.deepEqual(store.current.annotations,first.snapshot);
  assert.equal(store.current.history.length,6);
});
test('previewing and exporting a history snapshot do not replace the saved chart',()=>{
  const store=new Store(memoryStorage());store.annotate('upper_tooth_1',{status:'milk'});const prior=structuredClone(store.current.history[0]);store.annotate('lower_tooth_4',{status:'fake_tooth'});
  assert.equal(Object.keys(store.exportPayload(prior.snapshot).annotations).length,1);
  assert.equal(Object.keys(store.current.annotations).length,2);
});
test('saving an unchanged annotation does not create duplicate history entries',()=>{
  const store=new Store(memoryStorage());store.annotate('upper_tooth_1',annotation);store.annotate('upper_tooth_1',annotation);assert.equal(store.current.history.length,2);
});
test('storage quota failures leave recoverable changes in memory and expose a save error',()=>{
  const storage=memoryStorage(),store=new Store(storage);storage.setItem=()=>{throw new Error('QuotaExceededError');};
  store.annotate('upper_tooth_1',annotation);assert.match(store.error,/could not save/);assert.equal(store.exportPayload().annotations.upper_tooth_1.note,'Check next visit');
});
test('unreadable storage is preserved instead of overwritten with an empty chart',()=>{
  const storage=memoryStorage();storage.setItem(STORAGE_KEY,'{broken');const store=new Store(storage);store.annotate('upper_tooth_1',annotation);
  assert.equal(storage.getItem(STORAGE_KEY),'{broken');assert.match(store.error,/left untouched/);assert.equal(store.writeBlocked,true);
});
test('a stale tab cannot overwrite another tab’s saved changes',()=>{
  const storage=memoryStorage(),first=new Store(storage),second=new Store(storage);first.annotate('upper_tooth_1',annotation);second.annotate('upper_tooth_2',annotation);
  assert.match(second.error,/another tab/);assert.equal(second.writeBlocked,true);
  const reopened=new Store(storage);assert.deepEqual(Object.keys(reopened.current.annotations),['upper_tooth_1']);
});
test('special chart names are ordinary names, not object properties',()=>{
  const store=new Store(memoryStorage());store.create('__proto__');store.annotate('upper_tooth_1',annotation);store.create('constructor');assert.equal(store.current.name,'constructor');assert.deepEqual(store.current.annotations,{});
});

test('deleting a chart preserves other charts and replaces the last one with a fresh empty chart',()=>{
  const storage=memoryStorage(),store=new Store(storage),first=store.current.id;
  store.annotate('upper_tooth_1',annotation);const second=store.create('Second').id;
  store.deleteChart(first);assert.equal(store.current.id,second);assert.equal(new Store(storage).data.charts.length,1);
  store.deleteChart(second);assert.notEqual(store.current.id,second);assert.deepEqual(store.current.annotations,{});assert.deepEqual(store.current.history,[]);assert.equal(new Store(storage).current.id,store.current.id);
  assert.throws(()=>store.deleteChart('unknown'),/Chart not found/);
});

test('templates mark exactly the eight border teeth and leave gum spaces unmarked',()=>{
  const {templateAnnotations}=require('../tools/teeth-chart/model.js');
  assert.deepEqual(templateAnnotations('blank'),{});
  for(const [id,border,rest] of [['child','not_yet_erupted','milk'],['teenager','not_yet_erupted','permanent'],['adult','wisdom','permanent']]){
    const annotations=templateAnnotations(id);assert.equal(Object.keys(annotations).length,32);
    for(const arch of ['upper','lower'])for(let i=1;i<=16;i++)assert.equal(annotations[`${arch}_tooth_${i}`].status,[1,2,15,16].includes(i)?border:rest);
    assert.equal(Object.values(annotations).filter(a=>a.status===border).length,8);
    annotations.upper_tooth_1.note='Edited';assert.equal(templateAnnotations(id).upper_tooth_1.note,'');
  }
});
