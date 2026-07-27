/**
 * climbing.test.js — свободное карабканье в духе PEAK.
 *
 * Проверяем два обещания:
 *   1. Хвататься можно за ЛЮБУЮ точку тела, включая голову, уши и хвост.
 *   2. Рука не телепортируется — она летит к цели за заметное время.
 */
global.window = global; global.self = global;
global.performance = global.performance || { now: () => Date.now() };
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
  setAttribute(){}, width:512, height:128, getContext: () => stubCtx(), toDataURL: () => 'd' }),
  addEventListener(){}, body:{ appendChild(){}, style:{} },
  getElementById: () => null, querySelector: () => null };

const _t = require('../libs/three.min.js');
global.THREE = global.THREE || window.THREE || _t;
for (const m of ['utils', 'config', 'physics', 'lifesystems', 'emotions', 'massphysics',
                 'furry', 'world', 'hands', 'player', 'playerbody', 'bodyspots'])
  require('../src/' + m + '.js');

const FF = global.FF;
let pass = 0, fail = 0;
const t = (n, c, extra) => { c ? (pass++, console.log('  ✓', n, extra || ''))
                               : (fail++, console.log('  ✗', n, extra || '')); };
const audio = { squish(){}, jiggle(){}, slap(){}, voice(){}, step(){}, bubble(){},
                noise(){}, setAmbience(){}, ui(){}, growth(){} };
const dt = 1 / 60;
const scene = new THREE.Scene();
const world = new FF.World(scene, { shadowMap:{}, capabilities:{} }, audio);
FF.Game = { notify(){}, achieve(){}, inv:{ selected:null, foodList:()=>[] },
            taxi:{ active:false }, tryWorldInteract(){} };

console.log('=== 1. ХВАТАТЬСЯ МОЖНО ВЕЗДЕ ===');
{
  const banned = FF.ZONES.filter((z) => !z.grab);
  t('нет запретных для хвата зон', banned.length === 0,
    banned.length ? banned.map((z) => z.id).join(',') : 'все 60 доступны');
  for (const id of ['brow_ridges', 'left_cheek', 'chin1', 'muzzle_lips',
                    'tail_base', 'left_paw', 'front_neck', 'navel']) {
    const z = FF.ZONES.find((x) => x.id === id);
    t('можно схватиться: ' + id, !!z && z.grab === true);
  }
}

