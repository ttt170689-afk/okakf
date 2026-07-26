/**
 * massphysics.js — ФИЗИКА КОЛОССАЛЬНОЙ МАССЫ
 *
 * Делает так, чтобы друг ощущался многотонным объектом, а не шариком:
 *
 *   • Soft Floor      — пол, диван и трава прогибаются под весом.
 *   • Belly Trap      — лежащий живот накрывает игрока, из-под него надо
 *                       выбираться, пробиваясь сквозь мягкую массу.
 *   • Гравитационные волны — каждый шаг трясёт камеру игрока и мебель.
 *   • Skin Friction   — ползая по телу, одежда «липнет» и тормозит.
 *   • Живой барьер    — туша перекрывает проходы и продавливает стены.
 *   • Звуки веса      — скрип половиц, шлепки жира, хлюпанье.
 *
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  const _v1 = new THREE.Vector3();

  class MassPhysics {
    constructor(game) {
      this.game = game;
      this.furry = game.furry;

      this.floorDent = 0;        // насколько прогнут пол под другом
      this.trapped = 0;          // 0..1 — насколько игрок придавлен животом
      this.struggle = 0;         // прогресс выбирания
      this.shake = new THREE.Vector3();
      this._stepTimer = 0;
      this._prevPos = this.furry.root.position.clone();
      this._creakTimer = 0;
      this._lastStepFoot = 1;
      this.frictionDrag = 1;     // множитель скорости игрока при ползании по телу
    }

    /** Тоннаж друга — база для всех эффектов */
    get tons() { return this.furry.mass / 1000; }

    /** Насколько сильно он давит: 0 у стройного, 1+ у гиганта */
    get heaviness() {
      return U.clamp((this.furry.mass - 62) / 900, 0, 3);
    }

    update(dt) {
      const g = this.game, f = this.furry, p = g.player;
      const heavy = this.heaviness;

      this._updateFloor(dt, heavy);
      this._updateSteps(dt, heavy);
      this._updateBellyTrap(dt, heavy);
      this._updateFriction(dt);
      this._decayShake(dt);
    }

    /* ---------- 1. ПРОГИБ ПОЛА ---------- */
    _updateFloor(dt, heavy) {
      const f = this.furry;
      // Пол прогибается тем сильнее, чем тяжелее друг. Значение читает
      // мир: диван, кровать и трава оседают под тушей.
      const target = Math.min(0.85, heavy * 0.30);
      this.floorDent = U.damp(this.floorDent, target, 2, dt);
      f.floorDent = this.floorDent;

      // Скрип половиц, когда туша шевелится в доме
      const moving = f._accel && f._accel.lengthSq() > 0.6;
      if (moving && heavy > 0.5) {
        this._creakTimer -= dt;
        if (this._creakTimer <= 0) {
          this._creakTimer = U.rand(0.7, 2.2);
          const g = this.game;
          if (g.audio && g.audio.noise) {
            g.audio.noise({ dur: 0.34, gain: 0.09 * Math.min(1, heavy),
              filter: 'bandpass', freq: 220, q: 3.5, sweepTo: 140 });
          }
        }
      }
    }

    /* ---------- 2. ГРАВИТАЦИОННЫЕ ВОЛНЫ ОТ ШАГОВ ---------- */
    _updateSteps(dt, heavy) {
      const f = this.furry;
      const moved = f.root.position.distanceTo(this._prevPos);
      this._prevPos.copy(f.root.position);
      if (heavy < 0.35) return;

      this._stepTimer -= dt;
      // Чем тяжелее — тем реже и весомее шаг
      const interval = 1.15 + heavy * 0.35;
      if (moved > 0.004 && this._stepTimer <= 0) {
        this._stepTimer = interval;
        this._lastStepFoot *= -1;
        this.stomp(Math.min(1.6, heavy * 0.8));
      }
    }

    /**
     * Тяжёлый шаг: волна по телу, тряска камеры, глухой удар.
     * @param {number} power сила 0..1.6
     */
    stomp(power) {
      const g = this.game, f = this.furry;
      // Волна отдачи по всей туше
      const foot = this._lastStepFoot > 0 ? 'right_foot' : 'left_foot';
      const nd = f.nodeById[foot];
      if (nd) nd.impulse(_v1.set(0, -1, 0), 22 * power);
      f.wave(f.root.localToWorld(_v1.set(0, 0.4, 0)), 1.3 * power);

      // Тряска камеры — тем сильнее, чем ближе игрок
      const d = g.player.pos.distanceTo(f.root.position);
      const falloff = U.clamp(1 - d / (14 * f.bodyScale), 0, 1);
      const amp = 0.055 * power * falloff;
      this.shake.set(U.rand(-amp, amp), -amp * 1.4, U.rand(-amp, amp));

      // Звук: глухой удар массы о землю
      if (g.audio && g.audio.noise && falloff > 0.05) {
        g.audio.noise({ dur: 0.30, gain: 0.30 * power * falloff,
          filter: 'lowpass', freq: 120, sweepTo: 45 });
      }
      // Предметы рядом подпрыгивают
      if (g.objects && g.objects.items) {
        for (const it of g.objects.items) {
          if (!it.mesh || it.stuck) continue;
          const dd = it.mesh.position.distanceTo(f.root.position);
          if (dd < 6 * f.bodyScale) {
            it.vel.y += 1.8 * power * (1 - dd / (6 * f.bodyScale));
          }
        }
      }
    }

    /* ---------- 3. BELLY TRAP: живот придавливает игрока ---------- */
    _updateBellyTrap(dt, heavy) {
      const g = this.game, f = this.furry, p = g.player;
      const belly = f.nodeById.mid_belly;
      // Ловушка работает, только когда друг реально большой и игрок под ним
      const canTrap = heavy > 0.6 && belly && belly.growth > 0.45;
      const under = p.mode === 'underbelly';

      if (canTrap && under) {
        // Живот наваливается: игрок вязнет и должен выбираться
        this.trapped = U.damp(this.trapped, 1, 0.9, dt);
        if (this.trapped > 0.55) {
          // Барахтаемся: движение и прыжок «пробивают» массу
          const wiggling = (p.keys.KeyW || p.keys.KeyS || p.keys.KeyA || p.keys.KeyD) ? 1 : 0;
          const jump = p.keys.Space ? 1.8 : 0;
          this.struggle += dt * (wiggling * 0.5 + jump * 0.7);
          // Плоть отзывается на барахтанье
          if (wiggling || jump) {
            belly.impulse(_v1.set(U.rand(-1, 1), 1, U.rand(-1, 1)).normalize(), 9 * dt * 60 * 0.016);
            if (Math.random() < dt * 3) g.audio && g.audio.squish();
          }
          if (this.struggle > 2.4) {
            // Выбрался
            this.struggle = 0;
            this.trapped = 0;
            p.pos.y += 0.35;
            p.vel.y = 4.2;
            g.notify('💨 Вырвался из-под живота!', 'info');
            f.setEmotion && f.setEmotion('giggle', 2.5);
            g.audio && g.audio.squish();
          }
          // Пока придавлен — двигаться почти нельзя
          p.vel.x *= 1 - 0.85 * this.trapped;
          p.vel.z *= 1 - 0.85 * this.trapped;
          if (!this._trapNotified) {
            this._trapNotified = true;
            g.notify('🫧 Живот накрыл тебя! Двигайся и жми Space, чтобы выбраться', 'warn');
          }
        }
      } else {
        this.trapped = U.damp(this.trapped, 0, 2.5, dt);
        this.struggle = Math.max(0, this.struggle - dt);
        if (this.trapped < 0.1) this._trapNotified = false;
      }
      f.playerTrapped = this.trapped;
    }

    /* ---------- 4. ТРЕНИЕ КОЖИ ---------- */
    _updateFriction(dt) {
      const g = this.game, p = g.player, f = this.furry;
      const onBody = p.mode === 'onbelly' || p.mode === 'underbelly' || p.climbing;
      if (!onBody) { this.frictionDrag = U.damp(this.frictionDrag, 1, 6, dt); return; }

      // Одежда липнет к коже: чем мягче зона и чем более она влажная,
      // тем сильнее тормозит. Мокрая шерсть, наоборот, скользит.
      const z = p.standingZone && p.standingZone.node;
      const soft = z ? z.soft * z.growth : 0.5;
      const sticky = 1 + soft * 0.55 - f.wet * 0.35;
      this.frictionDrag = U.damp(this.frictionDrag, U.clamp(sticky, 0.7, 1.8), 5, dt);
      p.skinDrag = this.frictionDrag;

      // Звук трения ткани о шерсть
      const speed = Math.hypot(p.vel.x, p.vel.z);
      if (speed > 0.8 && Math.random() < dt * speed * 0.9) {
        g.audio && g.audio.noise && g.audio.noise({
          dur: 0.18, gain: 0.05, filter: 'bandpass', freq: 2600, q: 1.6, sweepTo: 1500 });
      }
    }

    _decayShake(dt) {
      this.shake.multiplyScalar(Math.exp(-9 * dt));
    }

    /** Друг лёг: «эффект блина» — растекается по полу */
    onLieDown() {
      const f = this.furry;
      for (const nd of f.nodes) {
        if (nd.growth < 0.15) continue;
        // Плоть расплющивается: вниз и вширь
        nd.impulse(_v1.set(nd.base.x, -1.2, nd.base.z).normalize(), 8 * nd.growth);
      }
      this.game.audio && this.game.audio.squish();
      f.wave(f.root.position.clone(), 2.2);
    }
  }

  FF.MassPhysics = MassPhysics;
})(typeof window !== 'undefined' ? window : globalThis);
