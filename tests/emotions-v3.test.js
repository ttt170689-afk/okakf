/**
 * emotions-v3.test.js — эмоции, близость, привычки, физика массы, стадия 100.
 */
global.window = global; global.self = global;
global.performance = global.performance || { now: () => Date.now() };
// Полная заглушка canvas: World рисует вывески через 2D-контекст
function stubCtx() {
  return new Proxy({}, { get: (t, k) => {
    if (k === 'canvas') return { width: 512, height: 128 };
    if (k === 'createRadialGradient' || k === 'createLinearGradient')
      return () => ({ addColorStop() {} });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (k === 'measureText') return () => ({ width: 10 });
    return () => {};
  } });
}
global.document = { createElement: () => ({ style:{}, addEventListener(){}, appendChild(){},
  setAttribute(){}, width:512, height:128,
  getContext: () => stubCtx(), toDataURL: () => 'data:,' }),
  addEventListener(){}, body:{ appendChild(){}, style:{} },
  getElementById: () => null, querySelector: () => null };

const _t = require('../libs/three.min.js');
global.THREE = global.THREE || window.THREE || _t;
for (const m of ['utils', 'config', 'physics', 'lifesystems', 'emotions', 'massphysics',
                 'furry', 'world', 'hands', 'player', 'playerbody']) require('../src/' + m + '.js');

const FF = global.FF;
let pass = 0, fail = 0;
const t = (n, c, extra) => { c ? (pass++, console.log('  ✓', n, extra || ''))
                               : (fail++, console.log('  ✗', n, extra || '')); };
const audio = { squish(){}, jiggle(){}, slap(){}, voice(){}, step(){}, bubble(){},
                noise(){}, setAmbience(){}, ui(){}, growth(){} };

function makeFurry(cal) {
  const f = new FF.FurryEngine(new THREE.Scene(),
    { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'T' }, audio);
  if (cal) { f.calories = cal; f._updateGrowthTargets(true); }
  return f;
}
const dt = 1 / 60;

console.log('=== 1. ДВЕНАДЦАТЬ ЭМОЦИЙ ===');
{
  const f = makeFurry(0);
  const em = f.emotions;
  t('движок эмоций создан', !!em);
  t('ровно 12 эмоций', Object.keys(em.e).length === 12, Object.keys(em.e).length + '');
  const before = em.e.happiness;
  em.onAction('feed', 1);
  t('кормление радует', em.e.happiness > before, before.toFixed(0) + ' -> ' + em.e.happiness.toFixed(0));
  t('кормление утоляет голод', em.e.hunger < 40);
  t('кормление даёт благодарность', em.e.gratitude > 30);
  const anx = em.e.anxiety;
  em.e.anxiety = 60; em.onAction('hug', 1);
  t('объятия снимают тревогу', em.e.anxiety < 60, '60 -> ' + em.e.anxiety.toFixed(0));
  t('объятия растят любовь', em.e.love > 30);
  // Границы 0..100
  for (let i = 0; i < 60; i++) em.onAction('gift', 3);
  let inRange = true;
  for (const k in em.e) if (em.e[k] < 0 || em.e[k] > 100) inRange = false;
  t('значения не выходят за 0..100', inRange);
}

console.log('=== 2. ЭМОЦИИ ВЕДУТ ТЕЛО ===');
{
  const f = makeFurry(60000);
  const em = f.emotions;
  em.e.shyness = 95; em.e.love = 80;
  for (let i = 0; i < 30; i++) f.update(dt, 12);
  t('стеснение вызывает румянец', f.blush > 0.2, 'blush=' + f.blush.toFixed(2));
  em.e.sleepiness = 95;
  for (let i = 0; i < 30; i++) f.update(dt, 12);
  t('сонливость прикрывает глаза', f.eyeOpen < 0.85, 'eyeOpen=' + f.eyeOpen.toFixed(2));
  em.e.excitement = 95; em.e.comfort = 10;
  for (let i = 0; i < 30; i++) f.update(dt, 12);
  t('возбуждение поднимает пульс', f.heartBPM > 90, 'BPM=' + f.heartBPM.toFixed(0));
  // mood/hunger синхронны с эмоциями
  em.e.happiness = 90; em.e.comfort = 90; em.e.love = 90; em.e.hunger = 10;
  for (let i = 0; i < 30; i++) f.update(dt, 12);
  t('mood синхронен с эмоциями', f.mood > 0.7, 'mood=' + f.mood.toFixed(2));
  t('hunger синхронен с эмоциями', f.hunger < 0.35, 'hunger=' + f.hunger.toFixed(2));
}

