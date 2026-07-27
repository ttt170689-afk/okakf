/**
 * bodyspots.js — ЖИЗНЬ НА ТЕЛЕ ДРУГА
 *
 * Тело перестаёт быть просто рельефом для карабканья: на нём можно
 * обустроиться. Система находит, где именно стоит игрок, и предлагает
 * действие — сесть, лечь, поспать, спрятаться в складке, устроить пикник.
 *
 * Ключевая идея: точки не задаются вручную координатами (тело постоянно
 * меняет форму и размер), а выводятся из ЗОНЫ, на которой игрок стоит.
 * Поэтому «диван» работает и у пухляша, и у планетарного гиганта.
 *
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  /**
   * Что можно делать на каждой зоне тела.
   *   comfort — насколько уютно (0..10), влияет на скорость восстановления
   *   acts    — доступные действия
   *   name    — как показать игроку
   */
  const SPOTS = {
    // --- Живот: главная площадка ---
    mid_belly:      { name: 'вершина живота', comfort: 10, acts: ['sit', 'lie', 'sleep', 'bounce', 'massage'] },
    upper_belly:    { name: 'верх живота',    comfort: 9,  acts: ['sit', 'lie', 'sleep', 'massage'] },
    lower_belly:    { name: 'нижний живот',   comfort: 9,  acts: ['sit', 'lie', 'bounce'] },
    apron_fold:     { name: 'нижняя складка', comfort: 10, acts: ['sit', 'hide', 'massage'] },
    side_belly_folds: { name: 'боковая складка', comfort: 8, acts: ['sit', 'hide'] },
    subrib_fold:    { name: 'подрёберная складка', comfort: 8, acts: ['hide'] },

    // --- Грудь ---
    left_moob:      { name: 'левая подушка груди',  comfort: 9, acts: ['sit', 'lie', 'sleep'] },
    right_moob:     { name: 'правая подушка груди', comfort: 9, acts: ['sit', 'lie', 'sleep'] },
    under_chest_folds: { name: 'складка под грудью', comfort: 10, acts: ['hide', 'sleep'] },
    upper_chest:    { name: 'верх груди', comfort: 8, acts: ['sit', 'lie'] },

    // --- Попа: «полка» — плоская, на ней даже пикник ---
    back_shelf:     { name: '«полка» над попой', comfort: 10, acts: ['sit', 'picnic', 'lie'] },
    lower_left_glute:  { name: 'левая ягодица',  comfort: 9, acts: ['sit', 'bounce'] },
    lower_right_glute: { name: 'правая ягодица', comfort: 9, acts: ['sit', 'bounce'] },
    undergluteal_folds: { name: 'подъягодичная складка', comfort: 9, acts: ['hide'] },

    // --- Спина и плечи ---
    upper_back:     { name: 'спина',  comfort: 9, acts: ['sit', 'lie', 'sleep', 'slide'] },
    lumbar_cushion: { name: 'поясничная подушка', comfort: 9, acts: ['sit', 'lie'] },
    scapular_folds: { name: 'лопаточная складка', comfort: 8, acts: ['sit', 'hide'] },
    left_shoulder:  { name: 'левое плечо',  comfort: 8, acts: ['sit', 'ride'] },
    right_shoulder: { name: 'правое плечо', comfort: 8, acts: ['sit', 'ride'] },
    nape:           { name: 'загривок', comfort: 9, acts: ['sit', 'lie', 'sleep'] },

    // --- Бёдра ---
    upper_left_thigh:  { name: 'левое бедро',  comfort: 8, acts: ['sit'] },
    upper_right_thigh: { name: 'правое бедро', comfort: 8, acts: ['sit'] },
    outer_left_thigh:  { name: 'левое галифе',  comfort: 7, acts: ['sit'] },
    outer_right_thigh: { name: 'правое галифе', comfort: 7, acts: ['sit'] },

    // --- Голова: смешно, но неустойчиво ---
    brow_ridges:    { name: 'макушка', comfort: 5, acts: ['sit'] },
  };

  /** Человеческие названия действий */
  const ACT_LABEL = {
    sit: '🪑 Сесть', lie: '🛌 Прилечь', sleep: '😴 Поспать',
    bounce: '🤸 Попрыгать', massage: '💆 Массаж', hide: '🫣 Забраться в складку',
    picnic: '🧺 Устроить пикник', slide: '🎢 Скатиться', ride: '👑 Ехать на плече',
  };

  class BodySpots {
    constructor(game) {
      this.game = game;
      this.state = 'none';     // none | sitting | lying | sleeping | hidden
      this.spot = null;        // текущая зона
      this.restTimer = 0;
    }

    /** Зона, на которой игрок сейчас стоит (или null) */
    currentSpot() {
      const p = this.game.player;
      const z = p.standingZone;
      if (!z || !z.node || !p.onGround) return null;
      const def = SPOTS[z.zone.id];
      if (!def) return null;
      // Зона должна быть достаточно налитой, иначе сидеть не на чем
      if (z.node.growth < 0.2) return null;
      return { def, zone: z, id: z.zone.id };
    }

    /** Подсказка для HUD */
    hint() {
      if (this.state !== 'none') {
        return 'Space — встать · ' + (this.state === 'lying' ? 'E — уснуть' : '');
      }
      const s = this.currentSpot();
      if (!s) return null;
      return `${s.def.name} · E — обустроиться`;
    }

    /** Открыть меню действий для текущего места */
    openMenu() {
      const g = this.game;
      if (this.state !== 'none') { this.getUp(); return true; }
      const s = this.currentSpot();
      if (!s) return false;

      const acts = s.def.acts.map((a) => ({
        act: 'bodyspot', id: a,
        label: `${ACT_LABEL[a] || a}`,
      }));
      acts.push({ act: 'close', label: 'Просто постоять' });
      g.ui.open('actions', {
        title: `🐾 ${s.def.name}`,
        sub: `Уют: ${'★'.repeat(Math.round(s.def.comfort / 2))} · выбери, чем заняться`,
        actions: acts,
      });
      return true;
    }

    /** Выполнить действие из меню */
    perform(actId) {
      const g = this.game;
      const s = this.currentSpot();
      if (!s) { g.notify('Здесь не на чем устроиться.', 'warn'); return; }
      const f = g.furry;
      const em = f.emotions;

      switch (actId) {
        case 'sit':
          this.state = 'sitting';
          this.spot = s;
          g.player.crouch = true;
          s.zone.node.press(new THREE.Vector3(0, -1, 0), 0.6);
          if (em) em.onAction('climb_on', 0.5);
          f.say(U.pick(['Устраивайся~', 'Мур, мне не тяжело!', 'Сиди сколько хочешь.']));
          g.notify(`🪑 Ты сидишь на: ${s.def.name}. Space — встать`, 'info');
          break;

        case 'lie':
          this.state = 'lying';
          this.spot = s;
          g.player.crawling = true;
          s.zone.node.press(new THREE.Vector3(0, -1, 0), 0.9);
          if (em) em.onAction('sleep_on_belly', 0.6);
          f.say(U.pick(['Мур-р-р... тепло...', 'Слышишь, как бьётся сердце?', 'Отдыхай~']));
          g.notify(`🛌 Ты лежишь на: ${s.def.name}. E — уснуть, Space — встать`, 'info');
          break;

        case 'sleep':
          this.state = 'lying';
          this.spot = s;
          this.sleepOnBody();
          break;

        case 'bounce':
          // Батут: используем уже существующую механику прыжка на животе
          g.player.vel.y = f.bounce(g.player.pos.clone(), 1.2);
          if (em) em.onAction('climb_on', 1);
          f.setEmotion('giggle', 3);
          g.notify('🤸 Ты подпрыгнул на друге!', 'info');
          break;

        case 'massage':
          f.massage(g.player.pos.clone(), new THREE.Vector3(0, -1, 0), 0.5);
          if (em) em.onAction('massage', 1);
          g.notify('💆 Массаж прямо сверху — друг тает.', 'info');
          break;

        case 'hide':
          this.state = 'hidden';
          this.spot = s;
          g.player.crawling = true;
          if (em) em.onAction('under_belly', 1);
          g.audio && g.audio.setAmbience('indoor');
          f.say(U.pick(['Хи-хи, спрятался!', 'Тут тепло, правда?', 'Тебя не найдут~']));
          g.notify(`🫣 Ты забрался в ${s.def.name}. Тепло и тихо. Space — вылезти`, 'info');
          break;

        case 'picnic':
          this.picnic();
          break;

        case 'slide':
          // Скатывание по спине: толчок вниз-назад
          g.player.vel.set(0, 2, 6);
          f.setEmotion('giggle', 3);
          f.wave(g.player.pos.clone(), 1.6);
          g.audio && g.audio.squish();
          g.notify('🎢 Ты съехал по спине!', 'info');
          break;

        case 'ride':
          this.state = 'sitting';
          this.spot = s;
          if (em) { em.onAction('climb_on', 1); em.e.pride += 12; }
          f.say(U.pick(['Держись крепче!', 'Ты как король на троне~', 'Мур! Поехали!']));
          g.notify('👑 Ты на плече друга. Space — слезть', 'info');
          break;
      }
      g.ui.close();
    }

    /** Сон на теле: пропуск времени и полное восстановление */
    sleepOnBody() {
      const g = this.game, f = g.furry;
      const s = this.spot || this.currentSpot();
      const comfort = s ? s.def.comfort : 6;
      this.state = 'sleeping';

      // Спим до утра
      const target = 7.5;
      let delta = target - (g.gameHours % 24);
      if (delta <= 0) delta += 24;
      g.skipTime(delta);

      g.player.stamina = FF.CONFIG.player.maxStamina;
      if (g.playerBody) g.playerBody.addStrengthXP(120);
      if (f.emotions) {
        f.emotions.onAction('sleep_on_belly', 1);
        f.emotions.e.comfort += comfort * 2;
        f.emotions.e.love += 15;
      }
      f.relation += 5;
      g.achieve('slept_on_friend');
      g.notify('🌅 Ты проспал ночь на друге. Силы полностью восстановлены!', 'quest');
      f.say('Доброе утро~ Ты так сладко сопел...');
      this.state = 'none';
      this.spot = null;
      g.player.crawling = false;
    }

    /** Пикник на «полке» над попой */
    picnic() {
      const g = this.game, f = g.furry;
      const food = g.inv.foodList()[0];
      if (!food) { g.notify('🧺 Для пикника нужна еда в инвентаре.', 'warn'); return; }
      g.inv.remove(food, 1);
      g.player.stamina = FF.CONFIG.player.maxStamina;
      if (f.emotions) {
        f.emotions.onAction('gift', 1);
        f.emotions.e.pride += 20;
        f.emotions.e.love += 10;
      }
      f.relation += 4;
      g.achieve('picnic_on_friend');
      g.notify('🧺 Пикник прямо на друге! Он невероятно горд собой.', 'quest');
      f.say(U.pick(['Я теперь стол? Ня!', 'Осторожно, не пролей~', 'Мне это нравится!']));
    }

    /** Встать / вылезти */
    getUp() {
      const g = this.game;
      if (this.state === 'none') return false;
      const was = this.state;
      this.state = 'none';
      this.spot = null;
      g.player.crouch = false;
      g.player.crawling = false;
      if (was === 'hidden') g.audio && g.audio.setAmbience('city');
      g.player.vel.y = 2.2;
      g.notify('🧍 Ты поднялся.', 'info');
      return true;
    }

    update(dt) {
      if (this.state === 'none') return;
      const g = this.game, f = g.furry;

      // Слетели с тела — состояние сбрасываем
      if (!g.player.standingZone && g.player.onGround) { this.getUp(); return; }

      const s = this.spot;
      const comfort = s ? s.def.comfort : 6;

      /* Отдых: чем уютнее место, тем быстрее восстановление.
       * Лёжа — вдвое эффективнее, чем сидя. */
      const k = (this.state === 'lying' || this.state === 'hidden') ? 2 : 1;
      const C = FF.CONFIG.player;
      g.player.stamina = Math.min(C.maxStamina,
        g.player.stamina + dt * comfort * 0.9 * k);

      // Друг доволен, что на нём отдыхают
      if (f.emotions) {
        f.emotions.e.comfort += dt * 1.2 * k;
        f.emotions.e.love += dt * 0.5 * k;
        f.emotions.e.pride += dt * 0.4;
      }

      // Тело мягко качает игрока в такт дыханию
      if (s && s.zone && s.zone.node) {
        const br = f._breath || 0;
        g.player.pos.y += br * dt * 0.14 * k;
        s.zone.node.contactPress = Math.min(1, s.zone.node.contactPress + dt * 2);
      }

      // Раз в несколько секунд — реплика
      this.restTimer -= dt;
      if (this.restTimer <= 0) {
        this.restTimer = U.rand(10, 22);
        if (this.state === 'hidden') f.say(U.pick(['Тут уютно, да?', 'Мур... щекотно.']));
        else f.say(U.pick(['Тебе удобно?', 'Мур-р-р~', 'Можешь остаться подольше.']));
      }
    }
  }

  FF.BodySpots = BodySpots;
  FF.BODY_SPOTS = SPOTS;
})(typeof window !== 'undefined' ? window : globalThis);
