/**
 * game.js — Главный игровой класс.
 * Связывает: рендер, мир, персонажа, игрока, UI, аудио, системы геймплея.
 * Содержит игровой цикл, обработку ввода, взаимодействия, сохранения.
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  class Game {
    constructor(canvas, startOpts) {
      FF.Game = this;
      this.canvas = canvas;
      this.startOpts = startOpts;

      /* ---------- Рендер ---------- */
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, FF.CONFIG.render.pixelRatioCap));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = FF.CONFIG.render.exposure;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      this.scene = new THREE.Scene();
      const R = FF.CONFIG.render;
      this.camera = new THREE.PerspectiveCamera(R.fov, window.innerWidth / window.innerHeight, R.near, R.far);
      this.scene.add(this.camera);

      /* ---------- Аудио ---------- */
      this.audio = new FF.AudioEngine();

      /* ---------- Мир и персонажи ---------- */
      this.world = new FF.World(this.scene, this.renderer, this.audio);
      this.furry = new FF.FurryEngine(this.scene, {
        species: startOpts.species, furColor: startOpts.furColor,
        eyeColor: startOpts.eyeColor, name: startOpts.name,
      }, this.audio);
      this.furry.root.position.set(-58, this.world.heightAt(-58, 70), 70);
      this.player = new FF.PlayerController(this.camera, this.world, this.furry, this.audio);
      this.player.pos.set(-58, this.world.heightAt(-58, 78), 78);

      /* ---------- Системы ---------- */
      this.inv = new FF.Inventory();
      this.quests = new FF.QuestSystem(this);
      this.taxi = new FF.TaxiSystem(this);
      // Физика брошенных предметов (еда падает, отскакивает, застревает в складках)
      this.objects = new FF.ObjectPhysics(this.scene, this.world, this.furry.physics);
      this.boarding = new FF.BoardingSystem(this);
      this.cabin = new FF.CabinSystem(this);
      this.cab = new FF.SugarCabSystem(this);
      this.clothing = new FF.ClothingSystem(this);
      this.weatherSys = new FF.WeatherSystem(this);
      this.photo = new FF.PhotoSystem(this);
      this.statsTracker = new FF.StatsTracker(this);
      this.notebook = new FF.NotebookSystem(this);
      this.homeUpgrades = {};
      this.ui = new FF.UI(this);

      /* ---------- Состояние ---------- */
      this.gameHours = FF.CONFIG.time.startHour;
      this.day = 1;
      this.timeScale = FF.CONFIG.time.minutesPerRealSecond;
      this.weather = 'clear';
      this.achievements = new Set();
      this.visited = new Set(['cottage']);
      this.secrets = new Set();
      this.usedOnce = new Set();
      this.shopStock = {};            // 'loc:item' -> осталось сегодня
      this.currentLoc = null;
      this.photoMode = false;
      this.candyStreak = 0;
      this.pigeonsFed = 0;
      this.photos = 0;
      this.spaCount = 0;
      this.crafted = 0;
      this.brewed = 0;
      this.paused = false;
      this.clock = new THREE.Clock();
      this.fpsSamples = [];
      this.saveTimer = 0;

      this._resetDailyStock();
      this._bindInput();
      this._giveStartingItems();

      window.addEventListener('resize', () => this._onResize());
      this.notify('🌇 Добро пожаловать в Sugar City! Нажми F1 для помощи.', 'info');
      this.notify(`🐾 Знакомься: ${this.furry.opts.name}. Позаботься о нём!`, 'info');
    }

    _giveStartingItems() {
      this.inv.add('donut', 3);
      this.inv.add('cookie', 5);
      this.inv.add('flour', 6);
      this.inv.add('sugar', 5);
      this.inv.add('egg', 4);
      this.inv.add('milk', 3);
      this.inv.add('butter', 2);
      this.inv.selected = 'donut';
    }

    /* ==================== ВВОД ==================== */
    _bindInput() {
      const canvas = this.canvas;
      canvas.addEventListener('click', () => this.requestPointerLock());
      document.addEventListener('pointerlockchange', () => {
        this.pointerLocked = document.pointerLockElement === canvas;
      });
      document.addEventListener('mousemove', (e) => {
        if (this.pointerLocked && !this.ui.minigame) {
          this.player.onMouseMove(e.movementX, e.movementY);
          // Резкие движения помогают выбраться, когда зажало в салоне
          this.player.mouseDX = e.movementX;
          this.player.mouseDY = e.movementY;
        }
      });
      canvas.addEventListener('mousedown', (e) => {
        if (!this.pointerLocked) return;
        this.audio.init(); this.audio.resume();
        this.player.onMouseDown(e.button);
      });
      canvas.addEventListener('mouseup', (e) => this.player.onMouseUp(e.button));
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      canvas.addEventListener('wheel', (e) => {
        const list = [...this.inv.foodList(), ...this.inv.ingList()];
        if (!list.length) return;
        let i = list.indexOf(this.inv.selected);
        i = (i + (e.deltaY > 0 ? 1 : -1) + list.length) % list.length;
        this.inv.selected = list[i];
      }, { passive: true });

      window.addEventListener('keydown', (e) => {
        this.audio.init();
        if (this.ui.minigame) { this.ui.mgKey(e.code, true); e.preventDefault(); return; }
        if (['F1','F2','F4','F5','F9','Tab'].includes(e.code)) e.preventDefault();
        this.player.onKey(e.code, true);
        this._handleHotkey(e.code, e);
      });
      window.addEventListener('keyup', (e) => {
        this.player.onKey(e.code, false);
        if (this.ui.minigame) this.ui.mgKey(e.code, false);
      });
    }

    requestPointerLock() {
      if (this.ui.panelOpen || this.ui.minigame) return;
      this.canvas.requestPointerLock && this.canvas.requestPointerLock();
    }

    _handleHotkey(code, e) {
      const ui = this.ui;
      switch (code) {
        case 'Escape': case 'KeyM':
          if (ui.panelOpen) ui.close(); else ui.open('menu');
          break;
        case 'KeyI': ui.toggle('inventory'); break;
        case 'Tab': ui.toggle('map'); break;
        case 'KeyK': ui.toggle('quests'); break;
        case 'KeyL': ui.toggle('stats'); break;
        case 'F1': ui.toggle('help'); break;
        case 'F4': ui.toggle('money'); break;
        case 'KeyE': this._interact(); break;
        case 'KeyF': this._feedSelected(); break;
        case 'KeyQ': this._cycleItem(); break;
        case 'KeyG': this._throwFood(); break;
        case 'KeyY': this._callFurry(); break;   // зов / отмена следования
        case 'ArrowLeft': if (this.photo.active) this.photo.cycleFilter(-1); break;
        case 'ArrowRight': if (this.photo.active) this.photo.cycleFilter(1); break;
        case 'KeyJ': this.ui.toggle('notebook'); break;
        case 'KeyO': this.ui.toggle('wardrobe'); break;
        case 'KeyR': if (this.cabin.active) this.cabin.reposition(); break;
        case 'F3': {
          const on = this.furry.physics.toggleDebug(this.scene);
          this.notify(`🔬 Отладка коллайдеров: ${on ? 'ВКЛ — видно все 60 эллипсоидов' : 'выкл'}`, 'info');
          break;
        }
        case 'Space':
          if (this.cab.state === 'boarding') { this.cab.tapHelp(); }
          break;
        case 'KeyN':
          if (this.player.mode === 'onbelly') this.startMinigame(U.pick(['jumper', 'dontfall']));
          else this.notify('🏔️ Эти игры работают только НА животе друга.', 'warn');
          break;
        case 'KeyT': this.cab.call(); break;
        case 'KeyH': this._fastTravel('cottage'); break;
        case 'KeyU': this._fastTravel('lab'); break;
        case 'KeyC': if (this._near('craft')) ui.toggle('craft'); else this.notify('🍳 Крафт доступен на кухне дома.', 'warn'); break;
        case 'KeyB': if (this._near('brew')) ui.toggle('brew'); else ui.toggle('boarding'); break;
        case 'KeyP': this._togglePhoto(); break;
        case 'F2': this._screenshot(); break;
        case 'F5': this.save(); break;
        case 'F9': this.load(); break;
        default:
          if (/^Digit[1-9]$/.test(code)) {
            const list = this.inv.foodList();
            const i = parseInt(code.slice(5)) - 1;
            if (list[i]) { this.inv.selected = list[i]; this.audio.ui('click'); }
          }
      }
    }

    _cycleItem() {
      const list = [...this.inv.foodList(), ...this.inv.ingList()];
      if (!list.length) return;
      let i = list.indexOf(this.inv.selected);
      this.inv.selected = list[(i + 1) % list.length];
      this.audio.ui('click');
    }

    /* ==================== ВЗАИМОДЕЙСТВИЕ ==================== */
    _nearest(maxD) {
      let best = null, bd = Infinity;
      for (const it of this.world.interactables) {
        const d = it.pos.distanceTo(this.player.pos);
        if (d < (it.radius || 3) && d < bd) { bd = d; best = it; }
      }
      // Пикапы
      for (const p of this.world.pickups) {
        if (p.taken || !p.mesh.visible) continue;
        const d = p.mesh.position.distanceTo(this.player.pos);
        if (d < 2.4 && d < bd) { bd = d; best = { id: 'pickup', pickup: p, label: `Собрать: ${p.name}`, action: 'pickup', pos: p.mesh.position }; }
      }
      // Такси
      if (this.cab.state === 'waiting' && this.cab.mesh) {
        const d = this.cab.mesh.position.distanceTo(this.player.pos);
        if (d < 8 && d < bd) {
          bd = d;
          best = { id: 'cab_board', label: '🚕 Sugar Cab: выбрать маршрут', action: 'board', pos: this.cab.mesh.position };
        }
      }
      return best;
    }

    _near(id) {
      const it = this.world.interactables.find((i) => i.id === id);
      return it && it.pos.distanceTo(this.player.pos) < (it.radius || 3);
    }

    _interact() {
      // Sugar Cab: выбор маршрута / отдых в пути
      if (this.cab.state === 'waiting') { this._cabDestinations(); return; }
      if (this.cab.state === 'riding') { this.cab.tryRest(); return; }
      // Сначала — поднять лежащую рядом еду
      const picked = this.objects.pickup(this.player.pos.clone().add(new THREE.Vector3(0, 1, 0)), 2.4);
      if (picked) {
        this.inv.add(picked, 1);
        const fd = FF.FOOD_BY_ID[picked];
        this.notify(`✚ Поднял ${fd.icon} ${fd.name}`, 'info');
        this.audio.ui('coin');
        return;
      }
      const it = this._nearest();
      if (!it) { this.notify('Нечего использовать рядом.', 'warn'); return; }
      this.doAction(it);
    }

    tryWorldInteract(point) {
      const it = this._nearest();
      if (it) this.doAction(it);
    }

    doAction(it) {
      const A = it.action;
      this.audio.ui('open');
      switch (A) {
        case 'pickup': {
          const p = it.pickup;
          p.taken = true; p.mesh.visible = false; p.respawn = U.rand(120, 300);
          this.inv.add(p.item, 1);
          this.notify(`✚ ${p.name}`, 'info');
          this.audio.ui('coin');
          this.quests.event('inventory', { id: p.item });
          break;
        }
        case 'shop': case 'shop_ing': this.ui.open('shop', it); break;
        case 'craft': this.ui.open('craft'); break;
        case 'brew': this.ui.open('brew'); break;
        case 'storage': this.ui.open('inventory'); break;
        case 'talk': {
          const npc = FF.NPCS.find((n) => n.id === it.npc);
          if (!npc) return;
          this.quests.event('talk', { id: npc.id });
          if (npc.id === 'artyom' && !this.metArtyom) {
            this.metArtyom = true;
            this.quests.accept('q_mushrooms');
          }
          this.ui.open('dialogue', { npc });
          break;
        }
        case 'minigame': this.startMinigame(it.game, it); break;
        case 'taxi': this.cab.call(); break;
        case 'board': this._cabDestinations(); break;
        case 'mill': this._mill(); break;
        case 'spa': this._spa(); break;
        case 'library': this._library(); break;
        case 'bank': this._bank(); break;
        case 'clothes': this._clothes(); break;
        case 'furniture': this._furniture(); break;
        case 'club': this._club(); break;
        case 'mail': this._mail(); break;
        case 'sleep': this.skipTime(2); break;
        case 'sleep_night': this._sleepNight(); break;
        case 'rest': this.player.stamina = FF.CONFIG.player.maxStamina; this.notify('😌 Отдохнул. Стамина восстановлена.', 'info'); break;
        case 'bath': this._bath(); break;
        case 'fountain': case 'fountain_cup': this._fountainCup(); break;
        case 'ducks': this._feedBirds('уток'); break;
        case 'picnic': this._picnic(); break;
        case 'wish': this._wishTree(); break;
        case 'restore': this.player.stamina = FF.CONFIG.player.maxStamina; this.furry.mood = 1;
          this.notify('🌈 Радужный водопад: силы и настроение восстановлены!', 'info'); break;
        case 'peak': this._peak(); break;
        case 'dragon': this._dragon(); break;
        case 'lighthouse': this._lighthouse(); break;
        case 'night_guard': this._nightGuard(); break;
        case 'secret_shop': this._secretShop(); break;
        default: this.notify('Здесь пока ничего нет.', 'warn');
      }
    }

    /* ==================== КОРМЛЕНИЕ ==================== */
    _feedSelected() {
      const id = this.inv.selected;
      const f = FF.FOOD_BY_ID[id];
      if (!f) { this.notify('🍽 Выбери еду (Q или инвентарь).', 'warn'); return; }
      const d = this.player.pos.distanceTo(this.furry.root.position);
      const maxD = 3.5 + this.furry.stage * 0.6;
      if (d > maxD && this.player.mode === 'walk') { this.notify('🐾 Подойди ближе к другу!', 'warn'); return; }
      if (!this.inv.remove(id, 1)) return;
      const gained = this.furry.feed(f.cal, id);
      this.notify(`🍽 ${f.icon} ${f.name}: +${U.fmt(gained)} кал`, 'feed');
      this.inv.addXP(Math.min(20, f.cal * 0.4));
      this.quests.event('feed', { id });
      this.quests.event('stage', { n: this.furry.stage });
      this.quests.event('relation', { n: this.furry.relation });
      this.achieve('first_bite');
      this.statsTracker.recordMeal(f.name, gained);
      if (f.legendary) this.achieve('legendary_food');
      if (Object.keys(this.furry.stats.foodsTried).length >= FF.FOOD.length - 4) this.achieve('gourmet');
      // Пасхалка: 100 конфет подряд
      if (id === 'candy') {
        this.candyStreak++;
        if (this.candyStreak >= 100) { this.achieve('rainbow_furry'); this._rainbowFurry(); }
      } else this.candyStreak = 0;
    }

    _rainbowFurry() {
      this.notify('🌈 ЧТО?! Твой друг стал РАДУЖНЫМ!', 'stage');
      this._rainbow = true;
    }

    /** Выбор пункта назначения для Sugar Cab */
    _cabDestinations() {
      const cls = this.cab.rideClass();
      const fit = cls.fit;
      const occ = Math.round(U.clamp(fit.volumeFit, 0, 1.3) * 100);
      const notes = {
        normal: 'Места достаточно, друг сядет спокойно.',
        tight: 'Тесно: друг будет заходить боком, диван сожмётся.',
        phased: 'Салон почти занят — посадка в 6 фаз, понадобится твоя помощь.',
        cocoon: 'Сзади почти нет места. В пути можно отдохнуть на переднем кресле.',
      };
      const locs = FF.LOCATIONS.filter((l) => !l.locked || this.furry.stage >= 7);
      this.ui.open('actions', {
        title: `🚕 ${FF.CAB.name}`,
        sub: `Задний диван будет занят на ${occ}% · ${notes[cls.id] || ''}`,
        actions: locs.map((l) => ({ act: 'cab_go', id: l.id, label: `📍 ${l.name}` }))
          .concat([{ act: 'close', label: 'Не сейчас' }]),
      });
    }

    /** Бросить выбранную еду — она физически летит, отскакивает и может застрять в складке */
    _throwFood() {
      const id = this.inv.selected;
      const f = FF.FOOD_BY_ID[id];
      if (!f) { this.notify('🍽 Выбери еду, чтобы бросить (Q).', 'warn'); return; }
      if (!this.inv.remove(id, 1)) return;
      const origin = this.camera.getWorldPosition(new THREE.Vector3());
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      origin.addScaledVector(dir, 0.6);
      const vel = dir.multiplyScalar(9.5).add(new THREE.Vector3(0, 2.2, 0));
      this.objects.spawn(id, origin, vel);
      this.audio.ui('click');
      this.notify(`🫳 Бросил ${f.icon} ${f.name}`, 'info');
    }

    /**
     * ЗОВ ДРУГА (клавиша Y).
     * Переключает режим следования: друг идёт за игроком, пока не отменишь.
     * Диалогов нет — обратная связь через свист, эмоции и HUD.
     */
    _callFurry() {
      const f = this.furry;

      // Уже идёт — отменяем
      if (this.furryFollow) {
        this.furryFollow = false;
        this.furryWalkTarget = null;
        this.notify('🐾 Друг остановился и ждёт здесь.', 'info');
        f.setEmotion('content', 3);
        this.audio.ui('click');
        return;
      }

      // Свист — слышно даже издалека
      this._whistle();

      if (!f.mobile) {
        this.notify('🛑 Друг не может двигаться — нужен эликсир Артёма!', 'warn');
        f.setEmotion('sad', 4);
        this.audio.voice('sad', f.opts.species);
        return;
      }

      const dist = f.root.position.distanceTo(this.player.pos);
      if (dist < 3.5) {
        this.notify('🐾 Друг уже рядом.', 'info');
        f.setEmotion('happy', 2.5);
        this.audio.voice('happy', f.opts.species);
        return;
      }

      this.furryFollow = true;
      f.setEmotion('happy', 4);
      this.audio.voice('happy', f.opts.species);
      const secs = Math.round(dist / Math.max(0.5, 2.6 - f.stage * 0.25));
      this.notify(`🐾 Друг идёт к тебе (${Math.round(dist)} м, ~${secs} с). Y — отменить.`, 'info');
    }

    /** Свист: два коротких тона — сигнал зова */
    _whistle() {
      this.audio.tone({ freq: 900, type: 'sine', dur: 0.13, gain: 0.16, slideTo: 1350 });
      setTimeout(() => this.audio.tone({
        freq: 1350, type: 'sine', dur: 0.20, gain: 0.16, slideTo: 950 }), 150);
    }

    /* ==================== ЛОКАЦИОННЫЕ ДЕЙСТВИЯ ==================== */
    shopLimit(loc, item) {
      const key = loc + ':' + item;
      if (this.shopStock[key] == null) {
        const f = FF.FOOD_BY_ID[item];
        // Дневной лимит: чем калорийнее — тем реже
        let n = 5;
        if (f) n = f.cal <= 3 ? 6 : f.cal <= 10 ? 4 : f.cal <= 30 ? 2 : f.cal <= 100 ? 1 : 1;
        else n = 8;
        this.shopStock[key] = n;
      }
      return this.shopStock[key];
    }
    _resetDailyStock() { this.shopStock = {}; }

    _mill() {
      if (!this.inv.has('grain', 2)) { this.notify('🌾 Нужно 2 зерна. Купи на ферме.', 'warn'); return; }
      this.inv.remove('grain', 2);
      this.inv.add('flour', 5);
      this.notify('🌾 Смолото: +5 муки', 'info');
      this.audio.ui('ok');
      this.quests.event('inventory', { id: 'flour' });
    }

    _spa() {
      if (!this.inv.spend(30)) { this.notify('🪙 Нужно 30 монет.', 'warn'); return; }
      this.startMinigame('massage', null, (q) => {
        this.furry.mood = U.clamp(this.furry.mood + 0.35 + q * 0.3, 0, 1);
        this.furry.spaBonusUntil = this.gameHours + 1;
        this.furry.relation += 3;
        this.spaCount++;
        if (this.spaCount >= 10) this.achieve('spa_lover');
        this.notify('💆 Друг расслаблен! +20% к усвоению еды на час.', 'info');
        this.furry.say('Мур-р-р... это было чудесно...');
      });
    }

    _library() {
      this.inv.addXP(10);
      this.quests.event('read', {});
      const lore = [
        '«История Sugar City»: город построен на месте разлившейся шоколадной реки.',
        '«Пухлая физиология»: жир — это запас любви, говорил профессор Феликс.',
        '«Алхимия движения»: эликсиры не уменьшают массу — они меняют восприятие веса.',
        '«Легенды гор»: перо феникса растёт на Пике Наслаждения раз в сто лет.',
        '«Кулинарная классика»: идеальный торт требует терпения, а не спешки.',
      ];
      this.notify('📚 ' + U.pick(lore), 'info');
      this.audio.ui('ok');
    }

    _bank() {
      this.ui.open('actions', {
        title: '🏦 Банк', sub: `На руках: ${Math.floor(this.inv.coins)} 🪙`,
        actions: [
          { act: 'bank_loan', label: '💰 Взять кредит 200 🪙 (вернуть 260)' },
          { act: 'bank_hack', label: '🔓 Взломать сейф' },
          { act: 'close', label: 'Уйти' },
        ],
      });
    }

    /** Мебельный магазин: улучшения дома, влияющие на геймплей */
    _furniture() {
      this.homeUpgrades = this.homeUpgrades || {};
      const U2 = this.homeUpgrades;
      const items = [
        { id: 'big_sofa', name: '🛋️ Усиленный диван-гигант', price: 320, desc: 'Отдых восстанавливает всю стамину и +настроение' },
        { id: 'fridge2', name: '🧊 Второй холодильник', price: 450, desc: '+50 слотов хранения, продукты не портятся' },
        { id: 'oven_pro', name: '🔥 Профессиональная печь', price: 600, desc: '+15% калорий у всей приготовленной еды' },
        { id: 'jacuzzi', name: '🛁 Джакузи', price: 800, desc: 'Купание даёт +30% усвоения на 2 часа' },
        { id: 'bed_king', name: '🛏️ Круглая кровать-облако', price: 500, desc: 'Сон полностью восполняет настроение друга' },
        { id: 'scale', name: '⚖️ Промышленные весы', price: 250, desc: 'Точная статистика роста по всем 60 зонам' },
      ];
      this.ui.open('actions', {
        title: '🛋️ Мебельный «Мягкий Угол»',
        sub: `Столяр Дубовик: «Для большого друга нужна большая мебель!» · Монет: ${Math.floor(this.inv.coins)}`,
        actions: items.map((i) => ({
          act: U2[i.id] ? 'noop' : 'buy_furniture', id: i.id,
          label: `${U2[i.id] ? '✅ ' : ''}${i.name} — ${U2[i.id] ? 'куплено' : i.price + ' 🪙'} · ${i.desc}`,
        })).concat([{ act: 'close', label: 'Уйти' }]),
      });
      this._furnitureItems = items;
    }

    _clothes() { this.ui.open('wardrobe'); }

    _club() {
      const h = this.gameHours % 24;
      if (h > 6 && h < 21) { this.notify('🎵 Клуб открыт только ночью (21:00–06:00).', 'warn'); return; }
      this.startMinigame('dance', null, (q) => {
        const coins = Math.floor(15 + q * 40);
        this.inv.addCoins(coins);
        this.furry.mood = U.clamp(this.furry.mood + 0.3, 0, 1);
        this.notify(`💃 Отличные танцы! +${coins} 🪙`, 'info');
      });
    }

    _mail() {
      const letters = [
        'Артём: «Зашёл бы. У меня новая идея эликсира!»',
        'Милли: «Новые пончики в четверг. Приходите вдвоём!»',
        'Мэр Тиберий: «Город благодарит вас за вклад в общее счастье».',
        'Виктория: «Конкурс кондитеров скоро. Готовьтесь».',
        'Неизвестный отправитель: «Загляни на старый маяк в полночь...»',
      ];
      const bonus = U.randInt(5, 25);
      this.inv.addCoins(bonus);
      this.notify(`📮 ${U.pick(letters)} (+${bonus} 🪙)`, 'info');
      this.audio.ui('coin');
    }

    _sleepNight() {
      const target = 7.5;
      let delta = target - (this.gameHours % 24);
      if (delta <= 0) delta += 24;
      this.skipTime(delta);
      this.player.stamina = FF.CONFIG.player.maxStamina;
      this.furry.mood = U.clamp(this.furry.mood + 0.2, 0, 1);
      this.notify('🌅 Новое утро! Все лавки пополнились.', 'info');
    }

    _bath() {
      this.furry.wet = 1;
      this.furry.mood = U.clamp(this.furry.mood + 0.25, 0, 1);
      if (this.homeUpgrades && this.homeUpgrades.jacuzzi) {
        this.furry.spaBonusUntil = this.gameHours + 2;
        this.notify('🛁 Джакузи: +30% усвоения на 2 часа!', 'info');
      }
      this.furry.relation += 2;
      this.notify('🛁 Друг чистый и довольный! (мокрая шёрстка — скользко для карабканья)', 'info');
      this.furry.say('Мур~ водичка тёплая...');
      this.audio.squish();
    }

    _fountainCup() {
      const key = 'fountain_' + Math.floor(this.gameHours);
      if (this.usedOnce.has(key)) { this.notify('🍫 Чашки можно набирать раз в час.', 'warn'); return; }
      this.usedOnce.add(key);
      this.inv.add('hot_choco', 1);
      this.notify('🍫 Набрал чашку горячего шоколада!', 'info');
      this.audio.ui('coin');
    }

    _feedBirds(who) {
      this.pigeonsFed++;
      this.furry.mood = U.clamp(this.furry.mood + 0.02, 0, 1);
      this.inv.addCoins(1);
      this.notify(`🐦 Покормил ${who}. Мило! (+1 🪙)`, 'info');
      if (this.pigeonsFed >= 50) this.achieve('pigeons');
    }

    _picnic() {
      const food = this.inv.foodList()[0];
      if (!food) { this.notify('🧺 Для пикника нужна еда.', 'warn'); return; }
      this.inv.remove(food, 1);
      const f = FF.FOOD_BY_ID[food];
      this.furry.feed(f.cal * 1.3, food);
      this.furry.mood = 1;
      this.furry.relation += 4;
      this.notify(`🧺 Чудесный пикник! ${f.name} на природе вкуснее (+30%).`, 'feed');
      this.furry.say('Мне так хорошо с тобой... правда.');
    }

    _wishTree() {
      if (this.usedOnce.has('wish')) { this.notify('🌳 Дерево исполняет одно желание за игру.', 'warn'); return; }
      this.usedOnce.add('wish');
      this.achieve('wish_tree');
      this.inv.addCoins(150);
      this.inv.add('star_powder', 1);
      this.notify('🌳 Дерево желаний исполнило желание: +150 🪙 и звёздный порошок!', 'quest');
      this.audio.magic();
    }

    _peak() {
      if (this.furry.stage < 7) { this.notify('⛰️ Пик открыт с 7 стадии друга.', 'warn'); return; }
      if (this.usedOnce.has('peak')) { this.notify('⛰️ Здесь уже пусто.', 'warn'); return; }
      this.usedOnce.add('peak');
      this.inv.add('phoenix_feather', 1);
      this.inv.add('stellar_dessert', 1);
      this.notify('🌟 На пике найдено: перо феникса и ЗВЁЗДНЫЙ ДЕСЕРТ (1000 кал)!', 'quest');
      this.audio.magic();
    }

    _dragon() {
      if (this.usedOnce.has('dragon')) { this.notify('🐉 Дракон спит. Не буди.', 'warn'); return; }
      const opts = [
        { act: 'dragon_choice', id: 'flatter', label: '😇 «Ваша чешуя великолепна, о великий»' },
        { act: 'dragon_choice', id: 'food', label: '🍰 Предложить свой лучший торт' },
        { act: 'dragon_choice', id: 'fight', label: '⚔️ «Отдай сердце!»' },
        { act: 'close', label: 'Уйти тихо' },
      ];
      this.ui.open('actions', { title: '🐉 Пещера Дракона',
        sub: 'Огромный дракон открывает один глаз: «Смертный... зачем ты здесь?»', actions: opts });
    }

    _lighthouse() {
      if (this.secrets.has('lighthouse')) { this.notify('🗼 Маяк уже раскрыл свою тайну.', 'info'); return; }
      this.startMinigame('puzzle', null, (q) => {
        if (q < 0.35) { this.notify('🗼 Символы погасли. Попробуй ещё раз.', 'warn'); return; }
        this.secrets.add('lighthouse');
        this.quests.event('secret', { id: 'lighthouse' });
        this.inv.add('star_powder', 2);
        this.inv.addCoins(200);
        this.notify('🗼 Тайна маяка раскрыта! +2 звёздных порошка, +200 🪙', 'quest');
        this.audio.magic();
      });
    }

    _nightGuard() {
      this.achieve('night_owl');
      const lines = [
        '«Я сторожу сны этого города. Твой друг спит крепко — это хорошо».',
        '«В три часа ночи мир мягче. Как твой друг».',
        '«Дерево желаний в лесу. Один раз. Не трать зря».',
      ];
      this.notify('👤 ' + U.pick(lines), 'info');
      if (!this.usedOnce.has('guard_gift')) {
        this.usedOnce.add('guard_gift');
        this.inv.add('moon_sugar', 2);
        this.notify('👤 Страж передал 2 лунных сахара и растворился в тумане.', 'quest');
      }
    }

    _secretShop() {
      const h = this.gameHours % 24;
      if (h < 17.5 || h > 20) { this.notify('🌒 Лавка открыта только на закате (17:30–20:00).', 'warn'); return; }
      this.ui.open('shop', { label: '🌒 Секретная лавка', action: 'shop_ing', loc: 'secret',
        shop: ['vanilla', 'rose_oil', 'rainbow_crystal', 'star_powder', 'moon_sugar', 'choco_heart'] });
    }

    /* ==================== ЭЛИКСИРЫ ==================== */
    useElixir(id) {
      const e = FF.ELIXIR_BY_ID[id];
      if (!e || !(this.inv.elixirs[id] > 0)) return;
      this.inv.elixirs[id]--;
      if (id === 'eternal') {
        this.furry.permanentMobility = true;
        this.furry.eternalBond = true;
        this.usedOnce.add('elixir_eternal');
        this.achieve('eternal_bond');
        this.notify('💗 Эликсир Вечной Любви: связь стала нерушимой. +50% усвоения навсегда.', 'stage');
        this.furry.setEmotion('bliss', 8);
        this.furry.say('Я... я чувствую тебя. Всегда буду. Спасибо.');
        this.audio.magic();
        this.furry._updateMobility();
        return;
      }
      if (e.minutes === Infinity) {
        this.furry.permanentMobility = true;
        this.notify(`✨ ${e.name}: друг теперь ВСЕГДА подвижен!`, 'stage');
        if (id === 'gold') this.achieve('gold_elixir');
        this.usedOnce.add('elixir_' + id);
      } else {
        this.furry.elixirUntil = this.gameHours + e.minutes / 60;
        this.notify(`✨ ${e.name}: подвижность на ${e.minutes} мин.`, 'info');
      }
      this.furry._updateMobility();
      this.furry.setEmotion('happy', 4);
      this.furry.say('Ух ты! Я снова могу двигаться! Спасибо!');
      this.audio.magic();
    }

    /* ==================== МИНИ-ИГРЫ ==================== */
    startMinigame(id, source, cb) {
      const done = (q) => {
        const def = FF.MINIGAMES[id];
        const grade = q >= 0.9 ? 'ИДЕАЛЬНО' : q >= 0.65 ? 'Отлично' : q >= 0.4 ? 'Хорошо' : 'Так себе';
        this.notify(`🎮 ${def.name}: ${grade} (${Math.round(q * 100)}%)`, q >= 0.65 ? 'quest' : 'info');
        this.quests.event('minigame', { id });
        this.inv.addXP(8 + q * 20);
        if (cb) { cb(q); return; }
        // Стандартные награды
        const rewards = {
          milk: () => this.inv.add('milk', 1 + Math.round(q * 3)),
          eggs: () => this.inv.add('egg', 2 + Math.round(q * 5)),
          honey: () => this.inv.add('honey', 1 + Math.round(q * 3)),
          wool: () => { this.inv.addCoins(10 + Math.round(q * 25)); },
          dough: () => {
            this.inv.add('flour', 2 + Math.round(q * 4));
            this.inv.addCoins(FF.CONFIG.economy.bakeryShiftPay + Math.round(q * 20));
          },
          fishing: () => { if (source && source.item) this.inv.add(source.item, 1); else this.inv.addCoins(10 + Math.round(q * 20)); },
          cafe: () => this.inv.addCoins(FF.CONFIG.economy.cafeShiftPay + Math.round(q * 20)),
          chocobath: () => { this.furry.wet = 1; this.furry.mood = 1; this.furry.relation += 3; this.inv.add('choco_heart', 1); },
          pump: () => {
            const drinks = ['shake_normal', 'shake_mega', 'shake_ultra'];
            const best = drinks.filter((d) => this.inv.has(d))[0];
            if (best) { this.inv.remove(best, 1); const f = FF.FOOD_BY_ID[best];
              this.furry.feed(f.cal * (1 + q * 0.4), best);
              this.notify(`⚙️ Закачано ${U.fmt(f.cal * (1 + q * 0.4))} калорий!`, 'feed');
            } else this.notify('⚙️ Нет коктейля в инвентаре — купи в The Pump Cafe.', 'warn');
            this.pumpUses = (this.pumpUses || 0) + 1;
            if (this.pumpUses >= 10) this.achieve('pump');
          },
          massage: () => { this.furry.mood = U.clamp(this.furry.mood + 0.3, 0, 1); this.furry.relation += 2; },
          crane: () => this.notify('🏗️ Друг надёжно закреплён на платформе!', 'info'),
          push_in: () => this.notify('💪 Толкали дружно!', 'info'),
          winch: () => this.notify('⚙️ Лебёдка справилась!', 'info'),
          dontfall: () => this.inv.addCoins(5 + Math.round(q * 25)),
          dance: () => this.inv.addCoins(10 + Math.round(q * 30)),
          jumper: () => { this.furry.bounce(this.furry.zoneWorldPos('mid_belly'), 1 + q); this.inv.addCoins(5 + Math.round(q * 20)); },
          mushrooms: () => this.inv.add('glow_mushroom', 1 + Math.round(q * 4)),
          moonhunt: () => this.inv.add('moon_dew', 1 + Math.round(q * 4)),
          dragonfight: () => { if (q > 0.5) { this.inv.add('dragon_saliva', 1); this.achieve('dragon'); } },
          puzzle: () => this.inv.addCoins(25 + Math.round(q * 80)),
          busker: () => { this.inv.addCoins(8 + Math.round(q * 25)); this.furry.mood = U.clamp(this.furry.mood + 0.2, 0, 1); },
        };
        rewards[id] && rewards[id]();
        if (q > 0.9 && id === 'cooking') this.quests.event('craftPerfect', {});
      };
      this.ui.startMinigame(id, done);
    }

    /* ==================== КРАФТ ==================== */
    craft(outId) {
      const r = FF.RECIPES.find((x) => x.out === outId);
      if (!r) return;
      for (const [k, v] of Object.entries(r.ing)) if (v > 0 && !this.inv.has(k, v)) {
        this.notify('❌ Не хватает ингредиентов.', 'warn'); return;
      }
      this.ui.close();
      this.startMinigame('cooking', null, (q) => {
        for (const [k, v] of Object.entries(r.ing)) if (v > 0) this.inv.remove(k, v);
        let bonus = q >= 0.9 ? 0.25 : q >= 0.65 ? 0.10 : q >= 0.4 ? 0 : -0.2;
        if (this.homeUpgrades && this.homeUpgrades.oven_pro) bonus += 0.15;   // проф. печь
        this.inv.add(outId, 1);
        const out = FF.FOOD_BY_ID[outId] || FF.ING_BY_ID[outId];
        this.craftQuality = this.craftQuality || {};
        this.craftQuality[outId] = bonus;
        this.crafted++;
        if (this.crafted >= 10) this.achieve('cook10');
        if (this.crafted >= 100) this.achieve('cook100');
        this.inv.addXP(10 + (r.level || 1) * 2);
        this.notify(`🍳 Готово: ${out.icon} ${out.name}${bonus ? ` (${bonus > 0 ? '+' : ''}${Math.round(bonus * 100)}% калорий)` : ''}`, 'quest');
        this.quests.event('craft', { id: outId });
        if (q >= 0.9) this.quests.event('craftPerfect', {});
      });
    }

    brew(elixirId) {
      const e = FF.ELIXIR_BY_ID[elixirId];
      if (!e) return;
      for (const [k, v] of Object.entries(e.ing)) if (!this.inv.has(k, v)) { this.notify('❌ Не хватает ингредиентов.', 'warn'); return; }
      this.ui.close();
      this.startMinigame('brew', null, (q) => {
        for (const [k, v] of Object.entries(e.ing)) this.inv.remove(k, v);
        this.inv.elixirs[elixirId] = (this.inv.elixirs[elixirId] || 0) + 1;
        this.brewed++;
        if (this.brewed >= 1) this.achieve('alchemist1');
        if (this.brewed >= 50) this.achieve('alchemist');
        this.notify(`⚗️ Сварен ${e.name}! Качество: ${Math.round(q * 100)}%`, 'quest');
        this.audio.magic();
        this.inv.addXP(20);
      });
    }

    /* ==================== UI-ДЕЙСТВИЯ ==================== */
    uiAction(act, ds, data) {
      const g = this;
      switch (act) {
        case 'close': this.ui.close(); break;
        case 'select': this.inv.selected = ds.id; this.ui.render(this.ui.panelOpen, data); this.audio.ui('click'); break;
        case 'use_elixir': this.useElixir(ds.id); this.ui.render('inventory'); break;
        case 'buy': {
          const isIng = ds.ing === '1';
          const it = isIng ? FF.ING_BY_ID[ds.id] : FF.FOOD_BY_ID[ds.id];
          const key = (ds.loc || 'stall') + ':' + ds.id;
          if (this.shopLimit(ds.loc || 'stall', ds.id) <= 0) { this.notify('📦 Сегодня закончилось.', 'warn'); return; }
          if (!this.inv.spend(it.price)) { this.notify('🪙 Не хватает монет.', 'warn'); this.audio.ui('err'); return; }
          this.shopStock[key]--;
          this.inv.add(ds.id, 1);
          this.audio.ui('coin');
          this.quests.event('inventory', { id: ds.id });
          this.ui.render('shop', data);
          break;
        }
        case 'sell': {
          const f = FF.FOOD_BY_ID[ds.id];
          if (!this.inv.remove(ds.id, 1)) return;
          this.inv.addCoins(Math.floor(f.price * FF.CONFIG.economy.sellRatio));
          this.audio.ui('coin');
          this.ui.render('shop', data);
          break;
        }
        case 'craft': this.craft(ds.id); break;
        case 'brew': if (this.ui.panelOpen === 'dialogue') this.ui.open('brew'); else this.brew(ds.id); break;
        case 'accept_quest': this.quests.accept(ds.id); this.ui.render('dialogue', data); break;
        case 'turnin': this.quests.complete(ds.id); this.ui.render('dialogue', data); break;
        case 'travel': {
          const loc = FF.LOC_BY_ID[ds.id];
          if (loc.locked && this.furry.stage < 7) { this.notify('🔒 Локация откроется позже.', 'warn'); return; }
          const cls = this.cab.rideClass();
          if (cls.id === 'impossible') {
            this.notify('🚕 Друг слишком большой для Sugar Cab — только пешком.', 'warn');
            return;
          }
          if (!this.inv.spend(FF.CAB.price)) {
            this.notify(`🪙 Нужно ${FF.CAB.price} монет на Sugar Cab.`, 'warn'); return;
          }
          this.ui.close();
          this._instantTravel(ds.id);
          break;
        }
        case 'ride_to': {
          const loc0 = FF.LOC_BY_ID[ds.id];
          if (loc0.locked && this.furry.stage < 7) { this.notify('🔒 Локация откроется позже.', 'warn'); return; }
          // У большого транспорта кабина отделена — спрашиваем, где ехать
          if (this.cabin.hasSeparateCab(this.taxi.taxiDef.id) && !ds.seat) {
            this.ui.open('actions', {
              title: '🚛 Где поедешь?',
              sub: 'У этого транспорта кабина тягача отделена от грузовой платформы.',
              actions: [
                { act: 'ride_to', id: ds.id, seat: 'cab', label: '🚛 В кабине тягача — спокойно, друга видно в зеркало' },
                { act: 'ride_to', id: ds.id, seat: 'together', label: '🐾 На платформе рядом с другом — тесно, может зажать' },
                { act: 'close', label: 'Отмена' },
              ],
            });
            return;
          }
          this.cabin.setRideMode(ds.seat || 'together');
          this.ui.close();
          const loc = loc0;
          // ПОСАДКА: способ зависит от размера друга (см. boarding.js)
          const ok = this.boarding.begin(this.taxi.taxiDef, () => this.taxi.ride(ds.id));
          if (!ok) this.taxi.active = false;
          break;
        }
        case 'spa': this.ui.close(); this._spa(); break;
        case 'gift_flour': {
          if (this.usedOnce.has('flour_gift_' + this.day)) { this.notify('🌾 Барри уже дарил муку сегодня.', 'warn'); return; }
          this.usedOnce.add('flour_gift_' + this.day);
          this.inv.add('flour', 3);
          this.notify('🌾 Барри подарил 3 муки!', 'info');
          break;
        }
        case 'read': this._library(); break;
        case 'tip': {
          if (!this.inv.spend(2)) return;
          this.furry.mood = U.clamp(this.furry.mood + 0.12, 0, 1);
          this.notify('🎵 Музыкант играет для вас. Настроение друга улучшилось!', 'info');
          break;
        }
        case 'pump': this.ui.close(); this.startMinigame('pump'); break;
        case 'bank_loan': {
          if (this.loan) { this.notify('🏦 У вас уже есть кредит.', 'warn'); return; }
          this.loan = 260; this.inv.addCoins(200);
          this.notify('🏦 Кредит выдан: +200 🪙 (вернуть 260)', 'info');
          this.ui.close();
          break;
        }
        case 'noop': break;
        case 'cab_go': {
          this.ui.close();
          this.cab.startBoarding(ds.id);
          break;
        }
        case 'board_info': {
          const st = parseInt(ds.id, 10);
          const cur = this._boardExpand === st ? null : st;
          this._boardExpand = cur;
          this.ui.render('boarding', { expand: cur });
          this.audio.ui('click');
          break;
        }
        case 'buy_cloth': if (this.clothing.buy(ds.id)) this.ui.render('wardrobe'); break;
        case 'wear_cloth': this.clothing.wear(ds.id); this.audio.ui('ok'); this.ui.render('wardrobe'); break;
        case 'takeoff': this.clothing.takeOff(ds.id); this.audio.ui('click'); this.ui.render('wardrobe'); break;
        case 'buy_furniture': {
          const it = (this._furnitureItems || []).find((x) => x.id === ds.id);
          if (!it) return;
          this.homeUpgrades = this.homeUpgrades || {};
          if (this.homeUpgrades[it.id]) return;
          if (!this.inv.spend(it.price)) { this.notify('🪙 Не хватает монет.', 'warn'); this.audio.ui('err'); return; }
          this.homeUpgrades[it.id] = true;
          this.notify(`🛋️ Куплено: ${it.name}! ${it.desc}`, 'quest');
          this.audio.ui('achieve');
          this._furniture();
          break;
        }
        case 'bank_hack': this.notify('🔓 Сигнализация! Кроненберг смеётся: «Это была шутка, помните?»', 'warn'); break;
        case 'buy_clothes': {
          const price = ds.id === 'elastic' ? (40 + this.furry.stage * 60) * 3 : 40 + this.furry.stage * 60;
          if (!this.inv.spend(price)) { this.notify('🪙 Не хватает монет.', 'warn'); return; }
          this.furry.shirt.visible = true; this.furry.shorts.visible = true;
          this.furry.shirt.material.opacity = 1; this.furry.shorts.material.opacity = 1;
          this.furry.shirt.material.color.setHSL(Math.random(), 0.5, 0.6);
          if (ds.id === 'elastic') this.elasticClothes = true;
          this.notify('👕 Новая одежда! Друг доволен.', 'info');
          this.furry.say('Ой, мне идёт? Правда?');
          this.ui.close();
          break;
        }
        case 'dragon_choice': {
          this.ui.close();
          if (ds.id === 'flatter') {
            this.usedOnce.add('dragon');
            this.inv.add('dragon_saliva', 1); this.inv.add('dragon_milk', 1);
            this.notify('🐉 Дракон польщён: «Возьми молока и слюны, смертный».', 'quest');
            this.achieve('dragon');
          } else if (ds.id === 'food') {
            const best = this.inv.foodList().sort((a, b) => FF.FOOD_BY_ID[b].cal - FF.FOOD_BY_ID[a].cal)[0];
            if (!best) { this.notify('🐉 «У тебя нет даров. Уходи».', 'warn'); return; }
            this.inv.remove(best, 1);
            this.usedOnce.add('dragon');
            this.inv.add('dragon_heart', 1); this.inv.add('dragon_milk', 2);
            this.notify('🐉 Дракон растроган: «Моё сердце — твоё. Береги друга».', 'quest');
            this.achieve('dragon');
            this.quests.event('inventory', { id: 'dragon_heart' });
          } else {
            this.notify('🐉 Дракон дунул огнём. Ты убежал. Стамина потеряна.', 'warn');
            this.player.stamina = 5;
          }
          break;
        }
        case 'save': this.save(); break;
        case 'load': this.load(); break;
        case 'open_ach': this.ui.open('achievements'); break;
        case 'open_help': this.ui.open('help'); break;
        case 'restart': if (confirm('Начать заново? Прогресс будет потерян.')) { localStorage.removeItem(FF.CONFIG.save.key); location.reload(); } break;
      }
    }

    applySetting(key, val) {
      switch (key) {
        case 'master': FF.CONFIG.audio.masterVolume = val / 100; this.audio.setVolume('master', val / 100); break;
        case 'music': FF.CONFIG.audio.musicVolume = val / 100; this.audio.setVolume('music', val / 100); break;
        case 'sfx': FF.CONFIG.audio.sfxVolume = val / 100; this.audio.setVolume('sfx', val / 100); break;
        case 'furry': FF.CONFIG.audio.furryVolume = val / 100; this.audio.setVolume('furry', val / 100); break;
        case 'post': FF.CONFIG.post.enabled = !!val; break;
        case 'shadow': this.renderer.shadowMap.enabled = val > 0; this.world.sun.shadow.mapSize.set(+val, +val);
          this.world.sun.shadow.map && this.world.sun.shadow.map.dispose(); this.world.sun.shadow.map = null; break;
        case 'timescale': this.timeScale = parseFloat(val); break;
      }
    }

    /* ==================== ПЕРЕМЕЩЕНИЕ ==================== */
    _fastTravel(locId) {
      const l = FF.LOC_BY_ID[locId];
      this._instantTravel(locId);
      this.notify(`🚶 Быстрое перемещение: ${l.name}`, 'info');
    }
    _instantTravel(locId) {
      const l = FF.LOC_BY_ID[locId];
      this.player.teleport(l.x + 3, l.z + 12);
      if (this.furry.mobile || locId === 'cottage') {
        this.furry.root.position.set(l.x - 3, this.world.heightAt(l.x - 3, l.z + 12), l.z + 12);
      }
      this.visited.add(locId);
      this.quests.event('visit', { id: locId });
      if (this.visited.size >= FF.LOCATIONS.length) this.achieve('traveler');
      this.skipTime(0.25);
    }
    _boardTaxi() {
      const locs = FF.LOCATIONS.filter((l) => !l.locked || this.furry.stage >= 7);
      this.ui.open('actions', {
        title: `${this.taxi.taxiDef.icon} ${this.taxi.taxiDef.name}`,
        sub: `Водитель: ${this.taxi.taxiDef.driver}. Куда едем?`,
        actions: locs.map((l) => ({ act: 'ride_to', id: l.id, label: `📍 ${l.name}` })).concat([{ act: 'close', label: 'Остаться' }]),
      });
      this._rideHandler = true;
    }

    /* ==================== ВРЕМЯ ==================== */
    skipTime(hours) {
      const before = Math.floor(this.gameHours / 24);
      this.gameHours += hours;
      const after = Math.floor(this.gameHours / 24);
      if (after > before) this._newDay(after - before);
      this.furry.hunger = U.clamp(this.furry.hunger + hours * 0.15, 0, 1);
    }
    _newDay(n = 1) {
      this.day += n;
      this._resetDailyStock();
      this.inv.addCoins(FF.CONFIG.economy.dailyLogin);
      this.notify(`🌅 День ${this.day}! Ежедневный бонус +${FF.CONFIG.economy.dailyLogin} 🪙, лавки пополнились.`, 'info');
      // Погода — полноценная система с сезонами
      this.weatherSys.roll();
      this.weather = this.weatherSys.current;
      if (this.loan && this.day % 7 === 0) {
        const pay = Math.min(this.inv.coins, 40);
        this.inv.coins -= pay; this.loan -= pay;
        if (this.loan <= 0) { this.loan = 0; this.notify('🏦 Кредит погашен!', 'info'); }
        else this.notify(`🏦 Платёж по кредиту: -${pay} 🪙 (осталось ${this.loan})`, 'warn');
      }
    }

    /* ==================== ПРОЧЕЕ ==================== */
    relationName() {
      const r = this.furry.relation;
      const cal = this.furry.calories;
      if (cal >= 100000) return 'Единое целое';
      if (cal >= 10000) return 'Родственные души';
      if (cal >= 2000) return 'Лучшие друзья';
      if (cal >= 500) return 'Близкие друзья';
      if (cal >= 100) return 'Друзья';
      return 'Знакомые';
    }

    achieve(id, cond = true) {
      if (!cond || this.achievements.has(id)) return;
      const a = FF.ACHIEVEMENTS.find((x) => x.id === id);
      if (!a) return;
      this.achievements.add(id);
      this.notify(`🏆 Достижение: «${a.name}» — ${a.desc}`, 'stage');
      this.audio.ui('achieve');
      this.inv.addCoins(15);
      if (this.achievements.size >= FF.ACHIEVEMENTS.length - 2) this.achieve('secrets');
    }

    notify(text, kind) { this.ui.notify(text, kind); }
    showSpeech(text) { this.ui.showSpeech(text); }

    _togglePhoto() { this.photoMode = this.photo.toggle(); }
    _screenshot() { this.photo.capture(); }

    /* ==================== СОХРАНЕНИЕ ==================== */
    save() {
      const data = {
        v: 1, gameHours: this.gameHours, day: this.day, weather: this.weather,
        furry: this.furry.serialize(), player: this.player.serialize(), inv: this.inv.serialize(),
        quests: this.quests.serialize(), ach: [...this.achievements], visited: [...this.visited],
        eternalBond: this.furry.eternalBond,
        clothing: this.clothing.serialize(), weatherSys: this.weatherSys.serialize(),
        statsTracker: this.statsTracker.serialize(), notebook: this.notebook.serialize(),
        photos: this.photos,
        secrets: [...this.secrets], usedOnce: [...this.usedOnce], shopStock: this.shopStock,
        crafted: this.crafted, brewed: this.brewed, metArtyom: this.metArtyom, homeUpgrades: this.homeUpgrades,
        artyomRelation: this.artyomRelation, pigeonsFed: this.pigeonsFed, loan: this.loan,
      };
      try {
        localStorage.setItem(FF.CONFIG.save.key, JSON.stringify(data));
        this.notify('💾 Игра сохранена!', 'info');
      } catch (e) {
        this.notify('❌ Ошибка сохранения: ' + e.message, 'warn');
      }
    }
    load() {
      try {
        const raw = localStorage.getItem(FF.CONFIG.save.key);
        if (!raw) { this.notify('📂 Сохранение не найдено.', 'warn'); return false; }
        const d = JSON.parse(raw);
        this.gameHours = d.gameHours || 18;
        this.day = d.day || 1;
        this.weather = d.weather || 'clear';
        this.world.setWeather(this.weather);
        this.furry.deserialize(d.furry);
        this.player.deserialize(d.player);
        this.inv.deserialize(d.inv);
        this.quests.deserialize(d.quests);
        this.furry.eternalBond = !!d.eternalBond;
        this.achievements = new Set(d.ach || []);
        this.visited = new Set(d.visited || []);
        this.secrets = new Set(d.secrets || []);
        this.usedOnce = new Set(d.usedOnce || []);
        this.shopStock = d.shopStock || {};
        this.crafted = d.crafted || 0; this.brewed = d.brewed || 0;
        this.homeUpgrades = d.homeUpgrades || {};
        this.clothing.deserialize(d.clothing);
        this.weatherSys.deserialize(d.weatherSys);
        this.statsTracker.deserialize(d.statsTracker);
        this.notebook.deserialize(d.notebook);
        this.photos = d.photos || 0;
        this.metArtyom = d.metArtyom; this.artyomRelation = d.artyomRelation || 0;
        this.pigeonsFed = d.pigeonsFed || 0; this.loan = d.loan || 0;
        this.notify('📂 Игра загружена!', 'info');
        return true;
      } catch (e) {
        this.notify('❌ Ошибка загрузки: ' + e.message, 'warn');
        return false;
      }
    }
    static hasSave() { return !!localStorage.getItem(FF.CONFIG.save.key); }

    /* ==================== ЦИКЛ ==================== */
    _onResize() {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    update(dt) {
      // Смена суток (ход времени происходит в start(): timeScale игровых минут за реальную секунду)
      const newDay = Math.floor(this.gameHours / 24);
      if (this._lastDayIndex === undefined) this._lastDayIndex = newDay;
      if (newDay > this._lastDayIndex) { this._newDay(newDay - this._lastDayIndex); this._lastDayIndex = newDay; }

      if (this.ui.minigame) { this.ui.updateMinigame(dt); this.ui.updateHUD(dt); this.render(); return; }

      this.player.update(dt);
      this.furry.update(dt, this.gameHours);
      this.world.update(dt, this.gameHours, this.player.pos);
      this.taxi.update(dt);
      this.boarding.update(dt);
      this.cabin.update(dt);
      this.cab.update(dt);
      this.objects.update(dt, this.furry);
      this.clothing.update(dt);
      this.weatherSys.update(dt);
      this.statsTracker.update(dt);
      // Друг сам подбирает еду, лежащую у морды
      if (this.furry.hunger > 0.4) {
        const eaten = this.objects.autoEat(this.furry, 1.6 * this.furry.bodyScale);
        if (eaten) {
          const fd = FF.FOOD_BY_ID[eaten];
          this.furry.feed(fd.cal, eaten);
          this.notify(`😋 ${this.furry.opts.name} сам подобрал ${fd.icon} ${fd.name}!`, 'feed');
        }
      }
      this._updateFurryWalk(dt);
      this._updateAmbientAudio(dt);
      this._updatePrompt();
      this.ui.updateHUD(dt);

      // Автосохранение
      this.saveTimer += dt;
      if (this.saveTimer > FF.CONFIG.save.autosaveSeconds) { this.saveTimer = 0; this.save(); }

      // Радужная пасхалка
      if (this._rainbow) {
        const u = this.furry.material.userData.uniforms;
        u.uFurColor.value.setHSL((performance.now() * 0.0002) % 1, 0.85, 0.6);
      }

      // Локация
      const loc = this.world.locationAt(this.player.pos);
      if (loc !== this.currentLoc) {
        this.currentLoc = loc;
        if (loc) {
          this.visited.add(loc.id);
          this.quests.event('visit', { id: loc.id });
          if (this.visited.size >= FF.LOCATIONS.length) this.achieve('traveler');
          this.audio.setAmbience(loc.id === 'forest' ? 'forest' : loc.id === 'mountains' ? 'mountain' : 'city');
        }
      }
      this.audio.updateMusic(dt, loc ? loc.music : 'lofi');

      this.render();
    }

    /** Фурри идёт к игроку, если позвали */
    /**
     * Друг идёт к игроку: цель обновляется каждый кадр, есть обход
     * препятствий, ускорение на дистанции и остановка рядом.
     */
    _updateFurryWalk(dt) {
      const f = this.furry;
      if (!this.furryFollow) return;

      // Потерял подвижность по пути (кончился эликсир)
      if (!f.mobile) {
        this.furryFollow = false;
        this.notify('🛑 Друг больше не может идти — нужен эликсир.', 'warn');
        f.setEmotion('sad', 4);
        return;
      }

      // Цель — ТЕКУЩАЯ позиция игрока, а не та, где он был при зове
      const d = this.player.pos.clone().sub(f.root.position);
      d.y = 0;
      const dist = d.length();

      // Пришёл
      const stopAt = 2.2 + f.bodyScale * 0.8;
      if (dist < stopAt) {
        this.furryFollow = false;
        this.furryWalkTarget = null;
        this.notify('🐾 Друг догнал тебя!', 'feed');
        f.setEmotion('happy', 3);
        this.audio.voice('happy', f.opts.species);
        f.relation += 0.5;
        this.achieve('good_boy');
        return;
      }

      d.normalize();

      // Обход препятствий: пробуем сдвинуть направление, если впереди стена
      const probe = f.root.position.clone().addScaledVector(d, 2.2 + f.bodyScale);
      let blocked = false;
      for (const c of this.world.colliders) {
        if (c.type === 'box') {
          if (Math.abs(probe.x - c.x) < c.w / 2 + f.bodyScale &&
              Math.abs(probe.z - c.z) < c.d / 2 + f.bodyScale) { blocked = true; break; }
        } else if (c.type === 'cyl') {
          if (Math.hypot(probe.x - c.x, probe.z - c.z) < c.r + f.bodyScale) { blocked = true; break; }
        }
      }
      if (blocked) {
        // Скользим вдоль препятствия
        const side = (this._dodgeDir || (this._dodgeDir = Math.random() < 0.5 ? 1 : -1));
        d.set(-d.z * side, 0, d.x * side).normalize();
      } else this._dodgeDir = null;

      // Скорость: крупный идёт медленнее, но издалека спешит
      const base = Math.max(0.55, 2.6 - f.stage * 0.24);
      const hurry = dist > 18 ? 1.7 : dist > 8 ? 1.3 : 1;
      const speed = base * hurry;

      f.root.position.addScaledVector(d, speed * dt);
      f.root.position.y = this.world.heightAt(f.root.position.x, f.root.position.z);
      // Плавный разворот в сторону движения
      const wantYaw = Math.atan2(d.x, d.z);
      let dy = wantYaw - f.root.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      f.root.rotation.y += dy * Math.min(1, dt * 5);

      // Походка: колыхание тем сильнее, чем он больше
      const gait = 0.004 * speed * (1 + f.stage * 0.12);
      const step = Math.sin(performance.now() * gait);
      const heavy = 1 + f.stage * 0.35;
      f.nodeById.mid_belly.impulse(new THREE.Vector3(0, -1, 0.2), Math.abs(step) * dt * 22 * heavy);
      f.nodeById.lower_belly.impulse(new THREE.Vector3(0, -1, 0.1), Math.abs(step) * dt * 16 * heavy);
      f.nodeById.lower_left_glute.impulse(new THREE.Vector3(0, step, 0), dt * 14 * heavy);
      f.nodeById.lower_right_glute.impulse(new THREE.Vector3(0, -step, 0), dt * 14 * heavy);
      f.nodeById.left_moob.impulse(new THREE.Vector3(0, step * 0.6, 0), dt * 9 * heavy);
      f.nodeById.right_moob.impulse(new THREE.Vector3(0, -step * 0.6, 0), dt * 9 * heavy);

      // Шаги и пыхтение — чем толще, тем тяжелее
      if (Math.random() < dt * 2.2) this.audio.step(false);
      if (f.stage >= 5 && Math.random() < dt * 0.7) this.audio.voice('breath', f.opts.species, 0.85);
      if (f.stage >= 4 && Math.random() < dt * 1.1) this.audio.squish();
    }

    _updateAmbientAudio(dt) {
      // Трение внутренних бёдер при движении большого фурри
      const f = this.furry;
      if (f.stage >= 5 && this.furryWalkTarget && Math.random() < dt * 1.6) this.audio.squish();
    }

    _updatePrompt() {
      const it = this._nearest();
      const zone = this._lookZone();
      this.ui.showZone(zone);
      if (it) this.ui.setPrompt(`<kbd>E</kbd> ${it.label}`);
      else if (zone) {
        const canGrab = zone.zone.grab && zone.growth > 0.06;
        this.ui.setPrompt(`<kbd>ЛКМ/ПКМ</kbd> потрогать · ${canGrab ? '<kbd>Shift+ЛКМ</kbd> схватиться' : ''} ${this.inv.selected && FF.FOOD_BY_ID[this.inv.selected] ? '· <kbd>F</kbd> покормить' : ''}`);
      } else this.ui.setPrompt('');
    }

    _lookZone() {
      const origin = this.camera.getWorldPosition(new THREE.Vector3());
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      const hit = origin.clone().addScaledVector(dir, FF.CONFIG.player.reach * 0.6);
      return this.furry.zoneAt(hit, 0.95);
    }

    render() {
      if (this.composer && FF.CONFIG.post.enabled) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    }

    /**
     * ОПТИМИЗАЦИЯ: автоподстройка качества под реальный FPS.
     * Если кадры проседают — снижаем разрешение рендера и отключаем
     * тяжёлые эффекты; когда становится легче, возвращаем обратно.
     */
    _autoQuality(dt) {
      this._fpsAcc = (this._fpsAcc || 0) + dt;
      this._fpsFrames = (this._fpsFrames || 0) + 1;
      if (this._fpsAcc < 2) return;
      const fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0; this._fpsFrames = 0;
      if (this.qualityLocked) return;

      const cur = this._qualityLevel != null ? this._qualityLevel : 2;   // 0 low .. 2 high
      let next = cur;
      if (fps < 32 && cur > 0) next = cur - 1;
      else if (fps > 55 && cur < 2) next = cur + 1;
      if (next === cur) return;
      this._qualityLevel = next;

      const cap = FF.CONFIG.render.pixelRatioCap;
      const presets = [
        { ratio: Math.min(1.0, cap), post: false, shadows: false, lights: 5 },
        { ratio: Math.min(1.25, cap), post: true, shadows: true, lights: 8 },
        { ratio: Math.min(window.devicePixelRatio, cap), post: true, shadows: true, lights: 10 },
      ];
      const q = presets[next];
      this.renderer.setPixelRatio(q.ratio);
      FF.CONFIG.post.enabled = q.post;
      this.renderer.shadowMap.enabled = q.shadows;
      FF.CONFIG.render.maxActiveLights = q.lights;
      this.notify(`⚙️ Качество: ${['низкое', 'среднее', 'высокое'][next]} (${Math.round(fps)} FPS)`, 'info');
    }

    start() {
      let last = performance.now();
      const loop = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        // Корректный ход времени: timeScale = игровых минут за реальную секунду
        this.gameHours += dt * this.timeScale / 60;
        try {
          this._autoQuality(dt);
          this.update(dt);
        } catch (err) {
          console.error('[game loop]', err);
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  FF.GameClass = Game;
})(typeof window !== 'undefined' ? window : globalThis);
