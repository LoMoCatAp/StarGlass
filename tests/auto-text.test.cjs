const test=require('node:test'),assert=require('node:assert/strict');
const {validateSettings}=require('../electron/core.cjs');
const {panelState}=require('../electron/panel-model.cjs');
test('auto text mode persists and reaches the native panel, manual modes remain selectable',()=>{
 for(const textColor of ['auto','dark','light']){
  const settings=validateSettings({textColor});
  assert.equal(settings.textColor,textColor);
  assert.equal(panelState({settings,projects:{},history:{},errors:{}}).textColor,textColor);
 }
 assert.equal(validateSettings({textColor:'invalid'}).textColor,'dark');
});
test('fallback chooses readable ink and resists transient wallpaper changes',async()=>{
 const {createAutoTextPolicy,luminance}=await import('../src/glass/auto-text.mjs');
 assert.equal(luminance([0,0,0]),0);assert.equal(luminance([1,1,1]),1);
 const dark=[[0,0,0]],bright=[[1,1,1]],policy=createAutoTextPolicy();
 assert.equal(policy.sample(bright,0),false);
 for(let t=125;t<=1000;t+=125)assert.equal(policy.sample(bright,t),false);
 // A two-sample dark flash is not enough to flip the whole panel.
 assert.equal(policy.sample(dark,1125),false);assert.equal(policy.sample(dark,1250),false);
 for(let t=1375;t<=2500;t+=125)policy.sample(bright,t);
 assert.equal(policy.sample(bright,2625),false);
 for(let t=2750;t<=4000;t+=125)policy.sample(dark,t);
 assert.equal(policy.sample(dark,4125),true);
 const initialDark=createAutoTextPolicy();assert.equal(initialDark.sample(dark,0),true);
});
