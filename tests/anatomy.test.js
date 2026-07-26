/**
 * anatomy.test.js — контроль пропорций тела.
 *
 * Ловит два класса регрессий:
 *   1) «Осколки у лица» — когда зона живота дотягивается до головы и рвёт
 *      морду вперёд (лечится картой PART_ZONES в furry.js).
 *   2) Плоская попа — когда ягодицы растут вниз вместо того, чтобы
 *      выпирать назад.
 */
global.window = global; global.self = global;
global.performance = global.performance || { now: () => Date.now() };
global.document = { createElement: () => ({ style:{}, addEventListener(){}, appendChild(){},
  setAttribute(){}, width:0, height:0,
  getContext: () => ({ fillRect(){}, createRadialGradient: () => ({ addColorStop(){} }) }) }),
  addEventListener(){}, body:{ appendChild(){}, style:{} },
  getElementById: () => null, querySelector: () => null };

const _t = require('../libs/three.min.js');
global.THREE = global.THREE || window.THREE || _t;
require('../src/utils.js'); require('../src/config.js');
require('../src/physics.js'); require('../src/lifesystems.js'); require('../src/furry.js');

const FF = global.FF;
let pass = 0, fail = 0;
const t = (n, c, extra) => { c ? (pass++, console.log('  ✓', n, extra || ''))
                               : (fail++, console.log('  ✗', n, extra || '')); };
const audio = { squish(){}, jiggle(){}, slap(){}, voice(){}, step(){}, bubble(){} };

/** Замер формы тела при заданных калориях */
function measure(cal, species, build) {
  const f = new FF.FurryEngine(new THREE.Scene(),
    { species: species || 'fox', build: build || 'pear', furColor: 1, eyeColor: 1, name: 'T' }, audio);
  f.calories = cal; f._updateGrowthTargets(true);
  for (let i = 0; i < 90; i++) f.update(1 / 60, 12);
  const pos = f.mesh.geometry.attributes.position.array;
  const part = f.mesh.geometry.attributes.part.array;
  const base = f.basePos;
  const r = { pelvisBack: 0, torsoFront: 0, headMax: 0, headSpan: 0, limbMax: 0 };
  let hMin = 9, hMax = -9;
  for (let v = 0; v < f.vertexCount; v++) {
    const p = part[v] | 0;
    const d = Math.hypot(pos[v*3] - base[v*3], pos[v*3+1] - base[v*3+1], pos[v*3+2] - base[v*3+2]);
    if (p === 1) r.pelvisBack = Math.max(r.pelvisBack, -pos[v*3+2]);
    if (p === 0) r.torsoFront = Math.max(r.torsoFront, pos[v*3+2]);
    if (p === 3 || p === 7) {
      r.headMax = Math.max(r.headMax, d);
      hMin = Math.min(hMin, pos[v*3+2]); hMax = Math.max(hMax, pos[v*3+2]);
    }
    if (p === 5 || p === 6) r.limbMax = Math.max(r.limbMax, d);
  }
  r.headSpan = hMax - hMin;
  r.furry = f;
  return r;
}

console.log('=== 1. ГОЛОВА НЕ РВЁТСЯ ЖИВОТОМ ===');
const big = measure(250000);
// Голова размером ~0.25 м. Смещение больше её половины = морда развалилась.
t('смещение вершин головы в пределах нормы', big.headMax < 0.55,
  'макс=' + big.headMax.toFixed(2) + ' м');
t('голова не растягивается в длину', big.headSpan < 1.4,
  'протяжённость по Z=' + big.headSpan.toFixed(2) + ' м');
t('голова не уезжает дальше живота', big.headMax < big.torsoFront,
  'голова=' + big.headMax.toFixed(2) + ' живот=' + big.torsoFront.toFixed(2));

console.log('=== 2. ПРИВЯЗКА ПО АНАТОМИИ ===');
{
  const f = big.furry, K = f.K;
  const partAttr = f.mesh.geometry.attributes.part.array;
  let bellyOnHead = 0, legOnHead = 0;
  for (let v = 0; v < f.vertexCount; v++) {
    if ((partAttr[v] | 0) !== 3) continue;
    for (let k = 0; k < K; k++) {
      const idx = f.wIdx[v * K + k];
      if (idx < 0) break;
      const grp = f.nodes[idx].zone.group;
      if (grp === 'belly') bellyOnHead++;
      if (grp === 'legs' || grp === 'thighs' || grp === 'glutes') legOnHead++;
    }
  }
  t('живот не управляет головой', bellyOnHead === 0, 'связей=' + bellyOnHead);
  t('ноги/попа не управляют головой', legOnHead === 0, 'связей=' + legOnHead);
}

console.log('=== 3. ПОПА ВЫПИРАЕТ ===');
t('попа выпирает назад заметно', big.pelvisBack > 1.2,
  'назад=' + big.pelvisBack.toFixed(2) + ' м');
t('попа не уступает животу', big.pelvisBack >= big.torsoFront * 0.95,
  'попа=' + big.pelvisBack.toFixed(2) + ' живот=' + big.torsoFront.toFixed(2));
const slim = measure(0);
t('у стройного попа скромная', slim.pelvisBack < 0.7, 'назад=' + slim.pelvisBack.toFixed(2));
t('попа растёт вместе с массой', big.pelvisBack > slim.pelvisBack * 2.5,
  slim.pelvisBack.toFixed(2) + ' -> ' + big.pelvisBack.toFixed(2));

console.log('=== 4. ПЛАВНЫЙ РОСТ БЕЗ РЫВКОВ ===');
{
  let prev = 0, ok = true, jump = 0;
  for (const cal of [0, 1200, 12000, 60000, 220000, 800000]) {
    const m = measure(cal);
    if (m.pelvisBack < prev - 0.01) ok = false;
    jump = Math.max(jump, m.pelvisBack - prev);
    prev = m.pelvisBack;
  }
  t('попа растёт монотонно', ok);
  t('без скачкообразных прыжков', jump < 0.9, 'макс прирост=' + jump.toFixed(2));
}

console.log('=== 5. ВСЕ ВИДЫ БЕЗ АРТЕФАКТОВ ===');
{
  let worst = 0, worstName = '';
  for (const sp of Object.keys(FF.SPECIES)) {
    const m = measure(250000, sp, 'pear');
    if (m.headMax > worst) { worst = m.headMax; worstName = sp; }
  }
  t('ни у одного вида голова не рвётся', worst < 0.6,
    'худший: ' + worstName + ' = ' + worst.toFixed(2));
}

console.log('\nИТОГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
