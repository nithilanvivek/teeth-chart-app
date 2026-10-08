(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TeethNavigation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function requiresSessionCheck(readStorage,href=''){
    // Email callbacks and remembered accounts must finish restoring identity.
    // An ordinary guest opening browser-only charts needs no auth network wait.
    if(/[?#&](?:code|access_token|refresh_token|error|error_description)=/.test(href))return true;
    try{return Boolean(readStorage('nithi.teeth.auth.v1'));}catch{return true;}
  }
  const localChart=(store,id)=>store.data.charts.find(chart=>chart.id===id&&!chart._cloud);
  function latestChart(charts){return charts.filter(chart=>!chart._starter).reduce((latest,chart)=>!latest||chart.updatedAt>latest.updatedAt?chart:latest,null);}
  async function openChart({store,id,loadCloud}){
    const local=localChart(store,id);
    if(local){store.select(id);return {chart:local,source:'browser'};}
    // A cached cloud copy never substitutes for a fresh permission check.
    return {chart:await loadCloud(id),source:'cloud'};
  }
  return {requiresSessionCheck,localChart,latestChart,openChart};
});
