/**
 * official-demo-004-transition：轉場設計。
 *
 * 四個分頁：
 *   ① 場景轉場（levels）：SceneTransition 在三個關卡之間切換（淡出 → 載入頁面、下載資源 → 換場景 → 淡入）
 *   ② 介面轉場（screens）：UIStackView 的換頁動畫、滑動換頁；UIScreenManager 疊加的 modal 視窗；toast
 *   ③ 鏡頭轉場（camera）：直接切換、平滑移動（補間）、淡出淡入切換；攝影機跟隨、畫面晃動
 *   ④ 過場動畫（cutscene）：時間軸串起淡出淡入、上下黑邊、字幕與鏡頭移動
 *
 * 介面在 public/ui/scene.xml；關卡的載入頁面在 public/ui/loading-*.xml；疊加視窗在 public/ui/notice.xml。
 */
import type { EasingName, Tween } from '@engine';
import type { Entity, World } from '@engine/ecs';
import { Color, Random, Vector3 } from '@engine/math';
import { PluginManager } from '@engine/plugins';
import perfMonitor from '@engine/packages/perf-monitor';
import { CameraFollow, OrbitControl, shakeCamera, spawn } from '@engine/render';
import { type Scene, Transform, math } from '@engine/scene';
import * as ui2d from '@engine/ui2d';
import {
  SceneTransition,
  type UIButton,
  UIScreenManager,
  type UILabel,
  type UIProgressBar,
  type UISelect,
  type UISlider,
  type UIStackView,
  type UIToggle,
} from '@engine/ui2d';
import { assets, audio, engine, input, render, scenes, tweens, ui, world } from './engine';

type Vec3 = [number, number, number];
const BACKGROUND = '#15181f';

// ───────── 共用 ─────────

for (const e of Object.values(spawn.defaultLights(world, { shadows: true }))) scenes.persist(e);

/** 每幀要做的事（只在目前這一頁執行；換頁時清掉） */
let pageUpdate: ((dt: number) => void) | null = null;
engine.on('update', (time) => pageUpdate?.(time.delta));

/** 背景顏色（每個場景自己設定） */
const setBackground = (color: string) => (render.scene.background = new Color(color));

/** 地面圓盤 */
const ground = (w: World, color: string, radius = 12) =>
  spawn.mesh(w, {
    geometry: { circle: radius },
    material: color,
    rotation: [-Math.PI / 2, 0, 0],
    receiveShadow: true,
  });

/** 可以用滑鼠轉動的攝影機；左邊的說明面板會擋住畫面左側，所以整個往左移一點，場景才會在右邊 */
function orbitCamera(position: Vec3, target: Vec3, autoRotate = 0): Entity {
  const eye = new Vector3(...position);
  const look = new Vector3(...target);
  const shift = look
    .clone()
    .sub(eye)
    .cross(new Vector3(0, 1, 0))
    .normalize()
    .multiplyScalar(-0.15 * eye.distanceTo(look));
  eye.add(shift);
  look.add(shift);
  const cam = spawn.camera(world, { position: eye, target: look, fov: 50 });
  world.add(cam, OrbitControl, { target: look, minDistance: 4, maxDistance: 30, wheelNeedsFocus: true, autoRotate });
  return cam;
}

/** 樹：樹幹 + 一到兩層樹冠 */
function tree(w: World, x: number, z: number, size: number, leaves: string, snowCap = false): void {
  spawn.mesh(w, {
    geometry: { cylinder: [0.12 * size, 0.8 * size] },
    material: '#6b4a2b',
    position: [x, 0.4 * size, z],
    castShadow: true,
  });
  spawn.mesh(w, {
    geometry: { cone: [0.7 * size, 1.4 * size] },
    material: leaves,
    position: [x, 1.4 * size, z],
    castShadow: true,
  });
  spawn.mesh(w, {
    geometry: { cone: [0.5 * size, 1 * size] },
    material: snowCap ? '#ffffff' : leaves,
    position: [x, 2.1 * size, z],
    castShadow: true,
  });
}

// ───────── ① 場景轉場：三個關卡 ─────────

const forest: Scene = {
  name: 'forest',
  setup(w) {
    setBackground('#1b2b1e');
    ground(w, '#24401f');
    const rng = new Random('forest');
    for (let i = 0; i < 40; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = 2 + rng.next() * 9;
      tree(w, Math.cos(a) * r, Math.sin(a) * r, 0.7 + rng.next() * 0.8, rng.pick(['#3f7a3a', '#2f6a35', '#4d8a3a']));
    }
    orbitCamera([0, 8, 17], [0, 1, 0], 0.08);
  },
};

