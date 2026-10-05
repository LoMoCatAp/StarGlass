const test=require('node:test'),assert=require('node:assert/strict');
const {validateSettings}=require('../electron/core.cjs');
const {overridePanel,panelSettings}=require('../electron/panel-appearance.cjs');
const {panelState}=require('../electron/panel-model.cjs');
const {panelSize,minimumPanelHeight}=require('../electron/panel-layout.cjs');
test('expanded typography and content controls persist per project and reach the native payload',()=>{
 let s=validateSettings({repos:['one/a','one/b'],fontSize:48});
 s=validateSettings(overridePanel(s,'one/b',{displayName:'测试 项目',nameFontSize:64,starsFontSize:96,downloadsFontSize:32,showProjectName:false,showOwner:false,showStars:false,showDownloads:true,showDescription:false,showTrend:false,showMetadata:false,showFooter:false}));
 s=validateSettings(JSON.parse(JSON.stringify(s)));assert.equal(panelSettings(s,'one/a').fontSize,48);assert.equal(panelSettings(s,'one/a').showStars,true);
 const payload=panelState({settings:{...s,activeRepo:1},projects:{},history:{},errors:{}});
 assert.equal(decodeURIComponent(payload.displayName),'测试 项目');assert.equal(payload.nameFontSize,64);assert.equal(payload.starsFontSize,96);assert.equal(payload.downloadsFontSize,32);
 for(const flag of ['showProjectName','showOwner','showStars','showDescription','showTrend','showMetadata','showFooter'])assert.equal(payload[flag],0);
 assert.equal(payload.showDownloads,1);
});
test('large text stays within supported window bounds and increases capsule height',()=>{
 for(const fontSize of [8,12,18,32,48])for(const mini of [true,false]){
  const s=validateSettings({fontSize,mini,nameFontSize:64,starsFontSize:96});const size=panelSize(s);
  assert.ok(size.w>=260&&size.w<=1200);assert.ok(size.h>=minimumPanelHeight(s)&&size.h<=1200);
 }
 assert.ok(panelSize(validateSettings({mini:true,fontSize:18,starsFontSize:96})).h>=112);
 assert.equal(validateSettings({fontSize:999,nameFontSize:999,starsFontSize:999,downloadsFontSize:-1}).nameFontSize,64);
 assert.equal(validateSettings({displayName:' a\n\0b '}).displayName,'ab');
});
