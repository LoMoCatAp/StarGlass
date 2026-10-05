const keys=require('./panel-appearance.json');
function panelSettings(settings,repo=settings.repos[settings.activeRepo]||settings.repos[0]){
 const result={...settings,...settings.panelOverrides?.[repo?.toLowerCase()]};
 if(result.customSize)result.panelHeight=Math.max(result.mini?32:330+(result.fontSize-12)*14,result.panelHeight);
 return result;
}
function overridePanel(settings,repo,patch){
 const effective=panelSettings(settings,repo);
 const appearance=Object.fromEntries(keys.map(key=>[key,effective[key]]));
 for(const key of keys)if(Object.hasOwn(patch,key))appearance[key]=patch[key];
 return {...settings,panelOverrides:{...settings.panelOverrides,[repo.toLowerCase()]:appearance}};
}
module.exports={panelSettings,overridePanel};
