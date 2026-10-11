const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
function setup(initialSession=null){
  const node=()=>({value:'',hidden:false,disabled:false,textContent:'',listeners:{},classList:{toggle(){}},focus(){},closest(){return this.label||(this.label=node());},addEventListener(name,fn){this.listeners[name]=fn;},async fire(name){return this.listeners[name]?.({preventDefault(){}});}});
  const nodes=new Map(),find=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
  const form=find('form'),dialog=find('dialog');form.elements={email:find('email'),code:find('code')};form.querySelector=find;form.reportValidity=()=>true;dialog.querySelector=find;
  dialog.showModal=()=>dialog.open=true;dialog.close=()=>{dialog.open=false;dialog.fire('close');};
  const calls=[],state={sendError:null,verifyError:null,sendGate:null};
  const client={auth:{getSession:async()=>({data:{session:initialSession}}),getUser:async()=>state.userGate?await state.userGate:({data:{user:state.user}}),updateUser:async(args,options)=>{calls.push(['update',args,options]);if(state.updateGate)await state.updateGate;return {data:{user:state.user},error:state.updateError};},onAuthStateChange(fn){state.authChanged=fn;},signOut:async()=>{if(state.signOutError)throw state.signOutError;return {};},signInWithOAuth:async args=>{calls.push(['oauth',args]);if(state.oauthGate)await state.oauthGate;return {error:state.oauthError};},signInWithOtp:async args=>{calls.push(['send',args]);if(state.sendGate)await state.sendGate;return {error:state.sendError};},verifyOtp:async args=>{calls.push(['verify',args]);return {error:state.verifyError};}}};
  const window={TeethCloud:{deadline:operation=>operation},localStorage:{removeItem:key=>calls.push(['remove-token',key])},addEventListener(name,fn){state[name]=fn;},supabase:{createClient:()=>client}};
  vm.runInNewContext(readFileSync('tools/teeth-chart/auth.js','utf8'),{window,TeethConfig:{supabaseUrl:'https://example.test',publishableKey:'public',authRedirect:'https://nithi.land/t'},document:{querySelectorAll:()=>[find('[data-account-button]')],querySelector:selector=>selector==='[data-auth-dialog]'?dialog:find(selector)},setTimeout:fn=>fn(),setInterval:()=>1,clearInterval(){},Date});
  return {auth:window.TeethAuth,find,form,dialog,calls,state};
}
test('email code flow binds verification to requested email and preserves session until verified',async()=>{
  const t=setup();await t.auth.ready;t.auth.show();t.form.elements.email.value=' user@example.test ';
  await t.form.fire('submit');assert.equal(t.calls[0][0],'send');assert.equal(t.calls[0][1].email,'user@example.test');assert.equal(t.calls[0][1].options.shouldCreateUser,true);assert.equal(t.auth.session,null);assert.equal(t.form.elements.email.readOnly,true);assert.equal(t.find('[type=submit]').textContent,'Verify and sign in');
  await t.find('[data-resend-code]').fire('click');assert.equal(t.calls.length,1);
  t.form.elements.email.value='different@example.test';t.form.elements.code.value='123456';await t.form.fire('submit');assert.equal(t.calls[1][1].email,'user@example.test');assert.equal(t.calls[1][1].token,'123456');assert.equal(t.calls[1][1].type,'email');assert.equal(t.dialog.open,false);
});
test('invalid codes allow retry; chart draft guard prevents session changes',async()=>{
  const t=setup();await t.auth.ready;t.auth.show();t.form.elements.email.value='user@example.test';await t.form.fire('submit');
  t.auth.setBeforeChange(async()=>false);t.form.elements.code.value='123456';await t.form.fire('submit');assert.equal(t.calls.length,1);
  t.auth.setBeforeChange(async()=>true);t.state.verifyError={code:'otp_expired'};await t.form.fire('submit');assert.equal(t.dialog.open,true);assert.match(t.find('[data-auth-message]').textContent,/invalid or expired/);assert.equal(t.find('[type=submit]').disabled,false);
  t.state.verifyError=null;await t.form.fire('submit');assert.equal(t.dialog.open,false);
});
test('send failures stay on email step and repeated clicks cannot send duplicate requests',async()=>{
  const t=setup();await t.auth.ready;t.auth.show();t.form.elements.email.value='user@example.test';t.state.sendError={code:'email_address_not_authorized'};await t.form.fire('submit');assert.equal(t.find('[type=submit]').textContent,'Send code');assert.match(t.find('[data-auth-message]').textContent,/not configured/);
  t.state.sendError=null;let resolve;t.state.sendGate=new Promise(done=>resolve=done);const pending=t.form.fire('submit');await t.form.fire('submit');assert.equal(t.calls.length,2);resolve();await pending;
  await t.find('[data-change-email]').fire('click');assert.equal(t.form.elements.email.readOnly,false);assert.equal(t.find('[type=submit]').textContent,'Send code');
});

