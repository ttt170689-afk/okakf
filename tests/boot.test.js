// Загружаем ВСЕ скрипты в том же порядке, что и index.html
global.window=global; global.self=global;
global.performance=global.performance||{now:()=>Date.now()};
function ctx(){return new Proxy({},{get:(t,k)=>{
  if(k==='canvas')return{width:300,height:150};
  if(k==='createRadialGradient'||k==='createLinearGradient')return()=>({addColorStop(){}});
  if(k==='getImageData')return()=>({data:new Uint8ClampedArray(4)});
  if(k==='measureText')return()=>({width:10});
  return ()=>{};}});}
function el(tag){const e={tagName:tag,style:{},dataset:{},children:[],classList:{add(){},remove(){},toggle(){},contains:()=>false},
  width:300,height:150,appendChild(c){this.children.push(c);return c;},removeChild(){},addEventListener(){},removeEventListener(){},
  setAttribute(){},getAttribute:()=>null,getContext:()=>ctx(),toDataURL:()=>'data:,',focus(){},blur(){},remove(){},
  querySelector:()=>null,querySelectorAll:()=>[],insertAdjacentHTML(){},getBoundingClientRect:()=>({width:800,height:600,left:0,top:0}),
  requestPointerLock(){},};
  Object.defineProperty(e,'innerHTML',{get(){return '';},set(){}});
  Object.defineProperty(e,'textContent',{get(){return '';},set(){}});
  return e;}
const store={};
global.document={createElement:el,createElementNS:()=>el('svg'),addEventListener(){},removeEventListener(){},
  body:el('body'),documentElement:el('html'),head:el('head'),
  getElementById:(id)=>store[id]||(store[id]=el('div')),querySelector:()=>el('div'),querySelectorAll:()=>[],
  exitPointerLock(){},pointerLockElement:null};
global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
global.requestAnimationFrame=()=>0; global.cancelAnimationFrame=()=>{};
global.innerWidth=1280; global.innerHeight=720; global.devicePixelRatio=1;
global.addEventListener=()=>{}; global.matchMedia=()=>({matches:false,addEventListener(){}});
global.AudioContext=global.webkitAudioContext=function(){return{
  currentTime:0,destination:{},sampleRate:48000,state:'running',resume(){},
  createGain:()=>({gain:{value:1,setTargetAtTime(){},setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}),
  createBiquadFilter:()=>({type:'',frequency:{value:0,setTargetAtTime(){},setValueAtTime(){},linearRampToValueAtTime(){}},Q:{value:1},connect(){},disconnect(){}}),
  createOscillator:()=>({type:'',frequency:{value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},detune:{value:0},connect(){},start(){},stop(){},onended:null}),
  createBufferSource:()=>({buffer:null,loop:false,playbackRate:{value:1},connect(){},start(){},stop(){},onended:null}),
  createStereoPanner:()=>({pan:{value:0},connect(){},disconnect(){}}),
  createDynamicsCompressor:()=>({threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0},connect(){},disconnect(){}}),
  createBuffer:(c,l)=>({length:l,numberOfChannels:c,sampleRate:48000,getChannelData:()=>new Float32Array(l)}),
  createConvolver:()=>({buffer:null,connect(){},disconnect(){}}),
  createAnalyser:()=>({fftSize:2048,connect(){},disconnect(){},getByteFrequencyData(){}}),
};};
const _t=require('../libs/three.min.js'); global.THREE=global.THREE||window.THREE||_t;
// Заглушка WebGL-рендера: реального GL в node нет
THREE.WebGLRenderer=function(){return{domElement:el('canvas'),shadowMap:{enabled:false,type:0},
  setSize(){},setPixelRatio(){},setClearColor(){},render(){},dispose(){},getContext:()=>({}),
  capabilities:{isWebGL2:true,getMaxAnisotropy:()=>1},info:{render:{}},outputColorSpace:'',toneMapping:0,toneMappingExposure:1};};
const files=['config','utils','audio','physics','lifesystems','emotions','massphysics','furry','world','hands','player','playerbody','bodyspots',
             'gameplay','systems','minigames','boarding','cabin','sugarcab','ui','game'];
for(const f of files){
  try{ require('../src/'+f+'.js'); }
  catch(e){ console.log('✗ ОШИБКА загрузки '+f+'.js: '+e.message); process.exit(1); }
}
console.log('✓ все '+files.length+' модулей загружены');
const FF=global.FF;
const need=['GameClass','CONFIG','U','ZONES','AudioEngine','BodyPhysics','FurryEngine','World','HandsSystem',
  'PlayerController','PlayerBody','DigestionSystem','TailSystem','UnderBellyAmbience','EmotionEngine','ProximitySystem','QuirkSystem','MassPhysics','BodySpots'];
let miss=need.filter(k=>!FF[k]);
console.log(miss.length? '✗ не экспортировано: '+miss.join(', ') : '✓ все ключевые классы экспортированы');
// Пробуем реально создать игру
try{
  const g=new FF.GameClass(document.getElementById('c'),{species:'fox',build:'pear',furColor:0xe0762c,eyeColor:0x44aa66,name:'Бут'});
  console.log('✓ Game создан');
  console.log('  тело игрока:', g.playerBody?'есть':'НЕТ');
  console.log('  под-животная акустика:', g.underBelly?'есть':'НЕТ');
  console.log('  пищеварение:', g.furry.digestion?'есть':'НЕТ');
  console.log('  хвост:', g.furry.tail?'есть':'НЕТ');
  const dt=1/60;
  for(let i=0;i<120;i++) g.update(dt);
  console.log('✓ 120 кадров игрового цикла без падений');
  g._hugFurry(); g._waveHand();
  console.log('✓ жесты (обнять/помахать) отработали');
  g.player.keys.KeyX=true; for(let i=0;i<30;i++) g.update(dt);
  console.log('✓ ползание:', g.player.crawling?'включается':'НЕ включается');
  g.player.keys.KeyX=false;
}catch(e){ console.log('✗ ОШИБКА: '+e.message+'\n'+e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); }
