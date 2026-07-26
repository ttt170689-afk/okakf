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
        { side: -1, grip: null, mesh: null, target: new THREE.Vector3(), rest: new THREE.Vector3(-0.28, -0.22, -0.55) },
        { side: 1, grip: null, mesh: null, target: new THREE.Vector3(), rest: new THREE.Vector3(0.28, -0.22, -0.55) },
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
      if (hand.grip) { hand.grip = null; this._checkClimbState(); }
    }

    /** Попытка схватиться за тело / тычок */
    _tryGrabOrPoke(hand) {
      const origin = this.camera.getWorldPosition(new THREE.Vector3());
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      const reach = FF.CONFIG.player.reach * (0.8 + this.furry.bodyScale * 0.35);
      const hit = origin.clone().addScaledVector(dir, reach * 0.6);

      // Точный рейкаст по эллипсоидам зон — попадаем именно туда, куда смотрим
      let best = null, bestD = Infinity;
      const ray = this.furry.physics && this.furry.physics.raycast(origin, dir, reach);
      if (ray && ray.node.zone.grab && ray.node.growth > 0.05) {
        const foldBonus = ray.node.zone.folds.filter((t) => this.furry.calories >= t).length * 0.14;
        best = { node: ray.node, pos: ray.point,
          quality: U.clamp(ray.node.growth * (0.35 + ray.node.soft * 0.5) + foldBonus - this.furry.wet * 0.35, 0.05, 1) };
        bestD = ray.distance;
      } else {
        const points = this.furry.grabPoints();
        for (const p of points) {
          const d = p.pos.distanceTo(hit);
          if (d < reach && d < bestD) { bestD = d; best = p; }
        }
      }
      if (best && bestD < reach) {
        if (this.keys.ShiftLeft || this.mode === 'climb' || !this.onGround || best.pos.y > this.pos.y + 0.5) {
          // ХВАТ: рука не просто «цепляется за точку» — она проваливается
          // в плоть. Запоминаем, НАСКОЛЬКО глубоко утонули пальцы: по этой
          // глубине потом тянется складка и сминается жир под кистью.
          const soft = best.node.soft * best.node.growth;
          const depth = (0.06 + soft * 0.26) * this.furry.bodyScale;
          const inward = this.furry.root.worldToLocal(best.pos.clone())
            .normalize().multiplyScalar(-depth);
          const anchor = this.furry.root.worldToLocal(best.pos.clone()).add(inward);
          hand.grip = {
            node: best.node,
            offset: anchor,          // якорь ВНУТРИ жира, а не на поверхности
            quality: best.quality,
            slip: 0,
            depth,                   // глубина погружения кисти
            surface: this.furry.root.worldToLocal(best.pos.clone()),
          };
          // Плоть сминается под кистью и тянется за рукой
          best.node.press(dir, 0.55 + soft * 0.5);
          best.node.impulse(dir, 6 + soft * 8);
          this.audio && this.audio.squish();
          this.furry.wave(best.pos, 0.4);
          hand.anim.kick(0.35);
          hand.anim.contactDepth = 0.85;
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

      this._updateHands(dt);
      this._updateCamera(dt);
      this._updateModes(dt);
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

      // Прыжок
      if (this.keys.Space && this.onGround) {
        // Батут на животе
        if (this.mode === 'onbelly') {
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
      if (this.onGround && !this.keys.ShiftLeft)
        this.stamina = Math.min(C.maxStamina, this.stamina + dt * C.staminaRegen);

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

      // Средняя точка захвата в мировых координатах
      const anchor = new THREE.Vector3();
      for (const h of grips) {
        const wp = this.furry.root.localToWorld(h.grip.offset.clone());
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
          h.grip = null;
          this.audio && this.audio.squish();
          FF.Game && FF.Game.notify('🖐 Рука соскользнула!', 'warn');
        }
      }
      if (this.stamina <= 0) {
        this.hands.forEach((h) => (h.grip = null));
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

    /* -------------------- Режимы -------------------- */
    _updateModes(dt) {
      const f = this.furry;
      const local = f.root.worldToLocal(this.pos.clone());
      const S = f.species.scale;
      const horiz = Math.hypot(local.x, local.z);
      const bellyG = f.nodeById.mid_belly.growth;
      const prev = this.mode;

      if (!this.climbing) {
        const bellyTop = (1.35 + bellyG * 0.55) * S;
        if (local.y > bellyTop - 0.6 && horiz < (0.5 + bellyG * 1.5) * S && this.onGround) {
          this.mode = 'onbelly';
        } else if (bellyG > 0.45 && local.y < 0.95 * S && horiz < (0.7 + bellyG * 1.6) * S) {
          this.mode = 'underbelly';
        } else this.mode = 'walk';
      }

      if (this.mode !== prev) {
        if (this.mode === 'onbelly') {
          FF.Game && FF.Game.notify('🏔️ Ты на животе друга! Space — прыжок-батут', 'info');
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
      this.hands.forEach((h) => (h.grip = null));
      this.climbing = false; this.mode = 'walk';
    }

    serialize() { return { pos: this.pos.toArray(), yaw: this.yaw, stamina: this.stamina }; }
    deserialize(d) { if (!d) return; this.pos.fromArray(d.pos); this.yaw = d.yaw || 0; this.stamina = d.stamina || 100; }
  }

  FF.PlayerController = PlayerController;
})(typeof window !== 'undefined' ? window : globalThis);
