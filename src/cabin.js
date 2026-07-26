/**
 * cabin.js — ФИЗИКА САЛОНА ТАКСИ
 *
 * Ты сидишь ВНУТРИ вместе с другом. Он занимает реальный объём — и чем
 * он толще, тем сильнее вытесняет тебя к двери, к стеклу, к потолку.
 * На поворотах его масса переваливается и придавливает. Можно зажать
 * так, что не выберешься без помощи.
 *
 * Что моделируется:
 *   1. CabinVolume   — коробка салона: стены, потолок, сиденья, двери
 *   2. Вытеснение    — коллайдеры 60 зон давят игрока внутри салона
 *   3. Squeeze       — уровень сжатия 0..1: обзор, дыхание, стамина, паника
 *   4. Инерция массы — на поворотах/торможении плоть наваливается
 *   5. Застревание   — при сильном сжатии нужно выбираться (мини-игра)
 *   6. Свободный объём — сколько кубометров осталось лично тебе
 *
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();

  /* ============================================================
   * ОПИСАНИЕ САЛОНОВ
   * Внутренние габариты в метрах: ширина × высота × длина
   * ============================================================ */
  const CABINS = {
    normal: {
      w: 1.72, h: 1.30, len: 2.30, volume: 5.1,
      seatH: 0.46, doorSide: 1, name: 'Салон минивэна',
      desc: 'Тесновато даже вдвоём: два кресла и узкий проход.',
    },
    big: {
      w: 2.10, h: 1.58, len: 3.60, volume: 11.9,
      seatH: 0.44, doorSide: 1, name: 'Салон фургона',
      desc: 'Задний диван сложен, места больше — но и друг крупнее.',
    },
    mega: {
      w: 2.90, h: 2.10, len: 5.40, volume: 32.9,
      seatH: 0.38, doorSide: 1, name: 'Крытая платформа',
      desc: 'Полукрытый отсек с бортами и мягкими матами на полу.',
    },
    ultra: {
      w: 4.00, h: 2.60, len: 8.50, volume: 88.4,
      seatH: 0.30, doorSide: 1, name: 'Транспортный модуль',
      desc: 'Огромный отсек с креплениями. Даже здесь бывает тесно.',
    },
  };

  /* ============================================================
   * ПОРОГИ СЖАТИЯ
   * ============================================================ */
  const SQUEEZE_LEVELS = [
    { t: 0.00, id: 'free',      name: 'Свободно',   color: '#7cd66b',
      hint: 'Места хватает, можно спокойно сидеть.' },
    { t: 0.22, id: 'cozy',      name: 'Уютно',      color: '#a8d86b',
      hint: 'Его тёплый бок касается твоего плеча.' },
    { t: 0.42, id: 'tight',     name: 'Тесно',      color: '#ffd24a',
      hint: 'Приходится подвинуться к самой двери.' },
    { t: 0.60, id: 'pressed',   name: 'Прижало',    color: '#ffa04a',
      hint: 'Ты вжат в стекло. Двигаться почти нельзя.' },
    { t: 0.76, id: 'squeezed',  name: 'Зажало',     color: '#ff6b6b',
      hint: 'Мягкая масса давит со всех сторон. Дышать тяжело!' },
    { t: 0.90, id: 'trapped',   name: 'ЗАЖАТ!',     color: '#ff3b30',
      hint: 'Ты не можешь выбраться сам. Нужно выкарабкиваться!' },
  ];

  /* ============================================================
   * СИСТЕМА САЛОНА
   * ============================================================ */
  class CabinSystem {
    constructor(game) {
      this.game = game;
      this.active = false;
      this.cabin = null;
      this.taxiDef = null;

      // Локальные координаты игрока внутри салона (0,0,0 = центр)
      this.localPos = new THREE.Vector3();
      this.localVel = new THREE.Vector3();

      // Состояние сжатия
      this.squeeze = 0;           // 0..1
      this.squeezeVel = 0;
      this.level = SQUEEZE_LEVELS[0];
      this.freeVolume = 1;        // доля свободного объёма
      this.trapped = false;
      this.struggle = 0;          // прогресс выкарабкивания
      this.panicTimer = 0;

      // Инерция при движении
      this.lateralG = 0;          // боковое ускорение
      this.longG = 0;             // продольное
      this.lastSpeed = 0;

      // Визуализация
      this.debugBox = null;
      this.hudEl = null;

      // Накопленная статистика
      this.timeSqueezed = 0;
      this.maxSqueeze = 0;
    }

    /** Габариты салона под текущее такси */
    cabinFor(taxiId) { return CABINS[taxiId] || CABINS.normal; }

    /**
     * ГАБАРИТНЫЙ объём, занимаемый другом в салоне (кубометры).
     *
     * Тесноту создаёт не масса, а габариты: считаем ограничивающий
     * параллелепипед по всем коллайдерам зон и берём коэффициент
     * заполнения 0.55 (тело — не куб, по углам остаются щели,
     * но втиснуться в них человеку всё равно нельзя).
     */
    furryVolume() {
      const f = this.game.furry;
      if (!f.physics) return 0.5;
      const bs = f.bodyScale;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (const c of f.physics.colliders) {
        if (c.zone.inverted) continue;
        minX = Math.min(minX, c.center.x - c.radii.x);
        maxX = Math.max(maxX, c.center.x + c.radii.x);
        minY = Math.min(minY, c.center.y - c.radii.y);
        maxY = Math.max(maxY, c.center.y + c.radii.y);
        minZ = Math.min(minZ, c.center.z - c.radii.z);
        maxZ = Math.max(maxZ, c.center.z + c.radii.z);
      }
      if (!isFinite(minX)) return 0.5;
      // В салоне он не стоит во весь рост, а сидит/лежит — высота сжимается
      const w = (maxX - minX) * bs;
      const h = (maxY - minY) * bs * 0.62;
      const d = (maxZ - minZ) * bs;
      this.furryBox = { w, h, d };
      return w * h * d * 0.55;
    }

    /**
     * Где поедет игрок.
     * @param {string} mode 'together' — рядом с другом, 'cab' — в кабине тягача
     */
    setRideMode(mode) { this.rideMode = mode; }

    /** У больших такси кабина тягача отделена от грузового отсека */
    hasSeparateCab(taxiId) { return taxiId === 'mega' || taxiId === 'ultra'; }

    /** Начать поездку в салоне */
    enter(taxiDef) {
      this.taxiDef = taxiDef;
      this.cabin = this.cabinFor(taxiDef.id);
      // В большом транспорте можно спрятаться в кабину — там не зажмёт
      if (this.hasSeparateCab(taxiDef.id) && this.rideMode === 'cab') {
        this._enterSafeCab(taxiDef);
        return;
      }
      this.active = true;
      this.trapped = false;
      this.struggle = 0;
      this.squeeze = 0;
      this.timeSqueezed = 0;
      this.maxSqueeze = 0;

      // Игрок садится у двери (справа)
      const c = this.cabin;
      this.localPos.set(c.w * 0.30, c.seatH + 0.55, c.len * 0.22);
      this.localVel.set(0, 0, 0);

      const fv = this.furryVolume();
      // Даже когда он больше салона, остаётся щель у двери — минимум 4%
      this.freeVolume = U.clamp(1 - fv / c.volume, 0.04, 1);
      this.overflow = Math.max(0, fv / c.volume - 1);   // во сколько раз НЕ помещается

      const g = this.game;
      g.notify(`🚪 ${c.name}: ${c.volume.toFixed(1)} м³ · друг занимает ${fv.toFixed(1)} м³`, 'info');
      g.notify(`📦 Свободно для тебя: ${Math.round(this.freeVolume * 100)}% объёма`, 
        this.freeVolume < 0.25 ? 'warn' : 'info');
      setTimeout(() => { if (this.active) g.notify(`💺 ${c.desc}`, 'info'); }, 1600);

      this._buildDebug();
    }

    /** Кабина тягача: отдельно от друга, сжатия нет */
    _enterSafeCab(taxiDef) {
      this.active = true;
      this.safeCab = true;
      this.trapped = false;
      this.squeeze = 0;
      this.freeVolume = 1;
      this.overflow = 0;
      const c = this.cabin;
      this.localPos.set(c.w * 0.22, 1.35, taxiDef.len * 0.34);
      this.localVel.set(0, 0, 0);
      const g = this.game;
      g.notify('🚛 Ты в кабине тягача. Друг едет на платформе позади.', 'info');
      g.notify('👀 Его видно в зеркало заднего вида — занимает её целиком.', 'info');
      setTimeout(() => {
        if (this.active) g.furry.say(U.pick([
          'Мне тут просторно! А ты далеко...',
          'Помаши мне в зеркальце~',
          'Я скучаю, приходи назад!',
        ]));
      }, 3000);
    }

    leave() {
      this.safeCab = false;
      this.active = false;
      this.trapped = false;
      this._clearInterior();
      this.game.camera.fov = FF.CONFIG.render.fov;
      this.game.camera.updateProjectionMatrix();
      const g = this.game;
      if (this.maxSqueeze > 0.75) {
        g.notify(`😮‍💨 Выбрался! Максимальное сжатие было ${Math.round(this.maxSqueeze * 100)}%`, 'info');
        g.achieve('squeezed_hard');
      }
      if (this.timeSqueezed > 20) g.achieve('cabin_endurance');
    }

    /** Строим ВИДИМЫЙ салон: пол, потолок, стены, окна, сиденье. */
    _buildDebug() {
      this._clearInterior();
      const c = this.cabin;
      const g = new THREE.Group();
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a2e34, roughness: 0.92, side: THREE.DoubleSide });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x2a2028, roughness: 0.95, side: THREE.DoubleSide });
      const floorMat = new THREE.MeshStandardMaterial({ color: 0x241c22, roughness: 0.88, side: THREE.DoubleSide });
      const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.16,
        roughness: 0.04, transmission: 0.92, thickness: 0.08, side: THREE.DoubleSide });
      const seatMat = new THREE.MeshStandardMaterial({ color: 0x6a4658, roughness: 1 });
      const hw = c.w / 2, hl = c.len / 2;

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.len), floorMat);
      floor.rotation.x = -Math.PI / 2;
      g.add(floor);
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.len), roofMat);
      roof.rotation.x = Math.PI / 2; roof.position.y = c.h;
      g.add(roof);
      for (const sx of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(c.len, c.h), wallMat);
        wall.rotation.y = sx * Math.PI / 2;
        wall.position.set(sx * hw, c.h / 2, 0);
        g.add(wall);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(c.len * 0.7, c.h * 0.44), glassMat);
        win.rotation.y = sx * Math.PI / 2;
        win.position.set(sx * (hw - 0.012), c.h * 0.62, 0);
        g.add(win);
      }
      const front = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.h), wallMat);
      front.position.set(0, c.h / 2, -hl);
      g.add(front);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.h * 0.5), glassMat);
      back.position.set(0, c.h * 0.62, hl - 0.01);
      g.add(back);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(c.w * 0.42, 0.14, 0.52), seatMat);
      seat.position.set(c.w * 0.24, c.seatH, c.len * 0.22);
      g.add(seat);
      const seatBack = new THREE.Mesh(new THREE.BoxGeometry(c.w * 0.42, 0.52, 0.12), seatMat);
      seatBack.position.set(c.w * 0.24, c.seatH + 0.32, c.len * 0.22 + 0.28);
      g.add(seatBack);
      const lamp = new THREE.PointLight(0xffd8a8, 0.85, c.len * 1.6, 2);
      lamp.position.set(0, c.h - 0.12, 0);
      g.add(lamp);
      this.cabinLamp = lamp;

      g.traverse((o) => { if (o.isMesh) { o.renderOrder = -1; o.frustumCulled = false; } });
      this.game.scene.add(g);
      this.interior = g;
    }

    _clearInterior() {
      if (!this.interior) return;
      this.game.scene.remove(this.interior);
      this.interior.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose && o.material.dispose();
      });
      this.interior = null;
    }

    /* --------------------------------------------------------
     * ГЛАВНОЕ ОБНОВЛЕНИЕ
     * -------------------------------------------------------- */
    update(dt) {
      if (!this.active) return;
      const g = this.game;
      const taxi = g.taxi;
      // В кабине тягача — только позиция, без физики сжатия
      if (this.safeCab) { this._updateSafeCab(dt); return; }
      const f = g.furry;
      const c = this.cabin;
      if (!taxi.mesh) return;

      // --- Инерция машины: боковые и продольные перегрузки ---
      const speed = taxi.state === 'driving' ? this.taxiSpeed(taxi) : 0;
      this.longG = U.damp(this.longG, (speed - this.lastSpeed) / Math.max(dt, 0.001) * 0.04, 6, dt);
      this.lastSpeed = speed;
      // Виляние на дороге -> боковое ускорение
      const t = performance.now() * 0.001;
      this.lateralG = Math.sin(t * 0.9) * 0.55 + Math.sin(t * 1.7 + 1.3) * 0.3;
      if (taxi.state !== 'driving') this.lateralG *= 0.15;

      // --- Положение друга в салоне ---
      // Он лежит/сидит в глубине, его центр смещается от перегрузок
      // Чем крупнее — тем ближе его центр к тебе (места не остаётся)
      const crowd = U.clamp(1 - this.freeVolume, 0, 1);
      const furryLocal = _v1.set(
        -c.w * (0.22 - crowd * 0.20) + this.lateralG * 0.16 * (1 + f.stage * 0.1),
        c.seatH + 0.12,
        -c.len * (0.16 - crowd * 0.14) + this.longG * 0.12
      );

      // Двигаем модель друга в салон — чтобы его было ВИДНО вплотную
      const fWorld = _v3.copy(furryLocal);
      fWorld.applyAxisAngle(new THREE.Vector3(0, 1, 0), taxi.mesh.rotation.y);
      fWorld.add(taxi.mesh.position);
      fWorld.y += (taxi.suspension || 0);
      f.root.position.lerp(fWorld, 1 - Math.exp(-12 * dt));
      f.root.rotation.y = U.damp(f.root.rotation.y, taxi.mesh.rotation.y + 0.55, 5, dt);

      // --- Вытеснение: считаем давление от каждой крупной зоны ---
      const bs = f.bodyScale;
      const push = _v2.set(0, 0, 0);
      let maxPen = 0;
      let contactCount = 0;

      if (f.physics) {
        for (const col of f.physics.colliders) {
          // Берём только объёмные зоны — мелочь не толкает
          if (col.zone.gain < 0.25 || col.node.growth < 0.08) continue;

          // Позиция зоны в пространстве салона:
          // локальная позиция зоны + смещение тела в салоне
          const zx = furryLocal.x + (col.center.x) * bs;
          const zy = furryLocal.y + (col.center.y - 1.0) * bs;
          const zz = furryLocal.z + (col.center.z) * bs;

          const rx = col.radii.x * bs, ry = col.radii.y * bs, rz = col.radii.z * bs;

          // Проникновение игрока (радиус 0.28) в эллипсоид зоны
          const pr = 0.28;
          const dx = (this.localPos.x - zx) / (rx + pr);
          const dy = (this.localPos.y - zy) / (ry + pr);
          const dz = (this.localPos.z - zz) / (rz + pr);
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= 1) continue;

          const dist = Math.sqrt(d2) || 1e-4;
          const pen = 1 - dist;
          contactCount++;
          if (pen > maxPen) maxPen = pen;

          // Направление выталкивания
          const n = _v3.set(dx / (rx + pr), dy / (ry + pr), dz / (rz + pr));
          if (n.lengthSq() < 1e-9) n.set(1, 0, 0);
          n.normalize();

          // Мягкая плоть давит настойчиво, но не мгновенно
          const soft = col.softness;
          const force = pen * (0.55 + (1 - soft) * 0.45);
          push.addScaledVector(n, force * Math.min(rx, ry, rz) * 2.4);

          // Игрок в ответ мнёт плоть
          col.node.press(n.clone().negate(), pen * 0.10 * dt * 8);
          col.node.impulse(n.clone().negate(), pen * 4 * dt * 60 * 0.016);
        }
      }

      // Применяем вытеснение
      this.localVel.addScaledVector(push, dt * 26);
      // Инерция кидает игрока по салону
      this.localVel.x += this.lateralG * dt * 1.6;
      this.localVel.z += this.longG * dt * 1.2;
      this.localVel.multiplyScalar(Math.exp(-7 * dt));
      this.localPos.addScaledVector(this.localVel, dt);

      // --- Стены салона: дальше двери не подвинешься ---
      const half = { x: c.w / 2 - 0.26, y: c.h - 0.34, z: c.len / 2 - 0.26 };
      let wallHits = 0;
      if (this.localPos.x > half.x) { this.localPos.x = half.x; this.localVel.x = 0; wallHits++; }
      if (this.localPos.x < -half.x) { this.localPos.x = -half.x; this.localVel.x = 0; wallHits++; }
      if (this.localPos.z > half.z) { this.localPos.z = half.z; this.localVel.z = 0; wallHits++; }
      if (this.localPos.z < -half.z) { this.localPos.z = -half.z; this.localVel.z = 0; wallHits++; }
      if (this.localPos.y > half.y) { this.localPos.y = half.y; this.localVel.y = 0; wallHits++; }
      const floorY = c.seatH + 0.52;
      if (this.localPos.y < floorY) { this.localPos.y = floorY; this.localVel.y = 0; }

      // --- УРОВЕНЬ СЖАТИЯ ---
      // Сжатие = проникновение плоти × прижатие к стене
      const wallFactor = wallHits > 0 ? 1 + wallHits * 0.28 : 0.55;
      // Заполненность салона — основной вклад, контакты добавляют сверху
      const fill = U.clamp(1 - this.freeVolume, 0, 1);
      const over = U.clamp(this.overflow || 0, 0, 1);
      // Переполнение салона — самый весомый фактор: он буквально не помещается
      const target = U.clamp(
        fill * 0.40 + Math.sqrt(over) * 0.42 + maxPen * wallFactor * 0.34 + contactCount * 0.02, 0, 1);
      this.squeeze = U.damp(this.squeeze, target, 3.5, dt);
      this.maxSqueeze = Math.max(this.maxSqueeze, this.squeeze);
      if (this.squeeze > 0.6) this.timeSqueezed += dt;

      // Определяем уровень
      let lvl = SQUEEZE_LEVELS[0];
      for (const l of SQUEEZE_LEVELS) if (this.squeeze >= l.t) lvl = l;
      if (lvl.id !== this.level.id) this._onLevelChange(this.level, lvl);
      this.level = lvl;

      // --- ПОСЛЕДСТВИЯ СЖАТИЯ ---
      this._applyEffects(dt);

      // --- ЗАСТРЕВАНИЕ ---
      if (this.squeeze >= 0.90 && !this.trapped) this._trap();
      if (this.trapped) this._updateStruggle(dt);

      // --- Позиция камеры в мире ---
      const taxiPos = taxi.mesh.position;
      const world = _v1.copy(this.localPos);
      world.applyAxisAngle(new THREE.Vector3(0, 1, 0), taxi.mesh.rotation.y);
      world.add(taxiPos);
      world.y += (taxi.suspension || 0);

      g.player.pos.copy(world);
      g.player.pos.y -= FF.CONFIG.player.eyeHeight;

      if (this.interior) {
        this.interior.position.copy(taxiPos);
        this.interior.position.y += (taxi.suspension || 0);
        this.interior.rotation.y = taxi.mesh.rotation.y;
        if (this.cabinLamp) this.cabinLamp.intensity = 0.85 * (1 - this.squeeze * 0.55);
      }
    }

    _updateSafeCab(dt) {
      const g = this.game, taxi = g.taxi;
      if (!taxi.mesh) return;
      const t = performance.now() * 0.001;
      const sway = Math.sin(t * 1.4) * 0.02;
      const world = _v1.copy(this.localPos);
      world.x += sway;
      world.applyAxisAngle(new THREE.Vector3(0, 1, 0), taxi.mesh.rotation.y);
      world.add(taxi.mesh.position);
      world.y += (taxi.suspension || 0) * 0.4;
      g.player.pos.copy(world);
      g.player.pos.y -= FF.CONFIG.player.eyeHeight;
      g.camera.fov = U.damp(g.camera.fov, FF.CONFIG.render.fov, 4, dt);
      g.camera.updateProjectionMatrix();
    }

    taxiSpeed(taxi) {
      return taxi.state === 'driving' ? (taxi.taxiDef.speed * (taxi.speedMult || 1)) / 3.6 : 0;
    }

    /** Эффекты на игрока от сжатия */
    _applyEffects(dt) {
      const g = this.game;
      const s = this.squeeze;
      const p = g.player;

      // 1. Поле зрения сужается — ощущение стеснённости
      const targetFov = FF.CONFIG.render.fov - s * 16;
      g.camera.fov = U.damp(g.camera.fov, targetFov, 4, dt);
      g.camera.updateProjectionMatrix();

      // 2. Камера прижимается и покачивается от давления
      if (s > 0.3) {
        const shake = (s - 0.3) * 0.028;
        g.camera.position.x += Math.sin(performance.now() * 0.011) * shake;
        g.camera.position.y += Math.sin(performance.now() * 0.017) * shake * 0.7;
        // Наклон головы — тебя вжимает
        p.pitch = U.clamp(p.pitch, -1.45, 1.45 - s * 0.5);
      }

      // 3. Стамина тратится: дышать под массой тяжело
      if (s > 0.55) {
        p.stamina = Math.max(0, p.stamina - (s - 0.55) * 9 * dt);
        // Тяжёлое дыхание
        this._breathT = (this._breathT || 0) - dt;
        if (this._breathT <= 0) {
          this._breathT = U.lerp(2.2, 0.7, s);
          g.audio.noise({ dur: 0.55, gain: 0.05 + s * 0.05, filter: 'bandpass', freq: 420, q: 1.4 });
        }
      } else if (p.mode === 'ride') {
        p.stamina = Math.min(FF.CONFIG.player.maxStamina, p.stamina + dt * 5);
      }

      // 4. Звуки: скрип обивки, шлепки плоти при перегрузках
      if (Math.abs(this.lateralG) > 0.6 && Math.random() < dt * 2.4) {
        g.audio.squish();
        if (s > 0.5) g.audio.jiggle(s);
      }
      if (s > 0.7 && Math.random() < dt * 0.9) g.audio.creak();

      // 5. Реакции друга — ему тоже тесно, но приятно
      this.panicTimer -= dt;
      if (this.panicTimer <= 0 && s > 0.45) {
        this.panicTimer = U.rand(6, 13);
        const f = g.furry;
        if (s > 0.85) {
          f.say(U.pick([
            'Ой! Я тебя раздавлю... подожди, подвинусь!',
            'Прости! Я не помещаюсь... совсем!',
            'Ты там живой? Я тебя не вижу за собой~',
          ]));
          f.setEmotion('shy', 4);
          f.blush = 1;
        } else if (s > 0.62) {
          f.say(U.pick([
            'Мур~ тепло, правда? Только не задохнись.',
            'Я стараюсь подвинуться, честно!',
            'Тесновато нам вдвоём стало...',
          ]));
        } else {
          f.say(U.pick([
            'Мне нравится сидеть так близко~',
            'Мур... прижмись, если хочешь.',
            'Уютно, да?',
          ]));
          f.setEmotion('content', 4);
        }
      }
    }

    _onLevelChange(from, to) {
      const g = this.game;
      const up = SQUEEZE_LEVELS.indexOf(to) > SQUEEZE_LEVELS.indexOf(from);
      g.notify(`${up ? '⚠️' : '✅'} ${to.name}: ${to.hint}`, 
        to.t >= 0.76 ? 'warn' : to.t >= 0.42 ? 'info' : 'feed');
      if (to.id === 'squeezed') g.achieve('squeezed_hard');
      if (up && to.t >= 0.6) g.audio.creak();
    }

    /** Игрока зажало — нужно выбираться */
    _trap() {
      this.trapped = true;
      this.struggle = 0;
      const g = this.game;
      g.notify('🆘 ТЕБЯ ЗАЖАЛО! Дёргай мышью и жми ПРОБЕЛ, чтобы выбраться!', 'warn');
      g.audio.ui('err');
      g.furry.say('Ой! Держись, я попробую подвинуться!');
      g.furry.setEmotion('shy', 6);
      g.achieve('trapped_in_cabin');
    }

    /** Выкарабкивание: мышь + пробел */
    _updateStruggle(dt) {
      const g = this.game;
      const p = g.player;
      // Прогресс от резких движений мышью и пробела
      const mouseEffort = (Math.abs(p.mouseDX || 0) + Math.abs(p.mouseDY || 0)) * 0.0015;
      const spaceEffort = p.keys.Space ? dt * 0.30 : 0;
      this.struggle += mouseEffort + spaceEffort;

      // Плоть сопротивляется
      this.struggle -= dt * 0.07;
      this.struggle = Math.max(0, this.struggle);

      // Толкаем друга — он реально колышется
      if (mouseEffort > 0.002 || spaceEffort > 0) {
        const f = g.furry;
        const zone = f.nodeById.mid_belly;
        zone.impulse(new THREE.Vector3(U.rand(-1, 1), 0.4, U.rand(-1, 1)), 6);
        if (Math.random() < dt * 8) g.audio.squish();
      }

      if (this.struggle >= 1) {
        this.trapped = false;
        this.struggle = 0;
        // Отталкиваемся к двери
        this.localVel.x += 3.2;
        this.squeeze = 0.55;
        g.notify('💪 Выбрался! Прижался к самой двери.', 'quest');
        g.audio.ui('achieve');
        g.furry.say('Уф! Прости-прости~');
        g.achieve('escaped_squeeze');
      }
    }

    /** Данные для HUD */
    hudData() {
      if (!this.active) return null;
      if (this.safeCab) {
        return {
          safeCab: true,
          level: { name: 'Кабина тягача', color: '#8ac6ff', hint: 'Друг на платформе позади. Тебя не зажмёт.' },
          squeeze: 0, freeVolume: 1, trapped: false, struggle: 0,
          cabinName: 'Кабина тягача', cabinVolume: this.cabin.volume,
          furryVol: this.furryVolume(), overflow: 0,
        };
      }
      return {
        level: this.level,
        squeeze: this.squeeze,
        freeVolume: this.freeVolume,
        trapped: this.trapped,
        struggle: this.struggle,
        cabinName: this.cabin.name,
        cabinVolume: this.cabin.volume,
        furryVol: this.furryVolume(),
        box: this.furryBox,
        overflow: this.overflow || 0,
      };
    }

    /** Пересесть — попытка отвоевать место */
    reposition() {
      if (!this.active) return;
      if (this.trapped) {
        this.game.notify('🆘 Сначала выберись!', 'warn');
        return;
      }
      const c = this.cabin;
      // Ищем самое свободное место
      const spots = [
        { x: c.w * 0.34, z: c.len * 0.28, name: 'у правой двери' },
        { x: -c.w * 0.34, z: c.len * 0.28, name: 'у левой двери' },
        { x: c.w * 0.30, z: -c.len * 0.30, name: 'в дальнем углу' },
        { x: 0, z: c.len * 0.38, name: 'у заднего стекла' },
      ];
      let best = spots[0], bestScore = -Infinity;
      const f = this.game.furry;
      const bs = f.bodyScale;
      for (const s of spots) {
        let clearance = Infinity;
        if (f.physics) {
          for (const col of f.physics.colliders) {
            if (col.zone.gain < 0.25) continue;
            const zx = -c.w * 0.16 + col.center.x * bs;
            const zz = -c.len * 0.14 + col.center.z * bs;
            const d = Math.hypot(s.x - zx, s.z - zz) - Math.max(col.radii.x, col.radii.z) * bs;
            clearance = Math.min(clearance, d);
          }
        }
        if (clearance > bestScore) { bestScore = clearance; best = s; }
      }
      this.localPos.x = best.x;
      this.localPos.z = best.z;
      this.localVel.set(0, 0, 0);
      this.game.notify(`💺 Пересел ${best.name}. Свободного места: ${bestScore > 0 ? Math.round(bestScore * 100) + ' см' : 'нет совсем'}`, 'info');
      this.game.audio.ui('click');
    }
  }

  FF.CABINS = CABINS;
  FF.SQUEEZE_LEVELS = SQUEEZE_LEVELS;
  FF.CabinSystem = CabinSystem;
})(typeof window !== 'undefined' ? window : globalThis);
