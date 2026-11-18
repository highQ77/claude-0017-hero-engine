/**
 * official-demo-001-animation：動畫介紹。
 *
 * 四個分頁，每一頁是一個場景（切換分頁時換場景）：
 *   ① 補間（tween）：七種緩動曲線同時比較；補間大小與顏色
 *   ② 時間軸（timeline）：好幾段動作排在一起，可以暫停、跳到終點、改時間縮放
 *   ③ 模型動畫（clip）：程式組的機器人（create.clip 寫動作）與 glTF 模型檔的動畫
 *   ④ 動畫狀態機（fsm）：用速度參數、跳躍觸發自動切換 idle／walk／run／jump
 *
 * 介面在 public/ui/scene.xml（左邊的說明面板）；這裡是每一頁的 3D 內容與按鈕的處理函式。
 */
import {
  Animator,
  AnimationStateMachine,
  type AnimationClip,
  type AnimationStateMachineData,
  type AnimatorData,
  type EasingName,
  type Tween,
  create,
  play,
} from '@engine';
import { Model } from '@engine/assets';
import { type Entity, NULL_ENTITY } from '@engine/ecs';
import { OrbitControl, SceneObject, spawn } from '@engine/render';
import { type Scene, Transform, math } from '@engine/scene';
import type { UIButton, UILabel, UIProgressBar, UISelect, UISlider, UIStackView, UIToggle } from '@engine/ui2d';
import { Vector3 } from '@engine/math';
import { PluginManager } from '@engine/plugins';
import perfMonitor from '@engine/packages/perf-monitor';
import * as ui2d from '@engine/ui2d';
import { engine, input, scenes, tweens, ui, world } from './engine';

// ───────── 共用：舞台（燈光、地面）、每頁的攝影機 ─────────

for (const e of Object.values(spawn.defaultLights(world, { shadows: true }))) scenes.persist(e);
scenes.persist(
  spawn.mesh(world, {
    geometry: { circle: 9 },
    material: '#262c22',
    rotation: [-Math.PI / 2, 0, 0],
    receiveShadow: true,
  }),
);
scenes.persist(spawn.grid(world, { size: 18, divisions: 18, color: '#343c2e', position: [0, 0.01, 0] }));

/** 這一頁的攝影機（可以用滑鼠轉動；換頁時跟著場景移除） */
function camera(position: [number, number, number], target: [number, number, number]): Entity {
  const cam = spawn.camera(world, { position, target, fov: 50 });
  world.add(cam, OrbitControl, {
    target: new Vector3(...target),
    minDistance: 3,
    maxDistance: 20,
    wheelNeedsFocus: true,
  });
  return cam;
}

/** 每幀要做的事（只在目前這一頁執行；換頁時清掉） */
let pageUpdate: ((dt: number) => void) | null = null;
engine.on('update', (time) => pageUpdate?.(time.delta));

// ───────── 程式組的機器人（③、④ 共用） ─────────

/**
 * 機器人：rig（整個身體，跳躍、旋轉用）底下有 body、head、visor（臉）、armL／armR、legL／legR。
 * 手腳的旋轉中心在肩膀、髖部（幾何往下 offset），動畫片段用這些名稱指定要動哪個零件。
 */
function makeRobot(color: string) {
  const limb = (name: string, size: [number, number, number], position: [number, number, number], c: string) =>
    create.mesh({ box: size, offset: [0, -size[1] / 2, 0] }, c, { name, position, castShadow: true });
  const rig = create.group(
    { name: 'rig' },
    create.mesh({ box: [0.62, 0.72, 0.36] }, color, { name: 'body', position: [0, 1.02, 0], castShadow: true }),
    create.mesh({ box: [0.42, 0.38, 0.38] }, '#e9f6d2', { name: 'head', position: [0, 1.62, 0], castShadow: true }),
    create.mesh(
      { box: [0.3, 0.1, 0.05] },
      { basic: { color: '#4cc9f0' } },
      { name: 'visor', position: [0, 1.65, 0.2] },
    ),
    limb('armL', [0.16, 0.62, 0.16], [-0.42, 1.34, 0], color),
    limb('armR', [0.16, 0.62, 0.16], [0.42, 1.34, 0], color),
    limb('legL', [0.2, 0.64, 0.2], [-0.16, 0.66, 0], '#3a4232'),
    limb('legR', [0.2, 0.64, 0.2], [0.16, 0.66, 0], '#3a4232'),
  );
  return create.group({ name: 'robot' }, rig);
}

