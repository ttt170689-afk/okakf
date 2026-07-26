/**
 * minigames.js — Расширенные мини-игры с собственной механикой.
 *
 * В отличие от базовых трёх типов (ритм/круг/клик) из ui.js, здесь
 * полноценные игры со своей логикой, состоянием и отрисовкой на canvas.
 *
 *   1. CookingGame     — многоэтапная готовка: замес → нагрев → украшение
 *   2. PumpGame        — насос: держать давление в зелёной зоне
 *   3. BalanceGame     — «Не упади»: удержаться на колышущемся животе
 *   4. CraneGame       — погрузка гиганта краном
 *   5. MemoryGame      — алхимическая головоломка (порядок ингредиентов)
 *   6. FishingGame     — рыбалка с натяжением лески
 *
 * Все игры работают на общем каркасе MiniGameBase: canvas 2D поверх UI.
 *
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const U = FF.U;

  /* ============================================================
   * БАЗОВЫЙ КЛАСС
   * ============================================================ */
  class MiniGameBase {
    constructor(game, opts) {
      this.game = game;
      this.opts = opts || {};
      this.score = 0;
      this.maxScore = 100;
      this.time = 0;
      this.duration = this.opts.duration || 20;
      this.done = false;
      this.canvas = null;
      this.ctx = null;
      this.mouse = { x: 0, y: 0, down: false };
      this.keys = {};
    }

    /** Монтирование в контейнер мини-игры */
    mount(container, width, height) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = width || 560;
      this.canvas.height = height || 290;
      this.canvas.style.cssText = 'width:100%;height:100%;display:block;border-radius:12px;cursor:crosshair';
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      this._onMove = (e) => {
        const r = this.canvas.getBoundingClientRect();
        this.mouse.x = (e.clientX - r.left) / r.width * this.canvas.width;
        this.mouse.y = (e.clientY - r.top) / r.height * this.canvas.height;
      };
      this._onDown = (e) => { this.mouse.down = true; this.onClick && this.onClick(this.mouse.x, this.mouse.y); };
      this._onUp = () => { this.mouse.down = false; };
      this.canvas.addEventListener('mousemove', this._onMove);
      this.canvas.addEventListener('mousedown', this._onDown);
      window.addEventListener('mouseup', this._onUp);
      this.init && this.init();
    }

    unmount() {
      if (this.canvas) {
        this.canvas.removeEventListener('mousemove', this._onMove);
        this.canvas.removeEventListener('mousedown', this._onDown);
        window.removeEventListener('mouseup', this._onUp);
        this.canvas.remove();
      }
    }

    key(code, down) {
      this.keys[code] = down;
      if (down && this.onKey) this.onKey(code);
    }

    tick(dt) {
      if (this.done) return;
      this.time += dt;
      this.update(dt);
      this.draw();
      if (this.time >= this.duration) this.finish();
    }

    finish() {
      this.done = true;
      this.quality = U.clamp(this.score / this.maxScore, 0, 1.15);
    }

    /* --- Утилиты рисования --- */
    clear(color) {
      const c = this.ctx;
      c.fillStyle = color || '#1a1018';
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    text(str, x, y, size, color, align) {
      const c = this.ctx;
      c.fillStyle = color || '#fff2e0';
      c.font = `${size || 14}px system-ui, sans-serif`;
      c.textAlign = align || 'center';
      c.textBaseline = 'middle';
      c.fillText(str, x, y);
    }
    bar(x, y, w, h, pct, color, bg) {
      const c = this.ctx;
      c.fillStyle = bg || 'rgba(0,0,0,.45)';
      c.fillRect(x, y, w, h);
      c.fillStyle = color || '#ffb46b';
      c.fillRect(x, y, w * U.clamp(pct, 0, 1), h);
      c.strokeStyle = 'rgba(255,255,255,.2)';
      c.strokeRect(x, y, w, h);
    }
    circle(x, y, r, color, fill) {
      const c = this.ctx;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      if (fill) { c.fillStyle = color; c.fill(); }
      else { c.strokeStyle = color; c.lineWidth = 3; c.stroke(); }
    }
  }

  /* ============================================================
   * 1. ГОТОВКА — три этапа
   * ============================================================ */
  class CookingGame extends MiniGameBase {
    init() {
      this.stage = 0;              // 0 замес, 1 нагрев, 2 украшение
      this.stageNames = ['Замес теста', 'Нагрев печи', 'Украшение'];
      this.duration = 22;
      this.maxScore = 300;
      // Замес
      this.knead = 0;
      this.lastAngle = null;
      // Нагрев
      this.temp = 20;
      this.targetTemp = U.rand(160, 200);
      this.tempOk = 0;
      // Украшение
      this.dots = [];
      this.placed = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        this.dots.push({ x: 280 + Math.cos(a) * 75, y: 150 + Math.sin(a) * 75, hit: false });
      }
      this.stageTime = 0;
    }

    onKey(code) {
      if (code === 'Space' && this.stage === 1) this.heating = true;
    }

    onClick(x, y) {
      if (this.stage !== 2) return;
      for (const d of this.dots) {
        if (!d.hit && Math.hypot(d.x - x, d.y - y) < 22) {
          d.hit = true; this.placed++;
          this.score += 12;
          this.game.audio.ui('ok');
        }
      }
    }

    update(dt) {
      this.stageTime += dt;
      if (this.stage === 0) {
        // Замес: круговые движения мышью
        const cx = 280, cy = 150;
        const a = Math.atan2(this.mouse.y - cy, this.mouse.x - cx);
        if (this.lastAngle !== null) {
          let d = a - this.lastAngle;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          if (d > 0 && Math.abs(d) < 0.6) { this.knead += d; this.score += d * 5; }
        }
        this.lastAngle = a;
        if (this.knead > Math.PI * 6 || this.stageTime > 8) { this.stage = 1; this.stageTime = 0; }
      } else if (this.stage === 1) {
        // Нагрев: держать в диапазоне ±15 от цели
        if (this.keys.Space) this.temp += dt * 90;
        else this.temp -= dt * 55;
        this.temp = U.clamp(this.temp, 20, 280);
        if (Math.abs(this.temp - this.targetTemp) < 15) {
          this.tempOk += dt;
          this.score += dt * 14;
        }
        if (this.tempOk > 4 || this.stageTime > 9) { this.stage = 2; this.stageTime = 0; }
      } else {
        if (this.placed >= this.dots.length || this.stageTime > 7) this.finish();
      }
    }

    draw() {
      this.clear('#241620');
      const c = this.ctx;
      this.text(`Этап ${this.stage + 1}/3: ${this.stageNames[this.stage]}`, 280, 22, 16, '#ffcf8a');

      if (this.stage === 0) {
        this.circle(280, 150, 78, 'rgba(255,207,138,.35)');
        const prog = U.clamp(this.knead / (Math.PI * 6), 0, 1);
        c.beginPath();
        c.arc(280, 150, 78, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
        c.strokeStyle = '#ff9ec4'; c.lineWidth = 8; c.stroke();
        // Тесто
        this.circle(280, 150, 46 + Math.sin(this.time * 6) * 3, '#e8d0a8', true);
        this.text('Веди мышью по кругу ↻', 280, 255, 13, 'rgba(255,242,224,.7)');
      } else if (this.stage === 1) {
        const y = 240 - (this.temp / 280) * 180;
        const ty = 240 - (this.targetTemp / 280) * 180;
        // Шкала
        c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(250, 60, 60, 180);
        // Зелёная зона
        const zoneH = (30 / 280) * 180;
        c.fillStyle = 'rgba(124,214,107,.35)';
        c.fillRect(250, ty - zoneH / 2, 60, zoneH);
        // Текущая температура
        c.fillStyle = this.temp > this.targetTemp + 15 ? '#ff6b6b' : '#ffb46b';
        c.fillRect(250, y - 4, 60, 8);
        this.text(`${Math.round(this.temp)}°`, 340, y, 15, '#fff');
        this.text(`Цель: ${Math.round(this.targetTemp)}°`, 170, ty, 13, '#7cd66b');
        this.text('Держи ПРОБЕЛ для нагрева', 280, 265, 13, 'rgba(255,242,224,.75)');
        this.bar(120, 30, 320, 8, this.tempOk / 4, '#7cd66b');
      } else {
        this.circle(280, 150, 82, '#d8a878', true);
        this.circle(280, 150, 82, 'rgba(255,255,255,.25)');
        for (const d of this.dots) {
          this.circle(d.x, d.y, d.hit ? 11 : 15, d.hit ? '#ff5ea8' : 'rgba(255,255,255,.35)', d.hit);
        }
        this.text(`Укрась: ${this.placed}/${this.dots.length}`, 280, 265, 14, '#ffcf8a');
      }
    }
  }

  /* ============================================================
   * 2. НАСОС — удержание давления
   * ============================================================ */
  class PumpGame extends MiniGameBase {
    init() {
      this.duration = 24;
      this.maxScore = 260;
      this.pressure = 30;
      this.target = 60;
      this.filled = 0;
      this.targetDrift = 0;
      this.overload = 0;
      this.bellyGrow = 0;
    }

    update(dt) {
      // Цель плавает — нужно постоянно подстраиваться
      this.targetDrift += dt;
      this.target = 55 + Math.sin(this.targetDrift * 0.55) * 22;

      if (this.keys.Space) this.pressure += dt * 52;
      else this.pressure -= dt * 34;
      this.pressure = U.clamp(this.pressure, 0, 110);

      const diff = Math.abs(this.pressure - this.target);
      if (diff < 12) {
        this.filled += dt * 11;
        this.score += dt * 12;
        this.bellyGrow += dt * 0.04;
        if (Math.random() < dt * 5) this.game.audio.pump(Math.floor(this.time * 3));
      } else if (this.pressure > 95) {
        this.overload += dt;
        this.score -= dt * 8;
        if (this.overload > 2.5) {
          this.game.notify('💥 Перегрузка! Насос отключился.', 'warn');
          this.finish();
        }
      }
      this.filled = Math.min(100, this.filled);
      if (this.filled >= 100) this.finish();
    }

    draw() {
      this.clear('#131c26');
      const c = this.ctx;
      this.text('НАСОСНЫЙ ТЕРМИНАЛ', 280, 20, 15, '#4ad8ff');

      // Манометр
      const cx = 150, cy = 155, r = 68;
      this.circle(cx, cy, r, 'rgba(74,216,255,.3)');
      // Зелёная зона цели
      const a0 = Math.PI * 0.75 + (this.target - 12) / 110 * Math.PI * 1.5;
      const a1 = Math.PI * 0.75 + (this.target + 12) / 110 * Math.PI * 1.5;
      c.beginPath(); c.arc(cx, cy, r - 8, a0, a1);
      c.strokeStyle = 'rgba(124,214,107,.75)'; c.lineWidth = 12; c.stroke();
      // Стрелка
      const ang = Math.PI * 0.75 + (this.pressure / 110) * Math.PI * 1.5;
      c.beginPath(); c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(ang) * (r - 14), cy + Math.sin(ang) * (r - 14));
      c.strokeStyle = this.pressure > 95 ? '#ff4444' : '#ffcf8a'; c.lineWidth = 4; c.stroke();
      this.circle(cx, cy, 6, '#ffcf8a', true);
      this.text(`${Math.round(this.pressure)}`, cx, cy + 36, 18, '#fff');

      // Резервуар и «живот»
      this.bar(270, 70, 46, 170, this.filled / 100, '#ffb46b');
      this.text('Закачано', 293, 258, 12, 'rgba(255,242,224,.7)');
      const bellyR = 34 + this.bellyGrow * 26;
      this.circle(430, 165, bellyR, '#e8a878', true);
      this.circle(430, 165, bellyR, 'rgba(255,255,255,.2)');
      this.text(`${Math.round(this.filled)}%`, 430, 165, 15, '#3a2018');

      if (this.pressure > 95) this.text('⚠ ПЕРЕГРУЗКА', 280, 275, 15, '#ff6b6b');
      else this.text('Держи ПРОБЕЛ — удержи стрелку в зелёной зоне', 280, 275, 12, 'rgba(255,242,224,.7)');
    }
  }

  /* ============================================================
   * 3. НЕ УПАДИ — баланс на животе
   * ============================================================ */
  class BalanceGame extends MiniGameBase {
    init() {
      this.duration = 26;
      this.maxScore = 300;
      this.px = 280;      // позиция игрока
      this.vx = 0;
      this.tilt = 0;
      this.tiltVel = 0;
      this.falls = 0;
      this.waveT = 0;
      this.difficulty = 1;
    }

    update(dt) {
      this.difficulty += dt * 0.08;
      this.waveT += dt;
      // Живот колышется всё сильнее
      const wave = Math.sin(this.waveT * 1.9) * 0.9 + Math.sin(this.waveT * 3.7 + 1) * 0.55;
      this.tiltVel += wave * dt * 26 * this.difficulty;
      this.tiltVel *= Math.exp(-1.6 * dt);
      this.tilt += this.tiltVel * dt;
      this.tilt = U.clamp(this.tilt, -40, 40);

      // Управление: мышь тянет игрока к себе
      const wantX = this.mouse.x;
      this.vx += (wantX - this.px) * dt * 7;
      // Наклон сносит
      this.vx += this.tilt * dt * 4.5;
      this.vx *= Math.exp(-3.2 * dt);
      this.px += this.vx * dt;

      // Границы = падение
      if (this.px < 60 || this.px > 500) {
        this.falls++;
        this.score -= 25;
        this.px = 280; this.vx = 0; this.tilt = 0; this.tiltVel = 0;
        this.game.audio.ui('err');
        this.game.audio.slap(1.2);
        if (this.falls >= 3) this.finish();
      } else {
        // Очки за удержание в центре
        const centerBonus = 1 - Math.abs(this.px - 280) / 220;
        this.score += dt * 13 * centerBonus * this.difficulty;
      }
    }

    draw() {
      this.clear('#20161c');
      const c = this.ctx;
      this.text('НЕ УПАДИ!', 280, 20, 16, '#ffcf8a');
      this.text(`Падений: ${this.falls}/3`, 480, 20, 13, this.falls >= 2 ? '#ff6b6b' : '#fff2e0', 'right');

      // Живот — дуга, которая наклоняется
      c.save();
      c.translate(280, 320);
      c.rotate(this.tilt * 0.0075);
      c.beginPath();
      c.ellipse(0, 0, 250, 150, 0, Math.PI, Math.PI * 2);
      const grad = c.createLinearGradient(0, -150, 0, 0);
      grad.addColorStop(0, '#e8a878'); grad.addColorStop(1, '#c98058');
      c.fillStyle = grad; c.fill();
      // Складки
      c.strokeStyle = 'rgba(140,80,50,.4)'; c.lineWidth = 3;
      for (const off of [-120, 0, 120]) {
        c.beginPath();
        c.ellipse(off, -20, 45, 22, 0, Math.PI, Math.PI * 2);
        c.stroke();
      }
      c.restore();

      // Игрок
      const py = 320 - Math.sqrt(Math.max(0, 1 - ((this.px - 280) / 250) ** 2)) * 150 - 16;
      this.circle(this.px, py, 13, '#8ac6ff', true);
      this.circle(this.px, py, 13, 'rgba(255,255,255,.5)');

      // Индикатор наклона
      this.bar(140, 250, 280, 10, (this.tilt + 40) / 80, Math.abs(this.tilt) > 26 ? '#ff6b6b' : '#7cd66b');
      this.text('Наклон', 280, 268, 11, 'rgba(255,242,224,.65)');
      this.text('Веди мышью, чтобы удержаться в центре', 280, 44, 12, 'rgba(255,242,224,.7)');
    }
  }

  /* ============================================================
   * 4. КРАН — погрузка гиганта
   * ============================================================ */
  class CraneGame extends MiniGameBase {
    init() {
      this.duration = 30;
      this.maxScore = 250;
      this.phase = 0;         // 0 подвести ремни, 1 поднять, 2 опустить на платформу
      this.craneX = 280;
      this.hookY = 60;
      this.strapsPlaced = 0;
      this.straps = [
        { x: 200, placed: false }, { x: 280, placed: false }, { x: 360, placed: false },
      ];
      this.load = 0;
      this.sway = 0;
      this.swayVel = 0;
      this.platformX = 430;
    }

    onClick(x, y) {
      if (this.phase !== 0) return;
      for (const s of this.straps) {
        if (!s.placed && Math.abs(this.craneX - s.x) < 26) {
          s.placed = true; this.strapsPlaced++;
          this.score += 22;
          this.game.audio.ui('ok');
          if (this.strapsPlaced === 3) { this.phase = 1; this.game.notify('🏗️ Ремни закреплены! Поднимаем.', 'info'); }
        }
      }
    }

    update(dt) {
      this.craneX = U.damp(this.craneX, this.mouse.x, 7, dt);

      if (this.phase === 1) {
        // Подъём: держать ПРОБЕЛ, но плавно — рывки раскачивают
        if (this.keys.Space) {
          this.load += dt * 16;
          this.swayVel += dt * 9;
        } else this.swayVel -= dt * 4;
        this.sway += this.swayVel * dt;
        this.sway *= Math.exp(-0.9 * dt);
        this.swayVel *= Math.exp(-1.4 * dt);
        this.sway = U.clamp(this.sway, -50, 50);
        if (Math.abs(this.sway) < 14) this.score += dt * 9;
        else this.score -= dt * 5;
        this.load = U.clamp(this.load, 0, 100);
        if (this.load >= 100) { this.phase = 2; this.game.notify('🏗️ Поднято! Теперь на платформу.', 'info'); }
      } else if (this.phase === 2) {
        // Совместить с платформой
        this.sway *= Math.exp(-1.2 * dt);
        const off = Math.abs(this.craneX - this.platformX);
        if (off < 22 && Math.abs(this.sway) < 10) {
          this.score += dt * 26;
          this.landed = (this.landed || 0) + dt;
          if (this.landed > 2) { this.score += 40; this.finish(); }
        } else this.landed = 0;
      }
    }

    draw() {
      this.clear('#1c1a20');
      const c = this.ctx;
      const names = ['Подведи ремни (клик под фурри)', 'Держи ПРОБЕЛ — поднимай плавно!', 'Совмести с платформой'];
      this.text(names[this.phase], 280, 20, 14, '#ffcf8a');

      // Балка крана
      c.fillStyle = '#ffcc33';
      c.fillRect(40, 40, 480, 12);
      c.fillRect(this.craneX - 5, 46, 10, this.hookY + this.load * 0.4);

      // Крюк
      const hy = 46 + this.hookY + this.load * 0.4;
      this.circle(this.craneX, hy, 8, '#d8d8d8', true);

      // Фурри (поднимается по мере load)
      const fy = 250 - this.load * 1.1;
      const fx = this.craneX + this.sway;
      c.save();
      c.translate(fx, fy);
      c.beginPath();
      c.ellipse(0, 0, 62, 44, this.sway * 0.004, 0, Math.PI * 2);
      c.fillStyle = '#e8a878'; c.fill();
      c.strokeStyle = 'rgba(140,80,50,.5)'; c.lineWidth = 2; c.stroke();
      c.restore();

      // Ремни
      for (const s of this.straps) {
        c.strokeStyle = s.placed ? '#7cd66b' : 'rgba(255,255,255,.28)';
        c.lineWidth = s.placed ? 4 : 2;
        c.beginPath();
        c.moveTo(s.x - 30, fy + 40); c.lineTo(s.x + 30, fy + 40);
        c.stroke();
      }

      // Платформа
      c.fillStyle = this.phase === 2 ? '#7cd66b' : '#5a6472';
      c.fillRect(this.platformX - 55, 252, 110, 14);
      this.text('ПЛАТФОРМА', this.platformX, 275, 11, 'rgba(255,242,224,.7)');

      // Индикаторы
      this.bar(40, 262, 150, 9, this.load / 100, '#ffb46b');
      this.text('Подъём', 115, 280, 11, 'rgba(255,242,224,.6)');
      if (this.phase >= 1) {
        this.bar(210, 262, 150, 9, (this.sway + 50) / 100, Math.abs(this.sway) > 20 ? '#ff6b6b' : '#7cd66b');
        this.text('Раскачка', 285, 280, 11, 'rgba(255,242,224,.6)');
      }
    }
  }

  /* ============================================================
   * 5. АЛХИМИЧЕСКАЯ ПАМЯТЬ
   * ============================================================ */
  class MemoryGame extends MiniGameBase {
    init() {
      this.duration = 40;
      this.maxScore = 240;
      this.colors = ['#ff6b6b', '#7cd66b', '#8ac6ff', '#ffd24a', '#c58bff'];
      this.icons = ['🍄', '💧', '💎', '✨', '🍫'];
      this.sequence = [];
      this.playerSeq = [];
      this.showing = true;
      this.showIndex = 0;
      this.showTimer = 0;
      this.round = 1;
      this._extend();
    }

    _extend() {
      this.sequence.push(U.randInt(0, 4));
      this.showing = true;
      this.showIndex = 0;
      this.showTimer = 0;
      this.playerSeq = [];
    }

    onClick(x, y) {
      if (this.showing) return;
      for (let i = 0; i < 5; i++) {
        const cx = 90 + i * 100, cy = 160;
        if (Math.hypot(cx - x, cy - y) < 38) {
          this.playerSeq.push(i);
          this.flash = { i, t: 0.25 };
          this.game.audio.tone({ freq: 320 + i * 90, type: 'sine', dur: 0.16, gain: 0.16 });
          const idx = this.playerSeq.length - 1;
          if (this.sequence[idx] !== i) {
            this.score = Math.max(0, this.score - 30);
            this.game.audio.ui('err');
            this.game.notify('❌ Неверный порядок! Артём вздыхает.', 'warn');
            this.playerSeq = [];
            this.showing = true; this.showIndex = 0; this.showTimer = 0;
            return;
          }
          if (this.playerSeq.length === this.sequence.length) {
            this.score += 24 + this.round * 6;
            this.round++;
            this.game.audio.ui('achieve');
            if (this.round > 6) { this.finish(); return; }
            setTimeout(() => this._extend(), 400);
          }
          return;
        }
      }
    }

    update(dt) {
      if (this.flash) { this.flash.t -= dt; if (this.flash.t <= 0) this.flash = null; }
      if (!this.showing) return;
      this.showTimer += dt;
      if (this.showTimer > 0.62) {
        this.showTimer = 0;
        this.showIndex++;
        if (this.showIndex > this.sequence.length) { this.showing = false; this.showIndex = -1; }
        else if (this.showIndex <= this.sequence.length) {
          const i = this.sequence[this.showIndex - 1];
          if (i !== undefined) this.game.audio.tone({ freq: 320 + i * 90, type: 'triangle', dur: 0.3, gain: 0.14 });
        }
      }
    }

    draw() {
      this.clear('#161428');
      this.text(this.showing ? 'Запоминай порядок...' : 'Повтори последовательность!',
        280, 24, 15, this.showing ? '#8ac6ff' : '#7cd66b');
      this.text(`Раунд ${this.round}/6 · длина ${this.sequence.length}`, 280, 48, 12, 'rgba(255,242,224,.7)');

      for (let i = 0; i < 5; i++) {
        const cx = 90 + i * 100, cy = 160;
        const active = (this.showing && this.showIndex > 0 && this.sequence[this.showIndex - 1] === i)
          || (this.flash && this.flash.i === i);
        this.circle(cx, cy, active ? 42 : 34, this.colors[i], true);
        if (active) {
          this.ctx.globalAlpha = 0.35;
          this.circle(cx, cy, 54, this.colors[i], true);
          this.ctx.globalAlpha = 1;
        }
        this.ctx.font = '26px system-ui';
        this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
        this.ctx.fillText(this.icons[i], cx, cy);
      }

      // Прогресс ввода
      for (let i = 0; i < this.sequence.length; i++) {
        const filled = i < this.playerSeq.length;
        this.ctx.fillStyle = filled ? '#7cd66b' : 'rgba(255,255,255,.2)';
        this.ctx.fillRect(180 + i * 22, 240, 16, 8);
      }
    }
  }

  /* ============================================================
   * 6. РЫБАЛКА — натяжение лески
   * ============================================================ */
  class FishingGame extends MiniGameBase {
    init() {
      this.duration = 32;
      this.maxScore = 220;
      this.fishY = 150;
      this.fishVel = 0;
      this.barY = 150;
      this.barH = 62;
      this.progress = 0;
      this.tension = 0;
      this.caught = 0;
      this.fishTarget = 150;
      this.changeTimer = 0;
    }

    update(dt) {
      // Рыба мечется
      this.changeTimer -= dt;
      if (this.changeTimer <= 0) {
        this.changeTimer = U.rand(0.5, 1.6);
        this.fishTarget = U.rand(50, 250);
      }
      this.fishVel += (this.fishTarget - this.fishY) * dt * 3.4;
      this.fishVel *= Math.exp(-2.2 * dt);
      this.fishY += this.fishVel * dt;
      this.fishY = U.clamp(this.fishY, 40, 260);

      // Планка: ПРОБЕЛ поднимает
      if (this.keys.Space) this.barVel = (this.barVel || 0) - dt * 260;
      else this.barVel = (this.barVel || 0) + dt * 190;
      this.barVel *= Math.exp(-2.6 * dt);
      this.barY += this.barVel * dt;
      this.barY = U.clamp(this.barY, 40, 260);

      // Рыба в планке?
      const inBar = Math.abs(this.fishY - this.barY) < this.barH / 2;
      if (inBar) {
        this.progress += dt * 22;
        this.score += dt * 9;
        this.tension = Math.max(0, this.tension - dt * 18);
      } else {
        this.progress -= dt * 13;
        this.tension += dt * 12;
      }
      this.progress = U.clamp(this.progress, 0, 100);
      this.tension = U.clamp(this.tension, 0, 100);

      if (this.tension >= 100) {
        this.game.notify('💔 Леска порвалась!', 'warn');
        this.game.audio.ui('err');
        this.finish();
      }
      if (this.progress >= 100) {
        this.caught++;
        this.score += 55;
        this.game.audio.ui('achieve');
        this.game.notify(`🐟 Поймана рыба #${this.caught}!`, 'quest');
        this.progress = 0; this.tension = 0;
        if (this.caught >= 3) this.finish();
      }
    }

    draw() {
      this.clear('#0f2231');
      const c = this.ctx;
      this.text('РЫБАЛКА', 280, 20, 15, '#8ac6ff');
      this.text(`Поймано: ${this.caught}/3`, 480, 20, 12, '#fff2e0', 'right');

      // Вода
      const grad = c.createLinearGradient(0, 35, 0, 275);
      grad.addColorStop(0, 'rgba(74,154,216,.35)');
      grad.addColorStop(1, 'rgba(20,60,100,.6)');
      c.fillStyle = grad;
      c.fillRect(180, 35, 90, 240);

      // Планка удержания
      c.fillStyle = 'rgba(124,214,107,.32)';
      c.fillRect(180, this.barY - this.barH / 2, 90, this.barH);
      c.strokeStyle = '#7cd66b'; c.lineWidth = 2;
      c.strokeRect(180, this.barY - this.barH / 2, 90, this.barH);

      // Рыба
      c.font = '26px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('🐟', 225, this.fishY);

      // Прогресс вылова
      this.bar(300, 40, 26, 230, this.progress / 100, '#7cd66b');
      this.text('Вылов', 313, 285, 11, 'rgba(255,242,224,.65)');
      // Натяжение лески
      this.bar(350, 40, 26, 230, this.tension / 100, this.tension > 70 ? '#ff4444' : '#ffb46b');
      this.text('Леска', 363, 285, 11, 'rgba(255,242,224,.65)');

      this.text('ПРОБЕЛ — тянуть вверх. Держи рыбу в зелёной зоне', 280, 300, 11, 'rgba(255,242,224,.6)');
    }
  }

  /* ============================================================
   * РЕЕСТР
   * ============================================================ */
  const ADVANCED_GAMES = {
    cooking: { cls: CookingGame, name: 'Готовка', desc: 'Три этапа: замес, нагрев, украшение' },
    pump: { cls: PumpGame, name: 'Насосная закачка', desc: 'Удержи давление в зелёной зоне' },
    dontfall: { cls: BalanceGame, name: 'Не упади!', desc: 'Удержись на колышущемся животе' },
    crane: { cls: CraneGame, name: 'Погрузка гиганта', desc: 'Ремни, подъём, платформа' },
    brew: { cls: MemoryGame, name: 'Варка эликсира', desc: 'Повтори порядок ингредиентов' },
    fishing: { cls: FishingGame, name: 'Рыбалка', desc: 'Удержи рыбу и не порви леску' },
  };

  FF.MiniGameBase = MiniGameBase;
  FF.ADVANCED_GAMES = ADVANCED_GAMES;
})(typeof window !== 'undefined' ? window : globalThis);
