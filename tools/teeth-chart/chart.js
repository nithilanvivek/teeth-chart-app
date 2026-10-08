(() => {
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  const {itemInfo,LABELS}=window.TeethModel;
  const element=(name,attrs={})=>{const el=document.createElementNS(NS,name);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,String(value));return el;};
  function text(parent,value,x,y,className){const el=element('text',{x,y,class:className});el.textContent=value;parent.append(el);return el;}
  function point(arch,index,rx=270,ry=205){const angle=(arch==='upper'?190+160*index/15:170-160*index/15);const rad=angle*Math.PI/180;return{x:400+rx*Math.cos(rad),y:(arch==='upper'?288:366)+ry*Math.sin(rad),rotation:arch==='upper'?angle+90:angle-90};}
  function shapePath(number){
    if(number<=2)return 'M-12-16 Q0-20 12-16 Q17-7 14 8 Q12 18 0 19 Q-12 18-14 8 Q-17-7-12-16Z';
    if(number===3)return 'M-14-15 Q-8-21 0-23 Q8-21 14-15 Q20-3 13 13 Q8 22 0 23 Q-8 22-13 13 Q-20-3-14-15Z';
    if(number<=5)return 'M-16-17 Q-8-23 0-19 Q9-23 16-17 Q22-6 17 2 Q22 16 10 20 Q0 24-10 20 Q-22 16-17 2 Q-22-6-16-17Z';
    return 'M-18-19 Q-9-25 0-20 Q10-26 20-17 Q26-9 21 0 Q27 11 17 20 Q8 25 0 20 Q-11 26-20 17 Q-25 10-20 0 Q-26-11-18-19Z';
  }
  function defs(svg){
    const definition=element('defs');
    const gradients={unmarked:['#d0d3d8','#a9afb8'],permanent:['#ffffff','#e2eaf3'],milk:['#effaff','#a9d9f6'],wisdom:['#faf5ff','#d4bef1'],empty:['#fffafa','#f9e1df'],not_yet_erupted:['#fffdf4','#f6e5b0'],fake_tooth:['#fff7ed','#f4d2a8'],filling:['#e9f0fa','#7892ae'],fulfilled:['#f0fff9','#a7dbc6'],tooth:['#e5efff','#76a8f0']};
    for(const [name,colors]of Object.entries(gradients)){
      const gradient=element('linearGradient',{id:`enamel-${name}`,x1:'0%',y1:'0%',x2:'85%',y2:'100%'});
      gradient.append(element('stop',{offset:'0%','stop-color':colors[0]}),element('stop',{offset:'100%','stop-color':colors[1]}));definition.append(gradient);
    }
    const filter=element('filter',{id:'tooth-shadow',x:'-40%',y:'-40%',width:'180%',height:'180%'});filter.append(element('feDropShadow',{dx:0,dy:2,stdDeviation:1.6,'flood-color':'#59789b','flood-opacity':.15}));definition.append(filter);const glow=element('filter',{id:'pain-glow',x:'-60%',y:'-60%',width:'220%',height:'220%'});glow.append(element('feGaussianBlur',{stdDeviation:2.2}));definition.append(glow);svg.append(definition);
  }
  function render(svg,{annotations={},selectedKey='upper_tooth_8',mode='tooth',onSelect,preview=false}){
    const focusedKey=document.activeElement?.dataset.itemKey;
    svg.parentElement.querySelector('.tooth-tooltip')?.remove();
    const tooltip=document.createElement('div');tooltip.className='tooth-tooltip';tooltip.hidden=true;tooltip.id='tooth-hover-details';tooltip.setAttribute('role','tooltip');svg.parentElement.append(tooltip);
    const hideTooltip=()=>{tooltip.hidden=true;};
    const placeTooltip=(x,y)=>{const box=tooltip.getBoundingClientRect();tooltip.style.left=Math.max(12,Math.min(x+16,innerWidth-box.width-12))+'px';tooltip.style.top=Math.max(12,Math.min(y+16,innerHeight-box.height-12))+'px';};
    svg.replaceChildren();defs(svg);
    const midline=element('path',{d:'M400 27V59 M400 607V640',class:'arch-guide'});svg.append(midline);
    text(svg,'UPPER JAW',400,221,'jaw-title');text(svg,'Maxillary arch',400,240,'jaw-subtitle');
    text(svg,'LOWER JAW',400,429,'jaw-title');text(svg,'Mandibular arch',400,448,'jaw-subtitle');
    const center=element('path',{d:'M308 327H365 M435 327H492',stroke:'#e9eef4','stroke-width':1});svg.append(center);
    text(svg,'R',65,331,'side-marker');text(svg,'L',735,331,'side-marker');
    text(svg,'32 teeth · 32 gum spaces',400,331,'jaw-subtitle');
    for(const arch of ['upper','lower']){
      for(const type of ['tooth','space']){
        for(let index=0;index<16;index++){
          const key=`${arch}_${type}_${index+1}`,info=itemInfo(key),ann=annotations[key],selected=selectedKey===key;
          const p=point(arch,index,type==='space'?317:270,type==='space'?252:205);
          const group=element('g',{transform:`translate(${p.x} ${p.y}) rotate(${p.rotation}) scale(${type==='tooth'?(info.permanent%10>=6?.9:1.1):1})`,class:`chart-item ${type}${selected?' selected':''}${type!==mode?' inactive':''}`,'data-item-key':key,role:'button',tabindex:selected?'0':'-1','aria-pressed':selected,'aria-label':`${info.label}, ${info.location} ${info.name.toLowerCase()}, FDI ${info.permanent}, ${ann?LABELS[ann.status]:'Unmarked'}${ann?.wobbly?', wobbly':''}${ann?.filled?', filled':''}${ann?.cavity?', cavity':''}${ann?.painful?', painful or sensitive':''}${ann?.note?', note: '+ann.note:''}`});
          const showTooltip=event=>{
            tooltip.replaceChildren();
            const heading=document.createElement('strong');heading.textContent=info.permanent+' · '+info.name;
            const location=document.createElement('span');location.textContent=info.location+(info.primary?' · Milk '+info.primary:'');
            const details=document.createElement('p');details.textContent=[ann?LABELS[ann.status]:'Unmarked',ann?.wobbly?'Wobbly':'',ann?.filled?'Filled':'',ann?.cavity?'Cavity':'',ann?.painful?'Painful / sensitive':''].filter(Boolean).join(' · ');
            tooltip.append(heading,location,details);if(ann?.note){const note=document.createElement('p');note.className='tooth-tooltip-note';note.textContent=ann.note;tooltip.append(note);}
            tooltip.hidden=false;const box=group.getBoundingClientRect();placeTooltip(event.clientX??box.right,event.clientY??box.top);
          };
          group.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')showTooltip(event);});
          group.addEventListener('pointermove',event=>{if(!tooltip.hidden)placeTooltip(event.clientX,event.clientY);});
          group.addEventListener('pointerleave',hideTooltip);group.addEventListener('focus',showTooltip);group.addEventListener('blur',hideTooltip);
          group.addEventListener('keydown',event=>{if(event.key==='Escape')hideTooltip();});

          if(type==='tooth'){
            const path=shapePath(info.permanent%10);
            const visual=element('g',{class:'tooth-visual'+(ann?.wobbly?' is-wobbly':'')});group.append(visual);
            if(ann?.painful)visual.append(element('path',{d:path,transform:'scale(1.18)',class:'pain-halo',fill:'#f59b9b',stroke:'#e85c68','stroke-width':6,filter:'url(#pain-glow)'}));
            visual.append(element('path',{d:path,class:'selection-ring',transform:'scale(1.20)'}));
            visual.append(element('path',{d:path,class:'tooth-shape',fill:`url(#enamel-${ann?.status||'unmarked'})`,...(ann?.status==='empty'?{'stroke-dasharray':'3 2'}:{})}));
            if(ann?.status==='empty')visual.append(element('path',{d:'M-6-6L6 6M6-6L-6 6',stroke:'#d9a5a5','stroke-width':1.6,fill:'none'}));
            else{
              let groove=info.permanent%10<=2?'M-8-6Q0-9 8-6':info.permanent%10===3?'M0-12Q-5-3 0 12M0-3L8-8':info.permanent%10<=5?'M0-12Q-4 0 0 12M-9-3L0 0 9-3':'M-12-8L-4-3 0-12M-4-3L1 4 12 8M1 4L-9 11M1 4L10-7';
              visual.append(element('path',{d:groove,class:'tooth-groove'}));
              visual.append(element('path',{d:shapePath(info.permanent%10),transform:'translate(-1 -2) scale(.79)',fill:'none',stroke:'#ffffff','stroke-width':.8,opacity:.6}));
            }
            if(ann?.filled){visual.append(element('path',{d:'M-8-7Q0-11 9-5L7 6Q-2 10-8 3Z',class:'filling-mark',fill:'url(#enamel-filling)',stroke:'#58748e','stroke-width':1.2}));visual.append(element('path',{d:'M-5-4Q0-7 5-3',fill:'none',stroke:'#fff','stroke-width':1.4,'stroke-linecap':'round'}));}
            if(ann?.cavity){visual.append(element('ellipse',{cx:7,cy:8,rx:4.8,ry:4.2,fill:'#303745',stroke:'#647185','stroke-width':1.1}));visual.append(element('circle',{cx:4,cy:12,r:1.8,fill:'#465162'}));}
            if(ann?.painful){visual.append(element('circle',{cx:18,cy:-18,r:6,fill:'#e56c76',stroke:'#fff','stroke-width':1.3}));visual.append(element('path',{d:'M19-22L15-17H18L17-14L21-19H18Z',fill:'#fff'}));}
            if(ann?.wobbly)visual.append(element('path',{d:'M-11 26Q-5 21 0 26T11 26',fill:'none',stroke:'#cf9635','stroke-width':2.2,'stroke-linecap':'round'}));
          }else{
            group.append(element('rect',{x:-19,y:-11,width:38,height:22,rx:9,fill:'transparent'}));
            group.append(element('rect',{x:-15,y:-6,width:30,height:12,rx:5,class:'gum-shape',fill:`url(#enamel-${ann?.status||'unmarked'})`}));
            if(ann)group.append(element('circle',{r:2,fill:ann.status==='empty'?'#d99993':ann.status==='tooth'?'#326bc2':'#699d90'}));
          }
          group.addEventListener('click',()=>onSelect(key));
          group.addEventListener('keydown',event=>{
            if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(key);}
            if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
              event.preventDefault();const nextIndex=Math.max(0,Math.min(15,index+(event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0)));const nextArch=event.key==='ArrowUp'?'upper':event.key==='ArrowDown'?'lower':arch;
              onSelect(`${nextArch}_${type}_${nextIndex+1}`,true);
            }
          });
          svg.append(group);
          if(type==='tooth'){
            const labelPoint=point(arch,index,232,162);
            text(svg,String(info.permanent),labelPoint.x,labelPoint.y,`diagram-fdi${selected?' selected':''}`);
          }
        }
      }
    }
    if(focusedKey)svg.querySelector(`[data-item-key="${focusedKey}"]`)?.focus({preventScroll:true});
  }
  window.TeethDiagram={render};
})();
