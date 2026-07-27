/**
 * stages.test.js — 8 СТАДИЙ ЛИЧНОСТИ + ЗАСАСЫВАНИЕ В ЖИВОТ.
 *
 * Проверяем три обещания из ТЗ:
 *   1. Восемь стадий формы/характера, границы ровно по уровням.
 *   2. Характер реально меняется: стройный энергичен, легендарный блажен.
 *   3. Кокон доступен с ур. 8+, скорость и глубина зависят от стадии,
 *      выйти можно всегда четырьмя способами.
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
                 'furry', 'world', 'hands', 'player', 'playerbody', 'bodyspots', 'cocoon'])
  require('../src/' + m + '.js');

const FF = global.FF;
let pass = 0, fail = 0;
const t = (n, c, extra) => { c ? (pass++, console.log('  ✓', n, extra || ''))
                               : (fail++, console.log('  ✗', n, extra || '')); };
const audio = { squish(){}, jiggle(){}, slap(){}, voice(){}, step(){}, bubble(){},
                noise(){}, setAmbience(){}, ui(){}, growth(){}, poke(){} };
const dt = 1 / 60;
const TH = FF.CONFIG.growth.stageThresholds;

const mk = (scene, st) => {
  const f = new FF.FurryEngine(scene,
    { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
  f.calories = TH[st] + 1; f._updateGrowthTargets(true); f.root.position.set(0, 0, 0);
  for (let i = 0; i < 40; i++) f.update(dt, 12);
  return f;
};

console.log('=== 1. ВОСЕМЬ СТАДИЙ, ГРАНИЦЫ ПО ТЗ ===');
{
  const list = FF.CONFIG.growth.personaStages;
  t('стадий ровно 8', list.length === 8, list.length + ' шт');

  // Границы из таблицы ТЗ: 1-2, 3-4, 5-7, 8-9, 10-12, 13-15, 16-19, 20+
  const want = [
    ['slim', 0, 1], ['chubby', 2, 4], ['fat', 5, 7], ['very_fat', 8, 9],
    ['obese', 10, 12], ['huge', 13, 15], ['colossal', 16, 19], ['legendary', 20, 100],
  ];
  let okB = 0;
  want.forEach(([id, from, to], i) => {
    const p = list[i];
    if (p && p.id === id && p.from === from && p.to === to) okB++;
  });
  t('границы стадий совпадают с ТЗ', okB === 8, okB + '/8');

  // Диапазоны не рвутся и не перекрываются
  let seam = true;
  for (let i = 1; i < list.length; i++) if (list[i].from !== list[i - 1].to + 1) seam = false;
  t('диапазоны состыкованы без дыр', seam);

  const scene = new THREE.Scene();
  const seen = new Set();
  for (const st of [0, 1, 2, 4, 5, 7, 8, 9, 10, 12, 13, 15, 16, 19, 20, 30]) {
    const f = mk(scene, st);
    const p = f.emotions.persona();
    seen.add(p.id);
    scene.remove(f.root);
  }
  t('все 8 характеров достижимы ростом', seen.size === 8, [...seen].join(', '));
}

console.log('=== 2. ХАРАКТЕР МЕНЯЕТСЯ СО СТАДИЕЙ ===');
{
  const scene = new THREE.Scene();
  const settle = (st) => {
    const f = mk(scene, st);
    for (let i = 0; i < 60 * 60; i++) f.emotions.update(dt);
    const e = Object.assign({}, f.emotions.e);
    e._tempo = f.emotions.persona().tempo;
    scene.remove(f.root);
    return e;
  };
  const slim = settle(0), fat = settle(6), leg = settle(22);

  t('стройный энергичнее легендарного',
    slim.excitement > leg.excitement + 20,
    slim.excitement.toFixed(0) + ' vs ' + leg.excitement.toFixed(0));
  t('легендарный спокойнее и уютнее',
    leg.comfort > slim.comfort + 20,
    leg.comfort.toFixed(0) + ' vs ' + slim.comfort.toFixed(0));
  t('легендарный сонливее стройного',
    leg.sleepiness > slim.sleepiness,
    leg.sleepiness.toFixed(0) + ' vs ' + slim.sleepiness.toFixed(0));
  t('привязанность растёт с телом',
    leg.love > slim.love + 15,
    slim.love.toFixed(0) + ' -> ' + leg.love.toFixed(0));
  t('толстяк — посередине по возбуждению',
    fat.excitement < slim.excitement && fat.excitement > leg.excitement - 1,
    fat.excitement.toFixed(0));
  t('темп движений замедляется с ростом',
    slim._tempo > fat._tempo && fat._tempo > leg._tempo,
    slim._tempo + ' > ' + fat._tempo + ' > ' + leg._tempo);
}

console.log('=== 3. ЗАСАСЫВАНИЕ ДОСТУПНО ТОЛЬКО С УР. 8+ ===');
{
  const scene = new THREE.Scene();
  const world = new FF.World(scene, { shadowMap:{}, capabilities:{} }, audio);
  const build = (st) => {
    const f = mk(scene, st);
    const cam = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
    const player = new FF.PlayerController(cam, world, f, audio);
    const game = { scene, furry: f, player, world, audio,
      notify(){}, achieve(){}, gameHours: 0,
      bodySpots: { state: 'lying', getUp() { this.state = null; } } };
    return { f, player, game, c: new FF.CocoonSystem(game) };
  };

  for (const st of [0, 3, 5, 7]) {
    const o = build(st);
    t('ст.' + st + ': кокон недоступен', o.c.absorbCfg() === null && !o.c.canStart());
  }
  for (const st of [8, 11, 14, 17, 21]) {
    const o = build(st);
    t('ст.' + st + ': кокон доступен', !!o.c.absorbCfg() && o.c.canStart());
  }

  // Задержки строго по ТЗ: 30 / 20 / 15 / 10 / 5
  const want = { 8: 30, 9: 30, 10: 20, 12: 20, 13: 15, 15: 15, 16: 10, 19: 10, 20: 5, 25: 5 };
  let okD = 0, total = 0;
  for (const st in want) {
    total++;
    const o = build(+st);
    if (o.c.delay() === want[st]) okD++;
  }
  t('скорость активации по стадиям (30→20→15→10→5)', okD === total, okD + '/' + total);

  // Глубина растёт со стадией
  const d8 = build(8).c.absorbCfg().depth;
  const d11 = build(11).c.absorbCfg().depth;
  const d14 = build(14).c.absorbCfg().depth;
  t('глубина погружения растёт со стадией',
    d8 < d11 && d11 <= d14 && d14 === 1,
    d8 + ' < ' + d11 + ' <= ' + d14);
  t('на ст.8 погружение частичное (не с головой)', d8 < 0.8, (d8 * 100).toFixed(0) + '%');

  // Мистика только на легендарной
  t('особый режим с колоссальной', build(17).c.absorbCfg().special === true);
  t('мистический — только легендарная',
    build(21).c.absorbCfg().mystical === true && !build(14).c.absorbCfg().mystical);
}

console.log('=== 4. ЧЕТЫРЕ ФАЗЫ И ЧЕТЫРЕ ВЫХОДА ===');
{
  const scene = new THREE.Scene();
  const world = new FF.World(scene, { shadowMap:{}, capabilities:{} }, audio);
  const build = (st) => {
    const f = mk(scene, st);
    const cam = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
    const player = new FF.PlayerController(cam, world, f, audio);
    const game = { scene, furry: f, player, world, audio,
      notify(){}, achieve(){}, gameHours: 0,
      bodySpots: { state: 'lying', getUp() { this.state = null; } } };
    return { f, player, game, c: new FF.CocoonSystem(game) };
  };
  // Легендарный: delay=5, полный кокон наступает за ~20 с — тест быстрый
  const deep = (o, sec) => { for (let i = 0; i < 60 * sec; i++) { o.c.update(dt); o.f.update(dt, 12); } };

  {
    const o = build(21);
    const phases = new Set();
    for (let i = 0; i < 60 * 40; i++) { o.c.update(dt); o.f.update(dt, 12); phases.add(o.c.phase); }
    t('пройдены все 4 фазы', phases.size === 4, [...phases].join(' -> '));
    t('достигнут полный кокон', o.c.depth > 0.9, (o.c.depth * 100).toFixed(0) + '%');
    t('рост друга ускорен вдвое', o.f.cocoonGrowthBoost === 2);
  }

  for (const [key, label] of [['KeyW', 'WASD'], ['KeyX', 'X'], ['KeyF', 'F']]) {
    const o = build(21);
    deep(o, 30);
    const before = o.c.depth;
    o.player.keys[key] = true;
    o.c.update(dt);
    t('выход через ' + label, before > 0.5 && o.c.depth < 0.05 && !o.c.active,
      (before * 100).toFixed(0) + '% -> ' + (o.c.depth * 100).toFixed(0) + '%');
  }
  {
    const o = build(21);
    deep(o, 30);
    o.c.release('morning');
    t('выход «досмотреть до утра»', o.c.depth < 0.05 && !o.c.active);
    t('буст роста снят после выхода', o.f.cocoonGrowthBoost === 1);
    t('выдан бонус «Тёплый сон»', o.player.warmSleepTimer > 0,
      o.player.warmSleepTimer + ' с');
  }
  {
    const o = build(21);
    deep(o, 30);
    t('управление НЕ блокируется (это уют, не хоррор)', o.player.frozen === false);
    t('подсказка о выходе показана', /X|F|WASD/.test(o.c.hint() || ''));
  }
  {
    // Ушёл с тела — кокон обязан отпустить сам
    const o = build(21);
    deep(o, 30);
    o.game.bodySpots.state = null;
    for (let i = 0; i < 60 * 3; i++) { o.c.update(dt); o.f.update(dt, 12); }
    t('встал с тела — кокон отпускает', o.c.depth < 0.05 && !o.c.active);
  }
}


/* ============================================================
 * 5. СВЕРХБОЛЬШИЕ ЧИСЛА (уровень до 9 999 999, запасы, почта)
 * ------------------------------------------------------------
 * Главная опасность тут — не логика, а предел точности JS:
 * за Number.MAX_SAFE_INTEGER выражение x+1 === x, и счётчики
 * молча замирают. Эти проверки ловят такое переполнение.
 * ============================================================ */
