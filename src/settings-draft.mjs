// Preserve pending appearance edits when an immediate display toggle is saved.
export function mergeSettingsDraft(draft,previous,next){
 if(JSON.stringify(draft)===JSON.stringify(previous))return next;
 const changed=Object.fromEntries(Object.entries(next).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(previous[key])));
 if(Object.hasOwn(changed,'visibleRepos')){
  const added=(draft.visibleRepos||[]).filter(repo=>!previous.repos.includes(repo));
  changed.visibleRepos=draft.repos.filter(repo=>next.visibleRepos.includes(repo)||added.includes(repo));
 }
 return {...draft,...changed};
}
