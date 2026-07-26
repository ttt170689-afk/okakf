/**
 * gameplay.js — Игровые системы
 * Инвентарь, экономика, крафт, эликсиры, квесты, достижения,
 * диалоги NPC (включая Артёма), мини-игры, такси.
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  /* ============================================================
   * ИНВЕНТАРЬ И ЭКОНОМИКА
   * ============================================================ */
  class Inventory {
    constructor() {
      this.items = {};        // id -> count (еда и ингредиенты)
      this.elixirs = {};      // id -> count
      this.coins = FF.CONFIG.economy.startCoins;
      this.recipesKnown = new Set(FF.RECIPES.filter((r) => r.level <= 8).map((r) => r.out));
      this.elixirRecipes = new Set(['small']);
      this.level = 1;
      this.xp = 0;
      this.selected = null;
    }
    add(id, n = 1) {
      this.items[id] = (this.items[id] || 0) + n;
      if (!this.selected) this.selected = id;
      return this.items[id];
    }
    remove(id, n = 1) {
      if ((this.items[id] || 0) < n) return false;
      this.items[id] -= n;
      if (this.items[id] <= 0) { delete this.items[id]; if (this.selected === id) this.selected = Object.keys(this.items)[0] || null; }
      return true;
    }
    has(id, n = 1) { return (this.items[id] || 0) >= n; }
    count(id) { return this.items[id] || 0; }
    addCoins(n) { this.coins += n; }
    spend(n) { if (this.coins < n) return false; this.coins -= n; return true; }
    addXP(n) {
      this.xp += n;
      const need = () => this.level * 40;
      while (this.xp >= need()) { this.xp -= need(); this.level++; this._onLevel(); }
    }
    _onLevel() {
      FF.Game && FF.Game.notify(`⭐ Уровень повара: ${this.level}!`, 'stage');
      for (const r of FF.RECIPES) if (r.level <= this.level && !this.recipesKnown.has(r.out)) {
        this.recipesKnown.add(r.out);
        const f = FF.FOOD_BY_ID[r.out];
        if (f) FF.Game.notify(`📖 Новый рецепт: ${f.name}`, 'info');
      }
    }
    foodList() {
      return Object.keys(this.items).filter((id) => FF.FOOD_BY_ID[id]);
    }
    ingList() {
      return Object.keys(this.items).filter((id) => FF.ING_BY_ID[id]);
    }
    serialize() {
      return { items: this.items, elixirs: this.elixirs, coins: this.coins, level: this.level, xp: this.xp,
        recipes: [...this.recipesKnown], elixirRecipes: [...this.elixirRecipes] };
    }
    deserialize(d) {
      if (!d) return;
      this.items = d.items || {}; this.elixirs = d.elixirs || {};
      this.coins = d.coins != null ? d.coins : 45;
      this.level = d.level || 1; this.xp = d.xp || 0;
      if (d.recipes) this.recipesKnown = new Set(d.recipes);
      if (d.elixirRecipes) this.elixirRecipes = new Set(d.elixirRecipes);
      this.selected = Object.keys(this.items)[0] || null;
    }
  }

  /* ============================================================
   * КВЕСТЫ
   * ============================================================ */
  class QuestSystem {
    constructor(game) {
      this.game = game;
      this.active = [];      // {id, progress}
      this.done = new Set();
      this.available = new Set(['q_intro']);
      this.counters = {};    // произвольные счётчики целей
    }
    def(id) { return FF.QUESTS.find((q) => q.id === id); }

    offer(npcId) {
      // Квесты этого NPC, которые ещё не взяты и не выполнены
      return FF.QUESTS.filter((q) => q.npc === npcId && !this.done.has(q.id) && !this.active.find((a) => a.id === q.id));
    }
    accept(id) {
      if (this.active.find((a) => a.id === id) || this.done.has(id)) return;
      this.active.push({ id, progress: 0 });
      const q = this.def(id);
      this.game.notify(`📜 Новое задание: «${q.name}»`, 'quest');
      this.game.audio.ui('quest');
    }
    /** Событие для продвижения квестов */
    event(type, data) {
      this.counters[type + ':' + (data && data.id ? data.id : '')] =
        (this.counters[type + ':' + (data && data.id ? data.id : '')] || 0) + (data && data.n ? data.n : 1);
      for (const a of [...this.active]) {
        const q = this.def(a.id);
        if (!q) continue;
        const g = q.goal;
        let complete = false;
        if (g.visit && type === 'visit' && data.id === g.visit) complete = true;
        if (g.talk && type === 'talk' && data.id === g.talk) complete = true;
        if (g.minigame && type === 'minigame' && data.id === g.minigame) complete = true;
        if (g.item && type === 'inventory') {
          complete = this.game.inv.count(g.item) >= (g.count || 1);
        }
        if (g.feed && type === 'feed' && data.id === g.feed) {
          a.progress++;
          complete = a.progress >= (g.count || 1);
        }
        if (g.stage && type === 'stage' && data.n >= g.stage) complete = true;
        if (g.craft && type === 'craft' && data.id === g.craft) complete = true;
        if (g.craftPerfect && type === 'craftPerfect') complete = true;
        if (g.relation && type === 'relation' && data.n >= g.relation) complete = true;
        if (g.read && type === 'read') { a.progress++; complete = a.progress >= g.read; }
        if (g.secret && type === 'secret' && data.id === g.secret) complete = true;
        if (complete) this.complete(a.id);
      }
    }
    complete(id) {
      const idx = this.active.findIndex((a) => a.id === id);
      if (idx < 0) return;
      const q = this.def(id);
      // Забираем предметы-цели
      if (q.goal.item) this.game.inv.remove(q.goal.item, q.goal.count || 1);
      this.active.splice(idx, 1);
      this.done.add(id);
      const r = q.reward || {};
      let msg = `✅ Задание выполнено: «${q.name}»`;
      if (r.coins) { this.game.inv.addCoins(r.coins); msg += ` +${r.coins}🪙`; }
      if (r.item) { this.game.inv.add(r.item, r.count || 1); msg += ` +${FF.ING_BY_ID[r.item].name}×${r.count || 1}`; }
      if (r.food) { this.game.inv.add(r.food, 1); msg += ` +${FF.FOOD_BY_ID[r.food].name}`; }
      if (r.elixir) { this.game.inv.elixirs[r.elixir] = (this.game.inv.elixirs[r.elixir] || 0) + 1; msg += ` +эликсир`; }
      if (r.recipe) {
        if (FF.ELIXIR_BY_ID[r.recipe]) this.game.inv.elixirRecipes.add(r.recipe);
        else this.game.inv.recipesKnown.add(r.recipe);
        msg += ' +рецепт';
      }
      if (r.secret) this.game.secrets.add(r.secret);
      this.game.notify(msg, 'quest');
      this.game.audio.ui('achieve');
      this.game.inv.addXP(25);
      const total = this.done.size;
      if (total >= 10) this.game.achieve('quests10');
      if (total >= 30) this.game.achieve('quests30');
    }
    serialize() { return { active: this.active, done: [...this.done], counters: this.counters }; }
    deserialize(d) {
      if (!d) return;
      this.active = d.active || []; this.done = new Set(d.done || []); this.counters = d.counters || {};
    }
  }

  /* ============================================================
   * ДИАЛОГИ
   * ============================================================ */
  /* ============================================================
   * МИНИ-ИГРЫ
   * Все построены на едином фреймворке: таймер + действие + оценка
   * ============================================================ */
  const MINIGAMES = {
    cooking: { name: 'Готовка', desc: 'Веди мышью по кругу и удержи темп!', type: 'circle', duration: 12 },
    brew: { name: 'Варка эликсира', desc: 'Помешивай в такт: жми ПРОБЕЛ, когда кольцо совпадает!', type: 'rhythm', duration: 14 },
    milk: { name: 'Дойка коровы', desc: 'Ритмично жми ПРОБЕЛ — не слишком быстро!', type: 'rhythm', duration: 10, reward: { milk: 3 } },
    eggs: { name: 'Сбор яиц', desc: 'Кликай по яйцам, пока курица не смотрит!', type: 'click', duration: 12, reward: { egg: 6 } },
    wool: { name: 'Стрижка овец', desc: 'Веди мышью по шерсти!', type: 'circle', duration: 10, reward: { flour: 0 } },
    honey: { name: 'Сбор мёда', desc: 'Кликай по сотам, избегай пчёл!', type: 'click', duration: 12, reward: { honey: 3 } },
    fishing: { name: 'Рыбалка', desc: 'Жми ПРОБЕЛ в зелёной зоне!', type: 'rhythm', duration: 12, reward: { ice_fish: 1 } },
    dough: { name: 'Замешивание теста', desc: 'Круговые движения мышью!', type: 'circle', duration: 10, reward: { flour: 4 } },
    pump: { name: 'Закачка коктейля', desc: 'Держи давление: жми ПРОБЕЛ в такт!', type: 'rhythm', duration: 14 },
    massage: { name: 'Массаж', desc: 'Плавные круги мышью по телу друга!', type: 'circle', duration: 14 },
    chocobath: { name: 'Шоколадная ванна', desc: 'Кликай по пузырькам!', type: 'click', duration: 12 },
    dance: { name: 'Танцы', desc: 'Жми ПРОБЕЛ в такт музыке!', type: 'rhythm', duration: 16 },
    cafe: { name: 'Работа в кафе', desc: 'Кликай по заказам!', type: 'click', duration: 14 },
    crane: { name: 'Погрузка гиганта', desc: 'Веди ремни мышью, потом жми ПРОБЕЛ!', type: 'circle', duration: 14 },
    dontfall: { name: 'Не упади!', desc: 'Живот трясётся — кликай по центру!', type: 'click', duration: 12 },
    jumper: { name: 'Прыгун', desc: 'Жми ПРОБЕЛ в такт отскокам живота!', type: 'rhythm', duration: 14 },
    mushrooms: { name: 'Сбор грибов', desc: 'Кликай по светящимся грибам!', type: 'click', duration: 12, reward: { glow_mushroom: 3 } },
    moonhunt: { name: 'Охота за лунной росой', desc: 'Лови капли в такт: ПРОБЕЛ!', type: 'rhythm', duration: 14, reward: { moon_dew: 3 } },
    dragonfight: { name: 'Битва с драконом', desc: 'Словесная дуэль: жми ПРОБЕЛ на своей реплике!', type: 'rhythm', duration: 16 },
    puzzle: { name: 'Древняя головоломка', desc: 'Кликай символы в нужном порядке!', type: 'click', duration: 15 },
    busker: { name: 'Дуэт с музыкантом', desc: 'Ритм-игра: ПРОБЕЛ в такт ло-фаю!', type: 'rhythm', duration: 16 },
    push_in: { name: 'Протолкнуть в дверь', desc: 'Жми ПРОБЕЛ в такт — толкай друга внутрь!', type: 'rhythm', duration: 12 },
    winch: { name: 'Лебёдка', desc: 'Крути барабан: веди мышью по кругу!', type: 'circle', duration: 14 },
  };

  /* ============================================================
   * ТАКСИ
   * ============================================================ */
  class TaxiSystem {
    constructor(game) {
      this.game = game;
      this.mesh = null;
      this.active = false;
      this.state = 'idle';   // idle | arriving | waiting | driving
      this.progress = 0;
      this.route = null;
      this.taxiDef = null;
      this.suspension = 0;
      this.suspVel = 0;
      this.usedTypes = new Set();
      this.extraSag = 1;
      this.speedMult = 1;
      this.seatsUsed = 1;
    }

    /** Подходящее такси по стадии фурри */
    pick() {
      const st = this.game.furry.stage;
      let best = FF.TAXIS[0];
      for (const t of FF.TAXIS) if (st >= t.minStage) best = t;
      return best;
    }

    call() {
      if (this.active) { this.game.notify('🚕 Такси уже здесь!', 'info'); return; }
      const def = this.pick();
      if (def.needElixir && !this.game.furry.mobile) {
        this.game.notify('🚚 Ультра-транспорт требует крана. Готовим погрузку...', 'info');
      }
      // Цена растёт с габаритом друга
      const price = this.game.boarding ? this.game.boarding.priceFor(def, this.game.furry.stage) : def.price;
      if (!this.game.inv.spend(price)) {
        this.game.notify(`🪙 Не хватает монет (${price} — надбавка за габарит)`, 'warn'); return;
      }
      if (price > def.price) {
        this.game.notify(`💰 Надбавка за размер: ${def.price} → ${price} 🪙`, 'info');
      }
      this.taxiDef = def;
      this._build(def);
      this.state = 'arriving';
      this.active = true;
      this.progress = 0;
      this.game.notify(`${def.icon} ${def.name} едет! Водитель: ${def.driver}`, 'info');
      this.usedTypes.add(def.id);
      if (this.usedTypes.size >= 4) this.game.achieve('taxi_master');
    }

    _build(def) {
      def = def || this.taxiDef || this.pick();
      this.taxiDef = def;
      if (this.mesh) this.game.scene.remove(this.mesh);
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.45, metalness: 0.35 });
      const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x99ccee, roughness: 0.05, transmission: 0.85,
        thickness: 0.2, transparent: true, opacity: 0.5 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h * 0.55, def.len), bodyMat);
      body.position.y = def.h * 0.55;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.9, def.h * 0.45, def.len * 0.45), glassMat);
      cabin.position.set(0, def.h * 0.9, def.len * 0.2);
      g.add(body, cabin);
      // Платформа для мега/ультра
      if (def.id === 'mega' || def.id === 'ultra') {
        const plat = new THREE.Mesh(new THREE.BoxGeometry(def.w * 1.05, 0.3, def.len * 0.55),
          new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.8 }));
        plat.position.set(0, def.h * 0.85, -def.len * 0.25);
        g.add(plat);
        // Подушки
        for (let i = 0; i < 4; i++) {
          const c = new THREE.Mesh(new THREE.SphereGeometry(def.w * 0.28, 12, 8),
            new THREE.MeshStandardMaterial({ color: 0xf0a0b8, roughness: 1 }));
          c.scale.y = 0.4;
          c.position.set((i % 2 ? 1 : -1) * def.w * 0.25, def.h * 0.95, -def.len * (0.1 + Math.floor(i / 2) * 0.28));
          g.add(c);
        }
      }
      if (def.crane) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, def.len * 0.6),
          new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.5, metalness: 0.5 }));
        arm.position.set(0, def.h * 1.6, 0); arm.rotation.x = 0.2;
        g.add(arm);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, def.h * 1.2, 8),
          new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.5, metalness: 0.5 }));
        post.position.set(0, def.h * 1.1, def.len * 0.28);
        g.add(post);
      }
      // Колёса
      const wheels = def.id === 'ultra' ? 8 : 4;
      this.wheels = [];
      const wr = def.h * 0.3;
      for (let i = 0; i < wheels; i++) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.4, 14),
          new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.9 }));
        w.rotation.z = Math.PI / 2;
        const row = Math.floor(i / 2), side = i % 2 ? 1 : -1;
        w.position.set(side * def.w / 2, wr, def.len * (0.3 - row * (0.6 / Math.max(1, wheels / 2 - 1))));
        g.add(w); this.wheels.push(w);
      }
      // Фары
      for (const s of [-1, 1]) {
        const l = new THREE.PointLight(0xfff0c0, 1.4, 22, 2);
        l.position.set(s * def.w * 0.35, def.h * 0.5, def.len / 2);
        g.add(l);
      }
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.game.scene.add(g);
      this.mesh = g;
      const stop = this.game.world.taxiStop;
      g.position.set(stop.x + 40, 0, stop.z + 40);
    }

    /** Начать поездку в локацию (после посадки) */
    ride(locId) {
      const from = this.mesh.position.clone();
      const to = FF.LOC_BY_ID[locId];
      this.route = { from, to: new THREE.Vector3(to.x, 0, to.z + 8), locId };
      this.state = 'driving';
      this.progress = 0;
      this.game.player.mode = 'ride';
      // Физика салона: друг занимает объём и вытесняет игрока
      if (this.game.cabin) this.game.cabin.enter(this.taxiDef);
      this.game.player.frozen = false;
      this.game.notify(`🚕 Едем: ${to.name}. Наслаждайся видом!`, 'info');
      this.game.furry.setEmotion('content', 8);
      this.game.furry.say(U.pick(['Мур... люблю кататься~', 'Так уютно в машинке...', 'Смотри, город какой красивый!']));
    }

    update(dt) {
      if (!this.active || !this.mesh) return;
      const def = this.taxiDef;
      const stop = this.game.world.taxiStop;
      const furry = this.game.furry;

      // Подвеска проседает под весом
      // Просадка зависит от массы И от таблицы посадки для текущей стадии
      const load = U.clamp(furry.mass / 400, 0, 3) * (this.extraSag || 1);
      const targetSag = -def.susp * load;
      this.suspVel += (targetSag - this.suspension) * 40 * dt;
      this.suspVel *= Math.exp(-6 * dt);
      this.suspension += this.suspVel * dt;

      if (this.state === 'arriving') {
        const target = new THREE.Vector3(stop.x, 0, stop.z);
        this.mesh.position.lerp(target, 1 - Math.exp(-1.8 * dt));
        this.mesh.lookAt(target.clone().add(new THREE.Vector3(0, 0, 1)));
        if (this.mesh.position.distanceTo(target) < 1.2) {
          this.state = 'waiting';
          this.game.notify('🚕 Такси прибыло! Нажми E у машины, чтобы сесть.', 'info');
          this.game.audio.creak();
        }
        if (Math.random() < dt * 6) this.game.audio.engine(load);
      } else if (this.state === 'driving') {
        const spdMult = this.speedMult || 1;
        // Минимум 18 секунд поездки — чтобы прочувствовать тесноту салона
        const travelSec = Math.max(18,
          this.route.from.distanceTo(this.route.to) / (def.speed * spdMult / 3.6) * 0.9);
        this.progress += dt / travelSec;
        const t = U.clamp(this.progress, 0, 1);
        const p = this.route.from.clone().lerp(this.route.to, t);
        // Небольшая дуга маршрута
        p.y = this.game.world.heightAt(p.x, p.z);
        this.mesh.position.copy(p);
        const dir = this.route.to.clone().sub(this.route.from).normalize();
        this.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        // Игрок и фурри едут внутри
        // Позицию игрока внутри салона считает CabinSystem (вытеснение массой).
        // Здесь только фолбэк, если система салона недоступна.
        if (!this.game.cabin || !this.game.cabin.active) {
          const camPos = p.clone().add(new THREE.Vector3(0, def.h * 0.9 + this.suspension, -def.len * 0.1));
          this.game.player.pos.copy(camPos);
          this.game.player.pos.y -= FF.CONFIG.player.eyeHeight;
        }
        // Позицией друга в салоне управляет CabinSystem (он сидит рядом с игроком).
        if (!this.game.cabin || !this.game.cabin.active) {
          furry.root.position.copy(p).add(new THREE.Vector3(0, def.h * 0.85 + this.suspension, -def.len * 0.28));
        }
        // Раскачивание
        this.mesh.rotation.z = Math.sin(performance.now() * 0.002) * 0.02 * load;
        furry.wave(furry.root.position.clone().add(new THREE.Vector3(0, 1, 0)), dt * 1.4);
        if (Math.random() < dt * 8) this.game.audio.engine(load);
        if (Math.random() < dt * 1.5) this.game.audio.creak();
        this.wheels.forEach((w) => (w.rotation.x += dt * 8));
        if (t >= 1) this._arrive();
      }

      // Подвеска визуально
      // Кузов реально проседает под весом
      if (this.mesh) {
        if (this._baseY === undefined) this._baseY = 0;
        this.mesh.children.forEach((c) => {
          if (c.userData.baseY === undefined) c.userData.baseY = c.position.y;
          // Колёса остаются на земле, кузов опускается
          const isWheel = this.wheels && this.wheels.indexOf(c) >= 0;
          if (!isWheel) c.position.y = c.userData.baseY + this.suspension;
        });
        // Крен на поворотах пропорционален загрузке
        const lean = Math.sin(performance.now() * 0.0015) * 0.012 * load;
        this.mesh.rotation.z = U.damp(this.mesh.rotation.z, lean, 4, dt);
      }
    }

    _arrive() {
      if (this.game.cabin) this.game.cabin.leave();
      const loc = FF.LOC_BY_ID[this.route.locId];
      this.state = 'idle';
      this.active = false;
      this.game.player.mode = 'walk';
      this.game.player.teleport(loc.x + 4, loc.z + 10);
      this.game.furry.root.position.set(loc.x - 4, this.game.world.heightAt(loc.x - 4, loc.z + 10), loc.z + 10);
      this.game.notify(`📍 Прибыли: ${loc.name}`, 'info');
      this.game.quests.event('visit', { id: loc.id });
      this.game.visited.add(loc.id);
      if (this.game.visited.size >= FF.LOCATIONS.length) this.game.achieve('traveler');
      if (this.mesh) { this.game.scene.remove(this.mesh); this.mesh = null; }
    }
  }

  FF.Inventory = Inventory;
  FF.QuestSystem = QuestSystem;
  FF.MINIGAMES = MINIGAMES;
  FF.TaxiSystem = TaxiSystem;
})(typeof window !== 'undefined' ? window : globalThis);
