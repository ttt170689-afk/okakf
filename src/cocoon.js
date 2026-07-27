/**
 * cocoon.js — «КОКОН»: мягкое погружение во сне.
 *
 * Когда игрок засыпает на теле друга 10-й стадии и выше, складки медленно
 * смыкаются над ним, и он оказывается в тёплом коконе из плоти: розовый
 * полумрак, стук сердца, приглушённый внешний мир.
 *
 * Это НЕ хоррор. Игрок в контроле всегда:
 *   • любое движение (WASD) — проснуться и выбраться;
 *   • X — рывок наружу;
 *   • F — позвать друга, он аккуратно достанет;
 *   • ничего не делать — досмотреть сон до утра.
 *
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  /** Фазы погружения по секундам сна */
  /* Пороги фаз — в ДОЛЯХ от задержки стадии (delay).
   * Так одна и та же четырёхфазная драматургия работает и за 30 секунд
   * (очень толстый), и за 5 (легендарный). */
  const PHASES = [
    { t: 0, id: 'rest',   name: 'сон на теле' },
    { t: 1, id: 'wrap',   name: 'мягкое обволакивание' },
    { t: 2, id: 'sink',   name: 'глубокое погружение' },
    { t: 4, id: 'cocoon', name: 'внутри кокона' },
  ];

  class CocoonSystem {
    constructor(game) {
      this.game = game;
      this.active = false;
      this.sleepTime = 0;      // сколько секунд спим на теле
      this.depth = 0;          // 0..1 насколько утонул
      this.phase = 'rest';
      this.heartTimer = 0;
      this._hintShown = false;

      // Тёплое свечение изнутри плоти
      this.light = new THREE.PointLight(0xff6a5a, 0, 7, 2);
      this.light.visible = false;
      game.scene.add(this.light);
    }

    /** Настройки засасывания для текущей стадии (null — недоступно) */
    absorbCfg() {
      const f = this.game.furry;
      if (!f || !f.emotions || !f.emotions.persona) return null;
      return f.emotions.persona().absorb || null;
    }

    /** Через сколько секунд сна смыкаются складки (зависит от стадии) */
    delay() {
      const c = this.absorbCfg();
      return c ? c.delay : 30;
    }

    /** Условия: друг достаточно большой и игрок спит на нём */
    canStart() {
      const g = this.game;
      const f = g.furry;
      /* Порог берём из таблицы стадий: способность просыпается на
       * «очень толстом» (ур. 8), а не на жёстко зашитой десятке.
       * Раньше стадии 8-9 умели обнимать во сне только на бумаге. */
      if (!f || !this.absorbCfg()) return false;
      const bs = g.bodySpots;
      if (!bs) return false;
      // Лежим или спрятались на теле
      return bs.state === 'lying' || bs.state === 'hidden';
    }

    update(dt) {
      const g = this.game, f = g.furry;

      if (!this.canStart()) {
        if (this.active) this.release('mode');
        this.sleepTime = 0;
        this.depth = U.damp(this.depth, 0, 3, dt);
        if (this.depth < 0.01) { this.light.visible = false; this.active = false; }
        else this._applyLight(dt);
        return;
      }

      this.sleepTime += dt;

      /* --- Пробуждение по вводу --- */
      const p = g.player;
      const moving = p.keys.KeyW || p.keys.KeyS || p.keys.KeyA || p.keys.KeyD;
      if (this.active) {
        if (moving) { this.release('struggle'); return; }
        if (p.keys.KeyX) { this.release('burst'); return; }
        if (p.keys.KeyF) { this.release('friend'); return; }
      }

      /* --- Фаза по времени ---
       * Пороги фаз растянуты относительно delay стадии: у «очень толстого»
       * обволакивание начинается через 30 с, у легендарного — через 5. */
      const D = this.delay();
      let ph = PHASES[0];
      for (const x of PHASES) if (this.sleepTime >= x.t * D) ph = x;
      if (ph.id !== this.phase) this._enterPhase(ph);

      /* Глубина растёт плавно. Потолок задаёт стадия: на 8-9 игрок тонет
       * лишь на ~60% (мягкое объятие), с 13-й — полностью. */
      const cfg = this.absorbCfg();
      const cap = cfg && cfg.depth !== undefined ? cfg.depth : 1;
      const t = this.sleepTime;
      const raw = t < D ? 0
        : t < D * 2 ? (t - D) / D * 0.35
        : t < D * 4 ? 0.35 + (t - D * 2) / (D * 2) * 0.45
        : 1;
      this.depth = U.damp(this.depth, raw * cap, 0.6, dt);

      if (this.depth > 0.02) {
        this.active = true;
        this._applyPhysics(dt);
        this._applyLight(dt);
        this._applySound(dt);
      }

      // Внутри кокона восстановление максимальное
      if (this.depth > 0.5) {
        const C = FF.CONFIG.player;
        g.player.stamina = Math.min(C.maxStamina, g.player.stamina + dt * 18);
        if (f.emotions) {
          f.emotions.e.love += dt * 2.5;
          f.emotions.e.comfort += dt * 3;
          f.emotions.e.pride += dt * 1.5;
        }
      }
    }

    _enterPhase(ph) {
      const g = this.game, f = g.furry;
      this.phase = ph.id;
      switch (ph.id) {
        case 'wrap':
          g.notify('🌀 Складки мягко смыкаются над тобой...', 'info');
          f.say(U.pick(['Спи спокойно~', 'Я тебя укрою...', 'Мур-р-р...']));
          break;
        case 'sink':
          g.notify('💫 Ты утопаешь всё глубже в мягкость', 'info');
          g.audio && g.audio.setAmbience('indoor');
          break;
        case 'cocoon': {
          const cfg = this.absorbCfg() || {};
          g.notify('🌌 Ты внутри тёплого кокона. X — выбраться · F — позвать друга · WASD — проснуться', 'quest');
          g.achieve('inside_friend');
          if (f.emotions) {
            f.emotions.e.love += 15;
            f.emotions.e.pride += 20;
            f.emotions.e.trust += 10;      // доверие +10 по ТЗ
          }
          f.setEmotion && f.setEmotion('bliss', 12);
          /* Пока игрок внутри — друг растёт вдвое быстрее: он же
           * буквально обнимает свою еду. Флаг читает growth в furry. */
          f.cocoonGrowthBoost = 2;
          // Мистическая стадия: особый сон-катсцена
          if (cfg.mystical) {
            g.notify('✨ Внутри — целый мир. Ты слышишь голос друга без слов...', 'quest');
            f.say && f.say(U.pick(['Ты дома.', 'Здесь время не идёт...', 'Спи, я всё держу.']));
          } else if (cfg.special) {
            g.notify('🕊️ Складки сомкнулись в тёплую комнату. Снаружи всё стихло.', 'info');
          }
          break;
        }
      }
    }

    /** Плоть обволакивает игрока */
    _applyPhysics(dt) {
      const g = this.game, f = g.furry;
      const d = this.depth;
      // Игрок медленно опускается в мягкость
      g.player.pos.y -= dt * 0.12 * d;
      // Зоны вокруг сминаются внутрь, «обнимая»
      const near = f.physics && f.physics.nearestZone(g.player.pos, 4);
      if (near && near.node) {
        near.node.press(_tmpDown.set(0, -1, 0), 0.5 * d * dt * 4);
        near.node.contactPress = Math.min(1, near.node.contactPress + dt * 2);
      }
      // Дыхание качает игрока
      g.player.pos.y += (f._breath || 0) * dt * 0.2 * d;
    }

    _applyLight(dt) {
      const g = this.game, f = g.furry;
      if (this.depth < 0.01) { this.light.visible = false; return; }
      this.light.visible = true;
      // Пульсация в такт сердцу
      const puls = 1 + (f._heartbeat || 0) * 0.4;
      this.light.position.copy(g.player.pos);
      this.light.position.y += 0.4;
      this.light.intensity = this.depth * 3.2 * puls;
      // Чем глубже, тем теплее и краснее
      this.light.color.setRGB(1, 0.42 - this.depth * 0.12, 0.36 - this.depth * 0.1);
    }

    _applySound(dt) {
      const g = this.game, f = g.furry;
      if (this.depth < 0.35) return;
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = 60 / (58 + f.stage * 0.4);
        const vol = 0.22 * this.depth;
        if (g.audio && g.audio.noise) {
          g.audio.noise({ dur: 0.18, gain: vol, filter: 'lowpass', freq: 88, sweepTo: 48 });
          setTimeout(() => {
            if (g.audio && g.audio.noise)
              g.audio.noise({ dur: 0.14, gain: vol * 0.65, filter: 'lowpass', freq: 78, sweepTo: 44 });
          }, 180);
        }
      }
    }

    /**
     * Выбраться наружу.
     * @param {'struggle'|'burst'|'friend'|'morning'|'mode'} how
     */
    release(how) {
      const g = this.game, f = g.furry;
      if (!this.active && this.depth < 0.05) return;
      const wasDeep = this.depth > 0.4;
      this.active = false;
      this.sleepTime = 0;
      this.phase = 'rest';

      // Выталкиваем наверх
      g.player.pos.y += 0.5 + this.depth * 0.8;
      g.player.vel.y = 3 + this.depth * 2;
      this.depth = 0;
      g.bodySpots && g.bodySpots.getUp();
      g.audio && g.audio.setAmbience('city');
      g.audio && g.audio.squish();
      f.wave(g.player.pos.clone(), 1.4);

      // Буст роста живёт только внутри кокона
      f.cocoonGrowthBoost = 1;

      /* «Тёплый сон»: после глубокого кокона игрок какое-то время
       * восстанавливается быстрее. Держим на игроке — его читает
       * регенерация стамины. */
      if (wasDeep) {
        g.player.warmSleepTimer = 600;   // 10 минут игрового времени
        g.notify('🌤️ Тёплый сон: восстановление ускорено на 10 минут', 'info');
      }

      if (!wasDeep) return;
      switch (how) {
        case 'burst':
          g.notify('💨 Ты вырвался наружу с мягким «плюх»!', 'info');
          f.setEmotion && f.setEmotion('giggle', 3);
          break;
        case 'friend':
          g.notify('🐾 Друг аккуратно раздвинул складки и достал тебя.', 'info');
          f.say(U.pick(['Ой! Прости, я тебя укутал~', 'Вот ты где! Хи-хи.', 'Хорошо поспал?']));
          if (f.emotions) f.emotions.onAction('hug', 1);
          break;
        case 'morning':
          g.notify('🌅 Утро. Друг уже освободил тебя — ты выспался как никогда.', 'quest');
          break;
        default:
          g.notify('🌊 Ты выбрался из мягкой глубины.', 'info');
          f.say(U.pick(['Уже проснулся?', 'Мур... было так уютно.', 'Ещё поспим?']));
      }
    }

    /** Подсказка для HUD */
    hint() {
      if (this.depth < 0.15) return null;
      if (this.depth < 0.5) return '🌀 Тебя мягко обволакивает... (двигайся, чтобы проснуться)';
      return '🌌 В коконе · X — выбраться · F — позвать друга · WASD — проснуться';
    }

    serialize() { return null; }   // состояние временное, в сейв не идёт
  }

  const _tmpDown = new THREE.Vector3();
  FF.CocoonSystem = CocoonSystem;
})(typeof window !== 'undefined' ? window : globalThis);
