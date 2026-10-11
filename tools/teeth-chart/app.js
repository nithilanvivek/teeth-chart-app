(async () => {
  'use strict';
  const {isHome,homePath,chartPath}=window.TeethNavigation;
  document.querySelectorAll('a.brand').forEach(link=>link.href=homePath());
  const recovery=location.hostname==='nithi.land'&&location.pathname.startsWith('/tools/teeth-chart/');
  document.querySelector('[data-old-library]').hidden=!recovery;
  document.querySelector('[data-recover-library]').hidden=location.hostname!=='teeth.nithi.land';
  try{if(!isHome()&&window.TeethNavigation.requiresSessionCheck(key=>window.localStorage.getItem(key),location.href))await window.TeethCloud.deadline(window.TeethAuth.ready,8000);}
  catch(error){
    if(!window.TeethAuth.restoreBackupSession(error)){
    window.TeethAccess.render(document,{loading:false,blocked:true,error:'Sign-in could not be checked. Please try again.'});
    document.querySelector('[data-access-retry]').addEventListener('click',()=>window.location.reload());
    document.querySelector('[data-access-signin]').addEventListener('click',()=>window.TeethAuth.show());
    window.TeethAuth.onChange(session=>{if(session)window.location.reload();});
    return;
    }
  }
  const auth=window.TeethAuth,cloud=window.TeethCloud,backup=window.TeethBackup;
  const $=selector=>document.querySelector(selector);
  const icons={
    'chevron-left':'m14 6-6 6 6 6','chevron-right':'m10 6 6 6-6 6','chevron-up':'m6 14 6-6 6 6',
    share:'M16 5l4 4-4 4M20 9H9a5 5 0 0 0-5 5v5',
    pencil:'m16 3 5 5-13 13H3v-5L16 3ZM13 6l5 5',
    home:'M3 11l9-8 9 8M5 10v11h5v-7h4v7h5V10',
    fullscreen:'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',
    trash:'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',plus:'M12 5v14M5 12h14',close:'M6 6l12 12M6 18L18 6',check:'M5 12l4 4L19 6',
    'check-circle':'M20 11v1a8 8 0 1 1-4.7-7.3M9 11l3 3 8-8',
    history:'M3 10a9 9 0 1 1 1.5 7M3 4v6h6M12 7v5l3 2',
    export:'M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7',import:'M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5',
    device:'M5 3h14v18H5zM10 18h4',chart:'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6',
    help:'M9 9a3 3 0 1 1 5 2c-1 1-2 1-2 3m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    info:'M12 16v-4m0-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    wobbly:'M4 8c3-5 5 5 8 0s5 5 8 0M4 16c3-5 5 5 8 0s5 5 8 0',
    filled:'M5 5h14v14H5zM9 9h6v6H9z',cavity:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M14 9h.01M12 13h.01M16 14h.01',
    pain:'m13 2-8 12h6l-1 8 9-13h-7z'
  };
  function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',icons[name]||icons.chart);svg.append(path);return svg;}
  document.querySelectorAll('[data-icon]').forEach(node=>node.replaceWith(icon(node.dataset.icon)));
  const {Store,TOOTH_STATUSES,SPACE_STATUSES,LABELS,COLORS,FLAGS,itemInfo,clone,parseImport}=window.TeethModel;
  let storage;
  try{storage=window.localStorage;}catch{storage={getItem(){throw new Error('Unavailable');},setItem(){throw new Error('Unavailable');}};}
  function accountStorage(){const id=auth.session?.user.id;return id?{getItem:key=>storage.getItem(key+':'+id),setItem:(key,value)=>storage.setItem(key+':'+id,value)}:storage;}
  let store=makeStore();
  let blocked=false,libraryBusy=true,cloudBusy=0,cloudError='',accountId=auth.session?.user.id||null,cloudLibrary=[],leavingPage=false;
  const deletingCharts=new Set();
  const readGuest=()=>new Store(storage);
  let syncRun=null,accountDeleting=false,welcomeTask=null;
  let homeCards=[],homeLoading=false,homeError='';
  let retryTimer=null,retryRunning=false,retryAfter=0;
  const storageKey='nithi.teeth.storage.v1';let storageChoice={primary:'browser',backup:'browser'};
  try{const saved=JSON.parse(storage.getItem(storageKey)||'null');if(saved)storageChoice={...storageChoice,...saved};}catch{}
  function rememberStorage(){try{storage.setItem(storageKey,JSON.stringify(storageChoice));}catch{}}
  function backupMessage(){return store.error?'Cloud saving is unavailable and the browser backup could not be written. '+store.error:backup.MESSAGE+(storageChoice.backup==='file'&&(!fileWriter.connected||fileWriter.error)?' Your JSON backup needs reconnecting; changes are being saved in this browser instead.':'');}
  function queueRetry(){if(retryTimer||retryRunning||(!accountId&&!store.data.charts.some(c=>c._cloud?.anonymousEdit)))return;retryTimer=setTimeout(()=>{retryTimer=null;retryCloud();},30000);}
  function markCloudFailure(chart,error){
    chart._cloudPending=true;
    if(backup.unavailable(error)){chart._cloudUnavailable=true;retryAfter=Date.now()+30000;queueRetry();}
    else{delete chart._cloudUnavailable;if(error.code==='40001'){delete chart._cloudRetryStopped;queueRetry();}else chart._cloudRetryStopped=true;}
    store.persist();
    if(chart===store.current){cloudError=backup.unavailable(error)?backupMessage():error.message;showNotice(cloudError,true);}
  }
  function replaceCloud(chart){const i=store.data.charts.findIndex(c=>c.id===chart.id);if(i>=0)store.data.charts[i]=chart;else store.data.charts.push(chart);store.persist();}
  async function retryCloud(){
    if(retryRunning||(!accountId&&!store.data.charts.some(c=>c._cloud?.anonymousEdit))||accountDeleting||tourActive)return;
    const user=accountId,target=store;autosave.flush();retryRunning=true;retryAfter=0;
    try{
      for(let chart of [...target.data.charts]){
        if(user!==accountId||target!==store)break;
        if((!accountId&&!chart._cloud?.anonymousEdit)||!backup.needsRetry(chart,cloud.signature)||deletingCharts.has(chart.id)||cloud.isDeleted(chart.id))continue;
        try{
          if(auth.session?._backupOnly){await auth.reconnectBackup();if(user!==accountId||target!==store)return;}
          if(chart._cloud){
            await cloud.flushChart(chart.id).catch(error=>{if(!backup.unavailable(error)&&error.code!=='40001')throw error;});
            const remote=await cloud.load(chart.id);if(user!==accountId||target!==store)return;
            if(!target.data.charts.includes(chart)||deletingCharts.has(chart.id)||cloud.isDeleted(chart.id))continue;
            chart=backup.reconcile(target,remote,cloud.signature);replaceCloud(chart);
          }
          if(chart._cloud?.role==='viewer'||chart._cloud?.deleteAfter){delete chart._cloudPending;delete chart._cloudUnavailable;}
          else await saveOnline(chart,{retry:true});
          if(user!==accountId||target!==store)return;
          store.persist();
          if(chart===store.current&&!isHome()){
            cloudError='';showNotice(chart._backupConflict?'Cloud saving is available again. Changes made elsewhere were kept; your offline edits are in a separate local “backup copy”.':'');
            // Do not replace a note being typed while the connection recovers.
            if(JSON.stringify(draft)===baseline)render();else renderSaveStatus();
          }
        }catch(error){if(user!==accountId||target!==store)return;if(!target.data.charts.includes(chart)||deletingCharts.has(chart.id)||cloud.isDeleted(chart.id))continue;markCloudFailure(chart,error);if(error.code==='42501'&&chart.id===cloud.routeId()){blocked=true;renderAccess();}if(backup.unavailable(error))break;}
      }
      if(isHome()){renderHome();if(!auth.session?._backupOnly)refreshHome();}
    }finally{retryRunning=false;if(store.data.charts.some(c=>(accountId||c._cloud?.anonymousEdit)&&backup.needsRetry(c,cloud.signature)))queueRetry();}
  }

  async function stageBrowserCharts(){
    if(welcomeTask)await welcomeTask;
    if(!accountId)return;
    const target=store,user=accountId;
    try{
      const staged=window.TeethSync.stage({account:store,guest:readGuest(),signature:cloud.signature});
      const local=store.data.charts.filter(chart=>!chart._starter&&!chart._cloud);
      if(local.length){
        // No uploads or edits may race the user's sign-in choice.
        for(const chart of local)chart._localOnly=true;
        store.persist();
        const choice=await showDialog({title:'Sync local charts?',build:local.length+' local chart'+(local.length===1?' is':'s are')+' available. Merge them with your cloud library without overwriting either version, or keep them local for now.',actions:[{label:'Keep local for now',value:'local'},{label:'Merge with cloud',value:'merge',primary:true}]});
        if(store!==target||accountId!==user)return;
        if(choice==='merge')for(const chart of local)delete chart._localOnly;
        store.persist();
      }
      const current=staged.find(chart=>chart._browserSource.id===cloud.routeId());
      if(current)window.history.replaceState({},'', chartPath(current.id));
    }catch(error){showNotice('Browser charts are still saved locally. '+error.message,true);}
  }
  function syncBrowserCharts(){
    if(tourActive||auth.session?._backupOnly||Date.now()<retryAfter||!accountId||syncRun?.account===accountId)return;
    const target=store,user=accountId,run={account:user};syncRun=run;
    const isCurrent=()=>!accountDeleting&&accountId===user&&store===target;
    (async()=>{
      let failed=0;
      const pending=target.data.charts.filter(chart=>!chart._starter&&!chart._localOnly&&(!chart._cloud||chart._browserSource));
      for(const chart of pending){
        if(!isCurrent())break;
        if(!target.data.charts.includes(chart)||deletingCharts.has(chart.id)||cloud.isDeleted(chart.id))continue;
        const oldId=chart.id;cloudBusy++;renderSaveStatus();
        try{
          if(!await window.TeethSync.upload({chart,cloud,isCurrent}))break;
          delete chart._cloudPending;delete chart._cloudUnavailable;delete chart._cloudRetryStopped;if(chart===store.current)cloudError='';
          if(target.data.currentId===oldId)target.data.currentId=chart.id;
          if(!target.persist())throw new Error(target.error);
          window.TeethSync.finish({chart,account:target,readGuest,signature:cloud.signature});
          if(!blocked&&!libraryBusy){renderLibrary();updateRoute();}if(isHome())refreshHome();
        }catch(error){if(isCurrent()&&!deletingCharts.has(chart.id)&&!cloud.isDeleted(chart.id)){failed++;markCloudFailure(chart,error);}}
        finally{cloudBusy--;if(isCurrent())renderSaveStatus();}
      }
      if(isCurrent()&&failed)queueRetry();
    })().finally(()=>{if(syncRun===run)syncRun=null;});
  }
  const canEdit=()=>!isHome()&&!accountDeleting&&!blocked&&!libraryBusy&&!deletingCharts.has(store.current.id)&&store.current._cloud?.role!=='viewer'&&!store.current._cloud?.unloaded;
  function showNotice(text,error=false){const el=$('[data-cloud-notice]');el.textContent=text;el.hidden=!text;el.classList.toggle('error',error);}
  function updateRoute(){if(!isHome()&&!blocked&&!libraryBusy)window.history.replaceState({},'',chartPath(store.current.id));}
  function cacheChart(chart){const index=store.data.charts.findIndex(item=>item.id===chart.id);if(index<0)store.data.charts.push(chart);else store.data.charts[index]=chart;store.data.currentId=chart.id;store.persist();}
  async function saveOnline(chart=store.current,{retry=false}={}){
    if(accountId!==(auth.session?.user.id||null)||accountDeleting||chart._localOnly||deletingCharts.has(chart.id)||cloud.isDeleted(chart.id))return;
    if((!auth.session&&!chart._cloud?.anonymousEdit)||chart._cloud?.role==='viewer'||chart._cloud?.unloaded)return;
    const ownerAccount=accountId,target=store;
    chart._cloudPending=true;store.persist();
    // Keep the browser backup recoverable without starting network work during teardown.
    if(leavingPage)return;
    if(!retry&&(auth.session?._backupOnly||Date.now()<retryAfter)){chart._cloudUnavailable=true;store.persist();if(chart===store.current){cloudError=backupMessage();showNotice(cloudError,true);renderSaveStatus();}queueRetry();return;}
    cloudBusy++;renderSaveStatus();
    try{
      await cloud.save(chart);
      if(accountId===ownerAccount&&target===store){delete chart._cloudPending;delete chart._cloudUnavailable;delete chart._cloudRetryStopped;store.persist();if(chart===store.current){cloudError='';showNotice('');}}
    }catch(error){
      if(accountId!==ownerAccount||target!==store||chart._localOnly||deletingCharts.has(chart.id)||cloud.isDeleted(chart.id))return;
      markCloudFailure(chart,error);if(error.code==='42501'){blocked=true;renderAccess();}throw error;
    }finally{cloudBusy--;renderSaveStatus();}
  }
  let selectedKey='upper_tooth_8',mode='tooth',preview=null,draft={},baseline='',toastTimer;
  const form=$('[data-annotation-form]');
  const displayedAnnotations=()=>preview?.snapshot||store.current.annotations;
  function renderChart(){window.TeethDiagram.render($('[data-tooth-chart]'),{annotations:displayedAnnotations(),selectedKey,mode,onSelect:selectItem,preview:Boolean(preview)});}
  function renderLibrary(){
    $('[data-chart-list]').replaceChildren();$('[data-chart-select]').replaceChildren();
    auth.renderAccount();
    if(isHome()){renderHome();return;}
    const sharedOnline=!auth.session&&store.current._cloud?.anonymousEdit,localFile=!auth.session&&fileWriter.connected&&!fileWriter.error;
    $('[data-library-location]').textContent=auth.session?'Your cloud library':sharedOnline?'Shared cloud chart':localFile?'Saved to local file':'Only saved on this browser profile.';
    $('[data-library-hint]').textContent=auth.session?'Synced when changes are saved.':sharedOnline?'Changes save online without signing in.':localFile?fileWriter.link.handle.name:'Charts may be lost! Sign in to save with cloud.';
    $('.local-storage').classList.toggle('storage-local',!auth.session&&!sharedOnline&&!localFile);
    $('.local-storage').classList.toggle('storage-cloud',Boolean(auth.session||sharedOnline||localFile));
    for(const chart of store.data.charts){
      const button=document.createElement('button');button.type='button';button.disabled=deletingCharts.has(chart.id);button.setAttribute('aria-current',String(chart.id===store.current.id));
      const content=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('small');title.textContent=chart.name;detail.textContent=deletingCharts.has(chart.id)?'Deleting chart…':chart._localOnly?'Local only':chart._cloud?.unloaded?'Shared chart':`${Object.keys(chart.annotations).length} annotated${chart._cloud?.role==='viewer'?' · Viewer':''}`;content.append(title,detail);button.append(icon('chart'),content);button.addEventListener('click',()=>switchChart(chart.id));const row=document.createElement('div');row.className='chart-list-row';row.append(button);
      if(!chart._cloud||chart._cloud.role==='owner'){
        const remove=document.createElement('button');remove.type='button';remove.className='icon-button delete-chart';remove.title='Delete chart';remove.disabled=deletingCharts.has(chart.id);remove.setAttribute('aria-label','Delete '+chart.name);remove.append(icon('trash'));remove.addEventListener('click',()=>deleteChart(chart.id));row.append(remove);
      }
      $('[data-chart-list]').append(row);
      const option=new Option(chart.name,chart.id);option.disabled=deletingCharts.has(chart.id);$('[data-chart-select]').add(option);
    }
    $('[data-chart-select]').value=store.current.id;
    $('[data-chart-name]').textContent=store.current.name;
    document.title=`${store.current.name} · Teeth Chart App`;
  }
  function fillEditor(){
    const info=itemInfo(selectedKey),existing=displayedAnnotations()[selectedKey];
    draft=existing?clone(existing):{item_type:info.type,status:'',wobbly:false,filled:false,cavity:false,painful:false,note:''};
    baseline=JSON.stringify(draft);
    $('[data-selection-number]').textContent=info.permanent;
    $('[data-selection-name]').textContent=info.name;
    $('[data-selection-location]').textContent=`${info.location} · ${info.label}`;
    $('[data-fdi-detail]').textContent=info.type==='tooth'?`Permanent ${info.permanent}${info.primary?' · Milk '+info.primary:''}`:`${info.arch==='upper'?'Above':'Below'} tooth ${info.permanent}${info.primary?' · Milk '+info.primary:''}`;
    $('[data-annotation-state]').textContent=existing?'Annotated':'Unmarked';$('[data-annotation-state]').classList.toggle('marked',Boolean(existing));
    const options=$('[data-status-options]');options.replaceChildren();
    for(const status of info.type==='tooth'?TOOTH_STATUSES:SPACE_STATUSES){
      const label=document.createElement('label');label.className='status-option';
      const input=document.createElement('input');input.type='radio';input.name='status';input.value=status;input.checked=draft.status===status;input.required=true;
      const swatch=document.createElement('span');swatch.className='swatch';swatch.style.setProperty('--swatch',COLORS[status]);label.append(input,swatch,document.createTextNode(LABELS[status]));options.append(label);
    }
    $('[data-modifiers]').hidden=info.type!=='tooth';
    FLAGS.forEach(flag=>{form.elements[flag].checked=draft[flag];});form.elements.note.value=draft.note;
    $('[data-action="remove"]').hidden=!existing||Boolean(preview);
    $('[data-save-label]').textContent='Save now';
    form.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=Boolean(preview)||!canEdit());
    renderSaveStatus();
  }
  function renderSaveStatus(){
    renderCloudStatus();
    const el=$('[data-save-status]');const dirty=JSON.stringify(draft)!==baseline;
    form.querySelector('.save-button').disabled=!dirty||Boolean(preview)||!canEdit();
    el.replaceChildren(icon(store.error?'info':dirty?'info':'check-circle'),document.createTextNode(deletingCharts.has(store.current.id)?'Deleting chart…':store.error?'Local backup unavailable':cloudError?(store.current._cloudUnavailable?'Saved in backup · cloud sync pending':'Cloud save failed'):cloudBusy?'Saving online…':store.error?'Local backup unavailable':preview?'History preview':!canEdit()?'View only':dirty?(draft.status?'Saving…':'Choose a status to save'):store.current._cloudPending||store.current._cloudUnavailable?'Saved in backup · cloud sync pending':store.current._cloud?.revision?'Saved online':store.current._localOnly?'Saved locally':auth.session?'Not yet saved online':'Saved in this browser'));
    el.classList.toggle('dirty',dirty||Boolean(store.error));
    $('[data-storage-error]').hidden=!store.error;$('[data-storage-error]').textContent=store.error||'';
  }
  const requestedAccess=new Set();let requestingAccess=false,accessError='';
  const requestKey=()=>`${auth.session?.user.id||''}:${cloud.routeId()||''}`;
  function renderAccess(){
    $('[data-library-home]').hidden=!isHome();
    if(isHome()){$('.app-shell').hidden=true;$('[data-access-gate]').hidden=true;return;}
    window.TeethAccess.render(document,{loading:libraryBusy,blocked,local:Boolean((!auth.session||cloud.routeId())&&window.TeethNavigation.localChart(store,cloud.routeId()||store.current.id)),email:auth.session?.user.email||'',requested:requestedAccess.has(requestKey()),requesting:requestingAccess,error:accessError});}
  $('[data-access-retry]').addEventListener('click',()=>loadLibrary());
  $('[data-access-signin]').addEventListener('click',()=>auth.show());
  $('[data-request-access]').addEventListener('click',async()=>{
    if(!auth.session){auth.show();return;}
    const id=cloud.routeId(),key=requestKey();if(!id||requestingAccess||requestedAccess.has(key))return;
    requestingAccess=true;accessError='';renderAccess();
    try{const result=await cloud.requestAccess(id);if(key!==requestKey())return;if(result.status==='has_access'){await loadLibrary();}else requestedAccess.add(key);}
    catch(error){if(key===requestKey())accessError=error.code==='PGRST202'?'Access requests are not available yet. Please try again shortly.':error.message;}
    finally{requestingAccess=false;renderAccess();}
  });
  function render(){
    renderAccess();renderFileStatus();if(isHome()){renderHome();return;}if(blocked||libraryBusy)return;
    renderLibrary();renderChart();fillEditor();
    $('[data-mark-count]').textContent=`${Object.keys(displayedAnnotations()).length} of 64 items annotated`;
    document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
    $('[data-preview-banner]').hidden=!preview;
    if(preview)$('[data-preview-time]').textContent=new Date(preview.edited_at).toLocaleString();
    $('[data-action="clear"]').disabled=Boolean(preview)||!canEdit()||!Object.keys(store.current.annotations).length;
    $('[data-action="rename"]').disabled=!canEdit();
    $('[data-action="import"]').disabled=Boolean(preview)||!canEdit();
    $('[data-action="delete-chart"]').hidden=Boolean(store.current._cloud&&store.current._cloud.role!=='owner');
    $('[data-action="restore"]').disabled=!canEdit();
    document.body.classList.toggle('read-only',!canEdit());
    $('.chart-card').hidden=blocked;$('.inspector').hidden=blocked;
    updateRoute();
  }
  function readDraft(){
    draft={item_type:itemInfo(selectedKey).type,status:form.elements.status.value,...Object.fromEntries(FLAGS.map(flag=>[flag,itemInfo(selectedKey).type==='tooth'&&form.elements[flag].checked])),note:form.elements.note.value};
    renderSaveStatus();
  }
  function toast(message,warning=false){
    clearTimeout(toastTimer);const el=$('[data-toast]');el.replaceChildren(icon(warning?'info':'check-circle'),document.createTextNode(message));el.hidden=false;
    toastTimer=setTimeout(()=>{el.hidden=true;},4500);
  }
  const afterSave=async message=>{
    const chart=store.current;
    try{await saveOnline(chart);if(!cloudError)showNotice(chart._cloud?.role==='viewer'?'You have view-only access.':'');toast(store.error?(auth.session?'Your changes are online; the browser backup could not be saved.':'The browser could not save your changes. Keep this tab open or export a backup.'):message,Boolean(store.error));}
    catch{if(!store.current._cloudUnavailable)toast('Cloud save failed. Keep this tab open or export your changes.',true);}
  };
  function showDialog({title,build,actions,iconSrc}){
    const dialog=$('[data-dialog]');
    if(dialog.open)return Promise.resolve('cancel');
    $('#dialog-title').textContent=title;
    if(iconSrc){const brand=document.createElement('img');brand.src=iconSrc;brand.alt='';brand.width=40;brand.height=40;brand.className='dialog-brand-icon';$('#dialog-title').prepend(brand);}
    dialog.returnValue='';
    const body=$('[data-dialog-body]'),footer=$('[data-dialog-actions]');body.replaceChildren();footer.replaceChildren();
    if(typeof build==='function')build(body);else body.textContent=build;
    for(const action of actions){const button=document.createElement('button');button.type='button';button.className=`button${action.primary?' primary':''}${action.danger?' danger':''}`;button.textContent=action.label;button.dataset.result=action.value;button.addEventListener('click',()=>{if(action.validate && !action.validate())return;dialog.close(action.value);});footer.append(button);}
    return new Promise(resolve=>{
      const onEnter=event=>{if(event.key==='Enter'&&event.target.matches('input[type="text"], input[type="email"]')){event.preventDefault();footer.querySelector('.primary')?.click();}};
      dialog.addEventListener('keydown',onEnter);
      dialog.addEventListener('close',()=>{dialog.removeEventListener('keydown',onEnter);resolve(dialog.returnValue||'cancel');},{once:true});
      dialog.showModal();body.querySelector('input')?.focus();
    });
  }
  const autosave=window.TeethAutosave.create({commit(edit){
    if(edit.account!==accountId||edit.chart!==store.current.id||edit.key!==selectedKey||preview||!canEdit())return;
    commitAnnotation(false);
  }});
  function scheduleAnnotation(event){
    if(!canEdit()||preview)return;
    readDraft();
    if(!draft.status||JSON.stringify(draft)===baseline){autosave.cancel();return;}
    autosave.schedule({account:accountId,chart:store.current.id,key:selectedKey});
    if(event.type==='change')autosave.flush();
  }
  async function confirmDiscard(){
    if(isHome())return true;
    autosave.flush();
    if(JSON.stringify(draft)===baseline||preview||blocked)return true;
    const result=await showDialog({title:'Save your annotation?',build:draft.status?'You have changes to this item. Save them before moving on, or discard this edit.':'Choose a status before these changes can be saved. Go back to choose one, or discard this edit.',actions:[{label:'Discard changes',value:'discard'},{label:draft.status?'Cancel':'Back to annotation',value:'cancel'},...(draft.status?[{label:'Save changes',value:'save',primary:true}]:[])]});
    if(result==='save')saveAnnotation();
    if(result==='discard')fillEditor();
    return result==='save'||result==='discard';
  }
  async function selectItem(key,focus=false){
    if(!itemInfo(key)||key===selectedKey)return;
    if(!(await confirmDiscard()))return;
    selectedKey=key;mode=itemInfo(key).type;render();
    if(focus)$(`[data-item-key="${key}"]`)?.focus({preventScroll:true});
    if(!focus&&window.matchMedia('(max-width: 720px)').matches) $('.inspector').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  }
  async function switchChart(id){
    if(!(await confirmDiscard())){$('[data-chart-select]').value=store.current.id;return;}
    try{if(!store.current._cloudUnavailable)await cloud.flushChart(store.current.id).catch(error=>{if(!backup.unavailable(error))throw error;});if(cloudError&&!store.current._cloudUnavailable)throw new Error(cloudError);
      if(cloud.routeId()!==id)window.history.pushState({},'', chartPath(id));
      preview=null;cloudError='';await loadLibrary();
    }catch(error){showNotice(error.message,true);}

  }
  function commitAnnotation(manual){
    if(preview||!canEdit())return;
    readDraft();if(!draft.status){if(manual)form.reportValidity();return;}
    const changed=store.annotate(selectedKey,{...draft,note:draft.note.trim()});baseline=JSON.stringify(draft);
    // Update the chart without replacing the active note input or moving its caret.
    renderLibrary();renderChart();$('[data-mark-count]').textContent=`${Object.keys(store.current.annotations).length} of 64 items annotated`;
    $('[data-annotation-state]').textContent='Annotated';$('[data-annotation-state]').classList.add('marked');$('[data-action="remove"]').hidden=false;renderSaveStatus();
    if(manual)afterSave(changed?'Annotation saved':'Annotation is up to date');
    else if(changed||cloudError)saveOnline().catch(()=>{});
  }
  function saveAnnotation(){autosave.cancel();commitAnnotation(true);}
  async function deleteChart(id=store.current.id){
    if(libraryBusy||blocked||deletingCharts.has(id))return;
    const target=store,deletingAccount=accountId,chart=target.data.charts.find(item=>item.id===id);
    if(!chart||chart._cloud&&chart._cloud.role!=='owner')return;
    const active=()=>store===target&&accountId===deletingAccount;
    // Count the charts shown in this view, excluding the chart being deleted.
    // The automatic first chart is visible in the workspace but hidden at home.
    const lastChart=()=>!target.data.charts.some(item=>item.id!==id&&(!isHome()||!item._starter)&&!deletingCharts.has(item.id));
    const explainLastChart=()=>showDialog({title:'Cannot delete the last chart',build:'You can’t delete your only chart. Create another chart first.',actions:[{label:'OK',value:'ok',primary:true}]});
    if(lastChart()){await explainLastChart();return;}
    if(!(await confirmDiscard()))return;
    const result=await showDialog({title:'Delete “'+chart.name+'”?',build:chart._cloud?'This chart will be removed from your library. Collaborators have 30 days to make a copy of this chart using its existing link. During that time, it is read-only. After 30 days it and its history are permanently deleted.':'This permanently deletes the chart and its history from this browser. This cannot be undone.',actions:[{label:'Cancel',value:'cancel'},{label:'Delete chart',value:'delete',danger:true}]});
    if(result!=='delete'||!active())return;
    if(lastChart()){await explainLastChart();return;}
    deletingCharts.add(id);
    if(store.current.id===id)render();else renderLibrary();
    let removed=false,wasCurrent=false;
    try{
      if(!chart._cloud&&target.error)throw new Error(target.error);
      try{await cloud.deleteChart(chart);}
      catch(error){
        if(error.code!=='40001'||!active())throw error;
        const latest=await cloud.deleteInfo(id);
        if(!active())return;
        if(latest){
          const choice=await showDialog({title:'This chart has changed',build:'“'+latest.name+'” has a newer saved version. Delete that version and all its history?',actions:[{label:'Cancel',value:'cancel'},{label:'Delete latest version',value:'delete',danger:true}]});
          if(choice!=='delete'||!active())return;
          await cloud.deleteChart(chart,{revision:latest.revision});
        }else await cloud.deleteChart(chart);
      }
      if(!active())return;
      wasCurrent=!isHome()&&target.current.id===id;
      if(wasCurrent)++loadEpoch;
      target.deleteChart(id);removed=true;homeCards=homeCards.filter(item=>item.id!==id);cloudLibrary=cloudLibrary.filter(item=>item.id!==id);
      // Retire an unchanged guest original too, so background sign-in import
      // cannot recreate the draft the user just chose to delete.
      if(chart._browserSource){
        const guest=readGuest(),source=guest.data.charts.find(item=>item.id===chart._browserSource.id);
        if(source&&!guest.writeBlocked&&cloud.signature(source)===chart._browserSource.hash)guest.deleteChart(source.id);
      }
      if(wasCurrent){preview=null;cloudError='';window.history.replaceState({},'', chartPath(target.current.id));}
      toast('Chart deleted');
    }catch(error){
      if(active())showNotice(error.code==='TIMEOUT'?'Deletion could not be confirmed. Check your connection and try deleting again.':error.code==='40001'?'The chart changed again. Please retry deletion.':error.message,true);
    }finally{
      deletingCharts.delete(id);
      if(active()&&!libraryBusy&&!blocked){if(!removed&&target.current.id===id)render();else if(!wasCurrent)renderLibrary();}
    }
    if(!active()||!removed)return;
    // Deletion is already successful. A failure opening the next chart must not
    // be reported as a failed delete or leave the URL pointing at the old chart.
    if(wasCurrent){await loadLibrary();if(active()&&blocked)toast('Chart deleted. The next chart could not be opened.',true);}
    if(active()&&target.error)showNotice('Chart deleted, but the browser backup could not be updated. Reload saved charts before continuing.',true);
  }
  async function newChart({tour=false,template=null}={}){
    if(!(await confirmDiscard()))return;
    const target=store,account=accountId;
    let input,error;
    const result=await showDialog({title:template?`New ${template.name.toLowerCase()} chart`:'New chart',build(body){
      const label=document.createElement('label');label.textContent='Chart name';input=document.createElement('input');input.type='text';input.placeholder='e.g. My dental chart';input.maxLength=120;input.autocomplete='off';label.append(input);
      if(template){const base=template.name+' chart';let name=base,suffix=2;while(store.data.charts.some(c=>c.name.toLocaleLowerCase()===name.toLocaleLowerCase()))name=base+' '+suffix++;input.value=name;}
      const help=document.createElement('p');help.textContent=template?`${template.description}. Choose a name for your new chart.`:tour?'Choose a new name. You’ll use this chart during the tour and can keep it afterwards.':'Choose a name to create a chart, or enter an existing name to open it.';help.style.marginTop='12px';error=document.createElement('p');error.className='dialog-error';error.setAttribute('role','alert');body.append(label,help,error);
    },actions:[{label:'Cancel',value:'cancel'},{label:template?'Create chart':'Open chart',value:'create',primary:true,validate(){if(!input.value.trim()){error.textContent='Give your chart a name.';input.focus();return false;}if((tour||template)&&store.data.charts.some(c=>c.name.toLocaleLowerCase()===input.value.trim().toLocaleLowerCase())){error.textContent=template?'A chart already uses this name. Choose a new name.':'Choose a new name for your tour chart.';input.focus();return false;}return true;}}]});
    if(result!=='create'||target!==store||account!==accountId)return;
    const exists=store.data.charts.find(chart=>chart.name.toLocaleLowerCase()===input.value.trim().toLocaleLowerCase());
    if(exists){await switchChart(exists.id);return;}
    store.create(input.value);
    if(template)store.commit(window.TeethModel.templateAnnotations(template.id),`Created from ${template.name} template`);
    window.history.pushState({},'', chartPath(store.current.id));blocked=false;preview=null;selectedKey='upper_tooth_8';mode='tooth';render();afterSave('New chart created');return true;
  }
  async function renameChart(){
    if(!canEdit()||!(await confirmDiscard()))return;
    let input,error;
    const result=await showDialog({title:'Rename chart',build(body){
      const label=document.createElement('label');label.textContent='Chart name';input=document.createElement('input');input.type='text';input.maxLength=120;input.autocomplete='off';input.value=store.current.name;label.append(input);
      error=document.createElement('p');error.className='dialog-error';error.setAttribute('role','alert');body.append(label,error);
    },actions:[{label:'Cancel',value:'cancel'},{label:'Rename',value:'rename',primary:true,validate(){
      try{store.rename(input.value);return true;}
      catch(problem){error.textContent=problem.message;input.focus();return false;}
    }}]});
    if(result==='rename'){render();afterSave('Chart renamed');}
  }
  async function clearChart(){
    if(preview||!canEdit()||!Object.keys(store.current.annotations).length)return;
    if(!(await confirmDiscard()))return;
    const result=await showDialog({title:'Clear this chart?',build:`Remove all annotations from “${store.current.name}”? Earlier versions will remain available in History.`,actions:[{label:'Cancel',value:'cancel'},{label:'Clear chart',value:'clear',danger:true}]});
    if(result==='clear'){store.clear();render();afterSave('Chart cleared. Its earlier version is in History.');}
  }
  async function history(){
    if(!(await confirmDiscard()))return;
    const entries=store.current.history;let selected=entries[0];
    const result=await showDialog({title:'Chart history',build(body){
      if(!entries.length){const empty=document.createElement('div');empty.className='empty-history';const title=document.createElement('strong');title.textContent='Your chart’s story starts here';const p=document.createElement('p');p.textContent='Save an annotation to create the first version.';empty.append(icon('history'),title,p);body.append(empty);return;}
      const intro=document.createElement('p');intro.textContent=`${store.current.name} · ${entries.length} saved versions. Preview a version before restoring it.`;body.append(intro);
      const list=document.createElement('div');list.className='history-list';
      for(const [index,entry] of entries.entries()){
        const button=document.createElement('button');button.type='button';button.className='history-row';button.setAttribute('aria-pressed',String(index===0));
        const content=document.createElement('span'),title=document.createElement('strong'),time=document.createElement('small'),count=document.createElement('span');title.textContent=entry.action_label;time.textContent=new Date(entry.edited_at).toLocaleString();count.textContent=`${Object.keys(entry.snapshot).length} marked`;count.className='history-count';content.append(title,time);button.append(icon('history'),content,count);
        button.addEventListener('click',()=>{selected=entry;list.querySelectorAll('button').forEach(row=>row.setAttribute('aria-pressed',String(row===button)));});list.append(button);
      }
      body.append(list);
    },actions:entries.length?[{label:'Cancel',value:'cancel'},{label:'Preview version',value:'preview'},...(canEdit()?[{label:'Restore version',value:'restore',primary:true}]:[])]:[{label:'Done',value:'cancel',primary:true}]});
    if(result==='preview'){preview=clone(selected);render();toast('Previewing history. Your current chart is unchanged.');}
    if(result==='restore'&&canEdit()){store.restore(selected);preview=null;render();afterSave('Version restored');}
  }
  function exportChart(){
    if(blocked)return;
    const payload=store.exportPayload(displayedAnnotations());const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=(store.current.name.replace(/[^a-zA-Z0-9_ .-]/g,'_')||'teeth-chart')+(preview?' - history':'')+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(preview?'History version exported':'Chart exported');
  }
  async function downloadLibrary(){
    if(!await confirmDiscard())return;
    autosave.flush();
    const charts=store.data.charts.filter(chart=>!chart._starter&&!chart._cloud?.unloaded);
    if(!charts.length){toast('No charts are saved in this browser library.',true);return;}
    const text=window.TeethLocalFile.encode(charts,store.data.currentId,cloud);
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='Teeth Chart browser backup.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Backup downloaded. Open teeth.nithi.land and choose Import Backup JSON file.');
  }
  async function importChart(file){
    const target=store,account=accountId,chart=store.current;
    const active=()=>target===store&&account===accountId&&store.current===chart&&!preview&&canEdit();
    try{
      if(!active())return;
      if(file.size>5*1024*1024)throw new Error('Choose a chart JSON file smaller than 5 MB.');
      let payload;try{payload=JSON.parse(await file.text());}catch{throw new Error('This file is not valid JSON. Please choose a Teeth Chart export.');}
      if(payload?.format==='online-teeth-chart-app')throw new Error('This is a backup file. Use “Import Backup JSON file” to restore its charts.');
      const parsed=parseImport(payload);
      if(!active())return;
      const result=await showDialog({title:'Replace current chart?',build(body){
        const summary=document.createElement('p');summary.textContent=`Importing this file will overwrite all annotations in “${chart.name}”. Its name and sharing settings will stay the same. The previous contents will remain available in History.`;
        const visual=document.createElement('div');visual.className='library-preview';visual.setAttribute('role','img');visual.setAttribute('aria-label','Preview of imported chart');visual.append(window.TeethLibrary.preview(parsed.annotations));
        const count=document.createElement('p');count.textContent=`${Object.keys(parsed.annotations).length} annotations${parsed.skipped?` · ${parsed.skipped} unsupported entries will be skipped`:''}`;
        body.append(summary,visual,count);
      },actions:[{label:'Cancel',value:'cancel'},{label:'Replace current chart',value:'replace',danger:true}]});
      if(result!=='replace'||!active())return;
      store.commit(parsed.annotations,'Imported chart from JSON');
      render();await afterSave('Chart replaced. Its previous contents are in History.');
    }catch(error){await showDialog({title:'Could not import chart',build:error.message,actions:[{label:'OK',value:'cancel',primary:true}]});}
    finally{$('[data-import-chart-file]').value='';}
  }
  async function importBackup(file){
    const target=store,account=accountId;
    try{
      if(file.size>100*1024*1024)throw new Error('Choose a JSON file smaller than 100 MB.');
      const text=await file.text();let payload;try{payload=JSON.parse(text);}catch{throw new Error('This file is not valid JSON. Please choose a Teeth Chart export or library file.');}
      const library=payload?.format==='online-teeth-chart-app';
      if(!library&&file.size>5*1024*1024)throw new Error('Choose a chart JSON file smaller than 5 MB.');
      const charts=library?window.TeethLocalFile.decode(text,window.TeethModel,cloud).charts:[parseImport(payload)];
      if(target!==store||account!==accountId)return;
      const names=new Set(store.data.charts.map(c=>c.name.toLocaleLowerCase())),inputs=[];let error;
      const result=await showDialog({title:charts.length===1?'Import chart':`Import ${charts.length} charts`,build(body){
        const summary=document.createElement('p');summary.textContent='Review each preview and name, then confirm. All charts will be added as new copies. Existing charts and their sharing settings stay unchanged.';body.append(summary);
        charts.forEach((chart,index)=>{
          const row=document.createElement('section');row.className='import-chart-row';
          const visual=document.createElement('div');visual.className='library-preview';visual.setAttribute('role','img');visual.setAttribute('aria-label',`Preview of chart ${index+1}`);visual.append(window.TeethLibrary.preview(chart.annotations));
          const details=document.createElement('div');details.className='import-chart-details';const label=document.createElement('label');label.textContent=charts.length===1?'Save as':`Chart ${index+1} name`;
          const input=document.createElement('input');input.type='text';input.maxLength=120;
          const base=(chart.name||file.name.replace(/\.json$/i,'')||'Imported chart').slice(0,120);let name=base,suffix=2;
          while(names.has(name.toLocaleLowerCase())){const ending=` (imported ${suffix++})`;name=base.slice(0,120-ending.length)+ending;}names.add(name.toLocaleLowerCase());input.value=name;input.addEventListener('input',()=>{if(error)error.textContent='';});inputs.push(input);label.append(input);
          const count=document.createElement('p');count.textContent=`${Object.keys(chart.annotations).length} annotation${Object.keys(chart.annotations).length===1?'':'s'}${chart.skipped?` · ${chart.skipped} unsupported entries will be skipped`:''}`;
          details.append(label,count);row.append(visual,details);body.append(row);
        });
        error=document.createElement('p');error.className='dialog-error';error.setAttribute('role','alert');body.append(error);
      },actions:[{label:'Cancel',value:'cancel'},{label:charts.length===1?'Import chart':`Import all ${charts.length} charts`,value:'import',primary:true,validate(){
        const used=new Set(store.data.charts.map(c=>c.name.toLocaleLowerCase()));
        for(const input of inputs){const name=input.value.trim();if(!name||used.has(name.toLocaleLowerCase())){error.textContent=!name?'Give every chart a name.':'Use a different name for each chart, including charts already in your library.';input.focus();return false;}used.add(name.toLocaleLowerCase());}return true;
      }}]});
      if(result!=='import'||target!==store||account!==accountId)return;
      // Stage the complete import before publishing it to browser/file/cloud storage.
      const staged=new Store({getItem:()=>JSON.stringify(target.data),setItem(){}}),added=[];
      if(staged.writeBlocked)throw new Error('Your existing library could not be read. No charts were imported.');
      charts.forEach((chart,index)=>{
        staged.importChart({annotations:chart.annotations},inputs[index].value.trim());
        if(library)staged.current.history=clone(chart.history);
        added.push(staged.current);
      });
      target.data=staged.data;target.persist();
      window.history.pushState({},'',charts.length>1?homePath():chartPath(store.current.id));blocked=false;libraryBusy=false;preview=null;selectedKey='upper_tooth_8';mode='tooth';render();
      toast(`${added.length} chart${added.length===1?'':'s'} imported`,Boolean(store.error));
      await Promise.allSettled(added.map(chart=>saveOnline(chart)));
      if(target===store&&account===accountId){if(isHome())refreshHome();else renderSaveStatus();}
    }catch(error){await showDialog({title:'Could not import chart',build:error.message,actions:[{label:'OK',value:'cancel',primary:true}]});}
    finally{$('[data-import-file]').value='';}
  }
  async function reloadSaved(){
    if(!(await confirmDiscard()))return;
    if(store.error){const result=await showDialog({title:'Reload saved charts?',build:'Changes that could not be saved will be lost. Export a copy before reloading if you want to keep them.',actions:[{label:'Cancel',value:'cancel'},{label:'Reload',value:'reload',primary:true}]});if(result!=='reload')return;}
    await cloud.flush().catch(()=>{});
    store=makeStore();preview=null;cloudError='';await loadLibrary();toast('Charts reloaded');
  }
  form.addEventListener('input',scheduleAnnotation);
  form.addEventListener('change',scheduleAnnotation);
  form.addEventListener('submit',event=>{event.preventDefault();saveAnnotation();});
  $('[data-close-dialog]').addEventListener('click',()=>$('[data-dialog]').close('cancel'));
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',async()=>{
    if(button.dataset.mode===mode)return;if(!(await confirmDiscard()))return;
    const info=itemInfo(selectedKey);mode=button.dataset.mode;selectedKey=`${info.arch}_${mode}_${info.index+1}`;render();
  }));
  $('[data-chart-select]').addEventListener('change',event=>switchChart(event.target.value));
  function adjacentItem(delta){const info=itemInfo(selectedKey);const position=(info.arch==='upper'?0:16)+info.index;const next=(position+delta+32)%32;selectItem(`${next<16?'upper':'lower'}_${info.type}_${next%16+1}`);}
  const actions={'download-library':downloadLibrary,help:restartTour,copy:copyChart,home:async()=>{if(!(await confirmDiscard()))return;autosave.flush();await exitFullscreen();window.history.pushState({},'', homePath());await loadLibrary();},'previous-item':()=>adjacentItem(-1),'next-item':()=>adjacentItem(1),'back-to-chart':()=>$('.chart-card').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}),new:newChart,rename:renameChart,'delete-chart':()=>deleteChart(),clear:clearChart,history,export:async()=>{if(await confirmDiscard())exportChart();},
    import:async()=>{if(!preview&&canEdit()&&await confirmDiscard())$('[data-import-chart-file]').click();},
    'import-backup':async()=>{if(await confirmDiscard())$('[data-import-file]').click();},
    remove:async()=>{if(preview||!canEdit())return;const result=await showDialog({title:'Remove annotation?',build:`Remove the saved annotation from ${itemInfo(selectedKey).label}? You can restore it from History.`,actions:[{label:'Cancel',value:'cancel'},{label:'Remove',value:'remove',danger:true}]});if(result==='remove'){store.remove(selectedKey);render();afterSave('Annotation removed');}},
    'exit-preview':()=>{preview=null;render();},restore:()=>{if(preview&&canEdit()){store.restore(preview);preview=null;render();afterSave('Version restored');}},reload:reloadSaved,share:shareChart,account:accountDialog,storage:storageOptions,fullscreen:enterFullscreen,'exit-fullscreen':exitFullscreen};
  document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>actions[button.dataset.action]?.()));
  window.TeethLibrary.renderTemplates($('[data-template-gallery]'),template=>newChart({template}));
  $('[data-import-chart-file]').addEventListener('change',event=>{if(event.target.files?.[0])importChart(event.target.files[0]);});
  $('[data-import-file]').addEventListener('change',event=>{if(event.target.files?.[0])importBackup(event.target.files[0]);});
  window.addEventListener('beforeunload',event=>{if((!isHome()&&JSON.stringify(draft)!==baseline)||store.error||cloudBusy||(cloudError&&!store.current._cloudUnavailable)||fileTimer||filePreparing||fileWriter.pending||fileWriter.error){event.preventDefault();event.returnValue='';}});
  window.addEventListener('keydown',event=>{
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'&&!$('[data-dialog]').open){event.preventDefault();saveAnnotation();}
  });
  const fileCache=new Map();let fileTimer=null,fileWork=Promise.resolve(),filePreparing=false,filePicking=false;
  const fileConnections=new window.TeethLocalFile.Connections();
  let rememberedFile=null,rememberedFileError='',fileConnectionEpoch=0,fileMemoryError=false,fileRestoreChecked=false,fileReconnectOffered=false;
  const fileWriter=new window.TeethLocalFile.Writer(()=>renderFileStatus(),async link=>{
    if(leavingPage||fileWriter.link!==link||link.scope!==(accountId||'guest'))return;
    if(!fileMemoryError&&rememberedFile?.handle===link.handle&&rememberedFile.text===link.text)return;
    const record={handle:link.handle,text:link.text};
    rememberedFile={...record,scope:link.scope};rememberedFileError='';fileRestoreChecked=true;
    try{await fileConnections.set(link.scope,record);fileMemoryError=false;}
    catch{fileMemoryError=true;}
  });
  async function forgetLocalFile(){
    const scope=accountId||'guest';fileConnectionEpoch++;rememberedFile=null;rememberedFileError='';fileRestoreChecked=false;fileReconnectOffered=true;
    fileWriter.disconnect();await fileConnections.delete(scope).catch(()=>{});
  }
  async function reconnectLocalFile(request=false){
    if(!rememberedFile||filePreparing||fileWriter.connected)return false;
    const record=rememberedFile,target=store,epoch=fileConnectionEpoch;
    if(record.scope!==(accountId||'guest'))return false;
    filePreparing=true;rememberedFileError='';renderFileStatus();
    try{
      const picked=await window.TeethLocalFile.reconnect(record,request);
      if(target!==store||epoch!==fileConnectionEpoch)return false;
      if(!picked){if(request)rememberedFileError='File permission was not granted. Changes are saved in this browser.';return false;}
      // Keep backed-up content for cloud charts that are not loaded yet.
      const saved=window.TeethLocalFile.decode(picked.text,window.TeethModel,cloud);
      if(store.writeBlocked||saved.charts.some(chart=>!store.data.charts.some(current=>current.id===chart.id)))throw new Error('Some saved charts could not be matched to this browser. Choose the JSON file in Save options to open its charts before reconnecting.');
      for(const chart of saved.charts)fileCache.set(chart.id,clone(chart));
      fileWriter.connect(picked.handle,picked.text,record.scope);
      filePreparing=false;await saveFileNow();renderLibrary();return true;
    }catch(error){
      if(target===store&&epoch===fileConnectionEpoch)rememberedFileError=error.name==='NotFoundError'?'The saved JSON file could not be found. Choose it again in Save options.':error.message;
      return false;
    }finally{if(target===store&&epoch===fileConnectionEpoch){filePreparing=false;renderFileStatus();}}
  }
  async function restoreFileConnection(){
    const target=store,scope=accountId||'guest',epoch=fileConnectionEpoch;
    if(fileWriter.connected||rememberedFile||!(storageChoice.primary==='file'||storageChoice.backup==='file'))return;
    try{
      const record=await fileConnections.get(scope);
      if(target!==store||epoch!==fileConnectionEpoch||fileWriter.connected)return;
      fileRestoreChecked=true;
      if(record){rememberedFile={...record,scope};await reconnectLocalFile();}
    }catch{if(target===store&&epoch===fileConnectionEpoch){fileMemoryError=true;fileRestoreChecked=true;}}
    if(target===store&&epoch===fileConnectionEpoch){renderFileStatus();offerFileReconnect();}
  }
  function offerFileReconnect(){
    if(!fileRestoreChecked||fileReconnectOffered||fileWriter.connected||filePreparing||filePicking||blocked||libraryBusy||accountDeleting||tourActive||welcomeTask||$('[data-dialog]').open||$('[data-auth-dialog]').open||!(storageChoice.primary==='file'||storageChoice.backup==='file'))return;
    fileReconnectOffered=true;
    const choose=!rememberedFile||Boolean(rememberedFileError);
    showDialog({title:choose?'Choose your JSON file once':'Reconnect your JSON file',build(body){
      const message=document.createElement('p');
      message.textContent=rememberedFileError||(!rememberedFile?'This browser has not remembered your JSON file yet. Choose it once to enable automatic reconnects on future visits. Your charts are saved in this browser meanwhile.':`Allow access to “${rememberedFile.handle.name}” to resume JSON saving. You do not need to locate the file again.`);
      const button=document.createElement('button');button.type='button';button.className='button primary';button.style.marginTop='16px';button.textContent=choose?'Choose JSON file':'Reconnect file';
      button.addEventListener('click',()=>{$('[data-dialog]').close('connect-file');if(choose)connectLocalFile();else reconnectLocalFile(true);});
      body.append(message,button);
    },actions:[{label:'Not now',value:'cancel'}]});
  }
  function makeStore(){const next=new Store(accountStorage());next.onPersist=source=>scheduleFileSave(source);return next;}
  function renderCloudStatus(){
    const home=isHome();
    const charts=(home?store.data.charts:[store.current]).filter(chart=>!chart._starter&&!deletingCharts.has(chart.id));
    const visible=Boolean(auth.session||(!home&&store.current._cloud?.anonymousEdit));
    const failed=auth.session?._backupOnly||charts.some(chart=>chart._cloudUnavailable||chart._cloudRetryStopped)||(home?homeError:cloudError);
    const pending=charts.some(chart=>chart._cloudPending||chart._browserSource);
    const local=charts.some(chart=>!chart._cloud||chart._localOnly);
    const dirty=!home&&JSON.stringify(draft)!==baseline;
    const checking=libraryBusy||(home&&homeLoading);
    const message=failed?'Cloud sync pending · unable to sync':cloudBusy?'Saving to cloud…':checking?'Checking cloud save…':local?(home?'Some charts are saved only locally':'This chart is saved only locally'):dirty?(draft.status?'Saving to cloud…':'Cloud save pending · choose a status to save'):pending?'Cloud sync pending':charts.length?'Saved to cloud':'';
    for(const el of document.querySelectorAll('[data-local-cloud-status], [data-home-cloud-status]')){
      el.hidden=!visible||!message;el.textContent=message;
      el.classList.toggle('file-error',Boolean(failed));
      el.classList.toggle('pending',!failed&&Boolean(cloudBusy||checking||dirty||pending||local));
    }
  }
  function renderFileStatus(){
    renderCloudStatus();
    const reconnect=fileRestoreChecked&&!fileWriter.connected&&!filePreparing&&!filePicking;
    const message=fileWriter.error?'Local file paused: '+fileWriter.error:rememberedFileError?rememberedFileError:filePreparing?'Preparing local file…':fileWriter.pending||fileTimer?'Saving local file…':fileWriter.connected?'Saved to '+fileWriter.link.handle.name:rememberedFile?'Allow access to '+rememberedFile.handle.name+' to resume JSON saving. Changes are saved in this browser.':fileRestoreChecked?'Choose your JSON file once so this browser can remember it. Changes are saved in this browser meanwhile.':'Checking JSON file access…';
    for(const el of document.querySelectorAll('[data-local-file-status], [data-home-file-status]')){
      el.hidden=!fileWriter.connected&&!filePreparing&&!fileWriter.error&&storageChoice.backup!=='file'&&storageChoice.primary!=='file';
      el.replaceChildren(document.createTextNode(message));
      if(reconnect){const button=document.createElement('button');button.type='button';button.className='inline-button';button.textContent=rememberedFile?'Reconnect file':'Choose JSON file';button.addEventListener('click',()=>rememberedFile?reconnectLocalFile(true):connectLocalFile());el.append(document.createTextNode(' '),button);}
      el.classList.toggle('file-error',Boolean(fileWriter.error)||Boolean(rememberedFileError)||!fileWriter.connected);
    }
    if(store.current?._cloudUnavailable)showNotice(backupMessage(),true);
  }
  function scheduleFileSave(source){
    if(leavingPage||source!==store||!fileWriter.connected||fileWriter.link.scope!==(accountId||'guest'))return;
    clearTimeout(fileTimer);fileTimer=setTimeout(()=>saveFileNow().catch(error=>toast(error.message,true)),300);renderFileStatus();
  }
  async function fileSnapshot(source,refresh=false){
    const account=accountId;
    if(refresh&&auth.session)await refreshLibrary().catch(error=>{if(!backup.unavailable(error))throw error;});
    const entries=[...source.data.charts],result=[];
    // Explicitly saving the whole library may read other charts. Ordinary
    // startup/navigation still fetches only the chart being opened.
    for(const entry of entries){
      let copy;
      if(entry._cloud?.unloaded){
        const cached=fileCache.get(entry.id);
        if(cached)copy=clone(cached);
        else if(refresh){try{copy=await cloud.load(entry.id);}catch(error){if(!backup.unavailable(error))throw error;continue;}}
        else continue;
      }else copy=clone(entry);
      if(source!==store||account!==accountId)throw new Error('The account changed. Select the local file again.');
      fileCache.set(copy.id,clone(copy));result.push(copy);
    }
    return window.TeethLocalFile.encode(result,source.current.id,cloud);
  }
  function saveFileNow(){
    clearTimeout(fileTimer);fileTimer=null;
    const source=store,scope=accountId||'guest',link=fileWriter.link;
    fileWork=fileWork.catch(()=>{}).then(async()=>{
      if(leavingPage||!link||fileWriter.link!==link||source!==store)return;
      filePreparing=true;renderFileStatus();
      try{const text=await fileSnapshot(source);if(!leavingPage&&source===store&&fileWriter.link===link)await fileWriter.write(text,scope);}
      catch(error){if(fileWriter.link===link){if(error.name==='NotAllowedError'){fileWriter.disconnect();rememberedFileError='File access expired. Reconnect file to allow access again.';}else fileWriter.error=error.message;}throw error;}
      finally{filePreparing=false;renderFileStatus();}
    });
    return fileWork;
  }
  async function connectLocalFile(change=false){
    if(!change&&fileWriter.connected&&!fileWriter.error)return true;
    if(filePicking||filePreparing||blocked||libraryBusy)return;
    const source=store,account=accountId,epoch=++fileConnectionEpoch;
    filePicking=true;fileReconnectOffered=true;renderFileStatus();
    try{
      autosave.flush();
      const picked=await window.TeethLocalFile.pick(window.showOpenFilePicker?.bind(window));
      if(store!==source||account!==accountId)return;
      let imported=null,openedFile=false;
      if(picked.text.trim()){
        try{imported=window.TeethLocalFile.decode(picked.text,window.TeethModel,cloud);}catch{}
        const decision=await showDialog({title:'This JSON file already has content',build:imported?picked.handle.name+' contains '+imported.charts.length+' charts. Open them as local charts, or replace the file with this library?':'Replacing '+picked.handle.name+' will overwrite its existing content with your current chart library.',actions:[{label:'Cancel',value:'cancel'},...(imported?[{label:'Open saved charts',value:'open'}]:[]),{label:'Replace file',value:'replace',danger:true}]});
        if(decision==='cancel'||!decision||source!==store||account!==accountId)return;
        await saveFileNow().catch(()=>{});fileWriter.disconnect();
        if(decision==='open'){
          openedFile=true;
          const mapping=new Map();
          for(const original of imported.charts){
            let match=source.data.charts.find(c=>c.id===original.id&&!c._cloud&&cloud.signature(c)===cloud.signature(original));
            if(!match){match=clone(original);if(source.data.charts.some(c=>c.id===match.id)||source.data.charts.some(c=>c._cloud&&c.id===original.id))match.id=crypto.randomUUID();match._localOnly=Boolean(auth.session);source.data.charts.push(match);}
            mapping.set(original.id,match.id);
          }
          source.data.charts=source.data.charts.filter(c=>!c._starter);source.data.currentId=mapping.get(imported.currentId)||mapping.values().next().value;source.persist();
          window.history.pushState({},'', chartPath(source.current.id));preview=null;render();
        }
      }
      await saveFileNow().catch(()=>{});fileWriter.disconnect();filePreparing=true;renderFileStatus();
      const contents=await fileSnapshot(source,true);
      if(source!==store||account!==accountId)return;
      fileWriter.connect(picked.handle,picked.text,account||'guest');await fileWriter.write(contents,account||'guest');
      toast('Available charts now save to '+picked.handle.name);renderLibrary();
      if(openedFile&&auth.session){await stageBrowserCharts();syncBrowserCharts();}
      return true;
    }catch(error){if(error.name!=='AbortError')toast(error.message,true);}
    finally{if(source===store&&epoch===fileConnectionEpoch){filePicking=false;filePreparing=false;renderFileStatus();}}
  }
  const welcomeKey='nithi.teeth.welcome.v1',tourPendingKey='nithi.teeth.tour.pending.v1';let welcomeSeen=false,tourActive=false,tourInterrupted=false;
  try{welcomeSeen=storage.getItem(welcomeKey)==='true';tourInterrupted=storage.getItem(tourPendingKey)==='true';}catch{}
  function offerStorageChoice(){
    if((!isHome()&&!tourInterrupted)||blocked||libraryBusy||(welcomeSeen&&!tourInterrupted)||tourActive||welcomeTask||$('[data-dialog]').open||$('[data-auth-dialog]').open)return;
    if(tourInterrupted){tourInterrupted=false;welcomeTask=storageOptions().finally(()=>{welcomeTask=null;offerOwnerRequests();});return;}
    startTour();
  }
  async function restartTour(){
    if(tourActive||welcomeTask||$('[data-dialog]').open||$('[data-auth-dialog]').open)return;
    if(!(await confirmDiscard()))return;
    // Reserve onboarding while navigation refreshes the library.
    tourActive=true;
    try{
      autosave.flush();await exitFullscreen();
      if(!isHome()){window.history.pushState({},'', homePath());await loadLibrary();}
      startTour();
    }catch(error){tourActive=false;toast(error.message,true);}
  }
  function startTour(){
    tourInterrupted=false;
    try{storage.setItem(tourPendingKey,'true');}catch{}
    tourActive=true;
    welcomeTask=(async()=>{
      const intro=await showDialog({title:'Welcome to Teeth Chart App',iconSrc:'/assets/downloads/icons/Teeth-Chart-App-Icon-1024.png',build(body){
        const opening=document.createElement('p');opening.className='tour-intro-opening';opening.textContent='Do you always remember which of your teeth are permanent, which are deciduous (milk teeth), and which are wisdom teeth? It can be hard to keep track, especially for children. Teeth Chart App stores that information for you. Mark your teeth once and keep your chart saved. You can also share it with others online and offline. JSON files integrate with offline Teeth Chart App as well.';
        const more=document.createElement('details');more.className='tour-intro-more';const summary=document.createElement('summary');summary.textContent='More…';more.append(summary);
        for(const text of [
          'Teeth Chart App is a simple online tool for visually recording tooth information and keeping multiple dental charts organized.',
          'Mark teeth as permanent, milk, wisdom, not yet erupted, artificial, or empty. Add condition labels such as wobbly, filled, cavity, or painful/sensitive, record gum-space information, and attach notes to individual teeth.',
          'Your changes can be saved in a JSON file on your device, in this browser profile, or automatically in the cloud when you are signed in. Choose a browser or JSON backup as well. You can review chart history and import or export charts as JSON files for backup or sharing.',
          'The app has no advertising. Browser and JSON saving keep charts on your device. Cloud saving sends your chart data to Supabase, the app’s cloud storage provider; sharing makes charts available according to the access you choose.',
          'This app is intended for personal record-keeping and does not provide medical advice or diagnosis.'
        ]){const paragraph=document.createElement('p');paragraph.textContent=text;more.append(paragraph);}
        const comic=document.createElement('figure');comic.className='tour-intro-comic';
        const illustration=document.createElement('img');illustration.src='/tools/teeth-chart/welcome-before-after.png';illustration.alt='Before: a puzzled patient at the dentist tries to remember his tooth types. After: the same person confidently checks his dental chart at a computer.';illustration.width=1774;illustration.height=887;illustration.decoding='async';
        const captions=document.createElement('figcaption');for(const text of ['Before','After']){const caption=document.createElement('span');caption.textContent=text;captions.append(caption);}comic.append(illustration,captions);
        body.append(comic,opening,more);
      },actions:[{label:'Continue to tour',value:'continue',primary:true}]});
      const finishOnboarding=async()=>{
        tourActive=false;autosave.flush();
        welcomeSeen=true;try{storage.setItem(welcomeKey,'true');storage.setItem(tourPendingKey,'false');}catch{}
        welcomeTask=null;await storageOptions();offerOwnerRequests();
      };
      if(intro!=='continue'){await finishOnboarding();return;}
      await new Promise(resolve=>window.TeethTour.start({createChart:()=>newChart({tour:true}),async finish(){await finishOnboarding();resolve();}}));
    })();
  }
  $('[data-dialog]').addEventListener('close',()=>setTimeout(()=>{offerStorageChoice();offerOwnerRequests();offerFileReconnect();},0));
  $('[data-auth-dialog]').addEventListener('close',()=>setTimeout(()=>{offerStorageChoice();offerOwnerRequests();offerFileReconnect();},0));
  async function localFileSetup(change=false){
    if(!change&&fileWriter.connected&&!fileWriter.error)return true;
    if(!change&&rememberedFile&&!rememberedFileError&&!fileWriter.connected)return reconnectLocalFile(true);
    const next=await showDialog({title:'Save your library locally',build(body){const text=document.createElement('p');text.textContent='Follow the setup guide, then choose your JSON file. Charts already opened or downloaded to this browser can be backed up during a cloud outage. This browser will remember your file. If access expires, use Reconnect file to allow access again.';const link=document.createElement('a');link.href='/tools/teeth-chart/save-locally/';link.target='_blank';link.rel='noopener';link.textContent='Open the setup guide';body.append(text,link);},actions:[{label:'Cancel',value:'cancel'},{label:'Choose JSON file',value:'choose',primary:true}]});
    return next==='choose'&&await connectLocalFile(change);
  }
  async function backupOptions(){
    // Browser persistence remains the safety net when file permission is declined.
    const result=await showDialog({title:'Choose your backup',build(body){
      const intro=document.createElement('p');intro.textContent='Changes will save to your main storage and your backup. If cloud saving is unavailable, keep editing; pending changes upload automatically when the connection returns.';body.append(intro);
      const cards=document.createElement('div');cards.className='storage-choices';
      for(const [value,title,text]of [['browser','Browser History (localStorage)','Saved automatically in this browser profile, including after refreshes. Clearing site data removes this backup.'],['file','Local JSON file','Save changes to Online Teeth Chart App.json as well. Select the file and allow read/write access. This browser remembers the file; if access expires, use Reconnect file to allow access again.']]){
        const button=document.createElement('button');button.type='button';button.className='storage-choice';
        const heading=document.createElement('strong');heading.textContent=title;const description=document.createElement('p');description.textContent=text;button.append(heading,description);
        if(value==='file'&&storageChoice.primary==='file'){button.disabled=true;description.textContent='Already your main storage. Choose Browser History for a separate backup.';}
        button.addEventListener('click',()=>{if(value==='file'&&!fileWriter.connected&&!rememberedFile)window.open('/tools/teeth-chart/save-locally/','_blank','noopener');$('[data-dialog]').close(value);});cards.append(button);
      }
      body.append(cards);const note=document.createElement('p');note.className='share-help';note.textContent='Cancel returns to Choose where to save. If your main storage is also Browser History, both use the same browser data; a JSON file gives you a separate copy.';body.append(note);
    },actions:[{label:'Cancel',value:'cancel'},{label:'Use browser backup',value:'browser',primary:true}]});
    if(result!=='browser'&&result!=='file')return false;
    if(result==='file'&&!await localFileSetup())return false;
    storageChoice.backup=result;rememberStorage();
    if(storageChoice.backup==='browser'&&storageChoice.primary!=='file'&&(fileWriter.connected||rememberedFile)){await saveFileNow().catch(()=>{});await forgetLocalFile();}
    store.persist();renderFileStatus();renderLibrary();return true;
  }
  async function storageOptions(){
    if((!isHome()&&(blocked||libraryBusy))||accountDeleting||$('[data-dialog]').open||$('[data-auth-dialog]').open)return;
    welcomeSeen=true;try{storage.setItem(welcomeKey,'true');storage.setItem(tourPendingKey,'false');}catch{}
    const choice=await showDialog({title:'Choose where to save',build(body){
      const cards=document.createElement('div');cards.className='storage-choices';
      for(const [name,level,description,action] of [
        ['Save in Browser History','Insecure','Loads fastest. Browser data can be cleared.','browser'],
        ['Save Locally','More secure','Create a JSON file on your computer named Online Teeth Chart App.json.','file'],
        ['Save on Cloud','Most secure','Sign in right away.','cloud']]){
        const button=document.createElement('button');button.type='button';button.className='storage-choice';
        const title=document.createElement('strong');title.textContent=name;const badge=document.createElement('span');badge.className='storage-security '+action;badge.textContent=level;const text=document.createElement('p');text.textContent=description;button.append(title,badge,text);
        if(action!=='cloud'){const sync=document.createElement('small');sync.textContent='Saved to cloud after sign in.';button.append(sync);}
        button.addEventListener('click',()=>{if(action==='file'&&!fileWriter.connected&&!rememberedFile)window.open('/tools/teeth-chart/save-locally/','_blank','noopener');$('[data-dialog]').close(action);});cards.append(button);
      }
      const note=document.createElement('p');note.className='share-help';note.textContent='At sign-in, choose Merge with cloud or Keep local for now. These labels describe protection from losing browser data; access depends on your device and sharing settings. Your JSON file is remembered in this browser. If permission expires, use Reconnect file to allow access again.';body.append(cards,note);
      const summary=document.createElement('p');summary.className='share-help';summary.textContent='Backup: '+(storageChoice.backup==='file'?'local JSON file'+(fileWriter.connected?'':' (reconnect required)'):'Browser History (localStorage)');body.append(summary);
      if(fileWriter.connected){const current=document.createElement('p');current.className='share-help';current.textContent='Connected file: '+fileWriter.link.handle.name;body.append(current);}
      else if(rememberedFile){
        const current=document.createElement('p');current.className='share-help';current.textContent='Remembered file: '+rememberedFile.handle.name;body.append(current);
        const reconnect=document.createElement('button');reconnect.type='button';reconnect.className='button primary';reconnect.textContent='Reconnect file';reconnect.disabled=filePreparing;
        reconnect.addEventListener('click',()=>{$('[data-dialog]').close('reconnect');reconnectLocalFile(true);});body.append(reconnect);
      }
      if(fileMemoryError){const note=document.createElement('p');note.className='share-help';note.textContent='This browser could not remember the file. You may need to choose it again next time.';body.append(note);}
    },actions:[...(!auth.session?[{label:'Already a user? Sign-in',value:'signin'}]:[]),{label:'Close',value:'cancel'},{label:'Next: Backup options',value:'backup'},...(fileWriter.connected?[{label:'Save file now',value:'flush'}]:[]),...(fileWriter.connected||rememberedFile?[{label:'Change JSON file',value:'change-file'},{label:'Disconnect file',value:'disconnect'}]:[])]});
    welcomeTask=null;
    if(choice==='backup'){if(!await backupOptions())return storageOptions();return;}
    if(choice==='file'){
      if(!await localFileSetup())return storageOptions();
      storageChoice.primary='file';rememberStorage();
      if(!await backupOptions())return storageOptions();
      return;
    }
    if(choice==='change-file'&&!await localFileSetup(true))return storageOptions();
    if(choice==='browser'||choice==='cloud'||choice==='signin'){
      storageChoice.primary=choice==='browser'?'browser':'cloud';rememberStorage();
      if(!await backupOptions())return storageOptions();
      if(choice==='cloud'||choice==='signin'){if(!auth.session){$('[data-auth-dialog]').addEventListener('close',()=>{if(!auth.session&&$('[data-auth-dialog]').returnValue!=='signed-in')storageOptions();},{once:true});auth.show();}else{await stageBrowserCharts();syncBrowserCharts();retryCloud();render();}}
    }
    if(choice==='disconnect'){await saveFileNow().catch(()=>{});await forgetLocalFile();storageChoice.backup='browser';if(storageChoice.primary==='file')storageChoice.primary='browser';rememberStorage();renderFileStatus();renderLibrary();toast('File disconnected. Changes continue saving in this browser.');}
    if(choice==='flush'){try{await saveFileNow();toast('Local file saved');}catch(error){toast(error.message,true);}}
  }
  function setFocusMode(active){document.body.classList.toggle('chart-fullscreen',active);$('[data-exit-fullscreen]').hidden=!active;}
  async function enterFullscreen(){
    if(blocked||libraryBusy)return;setFocusMode(true);
    try{if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();}catch{}
  }
  async function exitFullscreen(){setFocusMode(false);if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});}
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)setFocusMode(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.fullscreenElement)setFocusMode(false);});

  async function accountDialog(){
    if(!auth.session){auth.show();return;}
    const user=auth.session.user;
    const result=await showDialog({title:'Your account',build(body){
      const address=document.createElement('p');address.className='account-email';address.textContent='Currently signed in with '+user.email;body.append(address);
      if(user.new_email){const pending=document.createElement('p');pending.className='share-help';pending.textContent='Pending change to '+user.new_email+'. Confirm the links sent to your old and new email addresses.';body.append(pending);}
    },actions:[{label:'Close',value:'cancel'},{label:'Delete account',value:'delete-account',danger:true},{label:'Sign out',value:'signout'},{label:'Sync local charts',value:'sync'},{label:'Change email ID',value:'email',primary:true}]});
    if(result==='delete-account')await deleteAccountDialog();
    if(result==='sync'){await stageBrowserCharts();syncBrowserCharts();render();}
    if(result==='email')await changeAccountEmail();
    if(result==='signout'){try{await auth.signOut();}catch(error){toast(error.message,true);}}
  }
  async function deleteAccountDialog(){
    if(!auth.session||accountDeleting)return;
    const user=auth.session.user;let input,message,working=false;
    await showDialog({title:'Delete your account?',build(body){
      const text=document.createElement('p');text.textContent='This permanently deletes '+user.email+' and every cloud chart you own, including their history and sharing links. It also clears this account’s saved browser library. Charts owned by other people and local JSON files are not deleted. This cannot be undone.';
      const label=document.createElement('label');label.className='account-email-field';label.textContent='Type your email to confirm';input=document.createElement('input');input.type='email';input.required=true;input.autocomplete='off';input.spellcheck=false;label.append(input);
      message=document.createElement('p');message.className='dialog-error';message.setAttribute('role','alert');body.append(text,label,message);
    },actions:[{label:'Cancel',value:'cancel'},{label:'Delete account permanently',value:'delete',danger:true,validate(){
      if(working||!input.reportValidity())return false;
      if(input.value.trim().toLowerCase()!==user.email.toLowerCase()){message.textContent='Enter your signed-in email to confirm.';return false;}
      if(auth.session?.user.id!==user.id){message.textContent='Your account changed. Close this dialog and try again.';return false;}
      autosave.flush();working=accountDeleting=true;message.textContent='Deleting your account…';
      const dialog=$('[data-dialog]'),buttons=[$('[data-close-dialog]'),...$('[data-dialog-actions]').querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);input.disabled=true;
      const preventCancel=event=>event.preventDefault();dialog.addEventListener('cancel',preventCancel);
      (async()=>{
        // Finish outstanding writes, then stop file syncing before deleting data.
        await cloud.flush().catch(()=>{});await saveFileNow().catch(()=>{});
        if(auth.session?.user.id!==user.id)throw new Error('The signed-in account changed.');
        await cloud.deleteAccount(input.value.trim());
        if(accountId===user.id){fileWriter.disconnect();clearTimeout(fileTimer);fileTimer=null;window.history.replaceState({},'', homePath());}
        let cacheCleared=true;try{storage.removeItem(window.TeethModel.STORAGE_KEY+':'+user.id);await fileConnections.delete(user.id);}catch{cacheCleared=false;}
        dialog.close('deleted');accountDeleting=false;
        await auth.forgetDeletedAccount(user.id);
        toast(cacheCleared?'Account deleted.':'Account deleted. Clear this browser’s site data to remove its remaining cached copy.',!cacheCleared);
      })().catch(error=>{message.textContent=error.code==='PGRST202'?'Account deletion is not available yet. Please try again shortly.':error.message;}).finally(()=>{
        working=accountDeleting=false;buttons.forEach(button=>button.disabled=false);input.disabled=false;dialog.removeEventListener('cancel',preventCancel);
      });return false;
    }}]});
  }
  async function changeAccountEmail(){
    if(!auth.session)return;
    const userId=auth.session.user.id,oldEmail=auth.session.user.email;
    let input,message,working=false;
    await showDialog({title:'Change email ID',build(body){
      const help=document.createElement('p');help.className='share-help';help.textContent='Confirm this change from both '+oldEmail+' and your new address. Your charts stay with this account.';
      const label=document.createElement('label');label.className='account-email-field';label.textContent='New email address';input=document.createElement('input');input.type='email';input.autocomplete='email';input.required=true;input.maxLength=254;input.value=auth.session.user.new_email||'';label.append(input);
      message=document.createElement('p');message.className='dialog-error';message.setAttribute('role','status');body.append(help,label,message);
    },actions:[{label:'Cancel',value:'cancel'},{label:'Send confirmation emails',value:'send',primary:true,validate(){
      if(working||!input.reportValidity())return false;
      if(auth.session?.user.id!==userId){message.textContent='Your account changed. Close this dialog and try again.';return false;}
      working=true;message.textContent='Sending confirmation emails…';
      const dialog=$('[data-dialog]'),buttons=[$('[data-close-dialog]'),...$('[data-dialog-actions]').querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);input.disabled=true;
      const preventCancel=event=>event.preventDefault();dialog.addEventListener('cancel',preventCancel);
      auth.changeEmail(input.value).then(()=>{
        dialog.close('sent');toast('Check both email addresses to confirm the change.');
      }).catch(error=>{message.textContent=error.message;}).finally(()=>{
        working=false;buttons.forEach(button=>button.disabled=false);input.disabled=false;dialog.removeEventListener('cancel',preventCancel);
      });return false;
    }}]});
  }
  async function copyChart(){
    if(blocked||libraryBusy||isHome()||!(await confirmDiscard()))return;
    const source=store.current,sourceAccount=accountId,target=store;
    let input;const choice=await showDialog({title:'Make a copy',build(body){
      const label=document.createElement('label');label.textContent='Copy name';input=document.createElement('input');input.type='text';input.maxLength=120;input.value=('Copy of '+source.name).slice(0,120);label.append(input);
      const help=document.createElement('p');help.className='share-help';help.textContent=auth.session?'You will own this copy. It starts Restricted, with no collaborators.':'Your copy will be saved in this browser. Sign in to own a cloud copy.';body.append(label,help);
    },actions:[{label:'Cancel',value:'cancel'},{label:'Make a copy',value:'copy',primary:true,validate:()=>Boolean(input.value.trim())}]});
    if(choice!=='copy'||accountId!==sourceAccount||store!==target)return;
    try{
      const id=crypto.randomUUID();let copied;
      if(source._cloud&&auth.session)copied=await cloud.copy(source.id,id,input.value.trim());
      else{const content=source._cloud?await cloud.load(source.id):source;copied={id,name:input.value.trim(),annotations:clone(content.annotations),history:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};}
      if(accountId!==sourceAccount||store!==target)return;
      store.data.charts.push(copied);store.data.currentId=copied.id;store.persist();window.history.pushState({},'', chartPath(copied.id));render();if(!copied._cloud)await saveOnline(copied);toast('Copy created. You own this chart.');
    }catch(error){toast(error.message,true);}
  }
  async function suggestCollaborator(chart){
    let email,role,error;const choice=await showDialog({title:'Ask owner to add someone',build(body){
      const label=document.createElement('label');label.textContent='Email address';email=document.createElement('input');email.type='email';email.required=true;label.append(email);
      role=document.createElement('select');role.setAttribute('aria-label','Requested access');role.add(new Option('Viewer','viewer'));role.add(new Option('Editor','editor'));
      const help=document.createElement('p');help.className='share-help';help.textContent='The owner can review your request in Share. Access changes only after approval.';error=document.createElement('p');error.className='dialog-error';body.append(label,role,help,error);
    },actions:[{label:'Cancel',value:'cancel'},{label:'Send request',value:'send',primary:true,validate(){if(!email.reportValidity())return false;return true;}}]});
    if(choice==='send'){await cloud.suggestCollaborator(chart.id,email.value.trim(),role.value);toast('Request sent to the owner for review.');}
  }
  async function shareChart(){
    if(blocked||deletingCharts.has(store.current.id))return;
    if(!auth.session){auth.show();return;}
    if(!(await confirmDiscard()))return;
    try{
      if(store.current._localOnly){await stageBrowserCharts();if(store.current._localOnly)return;}
      await saveOnline();
      const chart=store.current;
      if(chart._cloud?.role!=='owner'){
        if(chart._cloud?.deleteAfter){await showDialog({title:'Chart scheduled for deletion',build:'Make a copy before '+new Date(chart._cloud.deleteAfter).toLocaleString()+'. Sharing cannot be changed.',actions:[{label:'Done',value:'cancel'}]});return;}
        await suggestCollaborator(chart);return;
      }
      ownerRequestsReviewedEpoch=loadEpoch;ownerRequests=null;
      const fresh=await cloud.load(chart.id);
      if(cloud.signature(chart)!==fresh._cloud.savedHash){chart._cloud.conflict=true;throw new Error('A newer chart version exists. Reload before changing sharing.');}
      chart._cloud=fresh._cloud;
      const [requests,suggestions]=await Promise.all([cloud.accessRequests(chart.id),cloud.suggestions(chart.id)]),decisions=new Map(),suggestionDecisions=new Map();
      let members=clone(chart._cloud.members),domains=clone(chart._cloud.domains||[]),general,linkRole,people,email,inviteRole,error;
      const result=await showDialog({title:'Share “'+chart.name+'”',build(body){
        const section=document.createElement('section');section.className='share-section';
        const heading=document.createElement('h3');heading.textContent='People with access';
        const owner=document.createElement('div');owner.className='share-row';const ownerName=document.createElement('span');ownerName.className='share-email';ownerName.textContent=auth.session.user.email;const ownerRole=document.createElement('span');ownerRole.className='share-owner';ownerRole.textContent='Owner';owner.append(ownerName,ownerRole);people=document.createElement('div');
        const roles=selected=>{const select=document.createElement('select');select.setAttribute('aria-label','Access role');for(const role of ['viewer','editor'])select.add(new Option(role==='viewer'?'Viewer':'Editor',role));select.value=selected;return select;};
        const renderPeople=()=>{people.replaceChildren();members.forEach((member,index)=>{const row=document.createElement('div');row.className='share-row';const name=document.createElement('span');name.className='share-email';name.textContent=member.email;const select=roles(member.role);select.setAttribute('aria-label','Access for '+member.email);select.addEventListener('change',()=>member.role=select.value);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.className='share-remove';remove.setAttribute('aria-label','Remove '+member.email);remove.addEventListener('click',()=>{members.splice(index,1);renderPeople();});row.append(name,select,remove);people.append(row);});};
        renderPeople();
        if(suggestions.length){const pending=document.createElement('section');pending.className='access-request-section';const title=document.createElement('h3');title.textContent='Requests to add people';pending.append(title);
          for(const request of suggestions){const row=document.createElement('div');row.className='share-row';const text=document.createElement('span');text.className='share-email';text.textContent=request.email+' · '+request.role;const approve=document.createElement('button'),dismiss=document.createElement('button');approve.type=dismiss.type='button';approve.className=dismiss.className='button';approve.textContent='Approve';dismiss.textContent='Dismiss';const choose=value=>{suggestionDecisions.set(request.id,value);approve.disabled=dismiss.disabled=true;approve.textContent=value?'Approved on save':'Dismissed on save';};approve.addEventListener('click',()=>choose(true));dismiss.addEventListener('click',()=>choose(false));row.append(text,approve,dismiss);pending.append(row);}body.append(pending);
        }
        if(requests.length){
          const pending=document.createElement('section');pending.className='access-request-section';const title=document.createElement('h3');title.textContent='Access requests';pending.append(title);
          requests.forEach(request=>{
            const row=document.createElement('div');row.className='share-row share-add';const name=document.createElement('span');name.className='share-email';name.textContent=request.email;
            const role=roles('viewer'),approve=document.createElement('button'),dismiss=document.createElement('button');approve.type=dismiss.type='button';approve.className=dismiss.className='button';approve.textContent='Approve';dismiss.textContent='Dismiss';
            const choose=value=>{decisions.set(request.user_id,value);if(value!=='dismiss'){const existing=members.find(member=>member.email===request.email);if(existing)existing.role=value;else members.push({email:request.email,role:value});renderPeople();}role.disabled=approve.disabled=dismiss.disabled=true;approve.textContent=value==='dismiss'?'Dismissed on save':'Approved on save';};
            approve.addEventListener('click',()=>choose(role.value));dismiss.addEventListener('click',()=>choose('dismiss'));row.append(name,role,approve,dismiss);pending.append(row);
          });body.append(pending);
        }
        const add=document.createElement('div');add.className='share-row share-add';email=document.createElement('input');email.type='email';email.placeholder='Add an email address';email.setAttribute('aria-label','Email address to share with');inviteRole=roles('viewer');const addButton=document.createElement('button');addButton.type='button';addButton.className='button';addButton.textContent='Add';
        addButton.addEventListener('click',()=>{const value=email.value.trim().toLowerCase();if(!value||!email.checkValidity()){error.textContent='Enter a valid email address.';return;}if(value===auth.session.user.email.toLowerCase()){error.textContent='You already own this chart.';return;}const found=members.find(member=>member.email===value);if(found)found.role=inviteRole.value;else members.push({email:value,role:inviteRole.value});email.value='';error.textContent='';renderPeople();});
        add.append(email,inviteRole,addButton);const help=document.createElement('p');help.className='share-help';help.textContent='People use their verified email to sign in. Approved access requests receive an email with the chart link. For people added directly, share the link after saving.';section.append(heading,owner,people,add,help);
        const access=document.createElement('section');access.className='share-section';
        const accessTitle=document.createElement('h3');accessTitle.textContent='General access';
        const row=document.createElement('div');row.className='share-row general-access-row';
        general=document.createElement('select');general.setAttribute('aria-label','General access');
        general.add(new Option('Restricted','restricted'));general.add(new Option('Anyone with the link','anyone'));general.add(new Option('Specific domains','domain'));general.value=chart._cloud.general||'restricted';
        linkRole=roles(chart._cloud.linkRole||'viewer');linkRole.setAttribute('aria-label','Link access role');
        linkRole.options[1].textContent='Editor — sign-in required';linkRole.add(new Option('Editor — no sign-in required','anonymous_editor'));
        if(chart._cloud.anonymousEdit)linkRole.value='anonymous_editor';
        const accessHelp=document.createElement('p');accessHelp.className='share-help';
        const domainSection=document.createElement('div');domainSection.className='domain-rules';
        const domainTitle=document.createElement('h4');domainTitle.textContent='Domain access';
        const domainList=document.createElement('div');
        const renderDomains=()=>{
          domainList.replaceChildren();
          domains.forEach((rule,index)=>{
            const line=document.createElement('div');line.className='share-row domain-rule';
            const input=document.createElement('input');input.type='text';input.placeholder='formularacingcamp.com';input.maxLength=253;input.autocapitalize='none';input.spellcheck=false;input.value=rule.domain;input.setAttribute('aria-label','Email domain '+(index+1));input.addEventListener('input',()=>rule.domain=input.value);
            const role=roles(rule.role);role.setAttribute('aria-label','Domain '+(index+1)+' access role');role.addEventListener('change',()=>rule.role=role.value);
            const remove=document.createElement('button');remove.type='button';remove.className='share-remove';remove.setAttribute('aria-label','Remove domain '+(index+1));remove.textContent='×';remove.addEventListener('click',()=>{domains.splice(index,1);renderDomains();});line.append(input,role,remove);domainList.append(line);
          });
        };
        const addDomain=document.createElement('button');addDomain.type='button';addDomain.className='button';addDomain.textContent='Add domain';addDomain.addEventListener('click',()=>{if(domains.length>=100){error.textContent='Use up to 100 domains.';return;}domains.push({domain:'',role:'viewer'});renderDomains();domainList.lastElementChild.querySelector('input').focus();});
        const domainHelp=document.createElement('p');domainHelp.className='share-help';domainHelp.textContent='Each domain has its own role. Users must sign in with a verified email at that exact domain. Subdomains are not included. The highest role granted by people, domains, or the public link applies.';
        domainSection.append(domainTitle,domainList,addDomain,domainHelp);renderDomains();
        const update=()=>{
          linkRole.hidden=general.value!=='anyone';domainSection.hidden=general.value==='restricted';
          if(general.value==='domain'&&!domains.length){domains.push({domain:'',role:'viewer'});renderDomains();}
          accessHelp.textContent=general.value==='domain'?'Only the people listed above and the domains below can open this chart.':general.value==='restricted'?'Only you and the people listed above can open this chart.':linkRole.value==='viewer'?'Anyone with the link can view without signing in. Add domain editors below if needed.':linkRole.value==='anonymous_editor'?'Anyone with this link can edit and save changes without signing in.':'Anyone with the link can view. Editing requires sign-in; domain rules can grant additional access.';
        };general.addEventListener('change',update);linkRole.addEventListener('change',update);update();row.append(general,linkRole);access.append(accessTitle,row,accessHelp,domainSection);
        const linkRow=document.createElement('div');linkRow.className='share-row';const url=document.createElement('input');url.className='share-url';url.value=cloud.chartUrl(chart.id);url.readOnly=true;url.setAttribute('aria-label','Chart link');const copy=document.createElement('button');copy.type='button';copy.className='button';copy.textContent='Copy link';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url.value);copy.textContent='Copied';}catch{url.focus();url.select();error.textContent='Copy the selected link.';}});linkRow.append(url,copy);error=document.createElement('p');error.className='dialog-error';error.setAttribute('role','alert');body.append(section,access,linkRow,error);
      },actions:[{label:'Cancel',value:'cancel'},{label:'Save access',value:'save',primary:true,validate(){if(general.value!=='restricted'){
        if(general.value==='domain'&&!domains.length){error.textContent='Add at least one domain.';return false;}
        if(domains.some(rule=>!cloud.validDomain(rule.domain))){error.textContent='Enter each domain without @, https://, or a path.';return false;}
        if(new Set(domains.map(rule=>cloud.normalizeDomain(rule.domain))).size!==domains.length){error.textContent='Use each domain only once.';return false;}
      }if(email.value.trim()){error.textContent='Click Add to include the email address, or clear it before saving.';return false;}return true;}}]});
      if(result==='save'){
        await cloud.setSharing(chart,{general:general.value,linkRole:linkRole.value==='anonymous_editor'?'editor':linkRole.value,anonymousEdit:general.value==='anyone'&&linkRole.value==='anonymous_editor',domains:general.value==='restricted'?[]:domains,members});
        for(const [userId,role] of decisions){const email=requests.find(request=>request.user_id===userId).email;await cloud.resolveRequest(chart,userId,role==='dismiss'?'dismiss':members.find(member=>member.email===email)?.role||'dismiss');}
        for(const [id,approve]of suggestionDecisions)await cloud.resolveSuggestion(chart,id,approve);
        store.persist();toast('Sharing permissions saved');
      }
    }catch(problem){showNotice(problem.message,true);toast('Sharing could not be updated.',true);}
  }
  let ownerRequests=null,ownerRequestsOpen=false,ownerRequestsReviewedEpoch=-1;
  async function checkOwnerRequests(epoch){
    ownerRequests=null;
    const chart=store.current,user=accountId;
    if(!user||chart._cloud?.role!=='owner'||chart._cloud.deleteAfter)return;
    try{
      const [requests,suggestions]=await Promise.all([cloud.accessRequests(chart.id),cloud.suggestions(chart.id)]);
      if(epoch!==loadEpoch||epoch===ownerRequestsReviewedEpoch||user!==accountId||isHome()||blocked||store.current.id!==chart.id)return;
      if(!requests.length&&!suggestions.length)return;
      ownerRequests={epoch,user,chart,requests,suggestions};offerOwnerRequests();
    }catch{ /* Opening a chart must not depend on notification availability. Share can retry. */ }
  }
  async function offerOwnerRequests(){
    const pending=ownerRequests;
    if(!pending||ownerRequestsOpen||tourActive||welcomeTask||$('[data-dialog]').open||$('[data-auth-dialog]').open)return;
    if(pending.epoch!==loadEpoch||pending.user!==accountId||isHome()||blocked||libraryBusy||store.current.id!==pending.chart.id){ownerRequests=null;return;}
    ownerRequests=null;ownerRequestsOpen=true;
    const {chart,requests,suggestions}=pending;
    const current=()=>pending.epoch===loadEpoch&&pending.user===accountId&&!isHome()&&!blocked&&store.current.id===chart.id;
    try{await showDialog({title:'Pending access requests',build(body){
      const intro=document.createElement('p');intro.textContent='People are waiting for access to “'+chart.name+'”. Choose a role and approve, or dismiss a request.';body.append(intro);
      const rows=[];
      for(const request of [...requests.map(r=>({...r,kind:'access'})),...suggestions.map(r=>({...r,kind:'suggestion'}))]){
        const section=document.createElement('section');section.className='owner-request';
        const email=document.createElement('strong');email.textContent=request.email;
        const controls=document.createElement('div');controls.className='share-row';
        const role=document.createElement('select');role.setAttribute('aria-label','Access for '+request.email);
        for(const value of ['viewer','editor'])role.add(new Option(value==='viewer'?'Viewer':'Editor',value));role.value=request.role||'viewer';
        if(request.kind==='suggestion'){role.disabled=true;const hint=document.createElement('p');hint.className='share-help';hint.textContent='A collaborator asked you to add this person.';section.append(hint);}
        const approve=document.createElement('button'),dismiss=document.createElement('button');approve.type=dismiss.type='button';approve.className='button primary';dismiss.className='button';approve.textContent='Approve';dismiss.textContent='Dismiss';
        const status=document.createElement('p');status.className='owner-request-status';status.setAttribute('role','status');
        const row={role,approve,dismiss,done:false,suggestion:request.kind==='suggestion'};rows.push(row);
        async function decide(accepted){
          if(!current()){status.textContent='The chart or account changed. Reopen the chart to review requests.';return;}
          rows.forEach(r=>{r.role.disabled=r.approve.disabled=r.dismiss.disabled=true;});
          status.classList.remove('error');status.textContent=accepted?'Approving…':'Dismissing…';
          try{
            autosave.flush();await cloud.flushChart(chart.id);
            const fresh=await cloud.load(chart.id);if(!current())return;
            if(cloud.signature(chart)!==fresh._cloud.savedHash){chart._cloud.conflict=true;throw new Error('This chart has newer changes. Reload it before reviewing requests.');}
            if(request.kind==='suggestion')await cloud.resolveSuggestion(fresh,request.id,accepted);
            else await cloud.resolveRequest(fresh,request.user_id,accepted?role.value:'dismiss');
            if(!current())return;
            chart._cloud=fresh._cloud;store.persist();row.done=true;
            status.textContent=accepted?(request.kind==='access'?'Access approved. A confirmation email is queued.':'Access approved.'):'Request dismissed.';
          }catch(error){status.classList.add('error');status.textContent='Could not update this request. '+error.message;}
          finally{rows.forEach(r=>{r.role.disabled=r.done||r.suggestion;r.approve.disabled=r.dismiss.disabled=r.done;});}
        }
        approve.addEventListener('click',()=>decide(true));dismiss.addEventListener('click',()=>decide(false));controls.append(role,approve,dismiss);section.prepend(email);section.append(controls,status);body.append(section);
      }
      const help=document.createElement('p');help.className='share-help';help.textContent='You can also review pending requests later in Share.';body.append(help);
    },actions:[{label:'Later',value:'cancel'},{label:'Done',value:'done',primary:true}]});}
    finally{ownerRequestsOpen=false;offerOwnerRequests();}
  }
  function renderHome(){
    if(!isHome())return;
    renderCloudStatus();
    document.title='Online Teeth Chart App — Dental Charting';auth.renderAccount();
    const local=store.data.charts.filter(c=>!c._cloud&&!c._starter).map(c=>({...c,local:true}));
    const known=new Set(local.map(c=>c.id));
    window.TeethLibrary.render($('[data-library-grid]'),{charts:[...local,...homeCards.filter(c=>!known.has(c.id))],email:auth.session?.user.email,onOpen:switchChart,onDelete:deleteChart,filter:$('[data-library-search]').value});
    $('[data-library-status]').textContent=homeError|| (homeLoading?'Loading your cloud library…':'');
    $('[data-library-retry]').hidden=!homeError;
    $('[data-home-storage]').textContent=(auth.session?'Signed in as '+auth.session.user.email:'Local charts are saved in this browser profile. Sign in to save with cloud.')+((storageChoice.backup==='file'||storageChoice.primary==='file')&&!fileWriter.connected?' Reconnect your JSON file in Save options.':'');
  }
  let homeRequest=null;
  async function refreshHome(){
    if(!accountId)return;
    if(auth.session?._backupOnly){
      homeCards=store.data.charts.filter(c=>c._cloud&&!c._cloud.unloaded).map(c=>({...c,access_role:c._cloud.role}));
      homeError='Cloud sign-in is unavailable. Showing charts in your existing account backup.';homeLoading=false;
      const cached=store.data.charts.find(c=>c._cloud&&!c._cloud.unloaded);if(cached){cached._cloudUnavailable=true;store.persist();queueRetry();}renderHome();return;
    }
    if(homeRequest?.account===accountId)return homeRequest.promise;
    const user=accountId,target=store,request={account:user};homeRequest=request;homeLoading=true;homeError='';renderHome();
    request.promise=cloud.libraryCards(target.data.charts.filter(c=>c._cloud).map(c=>c.id)).then(items=>{
      if(accountId!==user||store!==target)return;
      homeCards=items.filter(c=>!cloud.isDeleted(c.id));
      for(const meta of homeCards){
        let chart=target.data.charts.find(c=>c.id===meta.id);
        if(!chart){chart={id:meta.id,name:meta.name,annotations:{},history:[],createdAt:meta.updatedAt,updatedAt:meta.updatedAt,_cloud:{unloaded:true}};target.data.charts.push(chart);}
        if(chart._cloud){chart._cloud.role=meta.access_role;if(chart._cloud.unloaded){chart.name=meta.name;chart.updatedAt=meta.updatedAt;}}
      }
      target.persist();
    }).catch(error=>{if(accountId===user&&store===target){homeCards=backup.unavailable(error)?store.data.charts.filter(c=>c._cloud&&!c._cloud.unloaded).map(c=>({...c,access_role:c._cloud.role})):[];homeError=backup.unavailable(error)?'Cloud library unavailable. Showing charts available in your browser backup.':'Your cloud library could not be loaded. '+error.message;}}).finally(()=>{
      if(homeRequest===request)homeRequest=null;
      if(accountId===user&&store===target){homeLoading=false;renderHome();}
    });return request.promise;
  }
  $('[data-library-search]').addEventListener('input',renderHome);
  $('[data-library-retry]').addEventListener('click',refreshHome);
  let loadEpoch=0,listedAccount=null,libraryRequest=null;
  function refreshLibrary(){
    if(!accountId)return Promise.resolve([]);
    if(libraryRequest?.account===accountId)return libraryRequest.promise;
    const user=accountId,target=store,request={account:user};
    request.promise=cloud.list().then(items=>{
      if(accountId!==user||store!==target)return items;
      listedAccount=user;cloudLibrary=items.filter(item=>!cloud.isDeleted(item.id));
      for(const meta of cloudLibrary){
        const existing=store.data.charts.find(chart=>chart.id===meta.id);
        if(!existing)store.data.charts.push({id:meta.id,name:meta.name,annotations:{},history:[],createdAt:meta.updatedAt,updatedAt:meta.updatedAt,_cloud:{role:meta.access_role,unloaded:true}});
        else if(existing._cloud?.unloaded){existing.name=meta.name;existing.updatedAt=meta.updatedAt;existing._cloud.role=meta.access_role;}
      }
      store.persist();if(!libraryBusy&&!blocked)renderLibrary();
      return items;
    }).finally(()=>{if(libraryRequest===request)libraryRequest=null;});
    libraryRequest=request;return request.promise;
  }
  async function loadLibrary(){
    const epoch=++loadEpoch,loadingAccount=accountId;
    ownerRequests=null;if(ownerRequestsOpen)$('[data-dialog]').close('cancel');
    const outdated=()=>epoch!==loadEpoch||accountId!==loadingAccount;
    if(isHome()){blocked=false;libraryBusy=false;accessError='';preview=null;render();offerStorageChoice();if(accountId)refreshHome();return;}
    blocked=false;libraryBusy=true;accessError='';cloudError='';showNotice('');render();
    try{
      let id=cloud.routeId();
      if(!id){
        // Use the most recently edited/created chart known to this browser. The
        // sidebar is metadata only; other full charts load only when selected.
        id=window.TeethNavigation.latestChart(store.data.charts)?.id;
        if(!id&&auth.session){const items=await refreshLibrary();if(outdated())return;id=items[0]?.id;}
        id=id||store.current.id;
      }
      const opened=await window.TeethNavigation.openChart({store,id,loadCloud:async chartId=>{
        try{if(auth.session?._backupOnly)throw Object.assign(new Error('Cloud sign-in is temporarily unavailable.'),{status:503});const remote=await cloud.load(chartId);return outdated()?remote:backup.reconcile(store,remote,cloud.signature);}
        catch(error){
          if(outdated())throw error;
          const cached=store.data.charts.find(c=>c.id===chartId&&c._cloud&&!c._cloud.unloaded&&!c._cloud.deleteAfter);
          if(!cached||(!accountId&&!cached._cloud.anonymousEdit)||!backup.unavailable(error))throw error;
          cached._cloudUnavailable=true;retryAfter=Date.now()+30000;queueRetry();return cached;
        }
      }});
      if(outdated())return;
      if(opened.source==='cloud')cacheChart(opened.chart);
      libraryBusy=false;store.persist();showNotice(store.current._cloud?.deleteAfter?'This chart is scheduled for deletion. Make a copy before '+new Date(store.current._cloud.deleteAfter).toLocaleString()+'.':store.current._cloud?.role==='viewer'?'You have view-only access. Sign in with an authorized account to edit.':'');render();
      // Neither library discovery nor uploads hold the current chart's gate.
      if(auth.session&&listedAccount!==accountId)refreshLibrary().catch(()=>{if(!outdated()&&!blocked&&!store.current._cloudUnavailable)showNotice('Your chart is open, but the chart list could not be refreshed.');});
      if(store.current._cloudUnavailable){cloudError=backupMessage();showNotice(cloudError,true);renderSaveStatus();queueRetry();}
      else if(store.current._backupConflict)showNotice('Changes made elsewhere were kept. Your offline edits are in a separate local “backup copy”.');
      if(store.data.charts.some(c=>backup.needsRetry(c,cloud.signature)))queueRetry();
      syncBrowserCharts();
      offerStorageChoice();
      if(!store.current._cloudUnavailable)checkOwnerRequests(epoch);
    }catch(error){
      if(outdated())return;
      libraryBusy=false;blocked=true;
      if(error.code!=='42501')accessError='The access check could not finish. Please try again.';
      showNotice(error.message,true);render();
      syncBrowserCharts();
    }
  }
  auth.setBeforeChange(async()=>{if(!(await confirmDiscard()))return false;try{await saveFileNow();await cloud.flush();}catch{}if(cloudError){const result=await showDialog({title:'Leave unsaved cloud changes?',build:'Export your chart first if you want a portable backup of changes that could not be saved online.',actions:[{label:'Cancel',value:'cancel'},{label:'Continue',value:'continue'}]});return result==='continue';}return true;});
  auth.onChange(async session=>{
    auth.renderAccount();
    const next=session?.user.id||null;if(next===accountId){renderAccess();if(!session?._backupOnly&&store.data.charts.some(c=>backup.needsRetry(c,cloud.signature)))queueRetry();return;}
    clearTimeout(retryTimer);retryTimer=null;retryAfter=0;
    ownerRequests=null;if(ownerRequestsOpen)$('[data-dialog]').close('cancel');
    const wasGuest=!accountId,guestFile=!accountId&&next?fileWriter.link:null;
    autosave.flush();autosave.cancel();libraryBusy=true;accessError='';renderAccess();
    if(!next&&!blocked)window.history.replaceState({},'', homePath());
    accountId=next;store=makeStore();listedAccount=null;cloudLibrary=[];homeCards=[];homeError='';homeLoading=false;renderAccess();renderHome();
    fileConnectionEpoch++;rememberedFile=null;rememberedFileError='';filePreparing=false;filePicking=false;fileRestoreChecked=false;fileReconnectOffered=false;fileWriter.disconnect();fileCache.clear();clearTimeout(fileTimer);fileTimer=null;
    if(next)await stageBrowserCharts();
    if(guestFile&&accountId===next){await fileConnections.delete('guest').catch(()=>{});fileWriter.connect(guestFile.handle,guestFile.text,next);await fileWriter.onSaved(fileWriter.link);}
    // Preserve an explicitly opened chart URL, including a local chart just
    // imported from the guest library. Root startup chooses the latest chart.
    if(wasGuest&&next&&!cloud.routeId())window.history.replaceState({},'', homePath());
    preview=null;cloudError='';await loadLibrary();syncBrowserCharts();await restoreFileConnection();
  });
  window.addEventListener('online',()=>{autosave.flush();retryCloud();if(auth.session)syncBrowserCharts();});
  window.addEventListener('focus',()=>{if(Date.now()>=retryAfter)retryCloud();});
  window.addEventListener('popstate',async()=>{
    const target=location.pathname;autosave.flush();libraryBusy=true;renderAccess();
    try{if(!store.current._cloudUnavailable)await cloud.flushChart(store.current.id).catch(error=>{if(!backup.unavailable(error))throw error;});if(cloudError&&!store.current._cloudUnavailable)throw new Error(cloudError);}
    catch(error){libraryBusy=false;render();toast(error.message,true);return;}
    if(location.pathname===target)loadLibrary();
  });
  window.addEventListener('pagehide',()=>{
    // Native file handles must not be written/serialized while Chrome destroys
    // the page. Flush only the synchronous browser backup; resume sync on return.
    leavingPage=true;clearTimeout(fileTimer);fileTimer=null;
    autosave.flush();libraryBusy=true;renderAccess();
  });
  window.addEventListener('pageshow',event=>{if(event.persisted){leavingPage=false;loadLibrary().then(()=>saveFileNow()).catch(()=>{});}});
  if(isHome()||tourInterrupted){await loadLibrary();if(welcomeTask)await welcomeTask;}
  await stageBrowserCharts();
  const initialPath=location.pathname;
  render();
  window.history.replaceState({},'',initialPath);
  await loadLibrary();syncBrowserCharts();await restoreFileConnection();if(store.data.charts.some(c=>backup.needsRetry(c,cloud.signature)))queueRetry();
})();