const desert: Scene = {
  name: 'desert',
  setup(w) {
    setBackground('#e0b377');
    ground(w, '#d2a465');
    // 金字塔：四邊的圓錐
    for (const [x, z, s] of [
      [-3, -4, 3],
      [2.5, -6, 2.2],
      [5, -2, 1.4],
    ])
      spawn.mesh(w, {
        geometry: { cone: [s, s * 1.3, 4] },
        material: '#c8955a',
        position: [x, (s * 1.3) / 2, z],
        rotation: [0, Math.PI / 4, 0],
        castShadow: true,
      });
    // 仙人掌
    const rng = new Random('desert');
    for (let i = 0; i < 12; i++) {
      const x = rng.range(-8, 8);
      const z = rng.range(-2, 8);
      const h = rng.range(1, 2);
      spawn.mesh(w, {
        geometry: { capsule: [0.18, h] },
        material: '#4f8a3a',
        position: [x, h / 2 + 0.18, z],
        castShadow: true,
      });
      spawn.mesh(w, {
        geometry: { capsule: [0.12, 0.5] },
        material: '#4f8a3a',
        position: [x + 0.3, h * 0.7, z],
        castShadow: true,
      });
    }
    orbitCamera([0, 5, 14], [0, 1.5, -2], 0.08);
  },
};

const snow: Scene = {
  name: 'snow',
  setup(w) {
    setBackground('#a9c3dc');
    ground(w, '#eef4fa');
    const rng = new Random('snow');
    for (let i = 0; i < 25; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = 4 + rng.next() * 7;
      tree(w, Math.cos(a) * r, Math.sin(a) * r, 0.7 + rng.next() * 0.7, '#2f5a45', true);
    }
    // 雪人
    for (const [x, z] of [
      [0, 0],
      [-2, 1.5],
      [2.2, 1],
    ]) {
      spawn.mesh(w, { geometry: { sphere: 0.6 }, material: '#ffffff', position: [x, 0.55, z], castShadow: true });
      spawn.mesh(w, { geometry: { sphere: 0.42 }, material: '#ffffff', position: [x, 1.35, z], castShadow: true });
      spawn.mesh(w, { geometry: { sphere: 0.3 }, material: '#ffffff', position: [x, 1.95, z], castShadow: true });
      spawn.mesh(w, {
        geometry: { cone: [0.06, 0.3] },
        material: '#ff8c42',
        position: [x, 1.95, z + 0.36],
        rotation: [Math.PI / 2, 0, 0],
      });
    }
    orbitCamera([0, 5, 11], [0, 1, 0], 0.08);
  },
};

/** 「模擬慢速網路」：SceneTransition 的 assets 只要是有 load(url, type) 的物件就可以，這裡包一層延遲 */
const net = { slow: false };
const slowAssets = {
  async load(url: string, type?: string) {
    if (net.slow) await new Promise((r) => setTimeout(r, 300));
    return assets.load(url, type);
  },
};

/** 轉場的設定：這個物件之後還可以改（下一次轉場生效） */
const transitionOptions = {
  ui,
  scenes,
  assets: slowAssets,
  duration: 0.35,
  minLoadingTime: 0.8,
  color: '#000000',
};
const transition = new SceneTransition(transitionOptions).defineAll({
  forest: {
    title: '迷霧森林',
    loading: 'ui/loading-forest.xml',
    assets: ['sounds/hum.wav', 'sounds/pop.wav', 'textures/checker.png'],
    tips: ['森林裡的樹每次都長在[b]同一個位置[/b]：用固定種子的 Random 產生。', '拖曳畫面可以轉動視角。'],
  },
  desert: {
    title: '黃金沙漠',
    loading: 'ui/loading-desert.xml',
    assets: ['sounds/music.wav', 'sounds/bounce.wav', 'ui/coin.png'],
    tips: ['載入頁面至少顯示 minLoadingTime 秒，不會一閃而過。', '打開「模擬慢速網路」看看進度條。'],
  },
  snow: {
    title: '寂靜雪原',
    loading: 'ui/loading-snow.xml',
    assets: ['sounds/jump.wav', 'sounds/hum.wav', 'textures/checker.png'],
    tips: ['淡出的顏色選白色，就像閃光一樣。', '已經下載過的檔案第二次會直接從快取拿。'],
  },
});
scenes.register(forest, desert, snow);

