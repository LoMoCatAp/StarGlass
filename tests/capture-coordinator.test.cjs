const test=require('node:test'),assert=require('node:assert/strict');
const {CaptureCoordinator}=require('../electron/capture-coordinator.cjs');
const worker=()=>({connected:true,lines:[],send(line){this.lines.push(line);}});
test('all panels remain visible to capture even when an old setting disabled it',()=>{
 const a=worker(),b=worker();let status='';
 const c=new CaptureCoordinator({getBridges:()=>[['primary',a],['extra',b]],isEnabled:()=>false,onStatus:s=>status=s});
 c.reconcile();assert.equal(status,'live');assert.deepEqual(a.lines,['HOST captureLive']);assert.deepEqual(b.lines,['HOST captureLive']);
 c.acknowledge('primary',{id:1});c.acknowledge('extra',{id:1});assert.equal(status,'live');
 assert.ok(!a.lines.some(line=>/capture(?:Off|Prepare|On)/.test(line)));
});
test('reconnected workers enter live capture without freezing other windows',()=>{
 const a=worker(),b=worker();let status='';b.connected=false;
 const c=new CaptureCoordinator({getBridges:()=>[['primary',a],['extra',b]],onStatus:s=>status=s});
 c.reconcile();assert.equal(status,'preparing');b.connected=true;c.reconcile();assert.equal(status,'live');assert.equal(b.lines.at(-1),'HOST captureLive');
 const count=a.lines.length;c.reconcile();assert.equal(a.lines.length,count);c.stop();
});
test('old capture settings migrate to direct screenshots',()=>{
 const {validateSettings}=require('../electron/core.cjs');assert.equal(validateSettings({allowScreenCapture:false}).allowScreenCapture,true);
});
