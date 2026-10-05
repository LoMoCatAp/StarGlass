const {test}=require('node:test');const assert=require('node:assert/strict');
const {FrameReader,roundWindowShape}=require('../electron/frame-reader.cjs');
const {validateSettings}=require('../electron/core.cjs');
test('raw frames survive arbitrary pipe fragmentation and consecutive messages',()=>{
 const got=[],errors=[],reader=new FrameReader(p=>got.push([...p]),e=>errors.push(e));
 const packet=Buffer.from([4,0,0,0,8,9,10,11,0,0,0,0,2,0,0,0,22,23]);
 for(let i=0;i<packet.length;i+=3)reader.push(packet.subarray(i,i+3));
 assert.deepEqual(got,[[8,9,10,11],[22,23]]);assert.equal(errors.length,1);
});
test('malformed lengths are rejected before allocation',()=>{
 let rejected=false;new FrameReader(()=>assert.fail(),()=>rejected=true).push(Buffer.from([255,255,255,255]));assert.equal(rejected,true);
});
test('native window region excludes corners and covers center symmetrically',()=>{
 const rectangles=roundWindowShape(440,610,28);const includes=(x,y)=>rectangles.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
 for(const [x,y] of [[0,0],[439,0],[0,609],[439,609]])assert.equal(includes(x,y),false);
 for(const [x,y] of [[220,0],[0,305],[439,305],[220,609]])assert.equal(includes(x,y),true);
 for(let y=0;y<610;y++)assert.equal(includes(10,y),includes(429,609-y));
});
test('pure glass and typography settings are validated and kept',()=>{
 const s=validateSettings({material:'pure',glassOnly:true,fontSize:99,fontWeight:50,radius:100,glassFps:1000});
 assert.equal(s.material,'liquid');assert.equal(s.glassOnly,true);assert.equal(s.fontSize,18);assert.equal(s.fontWeight,400);assert.equal(s.radius,100);assert.equal(s.glassFps,360);
});

test('high refresh and optional text outlines survive settings validation',()=>{
 for (const fps of [0,60,120,144,165,240,360]) assert.equal(validateSettings({glassFps:fps}).glassFps,fps);
 const s=validateSettings({textOutline:999,textOutlineWidth:9});
 assert.equal(s.textOutline,100);assert.equal(s.textOutlineWidth,3);
 assert.equal(validateSettings({textOutline:0}).textOutline,0);
});

test('one glass effect migrates old materials and preserves independent header visibility',()=>{
 for (const material of ['pure','liquid','acrylic','clear']) assert.equal(validateSettings({material}).material,'liquid');
 const s=validateSettings({radius:0,showLogo:false,showBrandText:false});
 assert.equal(s.radius,0);assert.equal(s.showLogo,false);assert.equal(s.showBrandText,false);
 assert.equal(validateSettings({}).showLogo,true);
});
