const test=require('node:test'),assert=require('node:assert/strict');
const {validateSettings}=require('../electron/core.cjs');
const {panelSettings,overridePanel}=require('../electron/panel-appearance.cjs');
const {panelState}=require('../electron/panel-model.cjs');
const {panelSize}=require('../electron/panel-layout.cjs');
test('a panel appearance is independent, persists, and cannot override credentials or global behavior',()=>{
 let s=validateSettings({mini:true,multiMini:true,repos:['owner/First','owner/Second'],opacity:32});
 s=validateSettings(overridePanel(s,'owner/Second',{panelShape:'rectangle',customSize:true,panelWidth:500,panelHeight:70,fontSize:18,glassOnly:true}));
 s=validateSettings({...s,opacity:80,fontSize:12});
 assert.equal(panelSettings(s,'owner/First').opacity,80);assert.equal(panelSettings(s,'OWNER/SECOND').opacity,32);
 assert.deepEqual(panelSize(panelSettings(s,'owner/Second')),{w:500,h:70});assert.equal(panelSettings(s,'owner/Second').fontSize,18);
 const state={settings:{...s,activeRepo:1},projects:{},history:{},errors:{}};
 const fields=panelState(state);assert.equal(fields.radius,0);assert.equal(fields.glassOnly,1);assert.equal(fields.mini,1);
 const serialized=JSON.parse(JSON.stringify(s));serialized.panelOverrides['owner/second'].token='SECRET';serialized.panelOverrides['owner/second'].interval=1;
 const restored=validateSettings(serialized);assert.equal(restored.interval,30);assert.ok(!JSON.stringify(restored).includes('SECRET'));
 assert.deepEqual(panelSettings(restored,'owner/Second'),panelSettings(s,'owner/Second'));
});
test('removed repos lose overrides and removing a local override restores defaults',()=>{
 const s=validateSettings(overridePanel(validateSettings({repos:['owner/One','owner/Two']}),'owner/Two',{radius:0}));
 assert.equal(panelSettings(s,'owner/Two').radius,0);
 const reset=validateSettings({...s,panelOverrides:{}});assert.equal(panelSettings(reset,'owner/Two').radius,28);
 const removed=validateSettings({...s,repos:['owner/One']});assert.deepEqual(removed.panelOverrides,{});
});
