(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else api.init(root);})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const filename='Online Teeth Chart App.json';
  function detectOS(platform='',agent=''){
    if(/cros|chrome\s?os/i.test(platform+' '+agent))return 'chromeos';
    if(/win/i.test(platform))return 'windows';
    if(/mac/i.test(platform))return 'mac';
    if(/linux/i.test(platform)&&!/android/i.test(agent))return 'linux';
    if(/windows/i.test(agent))return 'windows';
    if(/macintosh|mac os x/i.test(agent))return 'mac';
    if(/linux/i.test(agent)&&!/android/i.test(agent))return 'linux';
    return null;
  }
  function browserGuidance(agent='',brave=false,supported=false){
    const name=brave?'Brave':/firefox|fxios/i.test(agent)?'Firefox':/safari/i.test(agent)&&!/chrome|chromium|crios|edg|opr|opios/i.test(agent)?'Safari':null;
    if(supported)return name?{title:name+' supports direct file saving here',steps:['Continue with the file setup below, then choose your JSON file and allow read/write access.']}:null;
    if(name==='Brave')return {title:'Brave: enable direct file access',steps:['Open a new tab and enter brave://flags/#file-system-access-api in the address bar.','If the File System Access API setting is available, set it to Enabled and relaunch Brave. Save your current work before relaunching.','Return here, then choose your JSON file in Teeth Chart. If that setting is unavailable, use Save on Cloud or Export instead.']};
    return {title:(name?name+': ':'')+'use cloud saving or a downloaded copy',steps:['This browser cannot keep writing to a JSON file you choose on your computer. Downloading a blank file does not enable that permission.','For automatic saving, return to Teeth Chart and choose Save on Cloud, or keep saving in this browser profile.','For a file backup, open a chart and choose Export to download its current JSON copy. Export again after changes; the previous download will not update automatically.','To connect the whole-library JSON file for automatic updates, open Teeth Chart in desktop Chrome, Edge or a supported Opera version.']};
  }
  function init(win){
    const doc=win.document,tabs=[...doc.querySelectorAll('[data-os]')],labels={mac:'macOS',linux:'Linux',windows:'Windows',chromeos:'ChromeOS'};
    (async()=>{let brave=false;try{brave=Boolean(await win.navigator.brave?.isBrave());}catch{}
      const guidance=browserGuidance(win.navigator.userAgent,brave,typeof win.showOpenFilePicker==='function'),section=doc.querySelector('[data-browser-help]');
      if(guidance&&section){section.hidden=false;section.querySelector('h2').textContent=guidance.title;const list=section.querySelector('ol');for(const step of guidance.steps){const li=doc.createElement('li');li.textContent=step;list.append(li);}}
    })();
    const detected=detectOS(win.navigator.userAgentData?.platform||win.navigator.platform,win.navigator.userAgent);
    doc.querySelector('[data-detected]').textContent=detected?'Detected: '+labels[detected]:'Choose your operating system';
    function select(os){tabs.forEach(tab=>{const active=tab.dataset.os===os;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});doc.querySelectorAll('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==os);}
    tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>select(tab.dataset.os));tab.addEventListener('keydown',event=>{let index;if(event.key==='ArrowRight')index=(i+1)%tabs.length;if(event.key==='ArrowLeft')index=(i+tabs.length-1)%tabs.length;if(event.key==='Home')index=0;if(event.key==='End')index=tabs.length-1;if(index!==undefined){event.preventDefault();select(tabs[index].dataset.os);tabs[index].focus();}});});select(detected||'mac');
    doc.querySelector('[data-copy]').addEventListener('click',async()=>{try{await win.navigator.clipboard.writeText(filename);doc.querySelector('[data-status]').textContent='File name copied.';}catch{doc.querySelector('[data-status]').textContent='Select and copy the file name shown above.';}});
    doc.querySelector('[data-download]').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([],{type:'application/json'})),link=doc.createElement('a');link.href=url;link.download=filename;doc.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);doc.querySelector('[data-status]').textContent='Blank file downloaded. Return to your chart tab and choose it to start saving.';});
  }
  return {detectOS,browserGuidance,init};
});
