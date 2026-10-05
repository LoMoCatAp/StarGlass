// Fallback renderer already receives CPU pixels. Match the native palette and
// switching policy without reading another desktop frame or blocking WebGL.
export function luminance(rgb) {
  const c=rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return c[0]*.2126+c[1]*.7152+c[2]*.0722;
}
export function createAutoTextPolicy() {
  const inkDark=luminance([27/255,49/255,52/255]),inkLight=luminance([247/255,251/255,250/255]);
  let initialized=false,light=false,sd=0,sl=0,candidate=false,since=-1,lastSwitch=-1;
  const contrast=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  return {
    sample(colors,now) {
      if(!colors.length)return light;
      let d=0,l=0;
      for(const rgb of colors){const b=luminance(rgb);d+=Math.log(contrast(b,inkDark));l+=Math.log(contrast(b,inkLight));}
      d=Math.exp(d/colors.length);l=Math.exp(l/colors.length);
      if(!initialized){sd=d;sl=l;light=l>d;initialized=true;lastSwitch=now;return light;}
      sd+=.4*(d-sd);sl+=.4*(l-sl);
      const want=light?!(sd>sl*1.3):sl>sd*1.3;
      if(want===light)since=-1;
      else if(since<0||candidate!==want){candidate=want;since=now;}
      else if(now-since>=350&&now-lastSwitch>=650){light=want;lastSwitch=now;since=-1;}
      return light;
    }
  };
}
