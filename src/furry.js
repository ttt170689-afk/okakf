/**
 * furry.js — FurryEngine
 * Главный модуль персонажа: процедурная геометрия, 60 зон роста,
 * soft-body симуляция (пружинно-массовая модель на узлах зон),
 * шейдеры кожи (SSS + stress + wet + fur), эмоции, голос, анимация.
 *
 * Архитектура:
 *   Слой 1 «Скелет»  — статические якоря зон (кости)
 *   Слой 2 «Мышцы»   — упругая база (pose matching)
 *   Слой 3 «Жир»     — динамические смещения узлов (soft bodies)
 *   Слой 4 «Кожа»    — меш, деформируемый весами зон
 *   Слой 5 «Шерсть»  — шейдерный слой + инстансы шерстинок
 *
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  /**
   * АНАТОМИЧЕСКАЯ КАРТА ПРИВЯЗКИ.
   *
   * part-id меша -> какие ГРУППЫ зон вправе им управлять.
   *
   * Зоны влияют на вершины по радиусу, но радиус большой зоны (у живота он
   * 0.7 м и растёт со стадией) физически дотягивается до головы, рук и ног.
   * Раньше это давало артефакт: у вершин макушки единственным «дотянувшимся»
   * узлом был mid_belly, после нормировки он получал вес 1.0 и уносил морду
   * вперёд вместе с животом — на скриншоте это выглядело как осколки у лица.
   *
   * Карта запрещает такие связи: голова слушает только лицо/шею, ноги — ноги
   * и бёдра, и т.д. Туловище (part 0) слушает всё — там переходы должны
   * оставаться плавными.
   */
  const PART_ZONES = {
    0: null,                                                   // торс — без ограничений
    1: { glutes: 1, thighs: 1, belly: 1, legs: 1, back: 1, misc: 1 },  // таз
    2: { chest: 1, belly: 1, back: 1, arms: 1, neck: 1 },      // грудь
    3: { face: 1, neck: 1 },                                   // голова и морда
    4: { neck: 1, face: 1, chest: 1, back: 1 },                // шея
    5: { arms: 1, chest: 1, back: 1 },                         // руки
    6: { legs: 1, thighs: 1, glutes: 1, misc: 1 },             // ноги
    7: { face: 1, neck: 1 },                                   // уши
    8: { misc: 1, glutes: 1, back: 1, thighs: 1 },             // хвост
  };

  // Временные векторы: физика в горячем цикле не должна плодить мусор
  const _tmpAccelA = new THREE.Vector3();
  const _tmpAccelB = new THREE.Vector3();
  const _tmpWaveA = new THREE.Vector3();
  const _tmpDisp = new THREE.Vector3();

  /**
   * Узел мягкого тела — одна из 60 зон.
   *
   * v2.0 «God-Tier»: вместо одной пружины зона моделируется тремя слоями
   * жира. Глубокий слой плотный и медленный (держит форму), средний —
   * упругий, поверхностный — почти желе: именно он даёт остаточную дрожь
   * после того, как тело остановилось.
   *
   *   deep ──сила──> medium ──сила──> superficial
   *
   * Итоговое смещение — сумма трёх слоёв, поэтому движение получается
   * не «одним мешком», а с внутренним запаздыванием, как настоящая плоть.
   */
  class SoftNode {
    constructor(zone, index) {
      this.zone = zone;
      this.index = index;
      this.base = new THREE.Vector3().fromArray(zone.pos);
      this.dir = new THREE.Vector3().fromArray(zone.dir).normalize();
      this.offset = new THREE.Vector3();   // суммарное смещение (для совместимости)
      this.vel = new THREE.Vector3();      // скорость глубокого слоя (вход импульсов)
      this.dent = new THREE.Vector3();     // вмятина от касания
      this.dentVel = new THREE.Vector3();
      this.growth = 0;                     // 0..1 визуальный рост
      this.growthTarget = 0;
      this.calories = 0;                   // накоплено в зоне
      this.heat = 0;                       // «нагрев» от массажа/трения
      this.mass = zone.mass;
      this.soft = zone.soft;
      this.damp = zone.damp;

      /* --- Профиль поведения (см. ZONE_PHYSICS в config.js) --- */
      this.jiggleK = zone.jiggle !== undefined ? zone.jiggle : 0.5;
      this.sagK = zone.sag !== undefined ? zone.sag : 0.3;
      this.pendK = zone.pend !== undefined ? zone.pend : 0.4;
      this.microK = zone.micro !== undefined ? zone.micro : 0.5;
      this.breathK = zone.breath !== undefined ? zone.breath : 0;
      this.layerCount = zone.layers || 2;

      /* --- Слои жира --- */
      const LC = FF.CONFIG.soft.layers;
      this.layers = [];
      const names = ['deep', 'medium', 'superficial'];
      for (let i = 0; i < this.layerCount; i++) {
        const c = LC[names[i]];
        this.layers.push({
          cfg: c,
          pos: new THREE.Vector3(),
          vel: new THREE.Vector3(),
        });
      }
      // Нормировка амплитуд, чтобы 1-, 2- и 3-слойные зоны были соизмеримы
      let ampSum = 0;
      for (const l of this.layers) ampSum += l.cfg.amp;
      this.ampNorm = ampSum > 0 ? 1 / ampSum : 1;

      this.microPhase = Math.random() * Math.PI * 2;   // своя фаза микро-дрожи
      this.settle = 0;        // «оседание» жира при долгом стоянии
      this.sweat = 0;         // испарина в складке
      this.contactPress = 0;  // давление от соседней зоны (self-collision)
    }

    /** Импульс по мягкому телу (тычок, шлепок, шаг) */
    impulse(vec, strength) {
      const k = strength / Math.max(3, this.mass);
      // Импульс приходит в глубокий слой и дальше расходится вверх по слоям
      this.layers[0].vel.addScaledVector(vec, k);
      for (let i = 1; i < this.layers.length; i++) {
        this.layers[i].vel.addScaledVector(vec, k * (1 + i * 0.45) * this.jiggleK);
      }
      this.vel.addScaledVector(vec, k);
    }

    /** Вмятина в точке касания */
    press(dirVec, depth) {
      this.dentVel.addScaledVector(dirVec, depth * this.soft * 1.6);
      this.heat = Math.min(1, this.heat + depth * 0.4);
    }

    /**
     * Шаг симуляции.
     * @param {number} dt
     * @param {number} gravitySag глобальный множитель провисания
     * @param {object} ctx контекст тела: ускорение, микро-дрожь, дыхание
     */
    step(dt, gravitySag, ctx) {
      const S = FF.CONFIG.soft;
      const g = this.growth;
      const soft = this.soft;

      // Насколько зона «налита» — пустая зона почти не колышется
      const fill = 0.12 + g * 0.88;

      /* --- Слои жира --- */
      let sumX = 0, sumY = 0, sumZ = 0;
      for (let i = 0; i < this.layers.length; i++) {
        const L = this.layers[i];
        const c = L.cfg;

        // Пружина к покою: жёсткость падает с мягкостью зоны,
        // adaptive stiffness — уставший/осевший жир держит хуже
        const stiff = (26 * (1.15 - soft) + 5) * c.stiffness * (1 - this.settle * 0.25);
        L.vel.addScaledVector(L.pos, -stiff * dt);

        // Гравитация: анизотропна — своя для каждой зоны (sag из профиля).
        // Загривок/плечи/полка над попой имеют sag=0 и не провисают вовсе.
        L.vel.y -= gravitySag * g * soft * this.sagK * c.amp * dt * 6.4;

        // Инерция тела: маятниковость. Зона отстаёт от корпуса,
        // поэтому при ходьбе живот и грудь раскачиваются.
        if (ctx.accel) {
          const p = this.pendK * fill * c.amp * dt * 2.6;
          L.vel.x -= ctx.accel.x * p;
          L.vel.y -= ctx.accel.y * p * 0.7;
          L.vel.z -= ctx.accel.z * p;
        }

        // Затухание. Поверхностный слой затухает медленнее => «дрожь вслед».
        const damping = (5.5 + this.damp * 22) * c.damping
          * (1 - S.momentumTrail * 0.45 * this.jiggleK);
        L.vel.multiplyScalar(Math.exp(-damping * dt * (1.0 - soft * 0.45)));

        L.pos.addScaledVector(L.vel, dt);

        // Ограничение амплитуды слоя
        const maxL = S.maxOffset * (0.35 + g) * c.amp * 1.6;
        if (L.pos.lengthSq() > maxL * maxL) L.pos.setLength(maxL);

        sumX += L.pos.x * c.amp; sumY += L.pos.y * c.amp; sumZ += L.pos.z * c.amp;
      }

      // Передача силы между слоями: глубокий тянет за собой верхние
      const tr = S.layerTransfer * dt * 12;
      for (let i = 0; i < this.layers.length - 1; i++) {
        const a = this.layers[i], b = this.layers[i + 1];
        b.vel.x += (a.vel.x - b.vel.x) * tr;
        b.vel.y += (a.vel.y - b.vel.y) * tr;
        b.vel.z += (a.vel.z - b.vel.z) * tr;
      }

      // Сумма слоёв — итоговое динамическое смещение
      const n = this.ampNorm;
      this.offset.set(sumX * n, sumY * n, sumZ * n);
      this.vel.copy(this.layers[0].vel);

      /* --- Микро-жизнь: тело не замирает даже в покое --- */
      if (ctx.micro && g > 0.02) {
        this.microPhase += dt * (1.6 + this.index * 0.017);
        const m = S.microJiggle * this.microK * fill;
        this.offset.y += Math.sin(this.microPhase) * m;
        this.offset.x += Math.sin(this.microPhase * 0.7 + 1.3) * m * 0.5;
        // Пульс сердца — общая для тела фаза, видна на больших массах
        this.offset.y += ctx.heartbeat * S.heartbeatAmp * fill * this.microK;
      }

      /* --- Дыхание: грудь и живот поднимаются заметнее прочих --- */
      if (this.breathK > 0) {
        this.offset.z += ctx.breath * this.breathK * (0.02 + g * 0.055);
        this.offset.y += ctx.breath * this.breathK * (0.01 + g * 0.02);
      }

      // Вмятина восстанавливается своей пружиной (быстрее)
      this.dentVel.addScaledVector(this.dent, -60 * dt);
      this.dentVel.multiplyScalar(Math.exp(-9 * dt));
      this.dent.addScaledVector(this.dentVel, dt);
      const maxDent = 0.28 * (0.3 + g);
      if (this.dent.lengthSq() > maxDent * maxDent) this.dent.setLength(maxDent);

      /* --- Термодинамика: трущиеся складки нагреваются и потеют --- */
      if (this.zone.friction || this.zone.hot) {
        const rub = this.contactPress + Math.min(1, this.vel.length() * 0.35);
        this.heat = Math.min(1, this.heat + rub * g * S.thermalRate * dt);
      }
      this.heat = Math.max(0, this.heat - dt * S.thermalCool);
      const wantSweat = this.heat > S.sweatThreshold ? (this.heat - S.sweatThreshold) * 2.2 : 0;
      this.sweat = U.damp(this.sweat, Math.min(1, wantSweat) * g, 1.5, dt);
      this.contactPress = Math.max(0, this.contactPress - dt * 4);

      this.growth = U.damp(this.growth, this.growthTarget, FF.CONFIG.growth.lerpSpeed, dt);
    }

    /** Итоговое смещение точки зоны */
    displacement(out) {
      const g = this.growth;
      const gain = this.zone.gain;
      // Оседание: при долгом стоянии жир немного сползает вниз
      const set = this.settle * this.sagK * g * 0.06;
      return out.copy(this.dir).multiplyScalar(gain * g)
        .add(this.offset)
        .add(this.dent)
        .setY(out.y - set);
    }
  }

  /* ============================================================
   * Шейдер кожи: SSS-имитация + stress + wet + fur-грейн
   * ============================================================ */
  const SKIN_VERT_PARS = `
    attribute float part;
    attribute float stretch;
    attribute float heat;        // нагрев зоны (трение складок)
    attribute float sweat;       // испарина
    attribute float cellulite;   // предрасположенность зоны к целлюлиту
    varying float vStretch;
    varying float vPart;
    varying float vHeat;
    varying float vSweat;
    varying float vCell;
    varying vec3 vLocalPos;
  `;
  const SKIN_VERT_MAIN = `
    vStretch = stretch;
    vPart = part;
    vHeat = heat;
    vSweat = sweat;
    vCell = cellulite;
    vLocalPos = position;
  `;
  const SKIN_FRAG_PARS = `
    uniform vec3 uFurColor;
    uniform vec3 uBellyColor;
    uniform float uWet;
    uniform float uFurDensity;
    uniform float uBlush;
    uniform float uTime;
    uniform float uGoose;   // мурашки от нежных касаний
    uniform float uFog;     // запотевание складок (Under-Belly)
    varying float vStretch;
    varying float vPart;
    varying float vHeat;
    varying float vSweat;
    varying float vCell;
    varying vec3 vLocalPos;

    // Хеш-шум для шерстяного грейна
    float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
    float noise(vec3 p){
      vec3 i = floor(p), f = fract(p);
      f = f*f*(3.0-2.0*f);
      float n = mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                        mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                    mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                        mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
      return n;
    }
  `;
  const SKIN_FRAG_COLOR = `
    // Шерсть vs брюшко: брюшко светлее спереди и снизу
    float bellyMask = smoothstep(0.05, 0.55, vLocalPos.z) * (1.0 - smoothstep(1.75, 2.05, vLocalPos.y));
    vec3 baseCol = mix(uFurColor, uBellyColor, clamp(bellyMask, 0.0, 1.0));

    // Шерстяной грейн (микро-волокна)
    float fur = noise(vLocalPos * (26.0 * uFurDensity));
    float fur2 = noise(vLocalPos * (95.0 * uFurDensity) + 3.1);
    baseCol *= 0.86 + 0.20 * fur + 0.08 * fur2;

    // Растяжение: кожа розовеет, шерсть редеет, появляется блеск
    float st = clamp(vStretch, 0.0, 1.0);
    // Кожа розовеет и лоснится только на СИЛЬНО растянутых участках,
    // и только частично — окрас вида должен оставаться узнаваемым.
    vec3 stretched = mix(baseCol, mix(baseCol, vec3(1.0, 0.74, 0.72), 0.6), st);
    baseCol = mix(baseCol, stretched, smoothstep(0.55, 1.0, st) * 0.6);
    // Складки: затемнение во впадинах по шуму — придаёт объём массе
    float crease = noise(vLocalPos * 7.0 + 11.0);
    baseCol *= 0.82 + 0.24 * crease;

    // Румянец (эмоция смущения)
    baseCol = mix(baseCol, baseCol * vec3(1.25, 0.86, 0.9), uBlush * bellyMask * 0.5);

    /* --- ЦЕЛЛЮЛИТ ---
     * Ямочки в мягких зонах (бёдра, ягодицы). Двухчастотный шум даёт
     * характерную «апельсиновую корку», проявляется только с массой. */
    float cellAmt = vCell * smoothstep(0.15, 0.75, st);
    if (cellAmt > 0.001) {
      float c1 = noise(vLocalPos * 34.0);
      float c2 = noise(vLocalPos * 71.0 + 5.7);
      float dimple = smoothstep(0.42, 0.72, c1 * 0.68 + c2 * 0.32);
      baseCol *= 1.0 - dimple * cellAmt * 0.22;
    }

    /* --- ТЕПЛО ОТ ТРЕНИЯ ---
     * Натёртая складка краснеет: подмешиваем тёплый оттенок. */
    baseCol = mix(baseCol, baseCol * vec3(1.32, 0.74, 0.72), clamp(vHeat, 0.0, 1.0) * 0.55);

    /* --- МУРАШКИ ---
     * Мелкая пупырчатая рябь по коже от нежного прикосновения. */
    if (uGoose > 0.001) {
      float bump = noise(vLocalPos * 120.0);
      float goose = smoothstep(0.55, 0.85, bump) * uGoose;
      baseCol *= 1.0 + goose * 0.16;
    }

    /* --- ЗАПОТЕВАНИЕ СКЛАДОК ---
     * Долго сидишь под животом — воздух влажный, кожа туманится. */
    if (uFog > 0.001) {
      float depth = 1.0 - smoothstep(0.0, 0.6, vLocalPos.z);
      baseCol = mix(baseCol, baseCol * vec3(1.06, 1.02, 1.04) + vec3(0.05),
                    uFog * depth * 0.5);
    }

    diffuseColor.rgb *= baseCol;
  `;
  const SKIN_FRAG_ROUGH = `
    float st2 = clamp(vStretch, 0.0, 1.0);
    roughnessFactor = mix(roughnessFactor, 0.22, st2 * 0.7);
    roughnessFactor = mix(roughnessFactor, 0.12, uWet);
    // Пот в разогретых складках: локальный влажный блеск
    roughnessFactor = mix(roughnessFactor, 0.09, clamp(vSweat, 0.0, 1.0) * 0.85);
  `;
  const SKIN_FRAG_EMISSIVE = `
    // Дешёвая имитация SSS: тёплое подповерхностное свечение по краям
    float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
    totalEmissiveRadiance += vec3(0.42, 0.16, 0.14) * pow(rim, 2.4) * 0.30;
  `;

  function makeSkinMaterial(furColor, bellyColor) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.86, metalness: 0.0,
    });
    mat.userData.uniforms = {
      uFurColor: { value: new THREE.Color(furColor) },
      uBellyColor: { value: new THREE.Color(bellyColor) },
      uWet: { value: 0 },
      uFurDensity: { value: 1 },
      uBlush: { value: 0 },
      uTime: { value: 0 },
      uGoose: { value: 0 },
      uFog: { value: 0 },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, mat.userData.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + SKIN_VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SKIN_VERT_MAIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + SKIN_FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + SKIN_FRAG_COLOR)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + SKIN_FRAG_ROUGH)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + SKIN_FRAG_EMISSIVE);
      mat.userData.shader = shader;
    };
    return mat;
  }

  /* ============================================================
   * FurryEngine
   * ============================================================ */
  class FurryEngine {
    /**
     * @param {THREE.Scene} scene
     * @param {object} opts { species, furColor, eyeColor, name }
     * @param {FF.AudioEngine} audio
     */
    constructor(scene, opts, audio) {
      this.scene = scene;
      this.audio = audio;
      this.opts = Object.assign({ species: 'fox', furColor: null, eyeColor: 0x4aa3c7, name: 'Пушистик' }, opts);
      this.species = FF.SPECIES[this.opts.species] || FF.SPECIES.fox;
      this.build = FF.BUILDS[this.opts.build] || FF.BUILDS.normal;

      this.calories = (this.species.startCalories || 0) + (this.build.startCalories || 0);
      this.stage = 0;
      this.mood = 0.75;             // 0..1
      this.hunger = 0.2;            // 0..1 (1 = голоден)
      this.relation = 0;            // 0..100+
      this.blush = 0;
      this.wet = 0;
      this.energy = 1;
      this.emotion = 'neutral';
      this.emotionTimer = 0;
      this.mobile = true;
      this.elixirUntil = 0;         // игровое время окончания эликсира
      this.permanentMobility = false;
      this.breathPhase = 0;
      this.talkTimer = 0;
      this.lastSpeech = '';
      this.speechTimer = 0;
      this.spaBonusUntil = 0;
      this.stats = { fed: 0, massages: 0, bounces: 0, foodsTried: {} };

      this.root = new THREE.Group();
      this.root.position.set(-58, 0, 70);   // рядом с коттеджем
      scene.add(this.root);

      this.bodyScale = 1;
      this.bodyScaleTarget = 1;

      /* --- v2.0: состояние вторичной динамики --- */
      this._settle = 0;          // оседание жира при долгом покое
      this._breath = 0;          // текущая фаза дыхания (-1..1)
      this._heartbeat = 0;       // импульс сердцебиения
      this.heartPhase = 0;
      this._shiver = 0;          // дрожь от холода
      this._waveQueue = [];      // бегущие волны по телу (без setTimeout)

      this.nodes = FF.ZONES.map((z, i) => new SoftNode(z, i));
      this.nodeById = Object.fromEntries(this.nodes.map((n) => [n.zone.id, n]));

      // Живые подсистемы: желудок, хвост-маятник, эмоции
      if (FF.DigestionSystem) this.digestion = new FF.DigestionSystem(this);
      if (FF.TailSystem) this.tail = new FF.TailSystem(this);
      if (FF.EmotionEngine) this.emotions = new FF.EmotionEngine(this);
      this.voicePitch = 1;
      this.gazeWeight = 0;
      this.earDroop = 0;
      this.eyeOpen = 1;
      this.softBoost = 0;

      this._buildBody();
      this._buildFeatures();
      this._computeWeights();

      // ГИПЕР-ФИЗИКА: 60 независимых коллайдеров зон
      this.physics = new FF.BodyPhysics(this);
      this.applyCalories(0);
      this._updateGrowthTargets(true);
    }

    /* -------------------- Построение геометрии -------------------- */
    _buildBody() {
      const parts = [];
      const ids = [];
      const S = this.species.scale;

      const add = (geo, mat4, partId) => {
        geo.applyMatrix4(mat4);
        parts.push(geo); ids.push(partId);
      };
      const M = (x, y, z, sx, sy, sz) => new THREE.Matrix4()
        .makeScale(sx, sy, sz).setPosition(x, y, z);

      // Пропорции зависят от телосложения (тоненький / обычный / толстый)
      const B = this.build;
      const T = B.torso, H = B.hips, Lm = B.limbs;

      // Торс (эллипсоид высокой детализации — основа деформации)
      add(new THREE.SphereGeometry(1, 44, 34), M(0, 1.22, 0, 0.44 * T, 0.62, 0.36 * T), 0);
      // Таз/бёдра
      add(new THREE.SphereGeometry(1, 34, 26), M(0, 0.82, -0.06, 0.42 * H, 0.34, 0.36 * H), 1);
      // Грудь
      add(new THREE.SphereGeometry(1, 30, 24), M(0, 1.56, 0.04, 0.38 * T, 0.26, 0.30 * T), 2);
      // Голова
      add(new THREE.SphereGeometry(1, 32, 26), M(0, 2.02, 0.02, 0.24, 0.24, 0.25), 3);
      // Морда
      add(new THREE.SphereGeometry(1, 20, 16), M(0, 1.97, 0.22, 0.13, 0.10, 0.13), 3);
      // Шея
      add(new THREE.CylinderGeometry(0.17, 0.22, 0.22, 20, 3), M(0, 1.80, 0.02, 1, 1, 1), 4);

      // Руки (плечо + предплечье + лапа) x2
      for (const s of [-1, 1]) {
        add(new THREE.SphereGeometry(1, 18, 14), M(s * 0.40, 1.60, 0, 0.15, 0.14, 0.15), 5);
        add(new THREE.CapsuleGeometry(0.11 * Lm, 0.26, 6, 14), M(s * 0.46 * T, 1.42, 0, 1, 1, 1), 5);
        add(new THREE.CapsuleGeometry(0.09 * Lm, 0.24, 6, 14), M(s * 0.54 * T, 1.14, 0.01, 1, 1, 1), 5);
        add(new THREE.SphereGeometry(1, 14, 12), M(s * 0.58, 0.98, 0.03, 0.10, 0.09, 0.10), 5);
      }
      // Ноги (бедро + голень + стопа) x2
      for (const s of [-1, 1]) {
        add(new THREE.CapsuleGeometry(0.19 * Lm, 0.26, 6, 18), M(s * 0.21 * H, 0.62, 0.01, 1, 1, 1), 6);
        add(new THREE.CapsuleGeometry(0.14 * Lm, 0.22, 6, 16), M(s * 0.23 * H, 0.28, -0.01, 1, 1, 1), 6);
        add(new THREE.SphereGeometry(1, 14, 12), M(s * 0.23, 0.06, 0.07, 0.11, 0.06, 0.17), 6);
      }
      // Уши
      const earLen = this.species.longEars ? 0.30 : 0.13;
      for (const s of [-1, 1]) {
        const g = this.species.protogen
          ? new THREE.BoxGeometry(0.07, 0.26, 0.13)     // угловатые кибер-уши
          : new THREE.ConeGeometry(0.075, earLen * 2, 12);
        const m = new THREE.Matrix4().makeRotationZ(s * (this.species.protogen ? 0.42 : 0.28));
        m.setPosition(s * 0.14, 2.20 + earLen * 0.4, -0.02);
        add(g, m, 7);
      }
      // Хвост. У протогена — длинный сужающийся хвост-раптор
      const isProto = !!this.species.protogen;
      const tailSegs = isProto ? 9 : 6;
      for (let i = 0; i < tailSegs; i++) {
        const t = i / tailSegs;
        let r;
        if (isProto) r = 0.13 * (1 - t * 0.82);
        else r = (this.species.tail === 'thin' ? 0.06 : 0.10) * (1 - t * 0.35)
          + (this.species.tail === 'bushy' ? 0.06 : 0);
        const dy = isProto ? 0.98 - t * 0.62 : 0.98 - t * 0.18;
        const dz = isProto ? -0.36 - t * 0.95 : -0.38 - t * 0.30;
        add(new THREE.SphereGeometry(1, 12, 10), M(0, dy, dz, r, r, r * (isProto ? 1.6 : 1.25)), 8);
      }

      const geo = U.mergeGeometries(parts, ids);
      geo.scale(S, S, S);
      geo.computeVertexNormals();
      this.baseGeo = geo;
      this.vertexCount = geo.attributes.position.count;

      // Копия исходных позиций для деформации
      this.basePos = new Float32Array(geo.attributes.position.array);
      this.stretchAttr = new THREE.BufferAttribute(new Float32Array(this.vertexCount), 1);
      geo.setAttribute('stretch', this.stretchAttr);
      // v2.0: нагрев, пот и целлюлит — тоже пер-вершинные, смешиваются
      // теми же весами зон, что и деформация, поэтому переходы плавные.
      this.heatAttr = new THREE.BufferAttribute(new Float32Array(this.vertexCount), 1);
      geo.setAttribute('heat', this.heatAttr);
      this.sweatAttr = new THREE.BufferAttribute(new Float32Array(this.vertexCount), 1);
      geo.setAttribute('sweat', this.sweatAttr);
      this.celluliteAttr = new THREE.BufferAttribute(new Float32Array(this.vertexCount), 1);
      geo.setAttribute('cellulite', this.celluliteAttr);

      const belly = new THREE.Color(this.species.belly);
      const fur = new THREE.Color(this.opts.furColor != null ? this.opts.furColor : this.species.fur);
      this.material = makeSkinMaterial(fur, belly);
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;
      this.mesh.frustumCulled = false;
      this.mesh.userData.furry = true;
      this.root.add(this.mesh);
    }

    /** Глаза, нос, когти, одежда, крылья */
    /**
     * Построить предмет одежды как выборку треугольников тела.
     *
     * Идея: одежда — не самостоятельная фигура, а «вторая кожа». Берём
     * треугольники исходного меша, попадающие в нужную область (торс для
     * футболки, таз для шорт), и копируем их в отдельную геометрию.
     * shirtMap/shortsMap хранят соответствие «вершина одежды -> вершина тела»,
     * по нему каждый кадр переносим деформацию.
     *
     * @param {'shirt'|'shorts'} kind
     */
    /**
     * Опорные вершины головы: по ним черты лица следуют за деформацией меша.
     * Считается один раз — в горячем цикле только суммирование.
     */
    _pickHeadSamples() {
      const partAttr = this.baseGeo.attributes.part
        ? this.baseGeo.attributes.part.array : null;
      const base = this.basePos;
      const S = this.species.scale;
      const idx = [], muzzle = [];
      for (let v = 0; v < this.vertexCount; v++) {
        if (partAttr && (partAttr[v] | 0) !== 3) continue;   // только голова+морда
        idx.push(v);
        // Морда — передняя часть головы, по ней определяем «кончик носа»
        if (base[v * 3 + 2] > 0.18 * S && base[v * 3 + 1] < 2.06 * S) muzzle.push(v);
      }
      return {
        idx: Int32Array.from(idx), len: idx.length,
        muzzle: Int32Array.from(muzzle), muzzleLen: muzzle.length,
      };
    }

    _buildGarment(kind) {
      const S = this.species.scale;
      const base = this.basePos;
      const partAttr = this.baseGeo.attributes.part
        ? this.baseGeo.attributes.part.array : null;
      const index = this.mesh.geometry.index;
      const triCount = index ? index.count / 3 : this.vertexCount / 3;

      // Границы области и допустимые части тела
      const isShirt = kind === 'shirt';
      const yMin = (isShirt ? 1.02 : 0.55) * S;
      const yMax = (isShirt ? 1.86 : 1.02) * S;
      const okPart = isShirt ? { 0: 1, 2: 1 } : { 0: 1, 1: 1 };

      const map = [];          // вершина одежды -> вершина тела
      const remap = new Map(); // вершина тела -> индекс в одежде
      const idx = [];

      for (let t = 0; t < triCount; t++) {
        const a = index ? index.getX(t * 3) : t * 3;
        const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        // Треугольник берём, только если ВСЕ его вершины в зоне одежды —
        // иначе по краю торчали бы рваные куски ткани.
        let ok = true;
        for (const v of [a, b, c]) {
          const y = base[v * 3 + 1];
          const p = partAttr ? (partAttr[v] | 0) : 0;
          if (y < yMin || y > yMax || !okPart[p]) { ok = false; break; }
        }
        if (!ok) continue;
        for (const v of [a, b, c]) {
          let ni = remap.get(v);
          if (ni === undefined) { ni = map.length; remap.set(v, ni); map.push(v); }
          idx.push(ni);
        }
      }

      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(map.length * 3);
      for (let i = 0; i < map.length; i++) {
        const v = map[i];
        pos[i * 3] = base[v * 3]; pos[i * 3 + 1] = base[v * 3 + 1]; pos[i * 3 + 2] = base[v * 3 + 2];
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      if (isShirt) this.shirtMap = map; else this.shortsMap = map;
      return g;
    }

    _buildFeatures() {
      const S = this.species.scale;
      // Протоген строится иначе: визор вместо глаз и морды
      if (this.species.protogen) return this._buildProtogenFeatures();
      const eyeMat = new THREE.MeshStandardMaterial({ color: this.opts.eyeColor, roughness: 0.15, emissive: 0x111111 });
      const scleraMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1418, roughness: 0.5 });

      this.eyes = [];
      this.pupils = [];      // зрачки двигаются отдельно — для слежения взглядом
      for (const s of [-1, 1]) {
        const g = new THREE.Group();
        const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), scleraMat);
        const iris = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 10), eyeMat);
        iris.position.z = 0.028;
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), darkMat);
        pupil.position.z = 0.048;
        this.pupils.push(iris);   // радужка вместе со зрачком читается как взгляд
        g.add(sclera, iris, pupil);
        g.position.set(s * 0.10 * S, 2.06 * S, 0.19 * S);
        this.root.add(g);
        this.eyes.push(g);
      }
      // Веки для морганий
      this.lids = this.eyes.map((e) => {
        const lid = new THREE.Mesh(new THREE.SphereGeometry(0.056, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: this.species.fur, roughness: 0.9 }));
        lid.position.copy(e.position);
        lid.scale.set(1, 0.1, 1);
        this.root.add(lid);
        return lid;
      });

      // Нос
      this.nose = new THREE.Mesh(new THREE.SphereGeometry(0.035 * S, 12, 10), darkMat);
      this.nose.position.set(0, 1.985 * S, 0.345 * S);
      this.root.add(this.nose);

      // Рот (открывается при еде)
      this.mouth = new THREE.Mesh(
        new THREE.SphereGeometry(0.062 * S, 14, 10),
        new THREE.MeshStandardMaterial({ color: 0x50202a, roughness: 0.6 }));
      this.mouth.position.set(0, 1.935 * S, 0.30 * S);
      this.mouth.scale.set(1, 0.25, 0.5);
      this.root.add(this.mouth);
      this.mouthOpen = 0;

      // Одежда: не отдельные шары, а «вторая кожа» — подмножество вершин
      // самого тела. Так ткань не может вылезти сквозь плоть.
      const shirtMat = new THREE.MeshStandardMaterial({
        color: 0x5aa7d8, roughness: 0.85, side: THREE.DoubleSide, transparent: true,
      });
      const shortsMat = new THREE.MeshStandardMaterial({
        color: 0x3b4a63, roughness: 0.9, side: THREE.DoubleSide, transparent: true,
      });
      this.shirt = new THREE.Mesh(this._buildGarment('shirt'), shirtMat);
      this.shorts = new THREE.Mesh(this._buildGarment('shorts'), shortsMat);
      this.shirt.castShadow = true;
      this.shorts.castShadow = true;
      // Одежда живёт в той же системе координат, что и меш тела
      this.mesh.add(this.shirt);
      this.mesh.add(this.shorts);

      // Крылья дракона
      if (this.species.wings) {
        this.wings = [];
        for (const s of [-1, 1]) {
          const w = new THREE.Mesh(
            new THREE.ConeGeometry(0.22, 0.5, 4),
            new THREE.MeshStandardMaterial({ color: 0x4a8f56, roughness: 0.7, side: THREE.DoubleSide }));
          w.position.set(s * 0.3 * S, 1.65 * S, -0.28 * S);
          w.rotation.set(0.4, 0, s * 0.9);
          this.root.add(w); this.wings.push(w);
        }
      }
      // Грива льва
      if (this.species.mane) {
        const mane = new THREE.Mesh(new THREE.TorusGeometry(0.26 * S, 0.1 * S, 10, 22),
          new THREE.MeshStandardMaterial({ color: 0x8a5b1e, roughness: 1 }));
        mane.position.set(0, 2.0 * S, -0.02);
        mane.rotation.x = Math.PI / 2;
        this.root.add(mane);
      }
    }

    /**
     * ПРОТОГЕН: тёмный визор с光 свечением, кибер-пластины, «волосы»-шипы.
     * Мимика передаётся рисунком на визоре, а не движением век.
     */
    _buildProtogenFeatures() {
      const S = this.species.scale;
      const sp = this.species;
      const plateMat = new THREE.MeshStandardMaterial({
        color: sp.plate, roughness: 0.42, metalness: 0.55 });
      this.plateMat = plateMat;

      // --- Корпус визора (тёмный щиток на морде) ---
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 14), plateMat);
      shell.scale.set(1.05, 0.92, 1.15);
      shell.position.set(0, 2.02 * S, 0.06 * S);
      this.root.add(shell);
      this.visorShell = shell;

      // --- Светящееся стекло визора ---
      const glassGeo = new THREE.SphereGeometry(0.262, 24, 16,
        -Math.PI * 0.62, Math.PI * 1.24, Math.PI * 0.30, Math.PI * 0.34);
      const visorMat = new THREE.MeshStandardMaterial({
        color: 0x0a0f14, roughness: 0.06, metalness: 0.85,
        emissive: new THREE.Color(sp.visor), emissiveIntensity: 0.85 });
      this.visorMat = visorMat;
      const glass = new THREE.Mesh(glassGeo, visorMat);
      glass.scale.set(1.06, 0.94, 1.18);
      glass.position.copy(shell.position);
      glass.position.z += 0.012 * S;
      this.root.add(glass);
      this.visorGlass = glass;

      // --- Пиксельные «глаза» на визоре ---
      const eyeMat = new THREE.MeshBasicMaterial({ color: sp.visor });
      this.protoEyes = [];
      for (const side of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.05), eyeMat);
        e.position.set(side * 0.105 * S, 2.055 * S, 0.30 * S);
        e.rotation.y = side * 0.22;
        this.root.add(e);
        this.protoEyes.push(e);
      }
      this.protoEyeMat = eyeMat;
      // Свет от визора
      const vl = new THREE.PointLight(sp.visor, 0.9, 2.4, 2);
      vl.position.set(0, 2.04 * S, 0.30 * S);
      this.root.add(vl);
      this.visorLight = vl;

      // --- «Волосы»: угловатые пластины назад ---
      for (let i = 0; i < 7; i++) {
        const a = -0.75 + i * 0.25;
        const spike = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.30), plateMat);
        spike.position.set(Math.sin(a) * 0.20 * S, (2.22 - Math.abs(a) * 0.07) * S, -0.13 * S);
        spike.rotation.set(-0.42, a * 0.55, a * 0.30);
        this.root.add(spike);
      }
      // Воротник-пластина
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.20 * S, 0.045 * S, 8, 18), plateMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(0, 1.80 * S, 0);
      this.root.add(collar);

      // Рот и заглушки, чтобы общий код не падал
      this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.001, 4, 3),
        new THREE.MeshBasicMaterial({ visible: false }));
      this.root.add(this.mouth);
      this.mouthOpen = 0;
      this.eyes = [];
      this.lids = [];
      this.nose = new THREE.Object3D();
      this.root.add(this.nose);

      this._buildClothes(S);
    }

    /** Одежда — общая для всех видов */
    _buildClothes(S) {
      const shirtMat = new THREE.MeshStandardMaterial({
        color: 0x5aa7d8, roughness: 0.85, side: THREE.DoubleSide, transparent: true });
      this.shirt = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), shirtMat);
      this.shirt.scale.set(0.47 * S, 0.52 * S, 0.40 * S);
      this.shirt.position.set(0, 1.34 * S, 0.02 * S);
      this.shirt.castShadow = true;
      this.root.add(this.shirt);

      const shortsMat = new THREE.MeshStandardMaterial({ color: 0x3b4a63, roughness: 0.9, transparent: true });
      this.shorts = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), shortsMat);
      this.shorts.scale.set(0.46 * S, 0.28 * S, 0.40 * S);
      this.shorts.position.set(0, 0.78 * S, -0.02 * S);
      this.root.add(this.shorts);
    }

    /**
     * Предрасчёт весов влияния зон на вершины (top-4 по расстоянию).
     * Именно это делает 60 зон физически «раздельными».
     */
    _computeWeights() {
      const n = this.vertexCount;
      const K = 4;
      this.wIdx = new Int32Array(n * K).fill(-1);
      this.wVal = new Float32Array(n * K);
      const S = this.species.scale;
      const tmp = [];
      const v = new THREE.Vector3();
      const partAttr = this.baseGeo.attributes.part
        ? this.baseGeo.attributes.part.array : null;

      for (let i = 0; i < n; i++) {
        v.set(this.basePos[i * 3], this.basePos[i * 3 + 1], this.basePos[i * 3 + 2]);
        const part = partAttr ? (partAttr[i] | 0) : -1;
        const allow = part >= 0 ? PART_ZONES[part] : null;
        tmp.length = 0;
        for (let j = 0; j < this.nodes.length; j++) {
          const nd = this.nodes[j];
          // Анатомический фильтр: зона живота не имеет права тянуть макушку.
          // Без него у вершин головы единственным «дотянувшимся» узлом
          // оказывался mid_belly (радиус 0.7 достаёт до 1.33 м), получал
          // вес 1.0 после нормировки — и морду рвало вперёд на полтора метра.
          if (allow && !allow[nd.zone.group]) continue;
          const r = nd.zone.radius * S;
          const dx = v.x - nd.base.x * S, dy = v.y - nd.base.y * S, dz = v.z - nd.base.z * S;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > r * 1.9) continue;
          // Гладкое ядро влияния
          const w = Math.pow(Math.max(0, 1 - d / (r * 1.9)), 2.1);
          if (w > 0.001) tmp.push([j, w]);
        }
        tmp.sort((a, b) => b[1] - a[1]);
        let sum = 0;
        for (let k = 0; k < K && k < tmp.length; k++) sum += tmp[k][1];
        for (let k = 0; k < K && k < tmp.length; k++) {
          this.wIdx[i * K + k] = tmp[k][0];
          this.wVal[i * K + k] = tmp[k][1] / (sum || 1);
        }
      }
      this.K = K;
    }

    /* -------------------- Рост -------------------- */

    /** Пересчёт целей роста зон по накопленным калориям */
    _updateGrowthTargets(instant) {
      const cal = this.calories;
      for (const nd of this.nodes) {
        const sp = nd.zone.speed;
        const eff = Math.max(0, cal - sp.start);
        /* Кривая насыщения. Основная часть быстро выходит на «1», но раньше
         * на этом рост и заканчивался: с 110к до 800к калорий живот
         * прибавлял всего 0.17 — кормить дальше не имело смысла.
         *
         * Теперь после насыщения включается медленный логарифмический
         * «overdrive»: зона продолжает расти сверх 1.0, поэтому у гиганта
         * живот действительно становится гигантским. */
        const t = 1 - Math.exp(-eff * sp.mult * (this.build.growthMult || 1) / 42000);
        let g = U.clamp(t, 0, 1);
        if (t > 0.985) {
          const over = Math.log10(1 + eff * sp.mult / 90000) * 0.55;
          g += Math.min(nd.zone.overdrive !== undefined ? nd.zone.overdrive : 0.8, over);
        }
        nd.growthTarget = g;
        nd.calories = eff * sp.mult;
        if (instant) nd.growth = nd.growthTarget;
      }
      // Глобальный масштаб тела: гигант становится по-настоящему огромным.
      // Кубический корень от массы — физически правдоподобный рост габаритов.
      const massRatio = 1 + cal * FF.CONFIG.growth.caloriesToKg / FF.CONFIG.growth.baseMassKg;
      this.bodyScaleTarget = U.clamp(Math.pow(massRatio, 0.30), 1, 4.6);
      if (instant) this.bodyScale = this.bodyScaleTarget;

      // Стадия
      const th = FF.CONFIG.growth.stageThresholds;
      let st = 0;
      for (let i = 0; i < th.length; i++) if (cal >= th[i]) st = i;
      const prev = this.stage;
      this.stage = st;

      /* --- КОСМИЧЕСКАЯ ФОРМА ---
       * После cosmicStage друг перестаёт быть «фигурой с животом» и
       * превращается в почти сферическую массу: конечности и голова тонут
       * в плоти, силуэт становится планетарным. cosmic — 0..1, им
       * пользуются деформация меша и камера. */
      const CS = FF.CONFIG.growth.cosmicStage || 40;
      this.cosmic = U.clamp((st - CS) / (100 - CS), 0, 1);
      if (instant) this.cosmicVisual = this.cosmic;

      this.mass = FF.CONFIG.growth.baseMassKg + cal * FF.CONFIG.growth.caloriesToKg;
      if (st !== prev && !instant) this._onStageChange(prev, st);
      this._updateMobility();
    }

    _onStageChange(from, to) {
      // UI может ещё не существовать (стартовая стадия от телосложения)
      if (!FF.Game || !FF.Game.ui) return;
      if (to > from) {
        FF.Game && FF.Game.notify(`✨ Новая стадия: «${FF.CONFIG.growth.stageNames[to]}»!`, 'stage');
        this.audio && this.audio.growth(1.6);
        this.say(['Ой... мне кажется, я стал больше!', 'Мур... одежда жмёт!', 'Я расту, да? Ня!'][U.randInt(0, 2)]);
        // Одежда рвётся
        if (to === 4 || to === 6) { this.audio && this.audio.rip(); FF.Game && FF.Game.notify('👕 Одежда порвалась! Нужна новая.', 'warn'); }
        FF.Game && FF.Game.achieve('stage' + to);
      }
    }

    _updateMobility() {
      const immobileStage = FF.CONFIG.growth.immobileStage;
      const gt = FF.Game ? FF.Game.gameHours : 0;
      const elixirActive = this.permanentMobility || gt < this.elixirUntil;
      this.mobile = this.stage < immobileStage || elixirActive;
    }

    /**
     * Скормить калории.
     * @param {number} cal
     * @param {string} foodId
     */
    feed(cal, foodId) {
      const f = FF.FOOD_BY_ID[foodId];
      const moodKey = this.mood > 0.85 ? 'great' : this.mood > 0.6 ? 'good' : this.mood > 0.4 ? 'neutral' : this.mood > 0.2 ? 'bad' : 'awful';
      let mult = 1 + FF.CONFIG.feeding.moodBonus[moodKey];
      if (FF.Game && FF.Game.gameHours < this.spaBonusUntil) mult += FF.CONFIG.feeding.spaBonusMult;
      if (this.eternalBond) mult += 0.5;   // Эликсир Вечной Любви
      const gained = cal * mult;
      this.applyCalories(gained);
      this.hunger = Math.max(0, this.hunger - cal / 25);
      this.mood = U.clamp(this.mood + Math.min(0.2, cal / 120), 0, 1);
      this.relation += cal * FF.CONFIG.feeding.relationPerCalorie;
      this.stats.fed++;
      if (foodId) this.stats.foodsTried[foodId] = (this.stats.foodsTried[foodId] || 0) + 1;
      this.setEmotion('happy', 3);
      if (this.emotions) this.emotions.onAction('feed', U.clamp(cal / 400, 0.3, 3));
      // Еда сначала попадает в желудок и распирает живот, и только потом
      // постепенно переходит в жир — см. DigestionSystem.
      if (this.digestion) this.digestion.addFood(cal);
      if (this.tail) this.tail.wag(1, 3);
      this._eatAnim(f ? f.size : 'small', gained);
      return gained;
    }

    applyCalories(delta) {
      this.calories = Math.max(0, this.calories + delta);
      this._updateGrowthTargets(false);
      // Импульс роста — тело «наливается» волной
      if (delta > 0) {
        const main = this.nodeById.mid_belly;
        main.impulse(new THREE.Vector3(0, -0.2, 1), Math.min(40, delta * 0.6));
        this.wave(new THREE.Vector3(0, 1.05, 0.3), Math.min(1.6, delta / 40));
      }
    }

    /** Анимация поедания + звук */
    _eatAnim(size, cal) {
      const chews = { tiny: 1, small: 4, medium: 8, large: 14, huge: 20, colossal: 28, drink: 6, pump: 0 }[size] || 6;
      let i = 0;
      const doChew = () => {
        if (i >= chews) {
          this.mouthOpen = 0.9;
          this.audio && this.audio.gulp(Math.min(2, 0.7 + cal / 120));
          setTimeout(() => { this.mouthOpen = 0; this.audio && this.audio.voice('happy', this.opts.species, this.voicePitch || 1); }, 220);
          return;
        }
        this.mouthOpen = i % 2 ? 0.25 : 0.75;
        this.audio && this.audio.chew();
        i++;
        setTimeout(doChew, 130);
      };
      this.mouthOpen = 0.9;
      setTimeout(doChew, 150);
      if (cal > 60) setTimeout(() => this.audio && this.audio.voice('moan', this.opts.species, this.voicePitch || 1), 900);
    }

    /* -------------------- Взаимодействие -------------------- */

    /** Найти ближайшую зону к точке мира */
    zoneAt(worldPoint, maxDist = 1.2) {
      // Точный поиск по эллипсоидным коллайдерам зон
      if (this.physics) {
        const hit = this.physics.nearestZone(worldPoint, maxDist);
        if (hit) return hit;
      }
      return this._zoneAtLegacy(worldPoint, maxDist);
    }

    /** Резервный поиск зоны (до инициализации физики) */
    _zoneAtLegacy(worldPoint, maxDist = 1.2) {
      const local = this.root.worldToLocal(worldPoint.clone());
      const S = this.species.scale;
      let best = null, bestD = Infinity;
      const tmp = new THREE.Vector3();
      for (const nd of this.nodes) {
        nd.displacement(tmp);
        const px = (nd.base.x) * S + tmp.x, py = (nd.base.y) * S + tmp.y, pz = (nd.base.z) * S + tmp.z;
        const d = Math.hypot(local.x - px, local.y - py, local.z - pz);
        const eff = d / (nd.zone.radius * S * 1.6);
        if (eff < bestD) { bestD = eff; best = nd; }
      }
      return bestD < maxDist ? best : null;
    }

    /** Тычок */
    poke(worldPoint, dirWorld, strength = 1) {
      const nd = this.zoneAt(worldPoint);
      if (!nd) return null;
      const dirLocal = dirWorld.clone().normalize();
      nd.press(dirLocal, 0.13 * strength);
      nd.impulse(dirLocal, 12 * strength);
      this.wave(worldPoint, 0.7 * strength);
      this.audio && this.audio.poke(nd.soft);
      this.setEmotion(Math.random() < 0.4 ? 'shy' : 'happy', 2);
      if (this.emotions) this.emotions.onAction('poke_belly', 1);
      if (this.quirks && nd) { this.quirks.remember(nd.zone.id); this.quirks.onGentleTouch(); }
      this.blush = Math.min(1, this.blush + 0.25);
      if (Math.random() < 0.3) this.say(U.pick(['Ой!', 'Хи-хи, щекотно!', 'Мур~', 'Ня!']));
      return nd;
    }

    /** Шлепок (сильный импульс) */
    slap(worldPoint, dirWorld) {
      const nd = this.zoneAt(worldPoint);
      if (!nd) return null;
      nd.press(dirWorld.clone().normalize(), 0.24);
      nd.impulse(dirWorld.clone().normalize(), 34);
      this.wave(worldPoint, 1.8);
      this.audio && this.audio.slap(1 + this.stage * 0.2);
      this.blush = Math.min(1, this.blush + 0.5);
      this.setEmotion('shy', 3);
      return nd;
    }

    /** Массаж (мягкое продолжительное воздействие) */
    massage(worldPoint, dirWorld, dt) {
      const nd = this.zoneAt(worldPoint);
      if (!nd) return null;
      nd.press(dirWorld.clone().normalize(), 0.5 * dt);
      nd.impulse(new THREE.Vector3(Math.sin(performance.now() * 0.006), 0, Math.cos(performance.now() * 0.005)), 2.4 * dt * 60 * 0.02);
      this.mood = U.clamp(this.mood + dt * 0.02, 0, 1);
      this.relation += dt * 0.05;
      this.blush = Math.min(1, this.blush + dt * 0.3);
      if (Math.random() < dt * 3) this.audio && this.audio.squish();
      if (Math.random() < dt * 0.5) { this.audio && this.audio.voice('moan', this.opts.species, this.voicePitch || 1); this.setEmotion('bliss', 2); }
      this.stats.massages += dt;
      if (this.emotions && Math.random() < dt * 2) this.emotions.onAction('massage', dt * 2);
      if (this.quirks) { this.quirks.remember(nd.zone.id); this.quirks.onGentleTouch(); }
      return nd;
    }

    /**
     * Волна колыхания от точки.
     *
     * v2.0: волна не «телепортируется» во все зоны сразу и не висит на
     * setTimeout (тот игнорирует паузу игры и мусорит таймерами). Вместо
     * этого волна живёт во _waveQueue и физически распространяется от
     * источника со скоростью waveSpeed: сначала вздрагивает живот, затем
     * грудь, потом шея и подбородки — видно, как импульс бежит по телу.
     */
    wave(worldPoint, strength = 1) {
      const local = this.root.worldToLocal(worldPoint.clone());
      this._waveQueue.push({
        x: local.x, y: local.y, z: local.z,
        strength, radius: 0, life: 0,
      });
      // Больше 6 волн одновременно не читается глазом — гасим старые
      if (this._waveQueue.length > 6) this._waveQueue.shift();
      if (strength > 0.8) this.audio && this.audio.jiggle(Math.min(1.5, strength));
    }

    /** Продвижение фронта всех активных волн */
    _updateWaves(dt) {
      if (!this._waveQueue.length) return;
      const S = this.species.scale;
      const speed = FF.CONFIG.soft.waveSpeed;
      const THICK = 0.34;          // толщина фронта волны

      for (let i = this._waveQueue.length - 1; i >= 0; i--) {
        const w = this._waveQueue[i];
        const prevR = w.radius;
        // Фронт замедляется по мере ухода от источника — как затухающая
        // волна в вязкой среде, а не равномерно расширяющаяся сфера.
        w.radius += speed * dt / (1 + w.radius * 0.55);
        w.life += dt;

        for (const nd of this.nodes) {
          if (nd.growth < 0.02) continue;
          const dx = nd.base.x * S - w.x;
          const dy = nd.base.y * S - w.y;
          const dz = nd.base.z * S - w.z;
          const d = Math.hypot(dx, dy, dz);
          // Узел «ловит» волну только когда фронт проходит через него
          if (d < prevR || d > w.radius + THICK) continue;

          const falloff = Math.exp(-d * 1.15);         // затухание с расстоянием
          const amp = 16 * w.strength * falloff * nd.growth * nd.jiggleK;
          if (amp < 0.02) continue;
          const inv = 1 / (d || 1);
          _tmpWaveA.set(dx * inv, dy * inv + 0.2, dz * inv).normalize();
          nd.impulse(_tmpWaveA, amp);
        }
        // Волна ушла за габариты тела или выдохлась
        if (w.radius > 3.2 || w.life > 1.4) this._waveQueue.splice(i, 1);
      }
    }

    /** Прыжок игрока на животе — батут */
    bounce(worldPoint, power = 1) {
      const nd = this.zoneAt(worldPoint) || this.nodeById.mid_belly;
      nd.impulse(new THREE.Vector3(0, -1, 0), 42 * power);
      this.wave(worldPoint, 2.2 * power);
      this.stats.bounces++;
      this.audio && this.audio.slap(1.4);
      this.setEmotion('giggle', 2.5);
      if (Math.random() < 0.4) this.audio && this.audio.voice('giggle', this.opts.species, this.voicePitch || 1);
      // Возвращаем силу отдачи для игрока
      return 4.5 + nd.growth * 7 * power;
    }

    /** Мировая позиция зоны (для UI, карабканья, точек захвата) */
    zoneWorldPos(nodeOrId, out) {
      const nd = typeof nodeOrId === 'string' ? this.nodeById[nodeOrId] : nodeOrId;
      const S = this.species.scale;
      const tmp = new THREE.Vector3();
      nd.displacement(tmp);
      const v = (out || new THREE.Vector3()).set(
        nd.base.x * S + tmp.x, nd.base.y * S + tmp.y, nd.base.z * S + tmp.z);
      return this.root.localToWorld(v);
    }

    /** Все точки захвата, доступные для карабканья */
    grabPoints() {
      const out = [];
      for (const nd of this.nodes) {
        if (!nd.zone.grab) continue;
        if (nd.growth < 0.06) continue;
        // Качество хвата: складки держат лучше гладких поверхностей,
        // мокрая шёрстка скользит, сильное колыхание мешает
        const foldBonus = nd.zone.folds.filter((t) => this.calories >= t).length * 0.14;
        const wobble = Math.min(0.3, nd.vel.length() * 0.06);
        const q = U.clamp(nd.growth * (0.35 + nd.soft * 0.5) + foldBonus - this.wet * 0.35 - wobble, 0.05, 1);
        out.push({ node: nd, pos: this.zoneWorldPos(nd), quality: q });
      }
      return out;
    }

    /* -------------------- Эмоции и речь -------------------- */

    setEmotion(e, seconds = 2) { this.emotion = e; this.emotionTimer = seconds; }

    /**
     * ЭМОЦИОНАЛЬНАЯ ФИЗИКА: настроение видно по телу, а не только по морде.
     *   смех    — живот ходит волнами, каскад подбородков трясётся
     *   смущение— щёки надуваются, тело чуть поджимается
     *   блаженство — всё расслаблено, дыхание глубокое
     *   голод   — живот подтягивается и «урчит» мелкой дрожью
     */
    _emotionalPhysics(dt) {
      const e = this.emotion;
      if (!e || e === 'neutral') return;
      const t = performance.now() * 0.001;

      if (e === 'giggle') {
        /* Смех: собственная фаза, не привязанная к времени старта эмоции,
         * иначе сила тряски зависела бы от момента, когда фурри засмеялся.
         * Каждый «ха» — толчок вниз-вперёд по животу, подбородки отвечают
         * с задержкой на четверть периода: получается каскад. */
        this._laughPhase = (this._laughPhase || 0) + dt * 9.5;
        const puls = Math.sin(this._laughPhase);
        const kick = puls * dt * 60;                 // независимо от частоты кадров
        for (const id of ['mid_belly', 'upper_belly', 'lower_belly', 'apron_fold']) {
          const nd = this.nodeById[id];
          if (!nd || nd.growth < 0.05) continue;
          const L = nd.layers[nd.layers.length - 1];
          L.vel.y += kick * 0.38 * nd.growth;
          L.vel.z += kick * 0.12 * nd.growth;
        }
        const lag = Math.sin(this._laughPhase - 1.57);   // каскад подбородков
        for (const id of ['chin1', 'chin2', 'chin3']) {
          const nd = this.nodeById[id];
          if (nd && nd.growth > 0.05) {
            nd.layers[nd.layers.length - 1].vel.y += lag * dt * 60 * 0.22 * nd.growth;
          }
        }
      } else if (e === 'shy') {
        // Смущение: щёки наливаются
        for (const id of ['left_cheek', 'right_cheek']) {
          const nd = this.nodeById[id];
          if (nd) nd.offset.z += 0.012 * nd.growth;
        }
      } else if (e === 'hungry') {
        // Урчание: мелкая дрожь в животе
        const nd = this.nodeById.mid_belly;
        if (nd && nd.growth > 0.05 && Math.random() < dt * 1.5) {
          nd.impulse(_tmpWaveA.set(0, -1, 0.3).normalize(), 1.8);
        }
      }
    }

    /**
     * Диалоги отключены: текстовые реплики не показываются.
     * Метод сохранён — он проигрывает голос и держит анимацию рта,
     * поэтому друг остаётся «живым», просто молча.
     */
    say(text, seconds = 3.2) {
      this.speechTimer = 0;
      this.audio && this.audio.voice(
        this.emotion === 'sad' ? 'sad' : 'mur', this.opts.species, 1 + Math.random() * 0.15);
    }

    /* -------------------- Обновление -------------------- */

    update(dt, gameHours) {
      const cfg = FF.CONFIG;
      // LOD: чем дальше игрок, тем реже пересчитываем тяжёлое
      if (FF.Game && FF.Game.player) {
        const d = this.root.position.distanceTo(FF.Game.player.pos);
        this._normalLOD = d < 12 ? 3 : d < 30 ? 6 : 12;
        this._far = d > 45;
      }
      // Голод растёт
      if (this.emotions) {
        // Полная модель: 12 эмоций сами ведут mood и hunger
        this.emotions.update(dt);
      } else {
        const hungerRate = 1 / (cfg.feeding.hungerPeriodMin * 60);
        this.hunger = U.clamp(this.hunger + dt * hungerRate * 60 * 0.016, 0, 1);
        if (this.hunger > 0.75) this.mood = U.clamp(this.mood - dt * 0.01, 0, 1);
        else this.mood = U.clamp(this.mood + dt * 0.004, 0, 1);
      }
      this.blush = Math.max(0, this.blush - dt * 0.25);
      this.wet = Math.max(0, this.wet - dt * 0.03);
      this.emotionTimer -= dt;
      if (this.emotionTimer <= 0) this.emotion = this.hunger > 0.7 ? 'hungry' : this.mood > 0.7 ? 'content' : 'neutral';
      this.speechTimer -= dt;
      this._updateMobility();

      /* --- Дыхание ---
       * Эмоции реально меняют дыхание: голодный дышит чаще, спящий — реже,
       * возбуждённый/смеющийся — часто и глубоко. Амплитуда растёт с массой:
       * у гиганта грудная клетка ходит заметно. */
      let breathRate = 0.55 + this.stage * 0.07 + (1 - this.mood) * 0.1;
      let breathDepth = 1;
      if (this.emotion === 'sleep') { breathRate *= 0.55; breathDepth = 1.5; }
      else if (this.emotion === 'giggle' || this.emotion === 'bliss') { breathRate *= 1.5; breathDepth = 1.3; }
      else if (this.hunger > 0.8) { breathRate *= 1.2; }
      this.breathPhase += dt * breathRate;
      const breath = Math.sin(this.breathPhase * Math.PI * 2) * breathDepth;
      this._breath = breath;
      if (Math.random() < dt * 0.25 && this.stage > 4) this.audio && this.audio.voice('breath', this.opts.species, this.voicePitch || 1);

      /* --- Сердцебиение: резкий систолический удар, а не синус --- */
      this.heartPhase = (this.heartPhase || 0) + dt * (1.05 + this.stage * 0.04);
      if (this.heartPhase > 1) this.heartPhase -= 1;
      const hp = this.heartPhase;
      this._heartbeat = Math.exp(-hp * 14) * 1.6 - Math.exp(-hp * 5) * 0.6;

      /* --- Инерция корпуса: ускорение тела раскачивает жир --- */
      if (!this._prevPos) this._prevPos = this.root.position.clone();
      if (!this._prevVel) this._prevVel = new THREE.Vector3();
      if (!this._accel) this._accel = new THREE.Vector3();
      if (dt > 1e-4) {
        const v = _tmpAccelA.copy(this.root.position).sub(this._prevPos).divideScalar(dt);
        // Ускорение = изменение скорости; сглаживаем, чтобы не ловить рывки
        const a = _tmpAccelB.copy(v).sub(this._prevVel).divideScalar(dt);
        if (a.lengthSq() > 6400) a.setLength(80);   // страховка от телепортов
        this._accel.lerp(a, Math.min(1, dt * 14));
        this._prevVel.copy(v);
        this._prevPos.copy(this.root.position);
      }

      // Случайное урчание / реплики
      this.talkTimer -= dt;
      if (this.talkTimer <= 0) {
        this.talkTimer = U.rand(14, 34);
        if (this.hunger > 0.65) this.say(U.pick(['Мур... я хочу кушать...', 'Пожалуйста, покорми меня~', 'В животике пусто...']));
        else if (this.mood > 0.8) this.say(U.pick(['Мур... мне так уютно...', 'Я тебя люблю...', 'Гладь меня~', 'Так вкусно было!']));
        else if (this.stage >= 7) this.say(U.pick(['Ой, я такой толстый!', 'Я не могу двигаться...', 'Мне нужен эликсир...']));
        else if (this.audio) this.audio.voice(this.species.purr ? 'purr' : 'mur', this.opts.species);
      }

      /* --- Adaptive stiffness: жир «оседает» при долгом стоянии --- */
      const moving = this._accel.lengthSq() > 0.35;
      const settleTarget = moving ? 0 : 1;
      this._settle = U.damp(this._settle || 0, settleTarget, cfg.soft.adaptiveSettle, dt);

      /* --- Погода: в холод тело дрожит, в ясную жару — разморено --- */
      let weatherJiggle = 1, shiver = 0;
      const wx = FF.Game && FF.Game.weatherSys;
      if (wx && FF.WEATHER_TYPES) {
        const wt = FF.WEATHER_TYPES[wx.current];
        if (wt) {
          if (wt.cold) shiver = 0.55;                       // снег — мелкая дрожь
          else if (wt.name === 'Ясно' && gameHours > 12 && gameHours < 17) weatherJiggle = 0.85;
          if (wt.wet) this.wet = Math.max(this.wet, 0.65);  // дождь мочит шерсть
        }
      }
      this._shiver = shiver;

      // Контекст тела: его читает каждый узел на своём шаге
      const ctx = this._physCtx || (this._physCtx = {});
      ctx.accel = this._accel;
      ctx.breath = this._breath;
      ctx.heartbeat = this._heartbeat;
      ctx.micro = !this._far;               // вдали микро-дрожь не видна — экономим
      ctx.weather = weatherJiggle;

      // Бегущие волны по телу (до шага физики — импульсы войдут в этот кадр)
      this._updateWaves(dt);
      // Эмоции влияют на тело: смех трясёт живот, смущение надувает щёки
      this._emotionalPhysics(dt);
      // Желудок распирает живот и урчит; хвост живёт своей инерцией
      if (this.digestion) this.digestion.update(dt);
      if (this.tail) this.tail.update(dt);

      // Физика узлов
      const sub = cfg.soft.substeps;
      const h = dt / sub;
      for (let s = 0; s < sub; s++) {
        for (const nd of this.nodes) {
          nd.settle = this._settle;
          nd.step(h, cfg.soft.gravitySag, ctx);
        }
        // Связь соседних узлов (передача волны)
        this._couple(h);
      }

      // Дрожь от холода — мелкая высокочастотная вибрация всего тела
      if (shiver > 0.01) {
        const t = performance.now() * 0.001;
        for (const nd of this.nodes) {
          if (nd.growth < 0.05) continue;
          nd.offset.y += Math.sin(t * 34 + nd.index) * 0.004 * shiver * nd.jiggleK;
          nd.offset.x += Math.sin(t * 41 + nd.index * 2.3) * 0.003 * shiver * nd.jiggleK;
        }
      }

      // Ноги всегда касаются земли (вес прижимает к поверхности)
      if (FF.Game && FF.Game.world && !FF.Game.taxi.active) {
        const gy = FF.Game.world.heightAt(this.root.position.x, this.root.position.z);
        this.root.position.y = U.damp(this.root.position.y, gy, 8, dt);
      }

      // Плавное применение габаритного масштаба
      this.bodyScale = U.damp(this.bodyScale, this.bodyScaleTarget, 0.7, dt);
      this.root.scale.setScalar(this.bodyScale);

      // Далеко от игрока — тонкая физика не нужна, экономим кадры
      if (this._far) {
        this._farTick = (this._farTick || 0) + 1;
        if (this._farTick % 3 !== 0) { this._updateClothes(); return; }
      }

      // --- ГИПЕР-ФИЗИКА: коллайдеры зон, самоколлизия, контакт с миром ---
      if (this.physics) {
        this.physics.update(dt);
        if (FF.Game && FF.Game.world) this.physics.worldCollision(FF.Game.world, dt);
      }

      this._deformMesh();
      this._updateFeatures(dt);
      this._updateClothes();

      const u = this.material.userData.uniforms;
      u.uWet.value = this.wet;
      u.uBlush.value = this.blush;
      if (u.uGoose) u.uGoose.value = this.quirks ? this.quirks.goosebumps : 0;
      if (u.uFog) u.uFog.value = this.quirks ? this.quirks.fogged : 0;
      u.uTime.value = gameHours;
      u.uFurDensity.value = 1 / (1 + this.stage * 0.06);
    }

    /** Передача импульсов между соседними зонами — «волна по телу» */
    _couple(dt) {
      if (!this._neighbors) {
        // Предрасчёт соседей один раз
        this._neighbors = this.nodes.map((a) => {
          const list = [];
          for (const b of this.nodes) {
            if (a === b) continue;
            const d = a.base.distanceTo(b.base);
            if (d < 0.55) list.push([b, Math.exp(-d * 3.2)]);
          }
          return list;
        });
      }
      /* Связь идёт ПО СЛОЯМ: поверхностный жир соседей увлекает сильнее,
       * глубокий почти не передаётся — так волна расходится по поверхности,
       * а не двигает тело целиком.
       *
       * Важно: раньше здесь правилась node.vel, но после перехода на слои
       * это поле — производное (копия скорости глубокого слоя), и правки
       * затирались на следующем шаге, т.е. связь зон фактически не работала.
       *
       * Ещё нюанс: передаём только КОЛЕБАТЕЛЬНУЮ составляющую. Провисание
       * соседа не должно утягивать вниз зоны, которые по профилю форму
       * держат (загривок, плечи, «полка» над попой: sag = 0). Иначе жёсткие
       * зоны медленно сползали вслед за животом. */
      const k = FF.CONFIG.soft.neighborCoupling * dt * 60 * 0.016;
      for (let i = 0; i < this.nodes.length; i++) {
        const a = this.nodes[i];
        // Сопротивление «утягиванию вниз»: 1 у висящих, ~0 у держащих форму
        const pull = U.clamp(a.sagK, 0, 1);
        for (const [b, w] of this._neighbors[i]) {
          const nL = Math.min(a.layers.length, b.layers.length);
          for (let li = 0; li < nL; li++) {
            const la = a.layers[li], lb = b.layers[li];
            const kk = w * k * (0.5 + li * 0.45);   // верхние слои связаны сильнее
            la.vel.x += (lb.vel.x - la.vel.x) * kk;
            la.vel.z += (lb.vel.z - la.vel.z) * kk;
            const dvy = (lb.vel.y - la.vel.y) * kk;
            // Вниз тянем только то, что и должно провисать; вверх — свободно
            la.vel.y += dvy > 0 ? dvy : dvy * pull;
          }
        }
      }
    }

    /** Пересчёт вершин меша по весам зон */
    _deformMesh() {
      const pos = this.mesh.geometry.attributes.position.array;
      const stretch = this.stretchAttr.array;
      const heatArr = this.heatAttr.array;
      const sweatArr = this.sweatAttr.array;
      const cellArr = this.celluliteAttr.array;
      const base = this.basePos;
      const K = this.K;
      // Буфер смещений переиспользуем: пересоздание массива каждый кадр
      // на 60 зон × 60 fps давало заметный мусор для GC.
      const disp = this._dispBuf || (this._dispBuf = new Float32Array(this.nodes.length * 3));
      const tmp = _tmpDisp;
      // Предрасчёт смещений узлов
      for (let j = 0; j < this.nodes.length; j++) {
        this.nodes[j].displacement(tmp);
        disp[j * 3] = tmp.x; disp[j * 3 + 1] = tmp.y; disp[j * 3 + 2] = tmp.z;
      }
      const S = this.species.scale;

      /* Космическая форма: плавно догоняем целевое значение, чтобы переход
       * между стадиями не был скачком. Радиус сферы берём по габаритам
       * раздутого живота — так шар получается «сшитым» с телом. */
      this.cosmicVisual = U.damp(this.cosmicVisual || 0, this.cosmic || 0, 0.6, 1 / 60);
      const cosmic = this.cosmicVisual;
      let cosmicCY = 0, cosmicR = 1;
      if (cosmic > 0.001) {
        const bg = this.nodeById.mid_belly.growth;
        cosmicCY = (1.05 + bg * 0.08) * S;
        cosmicR = (1.15 + bg * 0.55) * S;
      }

      for (let i = 0; i < this.vertexCount; i++) {
        let dx = 0, dy = 0, dz = 0, str = 0, ht = 0, sw = 0, cl = 0;
        for (let k = 0; k < K; k++) {
          const idx = this.wIdx[i * K + k];
          if (idx < 0) break;
          const w = this.wVal[i * K + k];
          dx += disp[idx * 3] * w; dy += disp[idx * 3 + 1] * w; dz += disp[idx * 3 + 2] * w;
          const nd = this.nodes[idx];
          str += nd.growth * w;
          ht += nd.heat * w;
          sw += nd.sweat * w;
          cl += (nd.zone.cellulite || 0) * nd.growth * w;
        }
        let px = base[i * 3] + dx * S;
        let py = base[i * 3 + 1] + dy * S;
        let pz = base[i * 3 + 2] + dz * S;

        /* --- КОСМИЧЕСКАЯ ФОРМА ---
         * На сверхпоздних стадиях силуэт стягивается к сфере: каждая
         * вершина притягивается к поверхности шара вокруг центра массы.
         * Голова и лапы при этом тонут в плоти, как на референсе. */
        if (cosmic > 0.001) {
          const ox = px, oy = py - cosmicCY, oz = pz;
          const r = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1e-4;
          const k = cosmic * (1 - Math.pow(1 - cosmic, 2)) * 0.85;
          const target = cosmicR;
          const scale = 1 + (target / r - 1) * k;
          px = ox * scale;
          py = cosmicCY + oy * scale * 0.88;   // чуть приплюснут книзу
          pz = oz * scale;
        }

        pos[i * 3] = px;
        pos[i * 3 + 1] = py;
        pos[i * 3 + 2] = pz;
        stretch[i] = str;
        heatArr[i] = ht;
        sweatArr[i] = sw;
        cellArr[i] = cl;
      }
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.stretchAttr.needsUpdate = true;
      this.heatAttr.needsUpdate = true;
      this.sweatAttr.needsUpdate = true;
      this.celluliteAttr.needsUpdate = true;
      // Нормали: свой быстрый пересчёт, реже при удалении от игрока (LOD)
      this._normalTick = (this._normalTick || 0) + 1;
      const every = this._normalLOD || 3;
      if (this._normalTick % every === 0) this._fastNormals();
    }

    /**
     * ОПТИМИЗАЦИЯ: быстрый пересчёт нормалей.
     * Переиспользует существующие типизированные массивы (ноль аллокаций),
     * в отличие от THREE.computeVertexNormals, который каждый раз всё пересоздаёт.
     */
    _fastNormals() {
      const geo = this.mesh.geometry;
      const pos = geo.attributes.position.array;
      const nrm = geo.attributes.normal.array;
      const idx = geo.index.array;
      nrm.fill(0);
      for (let i = 0, n = idx.length; i < n; i += 3) {
        const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
        const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
        const e1x = pos[b] - ax, e1y = pos[b + 1] - ay, e1z = pos[b + 2] - az;
        const e2x = pos[c] - ax, e2y = pos[c + 1] - ay, e2z = pos[c + 2] - az;
        const cx = e1y * e2z - e1z * e2y;
        const cy = e1z * e2x - e1x * e2z;
        const cz = e1x * e2y - e1y * e2x;
        nrm[a] += cx; nrm[a + 1] += cy; nrm[a + 2] += cz;
        nrm[b] += cx; nrm[b + 1] += cy; nrm[b + 2] += cz;
        nrm[c] += cx; nrm[c + 1] += cy; nrm[c + 2] += cz;
      }
      for (let i = 0, n = nrm.length; i < n; i += 3) {
        const x = nrm[i], y = nrm[i + 1], z = nrm[i + 2];
        const len = Math.sqrt(x * x + y * y + z * z) || 1;
        nrm[i] = x / len; nrm[i + 1] = y / len; nrm[i + 2] = z / len;
      }
      geo.attributes.normal.needsUpdate = true;
    }

    /** Визор протогена: свечение, пиксельные глаза, реакция на эмоции */
    _updateProtogenFace(dt) {
      const t = performance.now() * 0.001;
      const emo = this.emotion;
      // Яркость визора зависит от настроения
      const targetGlow = emo === 'happy' || emo === 'bliss' ? 1.6
        : emo === 'giggle' ? 1.4
        : emo === 'sad' || emo === 'hungry' ? 0.45
        : emo === 'shy' ? 1.2 : 0.9;
      this.visorMat.emissiveIntensity = U.damp(
        this.visorMat.emissiveIntensity, targetGlow + Math.sin(t * 1.6) * 0.06, 6, dt);
      if (this.visorLight) this.visorLight.intensity = this.visorMat.emissiveIntensity * 0.85;

      // Цвет: смущение — розовее, голод — тусклее
      const base = new THREE.Color(this.species.visor);
      if (emo === 'shy') base.lerp(new THREE.Color(0xff6bb0), 0.45);
      else if (emo === 'sad' || emo === 'hungry') base.lerp(new THREE.Color(0x224455), 0.4);
      this.visorMat.emissive.lerp(base, 1 - Math.exp(-5 * dt));
      if (this.protoEyeMat) this.protoEyeMat.color.lerp(base, 1 - Math.exp(-5 * dt));

      // Пиксельные глаза: форма под эмоцию + моргание
      this._blinkT = (this._blinkT || 0) - dt;
      if (this._blinkT <= 0) { this._blinkT = U.rand(2.5, 6); this._blinking = 0.12; }
      this._blinking = Math.max(0, (this._blinking || 0) - dt);
      const blink = this._blinking > 0 ? 0.12 : 1;
      const happy = emo === 'happy' || emo === 'bliss' || emo === 'content';
      this.protoEyes.forEach((e, i) => {
        const side = i === 0 ? -1 : 1;
        e.scale.y = U.damp(e.scale.y, (happy ? 0.55 : 1) * blink, 16, dt);
        e.scale.x = U.damp(e.scale.x, happy ? 1.25 : 1, 10, dt);
        e.rotation.z = U.damp(e.rotation.z, happy ? side * 0.28 : 0, 8, dt);
        // При еде глаза «жуют» вместе с ртом
        if (this.mouthOpen > 0.3) e.scale.y *= 0.75;
      });

      // Голова следует за подбородками при росте
      const chinLift = (this.nodeById.chin1.growth + this.nodeById.chin2.growth) * 0.04;
      const S = this.species.scale;
      const hy = 2.02 * S + chinLift;
      if (this.visorShell) this.visorShell.position.y = hy;
      if (this.visorGlass) this.visorGlass.position.y = hy;
      this.protoEyes.forEach((e) => { e.position.y = hy + 0.035 * S; });
      if (this.visorLight) this.visorLight.position.y = hy + 0.02 * S;
    }

    /** Глаза, веки, рот, хвост */
    _updateFeatures(dt) {
      if (this.species.protogen) {
        this._updateProtogenFace(dt);
        this._updateTailAndWings(dt);
        return;
      }
      const S = this.species.scale;
      const t = performance.now() * 0.001;

      /* --- Куда «уехала» голова ---
       * Черты лица раньше висели на фиксированных координатах, а меш головы
       * при этом деформируется вместе с зонами лица и шеи. С ростом стадии
       * расхождение достигало 0.28 м — глаза и нос буквально проваливались
       * внутрь морды. Теперь берём реальное смещение вершин головы и сдвигаем
       * черты вместе с ней, а вперёд выносим по фактической границе морды. */
      const hs = this._headSample || (this._headSample = this._pickHeadSamples());
      let dY = 0, dZ = 0, front = 0;
      if (hs.len) {
        const pos = this.mesh.geometry.attributes.position.array;
        const base = this.basePos;
        for (let i = 0; i < hs.len; i++) {
          const v = hs.idx[i];
          dY += pos[v * 3 + 1] - base[v * 3 + 1];
          dZ += pos[v * 3 + 2] - base[v * 3 + 2];
        }
        dY /= hs.len; dZ /= hs.len;
        // Передняя точка морды: чтобы нос всегда торчал наружу, а не внутрь
        front = -Infinity;
        for (let i = 0; i < hs.muzzleLen; i++) {
          const v = hs.muzzle[i];
          if (pos[v * 3 + 2] > front) front = pos[v * 3 + 2];
        }
      }
      // Голова поднимается при росте шеи/подбородков
      const chinLift = (this.nodeById.chin1.growth + this.nodeById.chin2.growth + this.nodeById.chin3.growth) * 0.045;
      const headY = 2.06 * S + chinLift + dY;
      const faceZ = isFinite(front) && front > 0 ? front : 0.34 * S;

      // Моргание
      this._blinkT = (this._blinkT || 0) - dt;
      if (this._blinkT <= 0) { this._blinkT = U.rand(2.2, 6.5); this._blinking = 0.18; }
      this._blinking = Math.max(0, (this._blinking || 0) - dt);
      // Сонливость и стеснение прикрывают глаза сами по себе
      const sleepy = 1 - U.clamp(this.eyeOpen !== undefined ? this.eyeOpen : 1, 0, 1);
      const lidClose = this._blinking > 0 ? 1
        : Math.max(sleepy, this.emotion === 'bliss' || this.emotion === 'content' ? 0.55 : 0.08);

      // Глаза сидят на скулах: чуть позади кончика морды и выше неё
      const eyeZ = faceZ - 0.13 * S + Math.sin(t * 0.7) * 0.002;
      this.eyes.forEach((e, i) => {
        const s = i === 0 ? -1 : 1;
        e.position.set(s * 0.10 * S, headY, eyeZ);
        const lid = this.lids[i];
        lid.position.copy(e.position);
        lid.position.y += 0.03;
        lid.scale.y = U.damp(lid.scale.y, 0.08 + lidClose * 1.15, 18, dt);
      });
      // Нос — на самом кончике морды, рот чуть ниже и глубже
      this.nose.position.set(0, headY - 0.075 * S, faceZ + 0.012 * S);
      this.mouth.position.set(0, headY - 0.125 * S, faceZ - 0.008 * S);
      this.mouth.scale.set(1 + this.mouthOpen * 0.5, 0.22 + this.mouthOpen * 1.5, 0.5 + this.mouthOpen * 0.4);

      // Улыбка/эмоция через наклон глаз
      const happy = this.emotion === 'happy' || this.emotion === 'bliss' || this.emotion === 'giggle';
      this.eyes.forEach((e) => { e.rotation.z = U.damp(e.rotation.z, happy ? 0.2 : 0, 8, dt); });

      /* --- EYE CONTACT: зрачки следят за рукой игрока ---
       * Друг замечает протянутую ладонь и провожает её взглядом,
       * предвкушая касание. Смещаем зрачок внутри глазного яблока. */
      if (this.gazeTarget && this.gazeWeight > 0.01 && this.pupils) {
        const head = _tmpDisp.set(0, headY, faceZ);
        this.root.localToWorld(head);
        const to = _tmpWaveA.copy(this.gazeTarget).sub(head).normalize();
        // Переводим направление в локальные оси головы
        const lx = U.clamp(to.x * 0.020, -0.016, 0.016) * this.gazeWeight;
        const ly = U.clamp(to.y * 0.014, -0.012, 0.012) * this.gazeWeight;
        this.pupils.forEach((pu) => {
          pu.position.x = U.damp(pu.position.x, lx, 10, dt);
          pu.position.y = U.damp(pu.position.y, ly, 10, dt);
        });
      }

      /* Уши — часть слитого меша тела, отдельных объектов нет. Их
       * «опускание» отыгрываем через зону надбровных валиков и наклон
       * головы: этого достаточно, чтобы читалась сонливость. */
      const droop = this.earDroop || 0;
      if (droop > 0.01 && this.nodeById.brow_ridges) {
        this.nodeById.brow_ridges.offset.y -= droop * 0.004;
      }

      this._updateTailAndWings(dt);
    }

    /** Покачивание хвоста и крыльев — общее для всех видов */
    _updateTailAndWings(dt) {
      const t = performance.now() * 0.001;
      // Хвост: покачивание пропорционально настроению
      if (!this._tailPhase) this._tailPhase = 0;
      this._tailPhase += dt * (1.2 + this.mood * 2.2);
      const tailNode = this.nodeById.tail_base;
      tailNode.offset.x += Math.sin(this._tailPhase) * dt * 0.5 * this.mood;

      // Крылья дракона
      if (this.wings) this.wings.forEach((w, i) => {
        w.rotation.x = 0.4 + Math.sin(t * 1.6 + i) * 0.12 * this.mood;
      });
    }

    /** Одежда натягивается, задирается и исчезает по стадиям */
    /**
     * ОДЕЖДА.
     *
     * Раньше футболка и шорты были обычными шарами, которые лишь
     * масштабировались по росту зон. Тело при этом деформируется по 60 зонам
     * и растёт неравномерно — поэтому шар быстро переставал совпадать с
     * силуэтом и торчал наружу синим пузырём прямо сквозь живот.
     *
     * Теперь одежда — это КОПИЯ вершин самого тела: берём те же позиции,
     * что и у кожи, и раздуваем их вдоль нормали на пару сантиметров.
     * Ткань физически не может оказаться внутри тела или вылезти из него,
     * потому что повторяет его форму кадр в кадр.
     */
    _updateClothes() {
      const stage = this.stage;
      const shirtVisible = stage < 6;
      const shortsVisible = stage < 7;
      this.shirt.visible = shirtVisible;
      this.shorts.visible = shortsVisible;
      if (!shirtVisible && !shortsVisible) return;

      const src = this.mesh.geometry.attributes.position.array;
      const nrm = this.mesh.geometry.attributes.normal.array;
      const S = this.species.scale;

      // Ткань облегает плоть с небольшим зазором и слегка «надувается»
      // там, где тело растянуто сильнее.
      const OFF_SHIRT = 0.022 * S;
      const OFF_SHORTS = 0.020 * S;

      if (shirtVisible && this.shirtMap) {
        const dst = this.shirt.geometry.attributes.position.array;
        for (let i = 0; i < this.shirtMap.length; i++) {
          const v = this.shirtMap[i];
          dst[i * 3]     = src[v * 3]     + nrm[v * 3]     * OFF_SHIRT;
          dst[i * 3 + 1] = src[v * 3 + 1] + nrm[v * 3 + 1] * OFF_SHIRT;
          dst[i * 3 + 2] = src[v * 3 + 2] + nrm[v * 3 + 2] * OFF_SHIRT;
        }
        this.shirt.geometry.attributes.position.needsUpdate = true;
        this.shirt.geometry.computeVertexNormals();
        // Чем больше стадия, тем сильнее ткань истончается и рвётся
        this.shirt.material.opacity = U.clamp(1 - Math.max(0, stage - 4) * 0.45, 0.12, 1);
        this.shirt.material.transparent = this.shirt.material.opacity < 1;
      }

      if (shortsVisible && this.shortsMap) {
        const dst = this.shorts.geometry.attributes.position.array;
        for (let i = 0; i < this.shortsMap.length; i++) {
          const v = this.shortsMap[i];
          dst[i * 3]     = src[v * 3]     + nrm[v * 3]     * OFF_SHORTS;
          dst[i * 3 + 1] = src[v * 3 + 1] + nrm[v * 3 + 1] * OFF_SHORTS;
          dst[i * 3 + 2] = src[v * 3 + 2] + nrm[v * 3 + 2] * OFF_SHORTS;
        }
        this.shorts.geometry.attributes.position.needsUpdate = true;
        this.shorts.geometry.computeVertexNormals();
        this.shorts.material.opacity = U.clamp(1 - Math.max(0, stage - 5) * 0.5, 0.12, 1);
        this.shorts.material.transparent = this.shorts.material.opacity < 1;
      }
    }

    /** Радиус тела на заданной высоте — для коллизий игрока */
    radiusAt(localY) {
      const S = this.species.scale;
      let r = 0.15;
      for (const nd of this.nodes) {
        const dy = Math.abs(localY - nd.base.y * S);
        if (dy > nd.zone.radius * S * 1.5) continue;
        const w = Math.exp(-dy * 2.2);
        const rr = (Math.hypot(nd.base.x, nd.base.z) + nd.zone.gain * nd.growth + nd.zone.radius * 0.5) * S;
        r = Math.max(r, rr * w + 0.12);
      }
      return r;
    }

    /** Высота верхней точки тела (для карабканья) */
    topY() {
      const S = this.species.scale;
      return this.root.position.y + (2.25 * S + this.nodeById.upper_chest.growth * 0.2) * this.bodyScale;
    }

    serialize() {
      return {
        calories: this.calories, mood: this.mood, hunger: this.hunger, relation: this.relation,
        species: this.opts.species, build: this.opts.build, name: this.opts.name, furColor: this.opts.furColor,
        eyeColor: this.opts.eyeColor, stats: this.stats, permanentMobility: this.permanentMobility,
        pos: this.root.position.toArray(),
        digestion: this.digestion ? this.digestion.serialize() : null,
        emotions: this.emotions ? this.emotions.serialize() : null,
        quirks: this.quirks ? this.quirks.serialize() : null,
      };
    }
    deserialize(d) {
      if (!d) return;
      this.calories = d.calories || 0;
      this.mood = d.mood != null ? d.mood : 0.75;
      this.hunger = d.hunger || 0.2;
      this.relation = d.relation || 0;
      this.stats = d.stats || this.stats;
      this.permanentMobility = !!d.permanentMobility;
      if (d.pos) this.root.position.fromArray(d.pos);
      // Старые сейвы поля digestion не содержат — тогда желудок просто пуст
      if (this.digestion) this.digestion.deserialize(d.digestion);
      if (this.emotions) this.emotions.deserialize(d.emotions);
      if (this.quirks) this.quirks.deserialize(d.quirks);
      this._updateGrowthTargets(true);
      this.bodyScale = this.bodyScaleTarget;
      this.root.scale.setScalar(this.bodyScale);
    }
  }

  FF.FurryEngine = FurryEngine;
})(typeof window !== 'undefined' ? window : globalThis);
