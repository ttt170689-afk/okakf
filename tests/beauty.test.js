/**
 * beauty.test.js — КРАСОТА МЕША НА ПОЗДНИХ СТАДИЯХ.
 *
 * Ловит то, из-за чего тело выглядело уродливым:
 *   1. Асимметрия — половины расходились до 2.4 м.
 *   2. Изломы силуэта — рёбра с углом >70° между гранями.
 *   3. Лицо, раздувающееся вместе с тушей.
 *   4. Щели на швах и вершины, съехавшие с оси симметрии.
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
for (const m of ['utils', 'config', 'physics', 'lifesystems', 'emotions',
                 'massphysics', 'furry']) require('../src/' + m + '.js');

const FF = global.FF;
let pass = 0, fail = 0;
const t = (n, c, extra) => { c ? (pass++, console.log('  ✓', n, extra || ''))
                               : (fail++, console.log('  ✗', n, extra || '')); };
const audio = { squish(){}, jiggle(){}, slap(){}, voice(){}, step(){}, bubble(){},
                noise(){}, setAmbience(){}, ui(){}, growth(){}, poke(){} };
const dt = 1 / 60;
const TH = FF.CONFIG.growth.stageThresholds;
const scene = new THREE.Scene();

const mk = (st) => {
  const f = new FF.FurryEngine(scene,
    { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
  f.calories = TH[st] + 1; f._updateGrowthTargets(true); f.root.position.set(0, 0, 0);
  for (let i = 0; i < 60; i++) f.update(dt, 12);
  f.root.updateMatrixWorld(true); f.mesh.updateMatrixWorld(true);
  return f;
};

/** Максимальное и среднее расхождение зеркальных вершин, метры */
function asymmetry(f) {
  const pos = f.mesh.geometry.attributes.position.array, base = f.basePos;
  const q = (v) => Math.round(v * 1000);
  const key = new Map();
  for (let v = 0; v < f.vertexCount; v++) {
    const i = v * 3;
    key.set(q(base[i]) + '_' + q(base[i + 1]) + '_' + q(base[i + 2]), v);
  }
  let sum = 0, cnt = 0, max = 0;
  for (let v = 0; v < f.vertexCount; v++) {
    const i = v * 3;
    if (base[i] <= 0.0005) continue;
    const m = key.get(q(-base[i]) + '_' + q(base[i + 1]) + '_' + q(base[i + 2]));
    if (m === undefined) continue;
    const j = m * 3;
    const d = Math.hypot(pos[i] + pos[j], pos[i + 1] - pos[j + 1],
                         pos[i + 2] - pos[j + 2]) * f.bodyScale;
    sum += d; cnt++; if (d > max) max = d;
  }
  return { avg: cnt ? sum / cnt : 0, max, pairs: cnt };
}

