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

console.log('=== 6. КАЧЕСТВО ОБОЛОЧКИ (гладкость, без щелей) ===');
{
  const f = measure(250000).furry;
  // 1. Швы между слитыми примитивами не расходятся
  const pos = f.mesh.geometry.attributes.position.array;
  let maxGap = 0;
  const w = f._weld;
  for (let i = 0; i < w.length;) {
    const n = w[i++], v0 = w[i] * 3;
    for (let k = 1; k < n; k++) {
      const v = w[i + k] * 3;
      const d = Math.hypot(pos[v]-pos[v0], pos[v+1]-pos[v0+1], pos[v+2]-pos[v0+2]);
      if (d > maxGap) maxGap = d;
    }
    i += n;
  }
  t('швы зашиты (нет щелей в теле)', maxGap < 0.001, 'макс расхождение=' + maxGap.toFixed(5));

  // 2. Поверхность гладкая: средний угол между гранями
  const roughness = (furry) => {
    const g = furry.mesh.geometry, p = g.attributes.position.array, idx = g.index.array;
    const emap = new Map(), tn = [];
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i]*3, b = idx[i+1]*3, c = idx[i+2]*3;
      const e1x=p[b]-p[a], e1y=p[b+1]-p[a+1], e1z=p[b+2]-p[a+2];
      const e2x=p[c]-p[a], e2y=p[c+1]-p[a+1], e2z=p[c+2]-p[a+2];
      let nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x;
      const l=Math.hypot(nx,ny,nz)||1; tn.push([nx/l,ny/l,nz/l]);
      const t3=i/3, vs=[idx[i],idx[i+1],idx[i+2]];
      for (let k=0;k<3;k++){ const q=vs[k], r=vs[(k+1)%3];
        const key=Math.min(q,r)+'_'+Math.max(q,r);
        let L=emap.get(key); if(!L){L=[];emap.set(key,L);} L.push(t3); }
    }
    let sum=0,cnt=0;
    for (const L of emap.values()) { if (L.length!==2) continue;
      const A=tn[L[0]], B=tn[L[1]];
      let d=A[0]*B[0]+A[1]*B[1]+A[2]*B[2];
      sum += Math.acos(Math.max(-1,Math.min(1,d))); cnt++; }
    return sum/cnt*180/Math.PI;
  };
  const r = roughness(f);
  t('оболочка гладкая, не кусковатая', r < 16, 'шероховатость=' + r.toFixed(1) + '°');
  t('сглаживание включено в конфиге', FF.CONFIG.render.meshSmooth > 0,
    'meshSmooth=' + FF.CONFIG.render.meshSmooth);
}

console.log('=== 7. ЖИВОТ — ЕДИНАЯ КАПЛЯ, А НЕ СТОПКА БЛИНОВ ===');
{
  /* Регрессия из отзыва: попытка набрать силуэт из шести колец давала
   * «слоёный торт». Профиль выноса вперёд должен быть ОДНОЙ плавной
   * дугой с единственным пиком, без ступенек. */
  const profileOf = (cal) => {
    const f = new FF.FurryEngine(new THREE.Scene(),
      { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'T' }, audio);
    f.calories = cal; f._updateGrowthTargets(true);
    for (let i = 0; i < 50; i++) f.update(1 / 60, 12);
    const pos = f.mesh.geometry.attributes.position.array;
    const part = f.mesh.geometry.attributes.part.array;
    const pts = [];
    for (let v = 0; v < f.vertexCount; v++) {
      if ((part[v] | 0) !== 0) continue;
      if (Math.abs(pos[v*3]) > 0.30 * f.bodyScale) continue;   // полоса по центру
      pts.push([pos[v*3+1], pos[v*3+2]]);
    }
    let ymin = 1e9, ymax = -1e9;
    for (const [y] of pts) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    const N = 22, step = (ymax - ymin) / N, rows = new Array(N + 1).fill(0);
    for (const [y, z] of pts) {
      const i = Math.round((y - ymin) / step);
      if (i >= 0 && i <= N && z > rows[i]) rows[i] = z;
    }
    const mx = Math.max(...rows) || 1;
    const sm = rows.map((v, i) => ((rows[i-1] ?? v) + v + (rows[i+1] ?? v)) / 3);
    let bumps = 0, peak = 0;
    for (let i = 1; i < sm.length - 1; i++) {
      if (sm[i] > sm[i-1] + mx*0.05 && sm[i] > sm[i+1] + mx*0.05 && sm[i] > mx*0.55) bumps++;
      if (sm[i] > sm[peak]) peak = i;
    }
    return { f, bumps, mx, peak: peak / N };
  };

  for (const cal of [60000, 250000, 800000]) {
    const r = profileOf(cal);
    t('живот — единая капля (стадия ' + r.f.stage + ')', r.bumps === 0,
      'лишних выступов=' + r.bumps);
    t('пик выноса в нижней половине (ст. ' + r.f.stage + ')',
      r.peak > 0.25 && r.peak < 0.60, 'пик на ' + (r.peak*100).toFixed(0) + '% снизу');
  }

  // Пропорции с референсов: живот доминирует над головой и шире плеч
  const big = profileOf(250000).f;
  const pos = big.mesh.geometry.attributes.position.array;
  const part = big.mesh.geometry.attributes.part.array;
  const w = {};
  for (let v = 0; v < big.vertexCount; v++) {
    const p = part[v] | 0;
    const r = Math.hypot(pos[v*3], pos[v*3+2]);
    if (!w[p] || r > w[p]) w[p] = r;
  }
  t('живот в разы больше головы', w[0] / w[3] > 3.5,
    (w[0] / w[3]).toFixed(1) + 'x');
  t('живот шире плеч', w[0] / w[5] > 1.5, (w[0] / w[5]).toFixed(1) + 'x');
}

console.log('\nВСЕГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
