/**
 * physics.js — ГИПЕР-ФИЗИКА С ПОЗОННОЙ КОЛЛИЗИЕЙ
 *
 * Каждая из 60 зон роста — самостоятельный физический коллайдер (эллипсоид),
 * который растёт, колышется и по-своему реагирует на контакт.
 *
 * Что решает модуль:
 *   1. ZoneCollider     — эллипсоид на узле зоны, следует за soft-body смещением
 *   2. BroadPhase       — пространственный хеш, чтобы не проверять 60 зон каждый кадр
 *   3. resolvePlayer    — коллизия игрока со ВСЕМИ зонами: мягкое погружение,
 *                         выталкивание, трение, стояние на любой зоне (не только животе)
 *   4. selfCollision    — зоны сталкиваются МЕЖДУ СОБОЙ: грудь ложится на живот,
 *                         бёдра трутся, складка опирается на бедро
 *   5. worldCollision   — тело фурри обволакивает мир: продавливает мебель,
 *                         расплывается по земле, упирается в стены
 *   6. ObjectPhysics    — брошенные предметы (еда) падают, катятся, отскакивают
 *                         от тела и застревают в складках
 *
 * @version 2.0.0
 */
(function (global) {
  'use strict';
  const FF = (global.FF = global.FF || {});
  const THREE = global.THREE;
  const U = FF.U;

  /* ============================================================
   * 1. КОЛЛАЙДЕР ЗОНЫ
   * ------------------------------------------------------------
   * Эллипсоид, привязанный к SoftNode. Полуоси растут вместе с зоной,
   * центр смещается по direction + динамическое смещение жира.
   * ============================================================ */
  class ZoneCollider {
    /**
     * @param {object} node — SoftNode из furry.js
     * @param {FurryEngine} furry
     */
    constructor(node, furry) {
      this.node = node;
      this.furry = furry;
      this.zone = node.zone;

      // Локальный центр и полуоси (пересчитываются каждый кадр)
      this.center = new THREE.Vector3();
      this.radii = new THREE.Vector3();
      this.worldCenter = new THREE.Vector3();
      this.worldRadius = 0.2;      // максимальная полуось в мире (для broadphase)

      // Материальные свойства поверхности зоны
      this.softness = this.zone.soft;              // насколько глубоко можно утонуть
      this.friction = this.zone.friction ? 1.35 : 0.85;
      this.bounce = 0.12 + this.zone.soft * 0.35;  // упругость (батут)
      this.standable = !this.zone.inverted;        // на впадинах не постоять
      this.contacts = 0;                           // счётчик контактов за кадр
    }

    /** Пересчёт геометрии коллайдера под текущий рост и колыхание */
    update() {
      const nd = this.node;
      const z = this.zone;
      const S = this.furry.species.scale;
      const bs = this.furry.bodyScale;

      /* Центр = якорь + доля смещения плоти.
       *
       * Коэффициент 0.55 был подобран, когда growth не превышал 1. После
       * появления overdrive (рост продолжается за пределы 1.0) центр стал
       * уезжать дальше, чем реально уходит кожа, и эллипсоид выступал
       * впереди меша на метры — игрок упирался в пустоту.
       *
       * CENTER_FIT держит центр там же, где физически оказалась плоть. */
      const disp = _tmpV1;
      nd.displacement(disp);
      this.center.set(
        (nd.base.x + disp.x * CENTER_FIT) * S,
        (nd.base.y + disp.y * CENTER_FIT) * S,
        (nd.base.z + disp.z * CENTER_FIT) * S
      );

      /* Полуоси коллайдера.
       *
       * ВАЖНО: раньше сюда шёл полный gain, да ещё с множителями до 1.1 —
       * эллипсоид получался заметно больше видимого меша. У гиганта живот
       * «торчал» коллайдером на 13 метров дальше кожи, и игрок упирался в
       * пустой воздух далеко от друга. Это и была воздушная стенка.
       *
       * Меш смещает вершину лишь на долю gain (вес зоны в скиннинге редко
       * равен единице), поэтому коллайдер калибруем тем же множителем
       * COLLIDER_FIT и не позволяем ему выпирать сильнее плоти. */
      const g = nd.growth;
      const grow = Math.abs(z.gain) * g * COLLIDER_FIT;
      /* Базовый радиус зоны. У худого друга зоны почти не выпирают, но
       * эллипсоид всё равно занимал полный zone.radius и держал игрока в
       * полуметре от кожи. Поэтому на малом росте радиус поджимаем сильнее:
       * коллайдер должен облегать тело, а не висеть в воздухе вокруг него. */
      // g может превышать 1 (overdrive поздних стадий) — тогда прирост
      // базового радиуса замедляем, иначе эллипсоид снова обгонит кожу.
      const gBase = g <= 1 ? g : 1 + (g - 1) * 0.5;
      const base = z.radius * (0.72 + gBase * 0.5) * BASE_FIT;
      const dir = nd.dir;
      // Вдоль направления роста эллипсоид вытягивается чуть сильнее
      this.radii.set(
        (base + grow * (0.22 + Math.abs(dir.x) * 0.42)) * S,
        (base + grow * (0.22 + Math.abs(dir.y) * 0.42)) * S,
        (base + grow * (0.22 + Math.abs(dir.z) * 0.42)) * S
      );
      // Впадины (пупок, борозда) не выпирают — коллайдер остаётся маленьким
      if (z.inverted) this.radii.multiplyScalar(0.55);

      /* Если доступна подгонка по мешу — она главнее формул: коллайдер
       * обязан совпадать с видимой кожей, иначе появляется либо воздушная
       * стенка, либо проход сквозь друга. */
      if (this.fitted) {
        this.center.copy(this.fitted.center);
        this.radii.copy(this.fitted.radii);
      }

      // Мир
      this.worldCenter.copy(this.center).multiplyScalar(bs);
      this.furry.root.localToWorld(this.worldCenter);
      this.worldRadius = Math.max(this.radii.x, this.radii.y, this.radii.z) * bs;
      this.contacts = 0;
    }

    /**
     * Тест точки на попадание внутрь эллипсоида (в ЛОКАЛЬНЫХ координатах тела).
     * @returns {number} глубина проникновения 0..1 (0 — снаружи, 1 — центр)
     */
    testLocal(px, py, pz) {
      const dx = (px - this.center.x) / this.radii.x;
      const dy = (py - this.center.y) / this.radii.y;
      const dz = (pz - this.center.z) / this.radii.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      return d2 >= 1 ? 0 : 1 - Math.sqrt(d2);
    }

    /**
     * Нормаль поверхности эллипсоида в точке (локальные координаты).
     * @param {THREE.Vector3} out
     */
    normalLocal(px, py, pz, out) {
      // Градиент неявной функции эллипсоида
      out.set(
        (px - this.center.x) / (this.radii.x * this.radii.x),
        (py - this.center.y) / (this.radii.y * this.radii.y),
        (pz - this.center.z) / (this.radii.z * this.radii.z)
      );
      if (out.lengthSq() < 1e-9) out.set(0, 1, 0);
      return out.normalize();
    }

    /**
     * Ближайшая точка НА поверхности эллипсоида (локально).
     * Итеративное приближение — достаточно 2 шагов для игровой точности.
     */
    surfacePointLocal(px, py, pz, out) {
      const n = this.normalLocal(px, py, pz, _tmpV2);
      // Масштабируем направление обратно в пространство эллипсоида
      const dx = px - this.center.x, dy = py - this.center.y, dz = pz - this.center.z;
      const len = Math.sqrt(
        (dx / this.radii.x) ** 2 + (dy / this.radii.y) ** 2 + (dz / this.radii.z) ** 2
      ) || 1;
      out.set(
        this.center.x + dx / len,
        this.center.y + dy / len,
        this.center.z + dz / len
      );
      return out;
    }

    /** Верхняя точка коллайдера (для стояния сверху), локально */
    topY() { return this.center.y + this.radii.y; }
  }

  // Переиспользуемые векторы — ноль аллокаций в горячем цикле
  /* Подгонка коллайдеров под визуальный меш. Значение подобрано так, чтобы
   * поверхность эллипсоида совпадала с кожей: больше — появляется воздушная
   * стенка, меньше — игрок проваливается внутрь до отрисованной плоти. */
  const COLLIDER_FIT = 0.08;
  /* Насколько центр эллипсоида следует за смещением плоти. Меш двигает
   * вершину на долю от displacement (вес зоны в скиннинге < 1), поэтому
   * центр коллайдера тоже не должен уезжать на полное смещение. */
  const CENTER_FIT = 0.15;
  /* Общий поджим базового радиуса зоны под визуальную оболочку. */
  const BASE_FIT = 0.85;

  const _tmpMat = new THREE.Matrix4();
  const _tmpV1 = new THREE.Vector3();
  const _tmpV2 = new THREE.Vector3();
  const _tmpV3 = new THREE.Vector3();
  const _tmpV4 = new THREE.Vector3();
  const _tmpV5 = new THREE.Vector3();

  /* ============================================================
   * 2. ГЛАВНЫЙ КЛАСС ФИЗИКИ ТЕЛА
   * ============================================================ */
  class BodyPhysics {
    /**
     * Самокалибровка коллайдеров по мешу.
     *
     * Подгонять эллипсоиды формулами оказалось тупиком: меш деформируется
     * взвешенной суммой смещений всех зон (скиннинг), и никакая комбинация
     * коэффициентов не совпадает с кожей на всех стадиях сразу. Слишком
     * большой коллайдер = воздушная стенка, слишком малый = игрок проходит
     * сквозь друга.
     *
     * Поэтому полуоси берём НАПРЯМУЮ из вершин, которыми зона управляет.
     * Тогда коллайдер по построению совпадает с видимой поверхностью —
     * для любого вида, телосложения и стадии роста.
     */
    _buildVertexOwnership() {
      const f = this.furry;
      if (!f.wIdx || !f.mesh) return;
      const K = f.K, n = f.vertexCount;
      const counts = new Int32Array(f.nodes.length);
      // Первый проход — сколько вершин у каждой зоны (только доминирующий вес)
      const owner = new Int32Array(n).fill(-1);
      for (let v = 0; v < n; v++) {
        const idx = f.wIdx[v * K];          // веса отсортированы по убыванию
        if (idx < 0) continue;
        if (f.wVal[v * K] < 0.34) continue; // слабое влияние не считаем
        owner[v] = idx;
        counts[idx]++;
      }
      // Второй проход — раскладываем по спискам
      this.zoneVerts = [];
      for (let i = 0; i < f.nodes.length; i++) {
        this.zoneVerts.push(counts[i] > 0 ? new Int32Array(counts[i]) : null);
      }
      const fill = new Int32Array(f.nodes.length);
      for (let v = 0; v < n; v++) {
        const o = owner[v];
        if (o < 0) continue;
        this.zoneVerts[o][fill[o]++] = v;
      }
      this._ownershipReady = true;
    }

    /**
     * Пересчитать полуоси коллайдеров по фактическому положению вершин.
     * Считается редко (раз в _fitEvery кадров) — это амортизированно дёшево.
     */
    _refitFromMesh() {
      const f = this.furry;
      if (!this._ownershipReady) this._buildVertexOwnership();
      if (!this.zoneVerts) return;
      const pos = f.mesh.geometry.attributes.position.array;
      for (let i = 0; i < this.colliders.length; i++) {
        const c = this.colliders[i];
        const list = this.zoneVerts[i];
        if (!list || list.length < 4) { c.fitted = null; continue; }
        // Центр — среднее положение «своих» вершин
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < list.length; k++) {
          const v = list[k] * 3;
          cx += pos[v]; cy += pos[v + 1]; cz += pos[v + 2];
        }
        const inv = 1 / list.length;
        cx *= inv; cy *= inv; cz *= inv;
        // Полуоси — среднеквадратичный охват (устойчивее максимума к выбросам)
        let sx = 0, sy = 0, sz = 0;
        for (let k = 0; k < list.length; k++) {
          const v = list[k] * 3;
          const dx = pos[v] - cx, dy = pos[v + 1] - cy, dz = pos[v + 2] - cz;
          sx += dx * dx; sy += dy * dy; sz += dz * dz;
        }
        // 1.9σ охватывает почти весь объём зоны, не выпирая за кожу
        const K_SIGMA = 1.9;
        c.fitted = c.fitted || { center: new THREE.Vector3(), radii: new THREE.Vector3() };
        c.fitted.center.set(cx, cy, cz);
        c.fitted.radii.set(
          Math.max(0.04, Math.sqrt(sx * inv) * K_SIGMA),
          Math.max(0.04, Math.sqrt(sy * inv) * K_SIGMA),
          Math.max(0.04, Math.sqrt(sz * inv) * K_SIGMA)
        );
      }
    }

    constructor(furry) {
      this.furry = furry;
      this.colliders = furry.nodes.map((n) => new ZoneCollider(n, furry));
      this.byId = {};
      for (const c of this.colliders) this.byId[c.zone.id] = c;

      // Пространственный хеш для broadphase (ячейка 0.5 м в локальных координатах)
      this.cellSize = 0.5;
      this.grid = new Map();

      // Пары зон для self-collision (предрасчёт: только те, что реально могут встретиться)
      this.selfPairs = this._buildSelfPairs();

      // Отладочная визуализация
      this.debugMesh = null;
      this.debugEnabled = false;

      // Статистика для профилирования
      this.stats = { broadChecks: 0, narrowChecks: 0, contacts: 0, selfContacts: 0 };
    }

    /**
     * Пары зон, которые могут столкнуться друг с другом при росте.
     * Берём те, что близки по якорям, но не соседи по решётке (иначе постоянный контакт).
     */
    _buildSelfPairs() {
      const pairs = [];
      const cs = this.colliders;
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          const a = cs[i], b = cs[j];
          const d = a.node.base.distanceTo(b.node.base);
          // Слишком далеко — никогда не встретятся; слишком близко — это одна область
          if (d > 0.62 || d < 0.20) continue;
          // Инвертированные зоны (ямки) и мелочь (уши, пальцы) не участвуют
          if (a.zone.inverted || b.zone.inverted) continue;
          if (a.zone.gain < 0.2 || b.zone.gain < 0.2) continue;
          // Только крупная плоть — иначе тысячи бессмысленных пар
          if (a.zone.mass < 6 || b.zone.mass < 6) continue;
          pairs.push([a, b, d]);
        }
      }
      return pairs;
    }

    /** Обновление всех коллайдеров + пространственного хеша */
    update(dt) {
      /* Подгонка коллайдеров под меш. Раз в несколько кадров: форма тела
       * меняется плавно, а полный проход по вершинам стоит дороже. */
      this._fitTick = (this._fitTick || 0) + 1;
      if (this._fitTick % 6 === 0 || !this._ownershipReady) this._refitFromMesh();

      this.stats.broadChecks = 0;
      this.stats.narrowChecks = 0;
      this.stats.contacts = 0;
      this.stats.selfContacts = 0;

      for (const c of this.colliders) c.update();
      this._rebuildGrid();
      // Самоколлизия через кадр — эффект тот же, стоимость вдвое ниже
      this._selfTick = (this._selfTick || 0) + 1;
      if (this._selfTick & 1) this.selfCollision(dt * 2);

      if (this.debugEnabled) this._updateDebug();
    }

    _rebuildGrid() {
      // ОПТИМИЗАЦИЯ: переиспользуем массивы ячеек вместо создания новых
      for (const list of this.grid.values()) list.length = 0;
      const cs = this.cellSize;
      let cells = 0;
      for (const c of this.colliders) {
        // Регистрируем коллайдер во всех ячейках его AABB
        const minx = Math.floor((c.center.x - c.radii.x) / cs);
        const maxx = Math.floor((c.center.x + c.radii.x) / cs);
        const miny = Math.floor((c.center.y - c.radii.y) / cs);
        const maxy = Math.floor((c.center.y + c.radii.y) / cs);
        const minz = Math.floor((c.center.z - c.radii.z) / cs);
        const maxz = Math.floor((c.center.z + c.radii.z) / cs);
        for (let x = minx; x <= maxx; x++)
          for (let y = miny; y <= maxy; y++)
            for (let z = minz; z <= maxz; z++) {
              const key = x + ',' + y + ',' + z;
              let list = this.grid.get(key);
              if (!list) { list = []; this.grid.set(key, list); }
              list.push(c);
              cells++;
            }
      }
    }

    /** Кандидаты рядом с локальной точкой */
    query(px, py, pz, out) {
      out.length = 0;
      const cs = this.cellSize;
      const key = Math.floor(px / cs) + ',' + Math.floor(py / cs) + ',' + Math.floor(pz / cs);
      const list = this.grid.get(key);
      this.stats.broadChecks++;
      if (list) for (const c of list) out.push(c);
      return out;
    }

    /* --------------------------------------------------------
     * 3. КОЛЛИЗИЯ ИГРОКА СО ВСЕМИ ЗОНАМИ
     * -------------------------------------------------------- */
    /**
     * Разрешение коллизии капсулы игрока со всеми зонами тела.
     * Возвращает данные контакта для контроллера.
     *
     * @param {THREE.Vector3} worldPos — предполагаемая позиция игрока (ступни)
     * @param {THREE.Vector3} velocity — скорость игрока (изменяется на месте)
     * @param {number} radius — радиус капсулы
     * @param {number} height — высота капсулы
     * @param {number} dt
     * @returns {object} {hit, groundY, groundZone, normal, sink, friction, pushed}
     */
    resolvePlayer(worldPos, velocity, radius, height, dt) {
      const f = this.furry;
      /* Пределы мягкого погружения (метры при bodyScale = 1).
       * base    — даже твёрдая зона слегка проминается;
       * soft    — надбавка за мягкость и налитость зоны;
       * burrow  — бонус, когда игрок лезет или ползёт по телу. */
      const PC = FF.CONFIG.player;
      const C_SINK_BASE   = PC.sinkBase   !== undefined ? PC.sinkBase   : 0.10;
      const C_SINK_SOFT   = PC.sinkSoft   !== undefined ? PC.sinkSoft   : 0.45;
      const C_SINK_BURROW = PC.sinkBurrow !== undefined ? PC.sinkBurrow : 0.14;
      const bs = f.bodyScale;
      const result = {
        hit: false, groundY: -Infinity, groundZone: null,
        normal: _tmpV5.set(0, 1, 0), sink: 0, friction: 1, pushed: false, zone: null,
      };

      // Быстрый отбой: далеко от тела — не считаем
      const bodyCenter = f.root.position;
      const maxReach = 3.2 * bs + height;
      const dx0 = worldPos.x - bodyCenter.x, dz0 = worldPos.z - bodyCenter.z;
      if (dx0 * dx0 + dz0 * dz0 > maxReach * maxReach) return result;

      // Переводим в локальное пространство тела (без учёта bodyScale — делим)
      const local = _tmpV1.copy(worldPos);
      f.root.worldToLocal(local);
      local.divideScalar(bs);
      const localRadius = radius / bs;

      // Проверяем капсулу тремя точками: ступни, центр, голова
      const samples = [
        { y: local.y + localRadius, w: 1.0 },                        // низ
        { y: local.y + height / bs * 0.5, w: 1.0 },                  // середина
        { y: local.y + height / bs - localRadius, w: 0.85 },         // верх
      ];

      const candidates = [];
      let bestSink = 0;
      let maxPush = 0;
      const push = _tmpV3.set(0, 0, 0);

      for (const s of samples) {
        this.query(local.x, s.y, local.z, candidates);
        for (const c of candidates) {
          this.stats.narrowChecks++;
          // Расширяем эллипсоид на радиус игрока (аппроксимация Минковского)
          const ex = c.radii.x + localRadius, ey = c.radii.y + localRadius, ez = c.radii.z + localRadius;
          const dx = (local.x - c.center.x) / ex;
          const dy = (s.y - c.center.y) / ey;
          const dz = (local.z - c.center.z) / ez;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= 1) continue;

          const dist = Math.sqrt(d2) || 1e-5;
          const penetration = (1 - dist);
          this.stats.contacts++;
          c.contacts++;
          result.hit = true;
          result.zone = c;

          // Нормаль контакта
          const n = _tmpV2.set(dx / ex, dy / ey, dz / ez);
          if (n.lengthSq() < 1e-9) n.set(0, 1, 0);
          n.normalize();

          /* ---- ДВУХСЛОЙНОЕ ТЕЛО: ЖИР СНАРУЖИ, МЫШЦЫ ВНУТРИ ----
           *
           * Две прошлые крайности обе были неверны:
           *   • доля выталкивания (1 − softness × growth) давала «воздушную
           *     стенку»: на малых стадиях игрока отбрасывало, не дав коснуться;
           *   • полная проходимость пускала игрока ВНУТРЬ туши, где он
           *     застревал между конечностями.
           *
           * Правильная модель — предел погружения в МЕТРАХ:
           *   1. Внешний слой (жир) мягко пропускает руки, колени и грудь
           *      на maxSink метров: плоть мнётся, игрок вязнет.
           *   2. Внутренний слой (мышцы/скелет) — жёсткий. Глубже него
           *      не пройти никогда, поэтому провалиться внутрь невозможно.
           *
           * Так игрок утыкается носом в живот и утопает в нём, но всегда
           * остаётся снаружи тела. */
          const minRad = Math.min(ex, ey, ez);
          // Фактическая глубина проникновения в метрах мира
          const penMeters = penetration * minRad * bs;

          // Насколько глубоко пускает именно эта зона.
          // Мягкий налитой живот — до ~55 см, костлявый локоть — пара см.
          const soft = c.softness * c.node.growth;
          const zoneSink = C_SINK_BASE + soft * C_SINK_SOFT;
          // Пока лезем/ползём по телу, плоть расступается охотнее
          const burrowBonus = f.playerBurrowing ? C_SINK_BURROW : 0;
          // Предел не может превышать габарит самой зоны, иначе «мягкость»
          // формально разрешила бы пройти её насквозь.
          const maxSink = Math.min((zoneSink + burrowBonus) * bs, minRad * bs * 0.92);

          // Режим призрака: плоть не сопротивляется вовсе, игрок выходит сам
          const excessMeters = f.playerPhantom
            ? 0 : Math.max(0, penMeters - maxSink);
          const effective = minRad > 1e-6 ? excessMeters / (minRad * bs) : 0;

          // Величина выталкивания в локальных единицах.
          // Берём САМОЕ ГЛУБОКОЕ проникновение, а не сумму по всем зонам —
          // иначе перекрывающиеся коллайдеры катапультируют игрока.
          if (effective > 1e-6) {
            const mag = effective * minRad * 1.05 * s.w;
            if (mag > maxPush) { maxPush = mag; push.copy(n).multiplyScalar(mag); }
          }

          // Насколько глубоко игрок утоплен (для эффектов и замедления)
          const sinkAmount = maxSink > 1e-6 ? Math.min(1, penMeters / maxSink) : 0;
          if (sinkAmount > bestSink) {
            bestSink = sinkAmount;
            result.sink = sinkAmount;
            result.normal.copy(n);
            result.friction = c.friction;
          }

          // ---- СТОЯНИЕ СВЕРХУ ----
          // Если контакт сверху (нормаль вверх) — это опора
          if (c.standable && n.y > 0.42) {
            const topLocal = c.center.y + ey * n.y * 0.96;
            const topWorld = f.root.position.y + topLocal * bs;
            if (topWorld > result.groundY && topWorld < worldPos.y + height * 0.65) {
              result.groundY = topWorld;
              result.groundZone = c;
            }
          }

          // ---- ОТДАЧА В ТЕЛО ----
          // Игрок давит на жир: вмятина + импульс + волна
          const pressDir = _tmpV4.copy(n).multiplyScalar(-1);
          c.node.press(pressDir, penetration * 0.35 * dt * 12);
          c.node.impulse(pressDir, penetration * 26 * dt * 60 * 0.016);
        }
      }

      if (result.hit && push.lengthSq() > 1e-8) {
        // Клампим шаг разрешения: не более 0.35 м за кадр, чтобы не было телепортов
        const maxStep = 0.35 / bs;
        if (push.length() > maxStep) push.setLength(maxStep);
        const worldPush = _tmpV4.copy(push).multiplyScalar(bs);
        worldPush.applyQuaternion(f.root.quaternion);
        worldPos.x += worldPush.x;
        worldPos.z += worldPush.z;
        // По вертикали выталкиваем только вверх (вниз — пусть проваливается на опору)
        if (worldPush.y > 0) worldPos.y += worldPush.y;
        result.pushed = true;

        /* Гасим скорость только когда упёрлись во ВНУТРЕННИЙ твёрдый слой.
         * Пока игрок идёт сквозь жир, выталкивания нет вовсе (push == 0),
         * и этот код не выполняется — поэтому шаг внутрь не «съедается»
         * и не возникает скольжения по невидимой скорлупе. */
        const nWorld = _tmpV2.copy(result.normal).applyQuaternion(f.root.quaternion);
        const vn = velocity.dot(nWorld);
        if (vn < 0) {
          const restitution = result.zone ? result.zone.bounce * 0.35 : 0.1;
          velocity.addScaledVector(nWorld, -vn * (1 + restitution));
        }
      }

      return result;
    }

    /* --------------------------------------------------------
     * 3b. РЕЙКАСТ ПО САМОМУ МЕШУ (а не по зонам)
     * -------------------------------------------------------- */
    /**
     * Луч по треугольникам тела.
     *
     * Прежний raycast бил по эллипсоидам зон — и точка хвата всегда
     * «прилипала» к ближайшей зоне. Игрок фактически выбирал из 60
     * предопределённых мест, а не хватался там, куда смотрит.
     *
     * Здесь мы пересекаем ЛУЧ С ТРЕУГОЛЬНИКАМИ настоящего меша. Точка
     * хвата — ровно точка пересечения, любой миллиметр поверхности:
     * кончик уха, складочка между валиками, место между лопатками.
     *
     * Возвращаем ещё и треугольник с барицентрическими координатами —
     * по ним захват «приклеивается» к поверхности и едет вместе с
     * деформацией, а свойства (мягкость, глубина) считаются смешиванием
     * весов трёх вершин, а не берутся из зоны.
     *
     * @returns {object|null} {point, normal, tri:[a,b,c], bary:[u,v,w], distance}
     */
    raycastMesh(originWorld, dirWorld, maxDist) {
      const f = this.furry;
      const geo = f.mesh.geometry;
      const pos = geo.attributes.position.array;
      const idx = geo.index.array;

      // Луч в локальное пространство меша (дешевле, чем гонять вершины в мир)
      f.mesh.updateMatrixWorld();
      const inv = _tmpMat.copy(f.mesh.matrixWorld).invert();
      const o = _tmpV1.copy(originWorld).applyMatrix4(inv);
      const d = _tmpV2.copy(dirWorld).transformDirection(inv).normalize();
      // maxDist задан в мире; масштаб меша ~bodyScale
      const scale = f.bodyScale || 1;
      const maxT = maxDist / scale;

      let bestT = maxT, ba = -1, bb = -1, bc = -1, bu = 0, bv = 0;

      // Möller–Trumbore по всем треугольникам. Вызывается только по клику,
      // поэтому полный перебор дешевле, чем поддерживать BVH на меше,
      // который деформируется каждый кадр.
      for (let i = 0, n = idx.length; i < n; i += 3) {
        const ia = idx[i] * 3, ib = idx[i + 1] * 3, ic = idx[i + 2] * 3;
        const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2];
        const e1x = pos[ib] - ax, e1y = pos[ib + 1] - ay, e1z = pos[ib + 2] - az;
        const e2x = pos[ic] - ax, e2y = pos[ic + 1] - ay, e2z = pos[ic + 2] - az;

        const px = d.y * e2z - d.z * e2y;
        const py = d.z * e2x - d.x * e2z;
        const pz = d.x * e2y - d.y * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-9 && det < 1e-9) continue;      // луч параллелен грани
        const invDet = 1 / det;

        const tx = o.x - ax, ty = o.y - ay, tz = o.z - az;
        const u = (tx * px + ty * py + tz * pz) * invDet;
        if (u < -1e-6 || u > 1 + 1e-6) continue;

        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = (d.x * qx + d.y * qy + d.z * qz) * invDet;
        if (v < -1e-6 || u + v > 1 + 1e-6) continue;

        const tHit = (e2x * qx + e2y * qy + e2z * qz) * invDet;
        if (tHit <= 1e-5 || tHit >= bestT) continue;

        bestT = tHit; ba = idx[i]; bb = idx[i + 1]; bc = idx[i + 2]; bu = u; bv = v;
      }
      if (ba < 0) return null;

      const w = 1 - bu - bv;
      // Точка в локальных координатах меша
      const lx = pos[ba*3] * w + pos[bb*3] * bu + pos[bc*3] * bv;
      const ly = pos[ba*3+1] * w + pos[bb*3+1] * bu + pos[bc*3+1] * bv;
      const lz = pos[ba*3+2] * w + pos[bb*3+2] * bu + pos[bc*3+2] * bv;
      const point = new THREE.Vector3(lx, ly, lz).applyMatrix4(f.mesh.matrixWorld);

      // Нормаль грани
      const nrm = geo.attributes.normal.array;
      const normal = new THREE.Vector3(
        nrm[ba*3] * w + nrm[bb*3] * bu + nrm[bc*3] * bv,
        nrm[ba*3+1] * w + nrm[bb*3+1] * bu + nrm[bc*3+1] * bv,
        nrm[ba*3+2] * w + nrm[bb*3+2] * bu + nrm[bc*3+2] * bv
      ).transformDirection(f.mesh.matrixWorld).normalize();

      return {
        point, normal,
        tri: [ba, bb, bc], bary: [w, bu, bv],
        distance: bestT * scale,
      };
    }

    /**
     * Свойства поверхности В ТОЧКЕ (а не «в зоне»).
     *
     * Смешиваем характеристики узлов, влияющих на три вершины грани, с
     * учётом их весов в скиннинге и барицентрики. Точка на границе живота
     * и бока получит промежуточные свойства — как и должно быть.
     */
    surfaceAt(tri, bary) {
      const f = this.furry;
      const K = f.K;
      let soft = 0, growth = 0, wsum = 0, cellul = 0;
      let bestW = -1, dominant = null;
      for (let k = 0; k < 3; k++) {
        const v = tri[k], bw = bary[k];
        for (let j = 0; j < K; j++) {
          const zi = f.wIdx[v * K + j];
          if (zi < 0) break;
          const w = f.wVal[v * K + j] * bw;
          const nd = f.nodes[zi];
          soft += nd.soft * w;
          growth += nd.growth * w;
          cellul += (nd.zone.cellulite || 0) * w;
          wsum += w;
          if (w > bestW) { bestW = w; dominant = nd; }
        }
      }
      if (wsum < 1e-6) return { soft: 0.5, growth: 0.2, node: f.nodeById.mid_belly, cellulite: 0 };
      return { soft: soft / wsum, growth: growth / wsum,
               cellulite: cellul / wsum, node: dominant };
    }

    /* --------------------------------------------------------
     * 4. САМОКОЛЛИЗИЯ ЗОН
     * -------------------------------------------------------- */
    /**
     * Зоны сталкиваются между собой: грудь ложится на живот, внутренние бёдра
     * трутся, складка опирается на бедро. Даёт эффект «плоть занимает объём».
     */
    selfCollision(dt) {
      // Флаг нужен тестам: позволяет замерить чистое распространение волны
      if (this.selfCollisionEnabled === false) return;
      const strength = 0.5;
      for (const [a, b, restDist] of this.selfPairs) {
        // Быстрая сферическая проверка
        const dx = b.center.x - a.center.x;
        const dy = b.center.y - a.center.y;
        const dz = b.center.z - a.center.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const ra = (a.radii.x + a.radii.y + a.radii.z) / 3;
        const rb = (b.radii.x + b.radii.y + b.radii.z) / 3;
        const sum = (ra + rb) * 0.82;   // 0.82 — плоть слегка проникает друг в друга
        if (d2 >= sum * sum) continue;

        const d = Math.sqrt(d2) || 1e-5;
        const overlap = (sum - d) / sum;
        this.stats.selfContacts++;

        // Направление расталкивания
        const nx = dx / d, ny = dy / d, nz = dz / d;

        // Более лёгкая зона отходит сильнее (закон масс)
        const ma = a.node.mass, mb = b.node.mass;
        const total = ma + mb;
        const fa = (mb / total) * overlap * strength;
        const fb = (ma / total) * overlap * strength;

        // Расталкивание через импульс — мягко, чтобы не «взрывалось»
        const impA = Math.min(0.55, fa * 26 * dt * 60 * 0.016);
        const impB = Math.min(0.55, fb * 26 * dt * 60 * 0.016);
        a.node.impulse(_tmpV1.set(-nx, -ny * 0.55, -nz), impA);
        b.node.impulse(_tmpV1.set(nx, ny * 0.55, nz), impB);

        /* --- Давление контакта ---
         * Зона знает, что её прижимает соседняя плоть. Это питает
         * термомодель (нагрев/пот) и сохранение объёма в SoftNode. */
        a.node.contactPress = Math.min(1, a.node.contactPress + overlap * 2.2);
        b.node.contactPress = Math.min(1, b.node.contactPress + overlap * 2.2);

        /* --- Volume preservation ---
         * Сжали плоть в точке контакта — объём уходит вбок, а не исчезает.
         * Направление выпучивания берём НЕ произвольным перпендикуляром
         * (он давал разный знак слева и справа и кособочил тело), а строго
         * наружу от продольной оси тела: обе зоны раздаются симметрично. */
        const vp = FF.CONFIG.soft.volumePreserve;
        if (vp > 0 && overlap > 0.04) {
          const bulge = Math.min(0.12, overlap * vp * 0.35);
          // Радиальное направление в горизонтальной плоскости для каждой зоны
          const ax = a.center.x, az = a.center.z;
          const bx = b.center.x, bz = b.center.z;
          const al = Math.hypot(ax, az) || 1, bl = Math.hypot(bx, bz) || 1;
          a.node.impulse(_tmpV1.set(ax / al, 0.12, az / al), bulge);
          b.node.impulse(_tmpV1.set(bx / bl, 0.12, bz / bl), bulge);
        }

        // Трение соприкасающихся поверхностей: нагрев + звук
        const relVel = Math.abs(a.node.vel.y - b.node.vel.y) + Math.abs(a.node.vel.x - b.node.vel.x);
        if (relVel > 0.35) {
          // Нагрев пропорционален скорости трения и глубине контакта
          const rub = dt * 0.4 * (0.5 + relVel) * (0.4 + overlap);
          a.node.heat = Math.min(1, a.node.heat + rub);
          b.node.heat = Math.min(1, b.node.heat + rub);
          // Звук трения бёдер/складок — редко, чтобы не спамить
          if ((a.zone.friction || b.zone.friction) && Math.random() < dt * 1.6) {
            this.furry.audio && this.furry.audio.squish();
          }
        }
      }
    }

    /* --------------------------------------------------------
     * 5. КОЛЛИЗИЯ ТЕЛА С МИРОМ
     * -------------------------------------------------------- */
    /**
     * Тело обволакивает окружение: расплывается по земле, продавливает
     * мебель, упирается в стены. Вызывается из FurryEngine.update.
     */
    worldCollision(world, dt) {
      const f = this.furry;
      const bs = f.bodyScale;
      const groundY = world.heightAt(f.root.position.x, f.root.position.z);

      for (const c of this.colliders) {
        const nd = c.node;
        if (nd.growth < 0.05) continue;

        // ---- ЗЕМЛЯ: нижние зоны расплываются ----
        const worldBottom = f.root.position.y + (c.center.y - c.radii.y) * bs;
        const pen = groundY - worldBottom;
        if (pen > 0) {
          // Выталкиваем вверх и «расплющиваем» — жир растекается в стороны
          const k = Math.min(1, pen / (c.radii.y * bs + 0.001));
          nd.impulse(_tmpV1.set(0, 1, 0), k * 22 * dt * 60 * 0.016);
          // Растекание: боковое смещение пропорционально сдавливанию
          const spread = k * c.softness * 0.55;
          const ang = Math.atan2(nd.base.z, nd.base.x);
          nd.offset.x += Math.cos(ang) * spread * dt * 2.2;
          nd.offset.z += Math.sin(ang) * spread * dt * 2.2;
          nd.press(_tmpV1.set(0, -1, 0), k * 0.25 * dt * 8);
        }

        // ---- ПРЕПЯТСТВИЯ: стены, мебель ----
        // Проверяем только крупные выпирающие зоны — остальное незаметно
        if (c.worldRadius < 0.35) continue;
        for (const col of world.colliders) {
          if (col.type === 'box') {
            const hw = col.w / 2 + c.worldRadius, hd = col.d / 2 + c.worldRadius;
            const dx = c.worldCenter.x - col.x, dz = c.worldCenter.z - col.z;
            if (Math.abs(dx) > hw || Math.abs(dz) > hd) continue;
            if (c.worldCenter.y > col.h + c.worldRadius) continue;
            const px = hw - Math.abs(dx), pz = hd - Math.abs(dz);
            // Расталкиваем по меньшей оси проникновения
            if (px < pz) nd.impulse(_tmpV1.set(Math.sign(dx || 1), 0, 0), px * 14 * dt * 60 * 0.016);
            else nd.impulse(_tmpV1.set(0, 0, Math.sign(dz || 1)), pz * 14 * dt * 60 * 0.016);
            nd.press(_tmpV1.set(-Math.sign(dx || 1), 0, -Math.sign(dz || 1)).normalize(), 0.1 * dt * 6);
          } else if (col.type === 'cyl') {
            const dx = c.worldCenter.x - col.x, dz = c.worldCenter.z - col.z;
            const d = Math.hypot(dx, dz);
            const rr = col.r + c.worldRadius;
            if (d > rr || c.worldCenter.y > col.h + c.worldRadius) continue;
            const k = (rr - d) / rr;
            nd.impulse(_tmpV1.set(dx / (d || 1), 0, dz / (d || 1)), k * 16 * dt * 60 * 0.016);
          }
        }
      }
    }

    /* --------------------------------------------------------
     * 6. ТОЧНЫЙ РЕЙКАСТ ПО ЗОНАМ
     * -------------------------------------------------------- */
    /**
     * Луч против всех эллипсоидов зон — для прицеливания рукой,
     * бросков еды и выбора точки захвата.
     * @returns {object|null} {collider, point, normal, distance}
     */
    raycast(originWorld, dirWorld, maxDist) {
      const f = this.furry;
      const bs = f.bodyScale;
      // В локальное пространство
      const o = _tmpV1.copy(originWorld);
      f.root.worldToLocal(o);
      o.divideScalar(bs);
      const d = _tmpV2.copy(dirWorld);
      const inv = f.root.quaternion.clone().invert();
      d.applyQuaternion(inv).normalize();

      let best = null, bestT = maxDist / bs;
      for (const c of this.colliders) {
        if (c.node.growth < 0.02 && c.zone.gain > 0) continue;
        // Луч-эллипсоид: нормируем пространство в сферу
        const ox = (o.x - c.center.x) / c.radii.x;
        const oy = (o.y - c.center.y) / c.radii.y;
        const oz = (o.z - c.center.z) / c.radii.z;
        const dx = d.x / c.radii.x, dy = d.y / c.radii.y, dz = d.z / c.radii.z;
        const a = dx * dx + dy * dy + dz * dz;
        const b = 2 * (ox * dx + oy * dy + oz * dz);
        const cc = ox * ox + oy * oy + oz * oz - 1;
        const disc = b * b - 4 * a * cc;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        let t = (-b - sq) / (2 * a);
        if (t < 0) t = (-b + sq) / (2 * a);
        if (t < 0 || t > bestT) continue;
        bestT = t;
        best = c;
      }
      if (!best) return null;

      const pointLocal = _tmpV3.copy(o).addScaledVector(d, bestT);
      const normalLocal = best.normalLocal(pointLocal.x, pointLocal.y, pointLocal.z, _tmpV4.clone());
      const point = pointLocal.clone().multiplyScalar(bs);
      f.root.localToWorld(point);
      const normal = normalLocal.clone().applyQuaternion(f.root.quaternion);
      return { collider: best, node: best.node, point, normal, distance: bestT * bs };
    }

    /** Ближайшая зона к мировой точке (точнее, чем старый zoneAt) */
    nearestZone(worldPoint, maxDist) {
      const f = this.furry;
      const bs = f.bodyScale;
      const local = _tmpV1.copy(worldPoint);
      f.root.worldToLocal(local);
      local.divideScalar(bs);

      let best = null, bestScore = Infinity;
      for (const c of this.colliders) {
        // Расстояние до поверхности эллипсоида (нормированное)
        const dx = (local.x - c.center.x) / c.radii.x;
        const dy = (local.y - c.center.y) / c.radii.y;
        const dz = (local.z - c.center.z) / c.radii.z;
        const nd = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const surfDist = Math.abs(nd - 1) * Math.min(c.radii.x, c.radii.y, c.radii.z);
        if (surfDist < bestScore) { bestScore = surfDist; best = c; }
      }
      if (!best) return null;
      return bestScore * bs <= (maxDist || 1.0) ? best.node : null;
    }

    /** Высота поверхности тела в точке XZ (для стояния на любой части) */
    surfaceHeightAt(worldX, worldZ, maxY) {
      const f = this.furry;
      const bs = f.bodyScale;
      const local = _tmpV1.set(worldX, f.root.position.y, worldZ);
      f.root.worldToLocal(local);
      local.divideScalar(bs);

      let top = -Infinity, zone = null;
      for (const c of this.colliders) {
        if (!c.standable || c.node.growth < 0.05) continue;
        const dx = (local.x - c.center.x) / c.radii.x;
        const dz = (local.z - c.center.z) / c.radii.z;
        const horiz = dx * dx + dz * dz;
        if (horiz >= 1) continue;
        // Высота верхней полусферы эллипсоида в этой точке
        const y = c.center.y + c.radii.y * Math.sqrt(1 - horiz);
        const worldY = f.root.position.y + y * bs;
        if (worldY > top && (maxY === undefined || worldY <= maxY)) { top = worldY; zone = c; }
      }
      return zone ? { y: top, zone } : null;
    }

    /* --------------------------------------------------------
     * 7. ОТЛАДОЧНАЯ ВИЗУАЛИЗАЦИЯ
     * -------------------------------------------------------- */
    toggleDebug(scene) {
      this.debugEnabled = !this.debugEnabled;
      if (this.debugEnabled && !this.debugMesh) {
        const geo = new THREE.SphereGeometry(1, 10, 7);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.35 });
        this.debugMesh = new THREE.InstancedMesh(geo, mat, this.colliders.length);
        this.debugMesh.frustumCulled = false;
        this.furry.root.add(this.debugMesh);
      }
      if (this.debugMesh) this.debugMesh.visible = this.debugEnabled;
      return this.debugEnabled;
    }

    _updateDebug() {
      if (!this.debugMesh) return;
      const dummy = new THREE.Object3D();
      this.colliders.forEach((c, i) => {
        dummy.position.copy(c.center);
        dummy.scale.copy(c.radii);
        dummy.updateMatrix();
        this.debugMesh.setMatrixAt(i, dummy.matrix);
      });
      this.debugMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /* ============================================================
   * 8. ФИЗИКА БРОШЕННЫХ ПРЕДМЕТОВ
   * ------------------------------------------------------------
   * Еда, которую игрок роняет или бросает: падает, отскакивает от
   * тела фурри, катится по земле, застревает в складках.
   * ============================================================ */
  class ObjectPhysics {
    constructor(scene, world, bodyPhysics) {
      this.scene = scene;
      this.world = world;
      this.body = bodyPhysics;
      this.items = [];
      this.maxItems = 40;
    }

    /**
     * Бросить предмет.
     * @param {string} foodId
     * @param {THREE.Vector3} pos
     * @param {THREE.Vector3} vel
     */
    spawn(foodId, pos, vel) {
      const food = FF.FOOD_BY_ID[foodId];
      if (!food) return null;
      // Размер по калорийности
      const s = U.clamp(0.09 + Math.pow(food.cal, 0.33) * 0.055, 0.09, 0.62);
      const hue = (foodId.length * 37 % 100) / 100;
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(s, 1),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(hue * 0.14 + 0.04, 0.62, 0.6), roughness: 0.7 })
      );
      mesh.position.copy(pos);
      mesh.castShadow = true;
      this.scene.add(mesh);

      const item = {
        mesh, foodId, radius: s, cal: food.cal,
        vel: vel.clone(),
        angVel: new THREE.Vector3(U.rand(-6, 6), U.rand(-6, 6), U.rand(-6, 6)),
        rest: 0, life: 90, stuck: null, grabbed: false,
      };
      this.items.push(item);
      // Лимит предметов — старые исчезают
      while (this.items.length > this.maxItems) this._remove(this.items[0]);
      return item;
    }

    _remove(item) {
      const i = this.items.indexOf(item);
      if (i >= 0) this.items.splice(i, 1);
      this.scene.remove(item.mesh);
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
    }

    update(dt, furry) {
      const G = -19.6;
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        it.life -= dt;
        if (it.life <= 0) { this._remove(it); continue; }

        // Застрял в складке — едет вместе с телом
        if (it.stuck) {
          const c = it.stuck.collider;
          const p = _tmpV1.copy(c.center).addScaledVector(it.stuck.offset, 1).multiplyScalar(furry.bodyScale);
          furry.root.localToWorld(p);
          it.mesh.position.lerp(p, 1 - Math.exp(-14 * dt));
          // Колыхание вытряхивает предмет
          if (c.node.vel.length() > 2.4 && Math.random() < dt * 2) {
            it.stuck = null;
            it.vel.set(U.rand(-1, 1), 2.2, U.rand(-1, 1));
          }
          continue;
        }

        // Интеграция
        it.vel.y += G * dt;
        it.mesh.position.addScaledVector(it.vel, dt);
        it.mesh.rotation.x += it.angVel.x * dt;
        it.mesh.rotation.y += it.angVel.y * dt;
        it.mesh.rotation.z += it.angVel.z * dt;

        // --- Коллизия с телом фурри (по всем зонам!) ---
        const hitZone = this.body.nearestZone(it.mesh.position, it.radius + 0.12);
        if (hitZone) {
          const c = this.body.byId[hitZone.zone.id];
          const local = _tmpV2.copy(it.mesh.position);
          furry.root.worldToLocal(local);
          local.divideScalar(furry.bodyScale);
          const depth = c.testLocal(local.x, local.y, local.z);
          if (depth > 0) {
            const n = c.normalLocal(local.x, local.y, local.z, _tmpV3.clone());
            const nWorld = n.applyQuaternion(furry.root.quaternion);
            // Выталкиваем наружу
            it.mesh.position.addScaledVector(nWorld, depth * c.worldRadius * 0.9);
            const vn = it.vel.dot(nWorld);
            if (vn < 0) {
              // Мягкие зоны поглощают удар, жёсткие — отбивают
              const rest = 0.05 + (1 - c.softness) * 0.45;
              it.vel.addScaledVector(nWorld, -vn * (1 + rest));
              it.vel.multiplyScalar(0.72);
              // Тело реагирует на удар едой
              c.node.impulse(nWorld.clone().negate(), Math.abs(vn) * 2.2);
              c.node.press(nWorld.clone().negate(), Math.min(0.1, Math.abs(vn) * 0.03));
              furry.audio && Math.abs(vn) > 1.4 && furry.audio.poke(c.softness);
              // Шанс застрять в складке (глубокие мягкие зоны)
              if (c.softness > 0.9 && c.node.growth > 0.5 && Math.abs(vn) < 3 && Math.random() < 0.35) {
                const off = local.clone().sub(c.center);
                it.stuck = { collider: c, offset: off };
                furry.audio && furry.audio.squish();
              }
            }
          }
        }

        // --- Земля ---
        const gy = this.world.heightAt(it.mesh.position.x, it.mesh.position.z) + it.radius;
        if (it.mesh.position.y <= gy) {
          it.mesh.position.y = gy;
          if (it.vel.y < 0) it.vel.y = -it.vel.y * 0.35;
          it.vel.x *= 0.86; it.vel.z *= 0.86;
          it.angVel.multiplyScalar(0.86);
          if (Math.abs(it.vel.y) < 0.35) { it.vel.y = 0; it.rest += dt; }
        }
      }
    }

    /** Подобрать ближайший предмет */
    pickup(worldPos, maxDist) {
      let best = null, bd = maxDist || 2.2;
      for (const it of this.items) {
        const d = it.mesh.position.distanceTo(worldPos);
        if (d < bd) { bd = d; best = it; }
      }
      if (best) { const id = best.foodId; this._remove(best); return id; }
      return null;
    }

    /** Фурри съедает лежащую рядом еду сам */
    autoEat(furry, radius) {
      const head = furry.zoneWorldPos('muzzle_lips');
      for (const it of this.items) {
        if (it.mesh.position.distanceTo(head) < (radius || 1.4)) {
          const id = it.foodId;
          this._remove(it);
          return id;
        }
      }
      return null;
    }
  }

  FF.ZoneCollider = ZoneCollider;
  FF.BodyPhysics = BodyPhysics;
  FF.ObjectPhysics = ObjectPhysics;
})(typeof window !== 'undefined' ? window : globalThis);
