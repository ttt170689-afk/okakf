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

  /** Узел мягкого тела — одна из 60 зон */
  class SoftNode {
    constructor(zone, index) {
      this.zone = zone;
      this.index = index;
      this.base = new THREE.Vector3().fromArray(zone.pos);
      this.dir = new THREE.Vector3().fromArray(zone.dir).normalize();
      this.offset = new THREE.Vector3();   // текущее динамическое смещение (жир)
      this.vel = new THREE.Vector3();      // скорость
      this.dent = new THREE.Vector3();     // вмятина от касания
      this.dentVel = new THREE.Vector3();
      this.growth = 0;                     // 0..1 визуальный рост
      this.growthTarget = 0;
      this.calories = 0;                   // накоплено в зоне
      this.heat = 0;                       // «нагрев» от массажа (для эмоций)
      this.mass = zone.mass;
      this.soft = zone.soft;
      this.damp = zone.damp;
    }

    /** Импульс по мягкому телу (тычок, шлепок, шаг) с гипер-реакцией живота */
    impulse(vec, strength) {
      const k = strength / Math.max(3, this.mass);
      this.vel.addScaledVector(vec, k);
      // ГИПЕР-ФИЗИКА: живот реагирует сильнее, чем другие зоны
      if (this.zone.id === 'mid_belly' || this.zone.id === 'lower_belly' || this.zone.id === 'upper_belly' || this.zone.id === 'apron_fold') {
        this.vel.multiplyScalar(1.35);
      }
    }

    /** Вмятина в точке касания */
    press(dirVec, depth) {
      this.dentVel.addScaledVector(dirVec, depth * this.soft * 1.6);
      this.heat = Math.min(1, this.heat + depth * 0.4);
    }

    step(dt, gravitySag, globalDamp) {
      const z = this.zone;
      // Пружина возврата к позе (pose matching): чем мягче, тем слабее
      const stiff = 26 * (1.15 - this.soft) + 5;
      const damping = 5.5 + this.damp * 22;
      const g = this.growth;

      // Сила пружины
      this.vel.addScaledVector(this.offset, -stiff * dt);
      // Гравитационное провисание жира — тем сильнее, чем больше рост
      this.vel.y -= gravitySag * g * this.soft * dt * 5.2;
      // Затухание
      const d = Math.exp(-damping * dt * (1.0 - this.soft * 0.45));
      this.vel.multiplyScalar(d);
      this.offset.addScaledVector(this.vel, dt);

      // Ограничение амплитуды
      const maxOff = FF.CONFIG.soft.maxOffset * (0.35 + g);
      if (this.offset.lengthSq() > maxOff * maxOff) this.offset.setLength(maxOff);

      // Вмятина восстанавливается своей пружиной (быстрее)
      this.dentVel.addScaledVector(this.dent, -60 * dt);
      this.dentVel.multiplyScalar(Math.exp(-9 * dt));
      this.dent.addScaledVector(this.dentVel, dt);
      const maxDent = 0.28 * (0.3 + g);
      if (this.dent.lengthSq() > maxDent * maxDent) this.dent.setLength(maxDent);

      this.heat = Math.max(0, this.heat - dt * 0.35);
      this.growth = U.damp(this.growth, this.growthTarget, FF.CONFIG.growth.lerpSpeed, dt);
    }

    /** Итоговое смещение точки зоны */
    displacement(out) {
      const g = this.growth;
      const gain = this.zone.gain;
      return out.copy(this.dir).multiplyScalar(gain * g)
        .add(this.offset)
        .add(this.dent);
    }
  }

  /* ============================================================
   * Шейдер кожи: SSS-имитация + stress + wet + fur-грейн
   * ============================================================ */
  const SKIN_VERT_PARS = `
    attribute float part;
    attribute float stretch;
    varying float vStretch;
    varying float vPart;
    varying vec3 vLocalPos;
  `;
  const SKIN_VERT_MAIN = `
    vStretch = stretch;
    vPart = part;
    vLocalPos = position;
  `;
  const SKIN_FRAG_PARS = `
    uniform vec3 uFurColor;
    uniform vec3 uBellyColor;
    uniform float uWet;
    uniform float uFurDensity;
    uniform float uBlush;
    uniform float uTime;
    varying float vStretch;
    varying float vPart;
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

    diffuseColor.rgb *= baseCol;
  `;
  const SKIN_FRAG_ROUGH = `
    float st2 = clamp(vStretch, 0.0, 1.0);
    roughnessFactor = mix(roughnessFactor, 0.22, st2 * 0.7);
    roughnessFactor = mix(roughnessFactor, 0.12, uWet);
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

      this.nodes = FF.ZONES.map((z, i) => new SoftNode(z, i));
      this.nodeById = Object.fromEntries(this.nodes.map((n) => [n.zone.id, n]));

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
    _buildFeatures() {
      const S = this.species.scale;
      // Протоген строится иначе: визор вместо глаз и морды
      if (this.species.protogen) return this._buildProtogenFeatures();
      // --- Милое личико: глаза больше, нос меньше, морда милее ---
      const eyeMat = new THREE.MeshStandardMaterial({ color: this.opts.eyeColor, roughness: 0.15, emissive: 0x111111 });
      const scleraMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1418, roughness: 0.5 });

      this.eyes = [];
      for (const s of [-1, 1]) {
        const g = new THREE.Group();
        const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 14), scleraMat); // больше глаза
        const iris = new THREE.Mesh(new THREE.SphereGeometry(0.044, 16, 12), eyeMat); // больше радужка
        iris.position.z = 0.032;
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.020, 12, 9), darkMat); // милые зрачки
        pupil.position.z = 0.052;
        g.add(sclera, iris, pupil);
        g.position.set(s * 0.11 * S, 2.08 * S, 0.18 * S); // чуть выше для милости
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

      // Нос — милый, маленький
      this.nose = new THREE.Mesh(new THREE.SphereGeometry(0.025 * S, 12, 10), darkMat);
      this.nose.position.set(0, 1.995 * S, 0.30 * S);
      this.root.add(this.nose);

      // Рот (открывается при еде)
      this.mouth = new THREE.Mesh(
        new THREE.SphereGeometry(0.062 * S, 14, 10),
        new THREE.MeshStandardMaterial({ color: 0x50202a, roughness: 0.6 }));
      this.mouth.position.set(0, 1.935 * S, 0.30 * S);
      this.mouth.scale.set(1, 0.25, 0.5);
      this.root.add(this.mouth);
      this.mouthOpen = 0;

      // Одежда (растягивается и рвётся по стадиям)
      const shirtMat = new THREE.MeshStandardMaterial({
        color: 0x5aa7d8, roughness: 0.85, side: THREE.DoubleSide, transparent: true,
      });
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

      for (let i = 0; i < n; i++) {
        v.set(this.basePos[i * 3], this.basePos[i * 3 + 1], this.basePos[i * 3 + 2]);
        tmp.length = 0;
        for (let j = 0; j < this.nodes.length; j++) {
          const nd = this.nodes[j];
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
        // Логарифмическая кривая насыщения — «медленное удовольствие»
        const t = 1 - Math.exp(-eff * sp.mult * (this.build.growthMult || 1) / 42000);
        nd.growthTarget = U.clamp(t, 0, 1);
        nd.calories = eff * sp.mult;
        if (instant) nd.growth = nd.growthTarget;
      }
      // Глобальный масштаб тела: гигант становится огромным.
      // Теперь растёт и в ширину (x, z), не только вверх (y), чтобы живот был объёмным.
      const massRatio = 1 + cal * FF.CONFIG.growth.caloriesToKg / FF.CONFIG.growth.baseMassKg;
      const cubic = Math.pow(massRatio, 0.30);
      // Ширина растёт чуть быстрее, чем высота — жир идёт вширь, а не в небо
      this.bodyScaleTarget = U.clamp(cubic * (1 + this.stage * 0.06), 1, 3.8);
      if (instant) this.bodyScale = this.bodyScaleTarget;

      // Стадия
      const th = FF.CONFIG.growth.stageThresholds;
      let st = 0;
      for (let i = 0; i < th.length; i++) if (cal >= th[i]) st = i;
      const prev = this.stage;
      this.stage = st;
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
          setTimeout(() => { this.mouthOpen = 0; this.audio && this.audio.voice('happy', this.opts.species); }, 220);
          return;
        }
        this.mouthOpen = i % 2 ? 0.25 : 0.75;
        this.audio && this.audio.chew();
        i++;
        setTimeout(doChew, 130);
      };
      this.mouthOpen = 0.9;
      setTimeout(doChew, 150);
      if (cal > 60) setTimeout(() => this.audio && this.audio.voice('moan', this.opts.species), 900);
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
      if (Math.random() < dt * 0.5) { this.audio && this.audio.voice('moan', this.opts.species); this.setEmotion('bliss', 2); }
      this.stats.massages += dt;
      return nd;
    }

    /** Волна колыхания от точки (распространяется по узлам) */
    wave(worldPoint, strength = 1) {
      const local = this.root.worldToLocal(worldPoint.clone());
      const S = this.species.scale;
      for (const nd of this.nodes) {
        const d = Math.hypot(local.x - nd.base.x * S, local.y - nd.base.y * S, local.z - nd.base.z * S);
        const falloff = Math.exp(-d * 1.5);
        if (falloff < 0.01) continue;
        const dir = new THREE.Vector3(
          nd.base.x * S - local.x, nd.base.y * S - local.y + 0.2, nd.base.z * S - local.z
        ).normalize();
        // Задержка распространения волны (реалистично)
        const delay = d * 60;
        setTimeout(() => nd.impulse(dir, 16 * strength * falloff * nd.growth), delay);
      }
      if (strength > 0.8) this.audio && this.audio.jiggle(Math.min(1.5, strength));
    }

    /** Прыжок игрока на животе — батут */
    bounce(worldPoint, power = 1) {
      const nd = this.zoneAt(worldPoint) || this.nodeById.mid_belly;
      nd.impulse(new THREE.Vector3(0, -1, 0), 42 * power);
      this.wave(worldPoint, 2.2 * power);
      this.stats.bounces++;
      this.audio && this.audio.slap(1.4);
      this.setEmotion('giggle', 2.5);
      if (Math.random() < 0.4) this.audio && this.audio.voice('giggle', this.opts.species);
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
      const hungerRate = 1 / (cfg.feeding.hungerPeriodMin * 60);
      this.hunger = U.clamp(this.hunger + dt * hungerRate * 60 * 0.016, 0, 1);
      if (this.hunger > 0.75) this.mood = U.clamp(this.mood - dt * 0.01, 0, 1);
      else this.mood = U.clamp(this.mood + dt * 0.004, 0, 1);
      this.blush = Math.max(0, this.blush - dt * 0.25);
      this.wet = Math.max(0, this.wet - dt * 0.03);
      this.emotionTimer -= dt;
      if (this.emotionTimer <= 0) this.emotion = this.hunger > 0.7 ? 'hungry' : this.mood > 0.7 ? 'content' : 'neutral';
      this.speechTimer -= dt;
      this._updateMobility();

      // ГИПЕР-ФИЗИКА ЖИВОТА: постоянное мягкое колыхание + усиление при касании
      for (const nd of this.nodes) {
        if (nd.zone.group === 'belly') {
          const shake = Math.sin(performance.now() * 0.008 + nd.index * 2.1) * 0.028 * (1 + nd.growth);
          nd.offset.x += shake * dt * 30;
          nd.offset.z += Math.sin(performance.now() * 0.006 + nd.index) * 0.018 * (1 + nd.growth) * dt * 30;
        }
      }

      // Дыхание
      const breathRate = 0.55 + this.stage * 0.07 + (1 - this.mood) * 0.1;
      this.breathPhase += dt * breathRate;
      const breath = Math.sin(this.breathPhase * Math.PI * 2);
      const chest = this.nodeById.upper_chest, belly = this.nodeById.mid_belly;
      chest.offset.z += breath * dt * 0.35;
      belly.offset.z += breath * dt * 0.22 * (0.4 + belly.growth);
      if (Math.random() < dt * 0.25 && this.stage > 4) this.audio && this.audio.voice('breath', this.opts.species);

      // Случайное урчание / реплики
      this.talkTimer -= dt;
      if (this.talkTimer <= 0) {
        this.talkTimer = U.rand(14, 34);
        if (this.hunger > 0.65) this.say(U.pick(['Мур... я хочу кушать...', 'Пожалуйста, покорми меня~', 'В животике пусто...']));
        else if (this.mood > 0.8) this.say(U.pick(['Мур... мне так уютно...', 'Я тебя люблю...', 'Гладь меня~', 'Так вкусно было!']));
        else if (this.stage >= 7) this.say(U.pick(['Ой, я такой толстый!', 'Я не могу двигаться...', 'Мне нужен эликсир...']));
        else if (this.audio) this.audio.voice(this.species.purr ? 'purr' : 'mur', this.opts.species);
      }

      // Физика узлов
      const sub = cfg.soft.substeps;
      const h = dt / sub;
      for (let s = 0; s < sub; s++) {
        for (const nd of this.nodes) nd.step(h, cfg.soft.gravitySag, cfg.soft.globalDamping);
        // Связь соседних узлов (передача волны)
        this._couple(h);
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
      const k = FF.CONFIG.soft.neighborCoupling * dt * 60 * 0.016;
      for (let i = 0; i < this.nodes.length; i++) {
        const a = this.nodes[i];
        for (const [b, w] of this._neighbors[i]) {
          const f = (b.vel.x - a.vel.x) * w * k;
          const g = (b.vel.y - a.vel.y) * w * k;
          const hh = (b.vel.z - a.vel.z) * w * k;
          a.vel.x += f; a.vel.y += g; a.vel.z += hh;
        }
      }
    }

    /** Пересчёт вершин меша по весам зон */
    _deformMesh() {
      const pos = this.mesh.geometry.attributes.position.array;
      const stretch = this.stretchAttr.array;
      const base = this.basePos;
      const K = this.K;
      const disp = [];
      const tmp = new THREE.Vector3();
      // Предрасчёт смещений узлов
      for (let j = 0; j < this.nodes.length; j++) {
        this.nodes[j].displacement(tmp);
        disp.push(tmp.x, tmp.y, tmp.z);
      }
      const S = this.species.scale;
      for (let i = 0; i < this.vertexCount; i++) {
        let dx = 0, dy = 0, dz = 0, str = 0;
        for (let k = 0; k < K; k++) {
          const idx = this.wIdx[i * K + k];
          if (idx < 0) break;
          const w = this.wVal[i * K + k];
          dx += disp[idx * 3] * w; dy += disp[idx * 3 + 1] * w; dz += disp[idx * 3 + 2] * w;
          str += this.nodes[idx].growth * w;
        }
        pos[i * 3] = base[i * 3] + dx * S;
        pos[i * 3 + 1] = base[i * 3 + 1] + dy * S;
        pos[i * 3 + 2] = base[i * 3 + 2] + dz * S;
        stretch[i] = str;
      }
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.stretchAttr.needsUpdate = true;
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
      // Голова поднимается при росте шеи/подбородков
      const chinLift = (this.nodeById.chin1.growth + this.nodeById.chin2.growth + this.nodeById.chin3.growth) * 0.045;
      const headY = 2.06 * S + chinLift;
      const t = performance.now() * 0.001;

      // Моргание
      this._blinkT = (this._blinkT || 0) - dt;
      if (this._blinkT <= 0) { this._blinkT = U.rand(2.2, 6.5); this._blinking = 0.18; }
      this._blinking = Math.max(0, (this._blinking || 0) - dt);
      const lidClose = this._blinking > 0 ? 1 : (this.emotion === 'bliss' || this.emotion === 'content' ? 0.55 : 0.08);

      this.eyes.forEach((e, i) => {
        const s = i === 0 ? -1 : 1;
        e.position.set(s * 0.10 * S, headY, 0.19 * S + Math.sin(t * 0.7) * 0.002);
        const lid = this.lids[i];
        lid.position.copy(e.position);
        lid.position.y += 0.03;
        lid.scale.y = U.damp(lid.scale.y, 0.08 + lidClose * 1.15, 18, dt);
      });
      this.nose.position.y = headY - 0.075 * S;
      this.mouth.position.y = headY - 0.125 * S;
      this.mouth.scale.set(1 + this.mouthOpen * 0.5, 0.22 + this.mouthOpen * 1.5, 0.5 + this.mouthOpen * 0.4);

      // Улыбка/эмоция через наклон глаз
      const happy = this.emotion === 'happy' || this.emotion === 'bliss' || this.emotion === 'giggle';
      this.eyes.forEach((e) => { e.rotation.z = U.damp(e.rotation.z, happy ? 0.2 : 0, 8, dt); });

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
    _updateClothes() {
      const S = this.species.scale;
      const belly = this.nodeById.mid_belly.growth;
      const upper = this.nodeById.upper_belly.growth;
      const chest = (this.nodeById.left_moob.growth + this.nodeById.right_moob.growth) * 0.5;
      const glute = (this.nodeById.lower_left_glute.growth + this.nodeById.lower_right_glute.growth) * 0.5;

      const stage = this.stage;
      // Рубашка растягивается, затем задирается, затем рвётся (исчезает)
      const shirtVisible = stage < 6;
      this.shirt.visible = shirtVisible;
      if (shirtVisible) {
        const grow = 1 + belly * 0.75 + upper * 0.3;
        this.shirt.scale.set(0.47 * S * grow, 0.52 * S * (1 + upper * 0.2), 0.40 * S * (1 + belly * 0.9));
        this.shirt.position.y = (1.34 + belly * 0.30) * S;  // задирается вверх
        this.shirt.position.z = belly * 0.22 * S;
        this.shirt.material.opacity = U.clamp(1 - Math.max(0, stage - 4) * 0.45, 0.12, 1);
        this.shirt.material.transparent = this.shirt.material.opacity < 1;
      }
      const shortsVisible = stage < 7;
      this.shorts.visible = shortsVisible;
      if (shortsVisible) {
        this.shorts.scale.set(0.46 * S * (1 + glute * 0.85), 0.28 * S * (1 + glute * 0.3), 0.40 * S * (1 + glute * 0.9));
        this.shorts.position.y = (0.78 - glute * 0.05) * S;
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
      this._updateGrowthTargets(true);
      this.bodyScale = this.bodyScaleTarget;
      this.root.scale.setScalar(this.bodyScale);
    }
  }

  FF.FurryEngine = FurryEngine;
})(typeof window !== 'undefined' ? window : globalThis);
