/**
 * hands.js — АНИМИРОВАННЫЕ РУКИ ИГРОКА
 *
 * Полноценные руки с суставами и процедурной анимацией:
 *   • 5 пальцев × 3 фаланги = 15 суставов на руку
 *   • Инверсная кинематика плеча/локтя (2-звенный аналитический IK)
 *   • Позы: покой, указание, хват, щипок, ладонь, массаж, кормление, шлепок
 *   • Плавные переходы между позами, независимые пальцы
 *   • Процедурное дыхание, покачивание при ходьбе, отдача при ударе
 *   • Деформация пальцев при контакте с мягкой плотью
 *
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  /* ============================================================
   * ПОЗЫ КИСТИ
   * Каждая поза — целевые углы сгиба для 5 пальцев × 3 фаланги.
   * Значения 0..1, где 1 — полный сгиб.
   * Порядок пальцев: [большой, указательный, средний, безымянный, мизинец]
   * ============================================================ */
  const POSES = {
    // Расслабленная кисть — пальцы чуть подогнуты, как в жизни
    rest: {
      curl: [[0.18, 0.22, 0.15], [0.20, 0.28, 0.30], [0.24, 0.32, 0.34], [0.26, 0.34, 0.36], [0.28, 0.36, 0.38]],
      spread: [0.35, 0.10, 0, -0.08, -0.16], wrist: [-0.15, 0, 0],
    },
    // Указание — указательный вытянут
    point: {
      curl: [[0.30, 0.40, 0.20], [0.02, 0.02, 0.02], [0.85, 0.90, 0.80], [0.88, 0.92, 0.82], [0.86, 0.90, 0.80]],
      spread: [0.30, 0.05, -0.02, -0.06, -0.10], wrist: [-0.05, 0, 0],
    },
    // Хват — пальцы обхватывают складку
    grip: {
      curl: [[0.55, 0.70, 0.60], [0.80, 0.92, 0.88], [0.84, 0.94, 0.90], [0.84, 0.94, 0.90], [0.80, 0.92, 0.86]],
      spread: [0.42, 0.06, 0, -0.05, -0.10], wrist: [-0.35, 0, 0],
    },
    // Щипок — большой и указательный вместе
    pinch: {
      curl: [[0.50, 0.62, 0.55], [0.52, 0.68, 0.60], [0.70, 0.80, 0.72], [0.76, 0.84, 0.76], [0.78, 0.86, 0.78]],
      spread: [0.15, -0.05, -0.02, -0.06, -0.12], wrist: [-0.20, 0, 0],
    },
    // Открытая ладонь — гладить, шлёпать
    palm: {
      curl: [[0.10, 0.12, 0.08], [0.05, 0.06, 0.04], [0.04, 0.05, 0.03], [0.05, 0.06, 0.04], [0.08, 0.10, 0.06]],
      spread: [0.55, 0.16, 0.02, -0.12, -0.26], wrist: [0.10, 0, 0],
    },
    // Массаж — полусогнутые, разведённые
    massage: {
      curl: [[0.35, 0.45, 0.40], [0.38, 0.50, 0.46], [0.40, 0.52, 0.48], [0.38, 0.50, 0.46], [0.36, 0.48, 0.44]],
      spread: [0.48, 0.18, 0.04, -0.10, -0.22], wrist: [-0.08, 0, 0],
    },
    // Кормление — держит еду щепотью
    feed: {
      curl: [[0.45, 0.55, 0.50], [0.42, 0.58, 0.52], [0.46, 0.60, 0.54], [0.62, 0.72, 0.66], [0.70, 0.80, 0.72]],
      spread: [0.22, 0.02, -0.02, -0.08, -0.14], wrist: [-0.25, 0, 0],
    },
    // Кулак
    fist: {
      curl: [[0.70, 0.85, 0.80], [0.92, 0.98, 0.95], [0.94, 0.98, 0.96], [0.94, 0.98, 0.96], [0.92, 0.96, 0.94]],
      spread: [0.20, 0, 0, 0, 0], wrist: [-0.30, 0, 0],
    },
    // Держит предмет (кружка, инструмент)
    hold: {
      curl: [[0.48, 0.60, 0.55], [0.65, 0.80, 0.75], [0.68, 0.82, 0.78], [0.68, 0.82, 0.78], [0.66, 0.80, 0.76]],
      spread: [0.38, 0.05, 0, -0.05, -0.10], wrist: [-0.18, 0, 0],
    },
  };

  const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  // Длины фаланг для каждого пальца (метры)
  const PHALANX = [
    [0.030, 0.026, 0.020],   // большой — короче и толще
    [0.032, 0.024, 0.017],   // указательный
    [0.034, 0.026, 0.018],   // средний — самый длинный
    [0.031, 0.024, 0.017],   // безымянный
    [0.026, 0.019, 0.015],   // мизинец
  ];
  const FINGER_RADIUS = [0.0115, 0.0098, 0.0100, 0.0092, 0.0080];
  // Базовые позиции оснований пальцев на ладони (x — поперёк, z — вперёд)
  const KNUCKLES = [
    { x: -0.042, y: -0.004, z: 0.020, base: 0.95 },   // большой — сбоку и назад
    { x: -0.032, y: 0.002, z: -0.052 },
    { x: -0.010, y: 0.003, z: -0.058 },
    { x: 0.012, y: 0.002, z: -0.054 },
    { x: 0.032, y: 0.000, z: -0.046 },
  ];

  /* ============================================================
   * КЛАСС РУКИ
   * ============================================================ */
  class AnimatedHand {
    /**
     * @param {number} side -1 левая, +1 правая
     * @param {THREE.Object3D} parent — камера
     * @param {object} opts — {skinColor, sleeveColor}
     */
    constructor(side, parent, opts) {
      this.side = side;
      this.opts = Object.assign({ skinColor: 0xf2c9a0, sleeveColor: 0x4a6a9a, furColor: 0xe0a878 }, opts);

      // Иерархия: root → предплечье → кисть → пальцы
      this.root = new THREE.Group();
      parent.add(this.root);

      // Целевая и текущая поза
      this.pose = 'rest';
      this.poseBlend = {};        // текущие углы (интерполируются)
      this.poseTarget = {};       // целевые углы
      this._initPoseState();

      // IK-состояние
      this.ikTarget = null;       // мировая точка, куда тянется кисть
      this.ikWeight = 0;          // 0 = поза покоя, 1 = полный IK

      // Анимационные параметры
      this.restPos = new THREE.Vector3(side * 0.26, -0.26, -0.44);
      this.restRot = new THREE.Euler(-0.22, side * -0.18, side * 0.12);
      this.currentPos = this.restPos.clone();
      this.currentRot = this.restRot.clone();
      this.recoil = 0;            // отдача после удара
      this.recoilVel = 0;
      this.breathPhase = Math.random() * 6.28;
      this.swayPhase = Math.random() * 6.28;
      this.gripStrength = 0;      // сила сжатия 0..1
      this.contactDepth = 0;      // насколько пальцы утопают в плоти
      this.heldObject = null;

      this._build();
    }

    _initPoseState() {
      for (let f = 0; f < 5; f++) {
        for (let p = 0; p < 3; p++) {
          const key = `c${f}_${p}`;
          this.poseBlend[key] = POSES.rest.curl[f][p];
          this.poseTarget[key] = POSES.rest.curl[f][p];
        }
        this.poseBlend[`s${f}`] = POSES.rest.spread[f];
        this.poseTarget[`s${f}`] = POSES.rest.spread[f];
      }
      this.poseBlend.wrist = POSES.rest.wrist[0];
      this.poseTarget.wrist = POSES.rest.wrist[0];
    }

    /* -------------------- Построение геометрии -------------------- */
    _build() {
      const skinMat = new THREE.MeshStandardMaterial({
        color: this.opts.skinColor, roughness: 0.78, metalness: 0.0 });
      const furMat = new THREE.MeshStandardMaterial({
        color: this.opts.furColor, roughness: 0.95 });
      const sleeveMat = new THREE.MeshStandardMaterial({
        color: this.opts.sleeveColor, roughness: 0.9 });
      const nailMat = new THREE.MeshStandardMaterial({
        color: 0x3a2a28, roughness: 0.35 });
      this.skinMat = skinMat;

      // --- Предплечье (видно у края экрана) ---
      this.forearm = new THREE.Group();
      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.052, 0.062, 0.20, 12), sleeveMat);
      sleeve.rotation.x = Math.PI / 2;
      sleeve.position.z = 0.14;
      this.forearm.add(sleeve);
      // Манжет
      const cuff = new THREE.Mesh(
        new THREE.TorusGeometry(0.053, 0.010, 6, 14), sleeveMat);
      cuff.rotation.y = Math.PI / 2;
      cuff.position.z = 0.045;
      this.forearm.add(cuff);
      this.root.add(this.forearm);

      // --- Кисть (запястье → ладонь) ---
      this.wrist = new THREE.Group();
      this.root.add(this.wrist);

      // Ладонь: слегка сплюснутая коробка со скруглением
      const palmGeo = new THREE.BoxGeometry(0.078, 0.030, 0.086);
      // Скругляем углы смещением вершин
      const pp = palmGeo.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
        pp.setX(i, x * (1 - Math.abs(z) * 1.6));
        pp.setZ(i, z * (1 - Math.abs(x) * 0.9));
      }
      palmGeo.computeVertexNormals();
      this.palm = new THREE.Mesh(palmGeo, skinMat);
      this.palm.position.z = -0.018;
      this.wrist.add(this.palm);

      // Подушечка большого пальца (тенар)
      const thenar = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), skinMat);
      thenar.scale.set(1, 0.6, 1.35);
      thenar.position.set(this.side * -0.026, -0.004, 0.006);
      this.wrist.add(thenar);

      // Мех на тыльной стороне (мы же в мире фурри)
      const backFur = new THREE.Mesh(new THREE.BoxGeometry(0.070, 0.008, 0.078), furMat);
      backFur.position.set(0, 0.018, -0.018);
      this.wrist.add(backFur);

      // --- Пальцы: 5 × 3 фаланги ---
      this.fingers = [];
      for (let f = 0; f < 5; f++) {
        const k = KNUCKLES[f];
        const chain = { joints: [], meshes: [] };

        // Корневой сустав (пястно-фаланговый)
        const j0 = new THREE.Group();
        j0.position.set(this.side * k.x, k.y, k.z);
        if (f === 0) {
          // Большой палец развёрнут — противопоставлен остальным
          j0.rotation.z = this.side * 0.95;
          j0.rotation.y = this.side * 0.42;
        }
        this.wrist.add(j0);
        chain.joints.push(j0);

        let parent = j0;
        for (let p = 0; p < 3; p++) {
          const len = PHALANX[f][p];
          const rad = FINGER_RADIUS[f] * (1 - p * 0.13);
          // Сама фаланга
          const seg = new THREE.Mesh(
            new THREE.CapsuleGeometry(rad, len * 0.72, 4, 8), skinMat);
          seg.rotation.x = Math.PI / 2;
          seg.position.z = -len / 2;
          parent.add(seg);
          chain.meshes.push(seg);

          if (p === 2) {
            // Коготок на кончике
            const claw = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.75, len * 0.5, 6), nailMat);
            claw.rotation.x = -Math.PI / 2;
            claw.position.z = -len * 0.85;
            parent.add(claw);
            chain.tip = parent;
          } else {
            // Следующий сустав
            const jn = new THREE.Group();
            jn.position.z = -len;
            parent.add(jn);
            chain.joints.push(jn);
            parent = jn;
          }
        }
        this.fingers.push(chain);
      }

      // Рендерим руки поверх мира, чтобы не резались о геометрию
      this.root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.renderOrder = 998;
          o.frustumCulled = false;
        }
      });

      this.root.position.copy(this.restPos);
      this.root.rotation.copy(this.restRot);
    }

    /* -------------------- Управление позой -------------------- */
    /**
     * Задать позу кисти.
     * @param {string} name — ключ из POSES
     * @param {number} strength — 0..1, насколько глубоко применять (для хвата)
     */
    setPose(name, strength) {
      const p = POSES[name];
      if (!p) return;
      this.pose = name;
      const s = strength != null ? strength : 1;
      for (let f = 0; f < 5; f++) {
        for (let ph = 0; ph < 3; ph++) {
          const rest = POSES.rest.curl[f][ph];
          this.poseTarget[`c${f}_${ph}`] = U.lerp(rest, p.curl[f][ph], s);
        }
        this.poseTarget[`s${f}`] = U.lerp(POSES.rest.spread[f], p.spread[f], s);
      }
      this.poseTarget.wrist = U.lerp(POSES.rest.wrist[0], p.wrist[0], s);
    }

    /** Согнуть один палец отдельно (для деформации при контакте) */
    bendFinger(index, amount) {
      for (let p = 0; p < 3; p++) {
        const key = `c${index}_${p}`;
        this.poseTarget[key] = U.clamp(this.poseTarget[key] + amount * (0.6 + p * 0.2), 0, 1);
      }
    }

    /** Импульс отдачи (удар, шлепок) */
    kick(force) {
      this.recoilVel += force;
    }

    /** Тянуть кисть к мировой точке (IK) */
    reachTo(worldPoint, weight) {
      this.ikTarget = worldPoint;
      this.ikWeightTarget = weight != null ? weight : 1;
    }
    releaseReach() { this.ikWeightTarget = 0; }

    /* -------------------- Обновление -------------------- */
    /**
     * @param {number} dt
     * @param {object} ctx — контекст: {camera, walkPhase, speed, crouch, contact}
     */
    update(dt, ctx) {
      // --- Интерполяция позы ---
      const blendSpeed = this.pose === 'grip' ? 22 : 15;
      for (const key in this.poseTarget) {
        this.poseBlend[key] = U.damp(this.poseBlend[key], this.poseTarget[key], blendSpeed, dt);
      }

      // --- Применение углов к суставам ---
      for (let f = 0; f < 5; f++) {
        const chain = this.fingers[f];
        const spread = this.poseBlend[`s${f}`];
        for (let p = 0; p < 3; p++) {
          const joint = chain.joints[p];
          if (!joint) continue;
          const curl = this.poseBlend[`c${f}_${p}`];
          // Сгиб вокруг X, максимум ~100° на сустав
          const maxBend = p === 0 ? 1.45 : p === 1 ? 1.65 : 1.35;
          if (f === 0) {
            // Большой палец сгибается в другой плоскости
            joint.rotation.x = curl * maxBend * 0.75;
            if (p === 0) joint.rotation.z = this.side * (0.95 - spread * 0.5);
          } else {
            joint.rotation.x = curl * maxBend;
            // Разведение только в корневом суставе
            if (p === 0) joint.rotation.y = this.side * spread * 0.5;
          }
        }
      }
      // Запястье
      this.wrist.rotation.x = this.poseBlend.wrist;

      // --- Отдача ---
      this.recoilVel += -this.recoil * 90 * dt;
      this.recoilVel *= Math.exp(-11 * dt);
      this.recoil += this.recoilVel * dt;
      this.recoil = U.clamp(this.recoil, -0.14, 0.14);

      // --- Позиция кисти: IK или поза покоя ---
      this.ikWeight = U.damp(this.ikWeight, this.ikWeightTarget || 0, 14, dt);

      if (this.ikWeight > 0.01 && this.ikTarget && ctx.camera) {
        // Переводим цель в пространство камеры
        const localTarget = ctx.camera.worldToLocal(this.ikTarget.clone());
        // Ограничиваем досягаемость (длина руки)
        const maxReach = 0.85;
        if (localTarget.length() > maxReach) localTarget.setLength(maxReach);
        // Плечо смещено вбок — рука тянется по дуге, а не по прямой
        const shoulder = new THREE.Vector3(this.side * 0.22, -0.16, 0.06);
        const toTarget = localTarget.clone().sub(shoulder);
        const dist = toTarget.length();

        // Двухзвенный IK: определяем изгиб локтя по закону косинусов
        const upperLen = 0.34, foreLen = 0.32;
        const clamped = Math.min(dist, (upperLen + foreLen) * 0.98);
        const cosElbow = U.clamp(
          (upperLen * upperLen + foreLen * foreLen - clamped * clamped) / (2 * upperLen * foreLen), -1, 1);
        this.elbowAngle = Math.acos(cosElbow);

        const blended = this.currentPos.clone().lerp(localTarget, this.ikWeight);
        this.currentPos.lerp(blended, 1 - Math.exp(-24 * dt));

        // Кисть смотрит на цель
        const lookDir = toTarget.normalize();
        const targetRot = new THREE.Euler(
          Math.asin(U.clamp(-lookDir.y, -1, 1)) * 0.7,
          Math.atan2(lookDir.x, -lookDir.z) * 0.55,
          this.side * 0.12 * (1 - this.ikWeight)
        );
        this.currentRot.x = U.damp(this.currentRot.x, targetRot.x, 16, dt);
        this.currentRot.y = U.damp(this.currentRot.y, targetRot.y, 16, dt);
        this.currentRot.z = U.damp(this.currentRot.z, targetRot.z, 16, dt);
      } else {
        // --- Поза покоя с процедурной анимацией ---
        this.breathPhase += dt * 0.85;
        this.swayPhase += dt * (1.2 + (ctx.speed || 0) * 0.5);

        const breath = Math.sin(this.breathPhase) * 0.006;
        const walkBob = Math.sin((ctx.walkPhase || 0) * 2) * 0.014 * Math.min(1, (ctx.speed || 0) / 3);
        const walkSway = Math.cos(ctx.walkPhase || 0) * 0.018 * Math.min(1, (ctx.speed || 0) / 3);
        const idleSway = Math.sin(this.swayPhase * 0.7) * 0.005;

        const target = this.restPos.clone();
        target.y += breath + walkBob - (ctx.crouch ? 0.05 : 0);
        target.x += walkSway * this.side + idleSway;
        target.z += this.recoil * 0.9 + Math.sin(this.swayPhase * 0.5) * 0.004;

        this.currentPos.lerp(target, 1 - Math.exp(-13 * dt));
        this.currentRot.x = U.damp(this.currentRot.x, this.restRot.x - this.recoil * 1.8 + walkBob * 2, 11, dt);
        this.currentRot.y = U.damp(this.currentRot.y, this.restRot.y + idleSway * 2, 11, dt);
        this.currentRot.z = U.damp(this.currentRot.z, this.restRot.z + walkSway * this.side, 11, dt);
      }

      this.root.position.copy(this.currentPos);
      this.root.rotation.copy(this.currentRot);

      // --- Предплечье доворачивается к плечу (иллюзия соединения с телом) ---
      const shoulderDir = new THREE.Vector3(this.side * 0.24, -0.30, 0.30).sub(this.currentPos);
      this.forearm.rotation.y = Math.atan2(shoulderDir.x, shoulderDir.z) * 0.35;
      this.forearm.rotation.x = Math.atan2(-shoulderDir.y, shoulderDir.length()) * 0.30;

      // --- Деформация пальцев при контакте с плотью ---
      if (this.contactDepth > 0.01) {
        // Пальцы «утопают»: слегка расходятся и подгибаются
        for (let f = 1; f < 5; f++) {
          const extra = this.contactDepth * (0.10 + f * 0.02);
          this.poseTarget[`c${f}_1`] = U.clamp(this.poseTarget[`c${f}_1`] + extra, 0, 1);
        }
        this.contactDepth = Math.max(0, this.contactDepth - dt * 2.2);
      }
    }

    /** Кисть держит предмет — привязываем его к ладони */
    holdObject(mesh) {
      if (this.heldObject) this.dropObject();
      this.heldObject = mesh;
      this.wrist.add(mesh);
      mesh.position.set(0, 0.03, -0.055);
      mesh.scale.setScalar(0.55);
      this.setPose('hold');
    }
    dropObject() {
      if (!this.heldObject) return null;
      const m = this.heldObject;
      this.wrist.remove(m);
      this.heldObject = null;
      this.setPose('rest');
      return m;
    }

    /** Мировая позиция кончика указательного пальца */
    fingertipWorld(out) {
      const tip = this.fingers[1].tip;
      return tip.getWorldPosition(out || new THREE.Vector3());
    }
    /** Мировая позиция центра ладони */
    palmWorld(out) {
      return this.palm.getWorldPosition(out || new THREE.Vector3());
    }

    setSkinColor(color) {
      this.skinMat.color.setHex(color);
    }
    dispose() {
      this.root.parent && this.root.parent.remove(this.root);
    }
  }

  /* ============================================================
   * МЕНЕДЖЕР ОБЕИХ РУК
   * ============================================================ */
  class HandsSystem {
    constructor(camera, player) {
      this.camera = camera;
      this.player = player;
      this.left = new AnimatedHand(-1, camera, {});
      this.right = new AnimatedHand(1, camera, {});
      this.hands = [this.left, this.right];
      this.walkPhase = 0;
    }

    /** Синхронизация цвета рук с видом фурри-игрока */
    matchSpecies(speciesKey) {
      const sp = FF.SPECIES[speciesKey];
      if (!sp) return;
      for (const h of this.hands) {
        h.setSkinColor(sp.belly);
        h.opts.furColor = sp.fur;
      }
    }

    update(dt, state) {
      const speed = Math.hypot(state.vel.x, state.vel.z);
      this.walkPhase += dt * (4 + speed * 1.4);

      const ctx = {
        camera: this.camera,
        walkPhase: this.walkPhase,
        speed,
        crouch: state.crouch,
      };

      for (const h of this.hands) h.update(dt, ctx);
    }

    /** Обе руки в позу */
    bothPose(name) {
      this.left.setPose(name);
      this.right.setPose(name);
    }

    get(side) { return side < 0 ? this.left : this.right; }
  }

  FF.HAND_POSES = POSES;
  FF.AnimatedHand = AnimatedHand;
  FF.HandsSystem = HandsSystem;
})(typeof window !== 'undefined' ? window : globalThis);
