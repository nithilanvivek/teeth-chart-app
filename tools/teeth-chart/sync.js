(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TeethSync=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  // Stage browser originals durably before doing network work. Cloud caches from
  // another account are never imported. Originals remain until upload succeeds.
  function stage({account,guest,signature,uuid=()=>globalThis.crypto.randomUUID()}){
    if(account.writeBlocked||guest.writeBlocked)throw new Error(account.error||guest.error);
    const staged=[];
    for(const source of guest.data.charts.filter(chart=>!chart._cloud&&!chart._starter)){
      const hash=signature(source);
      let target=account.data.charts.find(chart=>chart._browserSource?.id===source.id&&chart._browserSource.hash===hash);
      if(!target){
        const existing=account.data.charts.find(chart=>chart.id===source.id);
        if(existing&&!existing._cloud&&signature(existing)===hash)target=existing;
        else{
          target=clone(source);
          if(existing){target.id=uuid();target.name=(target.name.slice(0,105)+' (browser copy)');}
          account.data.charts.push(target);
        }
        target._browserSource={id:source.id,hash};
      }
      staged.push(target);
    }
    if(staged.length){
      account.data.charts=account.data.charts.filter(chart=>!chart._starter);
      if(!account.data.charts.some(chart=>chart.id===account.data.currentId))account.data.currentId=staged[0].id;
    }
    if(!account.persist())throw new Error(account.error);
    return staged;
  }
  function finish({chart,account,readGuest,signature}){
    if(!chart._browserSource||chart._cloud?.savedHash!==signature(chart))return;
    // Persist the confirmed cloud copy first. A storage failure or another tab's
    // edits leave the browser original intact for the next sign-in/retry.
    if(!account.persist())throw new Error(account.error);
    const guest=readGuest(),source=guest.data.charts.find(item=>item.id===chart._browserSource.id);
    if(guest.writeBlocked)throw new Error(guest.error);
    if(source&&signature(source)===chart._browserSource.hash){
      guest.deleteChart(source.id);
      if(guest.error)throw new Error(guest.error);
    }
    delete chart._browserSource;account.persist();
  }
  async function upload({chart,cloud,isCurrent,uuid=()=>globalThis.crypto.randomUUID()}){
    if(!isCurrent())return false;
    try{await cloud.save(chart);}
    catch(error){
      // Retry after an interrupted first upload without duplicating the chart.
      // A different remote version is preserved; the browser draft gets its own URL.
      if(error.code!=='40001'||chart._cloud?.revision)throw error;
      let remote;
      try{remote=await cloud.load(chart.id);}catch(problem){if(problem.code!=='42501')throw problem;}
      if(!isCurrent())return false;
      if(remote?._cloud?.role==='owner'&&cloud.signature(remote)===cloud.signature(chart))chart._cloud=remote._cloud;
      else{const copy={...chart,id:uuid(),name:chart.name.slice(0,105)+' (browser copy)'};await cloud.save(copy);if(isCurrent())Object.assign(chart,copy);}
    }
    return isCurrent();
  }
  return {stage,finish,upload};
});
