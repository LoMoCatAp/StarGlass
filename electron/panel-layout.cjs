const layouts=require('./panel-layout.json');
function panelSize(s) {
 const layout=layouts[s.mini?'mini':s.compact?'compact':'full'],step=(s.fontSize??14)-12;
 return s.customSize?{w:s.panelWidth,h:s.panelHeight}:{w:layout.w+step*layout.widthStep,h:layout.h+step*layout.heightStep};
}
function panelRadius(s) {
 const {w,h}=panelSize(s),shape=s.panelShape??'auto';
 if(shape==='rectangle')return 0;
 if(shape==='pill'||(shape==='auto'&&s.mini))return Math.min(w,h)/2;
 return Math.min(s.radius??28,w/2,h/2);
}
function compactLayout(s){return s.compact||(!s.mini&&panelSize(s).h<480+((s.fontSize??14)-12)*18);}
module.exports={panelSize,panelRadius,compactLayout};
