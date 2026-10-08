(() => {
  'use strict';
  const client = window.supabase.createClient(TeethConfig.supabaseUrl, TeethConfig.publishableKey, {
    auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:'nithi.teeth.auth.v1'}
  });
  const dialog=document.querySelector('[data-auth-dialog]'),form=dialog.querySelector('form');
  const title=dialog.querySelector('h2'),message=dialog.querySelector('[data-auth-message]');
  const email=form.elements.email,code=form.elements.code,submit=form.querySelector('[type=submit]');
  const resend=dialog.querySelector('[data-resend-code]'),change=dialog.querySelector('[data-change-email]');
  const providerNames={gitlab:'GitLab',zoom:'Zoom'};
  const providerButtons=Object.keys(providerNames).map(provider=>({provider,button:dialog.querySelector(`[data-signin-${provider}]`)}));
  let session=null,mode='email',busy=false,beforeChange=async()=>true,pendingEmail='',retryAt=0,timer;
  const listeners=new Set(),deletedAccounts=new Set();
  let resolveInitialSession;const initialSession=new Promise(resolve=>{resolveInitialSession=resolve;});
  let sessionVersion=0,refreshing=null,changingEmail=false,explicitSignout=false;
  function renderAccount(){
    for(const button of document.querySelectorAll('[data-account-button]')){
    button.textContent=session?.user.email?(session.user.email+(session._backupOnly?' (offline backup)':'')):(session?'Your account':'Sign in');
    button.title=session?.user.email||'Sign in';button.disabled=false;
    }
  }
  function messageText(text,error=false){message.textContent=text;message.classList.toggle('error',error);message.hidden=!text;}
  function controls(){
    const seconds=Math.max(0,Math.ceil((retryAt-Date.now())/1000));
    submit.disabled=busy;email.disabled=busy;code.disabled=busy;change.disabled=busy;
    for(const {button} of providerButtons)button.disabled=busy;
    resend.disabled=busy||seconds>0;resend.textContent=seconds?`Resend in ${seconds}s`:'Resend code';
  }
  function setMode(next){
    mode=next;const verifying=mode==='code';
    title.textContent=verifying?'Check your email':'Sign in with email';
    submit.textContent=verifying?'Verify and sign in':'Send code';
    email.readOnly=verifying;code.closest('label').hidden=!verifying;code.required=verifying;
    dialog.querySelector('[data-auth-links]').hidden=!verifying;
    dialog.querySelector('[data-auth-social]').hidden=verifying;
    dialog.querySelector('[data-auth-hint]').textContent=verifying?'Enter the code from your latest email.':'We’ll email you a one-time code. Works for new and existing accounts. No password needed.';
    code.value='';messageText('');controls();
  }
  function show(){
    if(busy)return;
    setMode(pendingEmail?'code':'email');if(pendingEmail)email.value=pendingEmail;
    if(!dialog.open){dialog.returnValue='';dialog.showModal();}
    clearInterval(timer);timer=setInterval(controls,1000);(mode==='code'?code:email).focus();
  }
  function announce(newSession){if(deletedAccounts.has(newSession?.user.id))newSession=null;session=newSession;resolveInitialSession(session);renderAccount();for(const listener of listeners)listener(session);}
  function restoreBackupSession(error){
    const network=error?.code==='TIMEOUT'||error?.status>=500||error?.status===0||/failed to fetch|networkerror|network request failed|load failed/i.test(error?.message||'');
    if(!network||explicitSignout)return false;if(session)return true;
    try{
      const saved=JSON.parse(window.localStorage.getItem('nithi.teeth.auth.v1')||'null');
      if(!saved?.access_token||!saved.refresh_token||!saved.user?.email||!saved.user?.id||deletedAccounts.has(saved.user.id))return false;
      announce({...saved,_backupOnly:true});return true;
    }catch{return false;}
  }
  async function reconnectBackup(){
    if(!session?._backupOnly)return;
    const userId=session.user.id;
    const {data,error}=await window.TeethCloud.deadline(client.auth.getSession(),8000);
    if(session?.user.id!==userId)return;
    if(error){if(error.status===401||error.status===403)announce(null);throw error;}
    if(!data?.session){announce(null);throw Object.assign(new Error('Sign in again to resume cloud saving.'),{status:401});}
    announce(data.session);
  }
  async function signOut(){if(!(await beforeChange()))return;explicitSignout=true;if(session?._backupOnly){try{window.localStorage.removeItem('nithi.teeth.auth.v1');}catch{}sessionVersion++;announce(null);return;}const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;}
  async function forgetDeletedAccount(userId){
    deletedAccounts.add(userId);
    if(session?.user.id!==userId)return;
    try{await window.TeethCloud.deadline(client.auth.signOut({scope:'local'}),3000);}catch{}
    if(session&&session.user.id!==userId)return;
    // Remove a deleted user's local token even if remote sign-out rejects it.
    try{window.localStorage.removeItem('nithi.teeth.auth.v1');}catch{}
    sessionVersion++;pendingEmail='';announce(null);
  }
  async function refreshUser(){
    if(session?._backupOnly)return reconnectBackup().catch(()=>{});
    if(!session||refreshing)return refreshing;
    const version=sessionVersion,userId=session.user.id;
    refreshing=(async()=>{
      const {data,error}=await client.auth.getUser();
      if(!error&&data.user&&version===sessionVersion&&session?.user.id===userId)announce({...session,user:data.user});
    })().catch(()=>{}).finally(()=>{refreshing=null;});return refreshing;
  }
  async function changeEmail(address){
    if(!session)throw new Error('Sign in to change your email.');
    if(changingEmail)throw new Error('An email change is already being requested.');
    address=address.trim().toLowerCase();
    if(address===session.user.email?.toLowerCase())throw new Error('Enter a different email address.');
    const userId=session.user.id;changingEmail=true;
    try{
      const {data,error}=await client.auth.updateUser({email:address},{emailRedirectTo:TeethConfig.authRedirect});
      if(error)throw error;
      if(session?.user.id!==userId)throw new Error('The signed-in account changed.');
      if(data.user)announce({...session,user:data.user});
      return address;
    }finally{changingEmail=false;}
  }
  window.addEventListener('focus',()=>refreshUser());
  function report(error){
    const messages={otp_expired:'That code is invalid or expired. Try your latest code or request a new one.',over_email_send_rate_limit:'Too many email requests. Please wait before trying again.',over_request_rate_limit:'Too many attempts. Please wait before trying again.',email_address_not_authorized:'Email delivery is not configured for this address yet. Please contact the site owner.',signup_disabled:'New account registration is currently unavailable.'};
    messageText(messages[error.code]||error.message||'Unable to connect. Please try again.',true);
  }
  async function sendCode(address){
    const {error}=await client.auth.signInWithOtp({email:address,options:{shouldCreateUser:true,emailRedirectTo:TeethConfig.authRedirect}});
    if(error)throw error;
    pendingEmail=address;retryAt=Date.now()+60000;email.value=address;setMode('code');
    messageText(`Code sent to ${address}. Check your inbox or spam folder.`);code.focus();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!form.reportValidity())return;
    busy=true;controls();messageText('');
    try{
      if(mode==='email'){
        const address=email.value.trim();
        await sendCode(address);
      }
      else{
        // A session changes only after verification; preserve any chart draft first.
        if(!(await beforeChange()))return;
        const {error}=await client.auth.verifyOtp({email:pendingEmail,token:code.value.trim(),type:'email'});if(error)throw error;
        pendingEmail='';code.value='';dialog.close('signed-in');
      }
    }catch(error){report(error);}
    finally{busy=false;controls();if(dialog.open&&mode==='code')code.focus();}
  });
  for(const {provider,button} of providerButtons)button.addEventListener('click',async()=>{
    if(busy)return;
    busy=true;controls();messageText('');
    try{
      // Save or resolve pending chart changes before leaving for the provider.
      if(!(await beforeChange()))return;
      const {error}=await client.auth.signInWithOAuth({provider,options:{redirectTo:TeethConfig.authRedirect}});
      if(error)throw error;
    }catch(error){report(error);}
    finally{busy=false;controls();}
  });
  resend.addEventListener('click',async()=>{
    if(busy||Date.now()<retryAt||!pendingEmail)return;
    busy=true;controls();messageText('');
    try{await sendCode(pendingEmail);}catch(error){report(error);}finally{busy=false;controls();}
  });
  change.addEventListener('click',()=>{if(busy)return;pendingEmail='';setMode('email');email.focus();});
  dialog.querySelector('[data-close-auth]').addEventListener('click',()=>{if(!busy)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{code.value='';clearInterval(timer);});
  client.auth.onAuthStateChange((event,next)=>{
    // Defer work outside the SDK auth lock; listeners may load the chart library.
    if(explicitSignout&&event!=='SIGNED_IN'&&next)return;
    if(event==='SIGNED_OUT')explicitSignout=true;else if(next)explicitSignout=false;
    if(event==='INITIAL_SESSION'&&!next&&session?._backupOnly)return;
    const version=++sessionVersion;
    setTimeout(()=>{if(version!==sessionVersion)return;announce(next);if(next){pendingEmail='';if(dialog.open)dialog.close('signed-in');}},0);
  });
  const initialVersion=sessionVersion;
  const ready=client.auth.getSession().then(({data,error})=>{
    if(error){messageText(error.message,true);if(restoreBackupSession(error))return initialSession;}
    if(sessionVersion===initialVersion)announce(data?.session||null);return initialSession;
  }).catch(error=>{restoreBackupSession(error);renderAccount();return session;});
  window.TeethAuth={client,ready,restoreBackupSession,reconnectBackup,get session(){return session;},show,signOut,forgetDeletedAccount,renderAccount,refreshUser,changeEmail,setBeforeChange(handler){beforeChange=handler;},onChange(handler){listeners.add(handler);return()=>listeners.delete(handler);}};
})();