/** 機器人的動作片段：鍵是「零件名稱.屬性」，rotation 是弧度 [x, y, z] */
const swing = (a: number) => [
  [a, 0, 0],
  [-a, 0, 0],
  [a, 0, 0],
];
const clips: Record<string, AnimationClip> = {
  idle: create.clip('idle', {
    'head.position': {
      times: [0, 1, 2],
      values: [
        [0, 1.62, 0],
        [0, 1.65, 0],
        [0, 1.62, 0],
      ],
      interpolation: 'smooth',
    },
    'body.scale': {
      times: [0, 1, 2],
      values: [
        [1, 1, 1],
        [1.03, 1.02, 1.03],
        [1, 1, 1],
      ],
      interpolation: 'smooth',
    },
    'armL.rotation': {
      times: [0, 1, 2],
      values: [
        [0, 0, -0.08],
        [0, 0, -0.14],
        [0, 0, -0.08],
      ],
    },
    'armR.rotation': {
      times: [0, 1, 2],
      values: [
        [0, 0, 0.08],
        [0, 0, 0.14],
        [0, 0, 0.08],
      ],
    },
  }),
  walk: create.clip('walk', {
    'legL.rotation': { times: [0, 0.5, 1], values: swing(0.5) },
    'legR.rotation': { times: [0, 0.5, 1], values: swing(-0.5) },
    'armL.rotation': { times: [0, 0.5, 1], values: swing(-0.4) },
    'armR.rotation': { times: [0, 0.5, 1], values: swing(0.4) },
    'rig.position': {
      times: [0, 0.25, 0.5, 0.75, 1],
      values: [
        [0, 0, 0],
        [0, 0.04, 0],
        [0, 0, 0],
        [0, 0.04, 0],
        [0, 0, 0],
      ],
    },
  }),
  run: create.clip('run', {
    'legL.rotation': { times: [0, 0.3, 0.6], values: swing(1) },
    'legR.rotation': { times: [0, 0.3, 0.6], values: swing(-1) },
    'armL.rotation': { times: [0, 0.3, 0.6], values: swing(-1.1) },
    'armR.rotation': { times: [0, 0.3, 0.6], values: swing(1.1) },
    'rig.rotation': {
      times: [0, 0.6],
      values: [
        [0.18, 0, 0],
        [0.18, 0, 0],
      ],
    },
    'rig.position': {
      times: [0, 0.15, 0.3, 0.45, 0.6],
      values: [
        [0, 0, 0],
        [0, 0.1, 0],
        [0, 0, 0],
        [0, 0.1, 0],
        [0, 0, 0],
      ],
    },
  }),
  jump: create.clip('jump', {
    'rig.position': {
      times: [0, 0.12, 0.42, 0.7],
      values: [
        [0, 0, 0],
        [0, -0.08, 0],
        [0, 1.1, 0],
        [0, 0, 0],
      ],
      interpolation: 'smooth',
    },
    'legL.rotation': {
      times: [0, 0.2, 0.5, 0.7],
      values: [
        [0, 0, 0],
        [-0.7, 0, 0],
        [-0.4, 0, 0],
        [0, 0, 0],
      ],
    },
    'legR.rotation': {
      times: [0, 0.2, 0.5, 0.7],
      values: [
        [0, 0, 0],
        [-0.7, 0, 0],
        [-0.4, 0, 0],
        [0, 0, 0],
      ],
    },
    'armL.rotation': {
      times: [0, 0.3, 0.7],
      values: [
        [0, 0, 0],
        [0, 0, -2.6],
        [0, 0, 0],
      ],
    },
    'armR.rotation': {
      times: [0, 0.3, 0.7],
      values: [
        [0, 0, 0],
        [0, 0, 2.6],
        [0, 0, 0],
      ],
    },
  }),
  wave: create.clip('wave', {
    'armR.rotation': {
      times: [0, 0.3, 0.6, 0.9, 1.2, 1.6],
      values: [
        [0, 0, 0.1],
        [0, 0, 2.6],
        [0, 0, 2.1],
        [0, 0, 2.6],
        [0, 0, 2.1],
        [0, 0, 0.1],
      ],
      interpolation: 'smooth',
    },
    'head.rotation': {
      times: [0, 0.8, 1.6],
      values: [
        [0, 0, 0],
        [0, 0, -0.2],
        [0, 0, 0],
      ],
      interpolation: 'smooth',
    },
  }),
  dance: create.clip('dance', {
    'rig.rotation': {
      times: [0, 0.4, 0.8, 1.2, 1.6],
      values: [
        [0, 0, 0],
        [0, Math.PI / 2, 0],
        [0, Math.PI, 0],
        [0, Math.PI * 1.5, 0],
        [0, Math.PI * 2 - 0.001, 0],
      ],
    },
    'rig.position': {
      times: [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6],
      values: Array.from({ length: 9 }, (_, i) => [0, i % 2 ? 0.15 : 0, 0]),
    },
    'armL.rotation': {
      times: [0, 0.4, 0.8, 1.2, 1.6],
      values: [
        [0, 0, -2.8],
        [0, 0, -0.4],
        [0, 0, -2.8],
        [0, 0, -0.4],
        [0, 0, -2.8],
      ],
    },
    'armR.rotation': {
      times: [0, 0.4, 0.8, 1.2, 1.6],
      values: [
        [0, 0, 0.4],
        [0, 0, 2.8],
        [0, 0, 0.4],
        [0, 0, 2.8],
        [0, 0, 0.4],
      ],
    },
    'visor.material.color': {
      times: [0, 0.4, 0.8, 1.2, 1.6],
      values: ['#4cc9f0', '#ff6b6b', '#ffd166', '#9acd32', '#4cc9f0'],
    },
  }),
};

