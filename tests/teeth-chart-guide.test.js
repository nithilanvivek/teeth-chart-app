const {test}=require('node:test');
const assert=require('node:assert/strict');
const {detectOS,browserGuidance}=require('../tools/teeth-chart/save-locally/guide.js');
test('guide defaults to the detected OS, including ChromeOS before its Linux platform fallback',()=>{
  assert.equal(detectOS('macOS',''),'mac');assert.equal(detectOS('MacIntel',''),'mac');assert.equal(detectOS('Windows',''),'windows');assert.equal(detectOS('Win32',''),'windows');assert.equal(detectOS('Linux x86_64','Mozilla Linux'),'linux');assert.equal(detectOS('Linux x86_64','Mozilla CrOS x86_64'),'chromeos');assert.equal(detectOS('Chrome OS',''),'chromeos');assert.equal(detectOS('','Mozilla Windows NT 10.0'),'windows');assert.equal(detectOS('Linux','Android'),null);
});

test('unsupported Safari/Firefox and Brave receive specific local-file instructions',()=>{
 for(const name of ['Safari','Firefox']){const info=browserGuidance(name,false,false);assert.match(info.title,new RegExp(name));assert.match(info.steps.join(' '),/Export again/);assert.doesNotMatch(info.steps.join(' '),/brave:\/\/flags/);}
 const brave=browserGuidance('Chrome Safari',true,false);assert.match(brave.title,/Brave/);assert.match(brave.steps.join(' '),/brave:\/\/flags\/#file-system-access-api/);
 assert.match(browserGuidance('Chrome Safari',true,true).title,/supports direct file/);assert.equal(browserGuidance('Chrome Safari',false,true),null);
});
