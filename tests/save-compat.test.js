global.window=global; global.self=global;
global.performance=global.performance||{now:()=>Date.now()};
global.document={createElement:(t)=>t==='canvas'?{width:0,height:0,getContext:()=>({fillRect(){},clearRect(){},getImageData:()=>({data:[]}),putImageData(){},createImageData:()=>({}),setTransform(){},drawImage(){},save(){},fillText(){},restore(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},translate(){},scale(){},rotate(){},arc(){},fill(){},measureText:()=>({width:10}),transform(){},rect(){},clip(){},createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}),style:{},addEventListener(){},toDataURL:()=>''}:{style:{},addEventListener(){},appendChild(){},setAttribute(){}},addEventListener(){},body:{appendChild(){},style:{}},getElementById:()=>null,querySelector:()=>null};
const _t=require('/home/user/fat-friend/libs/three.min.js'); global.THREE=global.THREE||window.THREE||_t;
require('/home/user/fat-friend/src/utils.js'); require('/home/user/fat-friend/src/config.js');
require('/home/user/fat-friend/src/physics.js'); require('/home/user/fat-friend/src/lifesystems.js'); require('/home/user/fat-friend/src/furry.js');
const FF=global.FF; const audio={squish(){},jiggle(){},slap(){},voice(){},step(){},bubble(){}};
// Сейв, записанный СТАРОЙ версией (никаких полей новой физики)
const oldSave={calories:75000,mood:0.8,hunger:0.3,relation:12,species:'wolf',build:'apple',
  name:'Старый',furColor:0x8a8f99,eyeColor:0x44aa66,stats:{fed:9,massages:2,bounces:1,foodsTried:{}},
  permanentMobility:false,pos:[-58,0,70]};
const f=new FF.FurryEngine(new THREE.Scene(),{species:'wolf',build:'apple',furColor:0x8a8f99,eyeColor:0x44aa66,name:'Старый'},audio);
f.deserialize(oldSave);
console.log('загрузка старого сейва: калории',f.calories,'| стадия',f.stage);
const dt=1/60; for(let i=0;i<180;i++) f.update(dt,12);
let nan=0; for(const n of f.nodes) if(!isFinite(n.offset.y)) nan++;
console.log('после 3 с симуляции: NaN зон =',nan);
console.log('слои инициализированы:', f.nodeById.mid_belly.layers.length===3?'✓':'✗');
console.log('heat/sweat поля живы:', (f.nodeById.inner_left_thigh.sweat>=0)?'✓':'✗');
const s2=f.serialize();
console.log('пересохранение работает:', s2.calories===75000?'✓':'✗');
// Новое поле digestion добавилось, но СТАРЫЕ ключи должны остаться на месте
const missing=Object.keys(oldSave).filter(k=>!(k in s2));
console.log('старые ключи сейва на месте:', missing.length?('⚠ потеряны: '+missing):'✓ (обратно совместим)');
console.log('желудок из старого сейва пуст, без падения:', f.digestion.stomach===0?'✓':'✗');
// И проверим круг: сохранили -> загрузили
f.digestion.addFood(1234);
const s3=f.serialize();
const f2=new FF.FurryEngine(new THREE.Scene(),{species:'wolf',build:'apple',furColor:0x8a8f99,eyeColor:0x44aa66,name:'X'},audio);
f2.deserialize(s3);
console.log('желудок переживает сохранение:', Math.abs(f2.digestion.stomach-1234)<1?'✓':'✗ ('+f2.digestion.stomach+')');
