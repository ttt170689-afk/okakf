/**
 * bodies-v3.test.js — тесты «Библии тела v3.0»
 * Тело игрока, пищеварение, хвост, под-животная акустика, жесты.
 */
global.window = global; global.self = global;
global.performance = global.performance || { now: () => Date.now() };
function stubCanvas() {
  return { width: 0, height: 0, getContext: () => ({
    fillRect(){},clearRect(){},getImageData:()=>({data:[]}),putImageData(){},createImageData:()=>({}),
    setTransform(){},drawImage(){},save(){},fillText(){},restore(){},beginPath(){},moveTo(){},lineTo(){},
    closePath(){},stroke(){},translate(){},scale(){},rotate(){},arc(){},fill(){},measureText:()=>({width:10}),
    transform(){},rect(){},clip(){},createLinearGradient:()=>({addColorStop(){}}),
    createRadialGradient:()=>({addColorStop(){}}),
  }), style:{}, addEventListener(){}, toDataURL:()=>'' };
}
global.document = { createElement: (t) => (t === 'canvas' ? stubCanvas()
  : { style:{}, addEventListener(){}, appendChild(){}, setAttribute(){} }),
  addEventListener(){}, body:{appendChild(){},style:{}}, getElementById:()=>null, querySelector:()=>null };

const _t = require('../libs/three.min.js');
global.THREE = global.THREE || window.THREE || _t;
require('../src/utils.js'); require('../src/config.js');
require('../src/physics.js'); require('../src/lifesystems.js'); require('../src/furry.js');
require('../src/world.js'); require('../src/hands.js');
require('../src/player.js'); require('../src/playerbody.js');

const FF = global.FF;
let pass = 0, fail = 0;
const t = (n, c, extra) => { c ? (pass++, console.log('  ✓', n, extra || ''))
                               : (fail++, console.log('  ✗', n, extra || '')); };

const audio = { squish(){}, jiggle(){}, slap(){}, voice(){}, step(){}, bubble(){},
                noise(){}, setAmbience(){}, ui(){} };
const scene = new THREE.Scene();
const world = new FF.World(scene, { shadowMap:{}, capabilities:{} }, audio);
const furry = new FF.FurryEngine(scene, { species:'fox', build:'pear',
  furColor:0xe0762c, eyeColor:0x44aa66, name:'Тест' }, audio);
const camera = new THREE.PerspectiveCamera(75, 1.6, 0.1, 1000);
const player = new FF.PlayerController(camera, world, furry, audio);
const body = new FF.PlayerBody(scene, player);
player.body = body;
const dt = 1 / 60;

console.log('=== 1. ТЕЛО ИГРОКА ===');
t('тело создано', !!body.group);
t('две ноги с суставами', body.legs.length === 2 && !!body.legs[0].knee);
t('есть торс', !!body.torso);
t('есть тень', !!body.shadow);
player.pos.set(0, world.heightAt(0, 0), 0);
for (let i = 0; i < 30; i++) body.update(dt);
t('тело следует за игроком',
  Math.abs(body.group.position.x - player.pos.x) < 0.01);
t('тень лежит на земле',
  Math.abs(body.shadow.position.y - (world.heightAt(0, 0) + 0.02)) < 0.05);

console.log('=== 2. ШАГОВАЯ АНИМАЦИЯ ===');
player.vel.set(3, 0, 0); player.onGround = true;
const hipStart = body.legs[0].hip.rotation.x;
let moved = false;
for (let i = 0; i < 40; i++) { body.update(dt);
  if (Math.abs(body.legs[0].hip.rotation.x - hipStart) > 0.05) moved = true; }
t('ноги шагают при движении', moved);
t('ноги двигаются в противофазе',
  Math.abs(body.legs[0].hip.rotation.x - body.legs[1].hip.rotation.x) > 0.01);
player.vel.set(0, 0, 0);

console.log('=== 3. ПРИСЕД И ПОЛЗАНИЕ ===');
player.crawling = true;
for (let i = 0; i < 20; i++) body.update(dt);
const crawlY = body.group.scale.y;
player.crawling = false; player.crouch = false;
for (let i = 0; i < 40; i++) body.update(dt);
t('ползком тело сжимается', crawlY < 0.5, 'scaleY=' + crawlY.toFixed(2));
t('стоя тело распрямляется', body.group.scale.y > 0.95);
t('высота глаз ползком задана', FF.CONFIG.player.crawlHeight < FF.CONFIG.player.crouchHeight);

