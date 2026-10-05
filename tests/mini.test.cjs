const test=require('node:test'),assert=require('node:assert/strict');
const {validateSettings}=require('../electron/core.cjs');
const {panelSize,panelRadius}=require('../electron/panel-layout.cjs');
const {panelState}=require('../electron/panel-model.cjs');
test('mini stays a pill at every supported font size and preserves normal layout preferences',()=>{
 for(const fontSize of [12,14,18]){
  const s=validateSettings({mini:true,compact:true,fontSize,radius:0,showLogo:true,glassOnly:true});
  const size=panelSize(s);assert.ok(size.w<=360&&size.h<=52);assert.equal(panelRadius(s),size.h/2);
  assert.equal(s.radius,0);assert.equal(s.compact,true);assert.equal(s.showLogo,true);
  const payload=panelState({settings:s,projects:{},history:{},errors:{}});
  assert.equal(payload.mini,1);assert.equal(payload.radius,size.h/2);assert.equal(payload.glassOnly,1);
  const restored=validateSettings({...s,mini:false});assert.equal(panelSize(restored).w,440);assert.equal(panelRadius(restored),0);
 }
 assert.deepEqual(panelSize(validateSettings({mini:true,fontSize:14})),{w:320,h:44});
 assert.equal(validateSettings({}).mini,false);
});
test('custom dimensions and shapes reach the renderer and tooltips are off by default',()=>{
 const s=validateSettings({mini:true,customSize:true,panelWidth:480,panelHeight:80,panelShape:'pill'});
 assert.deepEqual(panelSize(s),{w:480,h:80});assert.equal(panelRadius(s),40);
 assert.equal(panelRadius({...s,panelShape:'rectangle'}),0);
 assert.equal(panelRadius({...s,panelShape:'rounded',radius:10}),10);
 const payload=panelState({settings:s,projects:{},history:{},errors:{}});assert.equal(payload.panelShape,'pill');assert.equal(payload.showTooltips,0);
 assert.equal(validateSettings({panelHeight:1,fontSize:18}).panelHeight,414);
});