/** Сколько рёбер образуют излом круче porog градусов */
function kinks(f, porog) {
  const pos = f.mesh.geometry.attributes.position.array;
  const idx = f.mesh.geometry.index.array;
  const fn = [];
  for (let tr = 0; tr < idx.length; tr += 3) {
    const a = idx[tr] * 3, b = idx[tr + 1] * 3, c = idx[tr + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    fn.push([nx / l, ny / l, nz / l]);
  }
  const em = new Map();
  for (let tr = 0; tr < idx.length; tr += 3) {
    const fi = tr / 3, vs = [idx[tr], idx[tr + 1], idx[tr + 2]];
    for (let k = 0; k < 3; k++) {
      const a = vs[k], b = vs[(k + 1) % 3];
      const key = Math.min(a, b) + '_' + Math.max(a, b);
      let l = em.get(key); if (!l) { l = []; em.set(key, l); }
      l.push(fi);
    }
  }
  let n = 0, sum = 0, cnt = 0;
  for (const l of em.values()) {
    if (l.length !== 2) continue;
    const p = fn[l[0]], r = fn[l[1]];
    const d = Math.abs(p[0] * r[0] + p[1] * r[1] + p[2] * r[2]);
    const ang = Math.acos(Math.min(1, d)) * 180 / Math.PI;
    sum += ang; cnt++;
    if (ang > porog) n++;
  }
  return { count: n, avg: cnt ? sum / cnt : 0 };
}

console.log('=== 1. СИММЕТРИЯ (левая половина = зеркало правой) ===');
{
  for (const st of [5, 10, 15, 20, 30]) {
    const f = mk(st);
    const a = asymmetry(f);
    t('ст.' + st + ': средняя асимметрия < 1 см', a.avg < 0.01,
      (a.avg * 100).toFixed(2) + ' см (' + a.pairs + ' пар)');
    t('ст.' + st + ': нет грубого перекоса (макс < 15 см)', a.max < 0.15,
      (a.max * 100).toFixed(1) + ' см');
    scene.remove(f.root);
  }
}

console.log('=== 2. ОСЕВАЯ ЛИНИЯ НЕ ГУЛЯЕТ ===');
{
  const f = mk(20);
  const pos = f.mesh.geometry.attributes.position.array;
  let worst = 0, n = 0;
  for (let k = 0; k < f.centerLine.length; k++) {
    const v = f.centerLine[k];
    const d = Math.abs(pos[v * 3]) * f.bodyScale;
    n++; if (d > worst) worst = d;
  }
  t('осевые вершины строго на оси', worst < 0.005,
    n + ' вершин, макс. отклонение ' + (worst * 100).toFixed(2) + ' см');
  t('осевая линия не пуста', n > 100, n + ' вершин');
  scene.remove(f.root);
}

console.log('=== 3. ГЛАДКОСТЬ СИЛУЭТА ===');
{
  const base = kinks(mk(5), 70);
  for (const st of [10, 20, 30]) {
    const f = mk(st);
    const k = kinks(f, 70);
    // Изломов не должно быть кратно больше, чем у обычного толстяка
    t('ст.' + st + ': силуэт не корявее базового более чем вдвое',
      k.count < base.count * 2.2,
      k.count + ' изломов против ' + base.count + ' на ст.5');
    t('ст.' + st + ': средний угол между гранями < 15°', k.avg < 15,
      k.avg.toFixed(1) + '°');
    scene.remove(f.root);
  }
}

console.log('=== 4. ЛИЦО НЕ РАЗДУВАЕТСЯ ВМЕСТЕ С ТЕЛОМ ===');
{
  const small = mk(0), big = mk(30);
  const eyeSize = (f) => {
    const s = f.eyes[0].getWorldScale(new THREE.Vector3());
    return 0.052 * s.x;
  };
  const gap = (f) => {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    f.eyes[0].getWorldPosition(a); f.eyes[1].getWorldPosition(b);
    return a.distanceTo(b);
  };
  const grow = eyeSize(big) / eyeSize(small);
  const bodyGrow = big.bodyScale / small.bodyScale;
  t('глаз растёт заметно медленнее тела', grow < bodyGrow * 0.5,
    'глаз ×' + grow.toFixed(2) + ' при теле ×' + bodyGrow.toFixed(2));
  t('глаз не превращается в блюдце', eyeSize(big) < 0.12,
    (eyeSize(big) * 100).toFixed(1) + ' см');
  t('межглазье не разъезжается', gap(big) < gap(small) * 2.5,
    (gap(small)).toFixed(2) + ' → ' + (gap(big)).toFixed(2) + ' м');
  t('faceScale активен и меньше единицы', big.faceScale < 0.6,
    big.faceScale.toFixed(3));

  // Черты обязаны сидеть на морде, а не висеть рядом
  for (const f of [small, big]) {
    const pa = f.mesh.geometry.attributes.part.array;
    const pos = f.mesh.geometry.attributes.position.array;
    const bs = f.bodyScale;
    let zmax = -Infinity;
    for (let v = 0; v < f.vertexCount; v++) {
      if ((pa[v] | 0) !== 3) continue;
      const z = pos[v * 3 + 2] * bs; if (z > zmax) zmax = z;
    }
    let y0 = Infinity, y1 = -Infinity;
    for (let v = 0; v < f.vertexCount; v++) {
      if ((pa[v] | 0) !== 3) continue;
      const i = v * 3;
      if (pos[i + 2] * bs < zmax * 0.45) continue;
      const y = pos[i + 1] * bs;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const ey = f.eyes[0].getWorldPosition(new THREE.Vector3()).y;
    const ny = f.nose.getWorldPosition(new THREE.Vector3()).y;
    t('ст.' + f.stage + ': глаза в пределах морды по высоте',
      ey >= y0 - 0.05 && ey <= y1 + 0.05,
      'глаз ' + ey.toFixed(2) + ' в [' + y0.toFixed(2) + ',' + y1.toFixed(2) + ']');
    t('ст.' + f.stage + ': нос ниже глаз (лицо не перевёрнуто)', ny < ey);
  }
  scene.remove(small.root); scene.remove(big.root);
}

console.log('=== 5. ОБОЛОЧКА ЦЕЛАЯ (симметрия не рвёт швы) ===');
{
  for (const st of [10, 20, 30]) {
    const f = mk(st);
    const pos = f.mesh.geometry.attributes.position.array;
    const w = f._weld;
    let max = 0;
    for (let i = 0; i < w.length;) {
      const n = w[i++];
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < n; k++) {
        const v = w[i + k] * 3;
        x0 = Math.min(x0, pos[v]); x1 = Math.max(x1, pos[v]);
        y0 = Math.min(y0, pos[v + 1]); y1 = Math.max(y1, pos[v + 1]);
        z0 = Math.min(z0, pos[v + 2]); z1 = Math.max(z1, pos[v + 2]);
      }
      const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      if (d > max) max = d;
      i += n;
    }
    t('ст.' + st + ': швы без щелей', max < 0.001, 'макс ' + max.toFixed(5));
    scene.remove(f.root);
  }
}

console.log('\nВСЕГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
