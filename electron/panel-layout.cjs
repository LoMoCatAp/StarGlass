const layouts=require('./panel-layout.json');
function textSizes(s){const f=s.fontSize??14;return {name:s.nameFontSize||(s.mini?f:f*1.65),stars:s.starsFontSize||(s.mini?f*.92:f*2.65),downloads:s.downloadsFontSize||(s.mini?f*.92:f*2.65)};}
function minimumPanelHeight(s){
 const t=textSizes(s),f=s.fontSize??14;
 if(s.mini)return Math.max(32,Math.ceil(Math.max(s.showProjectName===false?0:t.name,s.showStars===false?0:t.stars,s.showDownloads===false?0:t.downloads)+16));
 return Math.min(1200,Math.max(240,330+(f-12)*14)+Math.max(0,t.name-f*1.65)+Math.max(0,Math.max(t.stars,t.downloads)-f*2.65));
}
function panelSize(s) {
 const layout=layouts[s.mini?'mini':s.compact?'compact':'full'],step=(s.fontSize??14)-12,t=textSizes(s),f=s.fontSize??14;
 const extra=s.mini?0:Math.max(0,t.name-f*1.65)+Math.max(0,Math.max(t.stars,t.downloads)-f*2.65);
 return s.customSize?{w:s.panelWidth,h:s.panelHeight}:{w:Math.min(1200,Math.max(260,layout.w+step*layout.widthStep)),h:Math.ceil(Math.min(1200,Math.max(minimumPanelHeight(s),layout.h+step*layout.heightStep+extra)))};
}
function panelRadius(s) {
 const {w,h}=panelSize(s),shape=s.panelShape??'auto';
 if(shape==='rectangle')return 0;
 if(shape==='pill'||(shape==='auto'&&s.mini))return Math.min(w,h)/2;
 return Math.min(s.radius??28,w/2,h/2);
}
function compactLayout(s){return s.compact||(!s.mini&&panelSize(s).h<480+((s.fontSize??14)-12)*18);}
module.exports={panelSize,panelRadius,compactLayout,minimumPanelHeight,textSizes};
