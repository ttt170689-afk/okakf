/**
 * ui.js — Пользовательский интерфейс: HUD, меню, инвентарь, магазин,
 * крафт, диалоги, карта, квесты, мини-игры, достижения, настройки.
 * Всё на DOM поверх canvas (быстро, чётко, доступно).
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const U = FF.U;

  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  class UI {
    constructor(game) {
      this.game = game;
      this.root = document.getElementById('ui');
      this.panelOpen = null;
      this.minigame = null;
      this._build();
    }

    _build() {
      // ---------- HUD ----------
      this.hud = el('div', 'hud');
      this.root.appendChild(this.hud);

      this.topLeft = el('div', 'hud-block top-left');
      this.hud.appendChild(this.topLeft);

      this.topRight = el('div', 'hud-block top-right');
      this.hud.appendChild(this.topRight);

      this.bottomLeft = el('div', 'hud-block bottom-left');
      this.hud.appendChild(this.bottomLeft);

      this.bottomRight = el('div', 'hud-block bottom-right');
      this.hud.appendChild(this.bottomRight);

      this.crosshair = el('div', 'crosshair', '<span></span>');
      this.hud.appendChild(this.crosshair);

      this.prompt = el('div', 'prompt');
      this.hud.appendChild(this.prompt);

      this.notifications = el('div', 'notifications');
      this.hud.appendChild(this.notifications);

      this.zoneInfo = el('div', 'zone-info');
      this.hud.appendChild(this.zoneInfo);

      // ---------- Панель (универсальный оверлей) ----------
      this.panel = el('div', 'panel hidden');
      this.root.appendChild(this.panel);

      // ---------- Мини-игра ----------
      this.mg = el('div', 'minigame hidden');
      this.root.appendChild(this.mg);
    }

    /* ==================== HUD ==================== */
    updateHUD(dt) {
      const g = this.game, f = g.furry, inv = g.inv, p = g.player;
      this.updateCabinHUD();
      this.updateCabHUD();
      const stageName = FF.CONFIG.growth.stageNames[f.stage];
      const nextTh = FF.CONFIG.growth.stageThresholds[f.stage + 1];
      const prevTh = FF.CONFIG.growth.stageThresholds[f.stage];
      const prog = nextTh ? U.clamp((f.calories - prevTh) / (nextTh - prevTh), 0, 1) : 1;

      this.topLeft.innerHTML = `
        <div class="card">
          <div class="row"><b>${f.opts.name}</b> <span class="tag">${f.species.name}</span></div>
          <div class="row small">Стадия ${f.stage}: «${stageName}»</div>
          <div class="bar"><i style="width:${prog * 100}%;background:linear-gradient(90deg,#ffb46b,#ff6f9c)"></i>
            <u>${U.fmt(f.calories)} / ${nextTh ? U.fmt(nextTh) : '∞'} кал</u></div>
          <div class="row small">Масса: <b>${U.fmt(f.mass)} кг</b> ${f.mobile ? '🚶 подвижен' : '🛑 не может двигаться'}</div>
          ${g.furryFollow ? `<div class="row small follow">🐾 Идёт к тебе — ${
            Math.round(f.root.position.distanceTo(p.pos))} м <span class="dots"></span></div>` : ''}
          <div class="bar mini"><i style="width:${(1 - f.hunger) * 100}%;background:linear-gradient(90deg,#7cd66b,#d6d16b)"></i><u>Сытость</u></div>
          <div class="bar mini"><i style="width:${f.mood * 100}%;background:linear-gradient(90deg,#6bb7ff,#c58bff)"></i><u>Настроение</u></div>
          <div class="bar mini"><i style="width:${U.clamp(f.relation, 0, 100)}%;background:linear-gradient(90deg,#ff7ba6,#ff4d79)"></i><u>Связь: ${g.relationName()}</u></div>
        </div>`;

      const loc = g.currentLoc ? g.currentLoc.name : 'Окрестности';
      this.topRight.innerHTML = `
        <div class="card right">
          <div class="row"><b>🕐 ${U.fmtTime(g.gameHours)}</b> · День ${g.day}</div>
          <div class="row">🪙 <b>${Math.floor(inv.coins)}</b> · ⭐ ур.${inv.level}</div>
          <div class="row small">📍 ${loc}</div>
          ${g.weather !== 'clear' ? `<div class="row small">${g.weather === 'rain' ? '🌧 Дождь' : '❄️ Снег'}</div>` : ''}
        </div>`;

      const selFood = inv.selected && FF.FOOD_BY_ID[inv.selected];
      const selIng = inv.selected && FF.ING_BY_ID[inv.selected];
      this.bottomLeft.innerHTML = `
        <div class="card">
          <div class="bar mini"><i style="width:${p.stamina}%;background:linear-gradient(90deg,#ffd76b,#ff9d5c)"></i><u>Стамина</u></div>
          <div class="row small">Режим: <b>${{ walk: 'ходьба', climb: '🧗 карабканье', onbelly: '🏔️ на животе', underbelly: '🏠 под животом', ride: '🚕 поездка' }[p.mode] || p.mode}</b></div>
          ${p.underBellySpot ? `<div class="row small hl">📍 ${p.underBellySpot.name} — ${p.underBellySpot.desc}</div>` : ''}
        </div>`;

      this.bottomRight.innerHTML = `
        <div class="card right">
          <div class="row">В руках: <b>${selFood ? selFood.icon + ' ' + selFood.name + ' (' + selFood.cal + ' кал)' : selIng ? selIng.icon + ' ' + selIng.name : '—'}</b>
            ${inv.selected ? `×${inv.count(inv.selected)}` : ''}</div>
          <div class="row small">${selFood ? 'F — покормить друга' : 'I — инвентарь'} · Q — сменить предмет</div>
        </div>`;
    }

    /** HUD Sugar Cab по спецификации */
    updateCabHUD() {
      const d = this.game.cab && this.game.cab.hud();
      if (!d) {
        if (this._cabEl) { this._cabEl.remove(); this._cabEl = null; }
        return;
      }
      if (!this._cabEl) {
        this._cabEl = el('div', 'cab-hud');
        this.hud.appendChild(this._cabEl);
      }
      const warn = d.rear > 90;
      this._cabEl.innerHTML = `
        <div class="cab-card ${warn ? 'warn' : ''}">
          <div class="cab-title">🚕 SUGAR CAB</div>
          ${d.phase ? `<div class="cab-phase">Посадка ${d.phase}
            ${d.needHold ? '<span class="cab-key">удерживай E</span>' : ''}
            ${d.needTap ? '<span class="cab-key">жми Space</span>' : ''}</div>` : ''}
          <div class="bar"><i style="width:${Math.min(100, d.rear)}%;background:${
            d.rear > 90 ? '#ff6b6b' : d.rear > 65 ? '#ffa04a' : '#7cd66b'}"></i>
            <u>Задний салон: ${d.rear}% занят</u></div>
          <div class="bar mini"><i style="width:${d.seat}%;background:#c58bff"></i>
            <u>Диван сжат: ${d.seat}%</u></div>
          <div class="bar mini"><i style="width:${d.susp}%;background:#8ac6ff"></i>
            <u>Нагрузка подвески: ${d.susp}%</u></div>
          <div class="cab-rows">
            <div><span>Фурри:</span><b>${d.furryStatus}</b></div>
            <div><span>Игрок:</span><b>${d.playerStatus}</b></div>
            <div><span>Маршрут:</span><b>${d.route}</b></div>
          </div>
          ${d.resting ? '<div class="cab-rest">🛏 Отдых в пути...</div>'
            : (d.state === 'riding' ? '<div class="cab-hint"><kbd>E</kbd> отдохнуть до прибытия</div>' : '')}
        </div>`;
    }

    /** HUD физики салона: уровень сжатия, свободный объём, выкарабкивание */
    updateCabinHUD() {
      const data = this.game.cabin && this.game.cabin.hudData();
      if (!data) {
        if (this._cabinEl) { this._cabinEl.remove(); this._cabinEl = null; }
        return;
      }
      if (!this._cabinEl) {
        this._cabinEl = el('div', 'cabin-hud');
        this.hud.appendChild(this._cabinEl);
      }
      const pct = Math.round(data.squeeze * 100);
      const lvl = data.level;
      this._cabinEl.innerHTML = `
        <div class="cabin-card">
          <div class="row"><b>🚕 ${data.cabinName}</b></div>
          <div class="row small">Салон ${data.cabinVolume.toFixed(1)} м³ · друг ${data.furryVol.toFixed(1)} м³${
            data.box ? ` (${data.box.w.toFixed(1)}×${data.box.h.toFixed(1)}×${data.box.d.toFixed(1)} м)` : ''}</div>
          ${data.overflow > 0.02 ? `<div class="row small" style="color:#ff9a9a">⚠ Не помещается на ${Math.round(data.overflow * 100)}% — расплывается по всему салону</div>` : ''}
          <div class="bar"><i style="width:${pct}%;background:${lvl.color}"></i>
            <u>${lvl.name} — ${pct}%</u></div>
          <div class="row small">${lvl.hint}</div>
          <div class="bar mini"><i style="width:${data.freeVolume * 100}%;background:#8ac6ff"></i>
            <u>свободно тебе: ${Math.round(data.freeVolume * 100)}%</u></div>
          ${data.trapped ? `
            <div class="cabin-trap">
              <b>🆘 ЗАЖАЛО!</b>
              <div class="bar"><i style="width:${data.struggle * 100}%;background:#ff3b30"></i>
                <u>выкарабкивание</u></div>
              <div class="row small">Дёргай мышью + <kbd>Пробел</kbd></div>
            </div>` : '<div class="row small"><kbd>R</kbd> пересесть</div>'}
        </div>`;
      this._cabinEl.classList.toggle('danger', data.squeeze > 0.75);
    }

    setPrompt(text) {
      this.prompt.innerHTML = text ? `<div class="prompt-inner">${text}</div>` : '';
    }

    /** Диалоги отключены — реплики не отображаются */
    showSpeech(text) { /* no-op */ }

    notify(text, kind = 'info') {
      const n = el('div', 'note note-' + kind, text);
      this.notifications.appendChild(n);
      setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 600); }, 3600);
      while (this.notifications.children.length > 6) this.notifications.firstChild.remove();
    }

    showZone(node) {
      if (!node) { this.zoneInfo.innerHTML = ''; return; }
      const z = node.zone;
      const pct = Math.round(node.growth * 100);
      this.zoneInfo.innerHTML = `
        <div class="zone-card">
          <b>${z.name}</b>
          <div class="bar mini"><i style="width:${pct}%;background:linear-gradient(90deg,#ff9ec4,#ffd76b)"></i><u>Рост ${pct}%</u></div>
          <div class="small">${z.speed.label} · мягкость ${Math.round(z.soft * 100)}%${z.grab ? ' · 🧗 можно хвататься' : ''}</div>
        </div>`;
    }

    /* ==================== ПАНЕЛИ ==================== */
    open(kind, data) {
      this.panelOpen = kind;
      this.panel.classList.remove('hidden');
      this.game.player.frozen = true;
      document.exitPointerLock && document.pointerLockElement && document.exitPointerLock();
      this.render(kind, data);
    }
    close() {
      this.panelOpen = null;
      this.panel.classList.add('hidden');
      this.panel.innerHTML = '';
      this.game.player.frozen = false;
      this.game.requestPointerLock();
    }
    toggle(kind, data) {
      if (this.panelOpen === kind) this.close();
      else this.open(kind, data);
    }

    render(kind, data) {
      const g = this.game;
      let html = '';
      const head = (title, sub) => `<div class="p-head"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}<button class="x" data-act="close">✕</button></div>`;

      switch (kind) {
        /* ---------- ИНВЕНТАРЬ ---------- */
        case 'inventory': {
          const foods = g.inv.foodList(), ings = g.inv.ingList();
          html = head('🎒 Инвентарь', `Монет: ${Math.floor(g.inv.coins)} · Уровень повара: ${g.inv.level} (XP ${Math.floor(g.inv.xp)})`);
          html += '<div class="p-body"><h3>🍰 Еда</h3><div class="grid">';
          if (!foods.length) html += '<div class="empty">Пусто. Купи еду в кафе или приготовь на кухне.</div>';
          for (const id of foods) {
            const f = FF.FOOD_BY_ID[id];
            html += `<div class="item ${g.inv.selected === id ? 'sel' : ''}" data-act="select" data-id="${id}">
              <div class="ic">${f.icon}</div><div class="nm">${f.name}</div>
              <div class="sm">${f.cal} кал ×${g.inv.count(id)}</div></div>`;
          }
          html += '</div><h3>🌰 Ингредиенты</h3><div class="grid">';
          if (!ings.length) html += '<div class="empty">Нет ингредиентов. Ищи их в мире!</div>';
          for (const id of ings) {
            const i = FF.ING_BY_ID[id];
            html += `<div class="item ${g.inv.selected === id ? 'sel' : ''}" data-act="select" data-id="${id}">
              <div class="ic">${i.icon}</div><div class="nm">${i.name}</div>
              <div class="sm">×${g.inv.count(id)}</div></div>`;
          }
          html += '</div><h3>💊 Эликсиры</h3><div class="grid">';
          let any = false;
          for (const e of FF.ELIXIRS) {
            const c = g.inv.elixirs[e.id] || 0;
            if (!c) continue; any = true;
            html += `<div class="item" data-act="use_elixir" data-id="${e.id}">
              <div class="ic" style="color:#${e.color.toString(16).padStart(6, '0')}">🧪</div>
              <div class="nm">${e.name}</div><div class="sm">×${c} — применить</div></div>`;
          }
          if (!any) html += '<div class="empty">Нет эликсиров. Загляни к Артёму.</div>';
          html += '</div></div>';
          break;
        }

        /* ---------- МАГАЗИН ---------- */
        case 'shop': {
          const list = data.shop || [];
          const isIng = data.action === 'shop_ing';
          html = head('🛒 ' + (data.label || 'Магазин'), `Монет: ${Math.floor(g.inv.coins)}`);
          html += '<div class="p-body"><div class="grid">';
          for (const id of list) {
            const it = isIng ? FF.ING_BY_ID[id] : FF.FOOD_BY_ID[id];
            if (!it) continue;
            const limit = g.shopLimit(data.loc || 'stall', id);
            html += `<div class="item ${limit <= 0 ? 'dis' : ''}" data-act="buy" data-id="${id}" data-loc="${data.loc || 'stall'}" data-ing="${isIng ? 1 : 0}">
              <div class="ic">${it.icon}</div><div class="nm">${it.name}</div>
              <div class="sm">${it.price} 🪙${it.cal ? ' · ' + it.cal + ' кал' : ''}</div>
              <div class="sm ${limit <= 0 ? 'red' : ''}">${limit <= 0 ? 'сегодня всё' : 'осталось: ' + limit}</div></div>`;
          }
          html += '</div><p class="hint">В этом мире еды МАЛО: у каждой лавки дневной лимит. Готовь сам, ищи ингредиенты, выполняй задания!</p>';
          if (!isIng) html += '<h3>Продать</h3><div class="grid">';
          if (!isIng) {
            for (const id of g.inv.foodList()) {
              const f = FF.FOOD_BY_ID[id];
              html += `<div class="item" data-act="sell" data-id="${id}"><div class="ic">${f.icon}</div>
                <div class="nm">${f.name}</div><div class="sm">+${Math.floor(f.price * FF.CONFIG.economy.sellRatio)} 🪙 ×${g.inv.count(id)}</div></div>`;
            }
            html += '</div>';
          }
          html += '</div>';
          break;
        }

        /* ---------- КРАФТ ---------- */
        case 'craft': {
          html = head('🧑‍🍳 Кухня — крафт', `Уровень повара: ${g.inv.level}. Идеальная готовка даёт +25% калорий.`);
          html += '<div class="p-body"><div class="list">';
          for (const r of FF.RECIPES) {
            const out = FF.FOOD_BY_ID[r.out] || FF.ING_BY_ID[r.out];
            if (!out) continue;
            const known = g.inv.recipesKnown.has(r.out);
            const can = known && Object.entries(r.ing).every(([k, v]) => v === 0 || g.inv.has(k, v));
            const ingStr = Object.entries(r.ing).filter(([, v]) => v > 0).map(([k, v]) => {
              const it = FF.ING_BY_ID[k] || FF.FOOD_BY_ID[k];
              const have = g.inv.count(k);
              return `<span class="${have >= v ? 'ok' : 'no'}">${it ? it.icon : ''}${it ? it.name : k} ${have}/${v}</span>`;
            }).join(', ');
            html += `<div class="recipe ${can ? '' : 'dis'}" ${can ? `data-act="craft" data-id="${r.out}"` : ''}>
              <div class="ic">${out.icon}</div>
              <div class="body"><b>${out.name}</b> ${out.cal ? `<span class="tag">${out.cal} кал</span>` : ''}
                <span class="tag">ур. ${r.level}</span> ${known ? '' : '<span class="tag red">не изучен</span>'}
                <div class="sm">${ingStr}</div></div>
              <div class="go">${can ? 'Готовить ▶' : ''}</div></div>`;
          }
          html += '</div></div>';
          break;
        }

        /* ---------- ВАРКА ЭЛИКСИРОВ ---------- */
        case 'brew': {
          html = head('⚗️ Котёл Артёма', 'Эликсиры возвращают подвижность гиганту.');
          html += '<div class="p-body"><div class="list">';
          for (const e of FF.ELIXIRS) {
            const known = g.inv.elixirRecipes.has(e.id);
            const can = known && Object.entries(e.ing).every(([k, v]) => g.inv.has(k, v));
            const used = e.once && g.usedOnce.has('elixir_' + e.id);
            const ingStr = Object.entries(e.ing).map(([k, v]) => {
              const it = FF.ING_BY_ID[k]; const have = g.inv.count(k);
              return `<span class="${have >= v ? 'ok' : 'no'}">${it ? it.icon + it.name : k} ${have}/${v}</span>`;
            }).join(', ');
            html += `<div class="recipe ${can && !used ? '' : 'dis'}" ${can && !used ? `data-act="brew" data-id="${e.id}"` : ''}>
              <div class="ic" style="filter:drop-shadow(0 0 8px #${e.color.toString(16).padStart(6, '0')})">🧪</div>
              <div class="body"><b>${e.name}</b> <span class="tag">${e.desc}</span>
                ${known ? '' : '<span class="tag red">рецепт неизвестен</span>'}
                ${used ? '<span class="tag red">уже использован</span>' : ''}
                <div class="sm">${ingStr}</div></div>
              <div class="go">${can && !used ? 'Варить ▶' : ''}</div></div>`;
          }
          html += `</div><p class="hint">Есть эликсиры: ${FF.ELIXIRS.map((e) => `${e.name}: ${g.inv.elixirs[e.id] || 0}`).join(' · ')}</p></div>`;
          break;
        }

        /* ---------- ДИАЛОГ ---------- */
        /* ---------- NPC: ПРЯМЫЕ ДЕЙСТВИЯ (без диалогов) ---------- */
        case 'dialogue': {
          const npc = data.npc;
          html = head(`${npc.name}`, npc.species);
          html += '<div class="p-body">';

          // Квесты этого NPC
          const offers = g.quests.offer(npc.id);
          const activeQ = g.quests.active.filter((a) => g.quests.def(a.id).npc === npc.id);
          if (offers.length || activeQ.length) {
            html += '<h3>📜 Задания</h3><div class="list">';
            for (const q of offers) {
              html += `<div class="recipe" data-act="accept_quest" data-id="${q.id}">
                <div class="ic">📜</div><div class="body"><b>${q.name}</b> <span class="tag">${q.type}</span>
                <div class="sm">${q.desc}</div></div><div class="go">Взять ▶</div></div>`;
            }
            for (const a of activeQ) {
              const q = g.quests.def(a.id);
              const goal = q.goal;
              let prog = '';
              if (goal.item) prog = `${g.inv.count(goal.item)}/${goal.count || 1}`;
              else if (goal.feed || goal.read) prog = `${a.progress}/${goal.count || goal.read}`;
              const can = goal.item && g.inv.count(goal.item) >= (goal.count || 1);
              html += `<div class="recipe ${can ? '' : 'dis'}" ${can ? `data-act="turnin" data-id="${a.id}"` : ''}>
                <div class="ic">⏳</div><div class="body"><b>${q.name}</b> <span class="tag">${prog}</span>
                <div class="sm">${q.desc}</div></div><div class="go">${can ? 'Сдать ▶' : 'в работе'}</div></div>`;
            }
            html += '</div>';
          }

          // Услуги NPC
          const acts = [];
          if (npc.id === 'artyom') acts.push(['brew', '⚗️ Варить эликсир']);
          if (npc.id === 'mei') acts.push(['spa', '💆 Массаж для друга (30🪙)']);
          if (npc.id === 'barry') acts.push(['gift_flour', '🌾 Взять муку в подарок']);
          if (npc.id === 'athena') acts.push(['read', '📚 Почитать книгу']);
          if (npc.id === 'musician') acts.push(['tip', '🪙 Бросить монетку']);
          if (npc.id === 'ignatiy') acts.push(['pump', '⚙️ К насосу']);
          if (acts.length) {
            html += '<h3>Услуги</h3><div class="btnrow vert">';
            for (const [a, label] of acts) html += `<button data-act="${a}">${label}</button>`;
            html += '</div>';
          }
          if (!offers.length && !activeQ.length && !acts.length) {
            html += '<div class="empty">Сейчас здесь ничего нет. Загляни позже.</div>';
          }
          html += '</div>';
          break;
        }

        /* ---------- ГАРДЕРОБ ---------- */
        case 'wardrobe': {
          const cl = g.clothing;
          html = head('👕 Гардероб', `Монет: ${Math.floor(g.inv.coins)} · Порвано вещей: ${cl.ripCount} · Стадия друга: ${g.furry.stage}`);
          html += '<div class="p-body"><h3>Надето сейчас</h3><div class="grid">';
          const slots = { shirt: 'Верх', pants: 'Низ', sweater: 'Свитер', pyjama: 'Пижама', cloak: 'Плащ', accessory: 'Аксессуар' };
          for (const [slot, label] of Object.entries(slots)) {
            const id = cl.worn[slot];
            const c = id && cl.def(id);
            const t = cl.tension[slot] || 0;
            const tPct = Math.round(U.clamp(t, 0, 1) * 100);
            html += `<div class="item ${c ? '' : 'dis'}">
              <div class="ic">${c ? c.icon : '➖'}</div>
              <div class="nm">${c ? c.name : label + ': пусто'}</div>
              ${c ? `<div class="bar mini"><i style="width:${tPct}%;background:linear-gradient(90deg,#7cd66b,#ffd76b,#ff6b6b)"></i><u>натяжение ${tPct}%</u></div>
              <div class="sm" data-act="takeoff" data-id="${slot}">снять</div>` : ''}
            </div>`;
          }
          html += '</div><h3>Каталог</h3><div class="list">';
          for (const c of cl.catalog()) {
            const owned = cl.owned.has(c.id) && !cl.ripped.has(c.id);
            const isRipped = cl.ripped.has(c.id);
            const wornNow = cl.worn[c.slot] === c.id;
            const canAfford = g.inv.coins >= c.price;
            const act = owned ? (wornNow ? '' : 'wear_cloth') : (canAfford ? 'buy_cloth' : '');
            html += `<div class="recipe ${act ? '' : 'dis'}" ${act ? `data-act="${act}" data-id="${c.id}"` : ''}>
              <div class="ic">${c.icon}</div>
              <div class="body"><b>${c.name}</b>
                <span class="tag">${c.elastic ? '🧵 эластичная' : 'до стадии ' + c.maxStage}</span>
                ${isRipped ? '<span class="tag red">порвана</span>' : ''}
                ${c.prestige ? '<span class="tag">👑 престиж</span>' : ''}
                <div class="sm">${c.desc}</div></div>
              <div class="go">${wornNow ? '✅ надето' : owned ? 'Надеть ▶' : c.price + ' 🪙'}</div></div>`;
          }
          html += '</div><p class="hint">Одежда рвётся, когда друг перерастает её. Эластичная линейка тянется вдвое дольше. Аксессуары не рвутся никогда.</p></div>';
          break;
        }

        /* ---------- ДНЕВНИК ---------- */
        case 'notebook': {
          const nb = g.notebook, st = g.statsTracker.data;
          html = head('📔 Дневник', `День ${g.day} · Записей: ${nb.entries.length}`);
          html += `<div class="p-body">
            <h3>Сводка</h3>
            <div class="statgrid">
              <div><b>${U.fmt(st.totalCaloriesFed)}</b><span>скормлено калорий</span></div>
              <div><b>${Math.round(st.distanceWalked)} м</b><span>пройдено</span></div>
              <div><b>${Math.round(st.distanceClimbed)} м</b><span>вскарабкано</span></div>
              <div><b>${Math.round(st.timeOnBelly)} с</b><span>на животе</span></div>
              <div><b>${Math.round(st.timeUnderBelly)} с</b><span>под животом</span></div>
              <div><b>${Math.round(st.timePlayed / 60)} мин</b><span>в игре</span></div>
            </div>`;
          if (st.biggestMealName) html += `<p class="hint">🏅 Самое большое блюдо: <b>${st.biggestMealName}</b> (${U.fmt(st.biggestMeal)} кал)</p>`;
          html += '<h3>Самые выросшие зоны</h3><div class="zones">';
          for (const z of g.statsTracker.topZones()) {
            const pct = Math.round(z.g * 100);
            html += `<div class="zrow"><span class="zn">${z.name}</span>
              <span class="zb"><i style="width:${pct}%"></i></span><span class="zp">${pct}%</span></div>`;
          }
          html += '</div><h3>Записи</h3><div class="list">';
          if (!nb.entries.length) html += '<div class="empty">Дневник пуст. Он заполнится сам по мере путешествия.</div>';
          for (const e of [...nb.entries].reverse()) {
            html += `<div class="recipe"><div class="ic">${
              { stage: '📈', place: '📍', quest: '✅', clothes: '💥', story: '📖' }[e.kind] || '📝'}</div>
              <div class="body"><b>День ${e.day}, ${e.time}</b><div class="sm">${e.text}</div></div></div>`;
          }
          html += '</div></div>';
          break;
        }

        /* ---------- КАК ЗАРАБОТАТЬ ---------- */
        case 'money': {
          html = head('🪙 Как заработать монеты', `Сейчас у тебя: ${Math.floor(g.inv.coins)} 🪙`);
          const rows = [
            ['💼', 'Смена в кафе', '20–40 🪙', 'Sweet Paw, Chocolate Dreams, Cream Palace — подойди и нажми E у вывески «Поработать смену»'],
            ['🥖', 'Смена в пекарне', '25–45 🪙 + мука', 'Golden Bakery: мини-игра замешивания теста'],
            ['📜', 'Задания NPC', '10–1000 🪙', `Выполнено ${g.quests.done.size} из ${FF.QUESTS.length}. Ежедневные обновляются каждый день`],
            ['🎸', 'Игра с музыкантом', '8–33 🪙', 'Площадь: ритм-игра вместе с уличным музыкантом'],
            ['🎣', 'Рыбалка', '10–30 🪙', 'Пруд в парке. В горах ловится ледяная рыба (дороже)'],
            ['🐑', 'Стрижка овец', '10–35 🪙', 'Ферма: мини-игра стрижки'],
            ['💃', 'Танцы в клубе', '10–40 🪙', 'Ночной клуб, работает с 21:00 до 06:00'],
            ['🧩', 'Головоломка маяка', '25–105 🪙', 'Старый маяк в лесу — разовая, но щедрая'],
            ['💰', 'Продажа еды', '55% цены', 'В любом кафе вкладка «Продать». Готовь дешёвое — продавай дорогое'],
            ['🌅', 'Ежедневный вход', `${FF.CONFIG.economy.dailyLogin} 🪙`, 'Начисляется автоматически каждое новое утро'],
            ['📮', 'Почта', '5–25 🪙', 'Проверяй почтовый ящик у дома и почту в городе'],
            ['🏆', 'Достижения', '15 🪙', `За каждое. Получено ${g.achievements.size} из ${FF.ACHIEVEMENTS.length}`],
            ['🐦', 'Покормить голубей', '1 🪙', 'Площадь и парк. Мелочь, но приятно'],
            ['🏦', 'Кредит в банке', '200 🪙', 'Вернуть придётся 260 — берите с умом'],
          ];
          html += '<div class="p-body"><div class="list">';
          for (const [ic, name, pay, desc] of rows) {
            html += `<div class="recipe"><div class="ic">${ic}</div>
              <div class="body"><b>${name}</b> <span class="tag">${pay}</span>
              <div class="sm">${desc}</div></div></div>`;
          }
          html += `</div>
            <p class="hint"><b>Самое выгодное на старте:</b> смены в кафе и пекарне —
            их можно повторять, они не заканчиваются. Дальше подключай задания NPC:
            всего в них ${FF.QUESTS.reduce((a, q) => a + ((q.reward && q.reward.coins) || 0), 0)} монет.
            Крафт тоже приносит доход: приготовил дешёвое блюдо — продал дороже ингредиентов.</p>
            </div>`;
          break;
        }

        /* ---------- ТАБЛИЦА ПОСАДКИ В ТАКСИ ---------- */
        case 'boarding': {
          const b = g.boarding, cur = g.furry.stage;
          const info = b.infoFor(cur);
          const taxiNames = { normal: '🚕 Обычное', big: '🚙 Большое', mega: '🚛 Мега', ultra: '🚚 Ультра' };
          html = head('🚕 Посадка в такси', `Сейчас: стадия ${cur} «${info.name}» · ${info.weightKg}`);
          html += `<div class="p-body">
            <div class="board-now">
              <b>${info.methodName}</b>
              <p>${info.desc}</p>
              <div class="statgrid">
                <div><b>${info.seats}</b><span>из ${info.seatsTotal} мест</span></div>
                <div><b>${info.boardTime}с</b><span>длится посадка</span></div>
                <div><b>${Math.round(info.speedMult * 100)}%</b><span>скорость такси</span></div>
                <div><b>×${info.priceMult}</b><span>цена поездки</span></div>
                <div><b>${Math.round(info.stuckRisk * 100)}%</b><span>шанс застрять</span></div>
                <div><b>${info.helpers}</b><span>помощников</span></div>
              </div>
              <div class="board-details">
                <div><span class="bd-l">🚪 Дверь</span><span>${info.doorNote}</span></div>
                <div><span class="bd-l">🪑 В салоне</span><span>${info.cabin}</span></div>
                <div><span class="bd-l">🧍 Ты едешь</span><span>${info.playerSeat}</span></div>
                <div><span class="bd-l">🐾 Тело</span><span>${info.bodyNote}</span></div>
                <div><span class="bd-l">⚙️ Подвеска</span><span>${info.sagNote}</span></div>
                <div><span class="bd-l">🔊 Звуки</span><span>${info.soundNote}</span></div>
              </div>
            </div>
            <h3>Все 11 размеров</h3>
            <div class="board-head">
              <span class="bs">#</span><span class="bn">Размер</span><span class="bm">Способ посадки</span>
              <span class="bt">Такси</span><span class="bseat">Мест</span><span class="bsp">Скор.</span>
            </div>
            <div class="board-table">`;
          for (const row of b.table()) {
            const isNow = row.stage === cur;
            const passed = row.stage < cur;
            html += `<div class="board-row ${isNow ? 'now' : passed ? 'passed' : 'future'}"
              data-act="board_info" data-id="${row.stage}">
              <span class="bs">${row.stage}</span>
              <span class="bn">${row.name}</span>
              <span class="bm">${row.methodName}</span>
              <span class="bt">${taxiNames[row.minTaxi]}</span>
              <span class="bseat">${row.seats}/${row.seatsTotal}</span>
              <span class="bsp">${Math.round(row.speedMult * 100)}%</span>
            </div>`;
            if (data && data.expand === row.stage && !isNow) {
              html += `<div class="board-desc">
                <b>${row.weightKg}</b> · ${row.desc}<br>
                🚪 ${row.doorNote}<br>🪑 ${row.cabin}<br>🧍 ${row.playerSeat}<br>
                🐾 ${row.bodyNote}<br>⚙️ ${row.sagNote}</div>`;
            }
            if (isNow) {
              html += `<div class="board-desc now-desc">👉 Ты здесь. ${row.bodyNote}</div>`;
            }
          }
          html += `</div>
            <p class="hint">Клик по строке — подробности. Чем больше друг, тем сложнее посадка:
            сначала он заходит сам, потом его подталкивают, дальше нужен пандус, лебёдка,
            кран и в конце — целый транспортный конвой с перекрытием улицы.
            Растут цена, время и просадка подвески, а скорость падает.</p></div>`;
          break;
        }

        /* ---------- КАРТА ---------- */
        case 'map': {
          html = head('🗺️ Карта Sugar City', 'Клик по локации — вызвать такси туда (если есть монеты).');
          html += '<div class="p-body"><div class="map">';
          const scale = 1.05, ox = 260, oz = 230;
          for (const l of FF.LOCATIONS) {
            const x = ox + l.x * scale * 0.9, y = oz + l.z * scale * 0.9;
            const vis = g.visited.has(l.id);
            html += `<div class="dot ${vis ? 'vis' : ''}" style="left:${x}px;top:${y}px" data-act="travel" data-id="${l.id}"
              title="${l.name}"><span>${l.name}</span></div>`;
          }
          const px = ox + g.player.pos.x * scale * 0.9, py = oz + g.player.pos.z * scale * 0.9;
          html += `<div class="me" style="left:${px}px;top:${py}px"></div>`;
          const fx = ox + g.furry.root.position.x * scale * 0.9, fy = oz + g.furry.root.position.z * scale * 0.9;
          html += `<div class="fr" style="left:${fx}px;top:${fy}px" title="${g.furry.opts.name}"></div>`;
          html += '</div></div>';
          break;
        }

        /* ---------- КВЕСТЫ ---------- */
        case 'quests': {
          html = head('📜 Журнал заданий', `Выполнено: ${g.quests.done.size} / ${FF.QUESTS.length}`);
          html += '<div class="p-body"><h3>Активные</h3><div class="list">';
          if (!g.quests.active.length) html += '<div class="empty">Нет активных заданий. Поговори с NPC!</div>';
          for (const a of g.quests.active) {
            const q = g.quests.def(a.id);
            const npc = FF.NPCS.find((n) => n.id === q.npc);
            let prog = '';
            if (q.goal.item) prog = ` (${g.inv.count(q.goal.item)}/${q.goal.count || 1})`;
            html += `<div class="recipe"><div class="ic">📜</div><div class="body"><b>${q.name}</b>${prog}
              <span class="tag">${npc ? npc.name : ''}</span><div class="sm">${q.desc}</div></div></div>`;
          }
          html += '</div><h3>Выполненные</h3><div class="list">';
          for (const id of g.quests.done) {
            const q = g.quests.def(id);
            html += `<div class="recipe dis"><div class="ic">✅</div><div class="body"><b>${q.name}</b></div></div>`;
          }
          html += '</div></div>';
          break;
        }

        /* ---------- СТАТИСТИКА ФУРРИ ---------- */
        case 'stats': {
          const f = g.furry;
          html = head('📊 ' + f.opts.name, `${f.species.name} · стадия ${f.stage} «${FF.CONFIG.growth.stageNames[f.stage]}»`);
          html += `<div class="p-body">
            <div class="statgrid">
              <div><b>${U.fmt(f.calories)}</b><span>калорий всего</span></div>
              <div><b>${U.fmt(f.mass)} кг</b><span>масса</span></div>
              <div><b>${Math.floor(f.relation)}</b><span>связь: ${g.relationName()}</span></div>
              <div><b>${f.stats.fed}</b><span>кормлений</span></div>
              <div><b>${Math.floor(f.stats.massages)}с</b><span>массажа</span></div>
              <div><b>${f.stats.bounces}</b><span>прыжков на животе</span></div>
            </div>
            <h3>60 зон роста</h3><div class="zones">`;
          const groups = {};
          for (const nd of f.nodes) (groups[nd.zone.group] = groups[nd.zone.group] || []).push(nd);
          const gnames = { belly: '🔴 Живот и торс', glutes: '🍑 Ягодицы', thighs: '🦵 Бёдра', chest: '💗 Грудь',
            face: '😊 Лицо', neck: '🧣 Шея', arms: '💪 Руки', legs: '🦿 Ноги', back: '🔙 Спина', misc: '✨ Прочее' };
          for (const [gk, list] of Object.entries(groups)) {
            html += `<h4>${gnames[gk] || gk}</h4>`;
            for (const nd of list) {
              const pct = Math.round(nd.growth * 100);
              html += `<div class="zrow"><span class="zn">${nd.zone.name}</span>
                <span class="zb"><i style="width:${pct}%"></i></span>
                <span class="zp">${pct}%</span><span class="zs">${nd.zone.speed.label}</span></div>`;
            }
          }
          html += '</div></div>';
          break;
        }

        /* ---------- ДОСТИЖЕНИЯ ---------- */
        case 'achievements': {
          html = head('🏆 Достижения', `${g.achievements.size} / ${FF.ACHIEVEMENTS.length}`);
          html += '<div class="p-body"><div class="grid">';
          for (const a of FF.ACHIEVEMENTS) {
            const got = g.achievements.has(a.id);
            html += `<div class="item ${got ? '' : 'dis'}"><div class="ic">${got ? '🏆' : '🔒'}</div>
              <div class="nm">${a.name}</div><div class="sm">${a.desc}</div></div>`;
          }
          html += '</div></div>';
          break;
        }

        /* ---------- МЕНЮ / НАСТРОЙКИ ---------- */
        case 'menu': {
          html = head('⏸️ Меню', FF.CONFIG.title + ' v' + FF.CONFIG.version);
          html += `<div class="p-body">
            <div class="btnrow vert">
              <button data-act="close">▶ Продолжить</button>
              <button data-act="save">💾 Сохранить (F5)</button>
              <button data-act="load">📂 Загрузить (F9)</button>
              <button data-act="open_ach">🏆 Достижения</button>
              <button data-act="open_help">❓ Управление</button>
              <button data-act="restart">🔄 Начать заново</button>
            </div>
            <h3>Настройки</h3>
            <div class="settings">
              <label>Громкость общая <input type="range" min="0" max="100" value="${FF.CONFIG.audio.masterVolume * 100}" data-set="master"></label>
              <label>Музыка <input type="range" min="0" max="100" value="${FF.CONFIG.audio.musicVolume * 100}" data-set="music"></label>
              <label>Эффекты <input type="range" min="0" max="100" value="${FF.CONFIG.audio.sfxVolume * 100}" data-set="sfx"></label>
              <label>Голос друга <input type="range" min="0" max="100" value="${FF.CONFIG.audio.furryVolume * 100}" data-set="furry"></label>
              <label>Пост-обработка <input type="checkbox" ${FF.CONFIG.post.enabled ? 'checked' : ''} data-set="post"></label>
              <label>Качество теней <select data-set="shadow">
                <option value="1024">Среднее</option><option value="2048" selected>Высокое</option><option value="512">Низкое</option></select></label>
              <label>Скорость времени <select data-set="timescale">
                <option value="0.35">Медленно</option><option value="0.75" selected>Обычно</option><option value="2">Быстро</option><option value="0">Пауза</option></select></label>
            </div></div>`;
          break;
        }

        /* ---------- ПОМОЩЬ ---------- */
        case 'help': {
          html = head('❓ Управление', 'Всё, что нужно знать');
          html += `<div class="p-body"><div class="keys">
            <div><kbd>W A S D</kbd> движение</div>
            <div><kbd>Space</kbd> прыжок / подтягивание при карабканье</div>
            <div><kbd>Ctrl</kbd> присесть (пролезть ПОД живот)</div>
            <div><kbd>Shift</kbd> бег / усилить хват</div>
            <div><kbd>ЛКМ</kbd> левая рука: тычок, массаж (удерживать), хват</div>
            <div><kbd>ПКМ</kbd> правая рука</div>
            <div><kbd>E</kbd> взаимодействие</div>
            <div><kbd>F</kbd> покормить друга выбранной едой</div>
            <div><kbd>Q</kbd> сменить предмет в руках</div>
            <div><kbd>I</kbd> инвентарь · <kbd>Tab</kbd> карта · <kbd>K</kbd> квесты</div>
            <div><kbd>F4</kbd> 🪙 как заработать монеты</div>
            <div><kbd>L</kbd> статистика друга (60 зон)</div>
            <div><kbd>C</kbd> кухня-крафт (дома) · <kbd>B</kbd> варка (в лаборатории)</div>
            <div><kbd>T</kbd> вызвать такси · <kbd>H</kbd> домой · <kbd>U</kbd> к Артёму</div>
            <div><kbd>P</kbd> фото-режим · <kbd>F2</kbd> скриншот</div>
            <div><kbd>F5</kbd> сохранить · <kbd>F9</kbd> загрузить · <kbd>M</kbd>/<kbd>Esc</kbd> меню</div>
            <div><kbd>G</kbd> БРОСИТЬ еду (физика!) · <kbd>Y</kbd> позвать друга / отменить</div>
            <div><kbd>N</kbd> игры на животе · <kbd>O</kbd> гардероб · <kbd>J</kbd> дневник</div>
            <div><kbd>F3</kbd> отладка коллайдеров: увидеть все 60 эллипсоидов</div>
            <div><kbd>B</kbd> (вне лаборатории) таблица посадки в такси по размерам</div>
            <div><kbd>R</kbd> в такси — пересесть на свободное место</div>
            <div><kbd>←</kbd> <kbd>→</kbd> фильтры в фото-режиме</div>
            <div><kbd>1..9</kbd> быстрые слоты еды</div>
          </div>
          <h3>Советы</h3>
          <ul class="tips">
            <li>Еды в мире МАЛО: у каждой лавки дневной лимит. Готовь сам!</li>
            <li>Хорошее настроение даёт до +30% калорий. Массируй, гладь, води в спа.</li>
            <li>С 6-й стадии друг не может ходить — нужны эликсиры Артёма.</li>
            <li>Карабкайся: ЛКМ+ПКМ по складкам, Space — подтянуться. Следи за стаминой.</li>
            <li>Присядь (Ctrl) у большого живота — попадёшь в тёплые «пещеры» под ним.</li>
          </ul></div>`;
          break;
        }

        /* ---------- ГЕНЕРИЧЕСКИЙ ЛИСТ ДЕЙСТВИЙ ---------- */
        case 'actions': {
          html = head(data.title, data.sub);
          html += '<div class="p-body"><div class="btnrow vert">';
          for (const a of data.actions) html += `<button data-act="${a.act}" data-id="${a.id || ''}" data-seat="${a.seat || ''}">${a.label}</button>`;
          html += '</div>' + (data.html || '') + '</div>';
          break;
        }
      }
      this.panel.innerHTML = html;
      this.panel.querySelectorAll('[data-act]').forEach((n) => {
        n.addEventListener('click', (e) => {
          e.stopPropagation();
          this.game.uiAction(n.dataset.act, n.dataset, data);
        });
      });
      this.panel.querySelectorAll('[data-set]').forEach((n) => {
        n.addEventListener('input', () => this.game.applySetting(n.dataset.set, n.type === 'checkbox' ? n.checked : n.value));
      });
    }

    /* ==================== МИНИ-ИГРЫ ==================== */
    startMinigame(id, onDone) {
      // Продвинутая мини-игра со своей механикой?
      const adv = FF.ADVANCED_GAMES && FF.ADVANCED_GAMES[id];
      if (adv) return this._startAdvanced(id, adv, onDone);

      const def = FF.MINIGAMES[id];
      if (!def) { onDone && onDone(0); return; }
      this.game.player.frozen = true;
      document.exitPointerLock && document.pointerLockElement && document.exitPointerLock();
      this.mg.classList.remove('hidden');
      const st = {
        id, def, t: 0, score: 0, hits: 0, misses: 0, onDone,
        beat: 0, beatPeriod: 0.85, targets: [], angle: 0, lastAngle: null, circleProgress: 0,
      };
      this.minigame = st;
      this.mg.innerHTML = `
        <div class="mg-box">
          <h2>${def.name}</h2><p>${def.desc}</p>
          <div class="mg-area" id="mgArea"></div>
          <div class="mg-bar"><i id="mgTime"></i></div>
          <div class="mg-score">Очки: <b id="mgScore">0</b></div>
          <button id="mgQuit">Прервать (Esc)</button>
        </div>`;
      this.mgArea = document.getElementById('mgArea');
      this.mgTime = document.getElementById('mgTime');
      this.mgScore = document.getElementById('mgScore');
      document.getElementById('mgQuit').onclick = () => this.endMinigame();

      if (def.type === 'rhythm') {
        this.mgArea.innerHTML = '<div class="ring"><div class="ring-inner" id="mgRing"></div><div class="ring-target"></div></div>';
        st.ring = document.getElementById('mgRing');
      } else if (def.type === 'circle') {
        this.mgArea.innerHTML = '<div class="circle-track"><div class="circle-dot" id="mgDot"></div></div><div class="circle-hint">Веди мышью по кругу ↻</div>';
        st.dot = document.getElementById('mgDot');
        this._mgMove = (e) => {
          const r = this.mgArea.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const a = Math.atan2(e.clientY - cy, e.clientX - cx);
          if (st.lastAngle != null) {
            let d = a - st.lastAngle;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            if (d > 0) { st.circleProgress += d; st.score += d * 9; }
          }
          st.lastAngle = a;
          st.dot.style.transform = `rotate(${a}rad) translateX(90px)`;
        };
        window.addEventListener('mousemove', this._mgMove);
      } else if (def.type === 'click') {
        this.mgArea.innerHTML = '';
      }
    }

    /** Запуск мини-игры с собственным canvas-движком */
    _startAdvanced(id, adv, onDone) {
      this.game.player.frozen = true;
      document.exitPointerLock && document.pointerLockElement && document.exitPointerLock();
      this.mg.classList.remove('hidden');
      const inst = new adv.cls(this.game, {});
      this.mg.innerHTML = `
        <div class="mg-box">
          <h2>${adv.name}</h2><p>${adv.desc}</p>
          <div class="mg-area" id="mgArea"></div>
          <div class="mg-bar"><i id="mgTime"></i></div>
          <div class="mg-score">Очки: <b id="mgScore">0</b></div>
          <button id="mgQuit">Прервать (Esc)</button>
        </div>`;
      const area = document.getElementById('mgArea');
      this.mgTime = document.getElementById('mgTime');
      this.mgScore = document.getElementById('mgScore');
      inst.mount(area, 560, 290);
      document.getElementById('mgQuit').onclick = () => this.endMinigame();
      this.minigame = { advanced: true, inst, id, onDone, def: { name: adv.name, duration: inst.duration } };
      return this.minigame;
    }

    updateMinigame(dt) {
      const st = this.minigame;
      if (!st) return;
      // Продвинутая игра: свой цикл
      if (st.advanced) {
        st.inst.tick(dt);
        this.mgTime.style.width = U.clamp(1 - st.inst.time / st.inst.duration, 0, 1) * 100 + '%';
        this.mgScore.textContent = Math.floor(st.inst.score);
        if (st.inst.done) this.endMinigame();
        return;
      }
      st.t += dt;
      const left = st.def.duration - st.t;
      this.mgTime.style.width = U.clamp(left / st.def.duration, 0, 1) * 100 + '%';
      this.mgScore.textContent = Math.floor(st.score);

      if (st.def.type === 'rhythm') {
        st.beat += dt;
        const p = (st.beat % st.beatPeriod) / st.beatPeriod;
        st.ring.style.transform = `scale(${0.25 + p * 0.95})`;
        st.ring.style.opacity = 0.35 + p * 0.65;
      } else if (st.def.type === 'click') {
        // Спавн целей
        st.spawnT = (st.spawnT || 0) - dt;
        if (st.spawnT <= 0) {
          st.spawnT = 0.55;
          const d = document.createElement('div');
          d.className = 'mg-target' + (Math.random() < 0.22 ? ' bad' : '');
          d.style.left = U.rand(6, 88) + '%';
          d.style.top = U.rand(8, 78) + '%';
          d.textContent = d.className.includes('bad') ? '🐝' : U.pick(['🥚', '🍯', '🫧', '📋', '🎯']);
          d.onclick = (e) => {
            e.stopPropagation();
            if (d.className.includes('bad')) { st.score = Math.max(0, st.score - 12); st.misses++; this.game.audio.ui('err'); }
            else { st.score += 12; st.hits++; this.game.audio.ui('ok'); }
            d.remove();
          };
          this.mgArea.appendChild(d);
          setTimeout(() => d.remove(), 1500);
        }
      } else if (st.def.type === 'circle') {
        // Плавность вознаграждается пассивно
      }

      if (left <= 0) this.endMinigame();
    }

    mgKey(code, down) {
      const st = this.minigame;
      if (!st) return;
      if (code === 'Escape') { this.endMinigame(); return; }
      if (st.advanced) { st.inst.key(code, down !== false); return; }
      if (code === 'Space' && st.def.type === 'rhythm') {
        const p = (st.beat % st.beatPeriod) / st.beatPeriod;
        const err = Math.abs(p - 0.85);
        if (err < 0.09) { st.score += 18; st.hits++; this.game.audio.ui('ok'); }
        else if (err < 0.2) { st.score += 8; st.hits++; this.game.audio.ui('click'); }
        else { st.score = Math.max(0, st.score - 6); st.misses++; this.game.audio.ui('err'); }
        if (st.id === 'pump') this.game.audio.pump(st.hits);
        if (st.id === 'brew') this.game.audio.bubble();
      }
    }

    endMinigame() {
      const st = this.minigame;
      if (!st) return;
      if (st.advanced) {
        if (!st.inst.done) st.inst.finish();
        const q = st.inst.quality != null ? st.inst.quality : 0;
        st.inst.unmount();
        this.mg.classList.add('hidden');
        this.mg.innerHTML = '';
        this.minigame = null;
        this.game.player.frozen = false;
        this.game.requestPointerLock();
        st.onDone && st.onDone(q);
        return;
      }
      if (this._mgMove) { window.removeEventListener('mousemove', this._mgMove); this._mgMove = null; }
      this.mg.classList.add('hidden');
      this.mg.innerHTML = '';
      this.minigame = null;
      this.game.player.frozen = false;
      this.game.requestPointerLock();
      // Оценка 0..1
      const maxScore = st.def.duration * 14;
      const q = U.clamp(st.score / maxScore, 0, 1.15);
      st.onDone && st.onDone(q);
    }
  }

  FF.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
