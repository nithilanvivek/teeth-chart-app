const {test}=require('node:test');
const assert=require('node:assert/strict');
const file=require('../tools/teeth-chart/local-file.js');
const model=require('../tools/teeth-chart/model.js');
const cloud=require('../tools/teeth-chart/cloud.js');
function handle(initial=''){
  let content=initial,writes=0;
  return {name:'Online Teeth Chart App.json',requestPermission:async()=>'granted',get content(){return content;},get writes(){return writes;},external(text){content=text;},getFile:async()=>({text:async()=>content,size:content.length}),createWritable:async()=>{let next;return {write:async value=>next=value,close:async()=>{content=next;writes++;},abort:async()=>{}};}};
}
test('one library JSON round-trips all charts and 64 history entries without cloud credentials or permissions',()=>{
  let raw;const store=new model.Store({getItem:()=>raw,setItem:(key,value)=>raw=value});store.rename('First');
  for(let i=0;i<70;i++)store.annotate('upper_tooth_8',{status:'milk',note:String(i)});
  store.current._cloud={members:[{email:'private@example.test'}],role:'owner'};store.create('Second');
  const encoded=file.encode(store.data.charts,store.current.id,cloud),decoded=file.decode(encoded,model,cloud);
  assert.equal(decoded.charts.length,2);assert.equal(decoded.charts[0].history.length,64);assert.deepEqual(decoded.charts[0].annotations,store.data.charts[0].annotations);assert.deepEqual(decoded.charts[0].history,store.data.charts[0].history);assert.equal(decoded.currentId,store.current.id);assert.equal(encoded.includes('private@example.test'),false);assert.equal(encoded.includes('_cloud'),false);
  assert.throws(()=>file.decode('{"format":"another-app"}',model,cloud));
});
test('file writes serialize and pause instead of overwriting external edits',async()=>{
  const h=handle(),writer=new file.Writer();writer.connect(h,'','guest');
  await Promise.all([writer.write('first','guest'),writer.write('second','guest')]);assert.equal(h.content,'second');assert.equal(h.writes,2);
  h.external('edited elsewhere');await assert.rejects(writer.write('third','guest'),/outside this tab/);assert.equal(h.content,'edited elsewhere');assert.equal(writer.pending,0);assert.ok(writer.error);
  writer.connect(h,h.content,'guest');await writer.write('confirmed replacement','guest');assert.equal(h.content,'confirmed replacement');
  await writer.write('wrong account','other');assert.equal(h.content,'confirmed replacement');
});
test('permission denial and picker cancellation leave the file unchanged',async()=>{
  const h=handle('original');h.requestPermission=async()=>'denied';await assert.rejects(file.pick(async()=>[h]),/permission/);assert.equal(h.writes,0);assert.equal(h.content,'original');
  await assert.rejects(file.pick(async()=>{throw Object.assign(new Error('cancel'),{name:'AbortError'});}),{name:'AbortError'});
  await assert.rejects(file.pick(undefined),/cannot update/);
});

test('JSON selection bypasses native type filters and checks the extension before requesting write access',async()=>{
  const h=handle('existing');h.name='My chart.JSON';let options;
  const picked=await file.pick(async value=>{options=value;return [h];});
  assert.equal(options.types,undefined);assert.notEqual(options.excludeAcceptAllOption,true);
  assert.equal(picked.text,'existing');assert.equal(h.writes,0);
  h.name='My chart.json.txt';let requests=0;h.requestPermission=async()=>{requests++;return 'granted';};
  await assert.rejects(file.pick(async()=>[h]),/ending in \.json/);
  assert.equal(requests,0);assert.equal(h.content,'existing');assert.equal(h.writes,0);
});

test('remembered files query permission silently and request it only on reconnect',async()=>{
 const h=handle('saved');let queries=0,requests=0,permission='prompt';
 h.queryPermission=async()=>{queries++;return permission;};h.requestPermission=async()=>{requests++;return permission;};
 const record={handle:h,text:'saved'};
 assert.equal(await file.reconnect(record),null);assert.equal(queries,1);assert.equal(requests,0);
 assert.equal(await file.reconnect(record,true),null);assert.equal(requests,1);assert.equal(h.writes,0);
 permission='granted';assert.deepEqual(await file.reconnect(record,true),record);assert.equal(requests,2);
 h.external('changed');await assert.rejects(file.reconnect(record),/changed while disconnected/);assert.equal(h.content,'changed');assert.equal(h.writes,0);
});

test('connection snapshots are remembered only after a successful write',async()=>{
 const h=handle(),saved=[],writer=new file.Writer(()=>{},async link=>saved.push({scope:link.scope,text:link.text}));writer.connect(h,'','account');
 await writer.write('first','account');assert.deepEqual(saved,[{scope:'account',text:'first'}]);
 h.external('external');await assert.rejects(writer.write('second','account'));assert.equal(saved.length,1);
});