// ───────── ① 補間 ─────────

const EASINGS: { name: EasingName; note: string; color: string }[] = [
  { name: 'linear', note: '等速', color: '#e9f6d2' },
  { name: 'quadOut', note: '慢慢停下', color: '#9acd32' },
  { name: 'cubicInOut', note: '兩端慢、中間快', color: '#4cc9f0' },
  { name: 'expoOut', note: '衝出去再急停', color: '#6aa8ff' },
  { name: 'backOut', note: '超過一點再回來', color: '#b072ff' },
  { name: 'elasticOut', note: '像彈簧', color: '#ff6b9a' },
  { name: 'bounceOut', note: '像球落地彈跳', color: '#ffb347' },
];
ui.setItems('easings', EASINGS);

let replayTweens: () => void = () => {};

const tweenPage: Scene = {
  name: 'tween',
  setup(w) {
    camera([0, 6, 9], [0.8, 0, 0]);
    const balls = EASINGS.map(({ color }, i) => {
      const z = (i - 3) * 0.9;
      // 軌道：起點到終點的細長條
      spawn.mesh(w, { geometry: { box: [6, 0.04, 0.06] }, material: '#3a4232', position: [0, 0.02, z] });
      return spawn.mesh(w, {
        geometry: { sphere: 0.22 },
        material: { standard: { color, roughness: 0.35 } },
        position: [-3, 0.22, z],
        castShadow: true,
      });
    });
    // 補間任何數字：大小與顏色
    const cubeMat = create.material({ standard: { color: '#9acd32', roughness: 0.4 } });
    const cube = spawn.mesh(w, { geometry: { box: 1 }, material: cubeMat, position: [5, 0.5, 0], castShadow: true });

    replayTweens = () => {
      const duration = ui.require<UISlider>('duration').value;
      const yoyo = ui.require<UIToggle>('yoyo').checked;
      const loop = yoyo ? { repeat: Infinity, yoyo: true } : {};
      balls.forEach((ball, i) => {
        const pos = w.require(ball, Transform).position;
        tweens.killTweensOf(pos);
        pos.x = -3;
        tweens.to(pos, { x: 3 }, { duration, easing: EASINGS[i].name, entity: ball, ...loop });
      });
      const scale = w.require(cube, Transform).scale;
      tweens.killTweensOf(scale);
      tweens.killTweensOf(cubeMat.color);
      scale.setScalar(1);
      cubeMat.color.set('#9acd32');
      tweens.to(scale, { x: 1.6, y: 0.6, z: 1.6 }, { duration, easing: 'elasticOut', entity: cube, ...loop });
      tweens.to(cubeMat.color, { r: 1, g: 0.42, b: 0.42 }, { duration, easing: 'sineInOut', entity: cube, ...loop });
    };
    replayTweens();
  },
};

