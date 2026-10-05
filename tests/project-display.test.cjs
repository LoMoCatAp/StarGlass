const test=require('node:test'),assert=require('node:assert/strict');
const {validateSettings}=require('../electron/core.cjs');
const {visibleRepos,projectVisible,setProjectVisibility,selectProject}=require('../electron/project-display.cjs');
const {panelSettings}=require('../electron/panel-appearance.cjs');
const {panelState}=require('../electron/panel-model.cjs');
test('legacy single and multi panels migrate without changing their selection',()=>{
 assert.deepEqual(validateSettings({repos:['one/a','one/b'],activeRepo:1}).visibleRepos,['one/b']);
 assert.deepEqual(validateSettings({repos:['one/a','one/b'],multiMini:true}).visibleRepos,['one/a','one/b']);
 assert.deepEqual(validateSettings({repos:[],multiMini:true}).visibleRepos,[]);
});
test('independent display toggles persist, allow all off, and preserve monitored data and appearance',()=>{
 const initial=validateSettings({repos:['one/a','one/b'],opacity:20,panelOverrides:{'one/b':{opacity:80,fontSize:18}}});
 let s=validateSettings(setProjectVisibility(initial,'ONE/B',true));
 assert.deepEqual(s.visibleRepos,['one/a','one/b']);
 s=validateSettings(setProjectVisibility(s,'one/a',false));assert.deepEqual(s.visibleRepos,['one/b']);assert.equal(projectVisible(s,'one/a'),false);assert.equal(s.activeRepo,1);
 s=validateSettings(setProjectVisibility(s,'one/b',false));assert.deepEqual(s.visibleRepos,[]);
 assert.deepEqual(validateSettings(JSON.parse(JSON.stringify(s))).visibleRepos,[]);
 assert.deepEqual(s.repos,initial.repos);assert.equal(s.opacity,20);assert.deepEqual(s.panelOverrides,initial.panelOverrides);
 assert.deepEqual(validateSettings(setProjectVisibility(s,'one/b',true)).visibleRepos,['one/b']);
 assert.throws(()=>setProjectVisibility(s,'other/repo',true));
});
test('removed or duplicate visibility entries cannot spawn unknown projects',()=>{
 const s=validateSettings({repos:['one/a','one/b'],visibleRepos:['ONE/B','one/b','other/c',null,42]});
 assert.deepEqual(s.visibleRepos,['one/b']);
 assert.deepEqual(validateSettings({...s,repos:['one/a']}).visibleRepos,[]);
 const repos=Array.from({length:12},(_,i)=>`one/repo${i}`);
 assert.equal(visibleRepos(validateSettings({repos,visibleRepos:repos})).length,12);
});
test('project switching selects the new content without copying local appearance into defaults',()=>{
 const s=validateSettings({repos:['one/a','one/b','one/c'],opacity:20,panelOverrides:{'one/a':{opacity:70},'one/b':{opacity:80,fontSize:18}}});
 const next=validateSettings(selectProject(s,1));
 assert.deepEqual(next.visibleRepos,['one/b']);assert.equal(next.activeRepo,1);assert.equal(next.opacity,20);assert.deepEqual(next.panelOverrides,s.panelOverrides);
 assert.equal(panelSettings(next).opacity,80);assert.equal(panelSettings(next,'one/c').opacity,20);
 assert.equal(panelState({settings:next,projects:{'one/b':{stars:55}},history:{},errors:{}}).stars,55);
 const multi=validateSettings(selectProject({...next,visibleRepos:['one/a','one/b']},2));assert.deepEqual(multi.visibleRepos,['one/a','one/b','one/c']);
 assert.equal(selectProject(s,99),s);
});
test('an immediate display toggle keeps pending appearance edits and newly added projects',async()=>{
 const {mergeSettingsDraft}=await import('../src/settings-draft.mjs');
 const before=validateSettings({repos:['one/a','one/b']});
 const draft={...before,opacity:65,repos:[...before.repos,'one/c'],visibleRepos:[...before.visibleRepos,'one/c']};
 const after=validateSettings(setProjectVisibility(before,'one/b',true));
 const merged=mergeSettingsDraft(draft,before,after);
 assert.equal(merged.opacity,65);assert.deepEqual(merged.repos,draft.repos);assert.deepEqual(merged.visibleRepos,['one/a','one/b','one/c']);
 assert.deepEqual(mergeSettingsDraft(before,before,after),after);
});
