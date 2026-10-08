(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TeethLocalFile=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const FORMAT='online-teeth-chart-app';
  function encode(charts,currentId,cloud){
    return JSON.stringify({format:FORMAT,version:1,current_chart_id:currentId,charts:charts.map(chart=>({id:chart.id,name:chart.name,createdAt:chart.createdAt,updatedAt:chart.updatedAt,annotations:chart.annotations,history:cloud.packHistory(chart.history)}))},null,2)+'\n';
  }
  function decode(text,model,cloud){
    const raw=JSON.parse(text);
    if(raw?.format!==FORMAT||raw.version!==1||!Array.isArray(raw.charts)||!raw.charts.length)throw new Error('This is not an Online Teeth Chart App library file.');
    const data={version:1,currentId:raw.current_chart_id,charts:raw.charts.map(chart=>({id:chart.id,name:chart.name,createdAt:chart.createdAt,updatedAt:chart.updatedAt,annotations:chart.annotations,history:cloud.unpackHistory(chart.history)}))};
    const checked=new model.Store({getItem:()=>JSON.stringify(data),setItem(){}});
    if(checked.writeBlocked)throw new Error('This file contains invalid chart data. It has not been changed.');
    return checked.data;
  }
  async function pick(picker){
    if(!picker)throw new Error('This browser cannot update a chosen file directly. Use desktop Chrome or Edge, or use Export for a downloaded copy.');
    // Check the extension ourselves so selection does not depend on the
    // operating system's registration of JSON content types.
    const [handle]=await picker({id:'teeth-chart-library',multiple:false});
    if(!/\.json$/i.test(handle.name||''))throw new Error('Choose a file ending in .json. Your file has not been changed.');
    if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw new Error('Read and write permission is required. Your file has not been changed.');
    const file=await handle.getFile();
    if(file.size>100*1024*1024)throw new Error('Choose a JSON library smaller than 100 MB.');
    return {handle,text:await file.text()};
  }
  class Connections {
    constructor(database=globalThis.indexedDB){this.database=database;this.ready=null;}
    open(){
      if(!this.ready)this.ready=new Promise((resolve,reject)=>{
        if(!this.database){reject(new Error('This browser cannot remember file connections.'));return;}
        const request=this.database.open('nithi.teeth.files.v1',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('connections');
        request.onerror=()=>reject(request.error);
        request.onblocked=()=>reject(new Error('Close other chart tabs to remember this file.'));
        request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.ready=null;};resolve(db);};
      });
      return this.ready;
    }
    async transaction(mode,operation){
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        const transaction=db.transaction('connections',mode);let request;
        transaction.oncomplete=()=>resolve(request.result);
        transaction.onabort=()=>reject(transaction.error||new Error('File connection could not be saved.'));
        transaction.onerror=()=>reject(transaction.error);
        try{request=operation(transaction.objectStore('connections'));}catch(error){transaction.abort();reject(error);}
      });
    }
    get(scope){return this.transaction('readonly',store=>store.get(scope));}
    set(scope,record){return this.transaction('readwrite',store=>store.put(record,scope));}
    delete(scope){return this.transaction('readwrite',store=>store.delete(scope));}
  }
  async function reconnect(record,request=false){
    // Call requestPermission directly from a click, before any asynchronous work.
    const permission=await record.handle[request?'requestPermission':'queryPermission']({mode:'readwrite'});
    if(permission!=='granted')return null;
    const file=await record.handle.getFile();
    if(file.size>100*1024*1024)throw new Error('Choose a JSON library smaller than 100 MB.');
    const text=await file.text();
    if(text!==record.text)throw new Error('The JSON file changed while disconnected. Choose it in Save options to open those changes or confirm replacement.');
    return {handle:record.handle,text};
  }
  class Writer {
    constructor(onChange=()=>{},onSaved=async()=>{}){this.onChange=onChange;this.onSaved=onSaved;this.link=null;this.queue=Promise.resolve();this.pending=0;this.error='';}
    connect(handle,text,scope){this.link={handle,text,scope};this.error='';this.onChange();}
    disconnect(){this.link=null;this.error='';this.onChange();}
    get connected(){return Boolean(this.link);}
    write(text,scope){
      const link=this.link;
      if(!link||link.scope!==scope)return Promise.resolve();
      this.pending++;this.onChange();
      const operation=this.queue.catch(()=>{}).then(async()=>{
        if(this.link!==link)return;
        if(this.error)throw new Error(this.error);
        if(text===link.text){await this.onSaved(link);return;}
        let writable;
        try{
          const file=await link.handle.getFile();
          if(await file.text()!==link.text)throw new Error('The JSON file changed outside this tab. Select it again to open those changes or confirm replacement.');
          writable=await link.handle.createWritable();await writable.write(text);await writable.close();link.text=text;
          await this.onSaved(link);
        }catch(error){if(writable)await writable.abort().catch(()=>{});if(this.link===link)this.error=error.message||'The local file could not be saved.';throw error;}
      });
      this.queue=operation;
      return operation.finally(()=>{this.pending--;this.onChange();});
    }
    flush(){return this.queue;}
  }
  return {encode,decode,pick,reconnect,Connections,Writer};
});
