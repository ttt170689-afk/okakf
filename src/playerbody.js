/**
 * playerbody.js — ТЕЛО ИГРОКА
 *
 * Игрок перестаёт быть «летающей камерой»: у него есть настоящее тело,
 * которое видно, которое отбрасывает тень и которое живёт по своим правилам.
 *
 *   • Видимые ноги и торс — при взгляде вниз видно себя
 *   • Тень на земле (реальный меш, а не пятно)
 *   • Шаговая анимация ног, приседание, ползание
 *   • Сила: прокачивается и влияет на хват, переноску, подтягивание
 *   • Одежда: цвет футболки/штанов/обуви
 *
 * Тело рисуется в мировых координатах и следует за камерой, а НЕ висит
 * на ней: иначе при повороте головы ноги ездили бы вместе со взглядом.
 *
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  /** Палитра одежды по умолчанию */
  const OUTFITS = {
    classic: { shirt: 0x4a80c8, pants: 0x3b4a63, shoes: 0x2a2a30, skin: 0xe8b48a },
    warm:    { shirt: 0xc4685a, pants: 0x4a4038, shoes: 0x3a2a20, skin: 0xe8b48a },
    sport:   { shirt: 0x6fbf7a, pants: 0x2a2e36, shoes: 0xf0f0f0, skin: 0xe8b48a },
    night:   { shirt: 0x3a2a5a, pants: 0x22202c, shoes: 0x1a1a20, skin: 0xe8b48a },
  };

  class PlayerBody {
    /**
     * @param {THREE.Scene} scene
     * @param {object} player — PlayerController
     */
    constructor(scene, player) {
      this.scene = scene;
      this.player = player;
      this.outfit = 'classic';
      const C = OUTFITS[this.outfit];

      /* --- Сила: растёт от нагрузок, влияет на хват и переноску --- */
      this.strength = 1.0;          // 1.0 .. 2.5
      this.strengthXP = 0;

      this.group = new THREE.Group();
      scene.add(this.group);

      const skinMat = new THREE.MeshStandardMaterial({ color: C.skin, roughness: 0.82 });
      const shirtMat = new THREE.MeshStandardMaterial({ color: C.shirt, roughness: 0.9 });
      const pantsMat = new THREE.MeshStandardMaterial({ color: C.pants, roughness: 0.92 });
      const shoeMat = new THREE.MeshStandardMaterial({ color: C.shoes, roughness: 0.7 });
      this.materials = { skin: skinMat, shirt: shirtMat, pants: pantsMat, shoes: shoeMat };

      /* --- Торс: видно, когда смотришь вниз --- */
      this.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 5, 12), shirtMat);
      this.torso.position.y = 1.28;
      this.group.add(this.torso);

      /* --- Ноги: бедро + голень + стопа, по два звена на ногу --- */
      this.legs = [];
      for (const side of [-1, 1]) {
        const hip = new THREE.Group();
        hip.position.set(side * 0.11, 0.92, 0);

        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.30, 4, 10), pantsMat);
        thigh.position.y = -0.19;
        hip.add(thigh);

        const knee = new THREE.Group();
        knee.position.y = -0.40;
        hip.add(knee);

        const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.070, 0.30, 4, 10), pantsMat);
        shin.position.y = -0.19;
        knee.add(shin);

        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.065, 0.24), shoeMat);
        foot.position.set(0, -0.40, 0.055);
        knee.add(foot);

        this.group.add(hip);
        this.legs.push({ side, hip, knee, foot, phase: side > 0 ? Math.PI : 0 });
      }

      /* --- Тень: мягкий диск под ногами --- */
      const shadowTex = this._makeShadowTexture();
      this.shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15, 1.15),
        new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.42, depthWrite: false })
      );
      this.shadow.rotation.x = -Math.PI / 2;
      this.scene.add(this.shadow);

      for (const o of this.group.children) {
        o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      }

      this.visible = true;
      this._stepPhase = 0;
    }

    /** Радиальный градиент для мягкой тени */
    _makeShadowTexture() {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      grd.addColorStop(0, 'rgba(0,0,0,0.85)');
      grd.addColorStop(0.6, 'rgba(0,0,0,0.35)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }

    /** Сменить комплект одежды */
    setOutfit(name) {
      const C = OUTFITS[name];
      if (!C) return false;
      this.outfit = name;
      this.materials.shirt.color.setHex(C.shirt);
      this.materials.pants.color.setHex(C.pants);
      this.materials.shoes.color.setHex(C.shoes);
      return true;
    }

    /** Начислить опыт силы (висение, переноска, подтягивание) */
    addStrengthXP(amount) {
      this.strengthXP += amount;
      const target = 1 + Math.min(1.5, this.strengthXP / 900);
      if (target > this.strength + 0.05 && FF.Game) {
        FF.Game.notify(`💪 Сила выросла: ×${target.toFixed(2)}`, 'info');
        if (target >= 2) FF.Game.achieve('strongman');
      }
      this.strength = target;
    }

    update(dt) {
      const p = this.player;
      // В режимах, где тело мешает камере, прячем его
      const hide = p.mode === 'ride' || p.frozen;
      this.group.visible = this.visible && !hide;
      this.shadow.visible = this.group.visible;
      if (!this.group.visible) return;

      // Тело стоит там же, где игрок, и повёрнуто по направлению взгляда,
      // но БЕЗ наклона головы — иначе ноги задирались бы вместе с камерой.
      this.group.position.set(p.pos.x, p.pos.y, p.pos.z);
      this.group.rotation.y = p.yaw;

      // Приседание/ползание сжимают тело по высоте
      const crouchK = p.crawling ? 0.42 : p.crouch ? 0.62 : 1;
      this.group.scale.set(1, crouchK, 1);

      const speed = Math.hypot(p.vel.x, p.vel.z);
      const walking = speed > 0.4 && p.onGround;

      /* --- Шаговая анимация: ноги ходят маятником --- */
      if (walking) this._stepPhase += dt * speed * 2.6;
      for (const L of this.legs) {
        const ph = this._stepPhase + L.phase;
        const swing = walking ? Math.sin(ph) * 0.55 : 0;
        const lift = walking ? Math.max(0, Math.sin(ph)) * 0.5 : 0;
        L.hip.rotation.x = U.damp(L.hip.rotation.x, swing, 14, dt);
        L.knee.rotation.x = U.damp(L.knee.rotation.x, lift, 14, dt);
      }

      // Лёгкий наклон торса вперёд при беге
      const lean = walking ? Math.min(0.22, speed * 0.03) : 0;
      this.torso.rotation.x = U.damp(this.torso.rotation.x, lean, 8, dt);

      /* --- Тень ложится на землю (или на тело друга) --- */
      let gy = p.pos.y;
      if (FF.Game && FF.Game.world) {
        gy = FF.Game.world.heightAt(p.pos.x, p.pos.z);
        if (FF.Game.world.platformAt) {
          const pl = FF.Game.world.platformAt(p.pos.x, p.pos.z, p.pos.y + 0.62);
          if (pl !== null && pl > gy) gy = pl;
        }
      }
      // В воздухе тень бледнее и меньше — читается высота прыжка
      const air = U.clamp((p.pos.y - gy) / 3, 0, 1);
      this.shadow.position.set(p.pos.x, gy + 0.02, p.pos.z);
      this.shadow.material.opacity = 0.42 * (1 - air * 0.75);
      const s = 1 - air * 0.35;
      this.shadow.scale.set(s, s, s);

      // Сила прокачивается, пока висим на друге
      if (p.climbing) this.addStrengthXP(dt * 2.5);
    }

    dispose() {
      this.scene.remove(this.group);
      this.scene.remove(this.shadow);
    }
  }

  FF.PlayerBody = PlayerBody;
  FF.PLAYER_OUTFITS = OUTFITS;
})(typeof window !== 'undefined' ? window : globalThis);
