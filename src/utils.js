/**
 * utils.js
 * Математика, генератор шума, вспомогательные функции, слияние геометрий.
 * @version 1.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});

  const U = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    smoothstep(e0, e1, x) {
      const t = U.clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    },
    /** Экспоненциальное сглаживание, независимое от частоты кадров */
    damp: (a, b, lambda, dt) => U.lerp(a, b, 1 - Math.exp(-lambda * dt)),
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    /** Форматирование больших чисел: 12500 -> «12.5к» */
    fmt(n) {
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'млрд';
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'млн';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'к';
      return Math.round(n * 10) / 10 + '';
    },
    fmtTime(h) {
      const hh = Math.floor(h) % 24;
      const mm = Math.floor((h - Math.floor(h)) * 60);
      return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    },
    /** Детерминированный псевдослучайный шум по 3 координатам */
    hash3(x, y, z) {
      let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
      return h - Math.floor(h);
    },
    noise3(x, y, z) {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const xf = x - xi, yf = y - yi, zf = z - zi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
      const H = U.hash3;
      const c000 = H(xi, yi, zi), c100 = H(xi + 1, yi, zi);
      const c010 = H(xi, yi + 1, zi), c110 = H(xi + 1, yi + 1, zi);
      const c001 = H(xi, yi, zi + 1), c101 = H(xi + 1, yi, zi + 1);
      const c011 = H(xi, yi + 1, zi + 1), c111 = H(xi + 1, yi + 1, zi + 1);
      const x00 = U.lerp(c000, c100, u), x10 = U.lerp(c010, c110, u);
      const x01 = U.lerp(c001, c101, u), x11 = U.lerp(c011, c111, u);
      return U.lerp(U.lerp(x00, x10, v), U.lerp(x01, x11, v), w);
    },
    fbm(x, y, z, oct = 3) {
      let a = 0.5, f = 1, s = 0;
      for (let i = 0; i < oct; i++) { s += a * U.noise3(x * f, y * f, z * f); f *= 2; a *= 0.5; }
      return s;
    },

    /**
     * Слияние массива BufferGeometry в одну (position, normal, uv + атрибут part).
     * @param {THREE.BufferGeometry[]} geos
     * @param {number[]} partIds — идентификатор части тела для каждой геометрии
     */
    mergeGeometries(geos, partIds) {
      const THREE = global.THREE;
      let total = 0;
      for (const g of geos) total += g.attributes.position.count;
      const pos = new Float32Array(total * 3);
      const nrm = new Float32Array(total * 3);
      const uv = new Float32Array(total * 2);
      const part = new Float32Array(total);
      const indices = [];
      let vOff = 0;
      geos.forEach((g, gi) => {
        const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
        for (let i = 0; i < p.count; i++) {
          pos[(vOff + i) * 3] = p.getX(i); pos[(vOff + i) * 3 + 1] = p.getY(i); pos[(vOff + i) * 3 + 2] = p.getZ(i);
          if (n) { nrm[(vOff + i) * 3] = n.getX(i); nrm[(vOff + i) * 3 + 1] = n.getY(i); nrm[(vOff + i) * 3 + 2] = n.getZ(i); }
          if (t) { uv[(vOff + i) * 2] = t.getX(i); uv[(vOff + i) * 2 + 1] = t.getY(i); }
          part[vOff + i] = partIds ? partIds[gi] : 0;
        }
        const idx = g.index;
        if (idx) for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vOff);
        else for (let i = 0; i < p.count; i++) indices.push(i + vOff);
        vOff += p.count;
      });
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      out.setAttribute('part', new THREE.BufferAttribute(part, 1));
      out.setIndex(indices);
      return out;
    },

    /** Применить матрицу трансформации к геометрии (in place) */
    transformGeometry(geo, mat) {
      geo.applyMatrix4(mat);
      return geo;
    },
  };

  FF.U = U;
})(typeof window !== 'undefined' ? window : globalThis);
