/* Portable chart data and browser-local history. Compatible with the desktop JSON format. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TeethModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STORAGE_KEY = 'nithi.teeth.web.v1';
  const TOOTH_STATUSES = ['permanent', 'milk', 'wisdom', 'empty', 'not_yet_erupted', 'fake_tooth'];
  const SPACE_STATUSES = ['fulfilled', 'tooth', 'empty'];
  const LABELS = {permanent:'Permanent',milk:'Milk',wisdom:'Wisdom',empty:'Empty',not_yet_erupted:'Not yet erupted',fake_tooth:'Fake tooth',fulfilled:'Fulfilled',tooth:'Tooth'};
  const COLORS = {permanent:'#e6edf5',milk:'#64b5e8',wisdom:'#b393e2',empty:'#ec9c97',not_yet_erupted:'#e4c36d',fake_tooth:'#e6a668',fulfilled:'#72bfa4',tooth:'#568fe0'};
  const FDI = {upper:[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],lower:[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38]};
  const PRIMARY = {upper:[null,null,null,55,54,53,52,51,61,62,63,64,65,null,null,null],lower:[null,null,null,85,84,83,82,81,71,72,73,74,75,null,null,null]};
  const NAMES = ['', 'Central incisor','Lateral incisor','Canine','First premolar','Second premolar','First molar','Second molar','Third molar'];
  const FLAGS = ['wobbly','filled','cavity','painful'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function itemInfo(key) {
    const match = /^(upper|lower)_(tooth|space)_([1-9]|1[0-6])$/.exec(key);
    if (!match) return null;
    const [,arch,type,position] = match;
    const index = Number(position)-1, permanent = FDI[arch][index], primary = PRIMARY[arch][index];
    return {key,arch,type,index,permanent,primary,label:`${arch==='upper'?'U':'L'}${type==='space'?'G':''}${index+1}`,name:type==='tooth'?NAMES[permanent%10]:'Gum space',location:`${arch==='upper'?'Upper':'Lower'} ${index<8?'right':'left'}`};
  }
  function normalizeAnnotation(key, input) {
    const info = itemInfo(key);
    if (!info || !record(input)) return null;
    if (!(info.type==='tooth'?TOOTH_STATUSES:SPACE_STATUSES).includes(input.status)) return null;
    return {item_type:info.type,status:input.status,...Object.fromEntries(FLAGS.map(flag=>[flag,info.type==='tooth' && input[flag]===true])),note:typeof input.note==='string'?input.note.slice(0,10000):''};
  }
  function cleanAnnotations(input) {
    if (!record(input)) throw new Error('This file needs an annotations object. Please choose a Teeth Chart JSON file.');
    const annotations = {};
    let skipped = 0;
    for (const [key, value] of Object.entries(input)) {
      const annotation = normalizeAnnotation(key,value);
      if (annotation) annotations[key]=annotation;
      else skipped++;
    }
    return {annotations,skipped};
  }
  function parseImport(payload) {
    if (!record(payload)) throw new Error('Please choose a Teeth Chart JSON file.');
    const {annotations,skipped} = cleanAnnotations(payload.annotations);
    if (skipped && Object.keys(annotations).length===0) throw new Error('No compatible tooth or gum annotations were found. Your charts have not been changed.');
    return {name:typeof payload.chart_name==='string'?payload.chart_name.trim().slice(0,120):'',annotations,skipped};
  }
  const TEMPLATES = [
    {id:'blank',name:'Blank',description:'All teeth unmarked'},
    {id:'child',name:'Child',description:'8 not yet erupted · 24 milk',border:'not_yet_erupted',rest:'milk'},
    {id:'teenager',name:'Teenager',description:'8 not yet erupted · 24 permanent',border:'not_yet_erupted',rest:'permanent'},
    {id:'adult',name:'Adult',description:'8 wisdom · 24 permanent',border:'wisdom',rest:'permanent'}
  ];
  function templateAnnotations(id) {
    const template=TEMPLATES.find(item=>item.id===id);
    if(!template)throw new Error('Choose a chart template.');
    const annotations={};
    if(id==='blank')return annotations;
    for(const arch of ['upper','lower'])for(let position=1;position<=16;position++){
      const key=`${arch}_tooth_${position}`;
      annotations[key]=normalizeAnnotation(key,{status:position<=2||position>=15?template.border:template.rest});
    }
    return annotations;
  }
  function chartName(name) {
    const value = String(name || '').trim();
    if (!value) throw new Error('Give your chart a name.');
    if (value.length>120) throw new Error('Use a name with 120 characters or fewer.');
    return value;
  }
  function blankChart(name) {
    const now = new Date().toISOString();
    return {id:globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,name:chartName(name),annotations:{},history:[],createdAt:now,updatedAt:now};
  }
  class Store {
    constructor(storage) {
      this.storage=storage;
      this.error=null;
      this.writeBlocked=false;
      this.lastSaved=null;
      this.data={version:1,currentId:null,charts:[]};
      try {
        const raw=storage.getItem(STORAGE_KEY);
        this.lastSaved=raw;
        if(raw) {
          const parsed=JSON.parse(raw);
          if(!record(parsed) || parsed.version!==1 || !Array.isArray(parsed.charts)) throw new Error('Unrecognized saved chart data');
          for(const chart of parsed.charts) {
            if(!record(chart) || typeof chart.id!=='string' || typeof chart.name!=='string' || !Array.isArray(chart.history)) throw new Error('Invalid saved chart');
            chartName(chart.name);
            const cleaned=cleanAnnotations(chart.annotations);
            if(cleaned.skipped) throw new Error('Invalid saved annotations');
            chart.annotations=cleaned.annotations;
            chart.history=chart.history.slice(0,64).map(entry=>{
              if(!record(entry) || typeof entry.id!=='string' || typeof entry.edited_at!=='string' || typeof entry.action_label!=='string') throw new Error('Invalid saved history');
              const snapshot=cleanAnnotations(entry.snapshot);
              if(snapshot.skipped) throw new Error('Invalid saved history annotations');
              return {...entry,snapshot:snapshot.annotations};
            });
          }
          if(new Set(parsed.charts.map(chart=>chart.id)).size!==parsed.charts.length) throw new Error('Duplicate saved chart identifiers');
          this.data=parsed;
        }
      } catch {
        this.error='Saved charts could not be opened. The original browser data has been left untouched. You can work temporarily and export a copy.';
        this.writeBlocked=true;
      }
      if(!this.data.charts.length) {
        const chart={...blankChart('My first chart'),_starter:true};
        this.data.charts.push(chart);this.data.currentId=chart.id;
        if(!this.writeBlocked) this.persist();
      }
      if(!this.data.charts.some(chart=>chart.id===this.data.currentId)) this.data.currentId=this.data.charts[0].id;
    }
    get current(){return this.data.charts.find(chart=>chart.id===this.data.currentId);}
    persist(){
      try{
        if(this.writeBlocked) return false;
        if(this.storage.getItem(STORAGE_KEY)!==this.lastSaved){
          this.error='Your saved charts changed in another tab. Export any changes you want to keep, then reload saved charts before editing further.';
          this.writeBlocked=true;return false;
        }
        const serialized=JSON.stringify(this.data);this.storage.setItem(STORAGE_KEY,serialized);this.lastSaved=serialized;this.error=null;return true;
      }
      catch{this.error='This browser could not save your latest changes. Keep this tab open and export your chart to keep a copy.';return false;}
      finally{this.onPersist?.(this);}
    }
    create(name){
      const clean=chartName(name),existing=this.data.charts.find(chart=>chart.name.toLocaleLowerCase()===clean.toLocaleLowerCase());
      if(existing){this.select(existing.id);return existing;}
      const chart=blankChart(clean);this.data.charts.push(chart);this.data.currentId=chart.id;this.persist();return chart;
    }
    deleteChart(id){
      if(!this.data.charts.some(chart=>chart.id===id))throw new Error('Chart not found.');
      this.data.charts=this.data.charts.filter(chart=>chart.id!==id);
      if(!this.data.charts.length)this.data.charts.push({...blankChart('My first chart'),_starter:true});
      if(this.data.currentId===id)this.data.currentId=this.data.charts[0].id;
      this.persist();return this.current;
    }
    rename(name){
      const clean=chartName(name);
      if(this.data.charts.some(chart=>chart.id!==this.current.id&&chart.name.toLocaleLowerCase()===clean.toLocaleLowerCase()))throw new Error('Another chart already uses this name. Choose a different name.');
      delete this.current._starter;this.current.name=clean;this.current.updatedAt=new Date().toISOString();this.persist();return this.current;
    }
    select(id){if(!this.data.charts.some(chart=>chart.id===id))throw new Error('Chart not found.');this.data.currentId=id;this.persist();}
    commit(annotations,action){
      const clean=cleanAnnotations(annotations);if(clean.skipped)throw new Error('Invalid annotation.');
      const chart=this.current;
      if(JSON.stringify(chart.annotations)===JSON.stringify(clean.annotations)){this.persist();return false;}
      delete chart._starter;
      // Keep the initial version, so even the first annotation can be reverted.
      if(!chart.history.length)chart.history.push({id:globalThis.crypto.randomUUID(),edited_at:chart.createdAt,action_label:'Chart created',snapshot:clone(chart.annotations)});
      chart.annotations=clean.annotations;chart.updatedAt=new Date().toISOString();
      chart.history.unshift({id:globalThis.crypto.randomUUID(),edited_at:chart.updatedAt,action_label:action,snapshot:clone(chart.annotations)});
      chart.history=chart.history.slice(0,64);this.persist();return true;
    }
    annotate(key,values){
      const annotation=normalizeAnnotation(key,values);if(!annotation)throw new Error('Choose a valid annotation.');
      const info=itemInfo(key),old=this.current.annotations[key],annotations=clone(this.current.annotations);
      annotations[key]=annotation;
      const details=FLAGS.filter(flag=>annotation[flag]).map(flag=>flag==='painful'?'sensitive':flag);
      return this.commit(annotations,`${info.label} · ${old?'Updated':'Added'} ${LABELS[annotation.status].toLowerCase()}${details.length?' · '+details.join(', '):''}${annotation.note!==old?.note&&annotation.note?' · note added':''}`);
    }
    remove(key){if(!own(this.current.annotations,key))return false;const annotations=clone(this.current.annotations);delete annotations[key];return this.commit(annotations,`${itemInfo(key).label} · Removed annotation`);}
    clear(){return this.commit({},'Cleared chart');}
    restore(entry){return this.commit(entry.snapshot,`Restored version from ${new Date(entry.edited_at).toLocaleString()}`);}
    importChart(payload,name){const parsed=parseImport(payload);this.create(name||parsed.name||'Imported chart');this.commit(parsed.annotations,'Imported chart from JSON');return parsed;}
    exportPayload(annotations=this.current.annotations){return {chart_name:this.current.name,annotations:clone(annotations)};}
  }
  return {TEMPLATES,templateAnnotations,STORAGE_KEY,TOOTH_STATUSES,SPACE_STATUSES,LABELS,COLORS,FDI,PRIMARY,FLAGS,itemInfo,normalizeAnnotation,cleanAnnotations,parseImport,Store,clone};
});
