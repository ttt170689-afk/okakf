/**
 * lifesystems.js — СИСТЕМЫ ЖИЗНИ ФУРРИ И ВЗАИМОДЕЙСТВИЯ
 *
 * Три подсистемы, которые превращают тело из «модели» в живое существо:
 *
 *   1. DigestionSystem — желудок реально наполняется и опорожняется.
 *      Съеденное сначала распирает живот, потом медленно переходит
 *      в жир. Урчание, бульканье, тяжесть после переедания.
 *
 *   2. TailSystem — хвост как тяжёлый маятник с инерцией. Виляет от
 *      радости, метёт землю при большой массе, сбивает предметы.
 *
 *   3. UnderBellyAmbience — акустика и свет под животом: внешний мир
 *      глохнет, слышно сердце и урчание, всё подсвечено красным.
 *
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  /* ============================================================
   * 1. ПИЩЕВАРЕНИЕ
   * ============================================================ */
  class DigestionSystem {
    constructor(furry) {
      this.furry = furry;
      this.stomach = 0;          // калорий сейчас в желудке
      this.capacity = 3000;      // растёт со стадией
      this.gurgleTimer = 0;
      this.heaviness = 0;        // 0..1 тяжесть после переедания
    }

    /** Ёмкость желудка растёт вместе с другом */
    get maxCapacity() {
      return this.capacity * (1 + this.furry.stage * 0.55);
    }

    /** Съеденное попадает сюда, а не сразу в жир */
    addFood(calories) {
      this.stomach += calories;
      const over = this.stomach / this.maxCapacity;
      if (over > 1.15) {
        this.furry.say('Ой... я, кажется, переел...');
        this.furry.setEmotion('bliss', 4);
      }
    }

    update(dt) {
      const f = this.furry;
      if (this.stomach > 0) {
        // Переваривание: чем полнее желудок, тем быстрее идёт процесс
        const rate = (40 + this.stomach * 0.05) * dt;
        const moved = Math.min(this.stomach, rate);
        this.stomach -= moved;

        // Живот физически распирает от содержимого
        const fill = U.clamp(this.stomach / this.maxCapacity, 0, 1.4);
        const belly = f.nodeById.mid_belly;
        const upper = f.nodeById.upper_belly;
        if (belly) belly.offset.z += fill * dt * 0.5;
        if (upper) upper.offset.z += fill * dt * 0.28;

        // Урчание и бульканье
        this.gurgleTimer -= dt;
        if (this.gurgleTimer <= 0) {
          this.gurgleTimer = U.rand(2.5, 7) / (0.4 + fill);
          if (f.audio && f.audio.bubble) f.audio.bubble();
          // Волна по животу от перистальтики
          if (belly && Math.random() < 0.5) {
            belly.impulse(new THREE.Vector3(U.rand(-1, 1), -0.4, 0.6).normalize(), 2.2 * fill);
          }
        }
        this.heaviness = U.damp(this.heaviness, U.clamp(fill, 0, 1), 2, dt);
      } else {
        this.heaviness = U.damp(this.heaviness, 0, 1.5, dt);
      }
    }

    /** Насколько живот сейчас распёрт (для UI и походки) */
    fullness() { return U.clamp(this.stomach / this.maxCapacity, 0, 1.4); }

    serialize() { return { stomach: this.stomach }; }
    deserialize(d) { if (d) this.stomach = d.stomach || 0; }
  }

  /* ============================================================
   * 2. ХВОСТ
   * ============================================================ */
  class TailSystem {
    constructor(furry) {
      this.furry = furry;
      this.wagPhase = 0;
      this.wagPower = 0;         // 0..1, растёт от радости
      this.swing = new THREE.Vector2();     // итоговый угол (маятник + виляние)
      this.swingVel = new THREE.Vector2();  // скорость маятника
      this.pendulumX = 0;                   // инерционная часть, интегрируется
      this.pendulumY = 0;
      this.sweepTimer = 0;
    }

    /** Порадовать: хвост завиляет */
    wag(power = 1, seconds = 2.5) {
      this.wagPower = Math.min(1, this.wagPower + power);
      this.wagUntil = (this.wagUntil || 0) + seconds;
    }

    update(dt) {
      const f = this.furry;
      const node = f.nodeById.tail_base;
      if (!node) return;

      // Радость сама по себе виляет хвостом
      if (f.mood > 0.8 && Math.random() < dt * 0.35) this.wag(0.5, 1.5);
      this.wagUntil = Math.max(0, (this.wagUntil || 0) - dt);
      if (this.wagUntil <= 0) this.wagPower = U.damp(this.wagPower, 0, 2, dt);

      /* Маятник: хвост тяжёлый и отстаёт от корпуса.
       * pendulum — интегрируемая часть (инерция), wag — чистое смещение.
       * Их нельзя складывать в одну переменную: раньше синус виляния
       * копился кадр за кадром и хвост залипал в упорах ±0.8. */
      const accel = f._accel || new THREE.Vector3();
      const mass = 1 + node.growth * 2.2;
      this.swingVel.x += (-accel.x * 0.05 - this.pendulumX * 9) * dt / mass;
      this.swingVel.y += (-accel.y * 0.03 - this.pendulumY * 9) * dt / mass;
      this.swingVel.multiplyScalar(Math.exp(-3.2 * dt));
      this.pendulumX = U.clamp(this.pendulumX + this.swingVel.x * dt, -0.5, 0.5);
      this.pendulumY = U.clamp(this.pendulumY + this.swingVel.y * dt, -0.4, 0.4);

      // Виляние — отдельная гармоника поверх маятника
      let wagOffset = 0;
      if (this.wagPower > 0.01) {
        this.wagPhase += dt * (7 + this.wagPower * 5);
        wagOffset = Math.sin(this.wagPhase) * this.wagPower * 0.42;
      }

      this.swing.x = U.clamp(this.pendulumX + wagOffset, -0.8, 0.8);
      this.swing.y = U.clamp(this.pendulumY, -0.6, 0.6);

      // Передаём в узел зоны, чтобы жир у основания реагировал
      node.offset.x += this.swing.x * 0.05;
      node.offset.y += this.swing.y * 0.04;

      // При большой массе хвост метёт землю и сбивает предметы
      if (node.growth > 0.6 && Math.abs(this.swingVel.x) > 0.6) {
        this.sweepTimer -= dt;
        if (this.sweepTimer <= 0) {
          this.sweepTimer = 0.8;
          this._sweepGround();
        }
      }
    }

    /** Сбить хвостом то, что лежит рядом на земле */
    _sweepGround() {
      const g = FF.Game;
      if (!g || !g.objects || !g.objects.items) return;
      const f = this.furry;
      const tailWorld = f.root.localToWorld(
        new THREE.Vector3(0, 0.98, -0.36).multiplyScalar(f.species.scale));
      let hit = 0;
      for (const it of g.objects.items) {
        if (!it.mesh || it.stuck) continue;
        const d = it.mesh.position.distanceTo(tailWorld);
        if (d < 1.6 * f.bodyScale) {
          const dir = it.mesh.position.clone().sub(tailWorld).normalize();
          it.vel.addScaledVector(dir, 3.5);
          it.vel.y += 2.2;
          hit++;
        }
      }
      if (hit && f.audio) f.audio.squish();
    }

    /** Текущий угол — чтобы меш хвоста мог его применить */
    angles() { return this.swing; }
  }

  /* ============================================================
   * 3. АКУСТИКА И СВЕТ ПОД ЖИВОТОМ
   * ============================================================ */
  class UnderBellyAmbience {
    constructor(game) {
      this.game = game;
      this.active = false;
      this.blend = 0;            // 0 снаружи .. 1 полностью внутри
      this.heartTimer = 0;

      // Красноватая подсветка «изнутри» — SSS-эффект вблизи
      this.light = new THREE.PointLight(0xff5544, 0, 6, 2);
      this.light.visible = false;
      game.scene.add(this.light);
    }

    /** Вход/выход из-под живота */
    setActive(on) {
      if (this.active === on) return;
      this.active = on;
      this.light.visible = true;
      const g = this.game;
      if (on) {
        // Внешний мир глохнет: срезаем верх спектра
        g.audio && g.audio.setAmbience('indoor');
        g.furry.setEmotion('bliss', 5);
      } else {
        g.audio && g.audio.setAmbience('city');
      }
    }

    update(dt) {
      const g = this.game;
      const target = this.active ? 1 : 0;
      this.blend = U.damp(this.blend, target, 3, dt);
      if (this.blend < 0.01) { this.light.visible = false; return; }

      this.light.visible = true;
      const f = g.furry;
      // Свет живёт под животом друга и пульсирует в такт сердцу
      const puls = 1 + (f._heartbeat || 0) * 0.35;
      this.light.position.set(
        f.root.position.x,
        f.root.position.y + 0.7 * f.bodyScale,
        f.root.position.z + 0.25 * f.bodyScale);
      this.light.intensity = this.blend * 2.6 * puls;

      // Сердцебиение слышно только внутри
      this.heartTimer -= dt;
      if (this.blend > 0.55 && this.heartTimer <= 0) {
        this.heartTimer = 60 / (62 + f.stage * 3);   // пульс в минуту
        if (g.audio && g.audio.noise) {
          g.audio.noise({ dur: 0.16, gain: 0.20 * this.blend, filter: 'lowpass', freq: 95, sweepTo: 55 });
          setTimeout(() => {
            if (g.audio && g.audio.noise) {
              g.audio.noise({ dur: 0.13, gain: 0.13 * this.blend, filter: 'lowpass', freq: 85, sweepTo: 50 });
            }
          }, 170);
        }
      }
    }
  }

  FF.DigestionSystem = DigestionSystem;
  FF.TailSystem = TailSystem;
  FF.UnderBellyAmbience = UnderBellyAmbience;
})(typeof window !== 'undefined' ? window : globalThis);
