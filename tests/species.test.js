global.window=global; global.self=global;
global.performance=global.performance||{now:()=>Date.now()};
global.document={createElement:(t)=>t==='canvas'?{width:0,height:0,getContext:()=>({fillRect(){},clearRect(){},getImageData:()=>({data:[]}),putImageData(){},createImageData:()=>({}),setTransform(){},drawImage(){},save(){},fillText(){},restore(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},translate(){},scale(){},rotate(){},arc(){},fill(){},measureText:()=>({width:10}),transform(){},rect(){},clip(){},createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}),style:{},addEventListener(){},toDataURL:()=>''}:{style:{},addEventListener(){},appendChild(){},setAttribute(){}},addEventListener(){},body:{appendChild(){},style:{}},getElementById:()=>null,querySelector:()=>null};
const _t=require('/home/user/fat-friend/libs/three.min.js'); global.THREE=global.THREE||window.THREE||_t;
require('/home/user/fat-friend/src/utils.js'); require('/home/user/fat-friend/src/config.js');
require('/home/user/fat-friend/src/physics.js'); require('/home/user/fat-friend/src/furry.js');
const FF=global.FF; const audio={squish(){},jiggle(){},slap(){},voice(){},step(){},bubble(){}};
const dt=1/60; let bad=0;
for(const sp of Object.keys(FF.SPECIES)){
  for(const b of Object.keys(FF.BUILDS)){
    let err=null;
    try{
      const f=new FF.FurryEngine(new THREE.Scene(),{species:sp,build:b,furColor:0xffffff,eyeColor:0x44aa66,name:'T'},audio);
      f.calories=180000; f._updateGrowthTargets(true);
      for(let i=0;i<45;i++) f.update(dt,12);
      f.wave(f.root.localToWorld(new THREE.Vector3(0,1.05,0.3)),2);
      for(let i=0;i<45;i++) f.update(dt,12);
      const arr=f.mesh.geometry.attributes.position.array;
      for(let i=0;i<arr.length;i++) if(!isFinite(arr[i])){err='NaN в вершинах';break;}
      for(const n of f.nodes) if(!isFinite(n.offset.y)) {err='NaN в зоне '+n.zone.id;break;}
    }catch(e){ err=e.message; }
    if(err){ bad++; console.log('  ✗',sp,'/',b,'->',err); }
  }
}
const total=Object.keys(FF.SPECIES).length*Object.keys(FF.BUILDS).length;
console.log((total-bad)+'/'+total+' комбинаций вид×телосложение работают без ошибок');