// ───────── ② 時間軸 ─────────

const STEPS = [
  '① 往右滑（cubicInOut）',
  "② 跳起來，同時轉一圈（at: '<'）",
  '③ 變成紅色',
  '④ 等 0.5 秒（wait）',
  '⑤ 放大（backOut）',
  '⑥ 回到起點、恢復原狀',
];
ui.setItems(
  'steps',
  STEPS.map((text, index) => ({ text, index })),
);

/** 時間軸頁的狀態（換頁時重設） */
const tl = { current: null as Tween | null, elapsed: 0, duration: 1, play: () => {} };

function markStep(index: number): void {
  STEPS.forEach((_, i) => {
    const label = ui.get<UILabel>(`step${i}`);
    label?.set('background', i === index ? 'rgba(154,205,50,0.28)' : 'rgba(255,255,255,0.04)');
    label?.set('color', i === index ? '#ffffff' : '#e9f6d2');
  });
}

const timelinePage: Scene = {
  name: 'timeline',
  setup(w) {
    camera([0, 4, 8], [0, 0.8, 0]);
    const mat = create.material({ standard: { color: '#4cc9f0', roughness: 0.35 } });
    const box = spawn.mesh(w, { geometry: { box: 0.8 }, material: mat, position: [-3, 0.4, 0], castShadow: true });
    const t = w.require(box, Transform);
    // 旋轉、大小、顏色都放在一個物件裡補間，每幀再套用到方塊上
    const look = { spin: 0, scale: 1, r: mat.color.r, g: mat.color.g, b: mat.color.b };
    const start = { ...look };
    pageUpdate = (dt) => {
      math.setRotation(t, [0, look.spin, 0]);
      t.scale.setScalar(look.scale);
      mat.color.setRGB(look.r, look.g, look.b);
      if (tl.current?.state === 'playing') tl.elapsed += dt;
      // 用 .value 而不是 set('value', …)：數值沒變時什麼都不做，有變時只重畫進度條本身；
      // set() 會重新排版、整張介面重畫，每幀呼叫會讓 FPS 掉一半
      const bar = ui.get<UIProgressBar>('tlProgress');
      if (bar) bar.value = Math.min(100, (tl.elapsed / tl.duration) * 100);
    };

    tl.play = () => {
      tl.current?.stop();
      t.position.set(-3, 0.4, 0);
      Object.assign(look, start);
      const timeline = tweens
        .timeline()
        .call(() => markStep(0))
        .to(t.position, { x: 1.5 }, { duration: 1.2, easing: 'cubicInOut' })
        .call(() => markStep(1))
        .fromTo(look, { spin: 0 }, { spin: Math.PI * 2 }, { duration: 0.9, easing: 'quadInOut' })
        .to(t.position, { y: 2 }, { duration: 0.45, easing: 'quadOut', at: '<' })
        .to(t.position, { y: 0.4 }, { duration: 0.45, easing: 'quadIn' })
        .call(() => markStep(2))
        .to(look, { r: 1, g: 0.35, b: 0.35 }, { duration: 0.5 })
        .call(() => markStep(3))
        .wait(0.5)
        .call(() => markStep(4))
        .to(look, { scale: 1.6 }, { duration: 0.6, easing: 'backOut' })
        .call(() => markStep(5))
        .to(t.position, { x: -3 }, { duration: 1.2, easing: 'cubicInOut' })
        .to(look, { ...start, spin: Math.PI * 2 }, { duration: 1.2, at: '<' })
        .call(() => markStep(-1));
      tl.duration = timeline.duration;
      tl.elapsed = 0;
      tl.current = tweens.play(timeline, { entity: box });
      ui.get<UIButton>('tlPause')?.setText('暫停');
    };
    tl.play();
  },
  teardown() {
    tl.current?.stop();
    tl.current = null;
    engine.time.timeScale = 1;
    markStep(-1);
  },
};

