(() => {
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  function preview(annotations){
    const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 320 230');svg.setAttribute('aria-hidden','true');
    const shape=(tag,attrs)=>{const el=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;};
    for(const arch of ['upper','lower'])for(let i=0;i<16;i++){
      const angle=(arch==='upper'?190+160*i/15:170-160*i/15)*Math.PI/180;
      const x=160+116*Math.cos(angle),y=(arch==='upper'?101:129)+79*Math.sin(angle);
      const ann=annotations[`${arch}_tooth_${i+1}`],group=shape('g',{transform:`translate(${x} ${y}) rotate(${angle*180/Math.PI+(arch==='upper'?90:-90)})`});
      group.append(shape('path',{d:'M-6-8 Q0-11 6-8 Q10-2 6 7 Q0 11-6 7 Q-10-2-6-8Z',fill:ann?window.TeethModel.COLORS[ann.status]||'#c1c8d1':'#c1c8d1',stroke:'#fff','stroke-width':'1.2'}));
      if(ann?.filled)group.append(shape('rect',{x:-3,y:-3,width:6,height:6,rx:2,fill:'#69849b'}));
      if(ann?.cavity)group.append(shape('circle',{cx:3,cy:3,r:2.5,fill:'#354050'}));
      if(ann?.painful)group.append(shape('circle',{cx:7,cy:-7,r:3,fill:'#e56c76'}));
      if(ann?.wobbly)group.append(shape('path',{d:'M-5 12Q0 8 5 12',stroke:'#b68028',fill:'none'}));
      svg.append(group);
      const gum=annotations[`${arch}_space_${i+1}`];if(gum)svg.append(shape('circle',{cx:160+135*Math.cos(angle),cy:(arch==='upper'?101:129)+96*Math.sin(angle),r:3,fill:window.TeethModel.COLORS[gum.status]||'#72bfa4'}));
    }
    return svg;
  }
  function renderTemplates(container,onChoose){
    container.replaceChildren();
    for(const template of window.TeethModel.TEMPLATES){
      const button=node('button','template-card');button.type='button';button.dataset.template=template.id;
      button.setAttribute('aria-label','Create a '+template.name+' chart');
      const visual=node('span','template-preview');visual.append(preview(window.TeethModel.templateAnnotations(template.id)));
      const name=node('strong','template-name',template.name),description=node('span','template-description',template.description);
      button.append(visual,name,description);button.addEventListener('click',()=>onChoose(template));container.append(button);
    }
  }
  function render(container,{charts,email,onOpen,onDelete,filter=''}){
    container.replaceChildren();
    const visible=charts.filter(c=>c.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for(const chart of visible){
      const card=node('article','library-card'),link=node('a','library-card-link');link.href=window.TeethNavigation.chartPath(chart.id);link.setAttribute('aria-label','Open '+chart.name);
      link.addEventListener('click',event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();onOpen(chart.id);});
      const visual=node('div','library-preview');visual.append(preview(chart.preview||chart.annotations||{}));
      if(chart.shared_with_people){const shared=node('span','library-shared');shared.title='Shared with specific people';shared.setAttribute('aria-label','Shared with specific people');shared.innerHTML='<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/></svg>';visual.append(shared);}
      const info=node('div','library-card-info');info.append(node('h2','',chart.name));
      info.append(node('p','library-owner','Owned by '+(chart.local?'this browser profile':chart.access_role==='owner'?'you':'another user')));
      const edited=node('p','library-edited','Last edited '),time=node('time');const date=new Date(chart.updatedAt);time.textContent=Number.isNaN(date.getTime())?'unknown':date.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});if(!Number.isNaN(date.getTime()))time.dateTime=date.toISOString();edited.append(time);info.append(edited);
      const foot=node('div','library-card-foot');foot.append(node('span','library-storage',chart.delete_after?'Deleted · copy by '+new Date(chart.delete_after).toLocaleDateString():chart.local?'On this browser':chart.access_role==='owner'?'Cloud chart':chart.access_role==='editor'?'Shared · Editor':'Shared · Viewer'));
      if(chart.local||chart.access_role==='owner'){const remove=node('button','icon-button library-delete');remove.type='button';remove.setAttribute('aria-label','Delete '+chart.name);remove.innerHTML='<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/></svg>';remove.addEventListener('click',()=>onDelete(chart.id));foot.append(remove);}
      link.append(visual,info);card.append(link,foot);container.append(card);
    }
    if(!visible.length)container.append(node('p','library-empty',filter?'No charts match your search.':'Your charts will appear here. Create a chart to get started.'));
  }
  window.TeethLibrary={render,preview,renderTemplates};
})();
