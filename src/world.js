/**
 * world.js — Генератор мира Sugar City.
 * Процедурно строит: землю, дороги, площадь с шоколадным фонтаном,
 * часовую башню, кафе, коттедж игрока, ферму, мельницу, лес, парк, горы,
 * лабораторию Артёма, уличные фонари, NPC-фигурки, точки сбора ингредиентов.
 * Плюс: динамическое небо, освещение golden hour, погода, частицы.
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  const MAT = {};
  function mat(name, params) {
    if (!MAT[name]) MAT[name] = new THREE.MeshStandardMaterial(params);
    return MAT[name];
  }

  class World {
    constructor(scene, renderer, audio) {
      this.scene = scene;
      this.renderer = renderer;
      this.audio = audio;
      this.colliders = [];       // {type:'box'|'cyl', ...} для игрока
      this.interactables = [];   // {pos, radius, label, action, id}
      this.pickups = [];         // собираемые ингредиенты
      this.npcs = [];
      this.lights = [];
      this.decor = new THREE.Group();
      scene.add(this.decor);

      this._buildSky();
      this._buildLighting();
      this._buildGround();
      this._buildRoads();
      this._buildSquare();
      this._buildCottage();
      this._buildCafes();
      this._buildLab();
      this._buildFarmAndMill();
      this._buildForest();
      this._buildPark();
      this._buildMountains();
      this._buildMiscBuildings();
      this._buildSecretVault();
      this._buildNPCs();
      this._buildParticles();
      this.weather = 'clear';
      this.rainGroup = null;
    }

    /* ==================== НЕБО ==================== */
    _buildSky() {
      const geo = new THREE.SphereGeometry(700, 32, 20);
      const uniforms = {
        uTop: { value: new THREE.Color(0x3a5a9a) },
        uMid: { value: new THREE.Color(0xff9e6b) },
        uBot: { value: new THREE.Color(0xffd9a8) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.25, -0.8) },
        uStars: { value: 0 },
      };
      const material = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, uniforms,
        vertexShader: `varying vec3 vWorld;
          void main(){ vWorld = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 uTop, uMid, uBot; uniform vec3 uSunDir; uniform float uStars;
          varying vec3 vWorld;
          float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
          void main(){
            float h = vWorld.y;
            vec3 col = mix(uBot, uMid, smoothstep(-0.1, 0.28, h));
            col = mix(col, uTop, smoothstep(0.2, 0.75, h));
            // Солнечное гало
            float sd = max(0.0, dot(normalize(vWorld), normalize(uSunDir)));
            col += vec3(1.0, 0.6, 0.3) * pow(sd, 24.0) * 0.85;
            col += vec3(1.0, 0.75, 0.5) * pow(sd, 4.0) * 0.16;
            // Звёзды ночью
            if (uStars > 0.01) {
              vec3 sp = floor(vWorld * 320.0);
              float s = step(0.9975, hash(sp));
              col += vec3(s) * uStars * (0.5 + 0.5 * hash(sp + 1.0)) * smoothstep(0.0, 0.3, h);
            }
            gl_FragColor = vec4(col, 1.0);
          }`,
      });
      this.sky = new THREE.Mesh(geo, material);
      this.sky.frustumCulled = false;
      this.scene.add(this.sky);
      this.skyUniforms = uniforms;
    }

    /* ==================== ОСВЕЩЕНИЕ ==================== */
    _buildLighting() {
      this.ambient = new THREE.HemisphereLight(0xffd2a0, 0x5a4a3a, 0.75);
      this.scene.add(this.ambient);

      this.sun = new THREE.DirectionalLight(0xffb178, 2.1);
      this.sun.position.set(60, 45, -110);
      this.sun.castShadow = true;
      const S = FF.CONFIG.render.shadowMapSize;
      this.sun.shadow.mapSize.set(S, S);
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 180;
      const d = 52;
      Object.assign(this.sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
      this.sun.shadow.bias = -0.0009;
      this.sun.shadow.normalBias = 0.035;
      this.scene.add(this.sun);
      this.scene.add(this.sun.target);

      this.fill = new THREE.DirectionalLight(0x88aaff, 0.30);
      this.fill.position.set(-50, 30, 60);
      this.scene.add(this.fill);

      this.scene.fog = new THREE.FogExp2(0xffc9a0, 0.0038);
    }

    /* ==================== ЗЕМЛЯ ==================== */
    _buildGround() {
      const size = 700, seg = 120;
      const geo = new THREE.PlaneGeometry(size, size, seg, seg);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const cGrass = new THREE.Color(0x8fc96a), cSand = new THREE.Color(0xe8c9a0), cSnow = new THREE.Color(0xf2f6fb);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        // Холмистость + горы на севере
        let y = U.fbm(x * 0.008, 0, z * 0.008, 3) * 3.2 - 1.4;
        const mtn = Math.max(0, -(z + 120) / 70);
        y += Math.pow(mtn, 1.7) * 46 * (0.6 + U.fbm(x * 0.02, 5, z * 0.02, 3) * 0.8);
        // Плоская зона города
        const dCity = Math.hypot(x, z);
        const flat = U.smoothstep(150, 40, dCity);
        y = U.lerp(y, 0, flat);
        pos.setY(i, y);
        const t = U.clamp((y - 12) / 20, 0, 1);
        c.copy(cGrass).lerp(cSand, U.clamp(U.fbm(x * 0.05, 1, z * 0.05, 2) * 0.5, 0, 0.35)).lerp(cSnow, t);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
      this.ground = new THREE.Mesh(geo, m);
      this.ground.receiveShadow = true;
      this.scene.add(this.ground);
      this.groundGeo = geo;
    }

    /** Высота земли в точке (быстрая аппроксимация той же формулы) */
    heightAt(x, z) {
      let y = U.fbm(x * 0.008, 0, z * 0.008, 3) * 3.2 - 1.4;
      const mtn = Math.max(0, -(z + 120) / 70);
      y += Math.pow(mtn, 1.7) * 46 * (0.6 + U.fbm(x * 0.02, 5, z * 0.02, 3) * 0.8);
      const flat = U.smoothstep(150, 40, Math.hypot(x, z));
      return U.lerp(y, 0, flat);
    }

    /* ==================== ДОРОГИ ==================== */
    _buildRoads() {
      const roadMat = mat('road', { color: 0xe8d8c0, roughness: 0.92 });
      const g = new THREE.Group();
      const connect = (a, b, w = 6) => {
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), roadMat);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -Math.atan2(dx, dz);
        m.position.set((a.x + b.x) / 2, 0.03, (a.z + b.z) / 2);
        m.receiveShadow = true;
        g.add(m);
      };
      const sq = { x: 0, z: 0 };
      for (const id of ['cottage', 'sweetpaw', 'chocodreams', 'creampalace', 'bakery', 'pumpcafe', 'lab', 'farm', 'park', 'market', 'library', 'spa', 'post', 'bank', 'clothes', 'club']) {
        const l = FF.LOC_BY_ID[id];
        connect(sq, l, id === 'cottage' || id === 'farm' ? 7 : 5);
      }
      connect(FF.LOC_BY_ID.farm, FF.LOC_BY_ID.mill, 5);
      connect(FF.LOC_BY_ID.cottage, FF.LOC_BY_ID.forest, 5);
      this.scene.add(g);
      this.roads = g;
    }

    /* ==================== ПЛОЩАДЬ ==================== */
    _buildSquare() {
      const g = new THREE.Group();
      // Мощение
      const plaza = new THREE.Mesh(new THREE.CircleGeometry(26, 48),
        mat('plaza', { color: 0xf7e3c8, roughness: 0.7, metalness: 0.05 }));
      plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.04; plaza.receiveShadow = true;
      g.add(plaza);

      // Шоколадный фонтан (3 яруса + падающий шоколад)
      const chocoMat = new THREE.MeshStandardMaterial({ color: 0x5c3317, roughness: 0.18, metalness: 0.25 });
      const stoneMat = mat('stone', { color: 0xe0cdb4, roughness: 0.85 });
      const fountain = new THREE.Group();
      fountain.add(this._cyl(4.2, 4.6, 1.0, stoneMat, 0, 0.5, 0));
      const pool = this._cyl(3.9, 3.9, 0.35, chocoMat, 0, 1.05, 0);
      fountain.add(pool);
      const tiers = [[2.6, 3.0], [1.7, 4.9], [1.0, 6.6]];
      tiers.forEach(([r, y]) => {
        fountain.add(this._cyl(0.35, 0.35, y - 1.0, stoneMat, 0, 1.0 + (y - 1.0) / 2, 0));
        fountain.add(this._cyl(r, r * 0.9, 0.28, stoneMat, 0, y, 0));
        const disc = this._cyl(r * 0.94, r * 0.94, 0.12, chocoMat, 0, y + 0.16, 0);
        fountain.add(disc);
      });
      // Тягучие струи шоколада
      this.chocoFalls = [];
      for (let i = 0; i < 3; i++) {
        const r = tiers[i][0], y = tiers[i][1];
        for (let a = 0; a < 10; a++) {
          const ang = (a / 10) * Math.PI * 2;
          const h = i === 0 ? 1.3 : (tiers[i][1] - tiers[i - 1][1]);
          const f = this._cyl(0.055, 0.09, h, chocoMat,
            Math.cos(ang) * r * 0.93, y - h / 2 + 0.1, Math.sin(ang) * r * 0.93);
          fountain.add(f);
          this.chocoFalls.push(f);
        }
      }
      fountain.position.set(0, 0, 0);
      fountain.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      g.add(fountain);
      this.fountain = fountain;
      this.colliders.push({ type: 'cyl', x: 0, z: 0, r: 4.8, h: 8 });
      this.interactables.push({ id: 'fountain', pos: new THREE.Vector3(0, 1.6, 5), radius: 4.5,
        label: 'Набрать чашку шоколада', action: 'fountain_cup' });

      // Часовая башня
      const tower = new THREE.Group();
      tower.add(this._box(4, 26, 4, mat('tower', { color: 0xf0d6b0, roughness: 0.8 }), 0, 13, 0));
      tower.add(this._box(5, 1.2, 5, stoneMat, 0, 26.6, 0));
      const clockFace = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24),
        new THREE.MeshStandardMaterial({ color: 0xfff8e8, emissive: 0x332211, roughness: 0.4 }));
      clockFace.position.set(0, 22, 2.05);
      tower.add(clockFace);
      this.clockHands = [];
      for (let i = 0; i < 2; i++) {
        const hand = this._box(0.12, i ? 1.1 : 0.8, 0.06, mat('dark', { color: 0x2a2018, roughness: 0.6 }), 0, 0, 0);
        hand.geometry.translate(0, i ? 0.55 : 0.4, 0);
        hand.position.set(0, 22, 2.12);
        tower.add(hand); this.clockHands.push(hand);
      }
      tower.position.set(-19, 0, -17);
      tower.traverse((o) => { o.castShadow = true; });
      g.add(tower);
      this.colliders.push({ type: 'box', x: -19, z: -17, w: 4.4, d: 4.4, h: 26 });
      this.clockTower = tower;

      // Диваны-лежанки вокруг фонтана
      const sofaMat = mat('sofa', { color: 0xf0a0b8, roughness: 1.0 });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const x = Math.cos(a) * 13, z = Math.sin(a) * 13;
        const s = this._sofa(sofaMat);
        s.position.set(x, 0.05, z);
        s.rotation.y = -a + Math.PI / 2;
        g.add(s);
        this.interactables.push({ id: 'sofa' + i, pos: new THREE.Vector3(x, 0.7, z), radius: 2.2,
          label: 'Отдохнуть на диване', action: 'rest' });
      }

      // Шоколадные магистрали-трубы над площадью
      const pipeColors = [0xff9ec4, 0x6b4423, 0xfff0d8, 0xf5c542, 0x9b6bd4];
      this.pipes = [];
      pipeColors.forEach((c, i) => {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const len = 46;
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, len, 14, 1, true),
          new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.22,
            roughness: 0.05, transmission: 0.85, thickness: 0.3 }));
        const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, len, 12),
          new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, emissive: c, emissiveIntensity: 0.12 }));
        const grp = new THREE.Group(); grp.add(pipe, inner);
        grp.rotation.z = Math.PI / 2;
        grp.rotation.y = a;
        grp.position.set(Math.cos(a) * 8, 17 + i * 1.4, Math.sin(a) * 8);
        g.add(grp);
        this.pipes.push({ mesh: inner, color: c, phase: i });
      });

      // Уличные лотки
      const stallNames = ['Мороженое', 'Пончики', 'Конфеты', 'Крендели', 'Карамель'];
      const stallFood = ['icecream', 'donut', 'candy', 'pretzel', 'candy_apple'];
      stallNames.forEach((n, i) => {
        const a = (i / 5) * Math.PI * 2 + 0.7;
        const x = Math.cos(a) * 21, z = Math.sin(a) * 21;
        const st = this._stall(new THREE.Color().setHSL(i / 5, 0.6, 0.7));
        st.position.set(x, 0, z);
        st.rotation.y = -a + Math.PI;
        g.add(st);
        this.interactables.push({ id: 'stall' + i, pos: new THREE.Vector3(x, 1.2, z), radius: 3,
          label: `Лоток: ${n}`, action: 'shop', shop: [stallFood[i]] });
        this.colliders.push({ type: 'box', x, z, w: 2.6, d: 1.6, h: 2.2 });
      });

      // Скамейки
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const r = 24;
        const b = this._bench();
        b.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        b.rotation.y = -a + Math.PI / 2;
        g.add(b);
      }

      // Остановка такси
      const stop = new THREE.Group();
      stop.add(this._box(12, 0.3, 6, mat('stopfloor', { color: 0xd8c8b0, roughness: 0.9 }), 0, 0.15, 0));
      for (const sx of [-5, 5]) stop.add(this._cyl(0.14, 0.14, 4, mat('metal', { color: 0x7a7a80, roughness: 0.4, metalness: 0.7 }), sx, 2, -2.4));
      stop.add(this._box(12.6, 0.28, 6.4, mat('canopy', { color: 0xffb84d, roughness: 0.7 }), 0, 4.1, -0.6));
      stop.position.set(20, 0, 14);
      g.add(stop);
      this.taxiStop = new THREE.Vector3(20, 0, 14);
      // Подработка с уличным музыкантом
      this.interactables.push({ id: 'busk', pos: new THREE.Vector3(-6, 1.2, 12), radius: 4,
        label: '🎸 Сыграть с музыкантом (~8-33 🪙)', action: 'minigame', game: 'busker' });

      this.interactables.push({ id: 'taxi_call', pos: this.taxiStop.clone().add(new THREE.Vector3(0, 1, 3)),
        radius: 5, label: 'Вызвать такси (T)', action: 'taxi' });

      // Уличные фонари: столбы у всех, но реальный источник света —
      // только у каждого второго. Экономит половину ламп без потери вида.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + 0.15;
        this._lamp(Math.cos(a) * 25, Math.sin(a) * 25, g, i % 2 === 0);
      }

      // Голуби-фурри
      this.pigeons = [];
      for (let i = 0; i < 20; i++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6),
          mat('pigeon', { color: 0x9aa4b0, roughness: 0.9 }));
        p.position.set(U.rand(-20, 20), 0.16, U.rand(-20, 20));
        p.castShadow = true;
        g.add(p);
        this.pigeons.push({ mesh: p, t: Math.random() * 10, home: p.position.clone() });
      }

      // Пасхалка: ночной страж (появляется в 3 часа ночи)
      const guard = new THREE.Group();
      const gm = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.9, emissive: 0x111133 });
      const gb = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.7, 6, 12), gm); gb.position.y = 1;
      const gh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), gm); gh.position.y = 1.7;
      guard.add(gb, gh);
      guard.position.set(-8, 0, 8);
      guard.visible = false;
      g.add(guard);
      this.nightGuard = guard;
      this.interactables.push({ id: 'night_guard', pos: new THREE.Vector3(-8, 1.4, 8), radius: 3.5,
        label: '👤 Загадочная фигура', action: 'night_guard', nightGuard: true });

      // Пасхалка: секретный магазин, открытый только на закате
      const secret = this._box(6, 4, 5, mat('secretshop', { color: 0x6a3a5a, roughness: 0.8 }), 30, 2, -30);
      g.add(secret);
      this.interactables.push({ id: 'secret_shop', pos: new THREE.Vector3(30, 1.5, -26), radius: 4.5,
        label: '🌒 Секретная лавка (только на закате)', action: 'secret_shop' });

      this.scene.add(g);
      this.square = g;
    }

    /* ==================== КОТТЕДЖ ==================== */
    _buildCottage() {
      const L = FF.LOC_BY_ID.cottage;
      const g = new THREE.Group();
      g.position.set(L.x, 0, L.z);
      const wall = mat('cwall', { color: 0xffc0cb, roughness: 0.9, side: THREE.DoubleSide });
      const roof = mat('croof', { color: 0xc4483c, roughness: 0.85 });
      const wood = mat('wood', { color: 0x8a5a3a, roughness: 0.9 });
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xaad4ff, transparent: true, opacity: 0.35,
        roughness: 0.05, transmission: 0.8, thickness: 0.2 });

      // Корпус 2 этажа (открытый спереди — можно заходить)
      const W = 14, D = 12, H1 = 4.2, H2 = 3.8;
      // стены (4 стены с проёмом-дверью)
      g.add(this._box(W, H1 + H2, 0.4, wall, 0, (H1 + H2) / 2, -D / 2));   // задняя
      g.add(this._box(0.4, H1 + H2, D, wall, -W / 2, (H1 + H2) / 2, 0));   // левая
      g.add(this._box(0.4, H1 + H2, D, wall, W / 2, (H1 + H2) / 2, 0));    // правая
      // передняя с дверным проёмом
      g.add(this._box(4.6, H1 + H2, 0.4, wall, -4.7, (H1 + H2) / 2, D / 2));
      g.add(this._box(4.6, H1 + H2, 0.4, wall, 4.7, (H1 + H2) / 2, D / 2));
      g.add(this._box(4.8, H1 + H2 - 3.4, 0.4, wall, 0, (H1 + H2) - (H1 + H2 - 3.4) / 2, D / 2));
      // перекрытие между этажами
      g.add(this._box(W, 0.3, D, wood, 0, H1, 0));
      g.add(this._box(W, 0.3, D, wood, 0, 0.1, 0));
      // Крыша
      const rf = new THREE.Mesh(new THREE.ConeGeometry(11.2, 4.4, 4), roof);
      rf.rotation.y = Math.PI / 4; rf.position.y = H1 + H2 + 2.2;
      g.add(rf);
      // Окна
      for (const [x, y, z, rot] of [[-4, 2.2, D / 2 + 0.05, 0], [4, 2.2, D / 2 + 0.05, 0],
        [-4, 6.0, D / 2 + 0.05, 0], [4, 6.0, D / 2 + 0.05, 0],
        [-W / 2 - 0.05, 2.2, 0, Math.PI / 2], [W / 2 + 0.05, 2.2, 0, Math.PI / 2]]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), glass);
        w.position.set(x, y, z); w.rotation.y = rot;
        g.add(w);
      }
      // Крыльцо + кресло-качалка
      g.add(this._box(W + 3, 0.3, 3.5, wood, 0, 0.16, D / 2 + 1.7));
      const rocker = this._box(1.0, 1.2, 1.0, wood, 4.5, 0.9, D / 2 + 1.6);
      g.add(rocker); this.rocker = rocker;

      // Кухня (первый этаж, левая часть)
      const counter = this._box(5, 1.0, 1.2, wood, -4, 0.7, -3.5);
      g.add(counter);
      const stove = this._box(1.6, 1.1, 1.2, mat('metal2', { color: 0x9aa0a8, roughness: 0.3, metalness: 0.75 }), 0.6, 0.75, -4.5);
      g.add(stove);
      const fridge = this._box(1.6, 2.6, 1.4, mat('fridge', { color: 0xe8f0f5, roughness: 0.35, metalness: 0.2 }), -6, 1.4, -4.6);
      g.add(fridge);
      this.interactables.push({ id: 'craft', pos: new THREE.Vector3(L.x - 4, 1.4, L.z - 3.5), radius: 3.2,
        label: 'Кухня: готовить (крафт)', action: 'craft' });
      this.interactables.push({ id: 'fridge', pos: new THREE.Vector3(L.x - 6, 1.4, L.z - 4.6), radius: 2.6,
        label: 'Холодильник: склад', action: 'storage' });

      // Гостиная: диван, ковёр, камин, ТВ
      const sofa = this._sofa(mat('sofa2', { color: 0xd88ab0, roughness: 1 }));
      sofa.scale.set(2.2, 1.6, 1.8); sofa.position.set(4.5, 0.1, -1.5);
      g.add(sofa);
      const carpet = new THREE.Mesh(new THREE.CircleGeometry(3.4, 24), mat('carpet', { color: 0xc46a6a, roughness: 1 }));
      carpet.rotation.x = -Math.PI / 2; carpet.position.set(4, 0.28, 2);
      g.add(carpet);
      const fire = this._box(2.6, 2.4, 0.8, mat('brick', { color: 0x8a6a5a, roughness: 1 }), 4, 1.4, -5.4);
      g.add(fire);
      const flame = new THREE.PointLight(0xff8844, 2.2, 12, 2);
      flame.position.set(4 + L.x, 1.2, -5 + L.z);
      this.scene.add(flame); this.lights.push({ light: flame, flicker: true });
      this.interactables.push({ id: 'sleep', pos: new THREE.Vector3(L.x + 4.5, 1, L.z - 1.5), radius: 2.6,
        label: 'Отдохнуть на диване (пропустить время)', action: 'sleep' });

      // Второй этаж: кровати
      const bed = this._box(3, 0.7, 4.4, mat('bed', { color: 0xf0e0f0, roughness: 1 }), -4.5, H1 + 0.6, -3);
      g.add(bed);
      const furryBed = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.7, 24), mat('fbed', { color: 0xffd0e0, roughness: 1 }));
      furryBed.position.set(4, H1 + 0.6, 1);
      g.add(furryBed);
      this.interactables.push({ id: 'bed', pos: new THREE.Vector3(L.x - 4.5, H1 + 1.2, L.z - 3), radius: 2.6,
        label: 'Спать до утра', action: 'sleep_night' });

      // Ванна (для мытья фурри)
      const bath = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.2, 1.2, 20),
        mat('bath', { color: 0xf8f8ff, roughness: 0.2, metalness: 0.1 }));
      bath.position.set(-4.5, 0.7, 3.5);
      g.add(bath);
      this.interactables.push({ id: 'bath', pos: new THREE.Vector3(L.x - 4.5, 1.2, L.z + 3.5), radius: 3,
        label: 'Искупать друга', action: 'bath' });

      // Сад: грядки, улей, кусты, дерево
      for (let i = 0; i < 6; i++) {
        const bedx = -10 + (i % 3) * 3, bedz = 10 + Math.floor(i / 3) * 3;
        g.add(this._box(2.4, 0.4, 2.4, mat('soil', { color: 0x6b4a30, roughness: 1 }), bedx, 0.2, bedz));
        this.pickups.push(this._pickup(L.x + bedx, L.z + bedz, 'berry', 0.6));
      }
      const hive = this._box(1.2, 1.6, 1.2, mat('hive', { color: 0xe8c060, roughness: 0.9 }), 9, 0.9, 9);
      g.add(hive);
      this.interactables.push({ id: 'hive_home', pos: new THREE.Vector3(L.x + 9, 1.2, L.z + 9), radius: 2.4,
        label: 'Улей: собрать мёд', action: 'minigame', game: 'honey' });
      const tree = this._tree(0x5c3a24, 0x6b4423, 3.5);
      tree.position.set(-12, 0, -8);
      g.add(tree);

      // Почтовый ящик
      const mb = this._box(0.6, 0.6, 0.9, mat('mailbox', { color: 0x4a80c8, roughness: 0.6 }), 8, 1.4, D / 2 + 3);
      g.add(this._cyl(0.1, 0.1, 1.4, wood, 8, 0.7, D / 2 + 3));
      g.add(mb);
      this.interactables.push({ id: 'mail', pos: new THREE.Vector3(L.x + 8, 1.4, L.z + D / 2 + 3), radius: 2.4,
        label: 'Почтовый ящик', action: 'mail' });

      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(g);
      this.cottage = g;
      // Коллизии стен
      this.colliders.push({ type: 'box', x: L.x, z: L.z - D / 2, w: W, d: 0.6, h: 8 });
      this.colliders.push({ type: 'box', x: L.x - W / 2, z: L.z, w: 0.6, d: D, h: 8 });
      this.colliders.push({ type: 'box', x: L.x + W / 2, z: L.z, w: 0.6, d: D, h: 8 });
      this.colliders.push({ type: 'box', x: L.x - 4.7, z: L.z + D / 2, w: 4.6, d: 0.6, h: 8 });
      this.colliders.push({ type: 'box', x: L.x + 4.7, z: L.z + D / 2, w: 4.6, d: 0.6, h: 8 });
    }

    /* ==================== КАФЕ ==================== */
    _buildCafes() {
      const defs = [
        { id: 'sweetpaw', color: 0xffb6d5, w: 14, d: 12, h: 6, sign: '☕ Sweet Paw',
          menu: ['donut', 'croissant', 'coffee_cake', 'cookie'], npc: 'milli', work: 'cafe' },
        { id: 'chocodreams', color: 0x6b4423, w: 15, d: 13, h: 6.5, sign: '🍫 Chocolate Dreams',
          menu: ['choco_donut', 'choco_bar', 'choco_cake', 'hot_choco'], npc: 'bruno', chocoBath: true, work: 'cafe' },
        { id: 'creampalace', color: 0xfff4d8, w: 17, d: 15, h: 8, sign: '🎂 Cream Palace',
          menu: ['cream_pastry', 'medium_cake', 'big_cake', 'tiramisu', 'eclair', 'cheesecake'], npc: 'victoria', work: 'cafe' },
        { id: 'bakery', color: 0xe8c07a, w: 13, d: 11, h: 5.5, sign: '🥖 Golden Bakery',
          menu: ['bread', 'pirozhok', 'muffin', 'croissant', 'pretzel'], npc: 'barry', work: 'dough' },
        { id: 'pumpcafe', color: 0x2a3a4a, w: 18, d: 16, h: 8, sign: '⚙️ The Pump Cafe',
          menu: ['shake_normal', 'shake_mega', 'shake_ultra'], npc: 'ignatiy', pump: true },
      ];
      for (const d of defs) {
        const L = FF.LOC_BY_ID[d.id];
        const g = new THREE.Group();
        g.position.set(L.x, 0, L.z);
        // DoubleSide — чтобы стены были видны И снаружи, И изнутри помещения
        const wallMat = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.85, side: THREE.DoubleSide });
        // Округлое здание (характерная архитектура)
        // Стена с проёмом входа (открытый сектор со стороны +Z)
        const doorArc = 0.42;
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(d.w / 2, d.w / 2 * 1.05, d.h, 26, 1, true, doorArc, Math.PI * 2 - doorArc * 2),
          wallMat);
        body.position.y = d.h / 2;
        g.add(body);
        // Перемычка над входом
        const lintel = new THREE.Mesh(
          new THREE.CylinderGeometry(d.w / 2, d.w / 2, d.h - 3.2, 8, 1, true, -doorArc, doorArc * 2), wallMat);
        lintel.position.y = d.h - (d.h - 3.2) / 2;
        g.add(lintel);
        const roof = new THREE.Mesh(new THREE.SphereGeometry(d.w / 2 * 1.02, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(d.color).multiplyScalar(0.7),
            roughness: 0.8, side: THREE.DoubleSide }));
        roof.position.y = d.h;
        g.add(roof);
        // Витрины
        const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.4,
          roughness: 0.05, transmission: 0.85, thickness: 0.2, side: THREE.DoubleSide });
        for (let i = 0; i < 5; i++) {
          const a = -0.9 + i * 0.45;
          const w = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.6), glass);
          w.position.set(Math.sin(a) * (d.w / 2 + 0.05), 2.2, Math.cos(a) * (d.w / 2 + 0.05));
          w.lookAt(w.position.clone().multiplyScalar(2));
          g.add(w);
        }
        // Вывеска
        const sign = this._signboard(d.sign, d.color);
        sign.position.set(0, d.h + 1.4, d.w / 2 * 0.7);
        g.add(sign);
        // Тёплый свет внутри
        // Внутреннее освещение: мягкое и тёплое (светлые стены легко пересветить)
        const pl = new THREE.PointLight(0xffcf8a, 1.15, 20, 2.2);
        pl.position.set(L.x, Math.min(3.4, d.h - 1.2), L.z);
        this.scene.add(pl); this.lights.push({ light: pl, window: true });

        // --- ИНТЕРЬЕР ---
        this._cafeInterior(g, d);

        g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(g);
        this.colliders.push({ type: 'cyl', x: L.x, z: L.z, r: d.w / 2 + 0.2, h: d.h, hollow: true, doorAngle: 0 });

        this.interactables.push({ id: d.id + '_menu', pos: new THREE.Vector3(L.x, 1.6, L.z + d.w / 2 + 1.5),
          radius: 4.5, label: `${d.sign}: меню`, action: 'shop', shop: d.menu, loc: d.id });
        if (d.work) this.interactables.push({ id: d.id + '_work', pos: new THREE.Vector3(L.x + 3, 1.6, L.z + d.w / 2 + 1.5),
          radius: 3.5, label: `💼 Поработать смену (${d.work === 'cafe' ? '~20-40' : '~25-45'} 🪙)`,
          action: 'minigame', game: d.work });
        if (d.chocoBath) {
          const bath = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.8, 1.4, 20),
            new THREE.MeshStandardMaterial({ color: 0x5c3317, roughness: 0.15, metalness: 0.3 }));
          bath.position.set(L.x + 5, 0.8, L.z + 5);
          this.scene.add(bath);
          this.interactables.push({ id: 'chocobath', pos: new THREE.Vector3(L.x + 5, 1.4, L.z + 5), radius: 3.4,
            label: 'Шоколадная ванна для друга', action: 'minigame', game: 'chocobath' });
        }
        if (d.pump) {
          // Насосные терминалы
          for (let i = 0; i < 3; i++) {
            const px = L.x - 5 + i * 5, pz = L.z + 6;
            const term = this._box(1.4, 2.6, 1.4, mat('pumpterm', { color: 0x38506a, roughness: 0.4, metalness: 0.6 }), px, 1.3, pz);
            this.scene.add(term);
            const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8),
              new THREE.MeshPhysicalMaterial({ color: 0xffd8a8, transparent: true, opacity: 0.6, transmission: 0.6 }));
            tube.position.set(px, 2.4, pz + 1.2); tube.rotation.x = 0.6;
            this.scene.add(tube);
            if (i === 1) {   // один неон на все три терминала
              const neon = new THREE.PointLight(0x4ad8ff, 2.2, 16, 2);
              neon.position.set(px, 2.8, pz);
              this.scene.add(neon); this.lights.push({ light: neon, neon: true });
            }
          }
          this.interactables.push({ id: 'pump', pos: new THREE.Vector3(L.x, 1.6, L.z + 6), radius: 5,
            label: 'Подключить друга к насосу', action: 'minigame', game: 'pump' });
        }
      }
    }

    /**
     * Интерьер кафе: пол, барная стойка с витриной, столики, стулья,
     * тематический декор и мягкие кресла для крупных гостей.
     * @param {THREE.Group} g — группа здания
     * @param {object} d — описание кафе
     */
    _cafeInterior(g, d) {
      const R = d.w / 2;
      const accent = new THREE.Color(d.color);
      const wood = mat('cafewood', { color: 0x8a5a3a, roughness: 0.9 });
      const dark = mat('cafedark', { color: 0x4a3020, roughness: 0.85 });
      // Пол: контрастнее стен, чтобы читалась геометрия помещения
      const floorMat = new THREE.MeshStandardMaterial({
        color: accent.clone().lerp(new THREE.Color(0x2a1a14), 0.62), roughness: 0.62, metalness: 0.08 });
      const floor = new THREE.Mesh(new THREE.CircleGeometry(R - 0.15, 30), floorMat);
      floor.rotation.x = -Math.PI / 2; floor.position.y = 0.12;
      floor.receiveShadow = true;
      g.add(floor);
      // Плинтус — отделяет пол от стены
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.14, R - 0.14, 0.22, 30, 1, true),
        new THREE.MeshStandardMaterial({ color: accent.clone().lerp(new THREE.Color(0x000000), 0.55),
          roughness: 0.8, side: THREE.DoubleSide }));
      skirt.position.y = 0.23;
      g.add(skirt);

      // Барная стойка — дуга у дальней стены
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 0.62, R * 0.62, 1.15, 24, 1, true, Math.PI * 0.72, Math.PI * 0.85),
        wood);
      bar.position.set(0, 0.58, 0);
      g.add(bar);
      // Столешница
      const top = new THREE.Mesh(
        new THREE.TorusGeometry(R * 0.62, 0.14, 8, 26, Math.PI * 0.85), dark);
      top.rotation.x = Math.PI / 2; top.rotation.z = Math.PI * 0.72;
      top.position.y = 1.2;
      g.add(top);

      // Витрина с товаром: маленькие «пирожные» в цветах меню
      const menuIcons = d.menu || [];
      for (let i = 0; i < Math.min(6, menuIcons.length); i++) {
        const a = Math.PI * 0.78 + (i / 6) * Math.PI * 0.7;
        const cake = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.19, 0.2, 10),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL((i / 6) * 0.14 + 0.05, 0.55, 0.68), roughness: 0.75 }));
        cake.position.set(Math.cos(a) * R * 0.55, 1.4, Math.sin(a) * R * 0.55);
        g.add(cake);
        const berry = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6),
          mat('berrytop', { color: 0xd94f6a, roughness: 0.5 }));
        berry.position.set(cake.position.x, 1.53, cake.position.z);
        g.add(berry);
      }

      // Стеклянный колпак витрины
      const vitrine = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 0.62, R * 0.62, 0.55, 24, 1, true, Math.PI * 0.74, Math.PI * 0.8),
        new THREE.MeshPhysicalMaterial({ color: 0xdff0ff, transparent: true, opacity: 0.22,
          roughness: 0.03, transmission: 0.9, thickness: 0.1, side: THREE.DoubleSide }));
      vitrine.position.y = 1.55;
      g.add(vitrine);

      // Столики со стульями
      const tables = d.w > 15 ? 4 : 3;
      for (let i = 0; i < tables; i++) {
        const a = -Math.PI * 0.35 + (i / Math.max(1, tables - 1)) * Math.PI * 0.7;
        const tx = Math.sin(a) * R * 0.55, tz = Math.cos(a) * R * 0.55;
        // ножка + столешница
        g.add(this._cyl(0.09, 0.14, 0.72, dark, tx, 0.42, tz));
        const tt = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.09, 18), wood);
        tt.position.set(tx, 0.82, tz);
        g.add(tt);
        // мягкие кресла вокруг (широкие — для крупных гостей)
        for (let k = 0; k < 2; k++) {
          const ca = a + (k ? 0.55 : -0.55);
          const cx = tx + Math.sin(ca) * 1.15, cz = tz + Math.cos(ca) * 1.15;
          const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.46, 0.42, 14),
            new THREE.MeshStandardMaterial({ color: accent.clone().lerp(new THREE.Color(0xffffff), 0.35), roughness: 1 }));
          seat.position.set(cx, 0.32, cz);
          g.add(seat);
          const back = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.55, 14, 1, true, 0, Math.PI),
            new THREE.MeshStandardMaterial({ color: accent.clone().lerp(new THREE.Color(0xffffff), 0.2), roughness: 1, side: THREE.DoubleSide }));
          back.position.set(cx, 0.72, cz);
          back.rotation.y = -ca + Math.PI;
          g.add(back);
        }
        // Чашка на столе — уют
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.13, 10),
          mat('cup', { color: 0xfff4e8, roughness: 0.4 }));
        cup.position.set(tx + 0.2, 0.93, tz);
        g.add(cup);
      }

      // Тематический декор
      if (d.id === 'chocodreams') {
        // Шоколадные скульптуры и внутренний фонтан
        const chocoMat = new THREE.MeshStandardMaterial({ color: 0x5c3317, roughness: 0.2, metalness: 0.25 });
        for (let i = 0; i < 3; i++) {
          const a = -1.9 + i * 0.9;
          const sculpt = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.5, 8), chocoMat);
          sculpt.position.set(Math.cos(a) * R * 0.78, 0.82, Math.sin(a) * R * 0.78);
          g.add(sculpt);
        }
        const innerF = this._cyl(0.9, 1.1, 0.5, mat('fstone', { color: 0xe0cdb4, roughness: 0.85 }), 0, 0.3, R * 0.28);
        g.add(innerF);
        const chocoPool = this._cyl(0.82, 0.82, 0.12, chocoMat, 0, 0.58, R * 0.28);
        g.add(chocoPool);
        for (let t = 0; t < 3; t++) {
          g.add(this._cyl(0.13, 0.13, 0.5 + t * 0.35, chocoMat, 0, 0.9 + t * 0.5, R * 0.28));
          g.add(this._cyl(0.45 - t * 0.11, 0.45 - t * 0.11, 0.1, chocoMat, 0, 1.15 + t * 0.5, R * 0.28));
        }
      } else if (d.id === 'creampalace') {
        // Хрустальная люстра и красная дорожка
        const chandelier = new THREE.Group();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0),
            new THREE.MeshPhysicalMaterial({ color: 0xfff8e0, transmission: 0.9, roughness: 0.02,
              thickness: 0.3, transparent: true, opacity: 0.75 }));
          crystal.position.set(Math.cos(a) * 0.62, -Math.abs(Math.sin(i * 1.7)) * 0.32, Math.sin(a) * 0.62);
          chandelier.add(crystal);
        }
        chandelier.position.set(0, d.h - 1.3, 0);
        g.add(chandelier);
        const chLight = new THREE.PointLight(0xfff0c8, 0.85, 14, 2.2);
        chLight.position.set(FF.LOC_BY_ID[d.id].x, d.h - 1.4, FF.LOC_BY_ID[d.id].z);
        this.scene.add(chLight); this.lights.push({ light: chLight, window: true });
        const carpet = new THREE.Mesh(new THREE.PlaneGeometry(2.2, R * 1.7),
          mat('redcarpet', { color: 0x9a2a3a, roughness: 1 }));
        carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, 0.08, R * 0.35);
        g.add(carpet);
        // Пианино
        const piano = this._box(1.8, 0.95, 1.1, mat('piano', { color: 0x1a1418, roughness: 0.25, metalness: 0.3 }),
          -R * 0.6, 0.5, -R * 0.35);
        g.add(piano);
      } else if (d.id === 'bakery') {
        // Печь, мешки муки, полки с хлебом
        const oven = this._box(2.4, 1.9, 1.2, mat('oven', { color: 0x6a4a3a, roughness: 0.9 }), -R * 0.55, 0.95, -R * 0.5);
        g.add(oven);
        const fireBox = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7),
          new THREE.MeshStandardMaterial({ color: 0xff8844, emissive: 0xff5511, emissiveIntensity: 1.6 }));
        fireBox.position.set(-R * 0.55, 0.85, -R * 0.5 + 0.62);
        g.add(fireBox);
        const ovenLight = new THREE.PointLight(0xff7733, 1.1, 8, 2);
        ovenLight.position.set(FF.LOC_BY_ID[d.id].x - R * 0.55, 1.1, FF.LOC_BY_ID[d.id].z - R * 0.5 + 1);
        this.scene.add(ovenLight); this.lights.push({ light: ovenLight, flicker: true });
        for (let i = 0; i < 4; i++) {
          const sack = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), mat('sack', { color: 0xd8c8a8, roughness: 1 }));
          sack.scale.set(1, 1.25, 1);
          sack.position.set(R * 0.62 - i * 0.34, 0.42, -R * 0.55);
          g.add(sack);
        }
        for (let i = 0; i < 7; i++) {
          const loaf = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.2, 5, 8), mat('loaf', { color: 0xd9a05a, roughness: 0.85 }));
          loaf.rotation.z = Math.PI / 2;
          loaf.position.set(-1.1 + i * 0.37, 1.72, -R * 0.72);
          g.add(loaf);
        }
      } else if (d.id === 'pumpcafe') {
        // Баки с коктейлями и неоновые полосы
        for (let i = 0; i < 3; i++) {
          const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 2.6, 16),
            new THREE.MeshPhysicalMaterial({ color: 0xffd8a8, transparent: true, opacity: 0.45,
              transmission: 0.6, roughness: 0.1, thickness: 0.5 }));
          tank.position.set(-2.6 + i * 2.6, 1.4, -R * 0.62);
          g.add(tank);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.06, 6, 20),
            new THREE.MeshStandardMaterial({ color: 0x4ad8ff, emissive: 0x2288cc, emissiveIntensity: 1.4 }));
          ring.rotation.x = Math.PI / 2;
          ring.position.set(tank.position.x, 2.72, tank.position.z);
          g.add(ring);
        }
        // Кресла-ложементы для гигантов
        for (let i = 0; i < 2; i++) {
          const lounge = new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x38506a, roughness: 0.95 }));
          lounge.scale.y = 0.55;
          lounge.position.set(i ? 3.2 : -3.2, 0.12, R * 0.4);
          g.add(lounge);
        }
      } else if (d.id === 'sweetpaw') {
        // Фото известных клиентов на стене (пасхалка)
        for (let i = 0; i < 5; i++) {
          const a = Math.PI * 0.85 + (i / 5) * Math.PI * 0.5;
          const frame = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.75),
            new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 5, 0.35, 0.72), roughness: 0.85 }));
          frame.position.set(Math.cos(a) * (R - 0.35), 2.5, Math.sin(a) * (R - 0.35));
          frame.lookAt(0, 2.5, 0);
          g.add(frame);
        }
        // Кофемашина
        const machine = this._box(0.75, 0.85, 0.55, mat('coffeemachine', { color: 0x9aa0a8, roughness: 0.3, metalness: 0.7 }),
          -1.5, 1.62, -R * 0.5);
        g.add(machine);
      }
    }

    /* ==================== ЛАБОРАТОРИЯ АРТЁМА ==================== */
    _buildLab() {
      const L = FF.LOC_BY_ID.lab;
      const g = new THREE.Group();
      g.position.set(L.x, 0, L.z);
      const wall = new THREE.MeshStandardMaterial({ color: 0x2b3a67, roughness: 0.8, side: THREE.DoubleSide });
      const trim = new THREE.MeshStandardMaterial({ color: 0x1a2340, roughness: 0.7 });
      g.add(this._box(13, 9, 11, wall, 0, 4.5, 0));
      // Стрельчатая крыша
      const roof = new THREE.Mesh(new THREE.ConeGeometry(9.6, 6, 4), trim);
      roof.rotation.y = Math.PI / 4; roof.position.y = 12;
      g.add(roof);
      // Башенка с дымоходом
      g.add(this._cyl(1.1, 1.1, 5, trim, 4.5, 11, -3));
      const smoke = new THREE.Group(); smoke.position.set(L.x + 4.5, 14, L.z - 3);
      this.scene.add(smoke); this.labSmoke = smoke;
      for (let i = 0; i < 14; i++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5),
          new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.7, 0.7), transparent: true, opacity: 0.45 }));
        p.userData.t = Math.random() * 6;
        smoke.add(p);
      }
      // Витражи
      for (let i = 0; i < 4; i++) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.2),
          new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 4, 0.8, 0.55),
            emissive: new THREE.Color().setHSL(i / 4, 0.8, 0.35), transparent: true, opacity: 0.85 }));
        w.position.set(-4.5 + i * 3, 4.5, 5.55);
        g.add(w);
      }
      // Дверь
      g.add(this._box(2.6, 4, 0.3, mat('labdoor', { color: 0x6a4a2a, roughness: 0.8 }), 0, 2, 5.6));

      // Интерьер: котёл, стол, полки с колбами
      const cauldron = new THREE.Mesh(new THREE.SphereGeometry(1.5, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
        mat('cauldron', { color: 0x2a2a30, roughness: 0.5, metalness: 0.6 }));
      cauldron.position.set(0, 1.5, -2);
      cauldron.rotation.x = Math.PI;
      g.add(cauldron);
      const brew = new THREE.Mesh(new THREE.CircleGeometry(1.35, 20),
        new THREE.MeshStandardMaterial({ color: 0x4cff7a, emissive: 0x1a8f3a, roughness: 0.2 }));
      brew.rotation.x = -Math.PI / 2; brew.position.set(0, 1.55, -2);
      g.add(brew); this.brewSurface = brew;
      const brewLight = new THREE.PointLight(0x6cff9a, 2.5, 14, 2);
      brewLight.position.set(L.x, 2.2, L.z - 2);
      this.scene.add(brewLight); this.lights.push({ light: brewLight, pulse: true });

      // Колбы на полках
      for (let s = 0; s < 3; s++) {
        g.add(this._box(9, 0.2, 0.8, mat('shelf', { color: 0x4a3a2a, roughness: 0.9 }), -1, 2 + s * 1.6, -5));
        for (let i = 0; i < 14; i++) {
          const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6),
            new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.8, 0.6),
              emissive: new THREE.Color().setHSL(Math.random(), 0.8, 0.3), transparent: true, opacity: 0.85 }));
          f.position.set(-5.2 + i * 0.62, 2.3 + s * 1.6, -5);
          g.add(f);
        }
      }
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(g);
      this.colliders.push({ type: 'box', x: L.x, z: L.z - 5.5, w: 13, d: 0.6, h: 9 });
      this.colliders.push({ type: 'box', x: L.x - 6.5, z: L.z, w: 0.6, d: 11, h: 9 });
      this.colliders.push({ type: 'box', x: L.x + 6.5, z: L.z, w: 0.6, d: 11, h: 9 });

      this.interactables.push({ id: 'brew', pos: new THREE.Vector3(L.x, 1.8, L.z - 2), radius: 4,
        label: 'Котёл: варить эликсир', action: 'brew' });
    }

    /* ==================== ФЕРМА И МЕЛЬНИЦА ==================== */
    _buildFarmAndMill() {
      const F = FF.LOC_BY_ID.farm;
      const g = new THREE.Group(); g.position.set(F.x, 0, F.z);
      const barn = mat('barn', { color: 0xc0453c, roughness: 0.9 });
      const wood = mat('wood2', { color: 0x9a6a44, roughness: 0.95 });
      // Коровник
      g.add(this._box(14, 6, 10, barn, -8, 3, 0));
      const br = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 14, 3, 1, false, 0, Math.PI), barn);
      br.rotation.z = Math.PI / 2; br.rotation.y = Math.PI / 2; br.position.set(-8, 6, 0);
      g.add(br);
      // Курятник
      g.add(this._box(6, 3, 5, wood, 8, 1.5, -6));
      // Овчарня
      g.add(this._box(8, 3.4, 6, wood, 10, 1.7, 5));
      // Пасека
      for (let i = 0; i < 4; i++) g.add(this._box(1.1, 1.4, 1.1, mat('hive2', { color: 0xe8c060, roughness: 0.9 }), -18 + i * 2.2, 0.8, 9));
      // Животные (простые фигурки)
      for (let i = 0; i < 5; i++) {
        const cow = this._animal(0xf0f0f0, 1.4);
        cow.position.set(U.rand(-16, -2), 0, U.rand(6, 14));
        g.add(cow);
      }
      for (let i = 0; i < 7; i++) {
        const ch = this._animal(0xffe0a0, 0.4);
        ch.position.set(U.rand(4, 12), 0, U.rand(-10, -3));
        g.add(ch);
      }
      for (let i = 0; i < 5; i++) {
        const sh = this._animal(0xfff8f0, 0.9);
        sh.position.set(U.rand(6, 16), 0, U.rand(2, 10));
        g.add(sh);
      }
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(g);
      this.interactables.push({ id: 'milk', pos: new THREE.Vector3(F.x - 8, 1.2, F.z + 8), radius: 6,
        label: 'Подоить корову', action: 'minigame', game: 'milk' });
      this.interactables.push({ id: 'eggs', pos: new THREE.Vector3(F.x + 8, 1.2, F.z - 6), radius: 5,
        label: 'Собрать яйца', action: 'minigame', game: 'eggs' });
      this.interactables.push({ id: 'wool', pos: new THREE.Vector3(F.x + 10, 1.2, F.z + 5), radius: 5,
        label: 'Постричь овцу', action: 'minigame', game: 'wool' });
      this.interactables.push({ id: 'honey', pos: new THREE.Vector3(F.x - 15, 1.2, F.z + 9), radius: 5,
        label: 'Собрать мёд', action: 'minigame', game: 'honey' });
      this.interactables.push({ id: 'farmshop', pos: new THREE.Vector3(F.x, 1.2, F.z - 12), radius: 5,
        label: 'Лавка фермера', action: 'shop_ing', shop: ['milk', 'egg', 'butter', 'cheese', 'grain', 'goat_milk', 'apple'] });

      // Мельница
      const M = FF.LOC_BY_ID.mill;
      const mg = new THREE.Group(); mg.position.set(M.x, 0, M.z);
      mg.add(this._cyl(3.4, 4.2, 10, mat('millwall', { color: 0xd8c0a0, roughness: 0.9 }), 0, 5, 0));
      const mroof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 3.4, 12), mat('millroof', { color: 0x8a5a3a, roughness: 0.9 }));
      mroof.position.y = 11.6; mg.add(mroof);
      // Лопасти
      const blades = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = this._box(0.5, 8, 0.2, mat('blade', { color: 0xe8e0d0, roughness: 0.8 }), 0, 4, 0);
        b.rotation.z = (i / 4) * Math.PI * 2;
        b.position.set(Math.sin((i / 4) * Math.PI * 2) * 4, Math.cos((i / 4) * Math.PI * 2) * 4, 0);
        blades.add(b);
      }
      blades.position.set(0, 7.5, 4.4);
      mg.add(blades); this.millBlades = blades;
      mg.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(mg);
      this.colliders.push({ type: 'cyl', x: M.x, z: M.z, r: 4, h: 10 });
      this.interactables.push({ id: 'mill', pos: new THREE.Vector3(M.x, 1.2, M.z + 5), radius: 5,
        label: 'Смолоть муку', action: 'mill' });
    }

    /* ==================== ЛЕС ==================== */
    _buildForest() {
      const L = FF.LOC_BY_ID.forest;
      const g = new THREE.Group();
      const trunkGeo = new THREE.CylinderGeometry(0.5, 0.75, 7, 8);
      const leafGeo = new THREE.SphereGeometry(3.2, 10, 8);
      const trunkMat = mat('trunk', { color: 0x5c3a24, roughness: 1 });
      const leafMats = [
        mat('leaf1', { color: 0x4a7a3a, roughness: 1 }),
        mat('leaf2', { color: 0x6b4423, roughness: 0.95 }),  // какао-дерево
        mat('leaf3', { color: 0x3a6a4a, roughness: 1 }),
      ];
      const N = 95;
      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
      const leafInst = leafMats.map((m) => new THREE.InstancedMesh(leafGeo, m, Math.ceil(N / 3)));
      const dummy = new THREE.Object3D();
      const counts = [0, 0, 0];
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * L.r;
        const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
        const y = this.heightAt(x, z);
        const s = U.rand(0.8, 1.6);
        dummy.position.set(x, y + 3.5 * s, z); dummy.scale.set(s, s, s); dummy.rotation.y = Math.random() * 6.28;
        dummy.updateMatrix(); trunkInst.setMatrixAt(i, dummy.matrix);
        const li = i % 3;
        dummy.position.set(x, y + 7 * s, z); dummy.scale.setScalar(s * U.rand(0.8, 1.2));
        dummy.updateMatrix(); leafInst[li].setMatrixAt(counts[li]++, dummy.matrix);
        if (i % 6 === 0) this.colliders.push({ type: 'cyl', x, z, r: 0.9 * s, h: 7 });
      }
      trunkInst.castShadow = true; trunkInst.receiveShadow = true;
      g.add(trunkInst);
      leafInst.forEach((m, i) => { m.count = counts[i]; m.castShadow = true; g.add(m); });

      // Точки сбора: какао, ягоды, грибы
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * L.r * 0.85;
        this.pickups.push(this._pickup(L.x + Math.cos(a) * r, L.z + Math.sin(a) * r, 'cocoa', 1.0));
      }
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * L.r * 0.9;
        this.pickups.push(this._pickup(L.x + Math.cos(a) * r, L.z + Math.sin(a) * r, Math.random() < 0.5 ? 'berry' : 'strawberry', 0.6));
      }
      // Грибная поляна — светящиеся грибы
      const glade = { x: L.x + 22, z: L.z - 18 };
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * 6.28, r = Math.random() * 9;
        this.pickups.push(this._pickup(glade.x + Math.cos(a) * r, glade.z + Math.sin(a) * r, 'glow_mushroom', 0.5, 0x7cff9a));
      }
      const gl = new THREE.PointLight(0x6cff9a, 1.8, 26, 2);
      gl.position.set(glade.x, 2, glade.z);
      this.scene.add(gl); this.lights.push({ light: gl, pulse: true });

      // Лунный ручей (ночью — лунная роса)
      const stream = new THREE.Mesh(new THREE.PlaneGeometry(40, 5, 20, 2),
        new THREE.MeshPhysicalMaterial({ color: 0x8ad8ff, roughness: 0.08, metalness: 0.2,
          transmission: 0.7, thickness: 0.4, transparent: true, opacity: 0.75 }));
      stream.rotation.x = -Math.PI / 2;
      stream.position.set(L.x - 16, this.heightAt(L.x - 16, L.z + 20) + 0.2, L.z + 20);
      g.add(stream); this.stream = stream;
      for (let i = 0; i < 6; i++)
        this.pickups.push(this._pickup(L.x - 30 + i * 6, L.z + 20, 'moon_dew', 0.4, 0x9adfff, true));

      // Пещера кристаллов
      const cave = { x: L.x - 26, z: L.z - 26 };
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(8, 0), mat('rock', { color: 0x6a6a72, roughness: 1 }));
      rock.position.set(cave.x, this.heightAt(cave.x, cave.z) + 3, cave.z);
      rock.castShadow = true;
      g.add(rock);
      for (let i = 0; i < 5; i++) {
        const cx = cave.x + U.rand(-7, 7), cz = cave.z + U.rand(-7, 7);
        this.pickups.push(this._pickup(cx, cz, 'rainbow_crystal', 0.7, 0xff7cf0));
      }

      // Дерево-великан с секретом
      const giant = this._tree(0x4a2f1c, 0x3a6a4a, 9);
      giant.position.set(L.x + 8, this.heightAt(L.x + 8, L.z + 8), L.z + 8);
      g.add(giant);
      this.interactables.push({ id: 'wish_tree', pos: new THREE.Vector3(L.x + 8, 2, L.z + 8), radius: 5,
        label: '🌳 Дерево желаний', action: 'wish' });
      // Грибная поляна и лунный ручей — мини-игры сбора
      this.interactables.push({ id: 'glade', pos: new THREE.Vector3(glade.x, 1.5, glade.z), radius: 7,
        label: '🍄 Прочесать грибную поляну', action: 'minigame', game: 'mushrooms' });
      this.interactables.push({ id: 'moonstream', pos: new THREE.Vector3(L.x - 16, 1.5, L.z + 20), radius: 8,
        label: '💧 Ловить лунную росу (ночью)', action: 'minigame', game: 'moonhunt', nightOnly: true });
      // Секрет: старый маяк в лесу
      const lh = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.0, 18, 14),
        mat('lighthouse', { color: 0xe8e0d8, roughness: 0.9 }));
      lh.position.set(L.x + 34, this.heightAt(L.x + 34, L.z - 34) + 9, L.z - 34);
      lh.castShadow = true;
      g.add(lh);
      const lhLight = new THREE.PointLight(0xfff0b0, 2.4, 40, 2);
      lhLight.position.set(L.x + 34, this.heightAt(L.x + 34, L.z - 34) + 19, L.z - 34);
      this.scene.add(lhLight); this.lights.push({ light: lhLight, pulse: true });
      this.interactables.push({ id: 'lighthouse', pos: new THREE.Vector3(L.x + 34, 2, L.z - 30), radius: 6,
        label: '🗼 Тайна старого маяка', action: 'lighthouse' });

      this.scene.add(g);
      this.forest = g;
    }

    /* ==================== ПАРК ==================== */
    _buildPark() {
      const P = FF.LOC_BY_ID.park;
      const g = new THREE.Group(); g.position.set(P.x, 0, P.z);
      // Пруд
      const pond = new THREE.Mesh(new THREE.CircleGeometry(11, 32),
        new THREE.MeshPhysicalMaterial({ color: 0x4a9ad8, roughness: 0.06, metalness: 0.15,
          transmission: 0.6, thickness: 0.5, transparent: true, opacity: 0.85 }));
      pond.rotation.x = -Math.PI / 2; pond.position.set(-4, 0.12, 0);
      g.add(pond); this.pond = pond;
      // Лебеди
      for (let i = 0; i < 4; i++) {
        const s = this._animal(0xffffff, 0.5);
        s.position.set(-4 + U.rand(-7, 7), 0.3, U.rand(-7, 7));
        g.add(s);
      }
      // Гигантские подушки
      for (let i = 0; i < 8; i++) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(2.2, 14, 10),
          new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 8, 0.5, 0.75), roughness: 1 }));
        c.scale.y = 0.42;
        c.position.set(U.rand(6, 20), 0.8, U.rand(-14, 14));
        c.castShadow = true;
        g.add(c);
      }
      // Деревья и клумбы
      for (let i = 0; i < 18; i++) {
        const t = this._tree(0x6a4a2a, 0x5a9a4a, U.rand(2.4, 4));
        t.position.set(U.rand(-22, 22), 0, U.rand(-22, 22));
        if (t.position.distanceTo(new THREE.Vector3(-4, 0, 0)) < 13) continue;
        g.add(t);
      }
      // Шоколадный фонтан парка
      const f2 = this._cyl(2.2, 2.6, 1.6, mat('stone2', { color: 0xe8dcc8, roughness: 0.9 }), 14, 0.8, -10);
      g.add(f2);
      // Скамейки
      for (let i = 0; i < 8; i++) {
        const b = this._bench();
        b.position.set(Math.cos(i / 8 * 6.28) * 16, 0, Math.sin(i / 8 * 6.28) * 16);
        b.rotation.y = -i / 8 * 6.28;
        g.add(b);
      }
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(g);
      this.interactables.push({ id: 'ducks', pos: new THREE.Vector3(P.x - 4, 1, P.z + 8), radius: 6,
        label: 'Покормить уток', action: 'ducks' });
      this.interactables.push({ id: 'fishing', pos: new THREE.Vector3(P.x - 12, 1, P.z), radius: 5,
        label: 'Порыбачить', action: 'minigame', game: 'fishing' });
      this.interactables.push({ id: 'picnic', pos: new THREE.Vector3(P.x + 12, 1, P.z + 4), radius: 6,
        label: 'Устроить пикник с другом', action: 'picnic' });
    }

    /* ==================== ГОРЫ ==================== */
    _buildMountains() {
      const M = FF.LOC_BY_ID.mountains;
      // Пики (геометрия уже в рельефе, добавим детали)
      const g = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const x = M.x + U.rand(-50, 50), z = M.z + U.rand(-30, 30);
        const h = U.rand(20, 42);
        const peak = new THREE.Mesh(new THREE.ConeGeometry(U.rand(10, 20), h, 7),
          mat('mrock', { color: 0xa8b0bc, roughness: 1 }));
        peak.position.set(x, this.heightAt(x, z) + h / 2 - 4, z);
        peak.castShadow = true; peak.receiveShadow = true;
        g.add(peak);
        const snow = new THREE.Mesh(new THREE.ConeGeometry(U.rand(4, 8), h * 0.3, 7),
          mat('snow', { color: 0xf6fbff, roughness: 0.75 }));
        snow.position.set(x, peak.position.y + h * 0.42, z);
        g.add(snow);
      }
      // Ледяное озеро
      const lake = new THREE.Mesh(new THREE.CircleGeometry(16, 28),
        new THREE.MeshPhysicalMaterial({ color: 0xbfe8ff, roughness: 0.05, metalness: 0.3, transmission: 0.5, transparent: true, opacity: 0.8 }));
      lake.rotation.x = -Math.PI / 2;
      const lx = M.x - 30, lz = M.z + 30;
      lake.position.set(lx, this.heightAt(lx, lz) + 0.3, lz);
      g.add(lake);
      this.interactables.push({ id: 'ice_fishing', pos: new THREE.Vector3(lx, this.heightAt(lx, lz) + 1, lz + 14),
        radius: 8, label: 'Ловить ледяную рыбу', action: 'minigame', game: 'fishing', item: 'ice_fish' });
      // Хижина отшельника
      const hx = M.x + 24, hz = M.z + 20;
      const hut = this._box(6, 4, 6, mat('hut', { color: 0x6a4a30, roughness: 1 }), hx, this.heightAt(hx, hz) + 2, hz);
      g.add(hut);
      this.interactables.push({ id: 'hermit', pos: new THREE.Vector3(hx, this.heightAt(hx, hz) + 1.5, hz + 4),
        radius: 5, label: 'Отшельник Гораций', action: 'talk', npc: 'horatio' });
      // Радужный водопад
      const wx = M.x - 10, wz = M.z - 10;
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(6, 30),
        new THREE.MeshStandardMaterial({ color: 0xaad8ff, transparent: true, opacity: 0.6, emissive: 0x336699 }));
      fall.position.set(wx, this.heightAt(wx, wz) + 15, wz);
      g.add(fall);
      this.interactables.push({ id: 'waterfall', pos: new THREE.Vector3(wx, this.heightAt(wx, wz) + 1, wz + 4),
        radius: 6, label: 'Радужный водопад: восстановить силы', action: 'restore' });
      // Пик наслаждения и пещера дракона
      const px = M.x, pz = M.z - 25;
      this.interactables.push({ id: 'peak', pos: new THREE.Vector3(px, this.heightAt(px, pz) + 2, pz),
        radius: 8, label: '⛰️ Пик Наслаждения', action: 'peak' });
      const dx = M.x + 40, dz = M.z;
      const caveMouth = new THREE.Mesh(new THREE.SphereGeometry(7, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        mat('caverock', { color: 0x4a4a52, roughness: 1 }));
      caveMouth.position.set(dx, this.heightAt(dx, dz), dz);
      g.add(caveMouth);
      this.interactables.push({ id: 'dragon_cave', pos: new THREE.Vector3(dx, this.heightAt(dx, dz) + 1.5, dz + 8),
        radius: 7, label: '🐉 Пещера Дракона', action: 'dragon' });
      // Лунный сахар
      for (let i = 0; i < 4; i++) {
        const sx = M.x + U.rand(-40, 40), sz = M.z + U.rand(-20, 20);
        this.pickups.push(this._pickup(sx, sz, 'moon_sugar', 0.6, 0xdfe8ff, true));
      }
      for (let i = 0; i < 3; i++) {
        const sx = M.x + U.rand(-30, 30), sz = M.z + U.rand(-20, 20);
        this.pickups.push(this._pickup(sx, sz, 'star_powder', 0.6, 0xffe89a));
      }
      this.pickups.push(this._pickup(px + 2, pz + 2, 'phoenix_feather', 0.8, 0xff9a4a));
      this.scene.add(g);
      this.mountains = g;
    }

    /* ==================== ОСТАЛЬНЫЕ ЗДАНИЯ ==================== */
    _buildMiscBuildings() {
      const defs = [
        { id: 'market', w: 22, d: 14, h: 6, color: 0xf0a868, sign: '🛒 Рынок',
          action: 'shop_ing', shop: ['flour', 'sugar', 'salt', 'yeast', 'cream', 'cinnamon', 'mint', 'caramel', 'vanilla', 'rose_oil'] },
        { id: 'clothes', w: 12, d: 10, h: 5.5, color: 0xc3a3f0, sign: '👕 Одежда', action: 'clothes' },
        { id: 'club', w: 16, d: 14, h: 7, color: 0x3a2a5a, sign: '🎵 Ночной клуб', action: 'club' },
        { id: 'post', w: 10, d: 9, h: 5, color: 0x8ab6f0, sign: '📮 Почта', action: 'mail' },
        { id: 'bank', w: 12, d: 10, h: 7, color: 0xd8d8d8, sign: '🏦 Банк', action: 'bank' },
        { id: 'library', w: 16, d: 13, h: 8, color: 0xa88a6a, sign: '📚 Библиотека', action: 'library' },
        { id: 'spa', w: 13, d: 11, h: 5.5, color: 0xa8e6d8, sign: '💆 Спа-салон', action: 'spa' },
      ];
      // --- НОВЫЕ МАГАЗИНЫ ---
      defs.push(
        { id: 'sweetshop', w: 11, d: 9, h: 5.5, color: 0xff9ec4, sign: '🍭 Сахарок', action: 'shop',
          shop: ['lollipop', 'marshmallow', 'nougat', 'baklava', 'gingerbread', 'candy'] },
        { id: 'butcher', w: 12, d: 10, h: 5.5, color: 0xc4685a, sign: '🥩 Сытый Волк', action: 'shop',
          shop: ['sausage', 'steak', 'ribs', 'whole_turkey', 'roast'] },
        { id: 'greengrocer', w: 11, d: 9, h: 5, color: 0x8fc96a, sign: '🥬 Грядка', action: 'shop',
          shop: ['salad', 'corn', 'pumpkin_pie', 'candy_apple'] },
        { id: 'dairy', w: 11, d: 9, h: 5, color: 0xf0f4ff, sign: '🥛 Белый Кот', action: 'shop',
          shop: ['yogurt', 'cheese_wheel', 'condensed', 'butter_block', 'icecream'] },
        { id: 'alchemshop', w: 10, d: 9, h: 6, color: 0x8a5bd6, sign: '✨ Звёздная Пыль', action: 'shop_ing',
          shop: ['glow_mushroom', 'moon_dew', 'rainbow_crystal', 'star_powder', 'vanilla', 'rose_oil', 'gelatin', 'food_color'] },
        { id: 'furniture', w: 14, d: 12, h: 6, color: 0xc9a06b, sign: '🛋️ Мягкий Угол', action: 'furniture' },
        { id: 'toolshop', w: 11, d: 9, h: 5, color: 0x7a8a9a, sign: '🔧 Всё для друга', action: 'shop_ing',
          shop: ['gelatin', 'food_color', 'silk_thread', 'salt', 'yeast', 'nuts'] },
        { id: 'giantshop', w: 24, d: 20, h: 9, color: 0xffb84d, sign: '🛒 ГИПЕРМАРКЕТ ГИГАНТ', action: 'shop',
          shop: ['family_bucket', 'mega_pizza', 'sweet_barrel', 'feast_cart', 'big_cake', 'shake_ultra'] },
        // --- ВТОРАЯ ВОЛНА ---
        { id: 'bakeshop', w: 11, d: 9, h: 5.5, color: 0xe8c07a, sign: '🌾 Три Колоса', action: 'shop_ing',
          shop: ['flour', 'grain', 'yeast', 'butter', 'infinity_flour'] },
        { id: 'spiceshop', w: 11, d: 9, h: 5.5, color: 0xd87a3a, sign: '🌶 Восточный Ветер', action: 'shop_ing',
          shop: ['cinnamon', 'saffron', 'truffle', 'vanilla', 'mint', 'salt'] },
        { id: 'fishshop', w: 11, d: 9, h: 5, color: 0x5aa7d8, sign: '🐟 Синий Плавник', action: 'shop_ing',
          shop: ['ice_fish', 'caviar', 'salt'] },
        { id: 'berryshop', w: 11, d: 9, h: 5, color: 0x9b4bd4, sign: '🫐 Лукошко', action: 'shop_ing',
          shop: ['berry', 'strawberry', 'cloudberry', 'apple', 'honey'] },
        { id: 'cakeshop', w: 13, d: 11, h: 6.5, color: 0xffd9e8, sign: '🎂 Ярус', action: 'shop',
          shop: ['medium_cake', 'big_cake', 'layered_pie', 'wedding_cake', 'rainbow_meringue'] },
        { id: 'drinkshop', w: 11, d: 9, h: 5, color: 0x6fbf7a, sign: '🥤 Полный Стакан', action: 'shop',
          shop: ['hot_choco', 'yogurt', 'shake_normal', 'shake_mega', 'condensed'] },
        { id: 'petshop', w: 11, d: 9, h: 5, color: 0xf0a8c8, sign: '🐾 Лапа', action: 'shop_ing',
          shop: ['silk_thread', 'gelatin', 'food_color', 'rose_oil'] },
        { id: 'nightmarket', w: 16, d: 13, h: 6, color: 0x3a2a6a, sign: '🌙 Ночной рынок', action: 'nightmarket',
          shop: ['moon_dew', 'moon_sugar', 'glow_mushroom', 'rainbow_crystal', 'choco_heart', 'dragon_saliva'] }
      );

      for (const d of defs) {
        const L = FF.LOC_BY_ID[d.id];
        const g = new THREE.Group(); g.position.set(L.x, 0, L.z);
        const m = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.85, side: THREE.DoubleSide });
        const body = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.d), m);
        body.position.y = d.h / 2;
        // Скруглённая крыша
        const roof = new THREE.Mesh(new THREE.SphereGeometry(Math.max(d.w, d.d) / 2 * 0.75, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(d.color).multiplyScalar(0.72), roughness: 0.8 }));
        roof.position.y = d.h;
        roof.scale.set(d.w / (Math.max(d.w, d.d) * 0.75), 0.6, d.d / (Math.max(d.w, d.d) * 0.75));
        g.add(body, roof);
        const sign = this._signboard(d.sign, d.color);
        sign.position.set(0, d.h + 1.1, d.d / 2 + 0.2);
        g.add(sign);

        // --- ИНТЕРЬЕР МАГАЗИНА: пол, стеллажи, прилавок, товар ---
        if (d.shop || d.action === 'furniture') {
          const accent = new THREE.Color(d.color);
          const floor = new THREE.Mesh(new THREE.PlaneGeometry(d.w - 0.6, d.d - 0.6),
            new THREE.MeshStandardMaterial({ color: accent.clone().lerp(new THREE.Color(0x2a1a14), 0.6), roughness: 0.7 }));
          floor.rotation.x = -Math.PI / 2; floor.position.y = 0.1;
          floor.receiveShadow = true;
          g.add(floor);

          const shelfMat = mat('shopshelf', { color: 0x8a5a3a, roughness: 0.9 });
          // Стеллажи вдоль боковых стен
          for (const side of [-1, 1]) {
            for (let lvl = 0; lvl < 3; lvl++) {
              const shelf = this._box(d.w * 0.32, 0.12, d.d - 2.5, shelfMat,
                side * (d.w / 2 - d.w * 0.19), 0.75 + lvl * 0.85, -0.4);
              g.add(shelf);
              // Товар на полках
              const items = Math.floor((d.d - 2.5) / 0.62);
              for (let i = 0; i < items; i++) {
                const box = new THREE.Mesh(
                  new THREE.BoxGeometry(0.3, U.rand(0.24, 0.42), 0.3),
                  new THREE.MeshStandardMaterial({
                    color: new THREE.Color().setHSL((i * 0.17 + lvl * 0.3) % 1, 0.5, 0.62), roughness: 0.8 }));
                box.position.set(side * (d.w / 2 - d.w * 0.19) + U.rand(-0.5, 0.5),
                  0.98 + lvl * 0.85, -0.4 - (d.d - 3) / 2 + i * 0.62);
                g.add(box);
              }
            }
          }
          // Прилавок у дальней стены
          const counter = this._box(d.w * 0.58, 1.05, 0.9, shelfMat, 0, 0.6, -d.d / 2 + 1.2);
          g.add(counter);
          const till = this._box(0.5, 0.32, 0.4,
            mat('till', { color: 0x3a3a44, roughness: 0.4, metalness: 0.6 }), d.w * 0.18, 1.28, -d.d / 2 + 1.2);
          g.add(till);
          // Корзины у входа
          for (let i = 0; i < 3; i++) {
            const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.34, 10),
              mat('basket', { color: 0xd85a5a, roughness: 0.85 }));
            basket.position.set(-d.w / 2 + 1.1, 0.28 + i * 0.12, d.d / 2 - 1.3);
            g.add(basket);
          }
          // Гипермаркет: огромные стеллажи и тележки
          if (d.id === 'giantshop') {
            for (let r = 0; r < 3; r++) {
              const rack = this._box(1.2, 5.5, d.d - 4, shelfMat, -6 + r * 6, 2.75, 0);
              g.add(rack);
              for (let k = 0; k < 8; k++) {
                const crate = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 1.0),
                  new THREE.MeshStandardMaterial({
                    color: new THREE.Color().setHSL((k * 0.13 + r * 0.3) % 1, 0.55, 0.6), roughness: 0.85 }));
                crate.position.set(-6 + r * 6, 0.9 + (k % 4) * 1.3, -(d.d - 5) / 2 + Math.floor(k / 4) * 3.5);
                g.add(crate);
              }
            }
            for (let i = 0; i < 4; i++) {
              const cart = this._box(1.1, 0.75, 1.6,
                mat('cart', { color: 0xb0b8c0, roughness: 0.4, metalness: 0.6 }),
                U.rand(-8, 8), 0.5, d.d / 2 - 2.5);
              g.add(cart);
            }
          }
        }
        const pl = new THREE.PointLight(d.id === 'club' ? 0xd84af0 : 0xffcf8a, 1.1, 18, 2.2);
        pl.position.set(L.x, 2.6, L.z + d.d / 2 - 1);
        this.scene.add(pl); this.lights.push({ light: pl, window: true, club: d.id === 'club' });
        g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(g);
        this.colliders.push({ type: 'box', x: L.x, z: L.z, w: d.w, d: d.d, h: d.h });
        this.interactables.push({ id: d.id, pos: new THREE.Vector3(L.x, 1.6, L.z + d.d / 2 + 1.6), radius: 4.5,
          label: d.sign, action: d.action, shop: d.shop, loc: d.id });
      }
    }

    /**
     * ТАЙНЫЙ СКЛАД ПРАДЕДА — секретный магазин высоко в горах.
     * Здесь лежат легендарные ингредиенты запасом по 999 штук.
     * Открывается по находке карты; телепорт — из меню карты (Tab).
     */
    _buildSecretVault() {
      const L = FF.LOC_BY_ID.secretvault;
      const g = new THREE.Group();
      const gy = this.heightAt(L.x, L.z);
      g.position.set(L.x, gy, L.z);

      const stone = mat('vaultstone', { color: 0x6a5f7e, roughness: 0.8 });
      const gold = mat('vaultgold', { color: 0xd8b45a, roughness: 0.3, metalness: 0.75 });
      const rune = new THREE.MeshStandardMaterial({ color: 0x9b7bd4, roughness: 0.3,
        emissive: 0x6a4bb4, emissiveIntensity: 1.4 });

      // Основание-платформа
      const base = new THREE.Mesh(new THREE.CylinderGeometry(13, 15, 1.6, 12), stone);
      base.position.y = 0.8;
      g.add(base);

      // Круглый зал с куполом
      const hall = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.4, 7, 16, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x655a78, roughness: 0.8, side: THREE.DoubleSide }));
      hall.position.y = 5.1;
      g.add(hall);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(9.1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x554a66, roughness: 0.78, side: THREE.DoubleSide }));
      dome.position.y = 8.6;
      g.add(dome);
      // Пол
      const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 24),
        mat('vaultfloor', { color: 0x4a4058, roughness: 0.6, metalness: 0.2 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 1.62;
      g.add(floor);

      // Колонны с рунами
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 7, 8), stone);
        col.position.set(Math.cos(a) * 7.6, 5.1, Math.sin(a) * 7.6);
        g.add(col);
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 6, 14), rune);
        r.rotation.x = Math.PI / 2;
        r.position.set(Math.cos(a) * 7.6, 4.2, Math.sin(a) * 7.6);
        g.add(r);
      }

      // Стеллажи с бочками легендарных ингредиентов
      const secretIds = ['void_sugar', 'time_honey', 'sun_yolk', 'abyss_cocoa', 'titan_cream', 'infinity_flour'];
      const cols = [0x2a1a3a, 0xd8a838, 0xffd24a, 0x1a1420, 0x9adfff, 0xf0e8d8];
      secretIds.forEach((id, i) => {
        const a = (i / secretIds.length) * Math.PI * 2 + 0.4;
        const bx = Math.cos(a) * 5.8, bz = Math.sin(a) * 5.8;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 1.7, 14),
          new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.45,
            emissive: cols[i], emissiveIntensity: 0.25 }));
        barrel.position.set(bx, 2.5, bz);
        g.add(barrel);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.14, 14), gold);
        cap.position.set(bx, 3.4, bz);
        g.add(cap);
        // Парящий кристалл-образец
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0),
          new THREE.MeshStandardMaterial({ color: cols[i], emissive: cols[i],
            emissiveIntensity: 1.5, roughness: 0.15 }));
        gem.position.set(bx, 4.3, bz);
        gem.userData.float = i;
        g.add(gem);
        if (!this.vaultGems) this.vaultGems = [];
        this.vaultGems.push(gem);
      });

      // Центральный алтарь-прилавок
      const altar = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.4, 1.3, 12), gold);
      altar.position.y = 2.3;
      g.add(altar);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.75, 18, 14),
        new THREE.MeshStandardMaterial({ color: 0xc8a8ff, emissive: 0x8a5bd6,
          emissiveIntensity: 1.7, roughness: 0.1 }));
      orb.position.y = 3.7;
      g.add(orb);
      this.vaultOrb = orb;

      // Освещение зала: тёплый общий свет + фиолетовый акцент от сферы
      const amb = new THREE.PointLight(0xffe0c0, 2.2, 30, 1.7);
      amb.position.set(0, 5.2, 0);
      g.add(amb);
      const vl = new THREE.PointLight(0xb08aff, 3.4, 26, 1.8);
      vl.position.set(0, 4.2, 0);
      g.add(vl);
      this.lights.push({ light: vl, pulse: true });
      // Подсветка бочек по кругу
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const sp = new THREE.PointLight(0xffd0a0, 1.8, 18, 1.8);
        sp.position.set(Math.cos(a) * 5.5, 4.6, Math.sin(a) * 5.5);
        g.add(sp);
      }
      // Купол не глухой: световой люк сверху
      const oculus = new THREE.Mesh(new THREE.CircleGeometry(2.2, 20),
        new THREE.MeshStandardMaterial({ color: 0xffe8c8, emissive: 0xffca88,
          emissiveIntensity: 0.35, side: THREE.DoubleSide }));
      oculus.rotation.x = Math.PI / 2;
      oculus.position.y = 8.5;
      g.add(oculus);

      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(g);
      this.secretVault = g;

      this.interactables.push({
        id: 'secretvault', pos: new THREE.Vector3(L.x, gy + 2.5, L.z + 3),
        radius: 7, label: '⭐ Склад Прадеда: легендарные припасы', action: 'vault',
      });

    }

    /* ==================== NPC ==================== */
    _buildNPCs() {
      for (const def of FF.NPCS) {
        const L = FF.LOC_BY_ID[def.loc] || FF.LOC_BY_ID.square;
        const g = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.92 });
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.62, 6, 14), bodyMat);
        body.position.y = 0.95;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), bodyMat);
        head.position.y = 1.62;
        const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), bodyMat);
        muzzle.position.set(0, 1.58, 0.24); muzzle.scale.set(1, 0.8, 1.2);
        g.add(body, head, muzzle);
        // уши
        for (const s of [-1, 1]) {
          const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 8), bodyMat);
          ear.position.set(s * 0.15, 1.85, 0);
          ear.rotation.z = s * 0.3;
          g.add(ear);
        }
        // глаза
        for (const s of [-1, 1]) {
          const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6),
            mat('npceye', { color: 0x1a1418, roughness: 0.3 }));
          e.position.set(s * 0.10, 1.66, 0.24);
          g.add(e);
        }
        // Артём: халат, очки, шапочка
        if (def.id === 'artyom') {
          const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.40, 0.46, 1.1, 14),
            mat('coat', { color: 0x2b3a67, roughness: 0.8 }));
          coat.position.y = 0.95; g.add(coat);
          const hat = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 12),
            mat('hat', { color: 0x1a2340, roughness: 0.8, emissive: 0x11224a, emissiveIntensity: 0.3 }));
          hat.position.y = 2.02; g.add(hat);
          for (const s of [-1, 1]) {
            const gl = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 14),
              mat('glass', { color: 0xd8d8e0, roughness: 0.2, metalness: 0.8 }));
            gl.position.set(s * 0.10, 1.66, 0.27);
            g.add(gl);
          }
        }
        const y = this.heightAt(L.x, L.z);
        const ox = U.rand(-4, 4), oz = U.rand(3, 7);
        g.position.set(L.x + ox, y, L.z + oz);
        g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
        this.scene.add(g);
        const npc = { def, group: g, home: g.position.clone(), t: Math.random() * 10, talkedToday: false };
        this.npcs.push(npc);
        this.interactables.push({ id: 'npc_' + def.id, pos: g.position.clone().add(new THREE.Vector3(0, 1.4, 0)),
          radius: 3.6, label: `💬 ${def.name} (${def.species})`, action: 'talk', npc: def.id, npcRef: npc });
      }
      // Дети-фурри
      for (let i = 0; i < 5; i++) {
        const g = new THREE.Group();
        const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.6, 0.65), roughness: 0.95 });
        const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 5, 10), m); b.position.y = 0.5;
        const h = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), m); h.position.y = 0.92;
        g.add(b, h);
        g.position.set(U.rand(-22, 22), 0, U.rand(-22, 22));
        g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        this.scene.add(g);
        this.npcs.push({ def: { id: 'kid' + i, name: 'Малыш-фурри', species: 'ребёнок', color: 0xffffff }, group: g,
          home: g.position.clone(), t: Math.random() * 10, kid: true });
      }
    }

    /* ==================== ЧАСТИЦЫ ==================== */
    _buildParticles() {
      // Пыль в лучах света
      const N = 200;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = U.rand(-70, 70); pos[i * 3 + 1] = U.rand(0.5, 22); pos[i * 3 + 2] = U.rand(-70, 70);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({ color: 0xffe8c0, size: 0.13, transparent: true, opacity: 0.5,
        depthWrite: false, blending: THREE.AdditiveBlending });
      this.dust = new THREE.Points(geo, m);
      this.dust.frustumCulled = false;
      this.scene.add(this.dust);
    }

    /* ==================== ПРИМИТИВЫ ==================== */
    _box(w, h, d, m, x, y, z) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      return mesh;
    }
    _cyl(rt, rb, h, m, x, y, z) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 18), m);
      mesh.position.set(x, y, z);
      return mesh;
    }
    _sofa(m) {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.6, 1.6), m);
      seat.position.y = 0.5;
      const back = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 0.4), m);
      back.position.set(0, 1.1, -0.6);
      const a1 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 1.6), m); a1.position.set(-1.6, 0.95, 0);
      const a2 = a1.clone(); a2.position.x = 1.6;
      g.add(seat, back, a1, a2);
      g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      return g;
    }
    _bench() {
      const g = new THREE.Group();
      const m = mat('bench', { color: 0x8a5a3a, roughness: 0.95 });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.7), m); seat.position.y = 0.55;
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.12), m); back.position.set(0, 0.9, -0.3);
      g.add(seat, back);
      for (const s of [-0.9, 0.9]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.6), mat('metal3', { color: 0x4a4a52, roughness: 0.5, metalness: 0.6 }));
        leg.position.set(s, 0.28, 0); g.add(leg);
      }
      g.traverse((o) => { o.castShadow = true; });
      return g;
    }
    _stall(color) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 1.4), mat('stallbase', { color: 0xe8d8c0, roughness: 0.9 }));
      base.position.y = 0.55;
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.1, 0.9, 4), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
      canopy.position.y = 2.4; canopy.rotation.y = Math.PI / 4;
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2, 8), mat('metal4', { color: 0x8a8a92, roughness: 0.4, metalness: 0.6 }));
        p.position.set(s * 1.1, 1.1, 0); g.add(p);
      }
      g.add(base, canopy);
      g.traverse((o) => { o.castShadow = true; });
      return g;
    }
    _lamp(x, z, parent, withLight) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 5, 8),
        mat('lamppole', { color: 0x3a3a42, roughness: 0.5, metalness: 0.6 }));
      pole.position.y = 2.5;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffc060, emissiveIntensity: 1.6 }));
      bulb.position.y = 5.1;
      g.add(pole, bulb);
      g.position.set(x, this.heightAt(x, z), z);
      (parent || this.scene).add(g);
      if (withLight === false) return g;   // столб без источника — дёшево
      const l = new THREE.PointLight(0xffc070, 1.6, 18, 2);
      l.position.set(x, 5.1, z);
      this.scene.add(l);
      this.lights.push({ light: l, street: true, bulb });
      return g;
    }
    _tree(trunkColor, leafColor, scale) {
      const g = new THREE.Group();
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.26 * scale, 1.6 * scale, 8),
        new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 1 }));
      t.position.y = 0.8 * scale;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.85 * scale, 12, 9),
        new THREE.MeshStandardMaterial({ color: leafColor, roughness: 1 }));
      l.position.y = 1.9 * scale;
      g.add(t, l);
      g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      return g;
    }
    _animal(color, scale) {
      const g = new THREE.Group();
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.4 * scale, 0.7 * scale, 5, 10), m);
      b.rotation.z = Math.PI / 2; b.position.y = 0.7 * scale;
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.28 * scale, 10, 8), m);
      h.position.set(0.7 * scale, 0.95 * scale, 0);
      g.add(b, h);
      for (const [sx, sz] of [[-0.3, -0.25], [-0.3, 0.25], [0.3, -0.25], [0.3, 0.25]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * scale, 0.07 * scale, 0.7 * scale, 6), m);
        leg.position.set(sx * scale, 0.35 * scale, sz * scale);
        g.add(leg);
      }
      g.traverse((o) => { o.castShadow = true; });
      return g;
    }
    _signboard(text, color) {
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#2a1a20'; ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
      ctx.fillRect(6, 6, 500, 116);
      ctx.fillStyle = '#241018';
      ctx.font = 'bold 46px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 68);
      const tex = new THREE.CanvasTexture(canvas);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3),
        new THREE.MeshStandardMaterial({ map: tex, emissive: 0x332211, emissiveIntensity: 0.4, side: THREE.DoubleSide }));
      return m;
    }
    /** Собираемый ингредиент */
    _pickup(x, z, itemId, size, glow, nightOnly) {
      const ing = FF.ING_BY_ID[itemId];
      const color = glow || 0xffd080;
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(size * 0.35, 0),
        new THREE.MeshStandardMaterial({ color, emissive: glow ? color : 0x000000,
          emissiveIntensity: glow ? 0.8 : 0, roughness: 0.4 }));
      const y = this.heightAt(x, z) + 0.6;
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      this.scene.add(mesh);
      // Свечение делаем материалом, а не источником света: их десятки,
      // и каждый добавлял бы нагрузку на все шейдеры сцены.
      if (glow) mesh.material.emissiveIntensity = 1.6;
      return { mesh, item: itemId, name: ing ? ing.name : itemId, base: y, taken: false, nightOnly, respawn: 0 };
    }

    /* ==================== ОБНОВЛЕНИЕ ==================== */
    update(dt, gameHours, playerPos) {
      const t = performance.now() * 0.001;

      // --- Освещение по времени суток ---
      const h = gameHours % 24;
      const isNight = h < 5.2 || h > 21.2;
      // День длится с 5:00 до 21:00; «золотой час» (18–20) солнце ещё заметно над горизонтом
      const sunAngle = ((h - 5) / 16) * Math.PI;
      const sunY = Math.sin(sunAngle);
      this.sun.position.set(Math.cos(sunAngle) * 110, Math.max(-20, sunY * 90), -70);
      const sunUp = U.clamp(sunY, 0, 1);
      this.sun.intensity = 0.2 + sunUp * 2.5;
      const warm = new THREE.Color(0xffb178), noon = new THREE.Color(0xfff2dd), night = new THREE.Color(0x6a80c0);
      const c = new THREE.Color();
      if (sunY < 0.18) c.copy(night).lerp(warm, U.clamp(sunY / 0.18, 0, 1));
      else c.copy(warm).lerp(noon, U.clamp((sunY - 0.18) / 0.6, 0, 1));
      this.sun.color.copy(c);
      this.ambient.intensity = 0.38 + sunUp * 0.85;
      this.ambient.color.copy(c).lerp(new THREE.Color(0xffffff), 0.35);
      this.fill.intensity = 0.18 + sunUp * 0.35;

      // Небо
      const stars = U.clamp((0.10 - sunY) / 0.25, 0, 1);
      this.skyUniforms.uStars.value = stars;
      this.skyUniforms.uSunDir.value.copy(this.sun.position).normalize();
      const topN = new THREE.Color(0x0a1030), topD = new THREE.Color(0x3a5a9a);
      this.skyUniforms.uTop.value.copy(topN).lerp(topD, U.clamp(sunY * 3.2, 0, 1));
      const midN = new THREE.Color(0x1a2050), midD = new THREE.Color(0xff9e6b);
      this.skyUniforms.uMid.value.copy(midN).lerp(midD, U.clamp(sunY * 3.4 + 0.15, 0, 1));
      const botN = new THREE.Color(0x2a2440), botD = new THREE.Color(0xffd9a8);
      this.skyUniforms.uBot.value.copy(botN).lerp(botD, U.clamp(sunY * 3.6 + 0.2, 0, 1));
      this.scene.fog.color.copy(this.skyUniforms.uBot.value);

      // Фонари включаются ночью
      // Яркость меняется плавно и напрямую — visible никогда не трогаем,
      // поэтому шейдеры не пересобираются и рывков нет.
      for (const l of this.lights) {
        if (l.street) {
          const on = isNight ? 1 : 0.06;
          l.light.intensity = U.damp(l.light.intensity, 1.9 * on, 2, dt);
          if (l.bulb) l.bulb.material.emissiveIntensity = 0.3 + on * 1.6;
        } else if (l.window) {
          l.light.intensity = U.damp(l.light.intensity, (isNight ? 1.7 : 1.0) * (l.base || 1), 2, dt);
          if (l.club) l.light.color.setHSL((t * 0.3) % 1, 0.8, 0.55);
        } else if (l.flicker) {
          l.light.intensity = 1.8 + Math.sin(t * 11) * 0.25 + Math.random() * 0.25;
        } else if (l.pulse) {
          l.light.intensity = 1.8 + Math.sin(t * 2.2) * 0.6;
        } else if (l.neon) {
          l.light.intensity = 1.4 + Math.sin(t * 4 + l.light.position.x) * 0.3;
        }
      }

      // Тень следует за игроком
      if (playerPos) {
        this.sun.target.position.copy(playerPos);
        this.sun.position.copy(playerPos).add(new THREE.Vector3(Math.cos(sunAngle) * 60, Math.max(24, sunY * 70), -50));
      }

      // --- Анимации мира ---
      if (this.millBlades) this.millBlades.rotation.z += dt * 0.55;
      if (this.clockHands) {
        this.clockHands[0].rotation.z = -(h / 12) * Math.PI * 2;
        this.clockHands[1].rotation.z = -((h % 1) * Math.PI * 2);
      }
      // Шоколадные струи «текут»
      for (const f of this.chocoFalls) {
        f.material = f.material; // общий материал
        f.scale.y = 1 + Math.sin(t * 3 + f.position.x * 2) * 0.04;
      }
      // Трубы: пульсация сиропа
      for (const p of this.pipes) p.mesh.material.emissiveIntensity = 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(t * 2 + p.phase));
      // Дым лаборатории
      if (this.labSmoke) this.labSmoke.children.forEach((p, i) => {
        p.userData.t += dt * 0.6;
        const tt = p.userData.t % 6;
        p.position.set(Math.sin(tt * 1.3 + i) * tt * 0.35, tt * 1.6, Math.cos(tt * 1.1 + i) * tt * 0.35);
        p.material.opacity = 0.5 * (1 - tt / 6);
        p.scale.setScalar(0.5 + tt * 0.3);
      });
      // Котёл булькает
      if (this.brewSurface) {
        this.brewSurface.position.y = 1.55 + Math.sin(t * 3.4) * 0.03;
        if (Math.random() < dt * 1.2 && playerPos && playerPos.distanceTo(new THREE.Vector3(FF.LOC_BY_ID.lab.x, 2, FF.LOC_BY_ID.lab.z)) < 25)
          this.audio && this.audio.bubble();
      }
      // Пруд и ручей — лёгкая рябь
      if (this.pond) this.pond.material.roughness = 0.05 + Math.sin(t * 1.3) * 0.02;

      // Голуби
      for (const p of this.pigeons) {
        p.t += dt;
        if (p.t > 6) {
          p.t = 0;
          p.target = new THREE.Vector3(p.home.x + U.rand(-6, 6), 0.16, p.home.z + U.rand(-6, 6));
        }
        if (p.target) {
          p.mesh.position.lerp(p.target, dt * 1.2);
          p.mesh.position.y = 0.16 + Math.abs(Math.sin(p.t * 8)) * 0.12;
        }
      }

      // NPC бродят
      for (const npc of this.npcs) {
        npc.t += dt;
        if (npc.t > (npc.kid ? 4 : 9)) {
          npc.t = 0;
          npc.target = new THREE.Vector3(
            npc.home.x + U.rand(-6, 6), 0, npc.home.z + U.rand(-6, 6));
          npc.target.y = this.heightAt(npc.target.x, npc.target.z);
        }
        if (npc.target) {
          const d = npc.target.clone().sub(npc.group.position);
          d.y = 0;
          if (d.length() > 0.3) {
            d.normalize();
            npc.group.position.addScaledVector(d, dt * (npc.kid ? 2.4 : 1.1));
            npc.group.position.y = this.heightAt(npc.group.position.x, npc.group.position.z);
            npc.group.rotation.y = Math.atan2(d.x, d.z);
            npc.group.position.y += Math.abs(Math.sin(t * 6)) * 0.04;
          }
        }
        // Обновляем позицию интерактива
        const inter = this.interactables.find((i) => i.npcRef === npc);
        if (inter) inter.pos.copy(npc.group.position).add(new THREE.Vector3(0, 1.4, 0));
      }

      // Пыль дрейфует
      if (this.dust) {
        this.dust.rotation.y += dt * 0.008;
        this.dust.material.opacity = 0.25 + sunUp * 0.35;
        if (playerPos) this.dust.position.set(
          Math.round(playerPos.x / 70) * 70, 0, Math.round(playerPos.z / 70) * 70);
      }

      // Пикапы: вращение, парение, ночная доступность
      for (const p of this.pickups) {
        if (p.taken) {
          p.respawn -= dt;
          if (p.respawn <= 0) { p.taken = false; p.mesh.visible = true; }
          continue;
        }
        p.mesh.rotation.y += dt * 1.4;
        p.mesh.position.y = p.base + Math.sin(t * 2 + p.base) * 0.12;
        if (p.nightOnly) p.mesh.visible = isNight;
      }

      // Ночной страж появляется в 3 часа ночи
      if (this.nightGuard) this.nightGuard.visible = (h >= 3 && h < 4);

      // Тайный склад: парящие кристаллы и пульсирующая сфера
      if (this.vaultGems) {
        for (const gem of this.vaultGems) {
          gem.position.y = 4.3 + Math.sin(t * 1.3 + gem.userData.float) * 0.22;
          gem.rotation.y += dt * 0.8;
        }
      }
      if (this.vaultOrb) {
        this.vaultOrb.rotation.y += dt * 0.35;
        this.vaultOrb.scale.setScalar(1 + Math.sin(t * 1.7) * 0.06);
      }

      // Часовой звон
      const hourInt = Math.floor(h);
      if (this._lastHour !== hourInt) {
        if (this._lastHour !== undefined && playerPos && playerPos.length() < 90) {
          this.audio && this.audio.bell();
        }
        this._lastHour = hourInt;
      }

      this._updateWeather(dt);
    }

    setWeather(w) {
      this.weather = w;
      if (w === 'rain' && !this.rainGroup) {
        const N = 800;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
          pos[i * 3] = U.rand(-50, 50); pos[i * 3 + 1] = U.rand(0, 40); pos[i * 3 + 2] = U.rand(-50, 50);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.rainGroup = new THREE.Points(geo, new THREE.PointsMaterial({
          color: 0xaad0ff, size: 0.14, transparent: true, opacity: 0.6, depthWrite: false }));
        this.rainGroup.frustumCulled = false;
        this.scene.add(this.rainGroup);
      }
      if (this.rainGroup) this.rainGroup.visible = (w === 'rain' || w === 'snow');
      if (this.rainGroup && w === 'snow') {
        this.rainGroup.material.color.set(0xffffff);
        this.rainGroup.material.size = 0.3;
      }
    }

    _updateWeather(dt) {
      if (!this.rainGroup || !this.rainGroup.visible) return;
      const pos = this.rainGroup.geometry.attributes.position.array;
      const speed = this.weather === 'snow' ? 3 : 26;
      for (let i = 1; i < pos.length; i += 3) {
        pos[i] -= dt * speed;
        if (pos[i] < 0) pos[i] = 40;
      }
      this.rainGroup.geometry.attributes.position.needsUpdate = true;
    }

    /**
     * ОПТИМИЗАЦИЯ: динамический отбор источников света.
     * Three.js обрабатывает КАЖДЫЙ источник в шейдере для каждого фрагмента,
     * поэтому 75 ламп — это неподъёмно. Держим включёнными только
     * несколько ближайших к игроку, остальные гасим (intensity = 0).
     */
    /**
     * Отбор источников света ОТКЛЮЧЁН НАВСЕГДА.
     *
     * Раньше здесь гасились дальние лампы ради производительности, но
     * переключение light.visible заставляет Three.js пересобирать ВСЕ
     * шейдеры сцены — отсюда были рывки и «скачки» картинки на ходу.
     *
     * Вместо этого количество ламп ограничено на этапе постройки мира
     * (см. _lamp и вызовы PointLight), а игрок регулирует нагрузку
     * пресетом качества в настройках. Ничего не переключается в рантайме.
     */
    _cullLights() { /* намеренно пусто */ }

    /** Определение локации по позиции */
    locationAt(pos) {
      let best = null, bestD = Infinity;
      for (const l of FF.LOCATIONS) {
        const d = Math.hypot(pos.x - l.x, pos.z - l.z);
        if (d < l.r && d < bestD) { bestD = d; best = l; }
      }
      return best;
    }
  }

  FF.World = World;
})(typeof window !== 'undefined' ? window : globalThis);
