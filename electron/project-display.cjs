// Display selection is independent of monitoring and per-project appearance.
function visibleRepos(settings){
 const repos=settings.repos||[];
 if(Array.isArray(settings.visibleRepos)){
  const selected=new Set(settings.visibleRepos.filter(r=>typeof r==='string').map(r=>r.toLowerCase()));
  return repos.filter(r=>selected.has(r.toLowerCase()));
 }
 const active=repos[settings.activeRepo]||repos[0];
 return settings.multiMini?[...repos]:active?[active]:[];
}
function projectVisible(settings,repo){return visibleRepos(settings).includes(repo);}
function setProjectVisibility(settings,repo,visible){
 const known=settings.repos.find(r=>r.toLowerCase()===String(repo).toLowerCase());
 if(!known)throw new Error('项目不在监控列表中');
 const selected=new Set(visibleRepos(settings));visible?selected.add(known):selected.delete(known);
 const list=settings.repos.filter(r=>selected.has(r));
 const current=settings.repos[settings.activeRepo]||settings.repos[0];
 const activeRepo=list.length&&!list.includes(current)?settings.repos.indexOf(list[0]):settings.activeRepo;
 return {...settings,activeRepo,visibleRepos:list,multiMini:list.length>1};
}
function selectProject(settings,index){
 if(!Number.isInteger(index)||index<0||index>=settings.repos.length)return settings;
 const current=visibleRepos(settings),repo=settings.repos[index];
 const list=current.length<=1?[repo]:settings.repos.filter(r=>current.includes(r)||r===repo);
 return {...settings,activeRepo:index,visibleRepos:list,multiMini:list.length>1};
}
module.exports={visibleRepos,projectVisible,setProjectVisibility,selectProject};
