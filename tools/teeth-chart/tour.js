/* First-visit walkthrough. Targets stay real: edits use the normal chart controls. */
(() => {
  'use strict';
  const visible = selector => [...document.querySelectorAll(selector)].find(el => el.getClientRects().length && !el.closest('[hidden]'));
  function start({createChart,finish}) {
    let index=0,target=null,stopped=false,suspended=false,frame=0;
    const steps=[
      ['Create your first chart','[data-template="blank"]','Start with the Blank template. Child, Teenager and Adult templates are also available in your library. Give your chart a name—you can keep this real chart after the tour.'],
      ['Make it yours','.chart-title-row','Your chart’s name is here. Use the pencil to rename it whenever you like.'],
      ['Explore a tooth','[data-item-key="upper_tooth_8"]','Hover over a tooth to see its details. Select it to edit its status, additional details and notes.',true],
      ['Choose a tooth status','.status-fieldset','Statuses include Milk and Permanent. Empty, Wisdom, Not yet erupted and Fake tooth each have their own appearance.',true],
      ['Add visual details','[data-modifiers]','Additional details include Wobbly, Filled, Cavity and Painful / sensitive. Their visual effects appear on the tooth, and you can combine them.',true],
      ['Write a note','#annotation-note','Add anything you want to remember about this tooth. Edits save automatically. Save now saves pending edits immediately; it is gray and disabled when there are no unsaved changes.',true],
      ['Chart gum spaces','.mode-control','Switch between Teeth and Gum spaces. Unmarked gum spaces start gray. Applied conditions give them a color, and each space can also have a note.',true],
      ['Check your save status','[data-save-status]','This line shows where your changes are saved. During a cloud outage, available backups keep your edits; pending changes upload when cloud saving recovers.'],
      ['Choose saving and a backup','.header-actions [data-action="storage"]','Save options offers browser, local JSON or cloud storage, followed by a browser or JSON backup. Next: Backup options reopens backup settings. Already a user? Sign-in stays at the bottom. Cancel during setup returns to the main chooser.'],
      ['Focus on your chart','[data-action="fullscreen"]','Full screen keeps the title, chart and annotation panel visible. Use Exit full screen or Escape to return.'],
      ['Share and review requests','[data-action="share"]','Sign in to share a cloud chart. Owners can invite emails, set Viewer or Editor roles, add several domains, or enable link access. Pending requests appear when the owner opens the chart.'],
      ['Keep your own copy','[data-action="copy"]','Make a copy duplicates a chart you can access. You own the copy, and it starts with restricted access.'],
      ['Revisit earlier changes','[data-action="history"]','History keeps the latest 64 saved changes. Preview an earlier version and restore it when needed.'],
      ['Export a backup','[data-action="export"]','Export downloads a JSON copy of the current chart. Save Locally can connect one JSON file containing your whole library.'],
      ['Import chart','.header-actions [data-action="import"]','Import chart opens a single-chart JSON export and replaces the current chart’s annotations after confirmation. Its name and sharing settings stay the same, and its previous contents remain in History.'],
      ['Import Backup JSON file','.sidebar [data-action="import-backup"], .mobile-chart-switch [data-action="import-backup"]','Restore charts from your JSON backup here. Review each preview and name, then confirm to add new copies. Existing charts and their sharing settings stay unchanged.'],
      ['Manage your charts','.mobile-chart-switch, .sidebar .chart-list','Switch charts here. Use New chart to add one, Import Backup JSON file to restore a backup, and the trash icon to delete with confirmation. You must keep at least one chart.'],
      ['Help whenever you need it','.header-actions [data-action="help"]','Help restarts this tour from your library while keeping existing charts and edits. Finishing or closing the tour opens the saving choices.'],
      ['Your account','[data-account-button]','Sign in with an email code to save online. Your account menu includes local-chart syncing, changing your email and deleting your account. At sign-in, choose Merge with cloud or Keep local for now.'],
      ['Return to your library','.header-actions [data-action="home"]','The home icon opens All charts, your library with previews, last-edited dates and shared indicators. You’re ready—now choose where to save.']
    ];
    const root=document.createElement('div');root.className='chart-tour';root.dataset.tour='';
    const shade=document.createElement('div');shade.className='tour-shade';
    const ring=document.createElement('div');ring.className='tour-highlight';ring.setAttribute('aria-hidden','true');
    const card=document.createElement('section');card.className='tour-card';card.setAttribute('role','dialog');card.setAttribute('aria-labelledby','tour-title');card.setAttribute('aria-describedby','tour-description');card.tabIndex=-1;
    card.innerHTML='<button type="button" class="tour-close" aria-label="Close tour">×</button><p class="tour-progress"></p><h2 id="tour-title"></h2><p id="tour-description"></p><div class="tour-actions"><button type="button" class="button" data-tour-back>Back</button><button type="button" class="button primary" data-tour-next>Next</button></div>';
    root.append(shade,ring,card);document.body.append(root);
    const next=card.querySelector('[data-tour-next]'),back=card.querySelector('[data-tour-back]');
    function layout(){
      frame=0;if(stopped||suspended)return;
      target=visible(steps[index][1]);
      const box=target?.getBoundingClientRect(),w=innerWidth,h=innerHeight,pad=7,gap=18;
      if(box){Object.assign(ring.style,{left:box.left-pad+'px',top:box.top-pad+'px',width:box.width+pad*2+'px',height:box.height+pad*2+'px'});ring.hidden=false;shade.hidden=true;}
      else{ring.hidden=true;shade.hidden=false;}
      const cw=card.offsetWidth,ch=card.offsetHeight;
      let left=(w-cw)/2,top=h-ch-16;
      if(box){
        if(w>760&&box.right+gap+cw<w-12){left=box.right+gap;top=Math.max(12,Math.min(box.top,h-ch-12));}
        else if(w>760&&box.left-gap-cw>12){left=box.left-gap-cw;top=Math.max(12,Math.min(box.top,h-ch-12));}
        else if(box.bottom+gap+ch<h-12){top=box.bottom+gap;left=box.left;}
        else if(box.top-gap-ch>12){top=box.top-gap-ch;left=box.left;}
      }
      Object.assign(card.style,{left:Math.max(12,Math.min(left,w-cw-12))+'px',top:Math.max(12,top)+'px'});
    }
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(layout);};
    function show(){
      root.hidden=false;suspended=false;
      const [title,selector,description]=steps[index];
      card.querySelector('.tour-progress').textContent=`QUICK TOUR · ${index+1} OF ${steps.length}`;
      card.querySelector('h2').textContent=title;card.querySelector('#tour-description').textContent=description;
      back.hidden=index<2;next.textContent=index===0?'Create a chart':index===steps.length-1?'Choose where to save':'Next';next.disabled=false;
      target=visible(selector);target?.scrollIntoView({behavior:'instant',block:'center',inline:'nearest'});
      // On narrow screens keep the highlighted control above the guide card.
      if(innerWidth<=760&&target){const b=target.getBoundingClientRect();window.scrollBy(0,b.top-50);}
      layout();card.focus({preventScroll:true});
    }
    async function end(){
      if(stopped)return;stopped=true;cancelAnimationFrame(frame);root.remove();
      document.removeEventListener('click',guard,true);document.removeEventListener('keydown',key,true);document.removeEventListener('focusin',focus,true);
      window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);window.removeEventListener('popstate',end);observer.disconnect();
      await finish();
    }
    async function advance(){
      if(index===steps.length-1)return end();
      if(index===0){
        if(suspended)return;suspended=true;root.hidden=true;
        try{if(!await createChart())return end();}catch{ return end(); }
        if(stopped)return;
      }
      index++;show();
    }
    function allowed(el){return card.contains(el)||(steps[index][3]&&target?.contains(el));}
    function guard(event){
      if(suspended||stopped||allowed(event.target))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(index===0&&target?.contains(event.target))advance();
    }
    function focus(event){if(!suspended&&!stopped&&!allowed(event.target))card.focus({preventScroll:true});}
    function key(event){
      if(suspended||stopped)return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();end();return;}
      if(event.key==='Tab'){
        const selector='button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]';
        const candidates=[...(steps[index][3]&&target?[target,...target.querySelectorAll(selector)]:[]),...card.querySelectorAll(selector)].filter(el=>el.matches(selector)&&el.getClientRects().length);
        const current=candidates.indexOf(document.activeElement),position=(current+(event.shiftKey?-1:1)+candidates.length)%candidates.length;
        event.preventDefault();candidates[position]?.focus();
      }
    }
    next.addEventListener('click',advance);back.addEventListener('click',()=>{index--;show();});card.querySelector('.tour-close').addEventListener('click',end);
    document.addEventListener('click',guard,true);document.addEventListener('keydown',key,true);document.addEventListener('focusin',focus,true);
    window.addEventListener('resize',schedule);document.addEventListener('scroll',schedule,true);window.addEventListener('popstate',end);
    const observer=new ResizeObserver(schedule);observer.observe(document.body);observer.observe(card);
    show();return {end};
  }
  window.TeethTour={start};
})();
