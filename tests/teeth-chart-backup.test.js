const {test}=require('node:test');const assert=require('node:assert/strict');
const {unavailable,reconcile,dirty}=require('../tools/teeth-chart/backup.js');
const {Store}=require('../tools/teeth-chart/model.js');const {signature}=require('../tools/teeth-chart/cloud.js');
function fixture(){const store=new Store({getItem:()=>null,setItem(){}});store.rename('Cloud chart');store.current._cloud={role:'owner',revision:1,savedHash:signature(store.current)};const remote=JSON.parse(JSON.stringify(store.current));store.annotate('upper_tooth_8',{status:'milk',note:'Offline edit'});return {store,remote};}
test('only service/network failures permit a previously authorized backup',()=>{
 for(const error of [{status:503},{status:502},{status:0},{code:'TIMEOUT'},{message:'TypeError: Failed to fetch'}])assert.equal(unavailable(error),true);
 for(const error of [{code:'42501',status:503},{code:'40001'},{code:'PGRST202'},{status:403},{status:401},{status:404},{message:'Access denied'}])assert.equal(unavailable(error),false);
});
test('unchanged cloud content resumes the queued draft with fresh permissions',()=>{
 const {store,remote}=fixture();remote._cloud.revision=2;remote._cloud.members=[{email:'viewer@test.com',role:'viewer'}];
 const result=reconcile(store,remote,signature);assert.equal(result,store.current);assert.equal(result.annotations.upper_tooth_8.note,'Offline edit');assert.equal(result._cloud.revision,2);assert.equal(result._cloudPending,true);assert.equal(result._cloud.members.length,1);
});
test('concurrent changes and downgraded access preserve drafts as independent local copies',()=>{
 for(const change of ['content','role']){const {store,remote}=fixture();if(change==='content')remote.name='Remote name';else remote._cloud.role='viewer';const result=reconcile(store,remote,signature,()=>change);assert.equal(result,remote);const copy=store.data.charts.at(-1);assert.equal(copy.annotations.upper_tooth_8.note,'Offline edit');assert.equal(copy._localOnly,true);assert.equal(copy._cloud,undefined);assert.equal(result._backupConflict,true);}
});
test('an upload accepted before a timeout is recognized without duplicating it',()=>{
 const {store}=fixture();const remote=JSON.parse(JSON.stringify(store.current));remote._cloud.savedHash=signature(remote);remote._cloud.revision=2;assert.equal(dirty(store.current,signature),true);assert.equal(reconcile(store,remote,signature),remote);assert.equal(store.data.charts.length,1);assert.equal(dirty(remote,signature),false);
});
