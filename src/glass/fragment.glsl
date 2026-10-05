// Optical edge model adapted from iyinchao/liquid-glass-studio (MIT).
// Copyright (c) 2024 Charles Yin. See THIRD_PARTY_NOTICES.md.
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_size;
uniform vec2 u_source;
uniform float u_margin;
uniform float u_scale;
uniform float u_refraction;
uniform float u_dispersion;
uniform float u_gloss;
uniform float u_blur;
uniform float u_opacity;
uniform vec3 u_tint;
uniform vec2 u_pointer;
uniform float u_bgra;
uniform float u_pure;
uniform float u_radius;
float sdf(vec2 p) {
  float r=u_radius*u_scale;
  vec2 q=abs(p-u_size*.5)-(u_size*.5-vec2(r+1.0));
  return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r;
}
vec3 sampleBlur(vec2 uv,float radius) {
  if(radius<.5){vec3 sharp=texture2D(u_texture,uv).rgb;return mix(sharp,sharp.bgr,u_bgra);}
  vec2 d=vec2(radius)/u_source;
  vec3 c=texture2D(u_texture,uv).rgb*.28;
  c+=texture2D(u_texture,uv+vec2(d.x,0.0)).rgb*.12;
  c+=texture2D(u_texture,uv-vec2(d.x,0.0)).rgb*.12;
  c+=texture2D(u_texture,uv+vec2(0.0,d.y)).rgb*.12;
  c+=texture2D(u_texture,uv-vec2(0.0,d.y)).rgb*.12;
  c+=texture2D(u_texture,uv+d*.707).rgb*.06;
  c+=texture2D(u_texture,uv-d*.707).rgb*.06;
  c+=texture2D(u_texture,uv+vec2(d.x,-d.y)*.707).rgb*.06;
  c+=texture2D(u_texture,uv+vec2(-d.x,d.y)*.707).rgb*.06;
  return mix(c,c.bgr,u_bgra);
}
void main() {
  // v_uv and uploaded image both use a top-left origin.
  vec2 p=v_uv*u_size;
  float dist=sdf(p);
  float mask=1.0-smoothstep(-1.0,1.0,dist);
  if(mask<.001){gl_FragColor=vec4(0.0);return;}
  float depth=max(0.0,-dist);
  float thickness=(7.0+u_refraction*.1)*u_scale;
  float ratio=clamp(1.0-depth/thickness,0.0,1.0);
  float thetaI=asin(clamp(ratio*ratio,0.0,.999));
  float thetaT=asin(sin(thetaI)/1.45);
  float edgeFactor=-tan(thetaT-thetaI);
  vec2 gradient=vec2(sdf(p+vec2(1,0))-sdf(p-vec2(1,0)),sdf(p+vec2(0,1))-sdf(p-vec2(0,1)));
  vec2 normal=gradient/max(length(gradient),.0001);
  vec2 extent=u_source-vec2(2.0*u_margin);
  vec2 uv=(v_uv*extent+vec2(u_margin))/u_source;
  float textureScale=extent.x/(u_size.x/u_scale);
  vec2 offset=-normal*min(min(edgeFactor,2.0)*u_refraction*.13,u_margin*.85)*textureScale/u_source;
  float blur=u_blur*mix(.22,.09,u_pure)*textureScale*(1.0-ratio*.85);
  vec3 c=sampleBlur(uv+offset,blur);
  if(ratio>0.0 && u_dispersion>0.0){
    c.r=sampleBlur(uv+offset*(1.0+u_dispersion*.0015),blur).r;
    c.b=sampleBlur(uv+offset*(1.0-u_dispersion*.0015),blur).b;
  }
  // A mild tint keeps text legible while preserving the desktop texture.
  c=mix(c,mix(u_tint,vec3(.98),u_pure),u_opacity*mix(.64,.33,u_pure));
  float fresnel=pow(ratio,7.0)*u_gloss*.17;
  vec2 light=normalize(vec2(-.7,-.8)+(u_pointer-.5)*.6);
  float glare=pow(max(dot(normal,light),0.0),5.0)*exp(-depth/(1.1*u_scale))*u_gloss*.65;
  float opposite=pow(max(dot(normal,-light),0.0),7.0)*exp(-depth/(.8*u_scale))*u_gloss*.25;
  c=mix(c,vec3(1.0),clamp(fresnel+glare+opposite,0.0,.9));
  gl_FragColor=vec4(c*mask,mask);
}
