const {test}=require('node:test');
const assert=require('node:assert/strict');
const {render}=require('../tools/teeth-chart/access.js');
const {create}=require('../tools/teeth-chart/autosave.js');
test('access gate hides the entire workspace during loading and when access is denied',()=>{
  const nodes=new Map(),document={title:'Secret chart name',querySelector(key){if(!nodes.has(key))nodes.set(key,{});return nodes.get(key);}};
  render(document,{loading:true,blocked:false});assert.equal(nodes.get('.app-shell').hidden,true);assert.equal(nodes.get('[data-access-actions]').hidden,true);assert.equal(nodes.get('[data-access-gate]').hidden,false);assert.equal(nodes.get('[data-access-spinner]').hidden,false);assert.equal(nodes.get('[data-access-lock]').hidden,true);assert.doesNotMatch(document.title,/Secret/);
  render(document,{loading:false,blocked:true});assert.equal(nodes.get('.app-shell').hidden,true);assert.equal(nodes.get('[data-access-gate]').hidden,false);assert.equal(nodes.get('[data-access-signin]').textContent,'Sign in');assert.equal(nodes.get('[data-request-access]').textContent,'Request access');
  render(document,{loading:false,blocked:true,email:'reader@example.test',requested:true});assert.equal(nodes.get('[data-request-access]').disabled,true);assert.equal(nodes.get('[data-access-email]').textContent,'reader@example.test');
  render(document,{loading:false,blocked:false});assert.equal(nodes.get('.app-shell').hidden,false);assert.equal(nodes.get('[data-access-gate]').hidden,true);
});
test('autosave coalesces typing, flushes before navigation, and cancels across accounts',()=>{
  const jobs=new Map(),saved=[];let id=0;
  const autosave=create({commit:edit=>saved.push(edit),setTimer:fn=>{jobs.set(++id,fn);return id;},clearTimer:key=>jobs.delete(key)});
  autosave.schedule({chart:'a',note:'h'});autosave.schedule({chart:'a',note:'hello'});assert.equal(jobs.size,1);assert.equal(autosave.pending,true);
  [...jobs.values()][0]();assert.deepEqual(saved,[{chart:'a',note:'hello'}]);assert.equal(autosave.pending,false);
  autosave.schedule({chart:'a',note:'updated'});autosave.flush();assert.equal(saved[1].note,'updated');assert.equal(jobs.size,0);
  autosave.schedule({chart:'a',note:'old account'});autosave.cancel();autosave.flush();assert.equal(saved.length,2);assert.equal(jobs.size,0);
});