console.log('=== 5. СВЕРХБОЛЬШИЕ ЧИСЛА ===');
{
  const G = FF.CONFIG.growth;
  const MAX = Number.MAX_SAFE_INTEGER;

  t('потолок стадий = 9 999 999', G.maxStage === 9999999, String(G.maxStage));
  t('порог считается функцией, а не массивом', typeof G.stageCalories === 'function');
  t('имя стадии считается функцией', typeof G.stageName === 'function');

  const last = G.stageCalories(G.maxStage);
  t('порог последней стадии в пределах точности', last < MAX,
    last.toExponential(2) + ' против ' + MAX.toExponential(2));
  t('порог последней стадии конечен', isFinite(last) && last > 0);

  // Пороги обязаны строго расти — иначе стадии «слипнутся»
  let mono = true, prev = -1, bad = -1;
  for (let i = 0; i <= G.maxStage; i += 1009) {
    const v = G.stageCalories(i);
    if (!(v > prev)) { mono = false; bad = i; break; }
    prev = v;
  }
  t('пороги строго растут на всём диапазоне', mono,
    mono ? 'проверено ~9910 точек' : 'сбой на стадии ' + bad);

  // Соседние стадии не должны совпадать по порогу (признак переполнения)
  let dupes = 0;
  for (const i of [100, 5000, 100000, 1000000, 9999998]) {
    if (G.stageCalories(i + 1) <= G.stageCalories(i)) dupes++;
  }
  t('соседние стадии различимы', dupes === 0, dupes + ' совпадений');

  // Имена не должны отваливаться в undefined за пределами старого массива
  let named = 0;
  const probes = [0, 10, 11, 100, 101, 5000, 999999, 9999999];
  for (const i of probes) {
    const n = G.stageName(i);
    if (typeof n === 'string' && n.length > 0 && !/undefined/.test(n)) named++;
  }
  t('имя есть у любой стадии', named === probes.length, named + '/' + probes.length);
  t('финальная стадия — Сфера Бытия', /Сфера Бытия/.test(G.stageName(9999999)),
    G.stageName(9999999));

  // Движок должен реально доводить друга до заявленных стадий
  const scene5 = new THREE.Scene();
  let reached = 0;
  const targets = [10, 100, 5000, 1000000, 9999999];
  for (const st of targets) {
    const f = new FF.FurryEngine(scene5,
      { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio);
    f.calories = G.stageCalories(st);
    f._updateGrowthTargets(true);
    if (f.stage === st) reached++;
    scene5.remove(f.root);
  }
  t('движок достигает больших стадий', reached === targets.length,
    reached + '/' + targets.length);

  // Запасы склада
  const BIG = FF.CONFIG.bigStack;
  t('bigStack задан', typeof BIG === 'number' && BIG > 1e12, String(BIG));
  t('bigStack не переполняет точность', BIG < MAX);
  t('счётчик запаса реально уменьшается', BIG - 1 !== BIG,
    'иначе покупки не списывались бы');

  // Формат больших чисел
  t('U.fmt переваривает триллионы', /трлн/.test(FF.U.fmt(7e12)), FF.U.fmt(7e12));
  t('U.fmt переваривает квадриллионы', /квадр/.test(FF.U.fmt(2e15)), FF.U.fmt(2e15));
}

console.log('=== 6. ПРЫЖОК НА ДРУГЕ ОТКЛЮЧЁН ===');
{
  t('флаг батута выключен', FF.CONFIG.player.bellyTrampoline === false);
  // Механика «Попрыгать» из меню должна остаться доступной
  const acts = FF.BODY_SPOTS ? null : null;
  t('bounce() у друга сохранён', typeof (new FF.FurryEngine(new THREE.Scene(),
    { species:'fox', build:'pear', furColor:1, eyeColor:1, name:'M' }, audio).bounce) === 'function',
    'нужен для действия «Попрыгать» (E)');
}

console.log('\nВСЕГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
