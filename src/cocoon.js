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
  const PHASES = [
    { t: 0,   id: 'rest',    name: 'сон на теле' },
    { t: 30,  id: 'wrap',    name: 'мягкое обволакивание' },
    { t: 60,  id: 'sink',    name: 'глубокое погружение' },
    { t: 120, id: 'cocoon',  name: 'внутри кокона' },
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

    /** Условия: друг достаточно большой и игрок спит на нём */
    canStart() {
      const g = this.game;
      const f = g.furry;
      if (!f || f.stage < 10) return false;
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

      /* --- Фаза по времени --- */
      let ph = PHASES[0];
      for (const x of PHASES) if (this.sleepTime >= x.t) ph = x;
      if (ph.id !== this.phase) this._enterPhase(ph);

      // Глубина растёт плавно: от 0 в покое до 1 в полном коконе
      const target = this.sleepTime < 30 ? 0
        : this.sleepTime < 60 ? (this.sleepTime - 30) / 30 * 0.35
        : this.sleepTime < 120 ? 0.35 + (this.sleepTime - 60) / 60 * 0.45
        : 1;
      this.depth = U.damp(this.depth, target, 0.6, dt);

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
        case 'cocoon':
          g.notify('🌌 Ты внутри тёплого кокона. X — выбраться · F — позвать друга · WASD — проснуться', 'quest');
          g.achieve('inside_friend');
          if (f.emotions) { f.emotions.e.love += 15; f.emotions.e.pride += 20; }
          f.setEmotion && f.setEmotion('bliss', 12);
          break;
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
