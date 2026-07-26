/**
 * config.js
 * «Толстый Друг: Утопия Наслаждений»
 * Глобальная конфигурация игры: константы, 60 зон роста, еда, ингредиенты,
 * рецепты, эликсиры, локации, NPC, такси, достижения.
 *
 * Никаких «магических чисел» в игровой логике — всё живёт здесь.
 * @version 1.0.0
 */
(function (global) {
  'use strict';

  const FF = (global.FF = global.FF || {});

  /* ============================================================
   * 1. ОБЩИЕ КОНСТАНТЫ ДВИЖКА
   * ============================================================ */
  const CONFIG = {
    version: '1.0.0',
    title: 'Толстый Друг: Утопия Наслаждений',

    // --- Рендер ---
    render: {
      fov: 68,
      near: 0.05,
      far: 900,
      pixelRatioCap: 2,
      shadowMapSize: 2048,
      exposure: 1.06,
    },

    // --- Пост-обработка ---
    post: {
      bloomStrength: 0.85,
      bloomThreshold: 0.72,
      bloomRadius: 1.15,
      vignette: 0.42,
      grain: 0.045,
      chromatic: 0.0016,
      enabled: true,
    },

    // --- Физика / игрок ---
    player: {
      height: 1.72,
      radius: 0.32,
      eyeHeight: 1.62,
      crouchHeight: 0.95,
      walkSpeed: 3.6,
      runSpeed: 6.4,
      climbSpeed: 1.5,
      jumpVelocity: 5.1,
      gravity: -18.6,
      maxStamina: 100,
      staminaHangDrain: 3.2,      // в секунду при висении
      staminaGripDrain: 7.5,      // при усиленном хвате (Shift)
      staminaRegen: 12.0,         // на земле
      reach: 2.6,                 // дальность рук
      pokeImpulse: 3.4,
      slapImpulse: 7.5,
      massageImpulse: 0.55,
    },

    // --- Время суток ---
    time: {
      startHour: 18.2,            // вечный golden hour на старте
      minutesPerRealSecond: 0.75, // 1 реальная секунда = 45 игровых секунд
      goldenHourLock: true,       // «вечный закат» пока игрок не отключит
    },

    // --- Экономика ---
    economy: {
      startCoins: 45,
      dailyLogin: 10,
      cafeShiftPay: 20,
      bakeryShiftPay: 25,
      sellRatio: 0.55,            // доля цены при продаже
    },

    // --- Кормление ---
    feeding: {
      hungerPeriodMin: 10,        // игровых минут до лёгкого голода
      moodBonus: { great: 0.30, good: 0.10, neutral: 0.0, bad: -0.20, awful: -0.40 },
      spaBonusDuration: 60,       // игровых минут +20%
      spaBonusMult: 0.20,
      chewTimePerCal: 0.09,
      swallowsMin: 1,
      swallowsMax: 6,
      relationPerCalorie: 0.02,
    },

    // --- Рост ---
    growth: {
      caloriesToKg: 0.045,        // 1 калория контента = 45 г массы
      baseMassKg: 62,
      stageThresholds: [0, 250, 1200, 4500, 12000, 28000, 60000, 110000, 220000, 400000, 800000],
      stageNames: [
        'Стройняшка', 'Мягонький', 'Пухляш', 'Полненький', 'Толстяк',
        'Жирдяй', 'Громадина', 'Гигант', 'Колосс', 'ИМБА', 'Легенда Sugar City',
      ],
      immobileStage: 6,           // с этой стадии нужен эликсир для ходьбы
      lerpSpeed: 0.9,             // скорость визуальной интерполяции роста
    },

    // --- Мягкое тело (глобальные множители) ---
    soft: {
      globalDamping: 0.955,
      neighborCoupling: 0.22,     // передача волны между узлами решётки
      gravitySag: 0.55,
      waveDecay: 0.9,
      maxOffset: 0.55,
      substeps: 2,
    },

    // --- Аудио ---
    audio: {
      masterVolume: 0.75,
      musicVolume: 0.35,
      sfxVolume: 0.8,
      furryVolume: 0.9,
    },

    save: { key: 'fatfriend_save_v1', autosaveSeconds: 60 },
  };

  /* ============================================================
   * 2. СКОРОСТИ РОСТА ЗОН
   * ============================================================ */
  const SPEED = {
    LIGHTNING: { id: 'lightning', label: '🐇🐇🐇 Молния', mult: 1.00, start: 0 },
    FAST:      { id: 'fast',      label: '🐇🐇 Быстро',   mult: 0.78, start: 150 },
    MEDFAST:   { id: 'medfast',   label: '🐇 Средне-быстро', mult: 0.55, start: 900 },
    MEDSLOW:   { id: 'medslow',   label: '🐢 Средне-медленно', mult: 0.36, start: 3200 },
    SLOW:      { id: 'slow',      label: '🐢🐢 Медленно', mult: 0.22, start: 9500 },
    VERYSLOW:  { id: 'veryslow',  label: '🐢🐢🐢 Очень медленно', mult: 0.12, start: 26000 },
  };

  /* ============================================================
   * 3. ШЕСТЬДЕСЯТ ЗОН РОСТА
   * ------------------------------------------------------------
   * pos    — якорь в локальном пространстве тела (метры, ноги = y0)
   * dir    — направление «выпирания» (нормализуется)
   * radius — радиус влияния на вершины меша
   * gain   — максимальное смещение (м) при полном росте
   * soft   — мягкость (0 твёрдый .. 1 желе) => kLST аналог
   * damp   — затухание колебаний
   * mass   — условная масса узла решётки (инерция)
   * grab   — можно ли хвататься при карабканье
   * ============================================================ */
  const Z = (id, name, group, pos, dir, radius, gain, speed, soft, damp, mass, grab, extra) =>
    Object.assign({
      id, name, group, pos, dir, radius, gain, speed,
      soft, damp, mass, grab: !!grab,
      folds: [],
      sound: 'soft',
    }, extra || {});

  const ZONES = [
    /* ---------- БЛОК 1: ЖИВОТ И ТОРС (10) ---------- */
    Z('upper_belly', 'Верхний живот', 'belly', [0, 1.28, 0.20], [0, 0.15, 1], 0.52, 0.62, SPEED.FAST, 0.85, 0.30, 22, true,
      { folds: [8000, 30000], sound: 'pum' }),
    Z('mid_belly', 'Средний живот ⭐', 'belly', [0, 1.05, 0.26], [0, -0.05, 1], 0.70, 1.35, SPEED.LIGHTNING, 0.95, 0.20, 46, true,
      { folds: [5000, 20000, 50000, 150000], sound: 'ploh', main: true }),
    Z('lower_belly', 'Нижний живот', 'belly', [0, 0.82, 0.24], [0, -0.35, 1], 0.58, 1.05, SPEED.FAST, 0.93, 0.22, 34, true,
      { folds: [12000, 45000], sound: 'ploh' }),
    Z('apron_fold', 'Apron fold (нижний фартук)', 'belly', [0, 0.60, 0.20], [0, -0.9, 0.6], 0.50, 0.95, SPEED.SLOW, 0.97, 0.16, 28, true,
      { folds: [30000, 90000], sound: 'flop', shelter: true }),
    Z('left_flank', 'Левый бок', 'belly', [-0.40, 1.05, 0.02], [-1, 0, 0.15], 0.46, 0.72, SPEED.FAST, 0.9, 0.26, 20, true),
    Z('right_flank', 'Правый бок', 'belly', [0.40, 1.05, 0.02], [1, 0, 0.15], 0.46, 0.72, SPEED.FAST, 0.9, 0.26, 20, true),
    Z('muffin_top', 'Muffin top', 'belly', [0, 0.94, -0.02], [0, 0.4, 0], 0.55, 0.34, SPEED.MEDFAST, 0.88, 0.28, 12, true,
      { folds: [9000] }),
    Z('side_belly_folds', 'Боковые складки живота', 'belly', [-0.46, 0.88, 0.16], [-0.8, -0.2, 0.5], 0.36, 0.42, SPEED.MEDSLOW, 0.92, 0.24, 11, true,
      { mirror: 'right', folds: [15000] }),
    Z('subrib_fold', 'Подрёберная складка', 'belly', [0, 1.34, 0.16], [0, -0.3, 1], 0.34, 0.30, SPEED.MEDSLOW, 0.86, 0.30, 9, true),
    Z('navel', 'Пупок (углубление)', 'belly', [0, 1.00, 0.36], [0, 0, 1], 0.13, -0.16, SPEED.MEDSLOW, 0.99, 0.35, 3, false,
      { inverted: true, sound: 'squish' }),

    /* ---------- БЛОК 2: ЯГОДИЦЫ И БЁДРА (10) ---------- */
    Z('lower_left_glute', 'Нижняя левая ягодица', 'glutes', [-0.24, 0.80, -0.28], [-0.25, -0.25, -1], 0.44, 0.98, SPEED.LIGHTNING, 0.94, 0.21, 30, true,
      { folds: [10000, 40000], sound: 'ploh' }),
    Z('lower_right_glute', 'Нижняя правая ягодица', 'glutes', [0.24, 0.80, -0.28], [0.25, -0.25, -1], 0.44, 0.98, SPEED.LIGHTNING, 0.94, 0.21, 30, true,
      { folds: [10000, 40000], sound: 'ploh' }),
    Z('upper_left_glute', 'Верхняя левая ягодица', 'glutes', [-0.22, 1.00, -0.30], [-0.2, 0.3, -1], 0.38, 0.62, SPEED.FAST, 0.9, 0.24, 18, true),
    Z('upper_right_glute', 'Верхняя правая ягодица', 'glutes', [0.22, 1.00, -0.30], [0.2, 0.3, -1], 0.38, 0.62, SPEED.FAST, 0.9, 0.24, 18, true),
    Z('back_shelf', '«Полка» над попой', 'glutes', [0, 1.12, -0.30], [0, 0.55, -0.9], 0.42, 0.40, SPEED.MEDFAST, 0.87, 0.27, 12, true,
      { platform: true }),
    Z('outer_left_thigh', 'Внешнее левое бедро', 'thighs', [-0.40, 0.62, -0.04], [-1, 0, 0], 0.40, 0.72, SPEED.FAST, 0.9, 0.25, 22, true),
    Z('outer_right_thigh', 'Внешнее правое бедро', 'thighs', [0.40, 0.62, -0.04], [1, 0, 0], 0.40, 0.72, SPEED.FAST, 0.9, 0.25, 22, true),
    Z('upper_left_thigh', 'Верхнее левое бедро', 'thighs', [-0.26, 0.72, 0.14], [-0.4, 0.2, 0.9], 0.34, 0.55, SPEED.FAST, 0.92, 0.24, 17, true),
    Z('upper_right_thigh', 'Верхнее правое бедро', 'thighs', [0.26, 0.72, 0.14], [0.4, 0.2, 0.9], 0.34, 0.55, SPEED.FAST, 0.92, 0.24, 17, true),
    Z('undergluteal_folds', 'Подъягодичные складки', 'glutes', [0, 0.58, -0.26], [0, -0.8, -0.6], 0.40, 0.34, SPEED.SLOW, 0.95, 0.20, 10, true,
      { folds: [22000] }),

    /* ---------- БЛОК 3: ГРУДЬ (6) ---------- */
    Z('left_moob', 'Левая грудь (moob)', 'chest', [-0.22, 1.48, 0.20], [-0.35, -0.25, 1], 0.34, 0.72, SPEED.MEDFAST, 0.94, 0.19, 18, true,
      { sound: 'ploh', folds: [18000] }),
    Z('right_moob', 'Правая грудь (moob)', 'chest', [0.22, 1.48, 0.20], [0.35, -0.25, 1], 0.34, 0.72, SPEED.MEDFAST, 0.94, 0.19, 18, true,
      { sound: 'ploh', folds: [18000] }),
    Z('upper_chest', 'Верхняя грудь', 'chest', [0, 1.60, 0.18], [0, 0.35, 1], 0.36, 0.34, SPEED.MEDSLOW, 0.82, 0.30, 11, true),
    Z('under_chest_folds', 'Складки под грудью', 'chest', [0, 1.36, 0.24], [0, -0.6, 0.8], 0.30, 0.26, SPEED.SLOW, 0.95, 0.20, 7, true,
      { folds: [25000], hot: true }),

    /* ---------- БЛОК 4: ЛИЦО, ШЕЯ, ГОЛОВА (10) ---------- */
    Z('left_cheek', 'Левая щека', 'face', [-0.13, 2.02, 0.14], [-0.7, 0, 0.8], 0.13, 0.16, SPEED.MEDFAST, 0.8, 0.32, 3, false, { sound: 'squish' }),
    Z('right_cheek', 'Правая щека', 'face', [0.13, 2.02, 0.14], [0.7, 0, 0.8], 0.13, 0.16, SPEED.MEDFAST, 0.8, 0.32, 3, false, { sound: 'squish' }),
    Z('chin1', 'Первый подбородок', 'face', [0, 1.92, 0.16], [0, -0.5, 1], 0.15, 0.20, SPEED.MEDFAST, 0.9, 0.26, 4, false),
    Z('chin2', 'Двойной подбородок', 'face', [0, 1.85, 0.15], [0, -0.7, 0.9], 0.17, 0.26, SPEED.MEDSLOW, 0.93, 0.22, 6, false, { folds: [14000] }),
    Z('chin3', 'Тройной подбородок', 'face', [0, 1.78, 0.13], [0, -0.85, 0.8], 0.19, 0.30, SPEED.VERYSLOW, 0.95, 0.20, 8, false, { folds: [40000] }),
    Z('front_neck', 'Передняя шея', 'neck', [0, 1.76, 0.10], [0, -0.2, 1], 0.20, 0.28, SPEED.MEDSLOW, 0.9, 0.25, 7, false),
    Z('nape', 'Загривок', 'neck', [0, 1.78, -0.14], [0, 0.2, -1], 0.22, 0.34, SPEED.SLOW, 0.86, 0.28, 9, true),
    Z('side_neck_rolls', 'Боковые шейные валики', 'neck', [-0.19, 1.78, 0], [-1, 0, 0], 0.18, 0.24, SPEED.SLOW, 0.9, 0.26, 6, false, { mirror: 'right' }),
    Z('muzzle_lips', 'Губы / мордочка', 'face', [0, 1.98, 0.24], [0, -0.1, 1], 0.12, 0.10, SPEED.SLOW, 0.85, 0.30, 2, false),
    Z('brow_ridges', 'Надбровные валики', 'face', [0, 2.10, 0.16], [0, 0.5, 0.9], 0.12, 0.08, SPEED.VERYSLOW, 0.8, 0.32, 2, false),

    /* ---------- БЛОК 5: РУКИ (8) ---------- */
    Z('left_biceps', 'Левый бицепс («крыло»)', 'arms', [-0.46, 1.44, 0.0], [-1, -0.2, 0], 0.24, 0.44, SPEED.MEDFAST, 0.9, 0.24, 10, true, { sound: 'ploh' }),
    Z('right_biceps', 'Правый бицепс («крыло»)', 'arms', [0.46, 1.44, 0.0], [1, -0.2, 0], 0.24, 0.44, SPEED.MEDFAST, 0.9, 0.24, 10, true, { sound: 'ploh' }),
    Z('left_forearm', 'Левое предплечье', 'arms', [-0.55, 1.16, 0.02], [-1, -0.3, 0], 0.19, 0.26, SPEED.MEDSLOW, 0.85, 0.28, 6, true),
    Z('right_forearm', 'Правое предплечье', 'arms', [0.55, 1.16, 0.02], [1, -0.3, 0], 0.19, 0.26, SPEED.MEDSLOW, 0.85, 0.28, 6, true),
    Z('left_elbow', 'Левый локоть', 'arms', [-0.52, 1.28, -0.02], [-1, 0, -0.3], 0.13, 0.14, SPEED.SLOW, 0.78, 0.32, 3, false),
    Z('right_elbow', 'Правый локоть', 'arms', [0.52, 1.28, -0.02], [1, 0, -0.3], 0.13, 0.14, SPEED.SLOW, 0.78, 0.32, 3, false),
    Z('left_paw', 'Левая лапа', 'arms', [-0.60, 0.98, 0.04], [-1, -0.4, 0.2], 0.14, 0.14, SPEED.SLOW, 0.8, 0.30, 3, false, { sound: 'squish' }),
    Z('right_paw', 'Правая лапа', 'arms', [0.60, 0.98, 0.04], [1, -0.4, 0.2], 0.14, 0.14, SPEED.SLOW, 0.8, 0.30, 3, false, { sound: 'squish' }),

    /* ---------- БЛОК 6: НОГИ (8) ---------- */
    Z('inner_left_thigh', 'Внутреннее левое бедро', 'legs', [-0.14, 0.62, 0.04], [-0.6, 0, 0.5], 0.28, 0.42, SPEED.MEDSLOW, 0.95, 0.21, 12, true, { friction: true, hot: true }),
    Z('inner_right_thigh', 'Внутреннее правое бедро', 'legs', [0.14, 0.62, 0.04], [0.6, 0, 0.5], 0.28, 0.42, SPEED.MEDSLOW, 0.95, 0.21, 12, true, { friction: true, hot: true }),
    Z('left_knee', 'Левое колено', 'legs', [-0.24, 0.42, 0.06], [-0.6, 0, 0.8], 0.16, 0.18, SPEED.SLOW, 0.8, 0.30, 5, false),
    Z('right_knee', 'Правое колено', 'legs', [0.24, 0.42, 0.06], [0.6, 0, 0.8], 0.16, 0.18, SPEED.SLOW, 0.8, 0.30, 5, false),
    Z('left_calf', 'Левая икра', 'legs', [-0.25, 0.28, -0.06], [-0.7, 0, -0.6], 0.18, 0.26, SPEED.MEDSLOW, 0.86, 0.27, 7, true),
    Z('right_calf', 'Правая икра', 'legs', [0.25, 0.28, -0.06], [0.7, 0, -0.6], 0.18, 0.26, SPEED.MEDSLOW, 0.86, 0.27, 7, true),
    Z('left_ankle', 'Левая лодыжка', 'legs', [-0.24, 0.12, 0], [-0.8, 0, 0], 0.11, 0.12, SPEED.SLOW, 0.8, 0.30, 3, false),
    Z('right_ankle', 'Правая лодыжка', 'legs', [0.24, 0.12, 0], [0.8, 0, 0], 0.11, 0.12, SPEED.SLOW, 0.8, 0.30, 3, false),

    /* ---------- БЛОК 7: СПИНА (6) ---------- */
    Z('upper_back', 'Верхняя спина', 'back', [0, 1.55, -0.22], [0, 0.2, -1], 0.40, 0.44, SPEED.MEDSLOW, 0.85, 0.28, 14, true),
    Z('scapular_folds', 'Лопаточные складки', 'back', [-0.24, 1.48, -0.24], [-0.5, 0, -1], 0.26, 0.28, SPEED.MEDSLOW, 0.9, 0.25, 8, true, { mirror: 'right', folds: [20000] }),
    Z('lumbar_cushion', 'Поясничная подушка', 'back', [0, 1.20, -0.26], [0, 0, -1], 0.36, 0.50, SPEED.MEDFAST, 0.9, 0.24, 15, true),
    Z('spine_groove', 'Позвоночная борозда', 'back', [0, 1.35, -0.30], [0, 0, -1], 0.10, -0.14, SPEED.SLOW, 0.98, 0.34, 3, false, { inverted: true }),
    Z('left_shoulder', 'Левое плечо', 'back', [-0.38, 1.64, -0.02], [-0.8, 0.6, 0], 0.24, 0.30, SPEED.MEDSLOW, 0.82, 0.30, 9, true),
    Z('right_shoulder', 'Правое плечо', 'back', [0.38, 1.64, -0.02], [0.8, 0.6, 0], 0.24, 0.30, SPEED.MEDSLOW, 0.82, 0.30, 9, true),

    /* ---------- БЛОК 8: ПРОЧЕЕ (8) ---------- */
    Z('tail_base', 'Основание хвоста', 'misc', [0, 0.98, -0.36], [0, 0.1, -1], 0.20, 0.36, SPEED.MEDSLOW, 0.9, 0.25, 8, true),
    Z('left_foot', 'Левая стопа', 'misc', [-0.24, 0.05, 0.08], [0, -0.4, 0.8], 0.14, 0.10, SPEED.VERYSLOW, 0.85, 0.30, 3, false),
    Z('right_foot', 'Правая стопа', 'misc', [0.24, 0.05, 0.08], [0, -0.4, 0.8], 0.14, 0.10, SPEED.VERYSLOW, 0.85, 0.30, 3, false),
    Z('front_midline', 'Передняя центральная линия', 'misc', [0, 1.15, 0.34], [0, 0, 1], 0.12, -0.10, SPEED.VERYSLOW, 0.97, 0.33, 3, false, { inverted: true }),
  ];

  // Технический контроль: зон должно быть ровно 60.
  if (ZONES.length !== 60) {
    console.warn('[config] Ожидалось 60 зон, получено:', ZONES.length);
  }

  /* ============================================================
   * 4. ВИДЫ ФУРРИ
   * ============================================================ */
  const SPECIES = {
    fox:    { name: 'Лис',    fur: 0xe0762c, belly: 0xf6e6cf, ear: 0x2a1a12, voice: 'yip',   tail: 'bushy',  scale: 1.00 },
    wolf:   { name: 'Волк',   fur: 0x8a8f99, belly: 0xdfe3e8, ear: 0x3a3f47, voice: 'woof',  tail: 'bushy',  scale: 1.06 },
    dragon: { name: 'Дракон', fur: 0x6fbf7a, belly: 0xf2e28a, ear: 0x3f7a49, voice: 'rrr',   tail: 'spiked', scale: 1.10, scales: true, wings: true },
    lion:   { name: 'Лев',    fur: 0xd9a441, belly: 0xf3e3bd, ear: 0x8a5b1e, voice: 'roar',  tail: 'tuft',   scale: 1.08, mane: true },
    cat:    { name: 'Кот',    fur: 0x9b7bd4, belly: 0xf0e6ff, ear: 0x4a3670, voice: 'mew',   tail: 'thin',   scale: 0.96, purr: true },
    rabbit: { name: 'Кролик', fur: 0xf0e2d8, belly: 0xfffaf4, ear: 0xe8b6b6, voice: 'squeak',tail: 'puff',   scale: 0.94, longEars: true },
    bear:   { name: 'Медведь',fur: 0x6b4a33, belly: 0xc9a582, ear: 0x4a3122, voice: 'grr',   tail: 'puff',   scale: 1.16, startCalories: 900 },
    raccoon:{ name: 'Енот',   fur: 0x777d86, belly: 0xd9dde2, ear: 0x33383f, voice: 'chit',  tail: 'ringed', scale: 0.98, mask: true },
  };

  const FUR_COLORS = [
    0xe0762c, 0xd94f3d, 0xf2a65a, 0xf7d08a, 0xfff3c4, 0xd9d2c5, 0x8a8f99, 0x5a6472,
    0x3a3f47, 0x6b4a33, 0x9b7bd4, 0x6fbf7a, 0x4aa3c7, 0xf28ab2, 0xffffff, 0x2a2a2e,
    0xc7a06b, 0xa8d8b9, 0xffc4d6, 0xb0e0e6,
  ];
  const EYE_COLORS = [
    0x4aa3c7, 0x6fbf7a, 0xd9a441, 0x8a5bd6, 0xd94f3d, 0x2a2a2e, 0xf28ab2, 0x00c2a8,
    0xffd700, 0x87ceeb, 0x9acd32, 0xff6347, 0xdda0dd, 0x40e0d0, 0xffa07a,
  ];

  /* ============================================================
   * 5. ЕДА (46 позиций)
   * cal — калории, price — цена, size — анимация поедания
   * ============================================================ */
  const F = (id, name, icon, cal, price, size, where, extra) =>
    Object.assign({ id, name, icon, cal, price, size, where }, extra || {});

  const FOOD = [
    // --- мелкая ---
    F('candy', 'Конфета', '🍬', 1, 1, 'tiny', 'лотки'),
    F('cookie', 'Печенье', '🍪', 2, 2, 'tiny', 'пекарня'),
    F('mini_cupcake', 'Мини-капкейк', '🧁', 3, 3, 'tiny', 'кафе'),
    F('bread', 'Свежий хлеб', '🍞', 3, 3, 'small', 'пекарня'),
    F('candy_apple', 'Яблоко в карамели', '🍎', 4, 4, 'small', 'лотки'),
    F('donut', 'Пончик', '🍩', 5, 5, 'small', 'кафе'),
    F('pretzel', 'Крендель', '🥨', 5, 5, 'small', 'пекарня'),
    F('icecream', 'Мороженое', '🍦', 6, 6, 'small', 'лотки'),
    F('croissant', 'Круассан', '🥐', 7, 7, 'small', 'пекарня'),
    F('pirozhok', 'Пирожок', '🥟', 7, 7, 'small', 'пекарня'),
    F('muffin', 'Кекс', '🧁', 8, 8, 'small', 'пекарня'),
    F('hot_choco', 'Горячий шоколад', '☕', 8, 9, 'drink', 'Chocolate Dreams'),
    F('choco_bar', 'Плитка шоколада', '🍫', 10, 10, 'small', 'Chocolate Dreams'),
    F('choco_donut', 'Шоколадный пончик', '🍩', 10, 11, 'small', 'Chocolate Dreams'),
    F('coffee_cake', 'Кофе с пирожным', '🍰', 10, 12, 'small', 'Sweet Paw'),
    F('waffle', 'Бельгийская вафля', '🧇', 12, 13, 'medium', 'кафе'),
    F('pancakes', 'Стопка панкейков', '🥞', 14, 15, 'medium', 'кафе'),
    F('cream_pastry', 'Кремовое пирожное', '🍰', 15, 18, 'medium', 'Cream Palace'),
    F('eclair', 'Эклер', '🥖', 16, 19, 'medium', 'Cream Palace'),
    F('cheesecake', 'Чизкейк', '🍰', 18, 22, 'medium', 'Cream Palace'),
    F('pizza', 'Пицца целиком', '🍕', 20, 24, 'medium', 'рынок'),
    F('shake_normal', 'Обычный коктейль', '🥤', 20, 25, 'pump', 'The Pump Cafe'),
    // --- средняя ---
    F('medium_cake', 'Средний торт', '🎂', 25, 30, 'large', 'Cream Palace'),
    F('choco_cake', 'Шоколадный торт', '🍰', 25, 30, 'large', 'Chocolate Dreams'),
    F('honey_pie', 'Медовый пирог', '🥧', 28, 33, 'large', 'крафт'),
    F('berry_tart', 'Ягодный тарт', '🥧', 30, 36, 'large', 'крафт'),
    F('lasagna', 'Лазанья', '🍝', 32, 38, 'large', 'крафт'),
    F('roast', 'Жаркое', '🍖', 35, 42, 'large', 'рынок'),
    F('tiramisu', 'Тирамису', '🍮', 38, 46, 'large', 'Cream Palace'),
    F('shake_mega', 'Мега-коктейль', '🥤', 50, 60, 'pump', 'The Pump Cafe'),
    F('layered_pie', 'Многоярусный пирог', '🥧', 55, 66, 'large', 'крафт'),
    F('choco_volcano', 'Шоколадный вулкан', '🌋', 70, 84, 'huge', 'крафт'),
    F('royal_pie', 'Королевский пирог', '👑', 85, 100, 'huge', 'крафт'),
    // --- крупная ---
    F('big_cake', 'Большой торт', '🎂', 100, 120, 'huge', 'Cream Palace'),
    F('feast_platter', 'Пиршественное блюдо', '🍱', 120, 145, 'huge', 'крафт'),
    F('shake_ultra', 'Ультра-коктейль', '🥤', 150, 175, 'pump', 'The Pump Cafe'),
    F('wedding_cake', 'Свадебный торт', '🎊', 200, 0, 'colossal', 'квест'),
    F('dragon_cake', 'Драконий торт', '🐉', 260, 320, 'colossal', 'крафт'),
    F('rainbow_meringue', 'Радужное безе', '🌈', 300, 360, 'colossal', 'крафт'),
    F('shake_giga', 'Гига-коктейль', '🥤', 500, 0, 'pump', 'квест'),
    // --- легендарная ---
    F('moon_pudding', 'Лунный пудинг', '🌙', 650, 0, 'colossal', 'секрет', { legendary: true }),
    F('phoenix_souffle', 'Суфле феникса', '🔥', 800, 0, 'colossal', 'секрет', { legendary: true }),
    F('stellar_dessert', 'Звёздный десерт', '🌟', 1000, 0, 'colossal', 'квест', { legendary: true, once: true }),
    F('eternal_cake', 'Торт Вечности', '♾️', 1500, 0, 'colossal', 'эндгейм', { legendary: true, once: true }),
    // --- АССОРТИМЕНТ НОВЫХ ЛАВОК ---
    F('lollipop', 'Леденец', '🍭', 2, 2, 'tiny', 'Сахарок'),
    F('marshmallow', 'Зефир', '🍡', 4, 4, 'small', 'Сахарок'),
    F('nougat', 'Нуга', '🍬', 6, 6, 'small', 'Сахарок'),
    F('baklava', 'Пахлава', '🥮', 12, 14, 'medium', 'Сахарок'),
    F('gingerbread', 'Пряничный домик', '🏠', 45, 52, 'large', 'Сахарок'),
    F('sausage', 'Колбаса', '🌭', 9, 10, 'small', 'Сытый Волк'),
    F('steak', 'Стейк', '🥩', 22, 26, 'medium', 'Сытый Волк'),
    F('ribs', 'Рёбрышки', '🍖', 30, 35, 'large', 'Сытый Волк'),
    F('whole_turkey', 'Целая индейка', '🦃', 90, 105, 'huge', 'Сытый Волк'),
    F('salad', 'Салат', '🥗', 4, 5, 'small', 'Грядка'),
    F('corn', 'Кукуруза в масле', '🌽', 7, 8, 'small', 'Грядка'),
    F('pumpkin_pie', 'Тыквенный пирог', '🥧', 26, 30, 'large', 'Грядка'),
    F('yogurt', 'Йогурт', '🥛', 5, 6, 'drink', 'Белый Кот'),
    F('cheese_wheel', 'Головка сыра', '🧀', 40, 46, 'large', 'Белый Кот'),
    F('condensed', 'Банка сгущёнки', '🥫', 18, 20, 'drink', 'Белый Кот'),
    F('butter_block', 'Брусок масла', '🧈', 24, 27, 'medium', 'Белый Кот'),
    F('family_bucket', 'Семейное ведро', '🪣', 160, 180, 'colossal', 'ГИГАНТ'),
    F('mega_pizza', 'Мега-пицца 1 метр', '🍕', 130, 150, 'colossal', 'ГИГАНТ'),
    F('sweet_barrel', 'Бочка сладостей', '🛢️', 240, 270, 'colossal', 'ГИГАНТ'),
    F('feast_cart', 'Тележка яств', '🛒', 380, 430, 'colossal', 'ГИГАНТ'),
    F('pigeon_crumb', 'Крошка для голубей', '🐦', 0.1, 0, 'tiny', 'площадь'),
    F('duck_bread', 'Хлеб для уток', '🦆', 0.1, 0, 'tiny', 'парк'),
  ];

  /* ============================================================
   * 6. ИНГРЕДИЕНТЫ (32)
   * ============================================================ */
  const I = (id, name, icon, price, where, rarity, extra) =>
    Object.assign({ id, name, icon, price, where, rarity }, extra || {});

  const INGREDIENTS = [
    I('flour', 'Мука', '🌾', 2, 'мельница', 'common'),
    I('sugar', 'Сахар', '🍬', 3, 'магазин', 'common'),
    I('milk', 'Молоко', '🥛', 5, 'ферма', 'common'),
    I('egg', 'Яйцо', '🥚', 2, 'ферма', 'common'),
    I('butter', 'Масло', '🧈', 4, 'ферма', 'common'),
    I('cream', 'Крем', '🍦', 6, 'магазин', 'common'),
    I('cocoa', 'Какао-бобы', '🫘', 8, 'шоколадный лес', 'common'),
    I('honey', 'Мёд', '🍯', 9, 'пасека', 'common'),
    I('berry', 'Ягоды', '🫐', 4, 'лес', 'common'),
    I('strawberry', 'Клубника', '🍓', 5, 'лес', 'common'),
    I('apple', 'Яблоко', '🍎', 3, 'сад', 'common'),
    I('grain', 'Зерно', '🌾', 1, 'ферма', 'common'),
    I('salt', 'Соль', '🧂', 1, 'магазин', 'common'),
    I('yeast', 'Дрожжи', '🫧', 3, 'магазин', 'common'),
    I('cheese', 'Сыр', '🧀', 7, 'ферма', 'common'),
    I('goat_milk', 'Козье молоко', '🐐', 14, 'ферма', 'rare'),
    I('vanilla', 'Ванильные бобы', '🌰', 22, 'джунгли', 'rare'),
    I('rose_oil', 'Розовое масло', '🌹', 26, 'сад', 'rare'),
    I('glow_mushroom', 'Светящийся гриб', '🍄', 18, 'шоколадный лес', 'rare'),
    I('moon_dew', 'Лунная роса', '💧', 24, 'лунный ручей', 'rare'),
    I('rainbow_crystal', 'Радужный кристалл', '💎', 45, 'пещера кристаллов', 'rare'),
    I('choco_heart', 'Шоколадное сердце', '🍫', 30, 'Chocolate Dreams', 'rare'),
    I('cinnamon', 'Корица', '🪵', 8, 'рынок', 'common'),
    I('mint', 'Мята', '🌿', 6, 'огород', 'common'),
    I('caramel', 'Карамель', '🍮', 10, 'магазин', 'common'),
    I('ice_fish', 'Ледяная рыба', '🐟', 40, 'ледяное озеро', 'rare'),
    I('star_powder', 'Звёздный порошок', '✨', 90, 'горы', 'epic'),
    I('phoenix_feather', 'Перо феникса', '🪶', 180, 'пик наслаждения', 'epic'),
    I('dragon_milk', 'Драконье молоко', '🐉', 240, 'пещера дракона', 'legendary'),
    I('dragon_saliva', 'Драконья слюна', '💦', 150, 'пещера дракона', 'epic'),
    I('moon_sugar', 'Лунный сахар', '🌙', 120, 'горы (полнолуние)', 'epic'),
    I('dragon_heart', 'Сердце дракона', '❤️‍🔥', 0, 'босс-квест', 'legendary'),
    I('meat', 'Мясо', '🥩', 12, 'мясная лавка', 'common'),
    I('pumpkin', 'Тыква', '🎃', 6, 'овощная лавка', 'common'),
    I('nuts', 'Орехи', '🥜', 7, 'рынок', 'common'),
    I('condensed_milk', 'Сгущёнка', '🥫', 11, 'молочная лавка', 'common'),
    I('gelatin', 'Желатин', '🧊', 5, 'хозтовары', 'common'),
    I('food_color', 'Пищевой краситель', '🎨', 8, 'хозтовары', 'common'),
    I('silk_thread', 'Эластичная нить', '🧵', 15, 'хозтовары', 'rare'),
  ];

  /* ============================================================
   * 7. РЕЦЕПТЫ (52)
   * ============================================================ */
  const R = (out, lvl, mins, ing) => ({ out, level: lvl, minutes: mins, ing });
  const RECIPES = [
    R('cookie', 1, 0.5, { flour: 1, sugar: 1 }),
    R('bread', 1, 0.7, { flour: 2, yeast: 1, salt: 1 }),
    R('mini_cupcake', 1, 0.8, { flour: 1, egg: 1, sugar: 1 }),
    R('donut', 1, 1.0, { flour: 2, egg: 1, sugar: 1, butter: 1 }),
    R('croissant', 2, 1.2, { flour: 3, butter: 2 }),
    R('pirozhok', 2, 1.2, { flour: 2, egg: 1, berry: 2 }),
    R('muffin', 2, 1.3, { flour: 2, egg: 2, sugar: 1 }),
    R('pretzel', 2, 1.0, { flour: 2, salt: 1, butter: 1 }),
    R('candy_apple', 2, 0.8, { apple: 1, caramel: 1, sugar: 1 }),
    R('icecream', 3, 1.2, { milk: 2, sugar: 2, cream: 1 }),
    R('hot_choco', 3, 1.0, { cocoa: 2, milk: 1, sugar: 1 }),
    R('choco_bar', 3, 1.5, { cocoa: 3, sugar: 1, milk: 1 }),
    R('choco_donut', 4, 1.6, { flour: 2, egg: 1, cocoa: 2, sugar: 1 }),
    R('waffle', 4, 1.5, { flour: 2, egg: 2, milk: 1, butter: 1 }),
    R('pancakes', 4, 1.6, { flour: 3, egg: 2, milk: 2, honey: 1 }),
    R('coffee_cake', 4, 1.8, { flour: 2, egg: 1, sugar: 2, cream: 1 }),
    R('cream_pastry', 5, 2.2, { flour: 2, cream: 2, sugar: 1, vanilla: 1 }),
    R('eclair', 5, 2.4, { flour: 2, egg: 2, cream: 2, cocoa: 1 }),
    R('cheesecake', 6, 2.6, { cheese: 2, egg: 2, sugar: 2, cream: 1 }),
    R('pizza', 6, 2.4, { flour: 3, cheese: 2, salt: 1 }),
    R('medium_cake', 7, 3.0, { flour: 3, egg: 2, sugar: 2, milk: 1, butter: 1, cream: 1 }),
    R('choco_cake', 7, 3.0, { flour: 3, egg: 2, cocoa: 3, sugar: 2, butter: 1 }),
    R('honey_pie', 8, 3.2, { flour: 3, honey: 3, egg: 2, butter: 1 }),
    R('berry_tart', 8, 3.4, { flour: 3, berry: 4, strawberry: 2, sugar: 2 }),
    R('lasagna', 9, 3.6, { flour: 4, cheese: 3, egg: 1, salt: 1 }),
    R('tiramisu', 10, 4.0, { cream: 3, cocoa: 2, egg: 3, sugar: 2, vanilla: 1 }),
    R('roast', 10, 4.2, { cheese: 1, salt: 2, mint: 1, butter: 2 }),
    R('shake_normal', 11, 2.0, { milk: 3, sugar: 3, cream: 2, honey: 1 }),
    R('layered_pie', 12, 5.0, { flour: 6, egg: 4, cream: 3, berry: 3, sugar: 3 }),
    R('choco_volcano', 15, 6.0, { cocoa: 6, cream: 3, egg: 3, sugar: 3, butter: 2 }),
    R('royal_pie', 16, 6.5, { flour: 8, egg: 5, cream: 4, honey: 3, vanilla: 2 }),
    R('big_cake', 18, 8.0, { flour: 10, egg: 6, cream: 6, sugar: 6, milk: 4, butter: 3 }),
    R('shake_mega', 18, 5.0, { milk: 6, cream: 4, sugar: 5, honey: 2, cocoa: 3 }),
    R('feast_platter', 20, 9.0, { flour: 8, cheese: 5, roast: 0, egg: 4, salt: 3, butter: 3 }),
    R('shake_ultra', 22, 7.0, { milk: 10, cream: 8, sugar: 8, honey: 4, cocoa: 5, goat_milk: 2 }),
    R('dragon_cake', 30, 12.0, { flour: 14, egg: 10, cream: 8, dragon_milk: 1, cocoa: 8, star_powder: 1 }),
    R('rainbow_meringue', 30, 12.0, { egg: 14, sugar: 12, rainbow_crystal: 2, rose_oil: 2, cream: 6 }),
    R('moon_pudding', 34, 15.0, { moon_sugar: 3, goat_milk: 6, cream: 8, moon_dew: 5, vanilla: 3 }),
    R('phoenix_souffle', 38, 18.0, { phoenix_feather: 1, egg: 16, cream: 10, star_powder: 2, honey: 6 }),
    R('eternal_cake', 45, 25.0, { dragon_heart: 1, phoenix_feather: 2, star_powder: 4, moon_sugar: 4, cream: 20, flour: 20 }),
    // «полуфабрикаты» и мелочи
    R('cream', 3, 0.6, { milk: 2, sugar: 1 }),
    R('butter', 3, 0.6, { milk: 2 }),
    R('caramel', 4, 0.7, { sugar: 2, butter: 1 }),
    R('cheese', 5, 1.5, { milk: 3, salt: 1 }),
    R('choco_heart', 12, 3.0, { cocoa: 5, cream: 2, rose_oil: 1 }),
    R('lollipop', 1, 0.4, { sugar: 2, food_color: 1 }),
    R('marshmallow', 3, 0.9, { sugar: 3, gelatin: 1 }),
    R('nougat', 5, 1.4, { sugar: 3, nuts: 2, honey: 1 }),
    R('baklava', 9, 3.0, { flour: 3, nuts: 4, honey: 3, butter: 2 }),
    R('gingerbread', 14, 5.5, { flour: 8, honey: 4, cinnamon: 2, sugar: 4, egg: 3 }),
    R('sausage', 6, 1.8, { meat: 2, salt: 1 }),
    R('steak', 8, 2.2, { meat: 3, salt: 1, butter: 1 }),
    R('ribs', 11, 3.4, { meat: 5, honey: 1, salt: 2 }),
    R('whole_turkey', 20, 8.0, { meat: 12, salt: 3, butter: 3, mint: 2 }),
    R('salad', 2, 0.6, { apple: 1, mint: 1, salt: 1 }),
    R('corn', 3, 0.8, { grain: 2, butter: 1, salt: 1 }),
    R('pumpkin_pie', 9, 3.2, { pumpkin: 3, flour: 3, egg: 2, cinnamon: 1, sugar: 2 }),
    R('yogurt', 3, 1.0, { milk: 2, berry: 1 }),
    R('cheese_wheel', 13, 5.0, { milk: 8, salt: 2, goat_milk: 1 }),
    R('condensed', 7, 2.4, { milk: 4, sugar: 4 }),
    R('mega_pizza', 21, 8.5, { flour: 10, cheese: 8, meat: 4, salt: 3 }),
    R('family_bucket', 24, 10.0, { meat: 10, flour: 6, cheese: 4, butter: 4, salt: 3 }),
    R('sweet_barrel', 28, 12.0, { sugar: 16, cocoa: 8, cream: 8, honey: 6, nuts: 6 }),
    R('feast_cart', 35, 16.0, { meat: 12, flour: 14, cheese: 8, cream: 8, egg: 10, honey: 5 }),
  ];

  /* ============================================================
   * 8. ЭЛИКСИРЫ
   * ============================================================ */
  const ELIXIRS = [
    { id: 'small', name: 'Малый эликсир', color: 0x4cff7a, minutes: 5, price: 30, brewMin: 5,
      ing: { glow_mushroom: 1, moon_dew: 1, sugar: 1 }, desc: '5 минут подвижности' },
    { id: 'medium', name: 'Средний эликсир', color: 0x4aa3ff, minutes: 30, price: 100, brewMin: 15,
      ing: { glow_mushroom: 3, moon_dew: 5, rainbow_crystal: 1, choco_heart: 1, sugar: 2 }, desc: '30 минут подвижности' },
    { id: 'large', name: 'Большой эликсир', color: 0xb14aff, minutes: 120, price: 500, brewMin: 45,
      ing: { glow_mushroom: 10, moon_dew: 20, rainbow_crystal: 3, choco_heart: 5, star_powder: 1, dragon_saliva: 1 }, desc: '2 часа подвижности' },
    { id: 'gold', name: 'Золотой эликсир', color: 0xffd24a, minutes: Infinity, price: 3000, brewMin: 60,
      ing: { glow_mushroom: 10, moon_dew: 20, rainbow_crystal: 3, choco_heart: 5, star_powder: 1, phoenix_feather: 3 },
      desc: 'ПОСТОЯННАЯ подвижность (1 раз за игру)', once: true },
    { id: 'eternal', name: 'Эликсир Вечной Любви', color: 0xff5ea8, minutes: Infinity, price: 0, brewMin: 120,
      ing: { moon_dew: 12, glow_mushroom: 8, choco_heart: 4, rose_oil: 3, star_powder: 2 },
      desc: 'Связь с другом становится нерушимой: +50% усвоения навсегда', once: true, story: true },
    { id: 'red', name: 'Красный эликсир', color: 0xff3b30, minutes: Infinity, price: 0, brewMin: 90,
      ing: { dragon_heart: 1, phoenix_feather: 3, star_powder: 2 },
      desc: 'Суперсила: гигант может БЕГАТЬ', once: true, endgame: true },
  ];

  /* ============================================================
   * 9. ЛОКАЦИИ SUGAR CITY
   * (x,z — позиция центра в мире; r — радиус зоны; enter — точка входа)
   * ============================================================ */
  const LOCATIONS = [
    { id: 'square',   name: 'Центральная площадь', x: 0,    z: 0,    r: 26, color: 0xffd9a8, music: 'lofi' },
    { id: 'cottage',  name: 'Коттедж',             x: -62,  z: 74,   r: 18, color: 0xffb3c1, music: 'home', home: true },
    { id: 'sweetpaw', name: 'Кафе «Sweet Paw»',    x: 30,   z: -18,  r: 9,  color: 0xffb6d5, music: 'jazz' },
    { id: 'chocodreams', name: 'Кафе «Chocolate Dreams»', x: -32, z: -20, r: 9, color: 0x8a5a3a, music: 'jazz' },
    { id: 'creampalace', name: 'Кафе «Cream Palace»', x: 44, z: 20, r: 10, color: 0xfff4d8, music: 'piano' },
    { id: 'bakery',   name: '«Golden Bakery»',     x: -44,  z: 22,   r: 9,  color: 0xe8c07a, music: 'jazz' },
    { id: 'pumpcafe', name: '«The Pump Cafe»',     x: 8,    z: -46,  r: 11, color: 0x5ac8fa, music: 'ambient' },
    { id: 'lab',      name: 'Лаборатория Артёма',  x: -78,  z: -46,  r: 12, color: 0x2b3a67, music: 'ambient' },
    { id: 'farm',     name: 'Ферма',               x: 96,   z: 68,   r: 24, color: 0x9ad46a, music: 'acoustic' },
    { id: 'mill',     name: 'Мельница',            x: 122,  z: 30,   r: 12, color: 0xc9a06b, music: 'acoustic' },
    { id: 'forest',   name: 'Шоколадный лес',      x: -120, z: 96,   r: 46, color: 0x5c3a24, music: 'forest' },
    { id: 'mountains',name: 'Горы',                x: 40,   z: -180, r: 60, color: 0xdfe9f2, music: 'ambient', locked: 'stage7' },
    { id: 'park',     name: 'Парк с прудом',       x: 66,   z: -60,  r: 26, color: 0x7fc98a, music: 'acoustic' },
    { id: 'market',   name: 'Рынок',               x: -18,  z: 34,   r: 12, color: 0xf0a868, music: 'lofi' },
    { id: 'clothes',  name: 'Одежный магазин',     x: 22,   z: 36,   r: 8,  color: 0xc3a3f0, music: 'lofi' },
    { id: 'club',     name: 'Ночной клуб',         x: -8,   z: 58,   r: 10, color: 0x3a2a5a, music: 'club', nightOnly: true },
    { id: 'post',     name: 'Почта',               x: 52,   z: -2,   r: 7,  color: 0x8ab6f0, music: 'lofi' },
    { id: 'bank',     name: 'Банк',                x: -52,  z: -2,   r: 8,  color: 0xd8d8d8, music: 'lofi' },
    { id: 'library',  name: 'Библиотека',          x: 0,    z: 42,   r: 10, color: 0xa88a6a, music: 'ambient' },
    { id: 'spa',      name: 'Спа-салон',           x: -30,  z: 46,   r: 9,  color: 0xa8e6d8, music: 'ambient' },
    // --- НОВЫЕ МАГАЗИНЫ ---
    { id: 'sweetshop',  name: 'Кондитерская лавка «Сахарок»', x: 14,  z: 52,  r: 8,  color: 0xff9ec4, music: 'lofi' },
    { id: 'butcher',    name: 'Мясная лавка «Сытый Волк»',    x: -40, z: 12,  r: 8,  color: 0xc4685a, music: 'lofi' },
    { id: 'greengrocer',name: 'Овощная лавка «Грядка»',       x: 40,  z: 44,  r: 8,  color: 0x8fc96a, music: 'acoustic' },
    { id: 'dairy',      name: 'Молочная лавка «Белый Кот»',   x: 62,  z: 30,  r: 8,  color: 0xf0f4ff, music: 'lofi' },
    { id: 'alchemshop', name: 'Лавка редкостей «Звёздная Пыль»', x: -66, z: -20, r: 8, color: 0x8a5bd6, music: 'ambient' },
    { id: 'furniture',  name: 'Мебельный «Мягкий Угол»',      x: -20, z: 66,  r: 10, color: 0xc9a06b, music: 'home' },
    { id: 'toolshop',   name: 'Хозтовары «Всё для друга»',    x: 34,  z: 62,  r: 8,  color: 0x7a8a9a, music: 'lofi' },
    { id: 'giantshop',  name: 'Гипермаркет «ГИГАНТ»',         x: 78,  z: -30, r: 16, color: 0xffb84d, music: 'lofi' },
  ];

  /* ============================================================
   * 10. NPC
   * ============================================================ */
  const NPCS = [
    { id: 'artyom', name: 'Артём', species: 'Енот-алхимик', loc: 'lab', color: 0x777d86,
      title: 'Артемий Звёздочётов, алхимик', key: true },
    { id: 'milli', name: 'Милли', species: 'Кошка-бариста', loc: 'sweetpaw', color: 0xf0c0d8 },
    { id: 'bruno', name: 'Бруно', species: 'Медведь-шоколатье', loc: 'chocodreams', color: 0x6b4a33 },
    { id: 'victoria', name: 'Виктория', species: 'Лиса-кондитер', loc: 'creampalace', color: 0xe0762c },
    { id: 'barry', name: 'Барри', species: 'Пёс-пекарь', loc: 'bakery', color: 0xd8b48a },
    { id: 'ignatiy', name: 'Игнатий', species: 'Дракон-инженер', loc: 'pumpcafe', color: 0x6fbf7a },
    { id: 'hopkins', name: 'Хопкинс', species: 'Кролик-фермер', loc: 'farm', color: 0xf0e2d8 },
    { id: 'sebastian', name: 'Себастьян', species: 'Барсук-мельник', loc: 'mill', color: 0x9aa0a8 },
    { id: 'mei', name: 'Мэй', species: 'Панда-массажистка', loc: 'spa', color: 0xf2f2f2 },
    { id: 'athena', name: 'Афина', species: 'Сова-библиотекарь', loc: 'library', color: 0xc7a06b },
    { id: 'pippa', name: 'Пиппа', species: 'Пингвин-почтальон', loc: 'post', color: 0x2a2a3a },
    { id: 'tiberiy', name: 'Мэр Тиберий', species: 'Тигр', loc: 'square', color: 0xf0a63c },
    { id: 'horatio', name: 'Отшельник Гораций', species: 'Козёл-мудрец', loc: 'mountains', color: 0xd8d2c8 },
    { id: 'musician', name: 'Уличный музыкант', species: 'Енот с гитарой', loc: 'square', color: 0x8a8f99 },
    { id: 'couple', name: 'Влюблённая пара', species: 'Волк и лиса', loc: 'park', color: 0xd94f8a },
    { id: 'banker', name: 'Банкир Кроненберг', species: 'Хорёк', loc: 'bank', color: 0xbfae8a },
    { id: 'merchant', name: 'Торговец Зейн', species: 'Шакал', loc: 'market', color: 0xd8a068 },
    { id: 'tailor', name: 'Портниха Сью', species: 'Овца', loc: 'clothes', color: 0xfff0f0 },
    { id: 'dj', name: 'DJ Нео', species: 'Рысь', loc: 'club', color: 0x8a5bd6 },
    // --- ТОРГОВЦЫ НОВЫХ ЛАВОК ---
    { id: 'candy_lady', name: 'Кондитерша Глазурь', species: 'Белка-сладкоежка', loc: 'sweetshop', color: 0xffb6d5 },
    { id: 'butcher_npc', name: 'Мясник Клык', species: 'Волк', loc: 'butcher', color: 0x8a8f99 },
    { id: 'green_npc', name: 'Зеленщица Тыковка', species: 'Хомяк', loc: 'greengrocer', color: 0xd9a441 },
    { id: 'dairy_npc', name: 'Молочник Сливкин', species: 'Кот', loc: 'dairy', color: 0xf0f0f0 },
    { id: 'rare_npc', name: 'Коллекционер Оникс', species: 'Ворон', loc: 'alchemshop', color: 0x3a3a4a },
    { id: 'furn_npc', name: 'Столяр Дубовик', species: 'Бобр', loc: 'furniture', color: 0x8a5a3a },
    { id: 'tool_npc', name: 'Мастер Гвоздик', species: 'Ёж', loc: 'toolshop', color: 0x9aa0a8 },
    { id: 'giant_npc', name: 'Директор Обжоркин', species: 'Морж', loc: 'giantshop', color: 0xc0a890 },
  ];

  /* ============================================================
   * 11. ТАКСИ
   * ============================================================ */
  const TAXIS = [
    { id: 'normal', name: 'Обычное такси', icon: '🚕', minStage: 0, maxStage: 3, speed: 60, price: 5,
      driver: 'Джек (заяц)', color: 0xffc93c, len: 4.6, w: 2.0, h: 1.8, susp: 0.10 },
    { id: 'big', name: 'Большое такси', icon: '🚙', minStage: 3, maxStage: 5, speed: 40, price: 15,
      driver: 'Мэри (енотиха)', color: 0xff9f45, len: 6.4, w: 2.4, h: 2.2, susp: 0.16 },
    { id: 'mega', name: 'Мега-такси', icon: '🚛', minStage: 5, maxStage: 7, speed: 25, price: 40,
      driver: 'Гриша (медведь)', color: 0xef5b5b, len: 9.5, w: 3.2, h: 2.9, susp: 0.24 },
    { id: 'ultra', name: 'Ультра-транспорт', icon: '🚚', minStage: 7, maxStage: 99, speed: 15, price: 100,
      driver: 'Игнатий (дракон)', color: 0x5a6472, len: 14.0, w: 4.4, h: 3.2, susp: 0.34, crane: true, needElixir: true },
  ];

  /* ============================================================
   * 12. ДОСТИЖЕНИЯ (34)
   * ============================================================ */
  const ACHIEVEMENTS = [
    { id: 'first_bite', name: 'Первый шаг', desc: 'Накормить друга впервые' },
    { id: 'stage3', name: 'Пухляш', desc: 'Достичь стадии 3' },
    { id: 'stage5', name: 'Толстяк', desc: 'Достичь стадии 5' },
    { id: 'stage6', name: 'Громадина', desc: 'Достичь стадии 6' },
    { id: 'stage8', name: 'Гигант', desc: 'Достичь стадии 8' },
    { id: 'stage9', name: 'Колосс', desc: 'Достичь стадии 9' },
    { id: 'stage10', name: 'ИМБА', desc: 'Достичь стадии 10' },
    { id: 'cook100', name: 'Кулинар', desc: 'Приготовить 100 блюд' },
    { id: 'cook10', name: 'Поварёнок', desc: 'Приготовить 10 блюд' },
    { id: 'alchemist', name: 'Алхимик', desc: 'Сварить 50 эликсиров' },
    { id: 'alchemist1', name: 'Первое зелье', desc: 'Сварить первый эликсир' },
    { id: 'traveler', name: 'Путешественник', desc: 'Посетить все локации' },
    { id: 'artyom_friend', name: 'Друг Артёма', desc: 'Максимум отношений с Артёмом' },
    { id: 'true_friend', name: 'Настоящий друг', desc: 'Максимум отношений с фурри' },
    { id: 'secrets', name: 'Секретоискатель', desc: 'Найти все секреты' },
    { id: 'gourmet', name: 'Гурман', desc: 'Скормить все виды еды' },
    { id: 'taxi_master', name: 'Мастер такси', desc: 'Прокатиться на всех такси' },
    { id: 'climber', name: 'Скалолаз', desc: 'Забраться на вершину друга' },
    { id: 'under_belly', name: 'Исследователь пещер', desc: 'Побывать под животом' },
    { id: 'massage100', name: 'Массажист', desc: '100 массажей' },
    { id: 'bounce', name: 'Батут', desc: 'Подпрыгнуть на животе 50 раз' },
    { id: 'rich', name: 'Богач', desc: 'Накопить 5000 монет' },
    { id: 'pigeons', name: 'Друг голубей', desc: 'Покормить 50 голубей' },
    { id: 'rainbow_furry', name: 'Радужный друг', desc: '100 конфет подряд' },
    { id: 'night_owl', name: 'Ночной страж', desc: 'Встретить NPC в 3 часа ночи' },
    { id: 'wish_tree', name: 'Дерево желаний', desc: 'Загадать желание в лесу' },
    { id: 'spa_lover', name: 'Любитель спа', desc: '10 сеансов спа' },
    { id: 'quests10', name: 'Помощник', desc: 'Выполнить 10 заданий' },
    { id: 'quests30', name: 'Герой Sugar City', desc: 'Выполнить 30 заданий' },
    { id: 'pump', name: 'Насосный мастер', desc: 'Использовать насос 10 раз' },
    { id: 'legendary_food', name: 'Легенда вкуса', desc: 'Скормить легендарное блюдо' },
    { id: 'gold_elixir', name: 'Свобода движения', desc: 'Использовать золотой эликсир' },
    { id: 'dragon', name: 'Драконоборец', desc: 'Победить дракона в диалоге' },
    { id: 'photographer', name: 'Фотограф', desc: 'Сделать 20 фото' },
    { id: 'story_complete', name: 'Двести сорок первый блокнот', desc: 'Пройти всю историю Артёма' },
    { id: 'eternal_bond', name: 'Вечная связь', desc: 'Использовать Эликсир Вечной Любви' },
    { id: 'first_rip', name: 'Треск ткани', desc: 'Друг впервые порвал одежду' },
    { id: 'wardrobe_destroyer', name: 'Гроза гардеробов', desc: 'Порвать 10 вещей' },
    { id: 'rainbow_seen', name: 'После дождя', desc: 'Увидеть радугу' },
    { id: 'first_photo', name: 'На память', desc: 'Сделать первое фото' },
    { id: 'shopaholic', name: 'Шопоголик', desc: 'Побывать во всех магазинах' },
    { id: 'furnished', name: 'Дом мечты', desc: 'Купить всю мебель' },
    { id: 'thrower', name: 'Меткий бросок', desc: 'Забросить еду прямо в складку' },
    { id: 'physics_nerd', name: 'Физик', desc: 'Включить отладку коллайдеров (F3)' },
    { id: 'crane_ride', name: 'Воздушная погрузка', desc: 'Погрузиться в такси краном' },
    { id: 'convoy_ride', name: 'Улицу перекрыли', desc: 'Проехать в составе конвоя' },
    { id: 'stuck_in_door', name: 'Ни туда ни сюда', desc: 'Застрять в дверном проёме такси' },
    { id: 'squeezed_hard', name: 'Как сардина', desc: 'Испытать сильное сжатие в салоне' },
    { id: 'trapped_in_cabin', name: 'Зажат намертво', desc: 'Оказаться полностью зажатым в такси' },
    { id: 'escaped_squeeze', name: 'Скользкий тип', desc: 'Выбраться из-под массы друга' },
    { id: 'cabin_endurance', name: 'Терпеливый пассажир', desc: '20 секунд под давлением в салоне' },
    { id: 'cab_rest', name: 'Мягкий кокон', desc: 'Отдохнуть в пути на переднем кресле' },
    { id: 'cab_full', name: 'Диван занят', desc: 'Занять задний салон на 100%' },
    { id: 'cab_outgrown', name: 'Слишком большой', desc: 'Перерасти Sugar Cab' },
  ];

  /* ============================================================
   * 13. МИКРО-ЛОКАЦИИ ПОД ЖИВОТОМ
   * ============================================================ */
  const UNDER_BELLY_SPOTS = [
    { id: 'cave1', name: 'Пещера-1', desc: 'Самая большая полость. Тепло, темно, пахнет ванилью.', minCal: 25000, offset: [0, 0.4, 0.35] },
    { id: 'tunnel1', name: 'Тоннель-1', desc: 'Узкий проход между складкой и бедром.', minCal: 40000, offset: [-0.5, 0.3, 0.1] },
    { id: 'shelter', name: 'Складка-убежище', desc: 'Уютно как в гамаке. Можно поспать.', minCal: 60000, offset: [0.45, 0.35, 0.2], sleep: true },
    { id: 'warm_pocket', name: 'Тёплый карман', desc: 'Самая тёплая точка. +стамина.', minCal: 90000, offset: [0, 0.25, -0.15], stamina: true },
    { id: 'lookout', name: 'Смотровая ямка', desc: 'Отсюда живот выглядит как небо.', minCal: 120000, offset: [0, 0.2, 0.55], view: true },
  ];

  /* ============================================================
   * 14. КВЕСТЫ (32)
   * ============================================================ */
  const QUESTS = [
    { id: 'q_intro', npc: 'artyom', name: 'Знакомство с алхимиком', type: 'story',
      desc: 'Найти лабораторию Артёма на окраине города.', goal: { visit: 'lab' }, reward: { coins: 25, item: 'glow_mushroom', count: 2 } },
    { id: 'q_mushrooms', npc: 'artyom', name: 'Светящиеся грибы', type: 'story',
      desc: 'Принести Артёму 10 светящихся грибов из Шоколадного леса.', goal: { item: 'glow_mushroom', count: 10 }, reward: { elixir: 'small', coins: 20 } },
    { id: 'q_dew', npc: 'artyom', name: 'Лунная роса', type: 'story',
      desc: 'Собрать 5 капель лунной росы у Лунного ручья (ночью).', goal: { item: 'moon_dew', count: 5 }, reward: { recipe: 'medium', coins: 40 } },
    { id: 'q_crystal', npc: 'artyom', name: 'Радужный кристалл', type: 'story',
      desc: 'Найти радужный кристалл в пещере кристаллов.', goal: { item: 'rainbow_crystal', count: 1 }, reward: { coins: 50, elixir: 'medium' } },
    { id: 'q_star', npc: 'artyom', name: 'Звёздный порошок', type: 'story',
      desc: 'Достать звёздный порошок в горах.', goal: { item: 'star_powder', count: 1 }, reward: { recipe: 'large', coins: 120 } },
    { id: 'q_phoenix', npc: 'artyom', name: 'Перо феникса', type: 'story',
      desc: 'Подняться на Пик Наслаждения и найти перо феникса.', goal: { item: 'phoenix_feather', count: 1 }, reward: { elixir: 'gold' } },
    { id: 'q_dragon', npc: 'artyom', name: 'Сердце дракона', type: 'story',
      desc: 'Победить дракона в диалоге и получить его сердце.', goal: { item: 'dragon_heart', count: 1 }, reward: { elixir: 'red', coins: 500 } },
    { id: 'q_notes', npc: 'artyom', name: 'Записать эксперимент', type: 'daily', desc: 'Помочь Артёму с записями.', goal: { talk: 'artyom' }, reward: { coins: 20 } },
    { id: 'q_letter', npc: 'artyom', name: 'Письмо соседу', type: 'daily', desc: 'Отнести письмо на почту.', goal: { visit: 'post' }, reward: { coins: 10 } },
    { id: 'q_book', npc: 'artyom', name: 'Потерянная книга', type: 'side', desc: 'Найти книгу Артёма в библиотеке.', goal: { visit: 'library' }, reward: { recipe: 'choco_volcano', coins: 25 } },
    { id: 'q_love', npc: 'artyom', name: 'Давно потерянная любовь', type: 'secret',
      desc: 'Раскрыть тайну Артёма: секретная комната в лаборатории.', goal: { relation: 100 }, reward: { elixir: 'medium', coins: 300, secret: 'eternal_love' } },
    { id: 'q_vanilla', npc: 'milli', name: 'Ванильные бобы', type: 'side', desc: 'Милли нужны 3 ванильных боба.', goal: { item: 'vanilla', count: 3 }, reward: { recipe: 'royal_pie', coins: 45 } },
    { id: 'q_serve', npc: 'milli', name: 'Помоги обслужить', type: 'daily', desc: 'Отработать смену в «Sweet Paw».', goal: { minigame: 'cafe' }, reward: { coins: 20 } },
    { id: 'q_donuts', npc: 'milli', name: '10 пончиков', type: 'side', desc: 'Скормить другу 10 пончиков.', goal: { feed: 'donut', count: 10 }, reward: { coins: 60 } },
    { id: 'q_cocoa', npc: 'bruno', name: 'Какао-экспедиция', type: 'side', desc: 'Собрать 12 какао-бобов в лесу.', goal: { item: 'cocoa', count: 12 }, reward: { recipe: 'choco_cake', coins: 35 } },
    { id: 'q_chocobath', npc: 'bruno', name: 'Шоколадная ванна', type: 'side', desc: 'Искупать друга в шоколаде.', goal: { minigame: 'chocobath' }, reward: { coins: 50, item: 'choco_heart', count: 1 } },
    { id: 'q_contest', npc: 'victoria', name: 'Конкурс кондитеров', type: 'side', desc: 'Приготовить торт на «отлично».', goal: { craftPerfect: 1 }, reward: { coins: 90, recipe: 'big_cake' } },
    { id: 'q_flour', npc: 'barry', name: 'Мучное дело', type: 'daily', desc: 'Принести 5 муки с мельницы.', goal: { item: 'flour', count: 5 }, reward: { coins: 15 } },
    { id: 'q_dough', npc: 'barry', name: 'Замеси тесто', type: 'daily', desc: 'Мини-игра замешивания.', goal: { minigame: 'dough' }, reward: { coins: 25 } },
    { id: 'q_pump', npc: 'ignatiy', name: 'Первая закачка', type: 'story', desc: 'Подключить друга к насосу.', goal: { minigame: 'pump' }, reward: { coins: 40 } },
    { id: 'q_giga', npc: 'ignatiy', name: 'Гига-коктейль', type: 'story', desc: 'Собрать ингредиенты для гига-коктейля.', goal: { item: 'dragon_milk', count: 1 }, reward: { food: 'shake_giga', coins: 100 } },
    { id: 'q_milk', npc: 'hopkins', name: 'Утренняя дойка', type: 'daily', desc: 'Подоить корову.', goal: { minigame: 'milk' }, reward: { coins: 15, item: 'milk', count: 2 } },
    { id: 'q_eggs', npc: 'hopkins', name: 'Сбор яиц', type: 'daily', desc: 'Собрать 6 яиц.', goal: { item: 'egg', count: 6 }, reward: { coins: 12 } },
    { id: 'q_honey', npc: 'hopkins', name: 'Медовый сбор', type: 'side', desc: 'Собрать мёд, не разозлив пчёл.', goal: { minigame: 'honey' }, reward: { coins: 30, item: 'honey', count: 3 } },
    { id: 'q_grain', npc: 'sebastian', name: 'Редкое зерно', type: 'side', desc: 'Принести 10 зерна на мельницу.', goal: { item: 'grain', count: 10 }, reward: { coins: 35, recipe: 'layered_pie' } },
    { id: 'q_spa', npc: 'mei', name: 'Расслабление', type: 'side', desc: 'Сводить друга на массаж.', goal: { minigame: 'massage' }, reward: { coins: 30 } },
    { id: 'q_lore', npc: 'athena', name: 'История Sugar City', type: 'side', desc: 'Прочитать 3 книги в библиотеке.', goal: { read: 3 }, reward: { coins: 40, recipe: 'tiramisu' } },
    { id: 'q_parcel', npc: 'pippa', name: 'Срочная посылка', type: 'daily', desc: 'Доставить посылку в кафе.', goal: { visit: 'creampalace' }, reward: { coins: 18 } },
    { id: 'q_city', npc: 'tiberiy', name: 'Гордость города', type: 'story', desc: 'Довести друга до стадии 6.', goal: { stage: 6 }, reward: { coins: 300 } },
    { id: 'q_kitten', npc: 'couple', name: 'Пропавший котёнок', type: 'side', desc: 'Найти котёнка-фурри в парке.', goal: { visit: 'park' }, reward: { coins: 20 } },
    { id: 'q_wedding', npc: 'couple', name: 'Свадебный торт', type: 'story', desc: 'Испечь свадебный торт для пары.', goal: { craft: 'big_cake' }, reward: { food: 'wedding_cake', coins: 150 } },
    { id: 'q_door', npc: 'artyom', name: 'Формула замка', type: 'secret',
      desc: '«Свет гриба, слеза луны, и то, что греет изнутри»: 3 светящихся гриба, 3 лунной росы, 1 шоколадное сердце.',
      goal: { item: 'choco_heart', count: 1 }, reward: { coins: 150, elixir: 'medium' } },
    // --- КВЕСТЫ НОВЫХ ТОРГОВЦЕВ ---
    { id: 'q_candy', npc: 'candy_lady', name: 'Сахарная лихорадка', type: 'side',
      desc: 'Глазурь нужен сахар: принеси 8 штук для новой партии леденцов.',
      goal: { item: 'sugar', count: 8 }, reward: { coins: 55, food: 'gingerbread' } },
    { id: 'q_candy2', npc: 'candy_lady', name: 'Дегустатор', type: 'daily',
      desc: 'Скормить другу 5 сладостей из лавки «Сахарок».',
      goal: { feed: 'marshmallow', count: 5 }, reward: { coins: 40, item: 'sugar', count: 4 } },
    { id: 'q_meat', npc: 'butcher_npc', name: 'Белковый рацион', type: 'side',
      desc: 'Клык считает, что другу нужно мясо. Скорми 3 стейка.',
      goal: { feed: 'steak', count: 3 }, reward: { coins: 70, item: 'meat', count: 5 } },
    { id: 'q_meat2', npc: 'butcher_npc', name: 'Праздничный ужин', type: 'story',
      desc: 'Приготовить целую индейку для друга.',
      goal: { craft: 'whole_turkey' }, reward: { coins: 180, recipe: 'feast_platter' } },
    { id: 'q_green', npc: 'green_npc', name: 'Тыквенный сезон', type: 'side',
      desc: 'Тыковка просит 5 тыкв с грядок для пирогов.',
      goal: { item: 'pumpkin', count: 5 }, reward: { coins: 60, recipe: 'pumpkin_pie' } },
    { id: 'q_dairy', npc: 'dairy_npc', name: 'Молочные реки', type: 'side',
      desc: 'Сливкину нужно 10 молока с фермы.',
      goal: { item: 'milk', count: 10 }, reward: { coins: 75, food: 'cheese_wheel' } },
    { id: 'q_rare', npc: 'rare_npc', name: 'Сделка с Ониксом', type: 'side',
      desc: 'Ворон хочет радужный кристалл. Взамен — звёздный порошок.',
      goal: { item: 'rainbow_crystal', count: 2 }, reward: { item: 'star_powder', count: 2, coins: 90 } },
    { id: 'q_furn', npc: 'furn_npc', name: 'Проверка на прочность', type: 'side',
      desc: 'Дубовик хочет испытать диван: доведи друга до 6 стадии.',
      goal: { stage: 6 }, reward: { coins: 250 } },
    { id: 'q_tool', npc: 'tool_npc', name: 'Эластичная нить', type: 'side',
      desc: 'Гвоздик просит принести 3 мотка эластичной нити со склада.',
      goal: { item: 'silk_thread', count: 3 }, reward: { coins: 65, item: 'gelatin', count: 4 } },
    { id: 'q_giant', npc: 'giant_npc', name: 'Оптовый клиент', type: 'story',
      desc: 'Обжоркин предлагает испытание: скорми другу тележку яств.',
      goal: { feed: 'feast_cart', count: 1 }, reward: { coins: 600, food: 'sweet_barrel' } },
    { id: 'q_giant2', npc: 'giant_npc', name: 'Рекорд гипермаркета', type: 'secret',
      desc: 'Довести друга до 9 стадии — фото на стене почёта.',
      goal: { stage: 9 }, reward: { coins: 1000, item: 'star_powder', count: 3 } },
    { id: 'q_lighthouse', npc: 'horatio', name: 'Тайна старого маяка', type: 'secret', desc: 'Разгадать головоломку маяка.', goal: { secret: 'lighthouse' }, reward: { item: 'star_powder', count: 2, coins: 200 } },
  ];

  /* ============================================================
   * 15. ЭКСПОРТ
   * ============================================================ */
  FF.CONFIG = CONFIG;
  FF.SPEED = SPEED;
  FF.ZONES = ZONES;
  FF.SPECIES = SPECIES;
  FF.FUR_COLORS = FUR_COLORS;
  FF.EYE_COLORS = EYE_COLORS;
  FF.FOOD = FOOD;
  FF.FOOD_BY_ID = Object.fromEntries(FOOD.map((f) => [f.id, f]));
  FF.INGREDIENTS = INGREDIENTS;
  FF.ING_BY_ID = Object.fromEntries(INGREDIENTS.map((i) => [i.id, i]));
  FF.RECIPES = RECIPES;
  FF.ELIXIRS = ELIXIRS;
  FF.ELIXIR_BY_ID = Object.fromEntries(ELIXIRS.map((e) => [e.id, e]));
  FF.LOCATIONS = LOCATIONS;
  FF.LOC_BY_ID = Object.fromEntries(LOCATIONS.map((l) => [l.id, l]));
  FF.NPCS = NPCS;
  FF.TAXIS = TAXIS;
  FF.ACHIEVEMENTS = ACHIEVEMENTS;
  FF.UNDER_BELLY_SPOTS = UNDER_BELLY_SPOTS;
  FF.QUESTS = QUESTS;
})(typeof window !== 'undefined' ? window : globalThis);
