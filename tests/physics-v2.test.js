global.window=global; global.self=global;
global.performance = global.performance || { now: () => Date.now() };
global.document={createElement:(t)=>t==='canvas'?{width:0,height:0,getContext:()=>({fillRect(){},clearRect(){},getImageData:()=>({data:[]}),putImageData(){},createImageData:()=>({}),setTransform(){},drawImage(){},save(){},fillText(){},restore(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},translate(){},scale(){},rotate(){},arc(){},fill(){},measureText:()=>({width:10}),transform(){},rect(){},clip(){},createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})}),style:{},addEventListener(){},toDataURL:()=>''}:{style:{},addEventListener(){},appendChild(){},setAttribute(){}},addEventListener(){},body:{appendChild(){},style:{}},getElementById:()=>null,querySelector:()=>null};
const _t=require('/home/user/fat-friend/libs/three.min.js'); global.THREE=global.THREE||window.THREE||_t;
require('/home/user/fat-friend/src/utils.js'); require('/home/user/fat-friend/src/config.js');
require('/home/user/fat-friend/src/physics.js'); require('/home/user/fat-friend/src/furry.js');
const FF=global.FF;
const audio={squish(){},jiggle(){},slap(){},voice(){},step(){},bubble(){}};
const f=new FF.FurryEngine(new THREE.Scene(),{species:'fox',build:'pear',furColor:0xe0762c,eyeColor:0x44aa66,name:'Тест'},audio);
f.calories=120000; f._updateGrowthTargets(true);
const dt=1/60, sim=(n)=>{for(let i=0;i<n;i++) f.update(dt,12);};
sim(60);
let pass=0,fail=0; const t=(n,c,extra)=>{c?(pass++,console.log('  ✓',n,extra||'')):(fail++,console.log('  ✗',n,extra||''));};

console.log('=== 1. ГРАВИТАЦИЯ АНИЗОТРОПНА (свисание по профилю) ===');
const apron=f.nodeById.apron_fold, nape=f.nodeById.nape, shelf=f.nodeById.back_shelf;
sim(180);
t('apron_fold провисает вниз', apron.offset.y<-0.001, 'y='+apron.offset.y.toFixed(4));
/* Мгновенный replace смещения ловит случайную фазу микро-дрожи (её старт
 * рандомен), поэтому усредняем за секунду — так меряем именно провисание
 * под гравитацией, а не точку синусоиды. */
const avgY = (nd) => { let a = 0; for (let i = 0; i < 60; i++) { f.update(dt, 12); a += nd.offset.y; } return a / 60; };
const napeAvg = avgY(nape), shelfAvg = avgY(shelf);
t('загривок НЕ провисает вниз (sag=0)', napeAvg > -0.01, 'сред. y=' + napeAvg.toFixed(4));
t('полка над попой НЕ провисает вниз', shelfAvg > -0.01, 'сред. y=' + shelfAvg.toFixed(4));
/* Сравниваем ПРОВИСАНИЕ (движение вниз), а не модуль смещения.
 * Загривок не провисает вовсе — он слегка ходит ВВЕРХ от дыхания
 * (+0.054), и |apron| > |nape|*3 требовал от него тонуть, чего по
 * профилю sag=0 быть не должно. Правильная проверка: живот заметно
 * уходит вниз, а загривок — нет. */
const apronAvg = avgY(apron);
t('живот свисает сильнее загривка',
  apronAvg < -0.01 && apronAvg < napeAvg - 0.03,
  'живот ' + apronAvg.toFixed(4) + ' против загривка ' + napeAvg.toFixed(4));

console.log('=== 2. МНОГОСЛОЙНЫЙ ЖИР: слои рассинхронены ===');
const mb=f.nodeById.mid_belly;
mb.impulse(new THREE.Vector3(0,-1,0), 40);
let maxSpread=0;
for(let i=0;i<40;i++){ f.update(dt,12);
  const d=Math.abs(mb.layers[0].pos.y - mb.layers[2].pos.y); if(d>maxSpread) maxSpread=d; }
t('глубокий и поверхностный слой расходятся', maxSpread>0.001, 'разброс='+maxSpread.toFixed(4)+' м');

console.log('=== 3. ОСТАТОЧНАЯ ДРОЖЬ (momentum trail) ===');
f._far=true;
for(let i=0;i<400;i++) f.update(dt,12);      // полное оседание
const rest3=mb.offset.y;
mb.impulse(new THREE.Vector3(0,-1,0), 60);
const amps=[]; for(let i=0;i<420;i++){ f.update(dt,12); amps.push(Math.abs(mb.offset.y-rest3)); }
const peak3=Math.max(...amps);
const settleIdx=amps.findIndex((a,i)=>i>5 && a<peak3*0.05);
f._far=false;
t('удар раскачивает живот', peak3>0.02, 'пик='+peak3.toFixed(3)+' м');
t('дрожь гаснет за 0.3-4 с', settleIdx>18 && settleIdx<240, (settleIdx/60).toFixed(2)+' с');