const LEVEL_NAMES: Record<string, string> = { forest: '迷霧森林', desert: '黃金沙漠', snow: '寂靜雪原' };
let level = 'forest';

// 轉場事件：開始、進入；載入進度
const log: string[] = [];
function addLog(text: string): void {
  log.unshift(text);
  log.length = Math.min(log.length, 5);
  ui.require<UILabel>('transitionLog').setText(log.join('\n'));
}
transition.onChange((c) => {
  if (c.type === 'start') addLog(`▶ 開始：${c.from ? LEVEL_NAMES[c.from] : '（無）'} → ${LEVEL_NAMES[c.to]}`);
  else {
    addLog(`✓ 進入：${LEVEL_NAMES[c.to]}`);
    ui.require<UILabel>('levelName').setText(LEVEL_NAMES[c.to]);
  }
});
transition.onProgress((p) => p.loaded > 0 && addLog(`　載入 ${p.item}（${p.loaded}/${p.total}）`));

function goLevel(name: string): void {
  if (transition.busy || currentPage !== 'levels') return;
  level = name;
  void transition.go(name);
}

// ───────── ③ ④ 共用的小鎮與鏡頭控制 ─────────

/** 小鎮：環狀道路、房子、高塔、樹；回傳繞著道路跑的車子 */
function buildTown(w: World): Entity {
  setBackground('#1d2430');
  ground(w, '#2a3324', 14);
  // 環狀道路：甜甜圈壓扁
  spawn.mesh(w, {
    geometry: { torus: [6, 0.7] },
    material: '#4a4a44',
    rotation: [-Math.PI / 2, 0, 0],
    scale: [1, 1, 0.03],
    position: [0, 0.02, 0],
    receiveShadow: true,
  });
  // 房子
  const houses: [number, number, string][] = [
    [3, -1, '#d98c5f'],
    [1, 2.5, '#c9b458'],
    [-2, 2, '#7fa8c9'],
    [9, 3, '#c97f9b'],
    [-8.5, -2, '#d98c5f'],
  ];
  for (const [x, z, color] of houses) {
    spawn.mesh(w, {
      geometry: { box: [1.6, 1.3, 1.6] },
      material: color,
      position: [x, 0.65, z],
      castShadow: true,
      receiveShadow: true,
    });
    spawn.mesh(w, {
      geometry: { cone: [1.3, 0.9, 4] },
      material: '#7a3b2e',
      position: [x, 1.75, z],
      rotation: [0, Math.PI / 4, 0],
      castShadow: true,
    });
  }
  // 高塔
  spawn.mesh(w, { geometry: { cylinder: [0.9, 6] }, material: '#a8a090', position: [-3, 3, -3], castShadow: true });
  spawn.mesh(w, { geometry: { cone: [1.3, 2] }, material: '#4c6aa0', position: [-3, 7, -3], castShadow: true });
  spawn.mesh(w, {
    geometry: { sphere: 0.25 },
    material: { standard: { color: '#ffd166', emissive: '#ffd166' } },
    position: [-3, 8.2, -3],
  });
  // 樹
  const rng = new Random('town');
  for (let i = 0; i < 18; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = rng.range(8, 13);
    tree(w, Math.cos(a) * r, Math.sin(a) * r, rng.range(0.7, 1.2), '#3f7a3a');
  }
  // 車子：根實體在道路上繞圈，底下有車身與車廂
  const cart = w.spawn(Transform.at(6, 0, 0));
  spawn.mesh(w, {
    geometry: { box: [0.9, 0.5, 1.6] },
    material: '#ff6b6b',
    position: [0, 0.4, 0],
    castShadow: true,
    parent: cart,
  });
  spawn.mesh(w, {
    geometry: { box: [0.8, 0.45, 0.8] },
    material: '#e9f6d2',
    position: [0, 0.85, -0.2],
    castShadow: true,
    parent: cart,
  });
  return cart;
}

/** 車子沿著道路繞圈（面向前進方向） */
function driveCart(w: World, cart: Entity, time: number): void {
  const a = time * 0.35;
  const t = w.require(cart, Transform);
  t.position.set(Math.cos(a) * 6, 0, Math.sin(a) * 6);
  math.setRotation(t, [0, -a, 0]);
}

/**
 * 鏡頭與黑幕的狀態：補間這些數值，每幀再套用到攝影機與全螢幕黑幕（ui.screenFader）。
 * 直接切換、平滑移動、淡出淡入都只是改這幾個數字。
 */
