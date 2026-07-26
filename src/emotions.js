/**
 * emotions.js — ПОЛНАЯ ЭМОЦИОНАЛЬНАЯ СИСТЕМА И БЛИЗОСТЬ
 *
 * Три подсистемы:
 *
 *   1. EmotionEngine   — 12 эмоций (0..100), их взаимовлияние, затухание
 *                        и проекция на тело: хвост, уши, глаза, румянец,
 *                        дыхание, пульс, мягкость живота.
 *   2. ProximitySystem — уровни близости от «далеко» до «утонул в теле».
 *                        Никаких жёстких стенок: плоть обтекает игрока.
 *   3. QuirkSystem     — привычки, память тела, реакция на звук, мурашки,
 *                        запотевание складок, слежение глазами за рукой.
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

  /* ============================================================
   * 1. ЭМОЦИИ
   * ============================================================ */

  /** Стартовые значения. Всё в шкале 0..100. */
  const BASE_EMOTIONS = {
    happiness: 50, love: 30, hunger: 40, comfort: 50,
    excitement: 20, shyness: 60, trust: 40, sleepiness: 10,
    pride: 30, anxiety: 20, playfulness: 40, gratitude: 30,
  };

  /**
   * Что делает каждое действие игрока с эмоциями.
   * Значения — мгновенная прибавка; отрицательные уменьшают.
   */
  const ACTION_EFFECTS = {
    touch:          { happiness: 3, comfort: 2 },
    belly_rub:      { happiness: 8, comfort: 10, love: 3, sleepiness: 2, trust: 1 },
    feed:           { hunger: -20, happiness: 15, gratitude: 10, comfort: 5, trust: 2, love: 1 },
    hug:            { love: 10, comfort: 15, anxiety: -20, trust: 5, happiness: 8 },
    climb_on:       { excitement: 10, playfulness: 8 },
    under_belly:    { love: 5, comfort: 8, trust: 3, pride: 5 },
    massage:        { comfort: 20, happiness: 15, sleepiness: 10, love: 5, anxiety: -15, trust: 3 },
    weigh:          { shyness: 20 },
    poke_belly:     { playfulness: 5, shyness: 3 },
    sleep_on_belly: { love: 15, comfort: 20, trust: 10, pride: 5, happiness: 10 },
    compliment:     { happiness: 12, shyness: 8, love: 5, pride: 10 },
    gift:           { happiness: 20, gratitude: 25, love: 10, excitement: 15, trust: 5 },
    leave:          { happiness: -10, anxiety: 5, comfort: -15 },
    return:         { happiness: 25, excitement: 20, love: 5, anxiety: -15 },
    loud_noise:     { anxiety: 18, excitement: 6, comfort: -10 },
    bath:           { comfort: 12, happiness: 8, love: 3 },
  };

  /** Реплики по доминирующей эмоции */
  const LINES = {
    happiness: ['Ня! Как хорошо!', 'Хи-хи, я такой счастливый~', 'Мур! Спасибо тебе!'],
    love:      ['Я тебя очень люблю...', 'Мур-р~ не уходи...', 'С тобой так тепло...'],
    shyness:   ['Ой... не смотри так...', 'Я... я стесняюсь!', 'Ммм... неловко...'],
    hunger:    ['В животике совсем пусто...', 'Я бы съел ещё...', 'Урчит... слышишь?'],
    comfort:   ['Ммм... блаженство...', 'Так уютно...', 'Не буди меня~'],
    sleepiness:['Я... засыпаю...', 'Зеваю... ня-а-ах...', 'Можно вздремнуть?'],
    excitement:['Ух ты! Ух ты!', 'Я так рад! Так рад!', 'Давай играть!'],
    anxiety:   ['Мне... немного страшно.', 'Побудь рядом, пожалуйста.', 'Что это было?..'],
    pride:     ['Смотри какой я большой!', 'Правда, я внушительный?', 'Я горжусь собой~'],
    gratitude: ['Спасибо... правда, спасибо.', 'Ты так добр ко мне...', 'Я это запомню!'],
    playfulness:['Догоняй!', 'Хочешь попрыгать на мне?', 'Хи-хи, поиграем?'],
  };

  class EmotionEngine {
    constructor(furry) {
      this.furry = furry;
      this.e = Object.assign({}, BASE_EMOTIONS);
      this.dominant = 'comfort';
      this.relationship = { level: 1, totalInteractions: 0, memories: [], lastContact: 0 };
      this._talkTimer = U.rand(8, 18);
      this._lastAway = 0;
    }

    /** Реакция на действие игрока */
    onAction(action, intensity) {
      const eff = ACTION_EFFECTS[action];
      if (!eff) return;
      const k = intensity === undefined ? 1 : intensity;
      for (const key in eff) {
        if (this.e[key] === undefined) continue;
        this.e[key] += eff[key] * k;
      }
      // Стеснительный друг сперва смущается от объятий, потом тает
      if (action === 'hug' && this.e.shyness > 50) {
        this.e.shyness += 5;
        this._shyRelease = 3;
      }
      // Пока доверия мало, любое касание слегка пугает
      if (action === 'touch' && this.e.trust < 30) {
        this.e.shyness += 5; this.e.anxiety += 2;
      }
      // На карабканье реагирует по доверию: радостно или тревожно
      if (action === 'climb_on') {
        if (this.e.trust > 60) { this.e.happiness += 5; this.e.pride += 3; }
        else this.e.anxiety += 10;
      }
      if (action === 'weigh' && this.e.pride > 50) {
        this.e.pride += 10; this.e.shyness -= 10;
      }
      this.relationship.totalInteractions++;
      this.relationship.lastContact = 0;
      this._clamp();
    }

    /** Доминирующая эмоция — та, что сильнее всего отклонилась от нормы */
    _updateDominant() {
      let best = 'comfort', bestScore = -1;
      for (const k in this.e) {
        const base = BASE_EMOTIONS[k];
        const score = (this.e[k] - base) / Math.max(20, 100 - base);
        if (score > bestScore) { bestScore = score; best = k; }
      }
      this.dominant = bestScore > 0.18 ? best : 'comfort';
    }

    update(dt) {
      const e = this.e;
      const f = this.furry;

      /* --- Естественное затухание к базовым значениям --- */
      const decay = (key, rate) => {
        e[key] += (BASE_EMOTIONS[key] - e[key]) * Math.min(1, rate * dt);
      };
      decay('excitement', 0.35); decay('shyness', 0.07); decay('anxiety', 0.12);
      decay('playfulness', 0.10); decay('gratitude', 0.05); decay('pride', 0.05);
      decay('happiness', 0.04); decay('comfort', 0.05);

      // Голод и сонливость растут сами
      e.hunger += dt * 0.45;
      e.sleepiness += dt * 0.16;

      // Отложенное «расслабление» после объятий
      if (this._shyRelease > 0) {
        this._shyRelease -= dt;
        if (this._shyRelease <= 0) e.shyness -= 15;
      }

      /* --- Взаимовлияние --- */
      const s = dt * 0.9;
      if (e.happiness > 70) e.anxiety -= 2 * s;
      if (e.hunger > 80) e.anxiety += 1 * s;
      if (e.comfort > 80) e.sleepiness += 0.5 * s;
      if (e.love > 60) e.trust += 0.3 * s;
      if (e.trust > 70) e.shyness -= 1 * s;
      if (e.hunger < 20) e.comfort += 0.5 * s;
      if (e.excitement > 50) e.sleepiness -= 2 * s;
      if (e.pride > 60) e.happiness += 0.3 * s;
      this._clamp();

      /* --- Синхронизация со старыми полями движка --- */
      // mood/hunger используются всей игрой — держим их согласованными,
      // иначе UI и кормление начнут расходиться с эмоциями.
      f.mood = U.clamp((e.happiness * 0.5 + e.comfort * 0.3 + e.love * 0.2) / 100, 0, 1);
      f.hunger = U.clamp(e.hunger / 100, 0, 1);

      this._updateDominant();
      this._applyToBody(dt);

      /* --- Реплики по настроению --- */
      this._talkTimer -= dt;
      if (this._talkTimer <= 0) {
        this._talkTimer = U.rand(14, 30);
        const pool = LINES[this.dominant];
        if (pool && f.say) f.say(U.pick(pool));
      }

      // Разлука: игрок далеко — друг скучает
      this.relationship.lastContact += dt;
      if (this.relationship.lastContact > 60 && !this._missedFired) {
        this._missedFired = true;
        this.onAction('leave', 1);
      }
      if (this.relationship.lastContact < 5) this._missedFired = false;

      this.relationship.level = U.clamp(1 + f.relation * 0.4 + e.trust * 0.3, 1, 100);
    }

    /** Проекция эмоций на тело: хвост, уши, глаза, румянец, дыхание, пульс */
    _applyToBody(dt) {
      const e = this.e;
      const f = this.furry;

      // Хвост
      if (f.tail) {
        if (e.happiness > 70 || e.excitement > 60) f.tail.wag(0.5 * dt * 4, 0.4);
        else if (e.anxiety > 60) f.tail.wagPower *= Math.exp(-3 * dt);   // поджат
      }

      // Румянец: стеснение + любовь + возбуждение
      const blush = U.clamp(e.shyness * 0.010 + e.love * 0.005 + e.excitement * 0.003, 0, 1);
      f.blush = Math.max(f.blush, blush);

      // Уши и веки — через мимику движка
      f.earDroop = U.clamp(e.sleepiness / 100 * 0.8 + e.shyness / 100 * 0.5, 0, 1);
      f.eyeOpen = U.clamp(1 - e.sleepiness / 130, 0.25, 1);

      // Дыхание и пульс
      f.breathScale = 1 + e.excitement * 0.008 + e.anxiety * 0.006 - e.comfort * 0.003;
      f.heartBPM = 80 + e.excitement * 0.5 + e.anxiety * 0.4 + e.love * 0.2 - e.sleepiness * 0.3;

      // Мягкость: в комфорте тело буквально «тает»
      f.softBoost = U.clamp(e.comfort / 100 * 0.35 + e.love / 100 * 0.15, 0, 0.5);

      // Урчание от голода
      if (e.hunger > 45 && f.digestion) f.hungerGrowl = (e.hunger - 45) / 55;
      else f.hungerGrowl = 0;
    }

    _clamp() {
      for (const k in this.e) this.e[k] = U.clamp(this.e[k], 0, 100);
    }

    /** Короткая сводка для UI */
    summary() {
      const names = {
        happiness: '😊 Счастье', love: '🥰 Любовь', hunger: '😋 Голод',
        comfort: '😌 Комфорт', excitement: '🎉 Возбуждение', shyness: '😳 Стеснение',
        trust: '🤝 Доверие', sleepiness: '😴 Сонливость', pride: '😤 Гордость',
        anxiety: '😰 Тревога', playfulness: '🎮 Игривость', gratitude: '🙏 Благодарность',
      };
      return Object.keys(this.e).map((k) => ({ id: k, name: names[k] || k, value: this.e[k] }));
    }

    serialize() { return { e: this.e, rel: this.relationship }; }
    deserialize(d) {
      if (!d) return;
      if (d.e) Object.assign(this.e, d.e);
      if (d.rel) Object.assign(this.relationship, d.rel);
    }
  }

  /* ============================================================
   * 2. БЛИЗОСТЬ: никаких невидимых стен
   * ============================================================ */
  class ProximitySystem {
    constructor(game) {
      this.game = game;
      this.level = 'far';        // far | near | close | contact | submerged
      this.depth = 0;            // насколько глубоко утонул (0..1)
      this._sighTimer = 0;
    }

    update(dt) {
      const g = this.game;
      const f = g.furry, p = g.player;
      if (!f || !p) return;

      // Расстояние от игрока до ПОВЕРХНОСТИ тела, а не до центра
      const local = _v1.copy(p.pos);
      f.root.worldToLocal(local);
      local.divideScalar(f.bodyScale);
      const near = f.physics ? f.physics.nearestZone(p.pos, 6) : null;

      let surfDist = 99;
      if (near && near.node) {
        // Насколько игрок внутри эллипсоида зоны
        surfDist = near.distance;
      }

      const prev = this.level;
      if (p.mode === 'underbelly' || p.mode === 'onbelly' || (p.contact && p.sinkDepth > 0.25)) {
        this.level = 'submerged';
      } else if (surfDist < 0.35) this.level = 'contact';
      else if (surfDist < 1.1) this.level = 'close';
      else if (surfDist < 2.6) this.level = 'near';
      else this.level = 'far';

      const em = f.emotions;
      const k = dt * 0.9;

      switch (this.level) {
        case 'far':
          if (em) { em.e.happiness -= 0.10 * k; em.e.anxiety += 0.05 * k; }
          break;
        case 'near':
          if (em) { em.e.comfort += 0.05 * k; }
          break;
        case 'close':
          if (em) { em.e.happiness += 0.30 * k; em.e.love += 0.10 * k; em.e.comfort += 0.20 * k; }
          if (f.tail) f.tail.wag(0.25 * dt, 0.3);
          break;
        case 'contact':
          if (em) {
            em.e.happiness += 0.5 * k; em.e.love += 0.3 * k;
            em.e.comfort += 0.5 * k; em.e.trust += 0.1 * k;
            if (em.e.shyness > 40) f.blush = Math.max(f.blush, em.e.shyness / 130);
          }
          this._purr(dt, 0.6);
          break;
        case 'submerged':
          if (em) {
            em.e.love += 1.0 * k; em.e.comfort += 1.0 * k;
            em.e.happiness += 0.8 * k; em.e.trust += 0.5 * k; em.e.anxiety -= 2.0 * k;
          }
          this._purr(dt, 1.0);
          // Плоть обтекает игрока: зоны вокруг сминаются внутрь
          this._wrapAround(dt);
          break;
      }

      if (this.level !== prev) {
        if (this.level === 'submerged') {
          f.setEmotion && f.setEmotion('bliss', 5);
          if (f.emotions) f.emotions.onAction('under_belly', 1);
        }
        if (this.level === 'contact' && prev === 'close') {
          g.audio && g.audio.squish();
        }
        // Разрыв контакта — грустный вздох
        if (prev === 'submerged' || prev === 'contact') {
          if (this.level === 'near' || this.level === 'far') {
            f.say && f.say(U.pick(['Ой... уже уходишь?', 'Ммм... вернись~', 'Мне было так уютно...']));
            g.audio && g.audio.voice('sad', f.opts.species);
          }
        }
      }
      this.depth = U.damp(this.depth, this.level === 'submerged' ? 1
        : this.level === 'contact' ? 0.45 : 0, 3, dt);
    }

    _purr(dt, power) {
      const g = this.game, f = g.furry;
      this._sighTimer -= dt;
      if (this._sighTimer <= 0) {
        this._sighTimer = U.rand(2.5, 5) / power;
        // Голос глубже у крупного друга — см. QuirkSystem.voicePitch
        g.audio && g.audio.voice('mur', f.opts.species, f.voicePitch || 1);
      }
    }

    /**
     * Тело обтекает игрока: ближайшие зоны продавливаются внутрь,
     * а не выталкивают. Это и есть «мягкая подушка» вместо коллайдера.
     */
    _wrapAround(dt) {
      const g = this.game, f = g.furry;
      if (!f.physics) return;
      const near = f.physics.nearestZone(g.player.pos, 3.0);
      if (!near || !near.node) return;
      const dir = _v2.copy(g.player.pos).sub(f.root.position).normalize();
      near.node.press(dir, 0.7 * dt * 4);
      near.node.contactPress = Math.min(1, near.node.contactPress + dt * 3);
      // Соседние зоны слегка подтягиваются к игроку — эффект «обхвата»
      for (const nd of f.nodes) {
        if (nd === near.node || nd.growth < 0.1) continue;
        const d = nd.base.distanceTo(near.node.base);
        if (d > 0.5) continue;
        nd.impulse(dir.clone().multiplyScalar(-1), 1.6 * dt * 6 * (1 - d / 0.5));
      }
    }
  }

  /* ============================================================
   * 3. ПРИВЫЧКИ, ПАМЯТЬ ТЕЛА, СЕНСОРИКА
   * ============================================================ */
  class QuirkSystem {
    constructor(game) {
      this.game = game;
      this.furry = game.furry;
      /** Память тела: сколько раз трогали каждую зону */
      this.touchMemory = {};
      this.habitTimer = U.rand(6, 14);
      this.stareTime = 0;
      this.goosebumps = 0;      // мурашки
      this.fogged = 0;          // запотевание складок
      this._lastLoud = 0;
    }

    /** Игрок коснулся зоны — запоминаем */
    remember(zoneId) {
      if (!zoneId) return;
      const m = this.touchMemory;
      m[zoneId] = (m[zoneId] || 0) + 1;
      // Привычная зона перестаёт смущать: рука утопает глубже
      const nd = this.furry.nodeById[zoneId];
      if (nd) nd.familiarity = U.clamp((m[zoneId] || 0) / 40, 0, 1);
    }

    /** Насколько зона «привычная» (0..1) */
    familiarity(zoneId) {
      return U.clamp((this.touchMemory[zoneId] || 0) / 40, 0, 1);
    }

    /** Громкий звук — друг вздрагивает, живот отвечает волной */
    onLoudSound(power) {
      const f = this.furry;
      const now = performance.now();
      if (now - this._lastLoud < 400) return;
      this._lastLoud = now;
      const p = U.clamp(power || 1, 0, 2);
      if (f.emotions) f.emotions.onAction('loud_noise', p);
      // «Желейный всплеск»: мощная волна по всему телу
      const belly = f.nodeById.mid_belly;
      if (belly) belly.impulse(new THREE.Vector3(0, -1, 0.3).normalize(), 34 * p);
      f.wave(f.root.localToWorld(new THREE.Vector3(0, 1.05, 0.3)), 2.0 * p);
      f.setEmotion && f.setEmotion('shy', 2.5);
      this.goosebumps = Math.min(1, this.goosebumps + 0.7 * p);
      f.say && f.say(U.pick(['Ай! Что это?!', 'Ой-ой!', 'Я испугался!']));
    }

    /** Нежное касание — мурашки */
    onGentleTouch() {
      this.goosebumps = Math.min(1, this.goosebumps + 0.45);
    }

    update(dt) {
      const g = this.game, f = this.furry, p = g.player;
      const em = f.emotions;

      /* --- Мурашки и запотевание затухают --- */
      this.goosebumps = Math.max(0, this.goosebumps - dt * 0.35);
      const underBelly = p.mode === 'underbelly';
      this.fogged = U.damp(this.fogged, underBelly ? 1 : 0, underBelly ? 0.35 : 1.2, dt);

      /* --- Динамический голос: чем крупнее, тем ниже и мягче --- */
      f.voicePitch = U.clamp(1.02 - f.stage * 0.055, 0.45, 1.05);

      /* --- Взгляд следит за рукой игрока --- */
      const hs = p.handsSystem;
      if (hs && f.eyes && f.eyes.length) {
        const reach = 2.4 + f.bodyScale * 1.2;
        const d = p.pos.distanceTo(f.root.position);
        if (d < reach * 1.6) {
          // Смотрит на ближайшую кисть — предвкушает касание
          const hand = hs.right && hs.right.palmWorld ? hs.right.palmWorld(_v1) : null;
          f.gazeTarget = hand ? _v1.clone() : p.pos.clone();
          f.gazeWeight = U.damp(f.gazeWeight || 0, 1, 4, dt);
        } else {
          f.gazeWeight = U.damp(f.gazeWeight || 0, 0, 2, dt);
        }
      }

      /* --- Игрок долго пялится: другу неловко --- */
      const looking = this._playerLookingAtBody();
      if (looking) {
        this.stareTime += dt;
        if (this.stareTime > 4 && em) {
          em.e.shyness += dt * 6;
          if (this.stareTime > 6 && Math.random() < dt * 0.4) {
            f.say(U.pick(['Ч-что ты так смотришь?..', 'Я знаю, что большой...', 'Ой... не разглядывай!']));
            this.stareTime = 0;
            // Переминается с ноги на ногу
            f.nodeById.left_foot && f.nodeById.left_foot.impulse(new THREE.Vector3(0.4, -1, 0), 5);
            f.nodeById.right_foot && f.nodeById.right_foot.impulse(new THREE.Vector3(-0.4, -1, 0), 5);
          }
        }
      } else this.stareTime = Math.max(0, this.stareTime - dt * 2);

      /* --- Привычки: сам поглаживает живот, когда голоден --- */
      this.habitTimer -= dt;
      if (this.habitTimer <= 0) {
        this.habitTimer = U.rand(9, 20);
        if (em && em.e.hunger > 55) {
          // Круговое поглаживание собственного живота
          const belly = f.nodeById.mid_belly;
          if (belly) {
            belly.press(new THREE.Vector3(0, -0.2, -1), 0.5);
            belly.impulse(new THREE.Vector3(0.4, -0.3, 0.6).normalize(), 7);
          }
          f.say(U.pick(['*гладит животик* Ммм... кушать...', 'Урчит... слышишь?', '*поглаживает пузо*']));
          g.audio && g.audio.squish();
        } else if (em && em.e.sleepiness > 70) {
          f.say(U.pick(['*зевает* Ня-а-ах...', 'Так спать хочется...']));
        } else if (em && em.e.playfulness > 65) {
          f.tail && f.tail.wag(1, 2.5);
          f.say(U.pick(['Хочешь поиграть?', 'Хи-хи, догоняй!']));
        }
      }

      /* --- Голодное урчание живота --- */
      if (f.hungerGrowl > 0.15 && Math.random() < dt * f.hungerGrowl * 1.6) {
        g.audio && g.audio.bubble && g.audio.bubble();
        const belly = f.nodeById.mid_belly;
        if (belly) belly.impulse(new THREE.Vector3(0, -0.5, 0.5).normalize(), 4 * f.hungerGrowl);
      }
    }

    /** Смотрит ли игрок на тело друга */
    _playerLookingAtBody() {
      const g = this.game, f = this.furry, p = g.player;
      const d = p.pos.distanceTo(f.root.position);
      if (d > 12 * f.bodyScale) return false;
      const dir = _v1.set(0, 0, -1).applyQuaternion(g.camera.quaternion);
      const to = _v2.copy(f.root.position).sub(p.pos).normalize();
      return dir.dot(to) > 0.88;
    }

    serialize() { return { mem: this.touchMemory }; }
    deserialize(d) {
      if (!d || !d.mem) return;
      this.touchMemory = d.mem;
      for (const id in this.touchMemory) {
        const nd = this.furry.nodeById[id];
        if (nd) nd.familiarity = U.clamp(this.touchMemory[id] / 40, 0, 1);
      }
    }
  }

  FF.EmotionEngine = EmotionEngine;
  FF.ProximitySystem = ProximitySystem;
  FF.QuirkSystem = QuirkSystem;
  FF.EMOTION_ACTIONS = ACTION_EFFECTS;
})(typeof window !== 'undefined' ? window : globalThis);