console.log('=== 4. ВОЛНА РЕАЛЬНО БЕЖИТ ПО ТЕЛУ ===');
// Микро-дрожь отключаем: иначе она маскирует фронт волны
f._far = true;
// Полный сброс: иначе остаточные вмятины от самоколлизии зон дают
// ненулевое смещение ещё до прихода волны, и замер «первого кадра» врёт.
for(const n of f.nodes){
  n.layers.forEach(l=>{l.pos.set(0,0,0);l.vel.set(0,0,0);});
  n.offset.set(0,0,0); n.dent.set(0,0,0); n.dentVel.set(0,0,0); n.vel.set(0,0,0);
}
f._waveQueue.length=0;
f.physics.selfCollisionEnabled = false;   // не мешаем замеру фронта
const belly=f.nodeById.mid_belly, chin=f.nodeById.chin3;
const p=f.root.localToWorld(new THREE.Vector3(0,1.05,0.3));
f.wave(p, 2.0);
/* Замеряем ПРИРОСТ смещения относительно фона: дыхание и микро-жизнь дают
 * зонам ненулевой offset ещё до прихода волны, и абсолютный порог срабатывал
 * бы мгновенно, ничего не измеряя. */
const bellyBase = belly.offset.y, chinBase = chin.offset.y;
let tBelly=-1,tChin=-1;
for(let i=0;i<120;i++){ f.update(dt,12);
  if(tBelly<0 && Math.abs(belly.offset.y - bellyBase)>0.004) tBelly=i;
  if(tChin<0 && Math.abs(chin.offset.y - chinBase)>0.004) tChin=i; }
t('живот реагирует первым', tBelly>=0, 'кадр '+tBelly);
t('подбородок реагирует ПОЗЖЕ живота', tChin>tBelly, 'кадр '+tChin);
t('задержка заметна (>2 кадров)', (tChin-tBelly)>2, 'разница '+(tChin-tBelly)+' кадров');
f.physics.selfCollisionEnabled = true;
f._far = false;

console.log('=== 5. МИКРО-ЖИЗНЬ В ПОКОЕ ===');
sim(120);
const before=belly.offset.y; sim(14); const after=belly.offset.y;
t('тело не замирает полностью', Math.abs(after-before)>1e-6, 'дельта='+Math.abs(after-before).toExponential(2));

console.log('=== 6. ТЕРМОДИНАМИКА И ПОТ ===');
const inner=f.nodeById.inner_left_thigh;
inner.contactPress=1; inner.growth=1;
for(let i=0;i<120;i++){ inner.contactPress=1; f.update(dt,12); }
t('трущаяся зона нагревается', inner.heat>0.05, 'heat='+inner.heat.toFixed(3));
t('при нагреве выступает пот', inner.sweat>0.001, 'sweat='+inner.sweat.toFixed(4));
const brow=f.nodeById.brow_ridges;
t('нетрущаяся зона холодная', brow.heat<0.02, 'heat='+brow.heat.toFixed(4));

console.log('=== 7. АТРИБУТЫ ШЕЙДЕРА ===');
const g=f.mesh.geometry;
t('attribute heat есть', !!g.attributes.heat);
t('attribute sweat есть', !!g.attributes.sweat);
t('attribute cellulite есть', !!g.attributes.cellulite);
let cellMax=0; for(const v of g.attributes.cellulite.array) if(v>cellMax) cellMax=v;
t('целлюлит проступает на мягких зонах', cellMax>0.01, 'max='+cellMax.toFixed(3));

console.log('=== 8. НЕТ NaN / ВЗРЫВА ФИЗИКИ ===');
let nan=0,big=0;
for(const n of f.nodes){ const o=n.offset;
  if(!isFinite(o.x)||!isFinite(o.y)||!isFinite(o.z)) nan++;
  if(o.length()>2) big++; }
t('нет NaN в смещениях', nan===0);
t('нет разлёта зон', big===0);
const posArr=f.mesh.geometry.attributes.position.array;
let vnan=0; for(let i=0;i<posArr.length;i++) if(!isFinite(posArr[i])) vnan++;
t('нет NaN в вершинах меша', vnan===0);
console.log('\nИТОГО: '+pass+' пройдено, '+fail+' провалено');

console.log('=== 9. ЭМОЦИОНАЛЬНАЯ ФИЗИКА ===');
// Чистое состояние: предыдущие тесты грели зоны и двигали слои
f._far=true; f.setEmotion('neutral',0.01);
for(const n of f.nodes){ n.layers.forEach(l=>{l.pos.set(0,0,0);l.vel.set(0,0,0);});
  n.offset.set(0,0,0); n.heat=0; n.sweat=0; n.contactPress=0; }
f._waveQueue.length=0;
for(let i=0;i<300;i++) f.update(dt,12);          // дать телу осесть
const mb9=f.nodeById.mid_belly; const calm=[];
for(let i=0;i<120;i++){ f.update(dt,12); calm.push(mb9.offset.y); }
const calmRange=Math.max(...calm)-Math.min(...calm);
f.setEmotion('giggle', 99);
const laugh=[]; for(let i=0;i<120;i++){ f.update(dt,12); laugh.push(mb9.offset.y); }
const laughRange=Math.max(...laugh)-Math.min(...laugh);
t('смех трясёт живот заметно сильнее покоя', laughRange>calmRange*2,
  'покой='+calmRange.toFixed(4)+' смех='+laughRange.toFixed(4)+' (x'+(laughRange/calmRange).toFixed(1)+')');
f.setEmotion('neutral',0.1); f._far=false;

console.log('\nФИНАЛ: '+pass+' пройдено, '+fail+' провалено');