// ───────── ③ 模型動畫 ─────────

/** 模型動畫頁的兩個機器人（程式做的、模型檔） */
const clipPage = { built: NULL_ENTITY, model: NULL_ENTITY };
const animators = (): AnimatorData[] =>
  [clipPage.built, clipPage.model].filter((e) => world.isAlive(e)).map((e) => world.require(e, Animator));

const modelPage: Scene = {
  name: 'clip',
  setup(w) {
    camera([0, 2.2, 5.5], [0, 1, 0]);
    const ui_ = {
      clip: ui.require<UISelect>('clipName').value,
      model: ui.require<UISelect>('modelClip').value,
      speed: ui.require<UISlider>('clipSpeed').value,
      fade: ui.require<UISlider>('clipFade').value,
      paused: ui.require<UIToggle>('clipPaused').checked,
    };
    const common = { speed: ui_.speed, fade: ui_.fade, paused: ui_.paused };
    clipPage.built = w.spawn(
      Transform.at(-1.3, 0, 0),
      SceneObject.with({ object: makeRobot('#9acd32') }),
      Animator.with({ clips: [clips.idle, clips.wave, clips.dance, clips.walk], play: ui_.clip, ...common }),
    );
    clipPage.model = w.spawn(
      Transform.at(1.3, 0, 0),
      Model.with({ url: 'models/robot.gltf', castShadow: true }),
      Animator.with({ play: ui_.model, ...common }),
    );
    const info = ui.require<UILabel>('clipInfo');
    pageUpdate = () => {
      const [a, b] = animators();
      const line = (name: string, x?: AnimatorData) =>
        x?.current ? `${name}：${x.current}　${x.time.toFixed(2)} / ${x.duration.toFixed(2)} 秒` : `${name}：載入中…`;
      info.setText(`${line('程式做的', a)}\n${line('模型檔', b)}`);
    };
  },
};

// ───────── ④ 動畫狀態機 ─────────

const RULES = ['*>jump', 'jump>idle', 'idle>walk', 'walk>run', 'run>walk', 'walk>idle'];
let sm: AnimationStateMachineData | null = null;