const shot = { pos: new Vector3(), look: new Vector3(), fade: { value: 0 }, lookAtCart: false };
let camEntity: Entity | null = null;
const _cartLook = new Vector3();
let following = false;

function applyShot(): void {
  if (camEntity === null || following || !world.isAlive(camEntity)) return;
  const t = world.require(camEntity, Transform);
  t.position.copy(shot.pos);
  // 過場中「看著車子」的那一段：注視點直接用車子的位置
  math.lookAt(
    t,
    shot.lookAtCart && cart !== null ? _cartLook.copy(world.require(cart, Transform).position).setY(0.6) : shot.look,
  );
}

function setFade(value: number): void {
  shot.fade.value = value;
  ui.screenFader?.set(value);
}

/** 停掉鏡頭、黑幕的補間 */
function stopShotTweens(): void {
  tweens.killTweensOf(shot.pos);
  tweens.killTweensOf(shot.look);
  tweens.killTweensOf(shot.fade);
}

// ───────── ③ 鏡頭轉場 ─────────

const VIEWS: Record<string, { name: string; pos: Vec3; look: Vec3 }> = {
  wide: { name: '全景', pos: [7, 11, 16], look: [-1, 0, 0] },
  tower: { name: '塔', pos: [1.5, 5, 4], look: [-3, 6, -3] },
  house: { name: '房子', pos: [6.5, 1.6, 2.8], look: [2.4, 1, -1] },
};
let cart: Entity | null = null;

const cameraPage: Scene = {
  name: 'camera',
  setup(w) {
    cart = buildTown(w);
    camEntity = spawn.camera(w, { fov: 50 });
    following = false;
    shot.pos.set(...VIEWS.wide.pos);
    shot.look.set(...VIEWS.wide.look);
    setFade(0);
    ui.require<UILabel>('viewName').setText(VIEWS.wide.name);
    let time = 0;
    pageUpdate = (dt) => {
      time += dt;
      driveCart(w, cart!, time);
      applyShot();
    };
  },
  teardown() {
    stopShotTweens();
    setFade(0);
    camEntity = null;
  },
};

function goView(key: string): void {
  if (camEntity === null) return;
  const view = VIEWS[key];
  const mode = ui.require<UISelect>('camMode').value;
  const seconds = ui.require<UISlider>('camTime').value;
  stopShotTweens();
  // 從跟隨模式離開：從攝影機現在的位置與注視點開始
  if (following) {
    world.remove(camEntity, CameraFollow);
    following = false;
    const t = world.require(camEntity, Transform);
    shot.pos.copy(t.position);
    shot.look.copy(world.require(cart!, Transform).position).add(new Vector3(0, 0.5, 0));
  }
  ui.require<UILabel>('viewName').setText(view.name);
  const [px, py, pz] = view.pos;
  const [lx, ly, lz] = view.look;
  if (mode === 'cut') {
    shot.pos.set(px, py, pz);
    shot.look.set(lx, ly, lz);
  } else if (mode === 'smooth') {
    const easing = ui.require<UISelect>('camEasing').value as EasingName;
    tweens.to(shot.pos, { x: px, y: py, z: pz }, { duration: seconds, easing });
    tweens.to(shot.look, { x: lx, y: ly, z: lz }, { duration: seconds, easing });
  } else {
    // 淡出 → 黑畫面時換位置 → 淡入
    const half = seconds / 2;
    tweens.to(
      shot.fade,
      { value: 1 },
      {
        duration: half,
        easing: 'quadIn',
        onUpdate: () => setFade(shot.fade.value),
        onComplete: () => {
          shot.pos.set(px, py, pz);
          shot.look.set(lx, ly, lz);
          tweens.to(
            shot.fade,
            { value: 0 },
            { duration: half, easing: 'quadOut', onUpdate: () => setFade(shot.fade.value) },
          );
        },
      },
    );
  }
}

function followCart(): void {
  if (camEntity === null || cart === null || following) return;
  stopShotTweens();
  setFade(0);
  following = true;
  // 跟在車子後上方；smoothTime 讓攝影機從現在的位置慢慢追上去（本身就是平滑的轉場）
  world.add(camEntity, CameraFollow, {
    target: cart,
    offset: new Vector3(0, 2.6, 5),
    offsetSpace: 'target',
    smoothTime: 0.6,
    lookOffset: new Vector3(0, 0.6, 0),
  });
  ui.require<UILabel>('viewName').setText('跟著車子');
}