console.log('=== 3. ДИНАМИЧЕСКИЙ ГОЛОС ===');
{
  const scene = new THREE.Scene();
  const world = new FF.World(scene, { shadowMap:{}, capabilities:{} }, audio);
  const mk = (cal) => {
    const f = makeFurry(cal);
    const cam = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
    const p = new FF.PlayerController(cam, world, f, audio);
    const g = { scene, furry: f, player: p, camera: cam, audio, notify(){}, achieve(){}, objects:{items:[]} };
    const q = new FF.QuirkSystem(g);
    f.quirks = q;
    for (let i = 0; i < 10; i++) q.update(dt);
    return f.voicePitch;
  };
  const thin = mk(0), huge = mk(800000);
  t('голос глубже у крупного друга', huge < thin, thin.toFixed(2) + ' -> ' + huge.toFixed(2));
  t('питч не уходит в инфразвук', huge > 0.4, huge.toFixed(2));
}

console.log('=== 4. ПАМЯТЬ ТЕЛА ===');
{
  const f = makeFurry(60000);
  const g = { scene: new THREE.Scene(), furry: f, audio, notify(){}, achieve(){},
    player: { pos: new THREE.Vector3(9, 0, 9), mode:'walk', keys:{}, handsSystem:null },
    camera: new THREE.PerspectiveCamera(), objects:{items:[]} };
  const q = new FF.QuirkSystem(g); f.quirks = q;
  t('незнакомая зона не помнится', q.familiarity('left_flank') === 0);
  for (let i = 0; i < 20; i++) q.remember('left_flank');
  t('частые касания запоминаются', q.familiarity('left_flank') > 0.4,
    'familiarity=' + q.familiarity('left_flank').toFixed(2));
  t('память попадает в узел зоны', f.nodeById.left_flank.familiarity > 0.4);
  t('другая зона осталась незнакомой', q.familiarity('right_flank') === 0);
}

console.log('=== 5. РЕАКЦИЯ НА ГРОМКИЙ ЗВУК ===');
{
  const f = makeFurry(120000);
  const g = { scene: new THREE.Scene(), furry: f, audio, notify(){}, achieve(){},
    player: { pos: new THREE.Vector3(9, 0, 9), mode:'walk', keys:{}, handsSystem:null },
    camera: new THREE.PerspectiveCamera(), objects:{items:[]} };
  const q = new FF.QuirkSystem(g); f.quirks = q;
  for (let i = 0; i < 60; i++) f.update(dt, 12);
  const belly = f.nodeById.mid_belly;
  const calm = Math.abs(belly.offset.y);
  const anxBefore = f.emotions.e.anxiety;
  q.onLoudSound(1);
  let peak = 0;
  for (let i = 0; i < 40; i++) { f.update(dt, 12); peak = Math.max(peak, Math.abs(belly.offset.y)); }
  t('живот отвечает желейным всплеском', peak > calm * 1.4,
    calm.toFixed(3) + ' -> ' + peak.toFixed(3));
  t('громкий звук пугает', f.emotions.e.anxiety > anxBefore,
    anxBefore.toFixed(0) + ' -> ' + f.emotions.e.anxiety.toFixed(0));
  t('появляются мурашки', q.goosebumps > 0.1, 'goose=' + q.goosebumps.toFixed(2));
}