test('account identity follows initial session, verification, email updates and sign-out',async()=>{
  const user={id:'owner',email:'old@example.test'},t=setup({user});await t.auth.ready;
  const button=t.find('[data-account-button]');assert.equal(button.textContent,user.email);assert.equal(button.disabled,false);
  t.state.authChanged('USER_UPDATED',{user:{...user,email:'new@example.test'}});assert.equal(button.textContent,'new@example.test');
  t.state.authChanged('SIGNED_OUT',null);assert.equal(button.textContent,'Sign in');
  t.state.authChanged('SIGNED_IN',{user});assert.equal(button.textContent,user.email);
});
test('email change stays on old identity while pending and uses secure confirmation redirect',async()=>{
  const user={id:'owner',email:'old@example.test'},t=setup({user});await t.auth.ready;
  await assert.rejects(()=>t.auth.changeEmail('old@example.test'),/different email/);
  t.state.user={...user,new_email:'new@example.test'};
  await t.auth.changeEmail(' NEW@example.test ');
  assert.equal(t.calls[0][1].email,'new@example.test');assert.equal(t.calls[0][2].emailRedirectTo,'https://nithi.land/t');assert.equal(t.auth.session.user.id,'owner');assert.equal(t.find('[data-account-button]').textContent,'old@example.test');assert.equal(t.auth.session.user.new_email,'new@example.test');
  t.state.user={...user,email:'new@example.test'};await t.auth.refreshUser();assert.equal(t.find('[data-account-button]').textContent,'new@example.test');
  t.state.updateError=new Error('Try again later');await assert.rejects(()=>t.auth.changeEmail('other@example.test'),/Try again later/);assert.equal(t.auth.session.user.email,'new@example.test');
});
test('stale profile refresh cannot restore a signed-out or replaced account',async()=>{
  const t=setup({user:{id:'owner',email:'old@example.test'}});await t.auth.ready;
  let resolve;t.state.userGate=new Promise(done=>resolve=done);const refresh=t.auth.refreshUser();
  t.state.authChanged('SIGNED_OUT',null);resolve({data:{user:{id:'owner',email:'new@example.test'}}});await refresh;assert.equal(t.auth.session,null);assert.equal(t.find('[data-account-button]').textContent,'Sign in');
});


test('account deletion clears identity even if remote sign-out fails and stale auth events cannot restore it',async()=>{
  const user={id:'owner',email:'owner@example.test'},t=setup({user});await t.auth.ready;t.state.signOutError=new Error("Already deleted");await t.auth.forgetDeletedAccount(user.id);assert.equal(t.auth.session,null);assert.equal(t.find('[data-account-button]').textContent,'Sign in');assert.ok(t.calls.some(c=>c[0]==='remove-token'));t.state.authChanged('TOKEN_REFRESHED',{user});assert.equal(t.auth.session,null);
  t.state.authChanged('SIGNED_IN',{user:{id:'other',email:'other@example.test'}});await t.auth.forgetDeletedAccount(user.id);assert.equal(t.auth.session.user.id,'other');
});


for(const [provider,label] of [['google','Google'],['zoom','Zoom']]){
test(`${label} sign-in respects the draft guard and uses the configured return URL`,async()=>{
  const t=setup();await t.auth.ready;t.auth.show();
  t.auth.setBeforeChange(async()=>false);await t.find(`[data-signin-${provider}]`).fire('click');
  assert.equal(t.calls.length,0);assert.equal(t.find(`[data-signin-${provider}]`).disabled,false);
  t.auth.setBeforeChange(async()=>{t.calls.push(['saved']);return true;});
  await t.find(`[data-signin-${provider}]`).fire('click');
  assert.equal(t.calls[0][0],'saved');assert.equal(t.calls[1][0],'oauth');
  assert.equal(t.calls[1][1].provider,provider);assert.equal(t.calls[1][1].options.redirectTo,'https://nithi.land/t');
  assert.equal(t.auth.session,null);
});

test(`${label} failures allow retry and pending sign-in blocks other providers and email requests`,async()=>{
  const t=setup();await t.auth.ready;t.auth.show();let resolve;
  t.state.oauthGate=new Promise(done=>resolve=done);t.state.oauthError=new Error(`${label} is temporarily unavailable.`);
  const pending=t.find(`[data-signin-${provider}]`).fire('click');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(t.find(`[data-signin-${provider}]`).disabled,true);assert.equal(t.find('[type=submit]').disabled,true);
  for(const other of ['google','zoom']){
    assert.equal(t.find(`[data-signin-${other}]`).disabled,true);
    await t.find(`[data-signin-${other}]`).fire('click');
  }
  await t.form.fire('submit');assert.equal(t.calls.length,1);
  resolve();await pending;assert.equal(t.find('[data-auth-message]').textContent,`${label} is temporarily unavailable.`);
  assert.equal(t.find(`[data-signin-${provider}]`).disabled,false);assert.equal(t.find('[type=submit]').disabled,false);
  t.state.oauthError=null;await t.find(`[data-signin-${provider}]`).fire('click');assert.equal(t.calls.length,2);
});


}