const fsmPage: Scene = {
  name: 'fsm',
  setup(w) {
    camera([0, 5, 8], [0, 0.8, 0]);
    const robot = w.spawn(
      Transform.at(3, 0, 0),
      SceneObject.with({ object: makeRobot('#ffb347') }),
      Animator.with({ clips: [clips.idle, clips.walk, clips.run, clips.jump] }),
    );
    sm = w.add(robot, AnimationStateMachine, {
      definition: {
        initial: 'idle',
        states: {
          idle: { clip: 'idle', fade: 0.3 },
          walk: { clip: 'walk', fade: 0.25 },
          run: { clip: 'run', fade: 0.2 },
          jump: { clip: 'jump', loop: false, fade: 0.08 },
        },
        transitions: [
          { from: '*', to: 'jump', trigger: 'jump' },
          { from: 'jump', to: 'idle', onFinish: true },
          { from: 'idle', to: 'walk', when: (p) => Number(p.speed) > 0.05 },
          { from: 'walk', to: 'run', when: (p) => Number(p.speed) > 0.6 },
          { from: 'run', to: 'walk', when: (p) => Number(p.speed) <= 0.6 },
          { from: 'walk', to: 'idle', when: (p) => Number(p.speed) <= 0.05 },
        ],
      },
      params: { speed: ui.require<UISlider>('speed').value },
    });
    // 繞著圓圈走：速度越快走越快，面向前進的方向
    let angle = 0;
    let shown: string | null = null;
    const t = w.require(robot, Transform);
    pageUpdate = (dt) => {
      if (!sm) return;
      if (input.wasPressed('Space')) play.trigger(sm, 'jump');
      const speed = Number(sm.params.speed);
      angle += dt * speed * 1.4;
      t.position.set(Math.cos(angle) * 3, 0, Math.sin(angle) * 3);
      math.setRotation(t, [0, Math.atan2(-Math.sin(angle), Math.cos(angle)), 0]);
      if (sm.state !== shown) {
        const key = sm.state === 'jump' ? '*>jump' : `${sm.previous}>${sm.state}`;
        RULES.forEach((rule, i) => ui.get<UILabel>(`rule${i}`)?.set('color', rule === key ? '#ffd166' : '#e9f6d2'));
        ui.require<UILabel>('state').setText(sm.state ?? '-');
        ui.require<UILabel>('stateFrom').setText(sm.previous ? `從 ${sm.previous} 切換過來` : ' ');
        shown = sm.state;
      }
    };
  },
  teardown() {
    sm = null;
  },
};

// ───────── 分頁切換 ─────────

scenes.register(tweenPage, timelinePage, modelPage, fsmPage);
let currentPage = '';
function showPage(name: string): void {
  if (name === currentPage) return;
  if (currentPage) scenes.unload(currentPage);
  pageUpdate = null;
  currentPage = name;
  scenes.load(name, { additive: true });
}

ui.setHandlers({
  page: () => showPage(ui.require<UIStackView>('pages').selectedPage?.id ?? 'tween'),
  // ① 補間
  tweenReplay: () => replayTweens(),
  // ② 時間軸
  tlPlay: () => tl.play(),
  tlPause: () => {
    const c = tl.current;
    if (!c?.active) return;
    if (c.state === 'paused') c.resume();
    else c.pause();
    ui.require<UIButton>('tlPause').setText(c.state === 'paused' ? '繼續' : '暫停');
  },
  tlEnd: () => tl.current?.stop(true),
  timeScale: (e) => (engine.time.timeScale = Number(e.value)),
  // ③ 模型動畫
  clipPlay: (e) => world.isAlive(clipPage.built) && (world.require(clipPage.built, Animator).play = String(e.value)),
  modelPlay: (e) => world.isAlive(clipPage.model) && (world.require(clipPage.model, Animator).play = String(e.value)),
  clipSpeed: (e) => animators().forEach((a) => (a.speed = Number(e.value))),
  clipFade: (e) => animators().forEach((a) => (a.fade = Number(e.value))),
  clipPause: (e) => animators().forEach((a) => (a.paused = (e.target as UIToggle).checked)),
  // ④ 狀態機
  speed: (e) => sm && (sm.params.speed = Number(e.value)),
  jump: () => sm && play.trigger(sm, 'jump'),
});

// 效能監視器（FPS、每幀時間、各階段 CPU、GPU 繪製統計）：按 ` 鍵顯示／隱藏，可以拖到畫面任何地方
// 套件只用到 ui2d 模組，所以只提供這一個（打包時不會多包其他模組）
await new PluginManager(engine, { api: { ui2d } }).install(perfMonitor, { toggleKey: 'Backquote' });

showPage('tween');
engine.start();