console.log('=== 6. ФИЗИКА МАССЫ ===');
{
  const scene = new THREE.Scene();
  const world = new FF.World(scene, { shadowMap:{}, capabilities:{} }, audio);
  const f = makeFurry(400000);
  const cam = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
  const p = new FF.PlayerController(cam, world, f, audio);
  const g = { scene, furry: f, player: p, camera: cam, audio, world,
    notify(){}, achieve(){}, objects: { items: [] } };
  const mp = new FF.MassPhysics(g);
  t('система создана', !!mp);
  t('тяжесть растёт с массой', mp.heaviness > 0.5, 'heaviness=' + mp.heaviness.toFixed(2));
  for (let i = 0; i < 60; i++) mp.update(dt);
  t('пол прогибается под весом', mp.floorDent > 0.05, 'dent=' + mp.floorDent.toFixed(3));
  mp.stomp(1);
  t('шаг трясёт камеру', mp.shake.lengthSq() > 1e-6, 'shake=' + mp.shake.length().toFixed(3));
  for (let i = 0; i < 90; i++) mp.update(dt);
  t('тряска затухает', mp.shake.length() < 0.005);
  // Лёгкий друг не должен сотрясать землю
  const f2 = makeFurry(0);
  const g2 = Object.assign({}, g, { furry: f2 });
  const mp2 = new FF.MassPhysics(g2);
  t('стройный друг не трясёт мир', mp2.heaviness < 0.15, 'heaviness=' + mp2.heaviness.toFixed(2));
}

console.log('=== 7. СТАДИЯ 100 (КОСМИЧЕСКАЯ ФОРМА) ===');
{
  const G = FF.CONFIG.growth;
  t('101 стадия задана', G.stageThresholds.length === 101 && G.stageNames.length === 101);
  t('пороги строго растут', G.stageThresholds.every((v, i, a) => i === 0 || v > a[i-1]));
  t('последняя стадия названа', /Сфера Бытия/.test(G.stageNames[100]), G.stageNames[100]);
  const f10 = makeFurry(G.stageThresholds[10]);
  const f100 = makeFurry(G.stageThresholds[100]);
  t('стадия читается верно', f100.stage === 100, 'stage=' + f100.stage);
  t('сферичность включается только поздно', f10.cosmic === 0 && f100.cosmic === 1,
    'st10=' + f10.cosmic + ' st100=' + f100.cosmic);
  // Форма реально становится сфероидом
  const bbox = (f) => {
    f.cosmicVisual = f.cosmic;
    for (let i = 0; i < 40; i++) f.update(dt, 12);
    const p = f.mesh.geometry.attributes.position.array;
    let mnx=9,mxx=-9,mny=9,mxy=-9,mnz=9,mxz=-9;
    for (let i = 0; i < p.length; i += 3) {
      mnx=Math.min(mnx,p[i]); mxx=Math.max(mxx,p[i]);
      mny=Math.min(mny,p[i+1]); mxy=Math.max(mxy,p[i+1]);
      mnz=Math.min(mnz,p[i+2]); mxz=Math.max(mxz,p[i+2]);
    }
    return { w: mxx-mnx, h: mxy-mny, d: mxz-mnz };
  };
  const b = bbox(f100);
  t('силуэт стал сфероидом', Math.abs(b.w-b.h)/b.w < 0.35 && Math.abs(b.w-b.d)/b.w < 0.35,
    b.w.toFixed(2)+'×'+b.h.toFixed(2)+'×'+b.d.toFixed(2));
  let nan = 0;
  const pa = f100.mesh.geometry.attributes.position.array;
  for (let i = 0; i < pa.length; i++) if (!isFinite(pa[i])) nan++;
  t('нет NaN в космической форме', nan === 0);
}