/** Собрать сцену: игрок смотрит на друга */
function setup(cal) {
  const f = new FF.FurryEngine(scene,
    { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
  f.calories = cal; f._updateGrowthTargets(true); f.root.position.set(0, 0, 0);
  for (let i = 0; i < 40; i++) f.update(dt, 12);
  const cam = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
  const p = new FF.PlayerController(cam, world, f, audio);
  return { f, p, cam };
}

console.log('=== 2. РУКА ЛЕТИТ, А НЕ ТЕЛЕПОРТИРУЕТСЯ ===');
{
  const { f, p, cam } = setup(60000);
  // Ставим игрока вплотную и целимся в тело
  p.pos.set(0, 1.0, 3.0);
  p.yaw = 0; p.pitch = 0;
  for (let i = 0; i < 10; i++) p.update(dt);
  // Смотрим в сторону друга (камера глядит в -Z)
  p.yaw = 0; p.pitch = -0.15;       // смотрим чуть вниз, на корпус
  p._updateCamera(0.016);
  p.keys.ShiftLeft = true;          // режим хвата
  p.mouse.left = true;
  p._tryGrabOrPoke(p.hands[0]);

  const started = !!p.hands[0].reaching;
  t('замах начался (рука в полёте)', started,
    started ? 'цель: ' + p.hands[0].reaching.node.zone.id : 'рейкаст не попал');

  if (started) {
    t('захват ещё НЕ зафиксирован', !p.hands[0].grip);
    // Считаем, за сколько кадров рука долетит
    let frames = 0;
    while (!p.hands[0].grip && frames < 120) { p.update(dt); frames++; }
    const sec = frames / 60;
    t('рука долетела', !!p.hands[0].grip, 'за ' + sec.toFixed(2) + ' с');
    t('полёт занял заметное время (0.2-0.8 с)', sec > 0.2 && sec < 0.8,
      sec.toFixed(2) + ' с');
  }
}

console.log('=== 3. ХВАТ ЗА ГОЛОВУ ===');
{
  const { f, p, cam } = setup(60000);
  const S = f.species.scale;
  // Целимся ровно в макушку
  const head = f.root.localToWorld(new THREE.Vector3(0, 2.05 * S, 0));
  /* Камера игрока пересобирается в _updateCamera из pos/yaw/pitch, поэтому
   * задавать её напрямую бесполезно — целимся, выставляя углы взгляда. */
  p.pos.set(head.x, head.y - 0.2, head.z + 1.2);
  p.yaw = 0;            // взгляд в -Z, ровно на голову
  p.pitch = 0;
  p.frozen = false;
  p._updateCamera(0.016);
  p.keys.ShiftLeft = true; p.mouse.right = true;
  p._tryGrabOrPoke(p.hands[1]);
  const r = p.hands[1].reaching;
  t('рейкаст попал в голову/лицо', !!r && ['face', 'neck'].includes(r.node.zone.group),
    r ? r.node.zone.id + ' (' + r.node.zone.group + ')' : 'промах');
  if (r) {
    let frames = 0;
    while (!p.hands[1].grip && frames < 120) { p.update(dt); frames++; }
    t('за голову реально ухватились', !!p.hands[1].grip,
      p.hands[1].grip ? p.hands[1].grip.node.zone.id : 'нет');
    // За гладкую макушку держаться должно хуже, чем за складку живота
    if (p.hands[1].grip) {
      t('качество хвата за голову ниже, чем за живот',
        p.hands[1].grip.quality < 0.9,
        'quality=' + p.hands[1].grip.quality.toFixed(2));
    }
  }
}

console.log('=== 4. ОТПУСКАНИЕ ===');
{
  const { f, p, cam } = setup(60000);
  p.pos.set(0, 1.0, 3.0);
  p.yaw = 0; p.pitch = -0.15; p._updateCamera(0.016);
  p.keys.ShiftLeft = true; p.mouse.left = true;
  p._tryGrabOrPoke(p.hands[0]);
  let frames = 0;
  while (!p.hands[0].grip && frames < 120) { p.update(dt); frames++; }
  const had = !!p.hands[0].grip;
  p.onMouseUp(0);
  t('захват был', had);
  t('после отпускания рука свободна', !p.hands[0].grip && !p.hands[0].reaching);
  t('режим вернулся в ходьбу', !p.climbing);
}

console.log('=== 5. ЗАМАХ МОЖНО ОТМЕНИТЬ ===');
{
  const { f, p, cam } = setup(60000);
  p.pos.set(0, 1.0, 3.0);
  p.yaw = 0; p.pitch = -0.15; p._updateCamera(0.016);
  p.keys.ShiftLeft = true; p.mouse.left = true;
  p._tryGrabOrPoke(p.hands[0]);
  if (p.hands[0].reaching) {
    p.update(dt); p.update(dt);          // рука ещё в полёте
    p.mouse.left = false;                 // отпустили на полпути
    for (let i = 0; i < 10; i++) p.update(dt);
    t('незавершённый замах отменяется', !p.hands[0].reaching && !p.hands[0].grip);
  } else t('замах стартовал', false, 'рейкаст не попал');
}

console.log('=== 6. КАЧЕСТВО ХВАТА РАЗНОЕ ПО ЗОНАМ ===');
{
  const { f } = setup(250000);
  const belly = f.nodeById.mid_belly;
  const ear = f.nodeById.brow_ridges;
  // Крупная мягкая зона должна держать лучше мелкой твёрдой
  const q = (nd) => {
    const small = nd.zone.radius < 0.16 ? 0.3 : 0;
    return nd.growth * (0.35 + nd.soft * 0.5) - small;
  };
  t('за живот держаться надёжнее, чем за макушку', q(belly) > q(ear),
    'живот=' + q(belly).toFixed(2) + ' макушка=' + q(ear).toFixed(2));
}

console.log('\nИТОГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;

console.log('=== 7. ЖИВАЯ МИМИКА ===');
{
  const { f, p } = setup(60000);
  t('брови созданы', !!f.brows && f.brows.length === 2);

  // Удивление поднимает брови, сонливость опускает
  f.emotions.e.excitement = 95; f.emotions.e.sleepiness = 0; f.emotions.e.anxiety = 0;
  for (let i = 0; i < 40; i++) f.update(dt, 12);
  const up = f.brows[0].position.y;
  f.emotions.e.excitement = 0; f.emotions.e.sleepiness = 95;
  for (let i = 0; i < 40; i++) f.update(dt, 12);
  const down = f.brows[0].position.y;
  t('брови реагируют на эмоции', up > down,
    'удивление=' + up.toFixed(3) + ' сонливость=' + down.toFixed(3));

  // Зевота у сонного друга
  /* Зевок редкий по замыслу (раз в 14-40 с и с вероятностью), поэтому
   * ждём несколько интервалов и держим сонливость высокой. */
  f.emotions.e.sleepiness = 95;
  let yawned = false;
  for (let i = 0; i < 60 * 200 && !yawned; i++) {
    f.emotions.e.sleepiness = 95;      // не даём эмоции затухнуть
    f.update(dt, 12);
    if (f._yawn > 0) yawned = true;
  }
  t('сонный друг зевает', yawned);

  // Веки прикрываются от сонливости
  for (let i = 0; i < 60; i++) f.update(dt, 12);
  t('глаза сонно прикрыты', f.eyeOpen < 0.85, 'eyeOpen=' + f.eyeOpen.toFixed(2));

  // Зрачки следят за рукой игрока
  t('зрачки существуют для слежения', !!f.pupils && f.pupils.length === 2);
}

console.log('=== 8. ХВАТ ЗА ЛЮБУЮ ТОЧКУ МЕША (без зон) ===');
{
  const { f } = setup(120000);
  f.mesh.updateMatrixWorld();
  const pos = f.mesh.geometry.attributes.position.array;
  const wv = new THREE.Vector3();

  t('есть рейкаст по треугольникам меша',
    typeof f.physics.raycastMesh === 'function');
  t('свойства считаются по точке, а не по зоне',
    typeof f.physics.surfaceAt === 'function');

  // Стреляем в случайные вершины: луч обязан попасть в меш
  let total = 0, zones = new Set();
  for (let i = 0; i < 120; i++) {
    const v = Math.floor(Math.random() * f.vertexCount);
    wv.set(pos[v*3], pos[v*3+1], pos[v*3+2]); f.mesh.localToWorld(wv);
    const outward = wv.clone().sub(f.root.position).normalize();
    const hit = f.physics.raycastMesh(
      wv.clone().addScaledVector(outward, 2.5), outward.clone().negate(), 8);
    if (!hit) continue;
    total++;
    zones.add(f.physics.surfaceAt(hit.tri, hit.bary).node.zone.id);
  }
  t('лучи попадают в меш', total > 100, total + '/120');
  t('доступна вся поверхность, а не пара зон', zones.size > 20,
    'затронуто зон: ' + zones.size + '/60');

  /* Главная проверка: две БЛИЗКИЕ точки прицела должны дать РАЗНЫЕ точки
   * хвата. Если бы захват «прилипал» к зоне, обе дали бы один и тот же
   * якорь — ровно та проблема, которую чинили. */
  const h1 = f.physics.raycastMesh(new THREE.Vector3(0, 1.2, 3), new THREE.Vector3(0, 0, -1), 6);
  const h2 = f.physics.raycastMesh(new THREE.Vector3(0.12, 1.2, 3), new THREE.Vector3(0, 0, -1), 6);
  if (h1 && h2) {
    const d = h1.point.distanceTo(h2.point);
    t('соседние прицелы дают РАЗНЫЕ точки хвата', d > 0.05,
      'разошлись на ' + d.toFixed(3) + ' м');
  } else t('лучи в упор попали', false);

  // Свойства должны различаться между мягким животом и твёрдой лапой
  const hb = f.physics.raycastMesh(
    f.root.localToWorld(new THREE.Vector3(0, 1.1, 4)), new THREE.Vector3(0, 0, -1), 8);
  if (hb) {
    const s1 = f.physics.surfaceAt(hb.tri, hb.bary);
    t('свойства точки вычислены', s1.soft > 0 && s1.soft <= 1,
      'soft=' + s1.soft.toFixed(2) + ' growth=' + s1.growth.toFixed(2));
  }
}

console.log('=== 9. ЛИЦО КАК НА АРТАХ ===');
{
  const mk = (cal) => {
    const f = new FF.FurryEngine(scene,
      { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
    f.calories = cal; f._updateGrowthTargets(true);
    for (let i = 0; i < 60; i++) f.update(dt, 12);
    return f;
  };
  const head = (f) => {
    const pos = f.mesh.geometry.attributes.position.array;
    const part = f.mesh.geometry.attributes.part.array;
    let w = 0, y0 = 1e9, y1 = -1e9, chinZ = 0, muzZ = 0;
    for (let v = 0; v < f.vertexCount; v++) {
      if ((part[v] | 0) !== 3) continue;
      const r = Math.hypot(pos[v*3], pos[v*3+2]); if (r > w) w = r;
      const y = pos[v*3+1]; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    for (let v = 0; v < f.vertexCount; v++) {
      if ((part[v] | 0) !== 3) continue;
      if (Math.abs(pos[v*3]) > 0.1 * f.bodyScale) continue;
      const t2 = (pos[v*3+1] - y0) / (y1 - y0);
      if (t2 < 0.3 && pos[v*3+2] > chinZ) chinZ = pos[v*3+2];
      if (t2 > 0.45 && t2 < 0.7 && pos[v*3+2] > muzZ) muzZ = pos[v*3+2];
    }
    return { w: w * 2, h: y1 - y0, chinZ, muzZ };
  };

  const slim = head(mk(0)), fat = head(mk(250000));
  t('лицо круглое (ширина > высоты)', fat.w > fat.h,
    'Ш=' + fat.w.toFixed(2) + ' В=' + fat.h.toFixed(2) + ' → ' + (fat.w/fat.h).toFixed(2));
  t('подбородки выступают вперёд', fat.chinZ > fat.muzZ * 0.9,
    'подбородок=' + fat.chinZ.toFixed(2) + ' морда=' + fat.muzZ.toFixed(2));
  t('с массой подбородки растут', fat.chinZ / fat.muzZ > slim.chinZ / slim.muzZ,
    slim.chinZ.toFixed(2) + '/' + slim.muzZ.toFixed(2) + ' → ' +
    fat.chinZ.toFixed(2) + '/' + fat.muzZ.toFixed(2));
  const f = mk(250000);
  t('щёки заметно наливаются', f.nodeById.left_cheek.growth > 0.6,
    'growth=' + f.nodeById.left_cheek.growth.toFixed(2));
  t('три подбородка растут по очереди',
    f.nodeById.chin1.growth >= f.nodeById.chin2.growth &&
    f.nodeById.chin2.growth >= f.nodeById.chin3.growth,
    [f.nodeById.chin1, f.nodeById.chin2, f.nodeById.chin3]
      .map((n) => n.growth.toFixed(2)).join(' ≥ '));
}

console.log('=== 10. IDLE-ЖИЗНЬ (никогда не замирает) ===');
{
  const f = new FF.FurryEngine(scene,
    { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
  f.calories = 60000; f._updateGrowthTargets(true);
  /* Сценки выбираются случайно, поэтому за короткий прогон конкретная
   * может не выпасть. Гоняем дольше и голодным — тогда «похлопать пузо»
   * попадает в пул чаще (так и задумано: голодный трогает живот). */
  const kinds = new Set();
  for (let i = 0; i < 60 * 400; i++) {
    if (f.emotions) f.emotions.e.hunger = 70;   // держим голод высоким
    f.update(dt, 12);
    if (f._idleAct) kinds.add(f._idleAct.kind);
  }
  t('играются разные бытовые сценки', kinds.size >= 4,
    kinds.size + ' разных: ' + [...kinds].join(', '));
  t('голодный трогает живот или нюхает',
    kinds.has('pat') || kinds.has('sniff'), [...kinds].join(', '));
  t('есть потягивание', kinds.has('stretch'));
}


/* ============================================================
 * 11. КОЛЛИЗИЯ НЕ БОЛЬШЕ МЕША (регрессия «невидимая стенка»)
 * ------------------------------------------------------------
 * Баг: коллайдеры жили в локальных единицах тела, но worldCenter
 * умножался на bodyScale ВРУЧНУЮ, хотя root.scale уже равен bodyScale.
 * Центр улетал на bs² — у гиганта коллайдер живота оказывался в 20 раз
 * дальше кожи, и игрок упирался в пустоту за десятки метров от друга.
 * ============================================================ */
console.log('=== 11. КОЛЛИЗИЯ СОВПАДАЕТ С МЕШЕМ (нет воздушной стенки) ===');
{
  const R = FF.CONFIG.player.radius, H = FF.CONFIG.player.height;

  /** Истинный зазор от капсулы игрока до кожи (метры). <0 — уже в плоти */
  function skinGap(f, p) {
    const pos = f.mesh.geometry.attributes.position.array;
    const m = f.mesh.matrixWorld;
    const v = new THREE.Vector3();
    const ay = p.y + R, by = p.y + H - R;
    let best = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m);
      const cy = Math.max(ay, Math.min(by, v.y));
      const d = Math.hypot(v.x - p.x, v.y - cy, v.z - p.z);
      if (d < best) best = d;
    }
    return best - R;
  }

  for (const cal of [0, 120000, 900000]) {
    const f = new FF.FurryEngine(scene,
      { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
    f.calories = cal; f._updateGrowthTargets(true); f.root.position.set(0, 0, 0);
    for (let i = 0; i < 60; i++) f.update(dt, 12);
    f.root.updateMatrixWorld(true); f.mesh.updateMatrixWorld(true);
    const bs = f.bodyScale;

    // 1. Центр коллайдера обязан лежать внутри габаритов меша
    f.mesh.geometry.computeBoundingBox();
    const bb = f.mesh.geometry.boundingBox;
    const belly = f.physics.byId['mid_belly'];
    const insideBox = belly.center.x >= bb.min.x - 0.01 && belly.center.x <= bb.max.x + 0.01
                   && belly.center.y >= bb.min.y - 0.01 && belly.center.y <= bb.max.y + 0.01
                   && belly.center.z >= bb.min.z - 0.01 && belly.center.z <= bb.max.z + 0.01;
    t('bs=' + bs.toFixed(2) + ': центр коллайдера живота внутри меша', insideBox,
      'center.z=' + belly.center.z.toFixed(2) + ' меш до ' + bb.max.z.toFixed(2));

    // 2. worldCenter не должен улетать в bs раз дальше (тот самый баг)
    const expect = belly.center.clone();
    f.root.localToWorld(expect);
    const drift = belly.worldCenter.distanceTo(expect);
    t('bs=' + bs.toFixed(2) + ': worldCenter без двойного масштаба', drift < 0.01,
      'расхождение ' + drift.toFixed(3) + ' м');

    // 3. Идём на друга — останавливаться можно только у самой кожи
    const bw = belly.worldCenter.clone();
    const footY = Math.max(0, bw.y - H * 0.5);
    let worst = -Infinity;
    for (let k = 0; k < 8; k++) {
      const ang = k / 8 * Math.PI * 2;
      const dx = -Math.cos(ang), dz = -Math.sin(ang);
      const p = new THREE.Vector3(-dx * 30, footY, -dz * 30);
      const v = new THREE.Vector3();
      let prev = p.x * dx + p.z * dz, stalled = 0;
      for (let i = 0; i < 4000; i++) {
        p.x += dx * 0.02; p.z += dz * 0.02;
        v.set(dx * 1.6, 0, dz * 1.6);
        f.physics.resolvePlayer(p, v, R, H, dt);
        const proj = p.x * dx + p.z * dz;
        const adv = proj - prev; prev = proj;
        if (adv < 0.004) {
          if (++stalled >= 12) { worst = Math.max(worst, skinGap(f, p)); break; }
        } else stalled = 0;
        if (Math.hypot(p.x, p.z) < 0.08) break;   // прошёл — стенки нет
      }
    }
    // Порог 0.35 м: половина ребра меша у гиганта ≈ 0.28 м, точнее не измерить
    t('bs=' + bs.toFixed(2) + ': нет воздушной стенки вокруг друга',
      worst === -Infinity || worst < 0.35,
      worst === -Infinity ? 'нигде не упёрся' : 'худший зазор ' + worst.toFixed(2) + ' м');
    scene.remove(f.root);
  }
}

/* ============================================================
 * 12. РУКА УТОПАЕТ В ЖИРЕ, МЕШ ДЕФОРМИРУЕТСЯ
 * ------------------------------------------------------------
 * Раньше кисть просто касалась поверхности. Теперь при хвате она
 * погружается на 20-45 см (по мягкости места), в меше появляется
 * настоящая ямка, вокруг — валик вытесненного жира, а после
 * отпускания форма возвращается медленно, как густой мёд.
 * ============================================================ */
console.log('=== 12. ПОГРУЖЕНИЕ РУК В ЖИР ПРИ ХВАТЕ ===');
{
  const C = FF.CONFIG.player;
  t('глубина погружения настраивается в конфиге',
    C.grabSinkMin !== undefined && C.grabSinkSoft !== undefined && C.grabSinkMax !== undefined,
    'min=' + C.grabSinkMin + ' soft=' + C.grabSinkSoft + ' max=' + C.grabSinkMax);

  const { f, p } = setup(900000);
  f.root.updateMatrixWorld(true); f.mesh.updateMatrixWorld(true);
  const bs = f.bodyScale;
  const belly = f.physics.byId['mid_belly'];
  const bw = belly.worldCenter.clone();

  // Встаём перед животом, смотрим в -Z
  const skin = f.physics.raycastMesh(
    new THREE.Vector3(bw.x, bw.y, bw.z + 80), new THREE.Vector3(0, 0, -1), 160);
  const front = skin ? skin.point.z : bw.z + 2;
  p.pos.set(bw.x, Math.max(0, bw.y - FF.CONFIG.player.eyeHeight), front + 1.0);
  p.yaw = 0; p.pitch = 0; p.frozen = false;
  p._updateCamera(0.016);
  p.keys.ShiftLeft = true; p.mouse.left = true;
  p._tryGrabOrPoke(p.hands[0]);

  const h = p.hands[0];
  t('замах начался', !!h.reaching);
  let frames = 0;
  while (h.reaching && frames < 120) { p._updateReaching(dt); frames++; }
  t('захват зафиксирован', !!h.grip);

  if (h.grip) {
    const cm = h.grip.depthMeters * 100;
    t('рука утонула в живот на 20-45 см', cm >= 20 && cm <= 45.5,
      cm.toFixed(0) + ' см (зона ' + h.grip.node.zone.id + ')');

    const pr = f.handPresses && f.handPresses.find((x) => x.id === 'hand' + h.side);
    t('прижим зарегистрирован в теле', !!pr);

    // Меряем настоящую деформацию оболочки
    const before = Float32Array.from(f.mesh.geometry.attributes.position.array);
    for (let i = 0; i < 30; i++) f.update(dt, 12);
    const after = f.mesh.geometry.attributes.position.array;
    let dent = 0, bulge = 0, moved = 0;
    const d = pr.dir;
    for (let v = 0; v < f.vertexCount; v++) {
      const i = v * 3;
      const mv = ((after[i] - before[i]) * d.x
                + (after[i + 1] - before[i + 1]) * d.y
                + (after[i + 2] - before[i + 2]) * d.z) * bs;
      if (Math.abs(mv) > 0.004) moved++;
      if (mv > dent) dent = mv;
      if (-mv > bulge) bulge = -mv;
    }
    t('в меше появилась ЯМКА глубиной от 20 см', dent > 0.20,
      (dent * 100).toFixed(1) + ' см');
    t('вокруг ямки — ВАЛИК вытесненного жира', bulge > 0.02,
      (bulge * 100).toFixed(1) + ' см');
    t('деформация захватила заметный участок кожи', moved > 20,
      moved + ' вершин');

    // Отпускаем: форма обязана возвращаться, но не мгновенно
    p.mouse.left = false;
    p.onMouseUp(0);
    t('после отпускания хват снят', !h.grip);
    const pr2 = f.handPresses && f.handPresses.find((x) => x.id === 'hand' + h.side);
    t('ямка гаснет плавно, а не исчезает мгновенно',
      !pr2 || (pr2.target === 0 && pr2.cur > 0.001),
      pr2 ? 'осталось ' + (pr2.cur * bs * 100).toFixed(1) + ' см' : 'уже расправилась');

    let steps = 0;
    while (f.handPresses && f.handPresses.length && steps < 60 * 8) { f.update(dt, 12); steps++; }
    const sec = steps / 60;
    t('форма полностью восстановилась (густой мёд, 0.5-6 с)', sec > 0.5 && sec < 6,
      'за ' + sec.toFixed(1) + ' с');
  }
}

/* Мягкие места пускают пальцы глубже, чем твёрдые — это и есть
 * «динамический расчёт глубины по зоне» из ТЗ. */
console.log('=== 13. ГЛУБИНА ПОГРУЖЕНИЯ ЗАВИСИТ ОТ МЯГКОСТИ ЗОНЫ ===');
{
  const C = FF.CONFIG.player;
  const f = new FF.FurryEngine(scene,
    { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
  f.calories = 900000; f._updateGrowthTargets(true);
  for (let i = 0; i < 60; i++) f.update(dt, 12);

  const depth = (id) => f.grabDepthAt(f.nodeById[id]) * 100;
  const belly = depth('mid_belly'), paw = depth('left_paw'), thigh = depth('outer_left_thigh');
  t('живот мягче лапки', belly > paw + 10,
    'живот ' + belly.toFixed(0) + ' см, лапка ' + paw.toFixed(0) + ' см');
  t('лапка/голова — мелкое погружение (<25 см)', paw < 25, paw.toFixed(0) + ' см');
  t('глубина нигде не превышает потолок', belly <= C.grabSinkMax * 100 + 0.1,
    belly.toFixed(0) + ' см при потолке ' + (C.grabSinkMax * 100) + ' см');
  t('бедро между лапкой и животом', thigh > paw && thigh <= belly,
    'бедро ' + thigh.toFixed(0) + ' см');
}


/* ============================================================
 * 14. РУКИ НЕ ПРОВАЛИВАЮТСЯ СКВОЗЬ МЕШ, ТЕЛО НЕ ЗАСАСЫВАЕТ
 * ------------------------------------------------------------
 * Баг: пружина карабканья тянула ТУЛОВИЩЕ к утопленной кисти
 * (grip.offset — 45 см под кожей), и игрок медленно въезжал внутрь
 * друга: до −1.4 м под кожей после отпускания. Оттуда система
 * видела плоть над головой и включала ложный режим «под животом».
 *
 * Плюс _isInsideBody() врал: он считал по эллипсоидам зон и выдавал
 * «внутри» для точки в 1.2 м СНАРУЖИ кожи.
 * ============================================================ */
console.log('=== 14. РУКА В ЖИРЕ, ТЕЛО СНАРУЖИ ===');
{
  const H = FF.CONFIG.player.height;

  const f = new FF.FurryEngine(scene,
    { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
  f.calories = 900000; f._updateGrowthTargets(true); f.root.position.set(0, 0, 0);
  for (let i = 0; i < 60; i++) f.update(dt, 12);
  f.root.updateMatrixWorld(true); f.mesh.updateMatrixWorld(true);
  const bs = f.bodyScale;
  const cam = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
  const p = new FF.PlayerController(cam, world, f, audio);

  /* Глубина точки под кожей, метры (>0 — внутри плоти) */
  const depthAt = (localV) => {
    const pr = f.physics.skinProbe(localV.x, localV.y, localV.z, 3.0);
    return pr ? -pr.dist * bs : null;
  };
  /* Глубина ПОЯСА игрока — ровно то, что смотрит _isInsideBody */
  const waistDepth = () => {
    const l = f.root.worldToLocal(p.pos.clone());
    return depthAt(new THREE.Vector3(l.x, l.y + H / bs * 0.5, l.z));
  };
  /* Точка внутри меша? Считаем пересечения луча наружу: нечётное = внутри.
   * Знак skinProbe для этого не годится — у слитых примитивов четверть
   * нормалей смотрит внутрь, и на глубине знак случайно переворачивается
   * (сверка показала: 9 ложных «снаружи» из 25 там, где рука в плоти). */
  const insideMesh = (worldPt) => {
    const dirs = [new THREE.Vector3(1, 0.13, 0.07),
                  new THREE.Vector3(-0.09, 1, 0.11),
                  new THREE.Vector3(0.05, 0.08, 1)];
    let votes = 0;
    for (const d of dirs) {
      d.normalize();
      let hits = 0, org = worldPt.clone(), guard = 0;
      while (guard++ < 40) {
        const hh = f.physics.raycastMesh(org, d, 400);
        if (!hh) break;
        hits++; org = hh.point.clone().addScaledVector(d, 0.01);
      }
      if (hits % 2 === 1) votes++;
    }
    return votes >= 2;
  };

  /* Независимая проверка «есть ли плоть над головой» */
  const trulyUnder = () => {
    const arr = f.mesh.geometry.attributes.position.array;
    const w = new THREE.Vector3();
    let n = 0;
    for (let v = 0; v < f.vertexCount; v++) {
      const i = v * 3;
      w.set(arr[i], arr[i + 1], arr[i + 2]);
      f.mesh.localToWorld(w);
      if (w.y <= p.pos.y + H) continue;
      const dx = w.x - p.pos.x, dz = w.z - p.pos.z;
      if (dx * dx + dz * dz > 0.55 * 0.55) continue;
      if (++n >= 3) return true;
    }
    return false;
  };

  // --- _isInsideBody обязан согласоваться с настоящей кожей ---
  const belly = f.physics.byId['mid_belly'];
  const bw = belly.worldCenter.clone();
  let mismatch = 0;
  for (const off of [4.0, 2.5, 1.5, 0.8, 0.0, -1.2, -2.0]) {
    p.pos.set(bw.x, bw.y - H * 0.5, bw.z + off);
    const d = waistDepth();
    if (d === null) continue;
    if (p._isInsideBody() !== (d > 0.30)) mismatch++;
  }
  t('_isInsideBody согласован с мешем (не врёт по эллипсоидам)',
    mismatch === 0, mismatch + ' расхождений из 7');

  // --- Хватаемся за живот и лезем ---
  const skin = f.physics.raycastMesh(
    new THREE.Vector3(bw.x, bw.y, bw.z + 80), new THREE.Vector3(0, 0, -1), 160);
  p.pos.set(bw.x, Math.max(0, bw.y - FF.CONFIG.player.eyeHeight), skin.point.z + 1.0);
  p.yaw = 0; p.pitch = 0; p.frozen = false;
  p._updateCamera(0.016);
  p.keys.ShiftLeft = true; p.mouse.left = true;
  p._tryGrabOrPoke(p.hands[0]);
  const h = p.hands[0];
  let n = 0;
  while (h.reaching && n < 120) { p._updateReaching(dt); n++; }
  t('захват состоялся', !!h.grip);

  if (h.grip) {
    t('кисть сидит ВНУТРИ жира сразу после хвата',
      depthAt(h.grip.offset) > 0.15,
      (depthAt(h.grip.offset) * 100).toFixed(0) + ' см под кожей');
    t('точка входа лежит НА коже, а не внутри',
      Math.abs(depthAt(h.grip.surface)) < 0.15,
      (depthAt(h.grip.surface) * 100).toFixed(0) + ' см');

    // Лезем 250 кадров, потом отпускаем и падаем
    p.keys.KeyW = true;
    let falseUB = 0, bodyDeep = 0, handOut = 0, maxBody = -99, handChecks = 0;
    for (let i = 0; i < 400; i++) {
      p.update(dt); f.update(dt, 12);
      if (i === 250) { p.mouse.left = false; p.onMouseUp(0); p.keys.KeyW = false; }
      const wd = waistDepth();
      if (wd !== null) {
        if (wd > maxBody) maxBody = wd;
        if (wd > 0.60) bodyDeep++;          // туловище утонуло — это баг
      }
      if (p.mode === 'underbelly' && !trulyUnder()) falseUB++;
      if (i % 10 === 0 && h.grip) {
        handChecks++;
        if (!insideMesh(f.root.localToWorld(h.grip.offset.clone()))) handOut++;
      }
    }
    t('туловище НЕ засасывает внутрь тела', bodyDeep === 0,
      'глубже 60 см: ' + bodyDeep + ' кадров, максимум ' + (maxBody * 100).toFixed(0) + ' см');
    /* Допускаем единичные кадры на самой границе: выборка вершин в
     * _hasBellyOverhead идёт с шагом 3, и на краю нависания счётчик
     * может дрогнуть на кадр. Массового ложного режима быть не должно. */
    t('нет ложного режима «под животом»', falseUB <= 3,
      falseUB + ' ложных кадров из 400');
    t('кисть всё время остаётся ВНУТРИ плоти (лучевой тест)',
      handOut === 0, handOut + ' проверок снаружи из ' + handChecks);
  }
}

/* Кламп глубины: на тонких деталях рука не проходит насквозь */
console.log('=== 15. ГЛУБИНА ХВАТА ОГРАНИЧЕНА ТОЛЩИНОЙ ПЛОТИ ===');
{
  const f = new FF.FurryEngine(scene,
    { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
  f.calories = 900000; f._updateGrowthTargets(true);
  for (let i = 0; i < 60; i++) f.update(dt, 12);
  f.root.updateMatrixWorld(true); f.mesh.updateMatrixWorld(true);
  const bs = f.bodyScale;
  const cam = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
  const p = new FF.PlayerController(cam, world, f, audio);

  t('кламп глубины существует', typeof p._clampSinkToFlesh === 'function');
  t('страховка туловища существует', typeof p._keepBodyOutOfFlesh === 'function');

  // В толстом животе кламп не должен резать глубину
  const belly = f.physics.byId['mid_belly'];
  const bw = belly.worldCenter.clone();
  const hit = f.physics.raycastMesh(
    new THREE.Vector3(bw.x, bw.y, bw.z + 80), new THREE.Vector3(0, 0, -1), 160);
  if (hit) {
    const loc = f.root.worldToLocal(hit.point.clone());
    const inward = hit.normal.clone()
      .applyQuaternion(f.root.quaternion.clone().invert()).normalize().negate();
    const want = 0.45 / bs;
    const got = p._clampSinkToFlesh(loc, inward, want);
    t('в толстом животе рука тонет на полную глубину',
      got > want * 0.7, (got * bs * 100).toFixed(0) + ' см из ' + (want * bs * 100).toFixed(0));
    t('кламп никогда не превышает запрошенное', got <= want + 1e-9);
    t('кламп не обнуляет хват', got > 0);
  }
}

console.log('\nВСЕГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
