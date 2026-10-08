(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TeethAccess=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function render(document,{loading,blocked,local=false,email='',requested=false,requesting=false,error=''}){
    const find=selector=>document.querySelector(selector),gated=loading||blocked;
    find('.app-shell').hidden=gated;find('[data-access-gate]').hidden=!gated;
    find('[data-access-spinner]').hidden=!loading;find('[data-access-lock]').hidden=loading;
    if(!gated)return;
    document.title=loading?'Opening chart · Teeth Chart App':'Access required · Teeth Chart App';
    find('[data-access-title]').textContent=loading?'Loading chart…':error?'Couldn’t check access':'You need access';
    find('[data-access-help]').textContent=loading?(local?'Opening the chart saved in this browser.':'Checking access to this chart.'):error?'Check your connection and try again.':email?'Request access, or sign in with an account that has permission.':'Request access or sign in with an account that has permission.';
    find('[data-access-actions]').hidden=loading;
    find('[data-access-email]').textContent=email;find('[data-access-email]').hidden=!email||loading;
    find('[data-access-signin]').textContent=email?'Use another account':'Sign in';
    find('[data-access-retry]').hidden=!error||loading;
    const request=find('[data-request-access]');request.hidden=Boolean(error);request.disabled=requested||requesting;request.textContent=requested?'Request sent':requesting?'Requesting…':'Request access';
    find('[data-access-message]').textContent=error||(requested?'Your request has been submitted. Reopen this link after the owner grants access.':'');
  }
  return {render};
});
