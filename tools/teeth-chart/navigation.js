(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.TeethNavigation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  function basePath(location=root.location){
    if(location?.hostname==='teeth.nithi.land')return '';
    return /^\/tools\/teeth-chart(?:\/|$)/.test(location?.pathname||'')?'/tools/teeth-chart':'/teeth';
  }
  const homePath=()=>basePath()==='/teeth'?'/teeth':basePath()+'/';
  const chartPath=id=>basePath()+'/'+encodeURIComponent(id);
  const isHome=()=>root.location?.pathname===homePath()||root.location?.pathname===basePath()||/^\/(?:teeth|t)\/?$/.test(root.location?.pathname||'');
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
  return {basePath,homePath,chartPath,isHome,requiresSessionCheck,localChart,latestChart,openChart};
});
