global.window=global; global.self=global;
global.performance=global.performance||{now:()=>Number(process.hrtime.bigint()/1000n)/1000};
global.document={createElement:(t)=>t==='canvas'?{width:0,height:0,getContext:()=>({fillRect(){},clearRect(){},getImageData:()=>({data:[]}),putImageData(){},createImageData:()=>({}),setTransform(){},drawImage(){},save(){},fillText(){},restore(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},translate(){},scale(){},rotate(){},arc(){},fill(){},measureText:()=>({width:10}),transform(){},rect(){},clip(){},createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}),style:{},addEventListener(){},toDataURL:()=>''}:{style:{},addEventListener(){},appendChild(){},setAttribute(){}},addEventListener(){},body:{appendChild(){},style:{}},getElementById:()=>null,querySelector:()=>null};
const _t=require('/home/user/fat-friend/libs/three.min.js'); global.THREE=global.THREE||window.THREE||_t;
require('/home/user/fat-friend/src/utils.js'); require('/home/user/fat-friend/src/config.js');
require('/home/user/fat-friend/src/physics.js'); require('/home/user/fat-friend/src/furry.js');
const FF=global.FF; const audio={squish(){},jiggle(){},slap(){},voice(){},step(){},bubble(){}};
const f=new FF.FurryEngine(new THREE.Scene(),{species:'fox',build:'pear',furColor:1,eyeColor:1,name:'T'},audio);
f.calories=200000; f._updateGrowthTargets(true);
const dt=1/60;
for(let i=0;i<120;i++) f.update(dt,12);   // прогрев JIT
const N=600;
let t0=process.hrtime.bigint();
for(let i=0;i<N;i++) f.update(dt,12);
let ms=Number(process.hrtime.bigint()-t0)/1e6/N;
console.log('вблизи (полная физика): '+ms.toFixed(3)+' мс/кадр');
f._far=true;
t0=process.hrtime.bigint();
for(let i=0;i<N;i++) f.update(dt,12);
ms=Number(process.hrtime.bigint()-t0)/1e6/N;
console.log('вдали (LOD):            '+ms.toFixed(3)+' мс/кадр');
// с волнами
f._far=false;
t0=process.hrtime.bigint();
for(let i=0;i<N;i++){ if(i%30===0) f.wave(f.root.localToWorld(new THREE.Vector3(0,1.05,0.3)),1.5); f.update(dt,12); }
ms=Number(process.hrtime.bigint()-t0)/1e6/N;
console.log('с волнами:              '+ms.toFixed(3)+' мс/кадр');
console.log('\nбюджет кадра 60fps = 16.7 мс');
