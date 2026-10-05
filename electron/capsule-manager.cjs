const {visibleRepos}=require('./project-display.cjs');
const {PanelBridge}=require('./panel-bridge.cjs');
const {panelState}=require('./panel-model.cjs');
const {panelSize}=require('./panel-layout.cjs');
const {panelSettings}=require('./panel-appearance.cjs');
class CapsuleManager {
 constructor(options){Object.assign(this,options);this.Bridge=options.Bridge??PanelBridge;this.panels=new Map();this.closed=new Set();}
 entries(){return [...this.panels].map(([repo,item])=>[`repo:${repo}`,item.bridge]);}
 reconcile(state,visible=true){
  const s=state.settings,active=s.repos[s.activeRepo]||s.repos[0];
  const selected=visibleRepos(s);
  for(const repo of this.closed)if(!selected.includes(repo))this.closed.delete(repo);
  const wanted=selected.filter(repo=>repo!==active).slice(0,11).filter(repo=>!this.closed.has(repo));
  for(const [repo,item] of this.panels)if(!wanted.includes(repo)){this.panels.delete(repo);item.bridge.stop();}
  for(const repo of wanted){
   const index=s.repos.indexOf(repo),local={...panelSettings(s,repo),activeRepo:index},size=panelSize(local);
   let item=this.panels.get(repo);
   if(!item){
    const position=this.positionFor(repo,index,size),dump=process.env.SG_DUMP_FRAME;
    const bridge=new this.Bridge({exePath:this.exePath,env:{SG_GPU_SHARED_NAME:this.sharedName,SG_GPU_SHARED_ROLE:'consumer',SG_START_HIDDEN:visible?'0':'1',SG_W:String(size.w),SG_H:String(size.h),SG_MINI:local.mini?'1':'0',SG_FONT_PX:String(local.fontSize),SG_TOPMOST:local.alwaysOnTop?'1':'0',SG_CLICKTHROUGH:local.clickThrough?'1':'0',SG_SHOW_FPS:'0',SG_X:String(position.x),SG_Y:String(position.y),...(dump?{SG_DUMP_FRAME:`${dump}.${repo.replace(/[^a-z0-9]/gi,'-')}`}:{})},
     onConnect:()=>{if(!item.visible)bridge.hide();this.onConnect?.();},
     onCommand:(name,args)=>this.onCommand(repo,name,args),
     onExit:()=>{if(this.panels.get(repo)?.bridge===bridge){this.panels.delete(repo);this.closed.add(repo);this.onExit?.(repo);}},
     log:line=>this.log(`[${repo}] ${line}`)});
    item={bridge,visible};this.panels.set(repo,item);bridge.start();
   }
   item.bridge.resize(size.w,size.h);item.bridge.font(local.fontSize,local.fontWeight>=600);
   item.bridge.push(panelState({...state,settings:local}));
   item.visible=visible&&!item.userHidden;if(item.bridge.connected)(item.visible?item.bridge.show():item.bridge.hide());
  }
 }
 push(state){for(const [repo,item] of this.panels){const index=state.settings.repos.indexOf(repo);if(index>=0)item.bridge.push(panelState({...state,settings:{...state.settings,activeRepo:index}}));}}
 setVisible(visible){for(const item of this.panels.values()){item.visible=visible;if(visible)item.userHidden=false;(visible?item.bridge.show():item.bridge.hide());}}
 resume(state){this.closed.clear();this.reconcile(state,true);this.setVisible(true);}
 restoreRepo(repo){this.closed.delete(repo);const item=this.panels.get(repo);if(item)item.userHidden=false;}
 hideRepo(repo){const item=this.panels.get(repo);if(item){item.visible=false;item.userHidden=true;item.bridge.hide();}}
 stop(){for(const item of this.panels.values())item.bridge.stop();this.panels.clear();this.closed.clear();}
}
module.exports={CapsuleManager};
