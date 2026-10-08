(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TeethAutosave=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function create({commit,delay=500,setTimer=setTimeout,clearTimer=clearTimeout}){
    let timer=null,pending=null;
    function flush(){if(timer!==null)clearTimer(timer);timer=null;const edit=pending;pending=null;if(edit)return commit(edit);}
    function schedule(edit){pending=edit;if(timer!==null)clearTimer(timer);timer=setTimer(flush,delay);}
    function cancel(){if(timer!==null)clearTimer(timer);timer=null;pending=null;}
    return {schedule,flush,cancel,get pending(){return pending!==null;}};
  }
  return {create};
});
