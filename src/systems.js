/**
 * systems.js — Дополнительные системы из ТЗ, которых не хватало.
 *
 *   1. ClothingSystem  — одежда 6 слотов, натяжение, разрыв по стадиям,
 *                        эластичная линейка, гардероб
 *   2. WeatherSystem   — дождь/снег/радуга/туман, шоколадные лужи,
 *                        влияние на скольжение и настроение
 *   3. PhotoSystem     — фото-режим: рамки, фильтры, альбом
 *   4. StatsTracker    — подробная статистика и рекорды
 *   5. NotebookSystem  — дневник игрока: автозаписи о прогрессе
 *
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  /* ============================================================
   * 1. СИСТЕМА ОДЕЖДЫ
   * ============================================================ */
  const CLOTHING_CATALOG = [
    // slot: shirt | pants | sweater | pyjama | cloak | accessory
    { id: 'tshirt_basic', name: 'Базовая футболка', slot: 'shirt', icon: '👕', price: 40,
      maxStage: 4, color: 0x5aa7d8, desc: 'Простая, рвётся на 5-й стадии' },
    { id: 'tshirt_elastic', name: 'Эластичная футболка', slot: 'shirt', icon: '👕', price: 160,
      maxStage: 8, color: 0x6fbf7a, elastic: true, desc: 'Растягивается вместе с другом' },
    { id: 'sweater_cozy', name: 'Уютный свитер', slot: 'sweater', icon: '🧶', price: 95,
      maxStage: 5, color: 0xd87a9a, warm: true, desc: '+настроение в холод' },
    { id: 'sweater_giant', name: 'Свитер для гиганта', slot: 'sweater', icon: '🧶', price: 420,
      maxStage: 9, color: 0xc4685a, elastic: true, warm: true, desc: 'Огромный, тёплый, эластичный' },
    { id: 'pants_basic', name: 'Шорты', slot: 'pants', icon: '🩳', price: 35,
      maxStage: 4, color: 0x3b4a63, desc: 'Обычные шорты' },
    { id: 'pants_elastic', name: 'Эластичные штаны', slot: 'pants', icon: '👖', price: 180,
      maxStage: 8, color: 0x4a5a7a, elastic: true, desc: 'Тянутся почти бесконечно' },
    { id: 'pyjama', name: 'Пижама в звёздочку', slot: 'pyjama', icon: '🌙', price: 120,
      maxStage: 7, color: 0x8a7ad8, elastic: true, comfy: true, desc: 'Сон восстанавливает больше' },
    { id: 'cloak_royal', name: 'Королевская мантия', slot: 'cloak', icon: '👑', price: 900,
      maxStage: 99, color: 0x9a2a3a, elastic: true, prestige: true, desc: 'Статус! NPC реагируют иначе' },
    { id: 'apron_chef', name: 'Фартук повара', slot: 'accessory', icon: '🍳', price: 140,
      maxStage: 99, color: 0xf0f0f0, cookBonus: 0.1, desc: '+10% к качеству готовки' },
    { id: 'scarf', name: 'Длинный шарф', slot: 'accessory', icon: '🧣', price: 70,
      maxStage: 99, color: 0xd94f6a, warm: true, desc: 'Развевается на ветру' },
    { id: 'bowtie', name: 'Бабочка', slot: 'accessory', icon: '🎀', price: 55,
      maxStage: 99, color: 0x2a2a3a, desc: 'Для торжественных случаев' },
    { id: 'crown', name: 'Корона «ИМБА»', slot: 'accessory', icon: '👑', price: 2500,
      maxStage: 99, color: 0xffd24a, prestige: true, endgame: true, desc: 'Только для истинных легенд' },
  ];

  class ClothingSystem {
    constructor(game) {
      this.game = game;
      this.owned = new Set(['tshirt_basic', 'pants_basic']);
      this.worn = { shirt: 'tshirt_basic', pants: 'pants_basic' };
      this.tension = {};        // slot -> 0..1 натяжение
      this.ripped = new Set();  // порванные вещи (нужно покупать заново)
      this.meshes = {};
      this.ripCount = 0;
    }

    def(id) { return CLOTHING_CATALOG.find((c) => c.id === id); }

    buy(id) {
      const c = this.def(id);
      if (!c) return false;
      if (this.owned.has(id) && !this.ripped.has(id)) {
        this.game.notify('👕 Это уже есть в гардеробе.', 'warn');
        return false;
      }
      if (!this.game.inv.spend(c.price)) {
        this.game.notify(`🪙 Не хватает монет (${c.price}).`, 'warn');
        this.game.audio.ui('err');
        return false;
      }
      this.owned.add(id);
      this.ripped.delete(id);
      this.wear(id);
      this.game.notify(`👕 Куплено: ${c.icon} ${c.name}`, 'quest');
      this.game.audio.ui('coin');
      this.game.furry.say(U.pick(['Мне идёт? Правда идёт?', 'Ой, какая мягкая ткань!', 'Спасибо! Мур~']));
      return true;
    }

    wear(id) {
      const c = this.def(id);
      if (!c || !this.owned.has(id) || this.ripped.has(id)) return false;
      this.worn[c.slot] = id;
      this._rebuild();
      return true;
    }

    takeOff(slot) {
      delete this.worn[slot];
      this._rebuild();
    }

    /** Пересборка визуала одежды */
    _rebuild() {
      const f = this.game.furry;
      // Стандартные меши рубашки/шорт управляются FurryEngine, остальное строим тут
      for (const slot of ['sweater', 'pyjama', 'cloak', 'accessory']) {
        if (this.meshes[slot]) { f.root.remove(this.meshes[slot]); this.meshes[slot] = null; }
        const id = this.worn[slot];
        if (!id) continue;
        const c = this.def(id);
        const S = f.species.scale;
        let mesh;
        if (slot === 'cloak') {
          mesh = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.6, 16, 1, true),
            new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.75, side: THREE.DoubleSide }));
          mesh.position.set(0, 1.35 * S, -0.28 * S);
        } else if (slot === 'accessory' && (id === 'crown' || id === 'bowtie')) {
          mesh = new THREE.Mesh(
            id === 'crown' ? new THREE.CylinderGeometry(0.19, 0.22, 0.16, 8)
              : new THREE.TorusGeometry(0.07, 0.03, 6, 12),
            new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.25, metalness: 0.7,
              emissive: id === 'crown' ? 0x664400 : 0x000000 }));
          mesh.position.set(0, id === 'crown' ? 2.28 * S : 1.82 * S, id === 'crown' ? 0 : 0.16 * S);
        } else if (slot === 'accessory' && id === 'scarf') {
          mesh = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 8, 18),
            new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.95 }));
          mesh.rotation.x = Math.PI / 2;
          mesh.position.set(0, 1.78 * S, 0.02 * S);
        } else if (slot === 'accessory' && id === 'apron_chef') {
          mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.8),
            new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.9, side: THREE.DoubleSide }));
          mesh.position.set(0, 1.15 * S, 0.42 * S);
        } else {
          // Свитер / пижама — оболочка торса
          mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18),
            new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.95,
              side: THREE.DoubleSide, transparent: true }));
          mesh.scale.set(0.5 * S, 0.56 * S, 0.44 * S);
          mesh.position.set(0, 1.3 * S, 0.02 * S);
        }
        mesh.castShadow = true;
        mesh.userData.slot = slot;
        f.root.add(mesh);
        this.meshes[slot] = mesh;
      }
    }

    /** Натяжение и разрыв по мере роста */
    update(dt) {
      const f = this.game.furry;
      const stage = f.stage;
      const belly = f.nodeById.mid_belly.growth;
      const chest = (f.nodeById.left_moob.growth + f.nodeById.right_moob.growth) * 0.5;
      const glute = (f.nodeById.lower_left_glute.growth + f.nodeById.lower_right_glute.growth) * 0.5;

      for (const [slot, id] of Object.entries(this.worn)) {
        const c = this.def(id);
        if (!c) continue;
        // Натяжение = насколько стадия превысила запас вещи
        const over = stage - c.maxStage;
        const growFactor = slot === 'pants' ? glute : slot === 'shirt' || slot === 'sweater' ? Math.max(belly, chest) : belly;
        let t = U.clamp(over / 1.6 + growFactor * 0.28, 0, 1.4);
        if (c.elastic) t *= 0.45;   // эластичное тянется вдвое дольше
        this.tension[slot] = t;

        // Визуал натяжения: масштаб и прозрачность
        const m = this.meshes[slot];
        if (m && m.scale) {
          const S = f.species.scale;
          const stretch = 1 + growFactor * (c.elastic ? 0.95 : 0.55);
          if (slot === 'sweater' || slot === 'pyjama') {
            m.scale.set(0.5 * S * stretch, 0.56 * S * (1 + growFactor * 0.25), 0.44 * S * stretch);
            m.position.y = (1.3 + belly * 0.22) * S;
          }
          if (m.material) m.material.opacity = U.clamp(1 - Math.max(0, t - 0.8) * 2, 0.15, 1);
        }

        // РАЗРЫВ
        if (t >= 1.0 && !this.ripped.has(id)) this.rip(slot, id);
      }
    }

    rip(slot, id) {
      const c = this.def(id);
      this.ripped.add(id);
      delete this.worn[slot];
      this.ripCount++;
      if (this.meshes[slot]) { this.game.furry.root.remove(this.meshes[slot]); this.meshes[slot] = null; }
      this.game.audio.rip();
      this.game.notify(`💥 ${c.icon} ${c.name} — ПОРВАЛАСЬ! Друг вырос из неё.`, 'warn');
      this.game.furry.say(U.pick([
        'Ой! Она... она лопнула! Мне неловко~',
        'Хи-хи, я слишком большой для неё стал!',
        'Прости! Я не специально...',
      ]));
      this.game.furry.blush = 1;
      this.game.furry.setEmotion('shy', 4);
      if (this.ripCount >= 10) this.game.achieve('wardrobe_destroyer');
      if (this.ripCount >= 1) this.game.achieve('first_rip');
    }

    /** Суммарные бонусы от надетого */
    bonuses() {
      const b = { cook: 0, warm: false, comfy: false, prestige: false };
      for (const id of Object.values(this.worn)) {
        const c = this.def(id);
        if (!c) continue;
        if (c.cookBonus) b.cook += c.cookBonus;
        if (c.warm) b.warm = true;
        if (c.comfy) b.comfy = true;
        if (c.prestige) b.prestige = true;
      }
      return b;
    }

    catalog() { return CLOTHING_CATALOG; }

    serialize() {
      return { owned: [...this.owned], worn: this.worn, ripped: [...this.ripped], ripCount: this.ripCount };
    }
    deserialize(d) {
      if (!d) return;
      this.owned = new Set(d.owned || ['tshirt_basic', 'pants_basic']);
      this.worn = d.worn || {};
      this.ripped = new Set(d.ripped || []);
      this.ripCount = d.ripCount || 0;
      this._rebuild();
    }
  }

  /* ============================================================
   * 2. СИСТЕМА ПОГОДЫ
   * ============================================================ */
  const WEATHER_TYPES = {
    clear:   { name: 'Ясно', icon: '☀️', mood: 0.02, slip: 0, fog: 0.0038 },
    cloudy:  { name: 'Облачно', icon: '☁️', mood: 0, slip: 0, fog: 0.0055 },
    rain:    { name: 'Дождь', icon: '🌧', mood: -0.01, slip: 0.55, fog: 0.009, wet: true },
    storm:   { name: 'Гроза', icon: '⛈', mood: -0.03, slip: 0.75, fog: 0.014, wet: true, lightning: true },
    snow:    { name: 'Снег', icon: '❄️', mood: 0.01, slip: 0.3, fog: 0.011, cold: true },
    fog:     { name: 'Туман', icon: '🌫', mood: -0.005, slip: 0.1, fog: 0.028 },
    rainbow: { name: 'Радуга', icon: '🌈', mood: 0.06, slip: 0.1, fog: 0.004, bonus: true },
  };

  class WeatherSystem {
    constructor(game) {
      this.game = game;
      this.current = 'clear';
      this.next = 'clear';
      this.transition = 1;
      this.timer = 0;
      this.duration = 300;
      this.puddles = [];
      this.rainbowMesh = null;
      this.lightningTimer = 0;
    }

    /** Смена погоды с учётом сезона (день игры) */
    roll() {
      const season = Math.floor(this.game.day / 14) % 4;   // 0 весна, 1 лето, 2 осень, 3 зима
      const table = [
        ['clear', 'clear', 'cloudy', 'rain', 'rainbow'],              // весна
        ['clear', 'clear', 'clear', 'cloudy', 'storm'],               // лето
        ['cloudy', 'rain', 'rain', 'fog', 'clear'],                   // осень
        ['snow', 'snow', 'cloudy', 'clear', 'fog'],                   // зима
      ][season];
      let pick = U.pick(table);
      // Радуга только после дождя
      if (pick === 'rainbow' && this.current !== 'rain') pick = 'clear';
      this.set(pick);
      return pick;
    }

    set(type) {
      if (!WEATHER_TYPES[type]) return;
      this.next = type;
      this.transition = 0;
      this.timer = 0;
      this.duration = U.rand(240, 600);
      const w = WEATHER_TYPES[type];
      this.game.notify(`${w.icon} Погода: ${w.name}`, 'info');
      this.game.world.setWeather(type === 'storm' ? 'rain' : type === 'fog' || type === 'cloudy' || type === 'rainbow' ? 'clear' : type);
      if (w.wet) this._makePuddles();
      if (type === 'rainbow') this._makeRainbow();
      else this._removeRainbow();
    }

    _makePuddles() {
      if (this.puddles.length) return;
      // Шоколадные лужи после дождя — как в ТЗ
      for (let i = 0; i < 14; i++) {
        const x = U.rand(-70, 70), z = U.rand(-70, 70);
        const p = new THREE.Mesh(
          new THREE.CircleGeometry(U.rand(0.8, 2.6), 14),
          new THREE.MeshStandardMaterial({ color: 0x5c3317, roughness: 0.06, metalness: 0.3,
            transparent: true, opacity: 0.85 }));
        p.rotation.x = -Math.PI / 2;
        p.position.set(x, this.game.world.heightAt(x, z) + 0.06, z);
        this.game.scene.add(p);
        this.puddles.push(p);
      }
      this.game.notify('🍫 На улицах появились шоколадные лужи!', 'info');
    }

    _clearPuddles() {
      for (const p of this.puddles) this.game.scene.remove(p);
      this.puddles.length = 0;
    }

    _makeRainbow() {
      if (this.rainbowMesh) return;
      const g = new THREE.Group();
      const colors = [0xff0000, 0xff8800, 0xffff00, 0x00cc44, 0x0088ff, 0x4400cc, 0x8800cc];
      colors.forEach((c, i) => {
        const arc = new THREE.Mesh(
          new THREE.TorusGeometry(60 - i * 2.2, 1.05, 6, 40, Math.PI),
          new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
        arc.position.set(0, 0, -90);
        g.add(arc);
      });
      this.game.scene.add(g);
      this.rainbowMesh = g;
      this.game.notify('🌈 Радуга! Настроение друга растёт быстрее.', 'quest');
      this.game.achieve('rainbow_seen');
    }

    _removeRainbow() {
      if (this.rainbowMesh) { this.game.scene.remove(this.rainbowMesh); this.rainbowMesh = null; }
    }

    update(dt) {
      this.timer += dt;
      if (this.transition < 1) this.transition = Math.min(1, this.transition + dt * 0.5);
      if (this.transition >= 1) this.current = this.next;

      const w = WEATHER_TYPES[this.current];
      const f = this.game.furry;

      // Влияние на настроение
      f.mood = U.clamp(f.mood + w.mood * dt, 0, 1);
      // Мокрая шёрстка
      if (w.wet) f.wet = Math.min(1, f.wet + dt * 0.12);
      // Холод: без тёплой одежды настроение падает
      if (w.cold) {
        const warm = this.game.clothing && this.game.clothing.bonuses().warm;
        if (!warm) f.mood = U.clamp(f.mood - dt * 0.012, 0, 1);
      }
      // Туман
      if (this.game.scene.fog) {
        this.game.scene.fog.density = U.damp(this.game.scene.fog.density, w.fog, 1.2, dt);
      }
      // Молнии в грозу
      if (w.lightning) {
        this.lightningTimer -= dt;
        if (this.lightningTimer <= 0) {
          this.lightningTimer = U.rand(4, 14);
          this._flash();
        }
      }
      // Смена погоды по таймеру
      if (this.timer > this.duration) this.roll();
    }

    _flash() {
      const l = this.game.world.ambient;
      const orig = l.intensity;
      l.intensity = orig + 2.4;
      setTimeout(() => { l.intensity = orig; }, 90);
      setTimeout(() => { l.intensity = orig + 1.6; }, 160);
      setTimeout(() => { l.intensity = orig; }, 240);
      // Гром с задержкой
      setTimeout(() => {
        this.game.audio.noise({ dur: 1.8, gain: 0.22, filter: 'lowpass', freq: 220, sweepTo: 60 });
      }, U.rand(400, 1600));
      this.game.furry.setEmotion('shy', 3);
      if (Math.random() < 0.4) this.game.furry.say(U.pick(['Ой! Гром... я боюсь~', 'Можно я поближе прижмусь?']));
    }

    /** Коэффициент скольжения для карабканья */
    slipFactor() { return WEATHER_TYPES[this.current].slip; }
    info() { return WEATHER_TYPES[this.current]; }

    serialize() { return { current: this.current, timer: this.timer }; }
    deserialize(d) { if (d && d.current) this.set(d.current); }
  }

  /* ============================================================
   * 3. ФОТО-РЕЖИМ
   * ============================================================ */
  class PhotoSystem {
    constructor(game) {
      this.game = game;
      this.active = false;
      this.filter = 'none';
      this.filters = ['none', 'warm', 'cold', 'sepia', 'vivid', 'noir'];
      this.filterIndex = 0;
      this.album = [];
      this.freeCam = false;
      this.savedPos = null;
    }

    toggle() {
      this.active = !this.active;
      const ui = document.getElementById('ui');
      if (ui) ui.style.opacity = this.active ? '0' : '1';
      if (this.active) {
        this.savedPos = this.game.player.pos.clone();
        this.game.notify('📷 Фото-режим: F2 — снимок, стрелки — фильтр, P — выход', 'info');
      } else {
        this.game.notify('📷 Выход из фото-режима', 'info');
      }
      return this.active;
    }

    cycleFilter(dir) {
      this.filterIndex = (this.filterIndex + dir + this.filters.length) % this.filters.length;
      this.filter = this.filters[this.filterIndex];
      this.game.notify(`🎨 Фильтр: ${this.filter}`, 'info');
      this._applyFilter();
    }

    _applyFilter() {
      const r = this.game.renderer;
      const presets = {
        none: { exposure: 1.06, tone: THREE.ACESFilmicToneMapping },
        warm: { exposure: 1.22, tone: THREE.ACESFilmicToneMapping },
        cold: { exposure: 0.92, tone: THREE.ACESFilmicToneMapping },
        sepia: { exposure: 1.0, tone: THREE.LinearToneMapping },
        vivid: { exposure: 1.35, tone: THREE.ReinhardToneMapping },
        noir: { exposure: 0.85, tone: THREE.LinearToneMapping },
      };
      const p = presets[this.filter] || presets.none;
      r.toneMappingExposure = p.exposure;
      r.toneMapping = p.tone;
    }

    capture() {
      const g = this.game;
      g.render();
      const url = g.canvas.toDataURL('image/png');
      this.album.push({ time: g.gameHours, day: g.day, stage: g.furry.stage, filter: this.filter });
      const a = document.createElement('a');
      a.href = url;
      a.download = `fatfriend_day${g.day}_${Date.now()}.png`;
      a.click();
      g.photos = (g.photos || 0) + 1;
      if (g.photos >= 20) g.achieve('photographer');
      if (g.photos >= 1) g.achieve('first_photo');
      g.audio.ui('ok');
      g.notify(`📷 Снимок сохранён! (всего: ${g.photos})`, 'info');
      // Друг позирует
      g.furry.setEmotion('happy', 3);
      g.furry.say(U.pick(['Я хорошо получился?', 'Мур~ фотографируй ещё!', '*позирует*']));
    }
  }

  /* ============================================================
   * 4. ТРЕКЕР СТАТИСТИКИ
   * ============================================================ */
  class StatsTracker {
    constructor(game) {
      this.game = game;
      this.data = {
        totalCaloriesFed: 0,
        totalCoinsEarned: 0,
        totalCoinsSpent: 0,
        distanceWalked: 0,
        distanceClimbed: 0,
        timePlayed: 0,
        timeOnBelly: 0,
        timeUnderBelly: 0,
        pokes: 0, slaps: 0, massageTime: 0,
        foodsCooked: 0, elixirsBrewed: 0,
        biggestMeal: 0, biggestMealName: '',
        fastestStage: {},
        npcTalks: {},
        zoneRecords: {},
      };
      this._lastPos = null;
    }

    update(dt) {
      const g = this.game;
      this.data.timePlayed += dt;
      if (g.player.mode === 'onbelly') this.data.timeOnBelly += dt;
      if (g.player.mode === 'underbelly') this.data.timeUnderBelly += dt;
      if (g.player.climbing) {
        if (this._lastPos) this.data.distanceClimbed += Math.abs(g.player.pos.y - this._lastPos.y);
      } else if (this._lastPos) {
        this.data.distanceWalked += Math.hypot(
          g.player.pos.x - this._lastPos.x, g.player.pos.z - this._lastPos.z);
      }
      this._lastPos = g.player.pos.clone();
    }

    recordMeal(name, cal) {
      this.data.totalCaloriesFed += cal;
      if (cal > this.data.biggestMeal) {
        this.data.biggestMeal = cal;
        this.data.biggestMealName = name;
      }
    }
    recordStage(stage, day) {
      if (!this.data.fastestStage[stage]) this.data.fastestStage[stage] = day;
    }
    recordTalk(npcId) {
      this.data.npcTalks[npcId] = (this.data.npcTalks[npcId] || 0) + 1;
    }

    /** Топ-5 самых выросших зон */
    topZones() {
      return this.game.furry.nodes
        .map((n) => ({ name: n.zone.name, g: n.growth }))
        .sort((a, b) => b.g - a.g).slice(0, 5);
    }

    serialize() { return this.data; }
    deserialize(d) { if (d) Object.assign(this.data, d); }
  }

  /* ============================================================
   * 5. ДНЕВНИК
   * ============================================================ */
  class NotebookSystem {
    constructor(game) {
      this.game = game;
      this.entries = [];
      this.maxEntries = 120;
    }

    add(text, kind) {
      const g = this.game;
      this.entries.push({
        day: g.day, time: U.fmtTime(g.gameHours), text, kind: kind || 'note',
      });
      while (this.entries.length > this.maxEntries) this.entries.shift();
    }

    /** Автозаписи о важных событиях */
    onStage(stage) {
      const names = FF.CONFIG.growth.stageNames;
      const texts = [
        'Сегодня мы начали наш путь. Он такой маленький и мягкий.',
        'Он стал заметно круглее. Уже не помещается в старую футболку.',
        'Пухляш! Живот начал свисать. Он смущается, но я вижу — ему нравится.',
        'Ходит медленнее. Складки стали настоящими, глубокими.',
        'Толстяк. Теперь он занимает весь диван. Обнимать стало приятнее.',
        'Ему тяжело вставать. Артём говорит — пора думать об эликсирах.',
        'Громадина. Он больше не проходит в дверь кафе. Ели на улице.',
        'Гигант. Под его животом теперь можно спрятаться от дождя.',
        'Колосс. Люди приходят посмотреть. Он гордится, я вижу.',
        'ИМБА. Он превзошёл всё, что описывал прадед Артёма.',
        'Легенда Sugar City. Мы сделали это. Вместе.',
      ];
      this.add(`📈 Стадия ${stage}: «${names[stage]}». ${texts[stage] || ''}`, 'stage');
    }

    onFirstVisit(locName) { this.add(`📍 Впервые побывали здесь: ${locName}.`, 'place'); }
    onQuest(name) { this.add(`✅ Выполнено задание: «${name}».`, 'quest'); }
    onRip(item) { this.add(`💥 ${item} не выдержала. Пора за новой.`, 'clothes'); }
    onStory(title) { this.add(`📖 Артём рассказал: «${title}».`, 'story'); }

    serialize() { return this.entries; }
    deserialize(d) { if (Array.isArray(d)) this.entries = d; }
  }

  FF.CLOTHING_CATALOG = CLOTHING_CATALOG;
  FF.ClothingSystem = ClothingSystem;
  FF.WEATHER_TYPES = WEATHER_TYPES;
  FF.WeatherSystem = WeatherSystem;
  FF.PhotoSystem = PhotoSystem;
  FF.StatsTracker = StatsTracker;
  FF.NotebookSystem = NotebookSystem;
})(typeof window !== 'undefined' ? window : globalThis);
