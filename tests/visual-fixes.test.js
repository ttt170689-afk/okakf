/**
 * visual-fixes.test.js — контроль визуальных багов, найденных по скриншотам.
 *
 *   1) «Синий шар» — одежда-примитив вылезала сквозь тело.
 *   2) Лицо — глаза/нос проваливались внутрь деформированной морды.
 *   3) Живот упирался в потолок роста на 7-й стадии.
 *   4) Невидимая стенка не давала подойти к другу вплотную.
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

function make(cal, species) {
  const f = new FF.FurryEngine(new THREE.Scene(),
    { species: species || 'fox', build: 'pear', furColor: 1, eyeColor: 1, name: 'T' }, audio);
  f.calories = cal; f._updateGrowthTargets(true);
  for (let i = 0; i < 60; i++) f.update(1 / 60, 12);
  return f;
}

console.log('=== 1. ОДЕЖДА НЕ ВЫЛЕЗАЕТ СКВОЗЬ ТЕЛО ===');
{
  let worstInside = 0, worstGap = 0;
  for (const cal of [0, 1200, 12000, 28000]) {
    const f = make(cal);
    if (!f.shirt.visible) continue;
    const sp = f.shirt.geometry.attributes.position.array;
    const bp = f.mesh.geometry.attributes.position.array;
    const nr = f.mesh.geometry.attributes.normal.array;
    let inside = 0, gap = 0;
    for (let i = 0; i < f.shirtMap.length; i++) {
      const v = f.shirtMap[i];
      const dx = sp[i*3] - bp[v*3], dy = sp[i*3+1] - bp[v*3+1], dz = sp[i*3+2] - bp[v*3+2];
      gap = Math.max(gap, Math.hypot(dx, dy, dz));
      if (dx*nr[v*3] + dy*nr[v*3+1] + dz*nr[v*3+2] < -0.0005) inside++;
    }
    worstInside = Math.max(worstInside, inside);
    worstGap = Math.max(worstGap, gap);
  }
  t('ткань нигде не тонет в теле', worstInside === 0, 'вершин внутри=' + worstInside);
  t('ткань облегает вплотную', worstGap < 0.06, 'макс зазор=' + worstGap.toFixed(3) + ' м');
  const f = make(0);
  t('футболка построена из вершин тела', !!f.shirtMap && f.shirtMap.length > 100,
    'вершин=' + (f.shirtMap ? f.shirtMap.length : 0));
  t('шорты построены из вершин тела', !!f.shortsMap && f.shortsMap.length > 100);
  t('одежда исчезает на поздних стадиях', !make(120000).shirt.visible);
}

console.log('=== 2. ЛИЦО НА МЕСТЕ ===');
{
  for (const cal of [0, 60000, 250000]) {
    const f = make(cal);
    const pos = f.mesh.geometry.attributes.position.array;
    const part = f.mesh.geometry.attributes.part.array;
    let front = -9;
    for (let v = 0; v < f.vertexCount; v++) {
      if ((part[v] | 0) === 3 && pos[v*3+2] > front) front = pos[v*3+2];
    }
    // Нос обязан торчать наружу, а не тонуть в морде
    t('нос снаружи морды (кал=' + cal + ')', f.nose.position.z >= front - 0.02,
      'нос=' + f.nose.position.z.toFixed(2) + ' морда=' + front.toFixed(2));
  }
  // Черты следуют за деформацией: на большой массе лицо смещается вверх
  const a = make(0), b = make(250000);
  t('лицо поднимается вместе с головой', b.nose.position.y > a.nose.position.y,
    a.nose.position.y.toFixed(2) + ' -> ' + b.nose.position.y.toFixed(2));
  t('нос выносится вперёд с ростом', b.nose.position.z > a.nose.position.z,
    a.nose.position.z.toFixed(2) + ' -> ' + b.nose.position.z.toFixed(2));
}

console.log('=== 3. ЖИВОТ РАСТЁТ ДО КОНЦА ===');
{
  const measure = (cal) => {
    const f = make(cal);
    const pos = f.mesh.geometry.attributes.position.array;
    const part = f.mesh.geometry.attributes.part.array;
    let front = 0;
    for (let v = 0; v < f.vertexCount; v++) if ((part[v] | 0) === 0) front = Math.max(front, pos[v*3+2]);
    return { front, g: f.nodeById.mid_belly.growth, scale: f.bodyScale };
  };
  const s7 = measure(110000), s8 = measure(220000), s10 = measure(800000);
  t('живот растёт после 7-й стадии', s8.front > s7.front * 1.12,
    s7.front.toFixed(2) + ' -> ' + s8.front.toFixed(2));
  t('живот растёт до 10-й стадии', s10.front > s8.front * 1.15,
    s8.front.toFixed(2) + ' -> ' + s10.front.toFixed(2));
  t('рост зоны пробивает потолок 1.0', s10.g > 1.2, 'growth=' + s10.g.toFixed(2));
  t('габариты не упираются в старый лимит 3.4', s10.scale > 3.5, 'scale=' + s10.scale.toFixed(2));
  // Морда при этом НЕ должна раздуваться пропорционально животу
  const f10 = make(800000);
  t('морда не раздувается вслед за животом',
    f10.nodeById.left_cheek.growth < f10.nodeById.mid_belly.growth * 0.85,
    'щека=' + f10.nodeById.left_cheek.growth.toFixed(2) + ' живот=' + f10.nodeById.mid_belly.growth.toFixed(2));
}

console.log('=== 4. МОЖНО ПОДОЙТИ ВПЛОТНУЮ ===');
{
  const f = make(250000);
  f.physics.update(1 / 60);
  const vel = new THREE.Vector3();
  // Идём прямо в живот и смотрим, насколько глубоко пускает
  const probe = (burrow) => {
    f.playerBurrowing = burrow;
    let deepest = 0;
    // Идём в тело на высоте пояса — там живот, а не воздух над головой
    for (let step = 0; step < 40; step++) {
      const p = new THREE.Vector3(f.root.position.x,
        f.root.position.y + 0.9, f.root.position.z + 4.0 - step * 0.12);
      const r = f.physics.resolvePlayer(p, vel, 0.32, 1.72, 1 / 60);
      if (r.hit) deepest = Math.max(deepest, r.sink);
    }
    return deepest;
  };
  const normal = probe(false), burrowing = probe(true);
  t('плоть пускает глубоко', normal > 0.25, 'погружение=' + normal.toFixed(2));
  t('при карабканье пускает ещё глубже', burrowing > normal,
    normal.toFixed(2) + ' -> ' + burrowing.toFixed(2));
  t('флаг зарывания читается физикой', burrowing >= normal * 1.02);
}

console.log('=== 5. НЕТ РЕГРЕССИЙ ===');
{
  let bad = 0, vnan = 0;
  const f = make(800000);
  for (let i = 0; i < 90; i++) f.update(1 / 60, 12);
  for (const n of f.nodes) if (!isFinite(n.offset.y)) bad++;
  const pa = f.mesh.geometry.attributes.position.array;
  for (let i = 0; i < pa.length; i++) if (!isFinite(pa[i])) vnan++;
  t('нет NaN в зонах на максимуме', bad === 0);
  t('нет NaN в вершинах на максимуме', vnan === 0);
  let err = null;
  try { for (const sp of Object.keys(FF.SPECIES)) make(400000, sp); }
  catch (e) { err = e.message; }
  t('все виды переживают overdrive', !err, err || '');
}

console.log('\nИТОГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
