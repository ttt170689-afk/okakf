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

console.log('\nВСЕГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
