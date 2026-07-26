/**
 * sugarcab.js — SUGAR CAB: одно такси, тесный салон, защищённая зона игрока
 *
 * Ключевой принцип спецификации: такси ОДНО, размер салона ФИКСИРОВАН.
 * Фурри растёт от кормления и занимает всё больше реального объёма сзади.
 * Игрок всегда в защищённой передней зоне — НИКОГДА не попадает внутрь тела.
 *
 * Стадии:
 *   1–3  обычная поездка, места достаточно
 *   4–5  тесная посадка боком, диван сжимается
 *   6–7  салон почти полностью занят, посадка в 6 фаз
 *   8    «мягкий кокон»: отдых на переднем откидном месте
 *   9–10 overallFit > 1.0 — честно не помещается, поездки недоступны
 *
 * Коллайдеры: playerCapsuleCollider, furryMultiEllipsoidCollisionSkin,
 * rearSeatCollider, frontSeatCollider, softDividerCollider,
 * cameraCollisionSphere, seatBeltSpringConstraint.
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
   * ГАБАРИТЫ SUGAR CAB — фиксированы навсегда
   * ============================================================ */
  const CAB = {
    name: 'Sugar Cab',
    // Кузов
    bodyW: 2.02, bodyH: 1.86, bodyLen: 4.75,
    // Задний салон (куда садится друг)
    rearW: 1.76, rearH: 1.30, rearLen: 1.68,
    rearCenterZ: -0.62,          // смещение назад от центра машины
    seatH: 0.44,
    // Передняя зона игрока (защищённая)
    frontW: 1.70, frontH: 1.24, frontLen: 1.30,
    frontCenterZ: 1.28,
    // Дверной проём
    doorW: 0.92, doorH: 1.22,
    // Прочее
    dividerZ: 0.42,              // мягкая перегородка между зонами
    baseSpeed: 60,
    price: 8,
    driver: 'Джек (заяц)',
    color: 0xffc93c,
  };
  CAB.rearVolume = CAB.rearW * CAB.rearH * CAB.rearLen;      // ≈ 3.61 м³
  CAB.doorArea = CAB.doorW * CAB.doorH;                       // ≈ 1.12 м²

  /* ============================================================
   * ФАЗЫ ПОСАДКИ (для стадий 6–7)
   * ============================================================ */
  const BOARD_PHASES = [
    { id: 'approach', name: 'Подходит к двери', dur: 2.2, help: false,
      furry: ['Так... сейчас соберусь.', 'Дверь вроде широкая...'] },
    { id: 'turn', name: 'Разворачивается боком', dur: 2.6, help: true, key: 'hold',
      furry: ['Надо боком, да?', 'Держи меня, я разворачиваюсь~'] },
    { id: 'enter', name: 'Осторожно проходит в салон', dur: 3.4, help: true, key: 'tap',
      furry: ['Ой... тесновато!', 'Толкай, толкай!'] },
    { id: 'lean', name: 'Опирается на диван', dur: 2.0, help: true, key: 'hold',
      furry: ['Уф, почти...', 'Придержи, пожалуйста~'] },
    { id: 'sit', name: 'Медленно садится', dur: 3.0, help: true, key: 'tap',
      furry: ['Медленно-медленно...', 'Диван выдержит?'] },
    { id: 'tail', name: 'Укладывает хвост', dur: 1.8, help: false,
      furry: ['Хвостик уложу...', 'Вот так. Готово!'] },
  ];

  /* ============================================================
   * SUGAR CAB SYSTEM
   * ============================================================ */
  class SugarCabSystem {
    constructor(game) {
      this.game = game;
      this.state = 'idle';        // idle | arriving | waiting | boarding | riding
      this.mesh = null;
      this.interior = null;

      // Посадка
      this.phaseIndex = 0;
      this.phaseTime = 0;
      this.helpHold = 0;
      this.helpTaps = 0;
      this.boardProgress = 0;

      // Физика салона
      this.seatCompress = 0;      // сжатие дивана 0..1
      this.rearOccupancy = 0;     // занятость заднего салона 0..1+
      this.suspLoad = 0;          // нагрузка подвески 0..1
      this.suspRear = 0;          // просадка задней подвески (м)
      this.suspFront = 0;
      this.suspVelR = 0;
      this.suspVelF = 0;
      this.bodyPitch = 0;         // наклон кузова назад

      // Инерция
      this.lateralAccel = 0;
      this.longAccel = 0;
      this.lastSpeed = 0;

      // Игрок в передней зоне
      this.playerLocal = new THREE.Vector3();
      this.playerVel = new THREE.Vector3();
      this.beltTension = 0;
      this.resting = false;
      this.restProgress = 0;

      // Маршрут
      this.route = null;
      this.rideProgress = 0;
      this.furryStatus = 'ждёт';
    }

    /* --------------------------------------------------------
     * РАСЧЁТ ВМЕЩАЕМОСТИ — honest bounds
     * -------------------------------------------------------- */
    /** Габаритный бокс тела по всем коллайдерам зон */
    furryBounds() {
      const f = this.game.furry;
      if (!f.physics) return { w: 0.7, h: 1.6, d: 0.6, vol: 0.7 };
      const bs = f.bodyScale;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity,
        minZ = Infinity, maxZ = -Infinity;
      for (const c of f.physics.colliders) {
        if (c.zone.inverted) continue;
        minX = Math.min(minX, c.center.x - c.radii.x);
        maxX = Math.max(maxX, c.center.x + c.radii.x);
        minY = Math.min(minY, c.center.y - c.radii.y);
        maxY = Math.max(maxY, c.center.y + c.radii.y);
        minZ = Math.min(minZ, c.center.z - c.radii.z);
        maxZ = Math.max(maxZ, c.center.z + c.radii.z);
      }
      if (!isFinite(minX)) return { w: 0.7, h: 1.6, d: 0.6, vol: 0.7 };
      const w = (maxX - minX) * bs;
      const hFull = (maxY - minY) * bs;
      const d = (maxZ - minZ) * bs;
      // Сидя высота сжимается, ширина и глубина растут (плоть растекается)
      const h = hFull * 0.58;
      const wSit = w * 1.10;
      const dSit = d * 1.14;
      return { w: wSit, h, d: dSit, vol: wSit * h * dSit * 0.56, hFull };
    }

    /**
     * overallFit — насколько друг помещается в задний салон.
     *
     * Коллайдеры зон намеренно шире меша (они перекрываются), поэтому
     * сырой габарит калибруется коэффициентом COLLIDER_CALIB. Дополнительно
     * мягкая плоть сжимается при посадке — учитывается сублинейным сжатием.
     *
     * Опорные точки калибровки взяты из спецификации:
     *   стадии 1–3 свободно, 4–5 тесно, 6–7 почти полностью,
     *   8 «кокон», 9–10 overall > 1.0 (не помещается).
     *
     * < 1.0 помещается, > 1.0 не помещается физически.
     */
    overallFit() {
      const b = this.furryBounds();
      const stage = this.game.furry.stage;

      // Калибровка сырых габаритов к реальному телу
      const K = 0.58;
      const realW = b.w * K, realH = b.h * K, realD = b.d * K;

      // Мягкая плоть утрамбовывается: сублинейное сжатие объёма
      const rawVol = realW * realH * realD;
      const packedVol = Math.pow(rawVol, 0.62);

      // Занятость салона: опорная кривая по стадии (спека) + вклад
      // реального объёма внутри стадии, чтобы кормление ощущалось сразу.
      // Опорные точки: ст.3 → 0.40, ст.5 → 0.66, ст.7 → 0.88, ст.8 → 0.95, ст.9 → 1.10
      const anchors = [0.04, 0.14, 0.27, 0.40, 0.53, 0.66, 0.78, 0.88, 0.95, 1.10, 1.25];
      const si = U.clamp(stage, 0, 10);
      const lo = anchors[Math.floor(si)];
      const hi = anchors[Math.min(10, Math.floor(si) + 1)];
      const stageCurve = U.lerp(lo, hi, si - Math.floor(si));
      // Внутри стадии занятость немного растёт от реального объёма
      const volumeHint = U.clamp(packedVol / 14.0, 0, 1);
      const occupancy = stageCurve * 0.90 + volumeHint * 0.10;

      // Геометрические проверки — для справки в HUD
      const widthFit = realW / CAB.rearW;
      const heightFit = realH / CAB.rearH;
      const depthFit = realD / CAB.rearLen;
      const volumeFit = occupancy;
      const doorFit = Math.min(realW, realD) / CAB.doorW;

      return {
        overall: occupancy, widthFit, heightFit, depthFit, volumeFit, doorFit,
        bounds: { w: realW, h: realH, d: realD, vol: packedVol },
      };
    }

    /**
     * Категория поездки — ровно по спецификации Sugar Cab.
     *   1–3 normal · 4–5 tight · 6–7 phased · 8 cocoon · 9–10 impossible
     */
    rideClass() {
      const fit = this.overallFit();
      const stage = this.game.furry.stage;
      if (stage >= 9 || fit.overall > 1.02) return { id: 'impossible', fit };
      if (stage >= 8 || fit.overall > 0.93) return { id: 'cocoon', fit };
      if (stage >= 6 || fit.overall > 0.72) return { id: 'phased', fit };
      if (stage >= 4 || fit.overall > 0.45) return { id: 'tight', fit };
      return { id: 'normal', fit };
    }

    /* --------------------------------------------------------
     * ВЫЗОВ И ПОСТРОЙКА
     * -------------------------------------------------------- */
    call() {
      if (this.state !== 'idle') { this.game.notify('🚕 Sugar Cab уже здесь.', 'info'); return; }
      const cls = this.rideClass();
      if (cls.id === 'impossible') {
        const pct = Math.round(cls.fit.overall * 100);
        this.game.notify('🚕 Водитель: «Простите, Sugar Cab больше не может безопасно принять вашего друга».', 'warn');
        this.game.notify(`📏 Друг стал слишком большим для поездок на Sugar Cab (габарит ${pct}% от салона).`, 'warn');
        this.game.furry.say(U.pick(['Я не помещусь... совсем.', 'Ничего, пойдём пешком~', 'Прости, я слишком большой стал.']));
        return;
      }
      if (!this.game.inv.spend(CAB.price)) {
        this.game.notify(`🪙 Не хватает монет (${CAB.price}).`, 'warn'); return;
      }
      this._build();
      this.state = 'arriving';
      this.game.notify(`🚕 Sugar Cab едет! Водитель: ${CAB.driver}`, 'info');
    }

    _build() {
      if (this.mesh) this.game.scene.remove(this.mesh);
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: CAB.color, roughness: 0.42, metalness: 0.38 });
      const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xa8d0f0, transparent: true, opacity: 0.30,
        roughness: 0.04, transmission: 0.88, thickness: 0.1, side: THREE.DoubleSide });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e1a1c, roughness: 0.85 });

      // Кузов
      const body = new THREE.Mesh(new THREE.BoxGeometry(CAB.bodyW, CAB.bodyH * 0.52, CAB.bodyLen), bodyMat);
      body.position.y = CAB.bodyH * 0.40;
      g.add(body);
      // Крыша с окнами
      const cabinTop = new THREE.Mesh(new THREE.BoxGeometry(CAB.bodyW * 0.92, CAB.bodyH * 0.46, CAB.bodyLen * 0.62), glassMat);
      cabinTop.position.set(0, CAB.bodyH * 0.86, -0.15);
      g.add(cabinTop);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(CAB.bodyW * 0.88, 0.07, CAB.bodyLen * 0.58), bodyMat);
      roof.position.set(0, CAB.bodyH * 1.08, -0.15);
      g.add(roof);
      // Шашечки
      for (let i = 0; i < 10; i++) {
        const check = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.17, 0.02),
          new THREE.MeshStandardMaterial({ color: i % 2 ? 0x1a1a1a : 0xffffff, roughness: 0.6 }));
        check.position.set(-CAB.bodyW / 2 - 0.01, CAB.bodyH * 0.52, -CAB.bodyLen / 2 + 0.4 + i * 0.38);
        check.rotation.y = Math.PI / 2;
        g.add(check);
      }
      // Плафон «TAXI»
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.17, 0.20),
        new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffb040, emissiveIntensity: 1.3 }));
      sign.position.set(0, CAB.bodyH * 1.16, -0.15);
      g.add(sign);
      // Колёса
      this.wheels = [];
      const wr = 0.34;
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.22, 14), darkMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(sx * (CAB.bodyW / 2 - 0.05), wr, sz * (CAB.bodyLen / 2 - 0.85));
        w.userData.rear = sz < 0;
        g.add(w); this.wheels.push(w);
      }
      // Фары
      for (const sx of [-1, 1]) {
        const l = new THREE.PointLight(0xfff0c0, 1.5, 20, 2);
        l.position.set(sx * 0.6, 0.66, CAB.bodyLen / 2);
        g.add(l);
      }
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.game.scene.add(g);
      this.mesh = g;
      this.bodyMesh = body;
      this.cabinTopMesh = cabinTop;
      this.roofMesh = roof;

      const stop = this.game.world.taxiStop;
      g.position.set(stop.x + 34, 0, stop.z + 34);
    }

    /** Интерьер: задний диван, переднее кресло, перегородка, плед */
    _buildInterior() {
      this._clearInterior();
      const g = new THREE.Group();
      const seatMat = new THREE.MeshStandardMaterial({ color: 0x6a4658, roughness: 1, side: THREE.DoubleSide });
      const trimMat = new THREE.MeshStandardMaterial({ color: 0x2e2429, roughness: 0.92, side: THREE.DoubleSide });
      const dividerMat = new THREE.MeshStandardMaterial({ color: 0x4a3a44, roughness: 0.95,
        transparent: true, opacity: 0.88, side: THREE.DoubleSide });

      // Пол
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(CAB.rearW, CAB.bodyLen * 0.75), trimMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, 0.28, 0);
      g.add(floor);

      // Задний диван (rearSeatCollider визуально)
      const seat = new THREE.Mesh(new THREE.BoxGeometry(CAB.rearW * 0.96, 0.20, CAB.rearLen * 0.82), seatMat);
      seat.position.set(0, CAB.seatH, CAB.rearCenterZ);
      g.add(seat);
      this.rearSeatMesh = seat;
      const seatBack = new THREE.Mesh(new THREE.BoxGeometry(CAB.rearW * 0.96, 0.62, 0.14), seatMat);
      seatBack.position.set(0, CAB.seatH + 0.36, CAB.rearCenterZ - CAB.rearLen * 0.42);
      g.add(seatBack);
      this.rearSeatBack = seatBack;

      // Переднее кресло игрока (frontSeatCollider)
      const fSeat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.56), seatMat);
      fSeat.position.set(0.42, CAB.seatH, CAB.frontCenterZ);
      g.add(fSeat);
      const fBack = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.13), seatMat);
      fBack.position.set(0.42, CAB.seatH + 0.28, CAB.frontCenterZ + 0.30);
      g.add(fBack);
      // Боковой кокон сиденья
      const cocoon = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.52, 0.56), seatMat);
      cocoon.position.set(0.76, CAB.seatH + 0.30, CAB.frontCenterZ);
      g.add(cocoon);

      // МЯГКАЯ ПЕРЕГОРОДКА (softDividerCollider) — защищает игрока
      const divider = new THREE.Mesh(new THREE.BoxGeometry(CAB.rearW, CAB.rearH * 0.40, 0.09), dividerMat);
      divider.position.set(0, CAB.seatH + 0.20, CAB.dividerZ);
      g.add(divider);
      this.dividerMesh = divider;

      // Подушка у окна + плед (для «кокона»)
      const pillow = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 9),
        new THREE.MeshStandardMaterial({ color: 0xd8a8c0, roughness: 1 }));
      pillow.scale.set(1, 0.66, 1.25);
      pillow.position.set(0.74, CAB.seatH + 0.56, CAB.frontCenterZ - 0.10);
      g.add(pillow);
      this.pillowMesh = pillow;
      const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.05, 0.60),
        new THREE.MeshStandardMaterial({ color: 0x8a6a9a, roughness: 1 }));
      blanket.position.set(0.42, CAB.seatH + 0.14, CAB.frontCenterZ - 0.04);
      blanket.visible = false;
      g.add(blanket);
      this.blanketMesh = blanket;

      // Приглушённый свет салона
      const lamp = new THREE.PointLight(0xffd0a0, 2.6, 6.5, 1.6);
      lamp.position.set(0, CAB.rearH + 0.20, 0);
      g.add(lamp);
      this.cabinLamp = lamp;
      const rearLamp = new THREE.PointLight(0xffc890, 2.2, 5.5, 1.7);
      rearLamp.position.set(0, CAB.rearH + 0.10, CAB.rearCenterZ);
      g.add(rearLamp);
      this.rearLamp = rearLamp;

      g.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = -1; } });
      this.mesh.add(g);
      this.interior = g;
    }

    _clearInterior() {
      if (!this.interior) return;
      this.mesh && this.mesh.remove(this.interior);
      this.interior.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose && o.material.dispose();
      });
      this.interior = null;
    }

    /* --------------------------------------------------------
     * ПОСАДКА
     * -------------------------------------------------------- */
    startBoarding(locId) {
      const cls = this.rideClass();
      if (cls.id === 'impossible') {
        this.game.notify('🚕 Друг не помещается в Sugar Cab.', 'warn');
        return false;
      }
      this.targetLoc = locId;
      this._buildInterior();
      this.state = 'boarding';
      this.phaseIndex = 0;
      this.phaseTime = 0;
      this.helpHold = 0;
      this.helpTaps = 0;
      this.boardProgress = 0;
      this.rideCls = cls;

      const f = this.game.furry;
      this._furryStart = f.root.position.clone();

      if (cls.id === 'normal') {
        this.game.notify('🚕 Друг спокойно входит через боковую дверь.', 'info');
        f.say(U.pick(['Поехали!', 'Люблю кататься~']));
        this.phases = [BOARD_PHASES[0], BOARD_PHASES[4]];
      } else if (cls.id === 'tight') {
        this.game.notify('🚕 Тесно: друг разворачивается боком перед дверью.', 'info');
        f.say(U.pick(['Надо боком...', 'Сейчас протиснусь!']));
        this.phases = [BOARD_PHASES[0], BOARD_PHASES[1], BOARD_PHASES[4], BOARD_PHASES[5]];
      } else {
        this.game.notify('🚕 Салон почти полностью занят. Посадка в 6 фаз — помогай!', 'warn');
        this.game.notify('🤝 Удерживай E и жми Space, когда попросят.', 'info');
        f.say(U.pick(['Помоги мне, пожалуйста~', 'Это будет непросто...']));
        this.phases = BOARD_PHASES.slice();
      }
      this.furryStatus = 'проходит в дверь';
      return true;
    }

    _updateBoarding(dt) {
      const g = this.game;
      const f = g.furry;
      const ph = this.phases[this.phaseIndex];
      if (!ph) { this._finishBoarding(); return; }

      this.phaseTime += dt;

      // Помощь игрока ускоряет фазу
      let speed = 1;
      if (ph.help) {
        if (ph.key === 'hold') {
          if (g.player.keys.KeyE) { this.helpHold += dt; speed = 1.9; }
          else speed = 0.55;
        } else if (ph.key === 'tap') {
          speed = 0.6 + Math.min(1.4, this.helpTaps * 0.14);
        }
      }
      const need = ph.dur;
      const prog = this.phaseTime * speed / need;

      // Движение друга к сиденью по фазам
      const total = this.phases.length;
      const overall = (this.phaseIndex + U.clamp(prog, 0, 1)) / total;
      this.boardProgress = overall;

      const seatWorld = this._rearSeatWorld();
      const doorWorld = this._doorWorld();
      let target;
      if (overall < 0.35) {
        target = this._furryStart.clone().lerp(doorWorld, overall / 0.35);
      } else {
        target = doorWorld.clone().lerp(seatWorld, (overall - 0.35) / 0.65);
      }
      f.root.position.lerp(target, 1 - Math.exp(-6 * dt));
      // Боком в дверь
      const sideways = (ph.id === 'turn' || ph.id === 'enter') ? Math.PI * 0.42 : 0;
      f.root.rotation.y = U.damp(f.root.rotation.y,
        this.mesh.rotation.y + Math.PI + sideways, 4, dt);

      // Постепенная утрамбовка по мере входа в салон
      const rawB = this.furryBounds();
      const tgt = U.clamp(Math.min(
        CAB.rearW * 0.80 / Math.max(0.01, rawB.w * 0.58),
        CAB.rearH * 0.82 / Math.max(0.01, rawB.h * 0.58),
        CAB.rearLen * 0.90 / Math.max(0.01, rawB.d * 0.58)), 0.16, 1);
      const blend = U.lerp(1, tgt, U.clamp(overall * 1.3, 0, 1));
      this.cabinSquash = U.damp(this.cabinSquash || 1, blend, 3, dt);
      const sc = this.cabinSquash * f.bodyScale;
      f.root.scale.set(sc, sc * 0.88, sc * 1.06);

      // Тело колышется от усилий
      if (Math.random() < dt * 5) {
        f.wave(f.root.position.clone().add(new THREE.Vector3(0, 1, 0)), 0.5);
      }
      if (Math.random() < dt * 1.3) g.audio.creak();
      if (ph.help && Math.random() < dt * 1.8) g.audio.squish();

      this.furryStatus = ph.name.toLowerCase();

      if (prog >= 1) {
        f.say(U.pick(ph.furry));
        this.phaseIndex++;
        this.phaseTime = 0;
        this.helpTaps = 0;
        if (this.phaseIndex < this.phases.length) {
          const nx = this.phases[this.phaseIndex];
          g.notify(`🚕 Фаза ${this.phaseIndex + 1}/${this.phases.length}: ${nx.name}` +
            (nx.help ? (nx.key === 'hold' ? ' — удерживай E!' : ' — жми Space!') : ''), 'info');
        } else this._finishBoarding();
      }
    }

    /** Нажатие Space во время фазы tap */
    tapHelp() {
      if (this.state !== 'boarding') return;
      const ph = this.phases[this.phaseIndex];
      if (ph && ph.help && ph.key === 'tap') {
        this.helpTaps++;
        this.game.audio.ui('click');
        const f = this.game.furry;
        f.nodeById.mid_belly.impulse(new THREE.Vector3(0, 0.3, -1), 7);
      }
    }

    _rearSeatWorld() {
      // Чем крупнее друг, тем глубже его сажают, чтобы влез в задний отсек
      const push = U.clamp(this.rearOccupancy || 0, 0, 1) * 0.55;
      const p = _v1.set(0, CAB.seatH - 0.06, CAB.rearCenterZ - push);
      p.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
      return p.add(this.mesh.position);
    }
    _doorWorld() {
      const p = _v2.set(CAB.bodyW * 0.72, 0, CAB.rearCenterZ + 0.2);
      p.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
      return p.add(this.mesh.position);
    }
    _frontSeatWorld() {
      const p = _v3.set(0.42, CAB.seatH + 0.52, CAB.frontCenterZ);
      p.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
      return p.add(this.mesh.position);
    }

    _finishBoarding() {
      const g = this.game;
      this.state = 'riding';
      this.furryStatus = 'сидит';
      this.rideProgress = 0;
      const to = FF.LOC_BY_ID[this.targetLoc];
      this.route = {
        from: this.mesh.position.clone(),
        to: new THREE.Vector3(to.x, 0, to.z + 8),
        locId: this.targetLoc,
      };
      // Игрок садится в переднее кресло
      g.player.mode = 'ride';
      // FOV салона выставляем ОДИН раз здесь и больше не трогаем
      this._fovSet = true;
      g.camera.fov = FF.CONFIG.render.fov + 18;
      g.camera.updateProjectionMatrix();
      this.playerLocal.set(0.42, CAB.seatH + 0.86, CAB.frontCenterZ);
      this.playerVel.set(0, 0, 0);
      this.resting = false;
      this.restProgress = 0;

      const fit = this.rideClass().fit;
      const occ = Math.round(U.clamp(fit.volumeFit, 0, 1.2) * 100);
      g.notify(`✅ Друг устроился. Задний диван занят на ${occ}%.`, 'quest');
      g.notify(`🧍 Ты пристёгнут в переднем кресле. Едем: ${to.name}`, 'info');
      if (this.rideCls.id === 'cocoon') {
        g.notify('🛏 Можно нажать E — «Отдохнуть до прибытия».', 'info');
      }
      g.audio.creak();
      g.furry.setEmotion('content', 8);
    }

    /* --------------------------------------------------------
     * ПОЕЗДКА
     * -------------------------------------------------------- */
    _updateRiding(dt) {
      const g = this.game;
      const f = g.furry;

      // --- Движение по маршруту ---
      const fit = this.overallFit();
      // Чем тяжелее, тем медленнее
      const speedFactor = U.clamp(1 - fit.volumeFit * 0.45, 0.35, 1);
      const dist = this.route.from.distanceTo(this.route.to);
      const travelSec = Math.max(20, dist / (CAB.baseSpeed * speedFactor / 3.6) * 0.9);
      const rate = this.resting ? 3.2 : 1;      // при отдыхе время ускоряется
      this.rideProgress += dt / travelSec * rate;
      const t = U.clamp(this.rideProgress, 0, 1);
      const p = this.route.from.clone().lerp(this.route.to, t);
      p.y = g.world.heightAt(p.x, p.z);
      this.mesh.position.copy(p);
      const dir = this.route.to.clone().sub(this.route.from).normalize();
      this.mesh.rotation.y = Math.atan2(dir.x, dir.z);

      // --- Инерция: повороты и торможение ---
      const now = performance.now() * 0.001;
      this.lateralAccel = Math.sin(now * 0.85) * 0.62 + Math.sin(now * 1.9 + 1.1) * 0.34;
      const curSpeed = CAB.baseSpeed * speedFactor / 3.6;
      this.longAccel = U.damp(this.longAccel, (curSpeed - this.lastSpeed) / Math.max(dt, 0.001) * 0.03, 5, dt);
      this.lastSpeed = curSpeed;
      // Периодические торможения
      this._brakeT = (this._brakeT || 0) - dt;
      if (this._brakeT <= 0) {
        this._brakeT = U.rand(5, 11);
        this.longAccel -= 1.5;
        g.notify('🛑 Торможение!', 'info');
      }

      // --- Занятость и сжатие дивана ---
      this.rearOccupancy = U.clamp(fit.volumeFit, 0, 1.3);
      const targetCompress = U.clamp(fit.volumeFit * 0.85 + f.mass / 3000, 0, 1);
      this.seatCompress = U.damp(this.seatCompress, targetCompress, 3, dt);
      this.suspLoad = U.clamp(f.mass / 1800, 0, 1);

      // --- Подвеска: задняя проседает, кузов наклоняется ---
      const targetRear = -0.16 * this.suspLoad - 0.05 * Math.max(0, this.longAccel * -0.4);
      const targetFront = -0.04 * this.suspLoad + 0.06 * Math.max(0, -this.longAccel * 0.5);
      this.suspVelR += (targetRear - this.suspRear) * 46 * dt;
      this.suspVelF += (targetFront - this.suspFront) * 52 * dt;
      this.suspVelR *= Math.exp(-5.2 * dt);
      this.suspVelF *= Math.exp(-6.0 * dt);
      this.suspRear += this.suspVelR * dt;
      this.suspFront += this.suspVelF * dt;
      this.bodyPitch = U.damp(this.bodyPitch, (this.suspRear - this.suspFront) * 0.55, 6, dt);

      if (this.bodyMesh) {
        const sag = (this.suspRear + this.suspFront) * 0.5;
        this.bodyMesh.position.y = CAB.bodyH * 0.40 + sag;
        this.cabinTopMesh.position.y = CAB.bodyH * 0.86 + sag;
        this.roofMesh.position.y = CAB.bodyH * 1.08 + sag;
        this.mesh.rotation.x = this.bodyPitch;
        this.mesh.rotation.z = U.damp(this.mesh.rotation.z, this.lateralAccel * 0.024, 5, dt);
      }
      if (this.interior) this.interior.position.y = (this.suspRear + this.suspFront) * 0.5;

      // Диван продавливается визуально
      if (this.rearSeatMesh) {
        this.rearSeatMesh.scale.y = 1 - this.seatCompress * 0.55;
        this.rearSeatMesh.position.y = CAB.seatH - this.seatCompress * 0.09;
      }

      // --- УТРАМБОВКА: мягкая плоть сжимается по габаритам салона ---
      // Физически честно: жир деформируется, тело «расплывается» по дивану,
      // а не торчит сквозь крышу. Пропорции сохраняются, высота жмётся сильнее.
      const raw = this.furryBounds();
      const fitW = CAB.rearW * 0.80 / Math.max(0.01, raw.w * 0.58);
      const fitH = CAB.rearH * 0.82 / Math.max(0.01, raw.h * 0.58);
      const fitD = CAB.rearLen * 0.90 / Math.max(0.01, raw.d * 0.58);
      const squash = U.clamp(Math.min(fitW, fitH, fitD), 0.16, 1);
      this.cabinSquash = U.damp(this.cabinSquash || 1, squash, 4, dt);
      const s = this.cabinSquash * f.bodyScale;
      f.root.scale.set(s, s * 0.88, s * 1.06);

      // --- Друг на заднем диване ---
      const seatW = this._rearSeatWorld();
      seatW.y += this.suspRear - this.seatCompress * 0.06;
      // Инерция смещает тело
      seatW.x += this.lateralAccel * 0.09 * (1 + fit.volumeFit);
      seatW.z += this.longAccel * 0.06;
      f.root.position.lerp(seatW, 1 - Math.exp(-9 * dt));
      f.root.rotation.y = U.damp(f.root.rotation.y, this.mesh.rotation.y + Math.PI, 4, dt);

      // Вторичная физика тела: волны от поворотов и торможения
      const jolt = Math.abs(this.lateralAccel) + Math.abs(this.longAccel);
      if (jolt > 0.7 && Math.random() < dt * 6) {
        const dirImp = new THREE.Vector3(-this.lateralAccel, 0.15, -this.longAccel).normalize();
        for (const id of ['mid_belly', 'lower_belly', 'left_moob', 'right_moob',
          'lower_left_glute', 'lower_right_glute', 'tail_base']) {
          const nd = f.nodeById[id];
          if (nd) nd.impulse(dirImp, jolt * 4.5);
        }
        if (Math.random() < 0.4) g.audio.jiggle(Math.min(1.4, jolt));
      }
      if (Math.random() < dt * 2.2) g.audio.engine(this.suspLoad);
      if (this.suspLoad > 0.5 && Math.random() < dt * 1.1) g.audio.creak();

      // --- ИГРОК В ЗАЩИЩЁННОЙ ПЕРЕДНЕЙ ЗОНЕ ---
      this._updatePlayerFront(dt);

      // --- Отдых («мягкий кокон») ---
      if (this.resting) {
        this.restProgress = Math.min(1, this.restProgress + dt * 0.5);
        if (this.blanketMesh) this.blanketMesh.visible = true;
      }

      if (t >= 1) this._arrive();
    }

    /**
     * Игрок ВСЕГДА в передней зоне. Мягкая перегородка и ремень
     * не дают попасть внутрь тела друга или в стены.
     */
    _updatePlayerFront(dt) {
      const g = this.game;
      const anchor = _v1.set(0.42, CAB.seatH + 0.86, CAB.frontCenterZ);

      // Силы инерции сдвигают в пределах кресла
      this.playerVel.x += -this.lateralAccel * dt * 1.4;
      this.playerVel.z += this.longAccel * dt * 1.0;
      // seatBeltSpringConstraint — ремень возвращает к якорю
      const toAnchor = _v2.copy(anchor).sub(this.playerLocal);
      const belt = toAnchor.length();
      this.beltTension = U.clamp(belt / 0.22, 0, 1);
      this.playerVel.addScaledVector(toAnchor, 34 * dt * (0.5 + this.beltTension));
      this.playerVel.multiplyScalar(Math.exp(-7.5 * dt));
      this.playerLocal.addScaledVector(this.playerVel, dt);

      // Жёсткие границы передней зоны — дальше кресла не сдвинешься
      const lim = 0.17;
      this.playerLocal.x = U.clamp(this.playerLocal.x, anchor.x - lim, anchor.x + lim);
      this.playerLocal.z = U.clamp(this.playerLocal.z, anchor.z - lim, anchor.z + lim * 0.6);
      this.playerLocal.y = U.clamp(this.playerLocal.y, anchor.y - 0.06, anchor.y + 0.06);
      // softDividerCollider: за перегородку не пройти
      const dividerLimit = CAB.dividerZ + 0.30;
      if (this.playerLocal.z < dividerLimit) {
        this.playerLocal.z = dividerLimit;
        this.playerVel.z = Math.max(0, this.playerVel.z);
        // Перегородка слегка пружинит
        if (this.dividerMesh) this.dividerMesh.position.z = CAB.dividerZ - 0.02;
      } else if (this.dividerMesh) {
        this.dividerMesh.position.z = U.damp(this.dividerMesh.position.z, CAB.dividerZ, 8, dt);
      }

      // В мир
      const world = _v3.copy(this.playerLocal);
      world.y += this.suspFront;
      // При отдыхе камера опускается к окну
      if (this.resting) {
        world.y -= this.restProgress * 0.26;
        world.x += this.restProgress * 0.14;
      }
      world.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y);
      world.add(this.mesh.position);

      g.player.pos.copy(world);
      g.player.pos.y -= FF.CONFIG.player.eyeHeight;

      // FOV в салоне ФИКСИРОВАН: выставляется один раз при посадке и не
      // «дышит» во время поездки — постоянные изменения раздражают.
      if (!this._fovSet) {
        this._fovSet = true;
        g.camera.fov = FF.CONFIG.render.fov + 18;
        g.camera.updateProjectionMatrix();
      }

      // Лёгкая тряска от дороги (cameraCollisionSphere не даёт клипаться)
      if (!this.resting) {
        const shake = 0.004 + this.suspLoad * 0.004;
        g.camera.position.x += Math.sin(performance.now() * 0.019) * shake;
        g.camera.position.y += Math.sin(performance.now() * 0.026) * shake;
      }
    }

    /** E на переднем кресле — отдых до прибытия */
    tryRest() {
      if (this.state !== 'riding') return false;
      if (this.resting) return false;
      if (this.rideCls.id !== 'cocoon' && this.rideClass().fit.volumeFit < 0.55) {
        this.game.notify('🛏 Отдыхать удобно, когда сзади уже тесно. Пока просто смотри в окно.', 'info');
        return false;
      }
      this.resting = true;
      this.restProgress = 0;
      const g = this.game;
      g.notify('🛏 Отдых в пути. Мягкий плед, подушка у окна, приглушённый свет.', 'quest');
      g.audio.setVolume('music', FF.CONFIG.audio.musicVolume * 0.35);
      g.furry.say(U.pick(['Отдыхай, я посторожу~', 'Спи, я рядом.', 'Мур... сладких снов.']));
      g.achieve('cab_rest');
      return true;
    }

    _arrive() {
      const g = this.game;
      const loc = FF.LOC_BY_ID[this.route.locId];
      this.state = 'idle';
      this.resting = false;
      g.audio.setVolume('music', FF.CONFIG.audio.musicVolume);
      g.player.mode = 'walk';
      g.player.teleport(loc.x + 4, loc.z + 11);
      g.furry.root.position.set(loc.x - 3, g.world.heightAt(loc.x - 3, loc.z + 11), loc.z + 11);
      g.furry.root.rotation.x = 0;
      // Возвращаем нормальные габариты — плоть распрямляется
      this.cabinSquash = 1;
      g.furry.root.scale.setScalar(g.furry.bodyScale);
      this._fovSet = false;
      g.camera.fov = FF.CONFIG.render.fov;
      g.camera.updateProjectionMatrix();
      g.notify(`📍 Прибыли: ${loc.name}`, 'quest');
      g.quests.event('visit', { id: loc.id });
      g.visited.add(loc.id);
      this._clearInterior();
      if (this.mesh) { g.scene.remove(this.mesh); this.mesh = null; }
      this.rideProgress = 0;
      this.route = null;
    }

    /* --------------------------------------------------------
     * ГЛАВНОЕ ОБНОВЛЕНИЕ
     * -------------------------------------------------------- */
    update(dt) {
      if (this.state === 'idle' || !this.mesh) return;

      if (this.state === 'arriving') {
        const stop = this.game.world.taxiStop;
        const target = _v1.set(stop.x, this.game.world.heightAt(stop.x, stop.z), stop.z);
        this.mesh.position.lerp(target, 1 - Math.exp(-2.0 * dt));
        this.mesh.rotation.y = U.damp(this.mesh.rotation.y, 0, 3, dt);
        if (this.wheels) this.wheels.forEach((w) => (w.rotation.x += dt * 9));
        if (Math.random() < dt * 5) this.game.audio.engine(0.4);
        if (this.mesh.position.distanceTo(target) < 1.0) {
          this.state = 'waiting';
          this.game.notify('🚕 Sugar Cab прибыл! Нажми E, чтобы выбрать маршрут.', 'info');
          this.game.audio.creak();
        }
      } else if (this.state === 'boarding') {
        this._updateBoarding(dt);
      } else if (this.state === 'riding') {
        this._updateRiding(dt);
        if (this.wheels) this.wheels.forEach((w) => (w.rotation.x += dt * 11));
      }
    }

    /** Данные для HUD по спецификации */
    hud() {
      if (this.state !== 'riding' && this.state !== 'boarding') return null;
      const fit = this.overallFit();
      return {
        state: this.state,
        rear: Math.round(U.clamp(fit.volumeFit, 0, 1.3) * 100),
        seat: Math.round(this.seatCompress * 100),
        susp: Math.round(this.suspLoad * 100),
        furryStatus: this.furryStatus,
        playerStatus: this.resting ? 'отдыхает' : 'переднее кресло',
        route: this.route ? FF.LOC_BY_ID[this.route.locId].name : '—',
        resting: this.resting,
        phase: this.state === 'boarding' && this.phases
          ? `${this.phaseIndex + 1}/${this.phases.length} ${(this.phases[this.phaseIndex] || {}).name || ''}` : null,
        needHold: this.state === 'boarding' && this.phases
          && (this.phases[this.phaseIndex] || {}).key === 'hold',
        needTap: this.state === 'boarding' && this.phases
          && (this.phases[this.phaseIndex] || {}).key === 'tap',
        overall: fit.overall,
      };
    }
  }

  FF.CAB = CAB;
  FF.BOARD_PHASES = BOARD_PHASES;
  FF.SugarCabSystem = SugarCabSystem;
})(typeof window !== 'undefined' ? window : globalThis);
