(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.TeethCloud=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const queues=new Map();
  const deleting=new Map(),deleted=new Set();
  const accountKey=id=>(root.TeethAuth.session?.user.id||'anonymous')+':'+id;
  const isDeleting=id=>deleting.has(accountKey(id));
  const isDeleted=id=>deleted.has(accountKey(id));
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const stable=value=>JSON.stringify(canonical(value));
  function packHistory(history){
    let previous={};
    return {version:1,entries:[...history].slice(0,64).reverse().map(entry=>{
      const changes=Object.fromEntries(Object.entries(entry.snapshot).filter(([key,value])=>stable(previous[key])!==stable(value)));
      const removed=Object.keys(previous).filter(key=>!Object.hasOwn(entry.snapshot,key));
      previous=entry.snapshot;
      return {id:entry.id,edited_at:entry.edited_at,action_label:entry.action_label,changes,removed};
    })};
  }
  function unpackHistory(packed){
    if(!packed||packed.version!==1||!Array.isArray(packed.entries)||packed.entries.length>64)throw new Error('Unsupported chart history.');
    const snapshot={};
    return packed.entries.map(entry=>{
      if(!entry.changes||typeof entry.changes!=='object'||Array.isArray(entry.changes)||!Array.isArray(entry.removed))throw new Error('Invalid chart history.');
      for(const key of entry.removed){if(/^(upper|lower)_(tooth|space)_([1-9]|1[0-6])$/.test(key))delete snapshot[key];}
      for(const [key,value] of Object.entries(entry.changes)){if(/^(upper|lower)_(tooth|space)_([1-9]|1[0-6])$/.test(key))snapshot[key]=clone(value);}
      return {id:entry.id,edited_at:entry.edited_at,action_label:entry.action_label,snapshot:clone(snapshot)};
    }).reverse();
  }
  const signature=chart=>stable({name:chart.name,annotations:chart.annotations,history:packHistory(chart.history)});
  function hydrate(raw){
    const chart={id:raw.id,name:raw.name,annotations:root.TeethModel.cleanAnnotations(raw.annotations).annotations,history:unpackHistory(raw.history),createdAt:raw.createdAt,updatedAt:raw.updatedAt,_cloud:{deleteAfter:raw.delete_after||null,revision:raw.revision,role:raw.access_role,general:raw.general_access,linkRole:raw.link_role,domain:raw.access_domain||null,domains:raw.domain_rules||(raw.access_domain?[{domain:raw.access_domain,role:raw.link_role}]:[]),anonymousEdit:raw.anonymous_edit===true,members:raw.members||[],unloaded:false}};
    chart._cloud.savedHash=signature(chart);return chart;
  }
  function deadline(operation,milliseconds,onTimeout=()=>{}){
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{onTimeout();const error=new Error('The connection is taking too long. Please try again.');error.code='TIMEOUT';reject(error);},milliseconds);});
    return Promise.race([operation,timeout]).finally(()=>clearTimeout(timer));
  }
  async function rpc(name,args={}){
    const controller=new AbortController();
    const milliseconds=['teeth_get_chart','teeth_list_charts','teeth_library_cards','teeth_delete_info','teeth_delete_chart'].includes(name)?8000:20000;
    // Bound the entire SDK operation, including any wait for its auth lock.
    const operation=root.TeethAuth.client.rpc(name,args).abortSignal(controller.signal);
    const {data,error,status}=await deadline(Promise.resolve(operation),milliseconds,()=>controller.abort());
    if(error){const message=error.code==='PGRST202'?'Cloud storage is not ready yet. Your local chart is still available.':error.code==='40001'?'A newer version exists. Export your changes if needed, then reload this chart before saving.':error.code==='42501'?'This chart is unavailable or you do not have the required access.':error.message||'Could not connect to cloud storage.';const problem=new Error(message);problem.code=error.code;problem.status=status??error.status;throw problem;}
    return data;
  }
  const load=async id=>hydrate(await rpc('teeth_get_chart',{p_id:id}));
  const list=()=>rpc('teeth_list_charts');
  const libraryCards=ids=>rpc('teeth_library_cards',{p_ids:ids});
  async function openRoute(id,{onLibrary=()=>{},onLibraryError=()=>{}}={}){
    const chart=await load(id);
    if(root.TeethAuth.session)list().then(onLibrary,onLibraryError);
    return chart;
  }
  function save(chart){
    const userId=root.TeethAuth.session?.user.id||'anonymous';
    if(userId==='anonymous'&&!chart._cloud?.anonymousEdit)return Promise.reject(new Error('Sign in to save and share this chart online.'));
    const key=userId+':'+chart.id;
    const next=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
      if((root.TeethAuth.session?.user.id||'anonymous')!==userId)throw new Error('The signed-in account changed.');
      if(deleting.has(key)||deleted.has(key))throw Object.assign(new Error('This chart is being deleted.'),{code:'CHART_DELETING'});
      if(chart._cloud?.conflict)throw new Error('Reload this chart before saving. A newer version exists.');
      if(chart._cloud?.unloaded||chart._cloud?.role==='viewer')throw new Error('This chart is read-only.');
      const hash=signature(chart);if(chart._cloud?.savedHash===hash)return chart;
      try{
        // Content uploads never send sharing fields; the server retains its grants.
        const raw=await rpc('teeth_save_chart',{p_id:chart.id,p_name:chart.name,p_annotations:clone(chart.annotations),p_history:packHistory(chart.history),p_revision:chart._cloud?.revision||0});
        chart._cloud={revision:raw.revision,role:raw.access_role,general:raw.general_access,linkRole:raw.link_role,domain:raw.access_domain||null,domains:raw.domain_rules||(raw.access_domain?[{domain:raw.access_domain,role:raw.link_role}]:[]),anonymousEdit:raw.anonymous_edit===true,members:raw.members||[],savedHash:hash};
        return chart;
      }catch(error){if(error.code==='40001'&&chart._cloud?.revision)chart._cloud={...chart._cloud,conflict:true};throw error;}
    });
    queues.set(key,next);next.finally(()=>{if(queues.get(key)===next)queues.delete(key);}).catch(()=>{});return next;
  }
  const normalizeDomain=value=>String(value||'').trim().toLowerCase();
  const validDomain=value=>{const domain=normalizeDomain(value);return domain.length<=253&&/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(domain);};
  async function setSharing(chart,values){
    await save(chart);
    if(chart._cloud.role!=='owner')throw new Error('Only the owner can change sharing.');
    const modern=Array.isArray(values.domains);
    const raw=await rpc(modern?'teeth_set_sharing_v3':values.general==='domain'?'teeth_set_sharing_v2':'teeth_set_sharing',{p_id:chart.id,p_general_access:values.general,p_link_role:values.linkRole,p_members:values.members,p_revision:chart._cloud.revision,...(modern?{p_domains:values.domains.map(rule=>({domain:normalizeDomain(rule.domain),role:rule.role})),p_anonymous_edit:values.anonymousEdit===true}:values.general==='domain'?{p_domain:normalizeDomain(values.domain)}:{})});
    chart._cloud={...chart._cloud,revision:raw.revision,general:raw.general_access,linkRole:raw.link_role,domain:raw.access_domain||null,domains:raw.domain_rules||(raw.access_domain?[{domain:raw.access_domain,role:raw.link_role}]:[]),anonymousEdit:raw.anonymous_edit===true,members:raw.members||[]};return chart;
  }
  const copy=async(id,newId,name)=>hydrate(await rpc('teeth_copy_chart',{p_id:id,p_new_id:newId,p_name:name}));
  const suggestCollaborator=(id,email,role)=>rpc('teeth_suggest_collaborator',{p_id:id,p_email:email,p_role:role});
  const suggestions=id=>rpc('teeth_list_suggestions',{p_id:id});
  const resolveSuggestion=async(chart,id,approve)=>{chart._cloud=hydrate(await rpc('teeth_resolve_suggestion',{p_id:chart.id,p_request:id,p_approve:approve}))._cloud;};
  const deleteAccount=email=>rpc('teeth_delete_account',{p_confirm_email:email});
  const deleteInfo=id=>rpc('teeth_delete_info',{p_id:id});
  function deleteChart(chart,{revision}={}){
    const key=accountKey(chart.id),userId=root.TeethAuth.session?.user.id;
    if(deleting.has(key))return deleting.get(key);
    const next=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
      if(root.TeethAuth.session?.user.id!==userId)throw new Error('The signed-in account changed.');
      // Wait only for this chart's in-flight save. Failed/queued edits must not
      // prevent a confirmed delete or recreate the chart after it succeeds.
      if(chart._cloud){
        let expected=revision??chart._cloud.revision;
        if(expected==null){const info=await deleteInfo(chart.id);if(!info){deleted.add(key);return;}expected=info.revision;}
        await rpc('teeth_delete_chart',{p_id:chart.id,p_revision:expected});
      }
      deleted.add(key);
    });
    deleting.set(key,next);queues.set(key,next);
    next.finally(()=>{if(deleting.get(key)===next)deleting.delete(key);if(queues.get(key)===next)queues.delete(key);}).catch(()=>{});
    return next;
  }
  const requestAccess=id=>rpc('teeth_request_access',{p_id:id});
  const accessRequests=id=>rpc('teeth_list_access_requests',{p_id:id});
  async function resolveRequest(chart,userId,role){
    const raw=await rpc('teeth_resolve_access_request',{p_id:chart.id,p_requester_id:userId,p_role:role,p_revision:chart._cloud.revision});
    chart._cloud=hydrate(raw)._cloud;return chart;
  }
  const chartUrl=id=>(typeof location !== 'undefined' ? location.origin : 'https://nithi.land')+'/teeth/'+encodeURIComponent(id);
  const routeId=()=>/^\/(?:teeth|t)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(root.location.pathname)?.[1]||null;
  async function flush(){await Promise.all([...queues.values()]);}
  async function flushChart(id){await queues.get((root.TeethAuth.session?.user.id||'anonymous')+':'+id);}
  return {copy,suggestCollaborator,suggestions,resolveSuggestion,deleteAccount,deleteChart,deleteInfo,isDeleting,isDeleted,deadline,openRoute,requestAccess,accessRequests,resolveRequest,normalizeDomain,validDomain,packHistory,unpackHistory,signature,hydrate,save,load,list,libraryCards,setSharing,chartUrl,routeId,flush,flushChart};
});
