/**
 * player.js — PlayerController
 * Вид от первого лица, движение, коллизии с миром и телом фурри,
 * система рук (хват/тычок/массаж), карабканье в стиле PEAK,
 * стамина, режимы «под животом» и «на животе», батут-эффект.
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  // Переиспользуемые векторы: карабканье считается каждый кадр
  const _tmpDown = new THREE.Vector3();
  const _tmpPull = new THREE.Vector3();

  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  class PlayerController {
    constructor(camera, world, furry, audio) {
      this.camera = camera;
      this.world = world;
      this.furry = furry;
      this.audio = audio;
      const C = FF.CONFIG.player;

      this.pos = new THREE.Vector3(-58, 0, 82);
      this.vel = new THREE.Vector3();
      this.yaw = Math.PI;
      this.pitch = 0;
      this.onGround = false;
      this.crouch = false;
      this.stamina = C.maxStamina;
      this.height = C.height;

      this.keys = {};
      this.mouse = { left: false, right: false, dx: 0, dy: 0 };

      // Руки: каждая может быть свободна / держаться за узел
      this.hands = [
        { side: -1, grip: null, reaching: null, mesh: null, target: new THREE.Vector3(), rest: new THREE.Vector3(-0.28, -0.22, -0.55) },
        { side: 1, grip: null, reaching: null, mesh: null, target: new THREE.Vector3(), rest: new THREE.Vector3(0.28, -0.22, -0.55) },
      ];
      this.climbing = false;
      this.mode = 'walk';      // walk | climb | underbelly | onbelly | ride | sit
      this.underBellySpot = null;
      this.headBob = 0;
      this.stepDist = 0;
      this.lookTarget = null;
      this.contact = null;            // текущий контакт с телом
      this.sinkDepth = 0;             // насколько утонул в жире
      this.zoneFriction = 1;          // трение текущей зоны
      this.standingZone = null;       // зона, на которой стоим
      this.lastTouchedZone = null;
      this.bodyGroundY = null;
      this.bodyGroundZone = null;
      this.frozen = false;     // на время меню/мини-игр

      /* --- АНТИ-БАГ ЗАСТРЕВАНИЯ ---
       * stuckTimer   — сколько секунд игрок топчется, будучи внутри тела;
       * phantom      — режим призрака: плоть перестаёт выталкивать вовсе;
       * lastFreePos  — последняя точка СНАРУЖИ тела, куда безопасно вернуть. */
      this.stuckTimer = 0;
      this.phantom = 0;
      this.lastFreePos = new THREE.Vector3();
      this._escapeCooldown = 0;

      // АНИМИРОВАННЫЕ РУКИ: 15 суставов на кисть, IK, позы
      this.handsSystem = new FF.HandsSystem(camera, this);
      this.hands[0].anim = this.handsSystem.left;
      this.hands[1].anim = this.handsSystem.right;
      this._raycaster = new THREE.Raycaster();
    }

    /* ==================== РУКИ ==================== */
    /* ==================== ВВОД ==================== */
    onKey(code, down) {
      this.keys[code] = down;
    }
    onMouseMove(dx, dy) {
      if (this.frozen) return;
      const sens = 0.0022;
      this.yaw -= dx * sens;
      this.pitch = U.clamp(this.pitch - dy * sens, -1.45, 1.45);
    }
    onMouseDown(button) {
      if (this.frozen) return;
      const hand = button === 0 ? this.hands[0] : this.hands[1];
      if (button === 0) this.mouse.left = true;
      if (button === 2) this.mouse.right = true;
      this._tryGrabOrPoke(hand);
    }
    onMouseUp(button) {
      const hand = button === 0 ? this.hands[0] : this.hands[1];
      if (button === 0) this.mouse.left = false;
      if (button === 2) this.mouse.right = false;
      // Отпускаем и захват, и незавершённый замах
      if (hand.reaching) { hand.reaching = null; hand.anim.releaseReach(); hand.anim.setPose('rest'); }
      if (hand.grip) {
        // Пальцы разжимаются, жир возвращается с «плюхом»
        const nd = hand.grip.node;
        if (nd) { nd.impulse(_tmpDown.set(0, -1, 0), 5); nd.contactPress = 0; }
        // Ямка расправляется медленно, как густой мёд (см. _updateHandPresses)
        this.furry.clearHandPress && this.furry.clearHandPress('hand' + hand.side);
        this.audio && this.audio.squish();
        hand.grip = null;
        hand.anim.setPose('rest');
        this._checkClimbState();
      }
    }

    /**
     * Отпустить хват одной руки.
     *
     * Единая точка выхода: рука может разжаться четырьмя путями (кнопка,
     * соскальзывание, кончилась стамина, смена режима). Раньше каждый
     * обнулял grip по-своему, и вмятина от пальцев оставалась на теле
     * навсегда. Теперь любой путь идёт через этот метод.
     */
    _releaseGrip(h) {
      if (!h.grip) return;
      h.grip = null;
      this.furry.clearHandPress && this.furry.clearHandPress('hand' + h.side);
    }

    /** Отпустить обе руки (падение, смена режима, телепорт) */
    _releaseAllGrips() {
      for (const h of this.hands) this._releaseGrip(h);
    }

    /** Попытка схватиться за тело / тычок */
    _tryGrabOrPoke(hand) {
      const origin = this.camera.getWorldPosition(new THREE.Vector3());
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      const reach = FF.CONFIG.player.reach * (0.8 + this.furry.bodyScale * 0.35);
      const hit = origin.clone().addScaledVector(dir, reach * 0.6);

      /* РЕЙКАСТ ПО САМОМУ МЕШУ.
       *
       * Никаких «зон захвата»: луч из камеры пересекает треугольники тела,
       * и точкой хвата становится ровно место пересечения — любой миллиметр
       * поверхности. Свойства (мягкость, глубина погружения, скользкость)
       * считаются динамически смешиванием весов трёх вершин грани, а не
       * берутся из предопределённой зоны. */
      let best = null, bestD = Infinity;
      const mh = this.furry.physics && this.furry.physics.raycastMesh(origin, dir, reach);
      if (mh) {
        const surf = this.furry.physics.surfaceAt(mh.tri, mh.bary);
        const nd = surf.node;
        const foldBonus = nd.zone.folds.filter((t) => this.furry.calories >= t).length * 0.14;
        const familiar = (nd.familiarity || 0) * 0.15;
        // Плоская грань (нормаль почти горизонтальна) держит хуже, чем
        // выступ или складка, куда пальцы реально заходят.
        const grip = 0.35 + surf.soft * 0.5;
        const q = surf.growth * grip + foldBonus + familiar - this.furry.wet * 0.35;
        best = {
          node: nd, pos: mh.point, normal: mh.normal,
          tri: mh.tri, bary: mh.bary, surf,
          quality: U.clamp(q, 0.08, 1),
        };
        bestD = mh.distance;
      } else {
        // Луч мимо меша — пробуем ближайшие точки (страховка на случай,
        // если игрок целится в самый край силуэта)
        const points = this.furry.grabPoints();
        for (const p of points) {
          const d = p.pos.distanceTo(hit);
          if (d < reach && d < bestD) { bestD = d; best = p; }
        }
      }

      if (best && bestD < reach) {
        if (this.keys.ShiftLeft || this.mode === 'climb' || !this.onGround || best.pos.y > this.pos.y + 0.5) {
          /* ЗАМАХ, А НЕ ТЕЛЕПОРТ.
           *
           * Раньше кисть мгновенно оказывалась в точке хвата — движение не
           * читалось, и лазание ощущалось как «клик по кнопке». Теперь рука
           * получает цель и ЛЕТИТ к ней ~0.3 с (см. _updateReaching):
           * плечо разворачивается, ладонь раскрывается, пальцы касаются
           * плоти и только затем смыкаются. Захват фиксируется в конце. */
          hand.reaching = {
            node: best.node,
            // Точку помним в системе тела: друг дышит и колышется,
            // цель должна ехать вместе с плотью, а не висеть в воздухе.
            local: this.furry.root.worldToLocal(best.pos.clone()),
            quality: best.quality,
            t: 0,
            dur: 0.30 + Math.min(0.2, bestD / reach * 0.2),   // дальше — дольше
            dir: dir.clone(),
            // Нормаль поверхности в точке хвата: по ней рука утопает строго
            // внутрь плоти, а не «к центру тела»
            normal: best.normal ? best.normal.clone() : null,
          };
          hand.anim.setPose('palm', 1);      // ладонь раскрывается в полёте
          this._checkClimbState();
          return;
        }
        // ТЫЧОК / МАССАЖ
        this.furry.poke(hit, dir, 1);
        hand.anim.kick(0.9);
        hand.anim.setPose('point');
        hand.anim.contactDepth = 0.7;
        return;
      }
      // Не попали по фурри — обычное взаимодействие
      FF.Game && FF.Game.tryWorldInteract(hit);
    }

    _checkClimbState() {
      const gripping = this.hands.some((h) => h.grip);
      if (gripping && !this.climbing) {
        this.climbing = true;
        this.mode = 'climb';
        this.vel.set(0, 0, 0);
      } else if (!gripping && this.climbing) {
        this.climbing = false;
        this.mode = 'walk';
      }
      // Пока лезем или ползём по телу, плоть расступается охотнее:
      // это читает physics.resolvePlayer и разрешает «зарыться» в друга.
      this.furry.playerBurrowing = gripping || this.mode === 'onbelly'
        || this.mode === 'underbelly' || this.crawling;
    }

    /* ==================== ОБНОВЛЕНИЕ ==================== */
    update(dt) {
      if (this.frozen) { this._updateCamera(dt); return; }
      const C = FF.CONFIG.player;

      if (this.mode === 'ride') { this._updateCamera(dt); return; }
      if (this.climbing) this._updateClimb(dt);
      else this._updateWalk(dt);

      // Продолжительное воздействие ЛКМ/ПКМ (массаж) когда не карабкаемся
      if (!this.climbing && (this.mouse.left || this.mouse.right)) {
        const origin = this.camera.getWorldPosition(new THREE.Vector3());
        const dir = this.camera.getWorldDirection(new THREE.Vector3());
        const hit = origin.clone().addScaledVector(dir, C.reach * 0.55);
        if (this.furry.zoneAt(hit, 0.9)) this.furry.massage(hit, dir, dt);
      }

      this._updateReaching(dt);
      this._updateHands(dt);
      this._updateCamera(dt);
      this._updateModes(dt);
      this._updateStuckGuard(dt);
    }

    /* -------------------- Ходьба -------------------- */
    _updateWalk(dt) {
      const C = FF.CONFIG.player;
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const wish = new THREE.Vector3();
      if (this.keys.KeyW) wish.add(fwd);
      if (this.keys.KeyS) wish.sub(fwd);
      if (this.keys.KeyD) wish.add(right);
      if (this.keys.KeyA) wish.sub(right);

      this.crouch = !!this.keys.ControlLeft;
      /* Ползание (C): ниже приседа, пускает под живот друга и под мебель.
       * Под животом включается принудительно — там иначе не пролезть. */
      /* X — двойного назначения: внутри тела это экстренный выход,
       * в остальных случаях обычное ползание на четвереньках. */
      if (this.keys.KeyX && this._isInsideBody() && this._escapeCooldown <= 0) {
        this.escapeFromBody(false);
        this.keys.KeyX = false;
      }
      this.crawling = !!this.keys.KeyX || (this.mode === 'underbelly' && this.crouch);
      const running = this.keys.ShiftLeft && !this.crouch && this.stamina > 1;
      let speed = this.crawling ? C.walkSpeed * 0.28
        : this.crouch ? C.walkSpeed * 0.45 : running ? C.runSpeed : C.walkSpeed;
      if (this.mode === 'onbelly') speed *= 0.55;   // по колышущемуся животу идти сложно
      if (this.mode === 'underbelly') speed *= 0.6;
      // Погружение в мягкую плоть замедляет: чем глубже утонул, тем труднее идти
      speed *= (1 - U.clamp(this.sinkDepth, 0, 0.75) * 0.62) / (this.zoneFriction || 1);
      // Одежда липнет к шерсти: ползти по телу заметно тяжелее
      if (this.skinDrag) speed /= this.skinDrag;
      // Придавлен животом — почти не двигаешься
      if (this.furry.playerTrapped > 0.1) speed *= 1 - this.furry.playerTrapped * 0.8;

      if (wish.lengthSq() > 0) {
        wish.normalize();
        const accel = this.onGround ? 46 : 12;
        this.vel.x = U.damp(this.vel.x, wish.x * speed, accel * 0.1, dt);
        this.vel.z = U.damp(this.vel.z, wish.z * speed, accel * 0.1, dt);
        if (running) this.stamina = Math.max(0, this.stamina - dt * 6);
      } else {
        const fr = this.onGround ? 12 : 1.2;
        this.vel.x = U.damp(this.vel.x, 0, fr, dt);
        this.vel.z = U.damp(this.vel.z, 0, fr, dt);
      }

      /* Под животом Space — не прыжок, а «вылезти»: иначе игрок бьётся
       * головой в тушу и не может выбраться самостоятельно. */
      if (this.keys.Space && this.mode === 'underbelly' && this._escapeCooldown <= 0) {
        this.escapeFromBody(false);
        this.keys.Space = false;
      }

      // Прыжок
      if (this.keys.Space && this.onGround) {
        /* Батут на животе отключён по просьбе игрока: стоя на друге,
         * Space делает обычный небольшой прыжок, а не подбрасывает
         * на всю высоту упругой плоти. Саму механику bounce() не
         * трогаем — она нужна для действия «Попрыгать» в меню (E),
         * где игрок сознательно выбирает батут. */
        if (this.mode === 'onbelly' && FF.CONFIG.player.bellyTrampoline) {
          const power = this.furry.bounce(this.pos.clone().add(new THREE.Vector3(0, -0.5, 0)), 1);
          this.vel.y = power;
          FF.Game && FF.Game.achieve('bounce', this.furry.stats.bounces >= 50);
        } else {
          this.vel.y = FF.CONFIG.player.jumpVelocity;
        }
        this.onGround = false;
        this.keys.Space = false;
      }

      this.vel.y += C.gravity * dt;
      const next = this.pos.clone().addScaledVector(this.vel, dt);

      // Коллизии с миром
      this._resolveWorldCollision(next);
      // Коллизия с телом фурри (можно «утопать» в мягком)
      this._resolveFurryCollision(next, dt);

      // Земля
      const groundY = this._groundHeight(next.x, next.z);
      if (next.y <= groundY) {
        if (!this.onGround && this.vel.y < -6) this.audio && this.audio.step(this.mode === 'onbelly');
        next.y = groundY;
        this.vel.y = 0;
        this.onGround = true;
      } else this.onGround = false;

      this.pos.copy(next);

      // Стамина восстанавливается
      if (this.onGround && !this.keys.ShiftLeft) {
        /* «Тёплый сон» после кокона: +20% к восстановлению на 10 минут */
        let regen = C.staminaRegen;
        if (this.warmSleepTimer > 0) {
          this.warmSleepTimer -= dt;
          regen *= 1.2;
        }
        this.stamina = Math.min(C.maxStamina, this.stamina + dt * regen);
      }

      /* --- ВЕС ИГРОКА ПРОДАВЛИВАЕТ ПЛОТЬ ---
       * Стоим на друге — под ногами постоянная вмятина, а не просто опора.
       * Ползём — вминаются ещё и колени: пятно контакта шире и глубже. */
      if (this.onGround && this.standingZone && this.standingZone.node) {
        const nd = this.standingZone.node;
        const wide = this.crawling ? 1.7 : 1;      // на четвереньках давим шире
        nd.press(_tmpDown.set(0, -1, 0), 0.5 * wide * dt * 6);
        nd.contactPress = Math.min(1, nd.contactPress + dt * 2.2 * wide);
      }

      // Шаги
      const horiz = Math.hypot(this.vel.x, this.vel.z);
      if (this.onGround && horiz > 0.4) {
        this.stepDist += horiz * dt;
        const stride = running ? 1.9 : 1.35;
        if (this.stepDist > stride) {
          this.stepDist = 0;
          this.audio && this.audio.step(this.mode === 'onbelly' || this.mode === 'underbelly');
          if (this.mode === 'onbelly') this.furry.wave(this.pos.clone(), 0.5);
          // Каждый шаг по телу — отдельный толчок в плоть под ногой
          if (this.standingZone && this.standingZone.node) {
            this.standingZone.node.impulse(_tmpDown.set(0, -1, 0), 3.5 + horiz * 2);
          }
        }
        this.headBob += dt * (running ? 13 : 8.5);
      }
    }

    /* -------------------- Карабканье -------------------- */
    _updateClimb(dt) {
      const C = FF.CONFIG.player;
      const grips = this.hands.filter((h) => h.grip);
      if (!grips.length) { this.climbing = false; this.mode = 'walk'; return; }

      /* Средняя точка захвата в мировых координатах.
       *
       * ВАЖНО: тело подтягиваем к точке ВХОДА в кожу (grip.surface), а не
       * к утопленной кисти (grip.offset). Кисть законно сидит на 45 см
       * внутри жира — но если тянуть туловище туда же, игрок медленно
       * въезжает внутрь друга: замер показывал −20 см под кожей во время
       * лазания и до −1.4 м после отпускания, с ложным «под животом».
       * Рука в жире, тело снаружи. */
      const anchor = new THREE.Vector3();
      for (const h of grips) {
        const local = h.grip.surface || h.grip.offset;
        const wp = this.furry.root.localToWorld(local.clone());
        anchor.add(wp);
      }
      anchor.divideScalar(grips.length);

      // Пружина: тело игрока подтягивается к точке под руками
      const target = anchor.clone().add(new THREE.Vector3(0, -1.05, 0));
      const toTarget = target.clone().sub(this.pos);
      const boost = this.keys.Space ? 2.2 : 1;   // подтягивание
      this.vel.addScaledVector(toTarget, 30 * dt * boost);
      this.vel.multiplyScalar(Math.exp(-7 * dt));

      // Перехват направлением (WASD смещает точку цели)
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const wish = new THREE.Vector3();
      if (this.keys.KeyW) wish.add(new THREE.Vector3(0, 1, 0)).addScaledVector(fwd, 0.35);
      if (this.keys.KeyS) wish.add(new THREE.Vector3(0, -1, 0));
      if (this.keys.KeyD) wish.add(right);
      if (this.keys.KeyA) wish.sub(right);
      if (wish.lengthSq() > 0) this.vel.addScaledVector(wish.normalize(), C.climbSpeed * 2.4 * dt * 6);

      this.pos.addScaledVector(this.vel, dt);
      // Страховка: туловище не должно въезжать в плоть глубже допустимого
      this._keepBodyOutOfFlesh(dt);

      // Расход стамины
      const hard = this.keys.ShiftLeft;
      const drain = (hard ? C.staminaGripDrain : C.staminaHangDrain) * grips.length * 0.7;
      this.stamina -= drain * dt;

      // Скольжение: мокрая кожа, мягкая зона, усталость
      for (const h of grips) {
        const g = h.grip;
        const slipRate = (1 - g.quality) * 0.5 + this.furry.wet * 0.9 + (this.stamina < 25 ? 0.6 : 0)
          + (hard ? -0.3 : 0.1);
        g.slip += Math.max(0, slipRate) * dt;
        if (g.slip > 1.2) {
          this._releaseGrip(h);
          this.audio && this.audio.squish();
          FF.Game && FF.Game.notify('🖐 Рука соскользнула!', 'warn');
        }
      }
      if (this.stamina <= 0) {
        this._releaseAllGrips();
        FF.Game && FF.Game.notify('😵 Силы кончились — падение!', 'warn');
        this.audio && this.audio.voice('giggle', this.furry.opts.species);
      }
      this._checkClimbState();

      // Достижение: вершина
      if (this.pos.y > this.furry.topY() - 0.4) FF.Game && FF.Game.achieve('climber');

      /* --- СКЛАДКА НАТЯГИВАЕТСЯ ЗА РУКОЙ ---
       * Пока висим, жир под кистью не просто дрожит: он тянется в сторону
       * руки. Чем дальше игрок отвёл кисть от исходной точки хвата, тем
       * сильнее натяжение — и тем глубже вминается плоть под пальцами. */
      for (const h of grips) {
        const g = h.grip;
        const nd = g.node;
        nd.impulse(_tmpDown.set(0, -1, 0), 2.4 * dt * 60 * 0.02);

        /* --- ЯКОРЬ ЖИВЁТ НА КОЖЕ, А НЕ В ЗАСТЫВШЕЙ ТОЧКЕ ---
         *
         * Точка хвата хранится в координатах тела, но плоть под рукой
         * непрерывно мнётся: вмятина от пальцев уводит поверхность
         * вглубь, и через полсекунды сохранённый якорь оказывался уже
         * СНАРУЖИ отошедшей кожи (замер: 281 кадр из 600 «рука пробила
         * деталь насквозь»). Визуально это и выглядит как «руку засосало
         * сквозь меш».
         *
         * Поэтому каждый кадр переставляем точку входа обратно на
         * поверхность, а кисть — на разрешённую глубину под ней. */
        if (g.surface && this.furry.physics && this.furry.physics.skinProbe) {
          const s = g.surface;
          const pr = this.furry.physics.skinProbe(s.x, s.y, s.z, 3.0);
          if (pr) {
            // Возвращаем точку входа ровно на кожу
            s.set(pr.px, pr.py, pr.pz);
            // Наружная нормаль → направление вглубь
            g.dir.set(-pr.nx, -pr.ny, -pr.nz);
            const allowed = this._clampSinkToFlesh(s, g.dir, g.depth);
            g.offset.copy(s).addScaledVector(g.dir, allowed);
          }
        }

        if (g.surface) {
          // Насколько кисть увела складку от её покоя
          const handLocal = this.furry.root.worldToLocal(
            this.furry.root.localToWorld(g.offset.clone()));
          const pull = _tmpPull.copy(handLocal).sub(g.surface);
          const dist = pull.length();
          if (dist > 0.001) {
            // Тянем узел зоны вслед за рукой: складка вытягивается
            const k = Math.min(1, dist * 2.2) * (0.4 + nd.soft * 0.6);
            nd.impulse(pull.normalize(), k * 9 * dt * 60 * 0.016);
          }
          // Пальцы продолжают вминать плоть, пока держат
          nd.press(_tmpDown.set(0, -0.3, -1).normalize(), g.depth * 1.4 * dt * 6);
          nd.contactPress = Math.min(1, nd.contactPress + dt * 2.5);
        }

        /* --- ЖИР ВЫТЯГИВАЕТСЯ ВНИЗ ПОД ВЕСОМ ---
         * Пока игрок висит, ямка под кистью не стоит на месте: она едет
         * вслед за рукой и вытягивается книзу — складку оттягивает масса
         * тела. Обновляем прижим каждый кадр. */
        if (g.dir && g.surface && this.furry.setHandPress) {
          const hang = this.climbing && !this.onGround ? 1 : 0.45;
          // Ямка глубже, когда на руке весь вес игрока
          const depth = g.depth * (0.85 + hang * 0.45);
          /* Центр — точка ВХОДА в кожу (g.surface), сползающая вниз:
           * складку оттягивает вес висящего игрока. */
          const sag = _tmpDown.set(0, -g.depth * 0.55 * hang, 0);
          const pt = g.surface.clone().add(sag);
          const holeR = (0.18 + g.depthMeters * 0.85) / this.furry.bodyScale;
          this.furry.setHandPress('hand' + h.side, pt, g.dir, depth, holeR);
        }
      }
    }

    /* -------------------- Коллизии -------------------- */
    /**
     * Высота опоры: земля ИЛИ любая зона тела фурри (живот, ягодицы,
     * «полка» над попой, плечи, грудь — стоять можно везде).
     */
    _groundHeight(x, z) {
      let y = this.world.heightAt(x, z);

      // Полы этажей, ступени и балкон коттеджа — стоять можно и на них.
      // Берём платформу не выше пояса: так лестница «подхватывает» шаг за шагом,
      // а под перекрытием второго этажа можно спокойно ходить.
      // Порог 0.62 м — чуть выше ступени (0.4 м): на лестницу шагаем плавно,
      // но запрыгнуть с пола сразу на второй этаж нельзя.
      if (this.world.platformAt) {
        const p = this.world.platformAt(x, z, this.pos.y + 0.62);
        if (p !== null && p > y) y = p;
      }

      const f = this.furry;
      if (!f.physics) return y;

      // Ищем поверхность тела под игроком, но не выше его головы
      const surf = f.physics.surfaceHeightAt(x, z, this.pos.y + this.height * 0.6);
      if (surf && surf.y > y && this.pos.y > surf.y - 1.4) {
        y = surf.y;
        this.standingZone = surf.zone;
      } else if (this.standingZone && !surf) {
        this.standingZone = null;
      }
      return y;
    }

    _resolveWorldCollision(next) {
      const r = FF.CONFIG.player.radius;
      for (const c of this.world.colliders) {
        if (c.type === 'box') {
          const hw = c.w / 2 + r, hd = c.d / 2 + r;
          const dx = next.x - c.x, dz = next.z - c.z;
          if (Math.abs(dx) < hw && Math.abs(dz) < hd && next.y < c.h) {
            // выталкиваем по меньшей оси
            const px = hw - Math.abs(dx), pz = hd - Math.abs(dz);
            if (px < pz) { next.x = c.x + Math.sign(dx || 1) * hw; this.vel.x = 0; }
            else { next.z = c.z + Math.sign(dz || 1) * hd; this.vel.z = 0; }
          }
        } else if (c.type === 'cyl') {
          const dx = next.x - c.x, dz = next.z - c.z;
          const d = Math.hypot(dx, dz);
          const rr = c.r + r;
          if (d < rr && next.y < c.h) {
            if (c.hollow) {
              // Здание-цилиндр с дверным проёмом: пускаем внутрь через юг
              const ang = Math.atan2(dx, dz);
              if (Math.abs(ang) < 0.35 && d > c.r - 1.4) continue;
            }
            const nx = dx / (d || 1), nz = dz / (d || 1);
            next.x = c.x + nx * rr; next.z = c.z + nz * rr;
            this.vel.x = 0; this.vel.z = 0;
          }
        }
      }
    }

    /**
     * ГИПЕР-ФИЗИКА: коллизия игрока со всеми 60 зонами тела.
     * Каждая зона — отдельный эллипсоид со своей мягкостью, трением и упругостью.
     */
    _resolveFurryCollision(next, dt) {
      const f = this.furry;
      if (!f.physics) return;
      const C = FF.CONFIG.player;

      // Присев у большого живота — пролезаем под него (коллизия нижних зон отключается)
      const bellyG = f.nodeById.mid_belly.growth;
      if (this.crouch && bellyG > 0.45) {
        const localY = (next.y - f.root.position.y) / f.bodyScale;
        if (localY < 0.85 * f.species.scale) { this.contact = null; return; }
      }

      const res = f.physics.resolvePlayer(next, this.vel, C.radius, this.height, dt);
      this.contact = res.hit ? res : null;

      if (res.hit) {
        // Погружение в жир: чем глубже утонул, тем медленнее двигаешься
        this.sinkDepth = U.damp(this.sinkDepth || 0, res.sink, 10, dt);
        this.zoneFriction = res.friction;
        // Звук проминания плоти при движении по телу
        const speed = Math.hypot(this.vel.x, this.vel.z);
        if (speed > 1.2 && Math.random() < dt * speed * 0.8) this.audio && this.audio.squish();
        if (res.zone) this.lastTouchedZone = res.zone.node;
      } else {
        this.sinkDepth = U.damp(this.sinkDepth || 0, 0, 8, dt);
        this.zoneFriction = 1;
      }
      // Опора на любой зоне тела (не только на животе!)
      this.bodyGroundY = res.groundY > -Infinity ? res.groundY : null;
      this.bodyGroundZone = res.groundZone;
    }

    /**
     * Строгая проверка режима «под животом».
     *
     * Раньше хватало «игрок в радиусе и низко» — и, подойдя к ноге гиганта,
     * он получал режим без всякого живота над головой. Теперь требуются
     * ВСЕ условия сразу, как в ТЗ:
     *
     *   1. игрок не внутри меша (иначе это баг проваливания);
     *   2. он в проекции живота на землю;
     *   3. он ниже нижней кромки нависающей плоти;
     *   4. он у земли, а не парит;
     *   5. луч вверх реально упирается в зону живота.
     */
    _hasBellyOverhead() {
      const f = this.furry;
      if (!f.physics || !f.physics.colliders) return false;

      /* Проверка идёт по вершинам меша и стоит дорого, а результат меняется
       * медленно (игрок не телепортируется каждый кадр). Считаем раз в
       * 6 кадров и переиспользуем — на глаз разницы нет, а бюджет кадра
       * возвращается к прежнему. */
      this._overTick = (this._overTick || 0) + 1;
      if (this._overCache !== undefined && this._overTick % 6 !== 0) return this._overCache;

      const decide = (v) => { this._overCache = v; return v; };

      // (1) Внутри меша — это не «под животом», это застревание
      if (this._isInsideBody()) return decide(false);

      // (4) У земли: под тушей нельзя парить в воздухе
      const gy = this.world.heightAt(this.pos.x, this.pos.z);
      if (this.pos.y - gy > 2.2) return decide(false);

      const bs = f.bodyScale;
      const local = _tmpPull.copy(this.pos);
      f.root.worldToLocal(local);   // деление на bs уже внутри
      const headY = local.y + this.height / bs;

      /* (5) Луч вверх: ищем вершины МЕША прямо над головой.
       *
       * По коллайдерам это делать нельзя — эллипсоид фартука у гиганта
       * растекается на десятки метров, и «под животом» срабатывало даже
       * в 40 м от друга. Меш же отражает настоящую форму. Проверяем
       * узкий столб над макушкой: если там есть плоть — мы действительно
       * под нависающей массой. */
      const arr = f.mesh.geometry.attributes.position.array;
      const world = _tmpDown;
      const headWorld = this.pos.y + this.height;
      const R2 = 0.55 * 0.55;      // радиус столба над головой
      let hits = 0;
      // Шаг по вершинам: полный проход на 16k вершин каждый кадр дорог,
      // а для проверки «есть ли масса сверху» достаточно выборки.
      for (let v = 0; v < f.vertexCount; v += 3) {
        const i = v * 3;
        world.set(arr[i], arr[i + 1], arr[i + 2]);
        f.mesh.localToWorld(world);
        if (world.y <= headWorld) continue;
        const dx = world.x - this.pos.x, dz = world.z - this.pos.z;
        if (dx * dx + dz * dz > R2) continue;
        if (++hits >= 3) return decide(true);   // три попадания — уверенно «под»
      }
      return decide(false);
    }

    /* -------------------- Полёт руки к точке хвата -------------------- */
    /**
     * Плавное движение кисти к цели вместо мгновенного захвата.
     *
     * Фазы (как в PEAK):
     *   0.0 .. 0.75  рука летит по дуге, ладонь раскрыта;
     *   0.75 .. 1.0  пальцы касаются плоти и смыкаются;
     *   1.0          захват зафиксирован, дальше работает _updateClimb.
     *
     * Цель хранится в координатах тела, поэтому «уезжает» вместе с
     * колышущейся плотью — рука не промахивается по дышащему животу.
     */
    _updateReaching(dt) {
      for (const h of this.hands) {
        const r = h.reaching;
        if (!r) continue;

        // Кнопку отпустили на полпути — отменяем замах
        const held = (h.side < 0 && this.mouse.left) || (h.side > 0 && this.mouse.right);
        if (!held && r.t < 0.7) {
          h.reaching = null;
          h.anim.releaseReach();
          h.anim.setPose('rest');
          continue;
        }

        r.t += dt / r.dur;
        const world = this.furry.root.localToWorld(r.local.clone());

        if (r.t < 1) {
          // Летим: ведём кисть к цели, вес IK нарастает
          const e = r.t * r.t * (3 - 2 * r.t);       // сглаживание
          h.anim.reachTo(world, Math.min(1, e * 1.2));
          // Ближе к цели ладонь начинает собираться в хват
          if (r.t > 0.75) {
            h.anim.setPose('grip', (r.t - 0.75) / 0.25 * 0.9);
          }
          continue;
        }

        /* --- Касание: рука УТОПАЕТ в жир --- */
        const nd = r.node;
        const C = FF.CONFIG.player;
        const bs = this.furry.bodyScale;

        /* Глубина погружения в МЕТРАХ, по мягкости именно этой точки.
         * Живот у раскормленного друга пускает пальцы на 40+ см,
         * лапка или бровь — на пять сантиметров. */
        const soft = U.clamp(nd.soft * nd.growth, 0, 1);
        // Глубину считает тело: она зависит от КОЛИЧЕСТВА плоти в месте
        // хвата, а не только от мягкости (см. FurryEngine.grabDepthAt)
        const sinkM = this.furry.grabDepthAt(nd);
        // В локальные единицы тела (меш живёт в них, а root.scale = bodyScale)
        const sinkLocal = sinkM / bs;

        /* Направление вдавливания — внутрь тела по нормали поверхности.
         * Нормаль берём ту, что вернул рейкаст по мешу: она честнее, чем
         * «направление от центра», на складках и под животом. */
        const inwardDir = (r.normal
          ? _tmpPull.copy(r.normal).applyQuaternion(
              this.furry.root.quaternion.clone().invert()).normalize().negate()
          : _tmpPull.copy(r.local).normalize().negate()).clone();

        /* Кисть встаёт НИЖЕ поверхности — она внутри плоти, а не на ней.
         *
         * Но глубину проверяем по САМОМУ МЕШУ: на тонких местах (ухо,
         * хвост, лапка, край фартука) 45 см «вглубь» — это насквозь и
         * наружу с другой стороны. Ищем, где рука реально упрётся, и
         * не пускаем её дальше «мышц». */
        const sinkClamped = this._clampSinkToFlesh(r.local, inwardDir, sinkLocal);
        const sunken = r.local.clone().addScaledVector(inwardDir, sinkClamped);
        // Пересчитываем метры: ниже они идут в вмятину и в UI
        const sinkMeters = sinkClamped * bs;

        h.grip = {
          node: nd,
          offset: sunken,                  // якорь ВНУТРИ жира
          quality: r.quality,
          slip: 0,
          depth: sinkClamped,
          depthMeters: sinkMeters,
          dir: inwardDir,
          surface: r.local.clone(),
        };
        h.reaching = null;

        /* РЕАЛЬНАЯ ВМЯТИНА В МЕШЕ.
         *
         * Центр вмятины — точка на ПОВЕРХНОСТИ, а не утопленная кисть:
         * воронка начинается там, где пальцы вошли в кожу. (Если брать
         * центром саму кисть, она оказывается глубже радиуса ямки, и
         * вершины кожи попадают в кольцо валика — тело не вминается,
         * а вспучивается наружу. Замер это и показал: ямка 0 см, валик 26.)
         *
         * Радиус — ладонь (18 см) плюс доля глубины: чем глубже провалилась
         * рука, тем шире воронка вокруг неё. */
        const holeR = (0.18 + sinkMeters * 0.85) / bs;
        this.furry.setHandPress('hand' + h.side, r.local, inwardDir, sinkClamped, holeR);

        // Плоть сминается под кистью
        nd.press(r.dir, 0.55 + soft * 0.5);
        nd.impulse(r.dir, 6 + soft * 8);
        this.audio && this.audio.squish();
        this.furry.wave(world, 0.4);
        h.anim.kick(0.35);
        h.anim.contactDepth = 0.85;
        // Друг замечает прикосновение именно к этой зоне
        if (this.furry.quirks) {
          this.furry.quirks.remember(nd.zone.id);
          this.furry.quirks.onGentleTouch();
        }
        this._checkClimbState();
      }
    }

    /* -------------------- Анти-застревание -------------------- */
    /**
     * Страховка от того, что игрок увязнет внутри туши.
     *
     * Три ступени, включаются по нарастающей:
     *   1. Через stuckSeconds топтания внутри тела — режим «фантом»:
     *      плоть перестаёт выталкивать совсем, можно спокойно выйти.
     *   2. Через stuckFreeSeconds — авто-выталкивание к ближайшей
     *      свободной точке снаружи, живот при этом «выпускает» игрока.
     *   3. Клавиша X в любой момент — экстренный выход наружу.
     *
     * Точка возврата — не случайная: запоминаем последнюю позицию,
     * где игрок реально был снаружи тела.
     */
    _updateStuckGuard(dt) {
      const C = FF.CONFIG.player;
      const f = this.furry;
      this._escapeCooldown = Math.max(0, this._escapeCooldown - dt);

      const inside = this._isInsideBody();
      const speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);

      // Снаружи — запоминаем безопасное место и всё сбрасываем
      if (!inside) {
        if (this.onGround) this.lastFreePos.copy(this.pos);
        this.stuckTimer = 0;
        this.phantom = U.damp(this.phantom, 0, 4, dt);
        f.playerPhantom = this.phantom > 0.5;
        return;
      }

      // Внутри и почти не двигается — считаем застревание
      if (speed < 0.9) this.stuckTimer += dt;
      else this.stuckTimer = Math.max(0, this.stuckTimer - dt * 0.6);

      // Ступень 1: фантом
      const t1 = C.stuckSeconds !== undefined ? C.stuckSeconds : 2.0;
      if (this.stuckTimer > t1) {
        if (this.phantom < 0.5) {
          FF.Game && FF.Game.notify('👻 Режим призрака: плоть пропускает тебя', 'info');
        }
        this.phantom = U.damp(this.phantom, 1, 6, dt);
        f.playerPhantom = true;
      }

      // Ступень 2: вытолкнуть наружу
      const t2 = C.stuckFreeSeconds !== undefined ? C.stuckFreeSeconds : 3.0;
      if (this.stuckTimer > t2) this.escapeFromBody(true);
    }

    /**
     * Ограничить погружение кисти толщиной плоти в этом месте.
     *
     * «Утонуть на 45 см» осмысленно в животе, но не в ухе, хвосте или
     * крае фартука: там рука прошла бы деталь насквозь и вылезла с
     * другой стороны — визуально это и есть «засосало внутрь меша».
     *
     * Идём лучом от точки входа вглубь и смотрим, где кожа снова
     * оказывается рядом (то есть где деталь кончается). Дальше этого
     * места — «мышцы», непробиваемое ядро.
     *
     * @param {THREE.Vector3} localPoint — точка входа, координаты тела
     * @param {THREE.Vector3} inward — направление вглубь (единичное)
     * @param {number} want — желаемая глубина, локальные единицы
     * @returns {number} разрешённая глубина, локальные единицы
     */
    _clampSinkToFlesh(localPoint, inward, want) {
      const f = this.furry;
      if (!f.physics || !f.physics.skinProbe) return want;
      const bs = f.bodyScale;
      const probe = _tmpDown;
      const STEPS = 6;
      let allowed = want;
      /* Идём вглубь и следим за ТОЛЩИНОЙ плоти над нами.
       *
       * Полагаться на знак skinProbe тут нельзя: у слитых примитивов
       * четверть нормалей смотрит внутрь, и на глубине знак случайно
       * переворачивается (замер: −41 см на шаге 5 и +40 см на шаге 6,
       * хотя рука всё это время была в животе). Из-за ложного «вышли
       * наружу» кламп срезал глубину, якорь прыгал — и это читалось
       * как «руку выбросило сквозь меш».
       *
       * Надёжный признак сквозного прохода — не знак, а РАЗРЫВ: пока
       * рука в плоти, расстояние до кожи меняется плавно, шаг за шагом.
       * Скачок означает, что ближайшей стала уже другая поверхность. */
      let prev = null;
      const step = want / STEPS;
      for (let i = 1; i <= STEPS; i++) {
        const d = step * i;
        probe.copy(localPoint).addScaledVector(inward, d);
        const pr = f.physics.skinProbe(probe.x, probe.y, probe.z, 3.0);
        if (!pr) continue;
        const cur = Math.abs(pr.dist);
        // Плоть кончилась: расстояние до кожи снова начало РАСТИ быстрее шага
        if (prev !== null && cur - prev > step * 1.5) { allowed = step * (i - 1); break; }
        prev = cur;
      }
      // Минимум 5 см, иначе на тонких местах хвата не будет вовсе
      const minSink = 0.05 / bs;
      return Math.max(Math.min(allowed, want), Math.min(minSink, want));
    }

    /**
     * Не дать ТУЛОВИЩУ уехать внутрь плоти.
     *
     * Руки при хвате законно тонут в жире на 20-45 см — это и просили.
     * А вот корпус должен оставаться снаружи: иначе игрок «засасывается»
     * сквозь оболочку, начинает видеть друга изнутри и получает ложные
     * режимы. Пружина карабканья тянет тело к точке хвата, и без этого
     * упора она затаскивала его под кожу (замер: до 1.4 м).
     *
     * Работает как мягкий, но непробиваемый пол по нормали кожи.
     */
    _keepBodyOutOfFlesh(dt) {
      const f = this.furry;
      if (!f.physics || !f.physics.skinProbe) return;
      const bs = f.bodyScale;
      const local = _tmpPull.copy(this.pos);
      f.root.worldToLocal(local);
      const y = local.y + this.height / bs * 0.5;
      const pr = f.physics.skinProbe(local.x, y, local.z, 3.0);
      if (!pr) return;

      // Насколько пояс игрока уже под кожей, в метрах
      const inside = -pr.dist * bs;
      /* Допуск: корпус может слегка примять жир (как и при ходьбе),
       * но не тонуть. BODY_SINK_MAX сознательно меньше глубины руки. */
      const BODY_SINK_MAX = 0.35;
      if (inside <= BODY_SINK_MAX) return;

      // Выталкиваем по нормали кожи ровно на превышение
      const push = (inside - BODY_SINK_MAX) / bs;
      const n = _tmpDown.set(pr.nx, pr.ny, pr.nz);
      if (n.lengthSq() < 1e-9) return;
      n.normalize().multiplyScalar(push);
      n.applyQuaternion(f.root.quaternion);
      this.pos.add(n);
      // Гасим составляющую скорости, тянущую дальше внутрь
      const vn = this.vel.dot(n.normalize());
      if (vn < 0) this.vel.addScaledVector(n, -vn);
    }

    /**
     * Игрок реально ЗАМУРОВАН в теле?
     *
     * Наивная проверка «попал в эллипсоид зоны» не годится: рядом с гигантом
     * эллипсоид бедра спускается ниже земли, и стоящий у ног игрок формально
     * оказывался «внутри». Поэтому считаем застреванием только глубокое
     * погружение: центр игрока должен быть заметно ближе к ядру зоны,
     * чем к её поверхности.
     */
    _isInsideBody() {
      const f = this.furry;
      if (!f.physics || !f.physics.skinProbe) return false;
      const bs = f.bodyScale;

      /* Спрашиваем САМ МЕШ, а не эллипсоиды зон.
       *
       * По эллипсоидам ответ был откровенно неверным: замер показывал
       * «внутри = true» для точки, лежащей в 1.2 МЕТРА СНАРУЖИ кожи —
       * перекрывающиеся зоны накрывают воздух вокруг друга. Из-за этого
       * анти-застревание срабатывало на ровном месте, а проверка
       * «под животом» получала мусор на вход.
       *
       * skinProbe даёт знаковое расстояние до настоящей оболочки. */
      const local = _tmpPull.copy(this.pos);
      f.root.worldToLocal(local);
      // Проверяем пояс игрока: ноги могут утопать в фартуке законно
      const y = local.y + this.height / bs * 0.5;
      const pr = f.physics.skinProbe(local.x, y, local.z, 3.0);
      if (!pr) return false;
      // Замурован = пояс глубже 30 см под кожей
      return -pr.dist * bs > 0.30;
    }

    /**
     * Экстренный выход: выбрасывает игрока наружу тела.
     * @param {boolean} auto true — сработала автоматика, false — нажали X
     */
    escapeFromBody(auto) {
      if (this._escapeCooldown > 0) return false;
      const f = this.furry;
      this._escapeCooldown = 1.2;
      this.stuckTimer = 0;

      // Направление наружу — от центра тела к игроку по горизонтали
      const out = _tmpPull.copy(this.pos).sub(f.root.position);
      out.y = 0;
      if (out.lengthSq() < 1e-4) out.set(0, 0, 1);
      out.normalize();

      // Радиус тела в этом направлении + запас
      const reach = 3.4 * f.bodyScale + 1.2;
      const target = out.multiplyScalar(reach).add(f.root.position);
      let gy = this.world.heightAt(target.x, target.z);
      if (this.world.platformAt) {
        const pl = this.world.platformAt(target.x, target.z, gy + 3);
        if (pl !== null && pl > gy) gy = pl;
      }

      this.pos.set(target.x, gy + 0.2, target.z);
      this.vel.set(0, 0, 0);
      this._releaseAllGrips();
      this.climbing = false;
      this.mode = 'walk';
      this.phantom = 0;
      f.playerPhantom = false;

      // Живот «выпускает» игрока: волна и вмятина в месте выхода
      const nd = f.zoneAt(this.pos) || f.nodeById.mid_belly;
      if (nd) nd.impulse(out.clone(), 14);
      f.wave(this.pos.clone(), 1.4);
      this.audio && this.audio.squish();

      FF.Game && FF.Game.notify(
        auto ? '💨 Тебя выпустило наружу' : '💨 Выбрался из тела друга!', 'info');
      return true;
    }

    /* -------------------- Режимы -------------------- */
    _updateModes(dt) {
      const f = this.furry;
      const local = f.root.worldToLocal(this.pos.clone());
      const S = f.species.scale;
      const horiz = Math.hypot(local.x, local.z);
      const bellyG = f.nodeById.mid_belly.growth;
      const prev = this.mode;

      if (!this.climbing) {
        /* Режимы определяем по РЕАЛЬНОЙ геометрии, а не по грубому цилиндру
         * вокруг друга. Старая проверка «игрок ниже 0.95 и ближе радиуса»
         * у гиганта охватывала площадь в несколько метров, поэтому просто
         * подойдя к ноге игрок получал режим «под животом», а камера при
         * этом оказывалась в пустоте — отсюда и ощущение провала внутрь. */
        // Стоим ногами на ЛЮБОЙ крупной зоне тела — значит мы наверху.
        // Эта проверка идёт первой: если под ногами плоть, мы точно не «под».
        /* Опора под ногами — любая зона тела: стоя на голове, спине или
         * плече игрок всё равно сверху, а не «под животом».
         *
         * standingZone держится до следующего касания, поэтому отойдя от
         * друга игрок сохранял режим onbelly. Сверяем, что опора реально
         * под ногами: её верх должен быть рядом с текущей высотой. */
        let onBody = false;
        if (this.standingZone && this.standingZone.node && this.onGround) {
          const c = this.standingZone;
          const topWorld = f.root.position.y + (c.center.y + c.radii.y) * f.bodyScale;
          // Опора должна быть свежей: её верх рядом с ногами игрока
          const fresh = Math.abs(this.pos.y - topWorld) < 1.2 + f.bodyScale * 0.4;
          // И заметно выше земли: фартук, растёкшийся по грунту, — это
          // ещё не «стоять на друге», иначе режим включался в 30 м от него.
          const gy = this.world.heightAt(this.pos.x, this.pos.z);
          const lifted = this.pos.y - gy > 0.45;
          onBody = fresh && lifted;
          if (!fresh) this.standingZone = null;   // опора устарела
        }
        if (onBody) {
          this.mode = 'onbelly';
        } else if (this._hasBellyOverhead()) {
          this.mode = 'underbelly';
        } else this.mode = 'walk';
      }

      if (this.mode !== prev) {
        if (this.mode === 'onbelly') {
          FF.Game && FF.Game.notify('🏔️ Ты на животе друга! E — сесть, прилечь, поспать', 'info');
          f.setEmotion('giggle', 3);
        }
        if (this.mode === 'underbelly') {
          FF.Game && FF.Game.notify('🏠 Под животом: тепло и уютно...', 'info');
          FF.Game && FF.Game.achieve('under_belly');
          this.audio && this.audio.setAmbience('indoor');
          f.setEmotion('bliss', 4);
        }
        if (prev === 'underbelly') this.audio && this.audio.setAmbience('city');
      }

      // Под животом: ближайшая микро-локация
      if (this.mode === 'underbelly') {
        let best = null, bd = Infinity;
        for (const s of FF.UNDER_BELLY_SPOTS) {
          if (f.calories < s.minCal) continue;
          const p = new THREE.Vector3(s.offset[0] * S, s.offset[1] * S, s.offset[2] * S);
          const d = p.distanceTo(local);
          if (d < 0.9 && d < bd) { bd = d; best = s; }
        }
        this.underBellySpot = best;
        if (best && best.stamina) this.stamina = Math.min(FF.CONFIG.player.maxStamina, this.stamina + dt * 14);
      } else this.underBellySpot = null;
    }

    /* -------------------- Руки и камера -------------------- */
    /**
     * Обновление анимированных рук: позы по контексту, IK к точке захвата,
     * реакция на мягкость плоти.
     */
    _updateHands(dt) {
      this.handsSystem.update(dt, { vel: this.vel, crouch: this.crouch });

      for (const h of this.hands) {
        const anim = h.anim;
        if (h.grip) {
          // Рука держится за складку — тянется к точке и сжимается
          const wp = this.furry.root.localToWorld(h.grip.offset.clone());
          anim.reachTo(wp, 1);
          const strength = U.clamp(0.65 + h.grip.quality * 0.35, 0, 1);
          anim.setPose('grip', strength);
          anim.contactDepth = Math.max(anim.contactDepth, h.grip.node.soft * 0.6);
          // Скольжение видно по подрагиванию пальцев
          if (h.grip.slip > 0.6) anim.bendFinger(U.randInt(1, 4), -0.04);
        } else {
          const pressed = (h.side < 0 && this.mouse.left) || (h.side > 0 && this.mouse.right);
          if (pressed) {
            // Куда указывает рука
            const origin = this.camera.getWorldPosition(_v1);
            const dir = this.camera.getWorldDirection(_v2);
            const reach = FF.CONFIG.player.reach * (0.8 + this.furry.bodyScale * 0.35);
            const target = origin.clone().addScaledVector(dir, reach * 0.55);
            const zone = this.furry.zoneAt(target, 1.0);
            if (zone) {
              anim.reachTo(target, 0.9);
              anim.setPose('massage');
              anim.contactDepth = zone.soft * zone.growth * 0.8;
            } else {
              anim.reachTo(target, 0.55);
              anim.setPose('palm');
            }
          } else {
            anim.releaseReach();
            // В руке еда — держим её
            const sel = FF.Game && FF.Game.inv.selected;
            const isFood = sel && FF.FOOD_BY_ID[sel];
            if (isFood && h.side > 0) anim.setPose('feed');
            else if (this.mode === 'climb') anim.setPose('grip', 0.4);
            else anim.setPose('rest');
          }
        }
      }
    }

    _updateCamera(dt) {
      const C = FF.CONFIG.player;
      // Ползком глаза почти у земли — так и пролезаем под живот
      const h = this.crawling ? C.crawlHeight : this.crouch ? C.crouchHeight : C.eyeHeight;
      this.height = U.damp(this.height, h, 12, dt);
      const bob = this.onGround ? Math.sin(this.headBob * 2) * 0.035 * (this.keys.ShiftLeft ? 1.4 : 1) : 0;
      const roll = Math.sin(this.headBob) * 0.012;

      // Тряска, когда стоишь на колышущемся животе
      let shake = new THREE.Vector3();
      // Гравитационные волны: каждый шаг гиганта отдаёт в камеру
      const mp = FF.Game && FF.Game.massPhys;
      if (mp && mp.shake.lengthSq() > 1e-8) shake.add(mp.shake);
      if (this.mode === 'onbelly') {
        const n = this.furry.nodeById.mid_belly;
        shake.set(n.offset.x * 0.6, n.offset.y * 0.8, n.offset.z * 0.6);
      }

      this.camera.position.copy(this.pos)
        .add(new THREE.Vector3(0, this.height + bob, 0)).add(shake);
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(this.yaw);
      this.camera.rotateX(this.pitch);
      this.camera.rotateZ(roll);
    }

    /** Телепорт (быстрое перемещение, такси) */
    teleport(x, z) {
      // Учитываем пол дома/крыльцо: иначе высадка внутри коттеджа
      // роняет игрока под приподнятое перекрытие первого этажа.
      let y = this.world.heightAt(x, z);
      if (this.world.platformAt) {
        const p = this.world.platformAt(x, z, y + 3);
        if (p !== null && p > y) y = p;
      }
      this.pos.set(x, y + 0.2, z);
      this.vel.set(0, 0, 0);
      this._releaseAllGrips();
      this.climbing = false; this.mode = 'walk';
    }

    serialize() { return { pos: this.pos.toArray(), yaw: this.yaw, stamina: this.stamina }; }
    deserialize(d) { if (!d) return; this.pos.fromArray(d.pos); this.yaw = d.yaw || 0; this.stamina = d.stamina || 100; }
  }

  FF.PlayerController = PlayerController;
})(typeof window !== 'undefined' ? window : globalThis);
