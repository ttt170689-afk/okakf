/**
 * audio.js — Процедурный звуковой движок (Web Audio API).
 * Все звуки синтезируются в рантайме: никаких внешних ассетов.
 * Слои: ambience (фон), sfx (3D-позиционные), furry (голос), music (ло-фай генератор).
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const CFG = () => FF.CONFIG.audio;

  class AudioEngine {
    constructor() {
      this.ready = false;
      this.ctx = null;
      this.buses = {};
      this.musicTimer = 0;
      this.musicStyle = 'lofi';
      this.enabled = true;
      this.listenerPos = { x: 0, y: 0, z: 0 };
    }

    /** Инициализация после первого пользовательского жеста */
    init() {
      if (this.ready) return;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { console.warn('[audio] Web Audio API недоступен'); return; }
      this.ctx = new AC();
      const master = this.ctx.createGain();
      master.gain.value = CFG().masterVolume;
      // Мягкий лимитер, чтобы ASMR не резал уши
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.knee.value = 24; comp.ratio.value = 4;
      comp.attack.value = 0.005; comp.release.value = 0.25;
      master.connect(comp); comp.connect(this.ctx.destination);
      this.master = master;

      for (const name of ['sfx', 'furry', 'music', 'ambience']) {
        const g = this.ctx.createGain();
        g.gain.value = name === 'music' ? CFG().musicVolume
          : name === 'furry' ? CFG().furryVolume
          : name === 'ambience' ? 0.28 : CFG().sfxVolume;
        g.connect(master);
        this.buses[name] = g;
      }
      this.ready = true;
      this._startAmbience();
      this._noiseBuffer = this._makeNoise(2.0);
    }

    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

    setVolume(bus, v) {
      if (!this.ready) return;
      if (bus === 'master') this.master.gain.value = v;
      else if (this.buses[bus]) this.buses[bus].gain.value = v;
    }

    _makeNoise(sec) {
      const len = Math.floor(this.ctx.sampleRate * sec);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;   // «коричневатый» шум — мягче для ASMR
        d[i] = last * 3.2;
      }
      return buf;
    }

    /** Базовый тональный сигнал */
    tone(opts) {
      if (!this.ready || !this.enabled) return;
      const o = Object.assign({
        freq: 300, type: 'sine', dur: 0.2, gain: 0.3, bus: 'sfx',
        attack: 0.01, decay: null, slideTo: null, pan: 0, detune: 0, filter: null, q: 1,
      }, opts);
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = o.type; osc.frequency.value = o.freq; osc.detune.value = o.detune;
      if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t + o.dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + o.attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      let node = osc;
      if (o.filter) {
        const f = this.ctx.createBiquadFilter();
        f.type = o.filter; f.frequency.value = o.filterFreq || 800; f.Q.value = o.q;
        node.connect(f); node = f;
      }
      const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (p) { p.pan.value = Math.max(-1, Math.min(1, o.pan)); node.connect(g); g.connect(p); p.connect(this.buses[o.bus]); }
      else { node.connect(g); g.connect(this.buses[o.bus]); }
      osc.start(t); osc.stop(t + o.dur + 0.05);
    }

    /** Шумовой всплеск (шлепки, шуршание, ветер) */
    noise(opts) {
      if (!this.ready || !this.enabled) return;
      const o = Object.assign({
        dur: 0.2, gain: 0.3, bus: 'sfx', filter: 'lowpass', freq: 700, q: 1,
        pan: 0, sweepTo: null, attack: 0.005,
      }, opts);
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer; src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = o.filter; f.frequency.value = o.freq; f.Q.value = o.q;
      if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweepTo), t + o.dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + o.attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      src.connect(f); f.connect(g);
      const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (p) { p.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(p); p.connect(this.buses[o.bus]); }
      else g.connect(this.buses[o.bus]);
      src.start(t); src.stop(t + o.dur + 0.05);
    }

    /* ==================== БИБЛИОТЕКА ЗВУКОВ ==================== */

    /** Мягкий тычок в жир: «пум» */
    poke(softness = 0.9, pan = 0) {
      this.noise({ dur: 0.16 + softness * 0.1, gain: 0.30, filter: 'lowpass', freq: 260 + (1 - softness) * 600, sweepTo: 90, pan });
      this.tone({ freq: 90 - softness * 25, type: 'sine', dur: 0.2, gain: 0.20, slideTo: 45, pan });
    }
    /** Шлепок по большой массе: «плюх» */
    slap(mass = 1, pan = 0) {
      this.noise({ dur: 0.26, gain: 0.42, filter: 'lowpass', freq: 1400, sweepTo: 120, pan });
      this.tone({ freq: 120 / Math.max(0.6, mass), type: 'sine', dur: 0.42, gain: 0.30, slideTo: 38, pan });
    }
    /** Сквиш при массаже */
    squish(pan = 0) {
      this.noise({ dur: 0.34, gain: 0.16, filter: 'bandpass', freq: 420, q: 2.4, sweepTo: 900, pan });
    }
    /** Волна колыхания жира */
    jiggle(amp = 1, pan = 0) {
      this.tone({ freq: 58 + Math.random() * 20, type: 'sine', dur: 0.5 + amp * 0.4, gain: 0.10 * amp, slideTo: 32, pan });
      this.noise({ dur: 0.28, gain: 0.06 * amp, filter: 'lowpass', freq: 200, pan });
    }
    /** Шаг игрока */
    step(onFlesh = false, pan = 0) {
      if (onFlesh) this.noise({ dur: 0.14, gain: 0.13, filter: 'lowpass', freq: 320, sweepTo: 120, pan });
      else this.noise({ dur: 0.09, gain: 0.10, filter: 'highpass', freq: 900, pan });
    }
    /** Жевание */
    chew(pan = 0) {
      this.noise({ dur: 0.1, gain: 0.16, filter: 'bandpass', freq: 700 + Math.random() * 500, q: 3, pan });
    }
    /** Глоток */
    gulp(size = 1, pan = 0) {
      this.tone({ freq: 220 * size, type: 'sine', dur: 0.22, gain: 0.24, slideTo: 70 * size, pan });
      this.noise({ dur: 0.16, gain: 0.12, filter: 'bandpass', freq: 380, q: 4, pan });
    }
    /** Голос фурри (короткая вокализация) */
    voice(kind = 'mur', species = 'fox', pitch = 1) {
      const base = { fox: 480, wolf: 300, dragon: 200, lion: 240, cat: 620, rabbit: 700, bear: 180, raccoon: 520 }[species] || 460;
      const f = base * pitch;
      switch (kind) {
        case 'mur':
          this.tone({ freq: f * 0.4, type: 'triangle', dur: 0.55, gain: 0.16, slideTo: f * 0.34, bus: 'furry', filter: 'lowpass', filterFreq: 900 });
          break;
        case 'happy':
          this.tone({ freq: f, type: 'triangle', dur: 0.18, gain: 0.16, slideTo: f * 1.5, bus: 'furry' });
          this.tone({ freq: f * 1.5, type: 'sine', dur: 0.22, gain: 0.10, slideTo: f * 1.9, bus: 'furry' });
          break;
        case 'moan':
          this.tone({ freq: f * 0.55, type: 'sine', dur: 0.9, gain: 0.15, slideTo: f * 0.42, bus: 'furry', filter: 'lowpass', filterFreq: 700 });
          break;
        case 'giggle':
          for (let i = 0; i < 4; i++)
            setTimeout(() => this.tone({ freq: f * (1 + i * 0.08), type: 'triangle', dur: 0.09, gain: 0.11, bus: 'furry' }), i * 95);
          break;
        case 'sad':
          this.tone({ freq: f * 0.9, type: 'sine', dur: 0.7, gain: 0.13, slideTo: f * 0.5, bus: 'furry' });
          break;
        case 'burp':
          this.tone({ freq: 95, type: 'sawtooth', dur: 0.3, gain: 0.16, slideTo: 60, bus: 'furry', filter: 'lowpass', filterFreq: 400 });
          break;
        case 'breath':
          this.noise({ dur: 0.7, gain: 0.05, filter: 'bandpass', freq: 480, q: 1.2, bus: 'furry' });
          break;
        case 'purr': {
          const t = this.ctx.currentTime;
          for (let i = 0; i < 14; i++)
            this.tone({ freq: 42, type: 'triangle', dur: 0.06, gain: 0.07, bus: 'furry', attack: 0.02, detune: i * 3 });
          break;
        }
      }
    }
    /** UI-клик */
    ui(kind = 'click') {
      const map = { click: 660, ok: 880, err: 180, open: 520, coin: 1320, quest: 990, achieve: 1180 };
      const f = map[kind] || 660;
      this.tone({ freq: f, type: 'sine', dur: 0.09, gain: 0.14 });
      if (kind === 'coin') setTimeout(() => this.tone({ freq: f * 1.5, type: 'sine', dur: 0.12, gain: 0.12 }), 55);
      if (kind === 'achieve') {
        [0, 120, 240].forEach((d, i) => setTimeout(() => this.tone({ freq: 523 * Math.pow(1.26, i), type: 'triangle', dur: 0.25, gain: 0.13 }), d));
      }
    }
    /** Двигатель такси (короткий импульс, вызывается периодически) */
    engine(load = 1, pan = 0) {
      this.tone({ freq: 62 + load * 20, type: 'sawtooth', dur: 0.35, gain: 0.05, filter: 'lowpass', filterFreq: 200, pan });
    }
    /** Скрип подвески */
    creak(pan = 0) {
      this.tone({ freq: 320, type: 'sawtooth', dur: 0.5, gain: 0.05, slideTo: 180, filter: 'bandpass', filterFreq: 700, q: 6, pan });
    }
    /** Насос */
    pump(step = 0) {
      this.tone({ freq: 130 + (step % 3) * 20, type: 'square', dur: 0.16, gain: 0.10, filter: 'lowpass', filterFreq: 400 });
      this.noise({ dur: 0.2, gain: 0.08, filter: 'bandpass', freq: 240, q: 3 });
    }
    /** Бульканье котла / жидкости */
    bubble() {
      this.tone({ freq: 200 + Math.random() * 500, type: 'sine', dur: 0.12, gain: 0.09, slideTo: 90 });
    }
    /** Магический звон эликсира */
    magic() {
      [0, 90, 180, 300].forEach((d, i) =>
        setTimeout(() => this.tone({ freq: 700 * Math.pow(1.33, i), type: 'sine', dur: 0.5, gain: 0.09 }), d));
    }
    /** Колокол башни */
    bell() {
      [0, 40].forEach((d, i) => setTimeout(() =>
        this.tone({ freq: 440 - i * 8, type: 'sine', dur: 2.4, gain: 0.14, attack: 0.005 }), d));
    }
    /** Разрыв одежды */
    rip() {
      this.noise({ dur: 0.45, gain: 0.24, filter: 'bandpass', freq: 2600, q: 1.5, sweepTo: 700 });
    }
    /** Рост тела (утробный «наливающийся» звук) */
    growth(amount = 1) {
      this.tone({ freq: 70, type: 'sine', dur: 0.8 + amount * 0.4, gain: 0.10, slideTo: 42 });
      this.noise({ dur: 0.6, gain: 0.05, filter: 'lowpass', freq: 180 });
    }

    /* ==================== ФОН И МУЗЫКА ==================== */

    _startAmbience() {
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this._makeNoise(4); src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 380;
      const g = this.ctx.createGain(); g.gain.value = 0.35;
      src.connect(f); f.connect(g); g.connect(this.buses.ambience);
      src.start(t);
      this.ambienceFilter = f;
      this.ambienceGain = g;
    }

    setAmbience(style) {
      if (!this.ready) return;
      const map = { city: 420, forest: 700, indoor: 240, mountain: 900, night: 300 };
      const target = map[style] || 400;
      this.ambienceFilter.frequency.setTargetAtTime(target, this.ctx.currentTime, 1.2);
    }

    /** Простейший процедурный ло-фай/джаз-генератор */
    updateMusic(dt, style) {
      if (!this.ready || !this.enabled) return;
      if (style && style !== this.musicStyle) { this.musicStyle = style; this.musicTimer = 0; }
      this.musicTimer -= dt;
      if (this.musicTimer > 0) return;
      const scales = {
        lofi:   [0, 3, 5, 7, 10],
        jazz:   [0, 2, 4, 7, 9, 11],
        piano:  [0, 2, 4, 5, 7, 9, 11],
        home:   [0, 2, 5, 7, 9],
        ambient:[0, 5, 7, 12],
        forest: [0, 2, 4, 7, 9],
        acoustic:[0, 2, 4, 7, 9],
        club:   [0, 3, 5, 6, 7, 10],
      };
      const sc = scales[this.musicStyle] || scales.lofi;
      const root = this.musicStyle === 'club' ? 110 : 146.83;
      const n = sc[Math.floor(Math.random() * sc.length)];
      const oct = Math.random() < 0.35 ? 2 : 1;
      const freq = root * Math.pow(2, n / 12) * oct;
      const isClub = this.musicStyle === 'club';
      this.tone({
        freq, type: isClub ? 'sawtooth' : 'triangle',
        dur: isClub ? 0.28 : 1.1, gain: isClub ? 0.10 : 0.065, bus: 'music',
        filter: 'lowpass', filterFreq: isClub ? 1400 : 900, attack: isClub ? 0.01 : 0.08,
        pan: (Math.random() - 0.5) * 0.5,
      });
      // Бас раз в несколько нот
      if (Math.random() < 0.4)
        this.tone({ freq: root / 2, type: 'sine', dur: 1.4, gain: 0.07, bus: 'music' });
      this.musicTimer = isClub ? 0.30 : 0.62 + Math.random() * 0.7;
    }
  }

  FF.AudioEngine = AudioEngine;
})(typeof window !== 'undefined' ? window : globalThis);
