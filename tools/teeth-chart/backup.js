(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TeethBackup=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MESSAGE='Error in cloud-saving. Charts will be auto-saved after error is fixed. Meanwhile you can continue editing and changes will be saved in your backup.';
  function unavailable(error){
    if(['42501','40001','PGRST202','PGRST301','PGRST302'].includes(error?.code)||[401,403,404].includes(error?.status))return false;
    return error?.code==='TIMEOUT'||error?.status>=500||error?.status===0||/failed to fetch|networkerror|network request failed|load failed|fetch failed|offline/i.test(error?.message||'');
  }
  const dirty=(chart,signature)=>Boolean(chart._cloud&&!chart._cloud.unloaded&&chart._cloud.savedHash&&signature(chart)!==chart._cloud.savedHash);
  const needsRetry=(chart,signature)=>!chart._starter&&!chart._localOnly&&!chart._cloudRetryStopped&&(chart._cloudPending||chart._cloudUnavailable||dirty(chart,signature));
  // A fresh permission check always wins. Concurrent remote edits are never
  // overwritten by an offline draft: keep that draft as a separate local chart.
  function reconcile(store,remote,signature,uuid=()=>globalThis.crypto.randomUUID()){
    const cached=store.data.charts.find(c=>c.id===remote.id);
    if(!cached||cached._cloud?.unloaded)return remote;
    if(dirty(cached,signature)&&signature(cached)!==signature(remote)){
      if(cached._cloud.savedHash===signature(remote)&&['owner','editor'].includes(remote._cloud.role)&&!remote._cloud.deleteAfter){
        cached._cloud=remote._cloud;cached._cloudPending=true;delete cached._cloudUnavailable;delete cached._cloudRetryStopped;return cached;
      }
      const copy=JSON.parse(JSON.stringify(cached));copy.id=uuid();copy.name=copy.name.slice(0,104)+' (backup copy)';copy._localOnly=true;
      for(const key of ['_cloud','_cloudPending','_cloudUnavailable','_cloudRetryStopped','_browserSource'])delete copy[key];
      store.data.charts.push(copy);remote._backupConflict=true;
    }
    return remote;
  }
  return {MESSAGE,unavailable,dirty,needsRetry,reconcile};
});
