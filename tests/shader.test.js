global.window=global; global.self=global;
global.performance=global.performance||{now:()=>Date.now()};
global.document={createElement:(t)=>t==='canvas'?{width:0,height:0,getContext:()=>({fillRect(){},clearRect(){},getImageData:()=>({data:[]}),putImageData(){},createImageData:()=>({}),setTransform(){},drawImage(){},save(){},fillText(){},restore(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},translate(){},scale(){},rotate(){},arc(){},fill(){},measureText:()=>({width:10}),transform(){},rect(){},clip(){},createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}),style:{},addEventListener(){},toDataURL:()=>''}:{style:{},addEventListener(){},appendChild(){},setAttribute(){}},addEventListener(){},body:{appendChild(){},style:{}},getElementById:()=>null,querySelector:()=>null};
const _t=require('/home/user/fat-friend/libs/three.min.js'); global.THREE=global.THREE||window.THREE||_t;
require('/home/user/fat-friend/src/utils.js'); require('/home/user/fat-friend/src/config.js');
require('/home/user/fat-friend/src/physics.js'); require('/home/user/fat-friend/src/furry.js');
const FF=global.FF; const audio={squish(){},jiggle(){},slap(){},voice(){},step(){},bubble(){}};
const f=new FF.FurryEngine(new THREE.Scene(),{species:'fox',build:'pear',furColor:1,eyeColor:1,name:'T'},audio);
const g=f.mesh.geometry, n=g.attributes.position.count;
let ok=true;
for(const a of ['position','normal','stretch','heat','sweat','cellulite','part']){
  const at=g.attributes[a];
  const good=at && at.count===n;
  if(!good) ok=false;
  console.log((good?'  ✓':'  ✗'), a, at?('count='+at.count+' itemSize='+at.itemSize):'ОТСУТСТВУЕТ');
}
console.log('все атрибуты выровнены по',n,'вершинам:',ok?'ДА':'НЕТ');
// Симулируем компиляцию: three вызывает onBeforeCompile
const mat=f.material;
const fake={ vertexShader:`#include <common>\nvoid main(){\n#include <begin_vertex>\n}`,
             fragmentShader:`#include <common>\nvoid main(){\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <emissivemap_fragment>\n}`,
             uniforms:{} };
mat.onBeforeCompile(fake);
const vs=fake.vertexShader, fs=fake.fragmentShader;
console.log('\n--- проверка GLSL ---');
const decl=(s,name)=>s.includes(name);
for(const a of ['heat','sweat','cellulite']){
  console.log('  attribute',a,'объявлен в VS:', decl(vs,'attribute float '+a+';')?'✓':'✗',
    '| varying передан:', decl(vs,'v'+a[0].toUpperCase()+a.slice(1)+' =')||decl(vs,'vCell =')||decl(vs,'vHeat =')||decl(vs,'vSweat =')?'✓':'✗');
}
for(const v of ['vHeat','vSweat','vCell']){
  console.log('  varying',v,'| VS:',decl(vs,'varying float '+v+';')?'✓':'✗','| FS:',decl(fs,'varying float '+v+';')?'✓':'✗');
}
// баланс скобок
const bal=(s)=>{let d=0;for(const c of s){if(c==='{')d++;if(c==='}')d--;if(d<0)return false;}return d===0;};
console.log('  баланс {} в VS:',bal(vs)?'✓':'✗','| в FS:',bal(fs)?'✓':'✗');
console.log('  uniforms проброшены:',Object.keys(fake.uniforms).length,'шт');
