/**
 * bodyspots.test.js — жизнь на теле друга + строгая проверка «под животом».
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
const HX = -62, HZ = 94;

/** Собрать мини-игру с игроком, стоящим НА животе друга */
function setupOnBelly(cal) {
  const f = new FF.FurryEngine(scene,
    { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
  f.calories = cal; f._updateGrowthTargets(true); f.root.position.set(HX, 0, HZ);
  for (let i = 0; i < 40; i++) f.update(dt, 12);
  const cam = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
  const p = new FF.PlayerController(cam, world, f, audio);
  const notes = [];
  const g = {
    scene, furry: f, player: p, camera: cam, audio, world,
    gameHours: 20, day: 1,
    notify: (m) => notes.push(m), achieve(){}, skipTime(){},
    ui: { open(){}, close(){} },
    inv: { foodList: () => ['donut'], remove(){}, selected: null, addCoins(){} },
    objects: { items: [] }, taxi: { active: false }, quests: { event(){} },
    playerBody: { addStrengthXP(){} }, notes,
  };
  g.bodySpots = new FF.BodySpots(g);
  FF.Game = g;
  // Роняем игрока сверху, чтобы он встал на тело
  p.pos.set(HX, f.topY() + 2.5, HZ + 0.4);
  for (let i = 0; i < 240; i++) { p.update(dt); f.update(dt, 12); }
  return g;
}

console.log('=== 1. ИГРОК СТОИТ НА ТЕЛЕ ===');
const g1 = setupOnBelly(250000);
t('приземлился на тело', !!g1.player.standingZone,
  g1.player.standingZone ? g1.player.standingZone.zone.id : 'нет опоры');
t('режим onbelly', g1.player.mode === 'onbelly', g1.player.mode);

console.log('=== 2. МЕСТО ОПРЕДЕЛЯЕТСЯ ===');
const spot = g1.bodySpots.currentSpot();
t('система нашла место', !!spot, spot ? spot.def.name : 'нет');
t('у места есть действия', spot && spot.def.acts.length > 0,
  spot ? spot.def.acts.join(',') : '');
t('есть подсказка для HUD', !!g1.bodySpots.hint());

console.log('=== 3. СИДЕТЬ ===');
{
  const st0 = g1.player.stamina = 20;
  g1.bodySpots.perform('sit');
  t('состояние «сидит»', g1.bodySpots.state === 'sitting', g1.bodySpots.state);
  for (let i = 0; i < 120; i++) { g1.player.update(dt); g1.furry.update(dt, 12); g1.bodySpots.update(dt); }
  t('стамина восстанавливается сидя', g1.player.stamina > st0 + 5,
    st0 + ' -> ' + g1.player.stamina.toFixed(0));
  t('другу приятно', g1.furry.emotions.e.comfort > 50,
    'comfort=' + g1.furry.emotions.e.comfort.toFixed(0));
  g1.bodySpots.getUp();
  t('встал', g1.bodySpots.state === 'none');
}

console.log('=== 4. ЛЕЖАТЬ ===');
{
  g1.player.stamina = 10;
  // Возвращаем игрока на тело
  g1.player.pos.set(HX, g1.furry.topY() + 1.5, HZ + 0.4);
  for (let i = 0; i < 200; i++) { g1.player.update(dt); g1.furry.update(dt, 12); }
  if (g1.bodySpots.currentSpot()) {
    g1.bodySpots.perform('lie');
    t('состояние «лежит»', g1.bodySpots.state === 'lying', g1.bodySpots.state);
    const s0 = g1.player.stamina;
    for (let i = 0; i < 120; i++) { g1.player.update(dt); g1.furry.update(dt, 12); g1.bodySpots.update(dt); }
    t('лёжа восстанавливается быстрее', g1.player.stamina > s0 + 10,
      s0.toFixed(0) + ' -> ' + g1.player.stamina.toFixed(0));
    g1.bodySpots.getUp();
  } else t('место доступно для лежания', false, 'игрок соскользнул');
}

console.log('=== 5. СОН НА ДРУГЕ ===');
{
  let skipped = 0;
  g1.skipTime = (h) => { skipped = h; };
  g1.player.pos.set(HX, g1.furry.topY() + 1.5, HZ + 0.4);
  for (let i = 0; i < 200; i++) { g1.player.update(dt); g1.furry.update(dt, 12); }
  g1.player.stamina = 5;
  const love0 = g1.furry.emotions.e.love;
  g1.bodySpots.sleepOnBody();
  t('время пропущено до утра', skipped > 0, skipped.toFixed(1) + ' ч');
  t('стамина полная', g1.player.stamina === FF.CONFIG.player.maxStamina);
  t('друг сильнее привязался', g1.furry.emotions.e.love > love0,
    love0.toFixed(0) + ' -> ' + g1.furry.emotions.e.love.toFixed(0));
  t('состояние сброшено', g1.bodySpots.state === 'none');
}

console.log('=== 6. НА ЗЕМЛЕ ОБУСТРОИТЬСЯ НЕЛЬЗЯ ===');
{
  const p = g1.player;
  p.pos.set(HX + 25, world.heightAt(HX + 25, HZ + 25), HZ + 25);
  for (let i = 0; i < 60; i++) { p.update(dt); g1.furry.update(dt, 12); }
  t('вне тела место не находится', g1.bodySpots.currentSpot() === null);
  t('меню не открывается', g1.bodySpots.openMenu() === false);
}

console.log('=== 7. СТРОГАЯ ПРОВЕРКА «ПОД ЖИВОТОМ» ===');
{
  const f = new FF.FurryEngine(scene,
    { species:'dragon', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
  f.calories = 250000; f._updateGrowthTargets(true); f.root.position.set(HX, 0, HZ);
  for (let i = 0; i < 40; i++) f.update(dt, 12);
  const cam = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
  const p = new FF.PlayerController(cam, world, f, audio);

  // Далеко от друга — режим обязан быть walk.
  // teleport(), а не присваивание pos: иначе остаётся старая опора и режим.
  p.teleport(HX, HZ + 45);   // заведомо за габаритами даже гигантской туши
  for (let i = 0; i < 60; i++) { p.update(dt); f.update(dt, 12); }
  t('вдалеке режим walk', p.mode === 'walk', p.mode);
  t('нет ложного under вдалеке', !p._hasBellyOverhead());

  // Высоко в воздухе под тушей — тоже не «под животом» (условие «у земли»)
  p.pos.set(HX, world.heightAt(HX, HZ) + 12, HZ);
  t('в воздухе under не включается', !p._hasBellyOverhead());

  // Подходим вплотную и проверяем согласованность с реальной геометрией
  p.pos.set(HX, world.heightAt(HX, HZ + 9), HZ + 9); p.yaw = 0; p.keys.KeyW = true;
  for (let i = 0; i < 500; i++) { p.update(dt); f.update(dt, 12); }
  p.keys.KeyW = false;
  const pos = f.mesh.geometry.attributes.position.array;
  const wv = new THREE.Vector3();
  let above = 0;
  const headY = p.pos.y + FF.CONFIG.player.height;
  for (let i = 0; i < pos.length; i += 3) {
    wv.set(pos[i], pos[i+1], pos[i+2]); f.mesh.localToWorld(wv);
    if (Math.hypot(wv.x - p.pos.x, wv.z - p.pos.z) < 0.5 && wv.y > headY) above++;
  }
  const isUnder = p.mode === 'underbelly';
  t('режим соответствует реальной геометрии', (above > 0) === isUnder,
    'вершин над головой=' + above + ' режим=' + p.mode);
  t('игрок не внутри меша', !p._isInsideBody());
}

console.log('=== 8. ФОРМА: МНОГОЯРУСНОСТЬ ===');
{
  const f = new FF.FurryEngine(scene,
    { species:'dragon', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
  f.calories = 250000; f._updateGrowthTargets(true);
  for (let i = 0; i < 50; i++) f.update(dt, 12);
  const pos = f.mesh.geometry.attributes.position.array;
  const part = f.mesh.geometry.attributes.part.array;
  let ymin = 1e9, ymax = -1e9;
  for (let v = 0; v < f.vertexCount; v++) {
    const pt = part[v] | 0; if (pt !== 0 && pt !== 1 && pt !== 2) continue;
    const y = pos[v*3+1]; if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  const N = 40, step = (ymax - ymin) / N, prof = [];
  for (let i = 0; i <= N; i++) {
    const y = ymin + step * i; let r = 0;
    for (let v = 0; v < f.vertexCount; v++) {
      const pt = part[v] | 0; if (pt !== 0 && pt !== 1 && pt !== 2) continue;
      if (Math.abs(pos[v*3+1] - y) > step * 0.5) continue;
      const rr = Math.hypot(pos[v*3], pos[v*3+2]); if (rr > r) r = rr;
    }
    prof.push(r);
  }
  const mx = Math.max(...prof) || 1;
  const sm = prof.map((v, i) => ((prof[i-1] ?? v) + v + (prof[i+1] ?? v)) / 3);
  let relief = 0;
  for (let i = 1; i < sm.length - 1; i++) relief += Math.abs(sm[i] - (sm[i-1] + sm[i+1]) / 2);
  relief /= mx;
  t('силуэт рельефный, а не гладкий пузырь', relief > 0.25, 'рельеф=' + relief.toFixed(3));
  // Голова должна быть заметно меньше корпуса
  let headR = 0, bodyR = 0;
  for (let v = 0; v < f.vertexCount; v++) {
    const pt = part[v] | 0;
    const rr = Math.hypot(pos[v*3], pos[v*3+2]);
    if (pt === 3) headR = Math.max(headR, rr);
    if (pt === 0) bodyR = Math.max(bodyR, rr);
  }
  t('голова мала на фоне туши', headR < bodyR * 0.45,
    'голова=' + headR.toFixed(2) + ' корпус=' + bodyR.toFixed(2));
}

console.log('\nИТОГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
