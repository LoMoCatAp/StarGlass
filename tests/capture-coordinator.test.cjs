const test=require('node:test'),assert=require('node:assert/strict');
const {CaptureCoordinator}=require('../electron/capture-coordinator.cjs');
test('recording exposes windows only after every worker has a frozen clean background',()=>{
 const a={connected:true,lines:[],send(line){this.lines.push(line);}},b={connected:true,lines:[],send(line){this.lines.push(line);}};
 let enabled=true,status='';const c=new CaptureCoordinator({getBridges:()=>[['primary',a],['repo:one/repo',b]],isEnabled:()=>enabled,onStatus:s=>status=s});
 try{
  c.reconcile();const first=c.round;assert.equal(status,'preparing');
  c.acknowledge('primary',{id:first});assert.ok(!a.lines.some(l=>l.startsWith('HOST captureOn')));
  c.acknowledge('repo:one/repo',{id:first});assert.equal(status,'recordable');assert.equal(a.lines.at(-1),`HOST captureOn id=${first}`);
  c.reconcile(true);c.acknowledge('primary',{id:first});assert.equal(status,'preparing');
  c.fail({id:c.round});assert.equal(status,'error');assert.equal(a.lines.at(-1),'HOST captureOff');
  const failedRound=c.round-1;
  c.acknowledge('primary',{id:failedRound});c.acknowledge('repo:one/repo',{id:failedRound});
  assert.equal(status,'error');assert.equal(a.lines.at(-1),'HOST captureOff');
  enabled=false;c.reconcile();assert.equal(status,'live');
 }finally{c.stop();}
});
test('disconnecting a worker invalidates earlier snapshot acknowledgements',()=>{
 const a={connected:true,lines:[],send(line){this.lines.push(line);}},b={connected:true,lines:[],send(line){this.lines.push(line);}};
 let status='';const c=new CaptureCoordinator({getBridges:()=>[['primary',a],['extra',b]],isEnabled:()=>true,onStatus:s=>status=s});
 try{
  c.reconcile();const old=c.round;c.acknowledge('primary',{id:old});
  b.connected=false;c.reconcile();c.acknowledge('extra',{id:old});
  assert.equal(status,'preparing');assert.equal(c.targets,null);assert.equal(a.lines.at(-1),'HOST captureOff');
 }finally{c.stop();}
});
