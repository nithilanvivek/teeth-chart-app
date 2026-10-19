(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TeethInstallation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function detect(navigator){
    const ua=navigator.userAgent||'',platform=navigator.platform||'';
    if(/iPad/i.test(ua)||(/Mac/i.test(platform+ua)&&navigator.maxTouchPoints>1))return 'ipados';
    if(/iPhone|iPod/i.test(ua))return 'ios';
    if(/Android/i.test(ua))return 'android';
    if(/CrOS/i.test(ua))return 'chromeos';
    if(navigator.userAgentData?.mobile)return 'unknown';
    if(/Windows/i.test(ua+platform))return 'windows';
    if(/Mac/i.test(ua+platform))return 'macos';
    if(/FreeBSD/i.test(ua+platform))return 'freebsd';
    if(/Linux/i.test(ua+platform))return 'linux';
    return 'unknown';
  }
  const appModes=['standalone','minimal-ui','window-controls-overlay'];
  const appQueries=['(display-mode)','(display-mode: browser)','(display-mode: fullscreen)','(display-mode: picture-in-picture)',...appModes.map(mode=>'(display-mode: '+mode+')')];
  const appWindows=new WeakSet(),launchKey='nithi.teeth.app-window.v1';
  function rememberAppWindow(window){
    appWindows.add(window);
    try{window.sessionStorage.setItem(launchKey,'true');}catch{}
  }
  function appWindow(navigator,window){
    // The manifest marks app launches. Keep this per window, never in shared
    // localStorage, so ordinary browser tabs keep their manual JSON choice.
    try{
      const url=new URL(window.location.href);
      if(url.searchParams.get('launch')==='app'){
        rememberAppWindow(window);
        url.searchParams.delete('launch');
        window.history.replaceState(window.history.state,'',url);
      }
    }catch{}
    const otherAppMode=window.matchMedia('(display-mode)').matches&&!window.matchMedia('(display-mode: browser)').matches&&!window.matchMedia('(display-mode: fullscreen)').matches&&!window.matchMedia('(display-mode: picture-in-picture)').matches;
    if(navigator.standalone===true||otherAppMode||appModes.some(mode=>window.matchMedia('(display-mode: '+mode+')').matches))rememberAppWindow(window);
    if(appWindows.has(window))return true;
    try{return window.sessionStorage.getItem(launchKey)==='true';}catch{return false;}
  }
  function desktopApp(navigator,window){
    return ['windows','macos','linux','freebsd','chromeos'].includes(detect(navigator))&&appWindow(navigator,window);
  }
  return {detect,desktopApp,appWindow,appModes,appQueries};
});
