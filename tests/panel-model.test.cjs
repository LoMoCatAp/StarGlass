const test=require('node:test');
const assert=require('node:assert/strict');
const {DEFAULTS,validateSettings}=require('../electron/core.cjs');
const {panelState}=require('../electron/panel-model.cjs');
test('native payload distinguishes loading from zero and carries all live appearance settings',()=>{
 const settings=validateSettings({...DEFAULTS,repos:['one/repo','two/repo'],activeRepo:1,settingsTheme:'dark',tint:'rose',gloss:75,refraction:80,dispersion:24,glassFps:30,compact:true,alwaysOnTop:true,clickThrough:true});
 const state={settings,projects:{},history:{},errors:{},token:'NEVER-SEND'};
 const missing=panelState(state);
 assert.equal(missing.repo,'two/repo');assert.equal(missing.stars,-1);
 assert.equal(missing.gloss,.75);assert.ok(Math.abs(missing.refraction-44.8)<1e-9);assert.equal(missing.dispersion,12);
 assert.equal(missing.frameLimit,30);assert.equal(missing.tint,'rose');assert.equal(missing.compact,1);assert.equal(missing.topmost,1);assert.equal(missing.clickThrough,1);
 state.projects['two/repo']={stars:0,downloads:0,description:'中文 空格 = %',version:'v1 beta'};
 const result=panelState(state);assert.equal(result.stars,0);assert.equal(decodeURIComponent(result.description),'中文 空格 = %');assert.ok(!JSON.stringify(result).includes('NEVER-SEND'));
});
test('seven day series is bounded, ordered and preserves endpoints',()=>{
 const now=Date.now(), settings=validateSettings(DEFAULTS);
 const all=Array.from({length:400},(_,i)=>({time:now-399000+i*1000,stars:i,downloads:i*10}));
 const state={settings,projects:{},errors:{},history:{[settings.repos[0]]:[{time:now-8*86400000,stars:99,downloads:0},...all]}};
 const result=panelState(state,false,now), points=result.seriesStars.split(',');
 assert.equal(points.length,120);assert.equal(points[0],`${all[0].time}:0`);assert.equal(points.at(-1),`${now}:399`);
});
test('settings theme survives validation and an empty repo list keeps index zero',()=>{
 assert.equal(validateSettings({settingsTheme:'dark',repos:[]}).settingsTheme,'dark');
 assert.equal(validateSettings({settingsTheme:'invalid'}).settingsTheme,'system');
 assert.equal(validateSettings({repos:[],activeRepo:2}).activeRepo,0);
});