// ───────── ④ 過場動畫 ─────────

let cutscene: Tween | null = null;
let cutsceneLength = 1;
let cutsceneTime = 0;

const subtitle = (text: string) => ui.require<UILabel>('subtitle').setText(text);
/** 黑邊與字幕只在全黑時切換：介面重新排版的那一幀被黑幕蓋住，看不到跳動 */
function letterbox(on: boolean): void {
  ui.require('barTop').visible = on;
  ui.require('barBottom').visible = on;
}

const cutscenePage: Scene = {
  name: 'cutscene',
  setup(w) {
    cart = buildTown(w);
    camEntity = spawn.camera(w, { fov: 50 });
    following = false;
    shot.pos.set(...VIEWS.wide.pos);
    shot.look.set(...VIEWS.wide.look);
    setFade(0);
    let time = 0;
    pageUpdate = (dt) => {
      time += dt;
      driveCart(w, cart!, time);
      applyShot();
      if (cutscene) {
        cutsceneTime += dt;
        ui.require<UIProgressBar>('cutsceneProgress').value = Math.min(100, (cutsceneTime / cutsceneLength) * 100);
      }
      if (input.wasPressed('Escape')) skipCutscene();
    };
  },
  teardown() {
    cutscene?.stop();
    cutscene = null;
    shot.lookAtCart = false;
    stopShotTweens();
    setFade(0);
    letterbox(false);
    subtitle(' ');
    camEntity = null;
  },
};

function playCutscene(): void {
  if (cutscene || camEntity === null) return;
  stopShotTweens();
  const fadeTo = (value: number, duration: number) =>
    [shot.fade, { value }, { duration, onUpdate: () => setFade(shot.fade.value) }] as const;
  const xyz = ([x, y, z]: Vec3) => ({ x, y, z });
  // 時間軸每一幀會依時間點套用每一段的值：鏡頭位置都要寫成時間軸的步驟（長度 0 = 直接切換），
  // 不要在 call() 裡手動設定，否則會被前面步驟的值蓋掉
  const timeline = tweens
    .timeline()
    // 1. 淡出；黑畫面時放上黑邊、字幕，鏡頭切到高空
    .to(...fadeTo(1, 0.6))
    .call(() => {
      letterbox(true);
      subtitle('很久很久以前，有一個安靜的小鎮……');
    })
    .to(shot.pos, xyz([10, 14, 18]), { duration: 0 })
    .to(shot.look, xyz([0, 0, 0]), { duration: 0, at: '<' })
    .to(...fadeTo(0, 0.8))
    // 2. 鏡頭從高空降下來（和淡入同時開始）
    .to(shot.pos, { x: 5, y: 3.5, z: 9 }, { duration: 3, easing: 'sineInOut', at: '<' })
    .to(shot.look, { x: 0, y: 1, z: 0 }, { duration: 3, easing: 'sineInOut', at: '<' })
    .call(() => subtitle('鎮上的高塔，日夜守護著大家。'))
    // 3. 慢慢靠近高塔
    .to(shot.pos, { x: 0.5, y: 4, z: 3 }, { duration: 2.5, easing: 'quadInOut' })
    .to(shot.look, { x: -3, y: 6.5, z: -3 }, { duration: 2.5, easing: 'quadInOut', at: '<' })
    .wait(0.6)
    // 4. 淡出換場：低角度看著車子經過（這一段的注視點每幀跟著車子）
    .to(...fadeTo(1, 0.5))
    .call(() => {
      subtitle('有一天，一輛紅色的小車開進了鎮上。');
      shot.lookAtCart = true;
    })
    .to(shot.pos, xyz([7.5, 0.8, 4]), { duration: 0 })
    .to(...fadeTo(0, 0.5))
    .to(shot.pos, { x: 8, y: 1.6, z: -3 }, { duration: 3, easing: 'sineInOut' })
    // 5. 淡出，收起黑邊，回到全景，淡入
    .to(...fadeTo(1, 0.7))
    .call(() => {
      shot.lookAtCart = false;
      letterbox(false);
      subtitle(' ');
    })
    .to(shot.pos, xyz(VIEWS.wide.pos), { duration: 0 })
    .to(shot.look, xyz(VIEWS.wide.look), { duration: 0, at: '<' })
    .to(...fadeTo(0, 0.6))
    .call(() => endCutscene());
  cutsceneLength = timeline.duration;
  cutsceneTime = 0;
  cutscene = tweens.play(timeline);
  ui.require<UIButton>('playCutscene').setText('播放中…');
}

