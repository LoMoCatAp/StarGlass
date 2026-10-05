const test=require('node:test'),assert=require('node:assert/strict');
const {CapsuleManager}=require('../electron/capsule-manager.cjs');
const {validateSettings}=require('../electron/core.cjs');
test('extra capsules share display data, support twelve panels and stop after repo changes',()=>{
 const created=[];class Bridge{
  constructor(options){this.options=options;this.connected=false;created.push(this);}
  start(){this.started=true;}stop(){this.stopped=true;}resize(w,h){this.size={w,h};}font(){}push(fields){this.state=fields;}show(){}hide(){}
 }
 const manager=new CapsuleManager({Bridge,exePath:'test-only',positionFor:()=>({x:10,y:20}),onCommand:()=>{},log:()=>{}});
 const settings=validateSettings({mini:true,multiMini:true,repos:Array.from({length:12},(_,i)=>`one/${String.fromCharCode(97+i)}`)});
 const state={settings,projects:{'one/b':{stars:34,downloads:288}},history:{},errors:{},token:'NEVER-SEND'};
 manager.reconcile(state);assert.equal(manager.entries().length,11);assert.equal(created[0].state.repo,'one/b');assert.equal(created[0].state.stars,34);
 assert.deepEqual(created[0].size,{w:320,h:44});assert.ok(!JSON.stringify(created[0].state).includes('NEVER-SEND'));
 state.settings=validateSettings({...settings,visibleRepos:[settings.repos[0]]});manager.reconcile(state);assert.equal(manager.entries().length,0);assert.ok(created.every(b=>b.stopped));
});
test('a terminated capsule stays closed through settings updates until explicitly restored',()=>{
 const created=[];class Bridge{
  constructor(options){this.options=options;this.connected=true;created.push(this);}
  start(){}stop(){}resize(){}font(){}push(){}show(){}hide(){}
 }
 const manager=new CapsuleManager({Bridge,exePath:'test-only',positionFor:()=>({x:10,y:20}),onCommand:()=>{},log:()=>{}});
 const state={settings:validateSettings({mini:true,multiMini:true,repos:['one/a','one/b','one/c']}),projects:{},history:{},errors:{}};
 manager.reconcile(state);assert.equal(manager.entries().length,2);
 created[0].options.onExit();assert.equal(manager.entries().length,1);
 state.settings=validateSettings({...state.settings,opacity:70});manager.reconcile(state);
 assert.equal(manager.entries().length,1);assert.equal(created.length,2);
 manager.resume(state);assert.equal(manager.entries().length,2);assert.equal(created.length,3);
 manager.stop();assert.equal(manager.entries().length,0);
});

test('an independent subset spawns only its selected extra panels and can restore a terminated panel',()=>{
 const created=[];class Bridge{
  constructor(options){this.options=options;this.connected=true;created.push(this);}
  start(){}stop(){this.stopped=true;}resize(){}font(){}push(state){this.state=state;}show(){}hide(){}
 }
 const manager=new CapsuleManager({Bridge,exePath:'test-only',positionFor:()=>({x:10,y:20}),onCommand:()=>{},log:()=>{}});
 const state={settings:validateSettings({repos:['one/a','one/b','one/c','one/d'],visibleRepos:['one/b','one/c']}),projects:{},history:{},errors:{}};
 manager.reconcile(state);assert.equal(manager.entries().length,1);assert.equal(created[0].state.repo,'one/c');
 state.settings=validateSettings({...state.settings,visibleRepos:['one/b','one/d']});manager.reconcile(state);
 assert.equal(created[0].stopped,true);assert.equal(manager.entries().length,1);assert.equal(created[1].state.repo,'one/d');
 created[1].options.onExit();assert.equal(manager.entries().length,0);
 manager.restoreRepo('one/d');manager.reconcile(state);assert.equal(manager.entries().length,1);
 state.settings=validateSettings({...state.settings,visibleRepos:[]});manager.reconcile(state);assert.equal(manager.entries().length,0);
});
