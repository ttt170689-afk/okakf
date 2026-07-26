/**
 * boarding.js — СИСТЕМА ПОСАДКИ ФУРРИ В ТАКСИ
 *
 * Главная идея: чем толще друг, тем труднее его посадить и тем больше
 * места он занимает. Для КАЖДОЙ из 11 стадий роста прописаны:
 *   • способ посадки (сам заходит / подсадить / лебёдка / кран / платформа)
 *   • сколько мест занимает в салоне
 *   • сколько времени длится посадка
 *   • просадка подвески и потеря скорости
 *   • реплики друга и водителя
 *   • шанс застрять в двери и мини-игра вызволения
 *
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  /* ============================================================
   * ТАБЛИЦА ПОСАДКИ ПО СТАДИЯМ (0..10)
   * ------------------------------------------------------------
   * method    — способ погрузки
   * seats     — сколько посадочных мест занимает
   * doorFit   — насколько свободно проходит в дверь (1 = легко, 0 = не лезет)
   * boardTime — секунд на посадку
   * sagMult   — множитель просадки подвески
   * speedMult — множитель скорости такси (тяжелее = медленнее)
   * priceMult — надбавка за габарит
   * stuckRisk — шанс застрять в двери (0..1)
   * helpers   — нужны ли помощники
   * ============================================================ */
  const BOARDING = [
    /* ══════════ 0 — СТРОЙНЯШКА ══════════ */ {
      stage: 0, name: 'Стройняшка', method: 'self', methodName: 'Заходит сам',
      seats: 1, seatsTotal: 4, doorFit: 1.0, boardTime: 2.0, sagMult: 0.25, speedMult: 1.0,
      priceMult: 1.0, stuckRisk: 0, helpers: 0, minTaxi: 'normal', anim: 'hop',
      weightKg: '62–70 кг',
      desc: 'Легко запрыгивает на заднее сиденье и сам пристёгивается.',
      // Детализация салона
      cabin: 'Сидит у окна, рядом остаётся два свободных места.',
      playerSeat: 'Ты садишься рядом — места навалом, можно даже вытянуть ноги.',
      doorNote: 'Проходит в дверь не задумываясь, даже не поворачиваясь боком.',
      bodyNote: 'Ремень безопасности застёгивается на первую же дырочку.',
      sagNote: 'Машина почти не проседает — кузов опускается на пару сантиметров.',
      soundNote: 'Хлопок двери, щелчок ремня.',
      furryLine: ['Поехали! Я быстро!', 'Ух, люблю кататься!', 'Пристегнулся!'],
      driverLine: ['Пристегнитесь, пожалуйста.', 'Куда едем?'],
    },

    /* ══════════ 1 — МЯГОНЬКИЙ ══════════ */ {
      stage: 1, name: 'Мягонький', method: 'self', methodName: 'Заходит сам',
      seats: 1, seatsTotal: 4, doorFit: 0.95, boardTime: 2.6, sagMult: 0.4, speedMult: 0.98,
      priceMult: 1.0, stuckRisk: 0, helpers: 0, minTaxi: 'normal', anim: 'step',
      weightKg: '70–115 кг',
      desc: 'Садится сам, но подушка сиденья уже заметно проминается.',
      cabin: 'Занимает своё место целиком, бока чуть свешиваются за края подушки.',
      playerSeat: 'Ты рядом. Иногда его бок мягко прижимается к твоему плечу.',
      doorNote: 'Слегка пригибается, чтобы не задеть косяк животиком.',
      bodyNote: 'Ремень уходит на третью дырочку, ложится в складочку на боку.',
      sagNote: 'Задняя часть машины оседает сантиметров на пять.',
      soundNote: 'Скрип пружин сиденья, довольное «мур».',
      furryLine: ['Мур~ мягкое сиденье!', 'Тут уютно.', 'Подвинусь чуть-чуть.'],
      driverLine: ['Устраивайтесь поудобнее.', 'Сиденье выдержит, не переживайте.'],
    },

    /* ══════════ 2 — ПУХЛЯШ ══════════ */ {
      stage: 2, name: 'Пухляш', method: 'self_slow', methodName: 'Заходит медленно, боком',
      seats: 1, seatsTotal: 4, doorFit: 0.85, boardTime: 3.6, sagMult: 0.6, speedMult: 0.95,
      priceMult: 1.0, stuckRisk: 0.02, helpers: 0, minTaxi: 'normal', anim: 'sideways',
      weightKg: '115–265 кг',
      desc: 'Приходится развернуться боком и втянуть животик, чтобы пройти дверь.',
      cabin: 'Полностью занимает одно место и наваливается на подлокотник соседнего.',
      playerSeat: 'Ты садишься рядом, но подлокотник поднят — он туда не помещается.',
      doorNote: 'Заходит боком, придерживая живот лапами. Дверной проём впритык.',
      bodyNote: 'Живот ложится на колени. Ремень натягивается почти на всю длину.',
      sagNote: 'Кузов проседает заметно, амортизаторы вздыхают.',
      soundNote: 'Тяжёлый вздох подвески, шорох меха о обивку.',
      furryLine: ['Ой... надо боком...', 'Сейчас-сейчас, помещусь!', 'Втянул живот, проходим!'],
      driverLine: ['Не торопитесь.', 'Дверь пошире открою.'],
    },

    /* ══════════ 3 — ПОЛНЕНЬКИЙ ══════════ */ {
      stage: 3, name: 'Полненький', method: 'assisted', methodName: 'Нужно подтолкнуть',
      seats: 1.5, seatsTotal: 4, doorFit: 0.7, boardTime: 5.0, sagMult: 0.85, speedMult: 0.9,
      priceMult: 1.15, stuckRisk: 0.08, helpers: 1, minTaxi: 'normal', anim: 'push',
      minigame: 'push_in', weightKg: '265–600 кг',
      desc: 'Живот цепляется за проём — ты подталкиваешь сзади, водитель тянет за лапу.',
      cabin: 'Занимает полтора места: соседнее сиденье наполовину под его боком.',
      playerSeat: 'Тебе достаётся край дальнего сиденья, вполоборота.',
      doorNote: 'Живот застревает в проёме на секунду — нужен толчок сзади.',
      bodyNote: 'Ремень уже не сходится, водитель достаёт удлинитель.',
      sagNote: 'Задние колёса заметно приседают, зазор до арки уменьшается вдвое.',
      soundNote: 'Кряхтение, скрип обивки, «ух!» водителя.',
      furryLine: ['Подтолкни меня, пожалуйста~', 'Ай, живот застрял немножко!', 'Я почти внутри!'],
      driverLine: ['Давайте помогу!', 'Ещё чуть-чуть, тянем!'],
    },

    /* ══════════ 4 — ТОЛСТЯК ══════════ */ {
      stage: 4, name: 'Толстяк', method: 'assisted', methodName: 'Посадка вдвоём',
      seats: 2, seatsTotal: 5, doorFit: 0.55, boardTime: 7.0, sagMult: 1.15, speedMult: 0.82,
      priceMult: 1.4, stuckRisk: 0.18, helpers: 1, minTaxi: 'big', anim: 'squeeze',
      minigame: 'push_in', weightKg: '600–1 300 кг',
      desc: 'Занимает два места. Складки приходится заправлять внутрь руками.',
      cabin: 'Разложенный диван на два места — и он лежит поперёк, заполняя оба.',
      playerSeat: 'Ты едешь на переднем сиденье рядом с водителем — сзади мест нет.',
      doorNote: 'В обычную дверь уже не проходит: нужна широкая сдвижная фургона.',
      bodyNote: 'Складки живота вываливаются наружу, их заправляют внутрь перед закрытием.',
      sagNote: 'Фургон садится на задние рессоры, передок задирается.',
      soundNote: 'Стон подвески, шлепки складок, натужное дыхание.',
      furryLine: ['Я... я застрял? Ой, неловко!', 'Толкай сильнее, я верю в тебя!', 'Ой, складочка вылезла~'],
      driverLine: ['Сиденье сложим, так пройдёт.', 'Осторожно, дверь!'],
    },

    /* ══════════ 5 — ЖИРДЯЙ ══════════ */ {
      stage: 5, name: 'Жирдяй', method: 'ramp', methodName: 'Пандус + помощники',
      seats: 3, seatsTotal: 5, doorFit: 0.4, boardTime: 10.0, sagMult: 1.5, speedMult: 0.72,
      priceMult: 1.8, stuckRisk: 0.3, helpers: 2, minTaxi: 'big', anim: 'ramp',
      minigame: 'push_in', weightKg: '1.3–2.8 тонны',
      desc: 'Водитель раскладывает пандус. Двое подталкивают, живот волочится по полу салона.',
      cabin: 'Все задние сиденья сложены. Он лежит на полу фургона, занимая три места.',
      playerSeat: 'Переднее сиденье. Оборачиваешься — видно только стену мягкого бока.',
      doorNote: 'Заезжает через задние распашные двери по пандусу, а не через боковую.',
      bodyNote: 'Живот волочится по полу и собирает коврик складками впереди себя.',
      sagNote: 'Кузов почти касается колёс, водитель подкачивает пневмоподвеску.',
      soundNote: 'Скрежет пандуса, тяжёлое дыхание помощников, «раз-два, взяли!».',
      furryLine: ['Простите, я тяжёлый...', 'Пандус! Как для важной персоны~', 'Ой, коврик собрался...'],
      driverLine: ['Разложу пандус, момент.', 'Машина просядет, но выдержит.'],
    },

    /* ══════════ 6 — ГРОМАДИНА ══════════ */ {
      stage: 6, name: 'Громадина', method: 'winch', methodName: 'Лебёдка',
      seats: 4, seatsTotal: 6, doorFit: 0.22, boardTime: 14.0, sagMult: 1.9, speedMult: 0.62,
      priceMult: 2.4, stuckRisk: 0.42, helpers: 3, minTaxi: 'mega', anim: 'winch',
      minigame: 'winch', weightKg: '2.8–5.5 тонн',
      desc: 'В обычную дверь не проходит. Задний борт откидывается, лебёдка затягивает друга на платформу.',
      cabin: 'Салона больше нет — только открытая грузовая платформа с бортами.',
      playerSeat: 'Ты едешь в кабине с водителем, друга видно в зеркало заднего вида.',
      doorNote: 'Дверей не существует в принципе: откидывается весь задний борт.',
      bodyNote: 'Бока свешиваются за габарит платформы, их подвязывают стропами.',
      sagNote: 'Грузовик оседает на отбойники, шины визуально расплющиваются.',
      soundNote: 'Вой лебёдки, лязг храповика, гул натянутого троса.',
      furryLine: ['Я не пролезу... совсем?', 'Лебёдка? Как груз... но мне нравится!', 'Тяните, я готов!'],
      driverLine: ['Обычное такси уже не вариант.', 'Цепляем лебёдку, держитесь.'],
    },

    /* ══════════ 7 — ГИГАНТ ══════════ */ {
      stage: 7, name: 'Гигант', method: 'crane', methodName: 'Кран',
      seats: 6, seatsTotal: 8, doorFit: 0.1, boardTime: 20.0, sagMult: 2.4, speedMult: 0.5,
      priceMult: 3.2, stuckRisk: 0.5, helpers: 4, minTaxi: 'ultra', anim: 'crane',
      minigame: 'crane', weightKg: '5.5–10 тонн',
      desc: 'Только кран. Под друга заводят четыре широких ремня, поднимают и опускают на платформу.',
      cabin: 'Восьмиколёсная платформа. Он занимает её на три четверти.',
      playerSeat: 'Кабина тягача. Между вами — два метра и стенка, переговариваетесь по рации.',
      doorNote: 'Погрузка исключительно сверху — краном.',
      bodyNote: 'Нижняя складка свисает за край платформы, под неё подкладывают маты.',
      sagNote: 'Гидравлические опоры платформы уходят в грунт на пару сантиметров.',
      soundNote: 'Гудение крана, скрип ремней, команда «майна помалу!».',
      furryLine: ['Меня поднимают! Ой-ой-ой!', 'Я как облако... тяжёлое облако.', 'Не урони меня~'],
      driverLine: ['Заводите ремни под складки.', 'Крановщик, майна помалу!'],
    },

    /* ══════════ 8 — КОЛОСС ══════════ */ {
      stage: 8, name: 'Колосс', method: 'crane_double', methodName: 'Двойной кран',
      seats: 9, seatsTotal: 10, doorFit: 0.04, boardTime: 28.0, sagMult: 3.0, speedMult: 0.4,
      priceMult: 4.5, stuckRisk: 0.55, helpers: 6, minTaxi: 'ultra', anim: 'crane',
      minigame: 'crane', weightKg: '10–20 тонн',
      desc: 'Одного крана мало — работают два синхронно. Платформа усилена домкратами.',
      cabin: 'Платформа заполнена почти целиком, свободна лишь узкая полоса у кабины.',
      playerSeat: 'Кабина тягача. В зеркалах видно только его — дороги позади не видно.',
      doorNote: 'Два крана заводят шесть ремней: по три с каждой стороны.',
      bodyNote: 'Тело переваливается через оба борта, ширина превышает габарит на метр.',
      sagNote: 'Домкраты выставлены по углам, иначе платформу перекашивает.',
      soundNote: 'Два крана в унисон, треск досок настила, гидравлика домкратов.',
      furryLine: ['Два крана? Ради меня?', 'Я стал достопримечательностью...', 'Все смотрят... мне приятно~'],
      driverLine: ['Второй кран на подходе.', 'Домкраты под платформу!'],
    },

    /* ══════════ 9 — ИМБА ══════════ */ {
      stage: 9, name: 'ИМБА', method: 'convoy', methodName: 'Транспортный конвой',
      seats: 14, seatsTotal: 14, doorFit: 0, boardTime: 40.0, sagMult: 3.8, speedMult: 0.3,
      priceMult: 6.0, stuckRisk: 0.6, helpers: 8, minTaxi: 'ultra', anim: 'convoy',
      minigame: 'crane', weightKg: '20–36 тонн',
      desc: 'Требуется конвой: тягач, сопровождение и перекрытие улицы. Друг занимает всю платформу.',
      cabin: 'Платформа занята полностью, борта сняты — они мешали телу.',
      playerSeat: 'Едешь в машине сопровождения впереди, следишь за габаритом.',
      doorNote: 'Погрузка занимает сорок секунд и требует остановки движения на улице.',
      bodyNote: 'Свисает со всех четырёх сторон. Габаритные фонари вешают прямо на складки.',
      sagNote: 'Все шестнадцать колёс под нагрузкой, скорость ограничена 15 км/ч.',
      soundNote: 'Сирены сопровождения, рации, гул толпы зевак.',
      furryLine: ['Улицу перекрыли... из-за меня!', 'Мне немножко стыдно. И приятно.', 'Столько людей пришло~'],
      driverLine: ['Перекрываем Сахарную улицу.', 'Конвой, движение по готовности!'],
    },

    /* ══════════ 10 — ЛЕГЕНДА ══════════ */ {
      stage: 10, name: 'Легенда Sugar City', method: 'legend', methodName: 'Городская операция',
      seats: 20, seatsTotal: 20, doorFit: 0, boardTime: 55.0, sagMult: 4.5, speedMult: 0.22,
      priceMult: 9.0, stuckRisk: 0.65, helpers: 12, minTaxi: 'ultra', anim: 'convoy',
      minigame: 'crane', weightKg: '36+ тонн',
      desc: 'Мэр лично согласовывает маршрут. Три крана, усиленная платформа на 16 колёсах, эскорт.',
      cabin: 'Специальная сцепка из двух платформ — обычная его уже не держит.',
      playerSeat: 'Едешь в открытом кабриолете эскорта, машешь горожанам вместе с ним.',
      doorNote: 'Операция согласуется за сутки, маршрут утверждает лично мэр Тиберий.',
      bodyNote: 'Тело шире проезжей части: убирают фонарные столбы по обеим сторонам.',
      sagNote: 'Асфальт под колёсами продавливается, за конвоем остаётся колея.',
      soundNote: 'Оркестр, аплодисменты, три крана и голос мэра в мегафон.',
      furryLine: ['Мэр пришёл посмотреть...', 'Это... это лучший день в моей жизни.', 'Спасибо, что кормил меня~'],
      driverLine: ['Мэр дал зелёный свет.', 'Легенда едет! Все по местам!'],
    },
  ];

  /* ============================================================
   * СИСТЕМА ПОСАДКИ
   * ============================================================ */
  class BoardingSystem {
    constructor(game) {
      this.game = game;
      this.active = false;
      this.phase = null;         // approach | fitting | stuck | loading | seated
      this.progress = 0;
      this.info = null;
      this.taxiDef = null;
      this.props = new THREE.Group();
      game.scene.add(this.props);
      this.stuckAttempts = 0;
      this.history = [];         // записи о посадках
    }

    /** Данные посадки для текущей стадии */
    infoFor(stage) {
      return BOARDING[U.clamp(stage, 0, BOARDING.length - 1)];
    }

    /** Подходит ли такси под текущий размер друга */
    canFit(taxiDef, stage) {
      const info = this.infoFor(stage);
      const order = ['normal', 'big', 'mega', 'ultra'];
      return order.indexOf(taxiDef.id) >= order.indexOf(info.minTaxi);
    }

    /** Итоговая цена поездки с надбавкой за габарит */
    priceFor(taxiDef, stage) {
      return Math.round(taxiDef.price * this.infoFor(stage).priceMult);
    }

    /**
     * Начать посадку. Возвращает промис-подобный колбэк через onComplete.
     */
    begin(taxiDef, onComplete) {
      const g = this.game;
      const stage = g.furry.stage;
      const info = this.infoFor(stage);
      this.info = info;
      this.taxiDef = taxiDef;
      this.onComplete = onComplete;
      this.active = true;
      this.progress = 0;
      this.stuckAttempts = 0;

      // Проверка: влезет ли вообще в это такси
      if (!this.canFit(taxiDef, stage)) {
        const need = FF.TAXIS.find((t) => t.id === info.minTaxi);
        g.notify(`🚫 ${g.furry.opts.name} не влезет в «${taxiDef.name}»! Нужно: ${need.icon} ${need.name}`, 'warn');
        g.furry.say(U.pick(['Я туда не помещусь...', 'Оно слишком маленькое для меня~']));
        this.active = false;
        return false;
      }

      // Пошаговый рассказ о посадке — детали зависят от размера
      g.notify(`${taxiDef.icon} ${info.methodName} · ${info.seats} из ${info.seatsTotal} мест · ${info.weightKg}`, 'info');
      g.furry.say(U.pick(info.furryLine));
      const steps = [
        [1200, `🚪 ${info.doorNote}`],
        [2600, `🗣 Водитель: «${U.pick(info.driverLine)}»`],
        [4200, `🐾 ${info.bodyNote}`],
        [5800, `🪑 ${info.cabin}`],
        [7400, `⚙️ ${info.sagNote}`],
        [9000, `🧍 ${info.playerSeat}`],
      ];
      this._timers = [];
      for (const [delay, msg] of steps) {
        if (delay > info.boardTime * 1000) break;   // короткая посадка — меньше реплик
        this._timers.push(setTimeout(() => { if (this.active) g.notify(msg, 'info'); }, delay));
      }

      this.phase = 'approach';
      this._buildProps();
      return true;
    }

    /** Визуальные атрибуты посадки: пандус, лебёдка, ремни, помощники */
    _buildProps() {
      this._clearProps();
      const g = this.game;
      const taxi = g.taxi.mesh;
      if (!taxi) return;
      const pos = taxi.position.clone();
      const m = this.info.method;

      if (m === 'ramp' || m === 'winch') {
        // Пандус от земли к платформе
        const ramp = new THREE.Mesh(
          new THREE.BoxGeometry(3.2, 0.18, 5.5),
          new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.7, metalness: 0.4 }));
        ramp.position.set(pos.x, pos.y + 0.9, pos.z - this.taxiDef.len / 2 - 2.4);
        ramp.rotation.x = -0.34;
        ramp.castShadow = true;
        this.props.add(ramp);
        this.rampMesh = ramp;
      }
      if (m === 'winch') {
        // Трос лебёдки
        const cable = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 7, 6),
          new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5, metalness: 0.7 }));
        cable.rotation.x = Math.PI / 2 - 0.3;
        cable.position.set(pos.x, pos.y + 2.2, pos.z - this.taxiDef.len / 2 - 2);
        this.props.add(cable);
        this.cableMesh = cable;
      }
      if (m === 'crane' || m === 'crane_double' || m === 'convoy' || m === 'legend') {
        // Кран(ы)
        const count = m === 'crane' ? 1 : m === 'crane_double' ? 2 : 3;
        this.craneArms = [];
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * 7;
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.34, 0.42, 14, 8),
            new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.55, metalness: 0.5 }));
          post.position.set(pos.x + off, pos.y + 7, pos.z + 9);
          post.castShadow = true;
          this.props.add(post);
          const arm = new THREE.Mesh(
            new THREE.BoxGeometry(0.55, 0.55, 15),
            new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.55, metalness: 0.5 }));
          arm.position.set(pos.x + off, pos.y + 13.4, pos.z + 2);
          arm.castShadow = true;
          this.props.add(arm);
          this.craneArms.push(arm);
        }
        // Ремни под друга
        this.strapMeshes = [];
        const straps = this.info.seats >= 9 ? 6 : 4;
        for (let i = 0; i < straps; i++) {
          const strap = new THREE.Mesh(
            new THREE.TorusGeometry(1.6 * g.furry.bodyScale, 0.09, 6, 20, Math.PI),
            new THREE.MeshStandardMaterial({ color: 0xd8a838, roughness: 0.85 }));
          strap.rotation.z = Math.PI;
          strap.position.copy(g.furry.root.position);
          strap.position.y += 0.4;
          strap.position.z += (i - straps / 2) * 0.7 * g.furry.bodyScale;
          this.props.add(strap);
          this.strapMeshes.push(strap);
        }
      }
      // Помощники-NPC
      this.helperMeshes = [];
      for (let i = 0; i < this.info.helpers; i++) {
        const helper = new THREE.Group();
        const col = new THREE.Color().setHSL(Math.random(), 0.5, 0.6);
        const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 });
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 5, 10), mat);
        body.position.y = 0.85;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 9), mat);
        head.position.y = 1.42;
        helper.add(body, head);
        const a = (i / Math.max(1, this.info.helpers)) * Math.PI * 1.4 - 0.7;
        helper.position.set(
          g.furry.root.position.x + Math.sin(a) * (2.2 * g.furry.bodyScale),
          g.furry.root.position.y,
          g.furry.root.position.z + Math.cos(a) * (2.2 * g.furry.bodyScale) - 1
        );
        helper.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        this.props.add(helper);
        this.helperMeshes.push(helper);
      }
    }

    _clearProps() {
      while (this.props.children.length) {
        const c = this.props.children[0];
        this.props.remove(c);
        c.traverse && c.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose && o.material.dispose();
        });
      }
      this.craneArms = null; this.strapMeshes = null; this.helperMeshes = null;
      this.rampMesh = null; this.cableMesh = null;
    }

    update(dt) {
      if (!this.active) return;
      const g = this.game;
      const info = this.info;
      const f = g.furry;
      const taxi = g.taxi.mesh;
      if (!taxi) { this.abort(); return; }

      this.progress += dt / info.boardTime;

      // Друг движется к машине и «загружается»
      const target = taxi.position.clone();
      target.y += this.taxiDef.h * 0.85;
      target.z -= this.taxiDef.len * 0.26;

      const t = U.clamp(this.progress, 0, 1);
      const ease = t * t * (3 - 2 * t);

      if (this.phase === 'approach') {
        // Подходит / подтаскивается к машине
        const start = this._startPos || (this._startPos = f.root.position.clone());
        const midY = info.method === 'crane' || info.method === 'crane_double'
          || info.method === 'convoy' || info.method === 'legend'
          ? Math.sin(t * Math.PI) * (4 + f.bodyScale * 2) : 0;
        f.root.position.lerpVectors(start, target, ease);
        f.root.position.y += midY;

        // Колыхание при транспортировке — чем больше, тем сильнее
        if (Math.random() < dt * 6) {
          f.wave(f.root.position.clone().add(new THREE.Vector3(0, 1, 0)), 0.5 + info.sagMult * 0.3);
        }
        // Ремни следуют за телом
        if (this.strapMeshes) {
          this.strapMeshes.forEach((s, i) => {
            s.position.copy(f.root.position);
            s.position.y += 0.4;
            s.position.z += (i - this.strapMeshes.length / 2) * 0.7 * f.bodyScale;
          });
        }
        // Звуки натуги
        if (Math.random() < dt * 1.4) {
          g.audio.creak();
          if (info.helpers > 0 && Math.random() < 0.4) g.audio.voice('breath', f.opts.species, 0.8);
        }

        // Проверка на застревание — только для методов через дверь
        const doorMethods = ['self_slow', 'assisted', 'ramp'];
        if (!this._stuckChecked && t > 0.45 && doorMethods.includes(info.method)) {
          this._stuckChecked = true;
          if (Math.random() < info.stuckRisk) {
            this.phase = 'stuck';
            g.notify(`😰 ${f.opts.name} ЗАСТРЯЛ в дверном проёме!`, 'warn');
            f.say(U.pick(['Я застрял! Помоги!', 'Ой-ой, ни туда ни сюда!', 'Тяни меня!']));
            g.audio.slap(1.5);
            f.setEmotion('shy', 5);
            // Мини-игра вызволения
            g.startMinigame(info.minigame || 'push_in', null, (q) => {
              if (q > 0.35) {
                this.phase = 'approach';
                this.progress = Math.min(0.9, this.progress + 0.25);
                g.notify('💪 Вытолкнули! Друг внутри.', 'quest');
                f.say('Спасибо! Я думал, останусь тут навсегда~');
              } else {
                this.stuckAttempts++;
                if (this.stuckAttempts >= 2) {
                  g.notify('🚫 Не получилось. Нужно такси побольше.', 'warn');
                  this.abort();
                } else {
                  this.phase = 'stuck';
                  this._stuckChecked = false;
                  g.notify('😅 Не вышло. Пробуем ещё раз!', 'warn');
                  this.phase = 'approach';
                }
              }
            });
            return;
          }
        }

        if (t >= 1) this._finishBoarding();
      }

      // Кран опускает стрелу
      if (this.craneArms) {
        for (const arm of this.craneArms) {
          arm.rotation.x = -0.1 + Math.sin(t * Math.PI) * 0.14;
        }
      }
      // Помощники толкают
      if (this.helperMeshes) {
        for (const h of this.helperMeshes) {
          h.position.y = f.root.position.y + Math.abs(Math.sin(performance.now() * 0.008)) * 0.06;
          h.lookAt(f.root.position.x, h.position.y, f.root.position.z);
        }
      }
    }

    _clearTimers() {
      if (this._timers) for (const t of this._timers) clearTimeout(t);
      this._timers = [];
    }

    _finishBoarding() {
      this._clearTimers();
      const g = this.game;
      const info = this.info;
      this.phase = 'seated';
      this.active = false;
      this._startPos = null;
      this._stuckChecked = false;

      // Просадка подвески по стадии
      g.taxi.extraSag = info.sagMult;
      g.taxi.speedMult = info.speedMult;
      g.taxi.seatsUsed = info.seats;

      g.notify(`✅ ${g.furry.opts.name} на борту: ${info.seats}/${info.seatsTotal} мест · скорость ${Math.round(info.speedMult * 100)}% · ${info.soundNote}`, 'quest');
      g.audio.creak();
      g.audio.creak();
      g.furry.setEmotion('content', 6);

      // Запись в дневник
      if (g.notebook) {
        g.notebook.add(`🚕 Посадка в такси (${info.name}): ${info.methodName}. Занял ${info.seats} мест.`, 'place');
      }
      this.history.push({ stage: info.stage, day: g.day, method: info.method });
      if (info.stage >= 7) g.achieve('crane_ride');
      if (info.stage >= 9) g.achieve('convoy_ride');

      setTimeout(() => this._clearProps(), 2500);
      this.onComplete && this.onComplete();
    }

    abort() {
      this._clearTimers();
      this.active = false;
      this.phase = null;
      this._startPos = null;
      this._stuckChecked = false;
      this._clearProps();
      this.game.notify('🚕 Посадка отменена.', 'warn');
    }

    /** Справка для UI: полная таблица по всем стадиям */
    table() { return BOARDING; }
  }

  FF.BOARDING = BOARDING;
  FF.BoardingSystem = BoardingSystem;
})(typeof window !== 'undefined' ? window : globalThis);