/** 過場結束：回到可以再播放的狀態 */
function endCutscene(): void {
  cutscene = null;
  ui.require<UIProgressBar>('cutsceneProgress').value = 100;
  ui.require<UIButton>('playCutscene').setText('播放過場');
}

/** 略過：停掉時間軸，直接收起黑邊、字幕，回到全景 */
function skipCutscene(): void {
  if (!cutscene) return;
  cutscene.stop();
  stopShotTweens();
  shot.lookAtCart = false;
  letterbox(false);
  subtitle(' ');
  shot.pos.set(...VIEWS.wide.pos);
  shot.look.set(...VIEWS.wide.look);
  setFade(0);
  endCutscene();
}

// ───────── ② 介面轉場 ─────────

const screens = new UIScreenManager(ui).register('notice', { url: 'ui/notice.xml' }, { modal: true, title: '公告' });

const screensPage: Scene = {
  name: 'screens',
  setup(w) {
    setBackground('#1d2430');
    ground(w, '#2a3324');
    const knot = spawn.mesh(w, {
      geometry: { torusKnot: [1, 0.3] },
      material: { standard: { color: '#9acd32', roughness: 0.3, metalness: 0.4 } },
      position: [0, 4.6, -4],
      castShadow: true,
    });
    orbitCamera([0, 3, 8], [0, 1.5, 0]);
    pageUpdate = (dt) => math.rotate(w.require(knot, Transform), [dt * 0.4, dt * 0.6, 0]);
  },
};

// ───────── 分頁切換 ─────────

scenes.register(screensPage, cameraPage, cutscenePage);
const LAYERS: Record<string, string> = {
  levels: 'levelsLayer',
  screens: 'screensLayer',
  camera: 'cameraLayer',
  cutscene: 'cutsceneLayer',
};
let currentPage = '';

function showPage(name: string): void {
  if (name === currentPage) return;
  pageUpdate = null;
  currentPage = name;
  for (const [page, layer] of Object.entries(LAYERS)) ui.require(layer).visible = page === name;
  if (name === 'levels') {
    // 關卡頁：用場景轉場進入上次的關卡（淡出 → 載入頁面 → 淡入）
    void transition.go(level);
  } else {
    setBackground(BACKGROUND);
    scenes.load(name);
  }
}

ui.setHandlers({
  page: () => showPage(ui.require<UIStackView>('pages').selectedPage?.id ?? 'levels'),
  // ① 場景轉場
  goForest: () => goLevel('forest'),
  goDesert: () => goLevel('desert'),
  goSnow: () => goLevel('snow'),
  transitionOptions: () => {
    transitionOptions.duration = ui.require<UISlider>('fadeTime').value;
    transitionOptions.minLoadingTime = ui.require<UISlider>('minLoading').value;
    transitionOptions.color = ui.require<UISelect>('fadeColor').value;
    net.slow = ui.require<UIToggle>('slowNet').checked;
  },
  // ② 介面轉場
  cardTransition: (e) => ui.require('cards').set('transition', String(e.value)),
  cardPrev: () => ui.require<UIStackView>('cards').prev(),
  cardNext: () => ui.require<UIStackView>('cards').next(),
  cardChanged: () => audio.play('sounds/pop.wav', { volume: 0.25, pitch: 1.4 }),
  openNotice: () => void screens.open('notice'),
  toast: () => ui.toast('提示訊息會自己淡入、淡出', { icon: 'check', color: '#9acd32' }),
  // ③ 鏡頭轉場
  viewWide: () => goView('wide'),
  viewTower: () => goView('tower'),
  viewHouse: () => goView('house'),
  viewFollow: () => followCart(),
  shake: () => camEntity !== null && shakeCamera(world, camEntity, 0.6),
  // ④ 過場動畫
  playCutscene: () => playCutscene(),
  skipCutscene: () => skipCutscene(),
});

// Esc：關閉最上層的疊加視窗
engine.on('update', () => {
  if (input.wasPressed('Escape') && screens.overlays.length) screens.back();
});

// 效能監視器：按 ` 鍵顯示／隱藏（右邊的介面比較多，一開始先隱藏）
await new PluginManager(engine, { api: { ui2d } }).install(perfMonitor, {
  toggleKey: 'Backquote',
  visible: false,
  position: { bottom: 16, right: 16 },
});

// 第一次進入：SceneTransition 從黑畫面開始，載入完第一關才淡入
showPage('levels');
engine.start();