console.log('=== 8. СОХРАНЕНИЕ ===');
{
  const f = makeFurry(60000);
  f.quirks = new FF.QuirkSystem({ scene: new THREE.Scene(), furry: f, audio, notify(){},
    achieve(){}, player:{ pos:new THREE.Vector3(9,0,9), mode:'walk', keys:{}, handsSystem:null },
    camera: new THREE.PerspectiveCamera(), objects:{items:[]} });
  f.emotions.e.love = 88;
  for (let i = 0; i < 15; i++) f.quirks.remember('left_flank');
  const data = f.serialize();
  const f2 = makeFurry(60000);
  f2.quirks = new FF.QuirkSystem({ scene: new THREE.Scene(), furry: f2, audio, notify(){},
    achieve(){}, player:{ pos:new THREE.Vector3(9,0,9), mode:'walk', keys:{}, handsSystem:null },
    camera: new THREE.PerspectiveCamera(), objects:{items:[]} });
  f2.deserialize(data);
  t('эмоции переживают сохранение', Math.abs(f2.emotions.e.love - 88) < 1,
    'love=' + f2.emotions.e.love.toFixed(0));
  t('память тела переживает сохранение', f2.quirks.familiarity('left_flank') > 0.3);
  // Старый сейв без новых полей
  const f3 = makeFurry(0);
  let err = null;
  try { f3.deserialize({ calories: 5000, mood: 0.5, hunger: 0.3, relation: 2 }); }
  catch (e) { err = e.message; }
  t('старый сейв грузится без полей эмоций', !err, err || '');
}

console.log('\nИТОГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;

console.log('=== 9. ПОДОЙТИ ВПЛОТНУЮ (без невидимых стен) ===');
{
  const scene2 = new THREE.Scene();
  const world2 = new FF.World(scene2, { shadowMap:{}, capabilities:{} }, audio);
  const HX = -62, HZ = 94;   // чистый двор без построек

  /** Идём прямо на друга и смотрим, насколько глубоко удалось войти */
  const walkInto = (cal) => {
    const f = new FF.FurryEngine(scene2,
      { species:'dragon', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
    f.calories = cal; f._updateGrowthTargets(true);
    f.root.position.set(HX, 0, HZ);
    for (let i = 0; i < 30; i++) f.update(dt, 12);
    const cam = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
    const p = new FF.PlayerController(cam, world2, f, audio);
    p.pos.set(HX, world2.heightAt(HX, HZ + 8), HZ + 8);
    p.yaw = 0; p.keys.KeyW = true;
    let contact = 0, inside = 0;
    for (let i = 0; i < 500; i++) {
      p.update(dt); f.update(dt, 12);
      if (p.contact) contact++;
      if (p._isInsideBody()) inside++;
    }
    return { contact, inside, stage: f.stage };
  };

  /* Двухслойная модель: игрок обязан ДОЙТИ до плоти и мять её,
   * но не проваливаться внутрь туши. */
  for (const cal of [4500, 60000, 800000]) {
    const r = walkInto(cal, false);
    t('доходит до тела (стадия ' + r.stage + ')', r.contact > 100,
      'кадров контакта=' + r.contact);
    t('не проваливается внутрь (стадия ' + r.stage + ')', r.inside === 0,
      'кадров внутри=' + r.inside);
  }

  // Опора сверху обязана сохраниться
  const f2 = new FF.FurryEngine(scene2,
    { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
  f2.calories = 250000; f2._updateGrowthTargets(true);
  f2.root.position.set(HX, 0, HZ);
  for (let i = 0; i < 40; i++) f2.update(dt, 12);
  const cam2 = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
  const p2 = new FF.PlayerController(cam2, world2, f2, audio);
  p2.pos.set(HX, f2.topY() + 2.5, HZ + 0.4);
  for (let i = 0; i < 240; i++) { p2.update(dt); f2.update(dt, 12); }
  const ground = world2.heightAt(HX, HZ + 0.4);
  t('на животе всё ещё можно стоять', p2.pos.y > ground + 1,
    'y=' + p2.pos.y.toFixed(2) + ' земля=' + ground.toFixed(2));
  t('режим onbelly включается', p2.mode === 'onbelly', p2.mode);
}

console.log('\nВСЕГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