console.log('=== 4. СИЛА ===');
const s0 = body.strength;
body.addStrengthXP(500);
t('сила растёт от нагрузки', body.strength > s0, '×' + body.strength.toFixed(2));
body.addStrengthXP(100000);
t('сила имеет потолок', body.strength <= 2.5, '×' + body.strength.toFixed(2));

console.log('=== 5. ПИЩЕВАРЕНИЕ ===');
const dig = furry.digestion;
t('система создана', !!dig);
t('желудок пуст в начале', dig.stomach === 0);
dig.addFood(2000);
t('еда попадает в желудок', dig.stomach === 2000);
t('живот распёрт', dig.fullness() > 0.1, 'fullness=' + dig.fullness().toFixed(2));
for (let i = 0; i < 600; i++) furry.update(dt, 12);
t('желудок опорожняется со временем', dig.stomach < 2000, 'осталось=' + dig.stomach.toFixed(0));
t('ёмкость растёт со стадией', dig.maxCapacity > dig.capacity);

console.log('=== 6. ХВОСТ ===');
const tail = furry.tail;
t('система создана', !!tail);
tail.wag(1, 3);
let swung = false, maxSwing = 0;
for (let i = 0; i < 60; i++) { furry.update(dt, 12);
  const a = Math.abs(tail.swing.x); if (a > maxSwing) maxSwing = a; if (a > 0.02) swung = true; }
t('хвост виляет от радости', swung, 'макс угол=' + maxSwing.toFixed(3));
t('угол в разумных пределах', maxSwing < 0.9);
// Хвост не должен «залипать» в упорах: это признак накопления виляния
let clamped = 0;
for (let i = 0; i < 180; i++) { furry.update(dt, 12); if (Math.abs(tail.swing.x) > 0.79) clamped++; }
t('хвост не залипает в упоре', clamped < 5, 'кадров в упоре=' + clamped);
let nan = !isFinite(tail.swing.x) || !isFinite(tail.swing.y);
t('нет NaN в хвосте', !nan);

console.log('=== 7. ПОД ЖИВОТОМ ===');
const fakeGame = { scene, furry, audio, notify(){}, achieve(){} };
const ub = new FF.UnderBellyAmbience(fakeGame);
t('система создана', !!ub.light);
t('свет выключен снаружи', ub.light.intensity === 0);
ub.setActive(true);
for (let i = 0; i < 60; i++) ub.update(dt);
t('внутри загорается красный свет', ub.light.intensity > 0.5,
  'intensity=' + ub.light.intensity.toFixed(2));
t('свет красного оттенка', ub.light.color.r > ub.light.color.b);
ub.setActive(false);
for (let i = 0; i < 120; i++) ub.update(dt);
t('снаружи свет гаснет', ub.light.intensity < 0.2 || !ub.light.visible);

console.log('=== 8. ОДЕЖДА ИГРОКА ===');
t('смена комплекта работает', body.setOutfit('sport') === true);
t('неизвестный комплект отклонён', body.setOutfit('nonexistent') === false);
t('цвет футболки применился',
  body.materials.shirt.color.getHex() === FF.PLAYER_OUTFITS.sport.shirt);

console.log('=== 9. УСТОЙЧИВОСТЬ ===');
let err = null;
try {
  furry.calories = 400000; furry._updateGrowthTargets(true);
  for (let i = 0; i < 200; i++) {
    furry.update(dt, 12); body.update(dt);
    if (i % 50 === 0) { furry.digestion.addFood(5000); furry.tail.wag(1, 1); }
  }
} catch (e) { err = e.message; }
t('гигантская стадия без ошибок', !err, err || '');
let bad = 0;
for (const n of furry.nodes) if (!isFinite(n.offset.y)) bad++;
t('нет NaN в зонах', bad === 0);
const pa = furry.mesh.geometry.attributes.position.array;
let vnan = 0; for (let i = 0; i < pa.length; i++) if (!isFinite(pa[i])) vnan++;
t('нет NaN в вершинах', vnan === 0);

console.log('\nИТОГО: ' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
