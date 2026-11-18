# @engine/animation 的範例

## AnimationPlugin
動畫外掛（手冊的 `animationPlugin` 已經裝好）：補間（`tweens`）、時間軸、模型動畫、動畫狀態機。

```ts
console.log('外掛：', animationPlugin.name, '，依賴：', animationPlugin.dependencies);
console.log('補間：', animationPlugin.tweens === tweens, '，模型動畫控制器：', animationPlugin.animators.constructor.name);
```

## AnimatorController
管理每個實體的 AnimationMixer。`mixerOf` 拿到 three.js 的 mixer，可以直接操作。

```ts
spawn.camera(world, { position: [0, 1, 4], target: [0, 0.5, 0] });
spawn.defaultLights(world);
const root = create.group(create.mesh({ box: [0.2, 1, 0.2], offset: [0, 0.5, 0] }, '#ffa94f', { name: 'arm' }));
const wave = create.clip('wave', {
  'arm.rotation': { times: [0, 0.5, 1], values: [[0, 0, -0.6], [0, 0, 0.6], [0, 0, -0.6]] },
});
const e = world.spawn(Transform, SceneObject.with({ object: root }), Animator.with({ clips: [wave], play: 'wave' }));
engine.start();
engine.timers.after(0.5, () => {
  const mixer = animationPlugin.animators.mixerOf(e);
  console.log('mixer 的時間：', mixer?.time.toFixed(2));
  if (mixer) mixer.timeScale = 3; // 直接讓它變快
});
```

## Timeline
時間軸：把好幾段補間、等待、呼叫排在一起，用 `tweens.play` 播放。`at: '<'` 和上一段同時開始。

```ts
spawn.camera(world, { position: [0, 2, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
const box = spawn.mesh(world, { geometry: { box: 0.8 }, material: '#4cc9f0', position: [-2, 0, 0] });
const t = world.require(box, Transform);
const tl = tweens
  .timeline()
  .to(t.position, { x: 2 }, { duration: 1, easing: 'cubicInOut' })
  .to(t.scale, { y: 2 }, { duration: 0.5, at: '<', easing: 'backOut' })
  .call(() => console.log('到右邊了'))
  .wait(0.3)
  .to(t.position, { x: -2 }, { duration: 1 })
  .to(t.scale, { y: 1 }, { duration: 0.5, at: '<' });
console.log('總長度：', tl.duration.toFixed(2), '秒');
tweens.play(tl, { repeat: Infinity });
engine.start();
```

## Tween
播放中的補間：暫停、繼續、停止，`finished` 在播完時完成。點畫面暫停／繼續。

```ts
spawn.camera(world, { position: [0, 2, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
const ball = spawn.mesh(world, { geometry: { sphere: 0.4 }, material: '#ff6b6b', position: [-3, 0, 0] });
const tw = tweens.to(world.require(ball, Transform).position, { x: 3 }, { duration: 4, easing: 'linear' });
addEventListener('pointerdown', () => {
  if (tw.state === 'playing') tw.pause();
  else tw.resume();
  console.log('狀態：', tw.state);
});
tw.finished.then((done) => console.log('播完了？', done));
engine.start();
```

## TweenManager
補間管理（`tweens`）：`to` 補間到目標值、`fromTo` 指定起點、`delay` 等待、`killTweensOf` 停止某個物件的補間。點畫面讓方塊跳到隨機位置。

```ts
spawn.camera(world, { position: [0, 5, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.grid(world);
const box = spawn.mesh(world, { geometry: { box: 0.6 }, material: '#9acd32', position: [0, 0.3, 0] });
const pos = world.require(box, Transform).position;
addEventListener('pointerdown', () => {
  tweens.killTweensOf(pos);
  tweens.to(pos, { x: Math.random() * 6 - 3, z: Math.random() * 6 - 3 }, { duration: 0.6, easing: 'backOut' });
  tweens.fromTo(pos, { y: 0.3 }, { y: 1.5 }, { duration: 0.3, yoyo: true, repeat: 1 });
});
(async () => {
  await tweens.delay(1);
  console.log('一秒後：正在播放的補間', tweens.count, '個');
})();
engine.start();
```

## AnimationStateMachine
動畫狀態機：依參數與觸發器自動切換動畫（idle → walk → jump）。用 lil-gui 調整速度、按按鈕觸發跳躍。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 1.2, 4], target: [0, 0.6, 0] });
spawn.defaultLights(world);
const body = create.mesh({ capsule: [0.3, 0.6] }, '#4cc9f0', { name: 'body', position: [0, 0.6, 0] });
// 三個時間點：開始、中間、結束（高度 ys、寬度 sx；寬變大時高變小）
const clip = (name: string, len: number, ys: number[], sx: number[]) =>
  create.clip(name, {
    'body.position': { times: [0, len / 2, len], values: ys.map((y) => [0, y, 0]) },
    'body.scale': { times: [0, len / 2, len], values: sx.map((s) => [s, 2 - s, s]) },
  });
const clips = [clip('idle', 2, [0.6, 0.62, 0.6], [1, 1.03, 1]), clip('walk', 0.5, [0.6, 0.7, 0.6], [1, 0.95, 1]), clip('jump', 0.6, [0.6, 1.6, 0.6], [1.1, 0.9, 1])];
const e = world.spawn(Transform, SceneObject.with({ object: create.group(body) }), Animator.with({ clips }));
const sm = world.add(e, AnimationStateMachine, {
  definition: {
    initial: 'idle',
    states: { idle: { clip: 'idle' }, walk: { clip: 'walk' }, jump: { clip: 'jump', loop: false } },
    transitions: [
      { from: '*', to: 'jump', trigger: 'jump', fade: 0.1 },
      { from: 'jump', to: 'idle', onFinish: true },
      { from: 'idle', to: 'walk', when: (p) => Number(p.speed) > 0.1 },
      { from: 'walk', to: 'idle', when: (p) => Number(p.speed) <= 0.1 },
    ],
  },
  params: { speed: 0 },
});
const gui = new GUI();
gui.add(sm.params, 'speed', 0, 1, 0.01).name('速度');
gui.add({ jump: () => play.trigger(sm, 'jump') }, 'jump').name('跳！');
let last: string | null = null;
engine.on('update', () => sm.state !== last && console.log('狀態：', (last = sm.state)));
engine.start();
```

## Animator
模型動畫元件：播放模型（或自訂片段）的動畫。用 lil-gui 切換片段、速度、暫停。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 1, 4], target: [0, 0.5, 0] });
spawn.defaultLights(world);
const cube = create.mesh({ box: 0.6 }, '#ffa94f', { name: 'cube' });
const clips = [
  create.clip('bounce', { 'cube.position': { times: [0, 0.5, 1], values: [[0, 0.3, 0], [0, 1.3, 0], [0, 0.3, 0]] } }),
  create.clip('pulse', { 'cube.scale': { times: [0, 0.3, 0.6], values: [[1, 1, 1], [1.5, 1.5, 1.5], [1, 1, 1]] } }),
];
const e = world.spawn(Transform, SceneObject.with({ object: create.group(cube) }), Animator.with({ clips, play: 'bounce', fade: 0.3 }));
const anim = world.require(e, Animator);
const gui = new GUI();
gui.add(anim, 'play', ['bounce', 'pulse']).name('片段');
gui.add(anim, 'speed', 0, 3, 0.1).name('速度');
gui.add(anim, 'paused').name('暫停');
engine.start();
```

## ANIMATOR_PRIORITY
模型動畫在 lateUpdate 的順序（變換計算是 1000，在它之前）。

```ts
console.log('動畫：', ANIMATOR_PRIORITY, '，狀態機：', STATE_MACHINE_PRIORITY, '（狀態機先決定要播什麼）');
```

## animatorCodec
Animator 在場景檔裡的寫法（自訂片段不能存，用模型附帶的動畫）。

```ts
console.log(animatorCodec.write({ ...Animator.create(), play: 'Run', speed: 1.5, loop: true }));
```

## Easing
常用的緩動曲線：In 慢進、Out 慢出、InOut 兩端慢。這裡讓每顆球用不同的曲線移動。

```ts
spawn.camera(world, { position: [0, 0, 9], target: [0, 0, 0] });
spawn.defaultLights(world);
const names: EasingName[] = ['linear', 'quadOut', 'cubicInOut', 'expoOut', 'backOut', 'elasticOut', 'bounceOut'];
names.forEach((name, i) => {
  const y = 2.4 - i * 0.8;
  const ball = spawn.mesh(world, { geometry: { sphere: 0.25 }, material: `hsl(${i * 50}, 70%, 60%)`, position: [-3, y, 0] });
  tweens.to(world.require(ball, Transform).position, { x: 3 }, { duration: 2, easing: Easing[name], repeat: Infinity, yoyo: true });
});
console.log('由上到下：', names.join('、'));
console.log('quadOut(0.5) =', Easing.quadOut(0.5));
engine.start();
```

## math
`math.easing`：用名稱取得緩動函式（或直接傳函式）。

```ts
const f = math.easing('cubicOut');
console.log([0, 0.25, 0.5, 0.75, 1].map((t) => f(t).toFixed(3)).join(' → '));
```

## play
播放：`play.animation` 播模型動畫，`play.trigger` 觸發狀態機的觸發器。

```ts
spawn.camera(world, { position: [0, 1, 4], target: [0, 0.5, 0] });
spawn.defaultLights(world);
const cube = create.mesh({ box: 0.6 }, '#9acd32', { name: 'cube' });
const spin = create.clip('spin', {
  'cube.rotation': { times: [0, 0.5, 1], values: [[0, 0, 0], [0, Math.PI, 0], [0, Math.PI * 2 - 0.001, 0]] },
});
const e = world.spawn(Transform.at(0, 0.5, 0), SceneObject.with({ object: create.group(cube) }), Animator.with({ clips: [spin] }));
addEventListener('pointerdown', () => {
  play.animation(world.require(e, Animator), 'spin', { loop: false, restart: true, speed: 2 });
  console.log('轉一圈');
});
console.log('點畫面播放');
engine.start();
```

## STATE_MACHINE_PRIORITY
動畫狀態機在 lateUpdate 的順序（在動畫播放之前）。

```ts
console.log('狀態機：', STATE_MACHINE_PRIORITY, '→ 動畫：', ANIMATOR_PRIORITY, '→ 變換：', TRANSFORM_PRIORITY);
```

## tick
`tick.stateMachines`：馬上更新狀態機（平常每幀自動更新）。

```ts
const e = world.spawn(Transform, Animator);
const sm = world.add(e, AnimationStateMachine, {
  definition: { initial: 'idle', states: { idle: { clip: 'idle' }, run: { clip: 'run' } }, transitions: [{ from: 'idle', to: 'run', when: (p) => p.running === true }] },
  params: { running: false },
});
tick.stateMachines(world);
console.log('一開始：', sm.state);
sm.params.running = true;
tick.stateMachines(world);
console.log('running = true 之後：', sm.state, '，Animator 要播：', world.require(e, Animator).play);
```

## TWEEN_PRIORITY
補間在 update 階段的順序（你的系統預設 0，先跑）。

```ts
console.log('補間的順序：', TWEEN_PRIORITY);
```

## TweensKey
系統裡用 `world.requireResource(TweensKey)` 取得補間管理。

```ts
console.log('和 tweens 同一個：', world.requireResource(TweensKey) === tweens);
```

## AnimationStateDef
狀態的設定：播放哪個片段、重複、速度、淡入秒數。

```ts
const run: AnimationStateDef = { clip: 'Run', loop: true, speed: 1.2, fade: 0.2 };
const die: AnimationStateDef = { clip: 'Die', loop: false };
console.log({ run, die });
```

## AnimationStateMachineData
狀態機元件的資料：定義、參數、目前與上一個狀態。

```ts
const e = world.spawn(Transform, Animator);
const sm: AnimationStateMachineData = world.add(e, AnimationStateMachine, {
  definition: { initial: 'a', states: { a: { clip: 'A' }, b: { clip: 'B' } }, transitions: [{ from: 'a', to: 'b', trigger: 'go' }] },
});
tick.stateMachines(world);
play.trigger(sm, 'go');
tick.stateMachines(world);
console.log('目前：', sm.state, '，上一個：', sm.previous);
```

## AnimationStateMachineDef
狀態機的定義：一開始的狀態、所有狀態、轉換（依順序檢查，第一個成立的生效）。

```ts
const def: AnimationStateMachineDef = {
  initial: 'idle',
  states: { idle: { clip: 'Idle' }, attack: { clip: 'Attack', loop: false } },
  transitions: [
    { from: 'idle', to: 'attack', trigger: 'attack' },
    { from: 'attack', to: 'idle', onFinish: true },
  ],
};
console.log('狀態：', Object.keys(def.states), '，轉換：', def.transitions.length, '條');
```

## AnimationTransitionDef
轉換的條件：參數判斷（when）、觸發器（trigger）、播完（onFinish）；`from: '*'` 代表任何狀態。

```ts
const toHurt: AnimationTransitionDef = { from: '*', to: 'hurt', trigger: 'hit', fade: 0.05 };
const toFall: AnimationTransitionDef = { from: 'run', to: 'fall', when: (p) => p.grounded === false };
const e = world.spawn(Transform, Animator);
const sm = world.add(e, AnimationStateMachine, {
  definition: { initial: 'run', states: { run: { clip: 'Run' }, fall: { clip: 'Fall' }, hurt: { clip: 'Hurt' } }, transitions: [toHurt, toFall] },
  params: { grounded: true },
});
tick.stateMachines(world);
sm.params.grounded = false;
tick.stateMachines(world);
console.log('離開地面：', sm.state);
play.trigger(sm, 'hit');
tick.stateMachines(world);
console.log('被打：', sm.state);
```

## AnimatorData
Animator 的資料：要播的片段、重複、速度、淡入淡出；`current`、`time`、`duration`、`finished` 是播放狀態。

```ts
const cube = create.mesh({ box: 1 }, { normal: {} }, { name: 'c' });
const clip = create.clip('grow', { 'c.scale': { times: [0, 1.5], values: [[1, 1, 1], [2, 2, 2]] } });
const e = world.spawn(Transform, SceneObject.with({ object: create.group(cube) }), Animator.with({ clips: [clip], play: 'grow', loop: false }));
engine.timers.every(0.5, () => {
  const a: AnimatorData = world.require(e, Animator);
  console.log(`${a.current} ${a.time.toFixed(2)} / ${a.duration.toFixed(2)} 秒，播完：${a.finished}`);
});
engine.start();
```

## PlayAnimationOptions
`play.animation` 的設定：重複、速度、交叉淡化、從頭播放。

```ts
const anim = world.require(world.spawn(Transform, Animator), Animator);
const options: PlayAnimationOptions = { loop: false, speed: 2, fade: 0.25, restart: true };
play.animation(anim, 'Attack', options);
console.log('要播：', anim.play, '，loop', anim.loop, '，speed', anim.speed, '，fade', anim.fade);
```

## PlayOptions
播放的設定：重複次數、來回、不受時間縮放、綁定實體、每幀與播完的回呼。

```ts
const box = { x: 0 };
const options: PlayOptions = { repeat: 2, yoyo: true, onComplete: () => console.log('播完，x =', box.x.toFixed(2)) };
tweens.to(box, { x: 10 }, { duration: 0.3, ...options, onUpdate: () => engine.time.frame % 6 === 0 && console.log('x =', box.x.toFixed(1)) });
engine.time.timeScale = 0.5;
tweens.to({ y: 0 }, { y: 1 }, { duration: 0.5, unscaled: true, onComplete: () => console.log('unscaled：不受時間縮放') });
engine.start();
```

## StepOptions
時間軸上一段的設定：`at` 指定開始的時間（秒），`'<'` 和上一段同時開始；`delay` 相對於前一段結束。

```ts
const a = { v: 0 };
const b = { v: 0 };
const step: StepOptions = { duration: 1, at: 0.5 };
const tl = tweens.timeline().to(a, { v: 1 }, { duration: 1 }).to(b, { v: 1 }, step).call(() => console.log('全部完成'));
console.log('a 從 0 秒、b 從 0.5 秒開始，總長', tl.duration, '秒');
tweens.play(tl);
engine.start();
```

## TweenOptions
補間的設定：秒數、緩動曲線、延遲。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 2, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
const ball = spawn.mesh(world, { geometry: { sphere: 0.4 }, material: '#ffd166', position: [-2.5, 0, 0] });
const options: TweenOptions = { duration: 1, easing: 'bounceOut', delay: 0.2 };
const pos = world.require(ball, Transform).position;
const run = () => tweens.fromTo(pos, { x: -2.5 }, { x: 2.5 }, options);
const gui = new GUI();
gui.add(options, 'duration', 0.2, 3, 0.1).name('秒數');
gui.add(options, 'easing', Object.keys(Easing)).name('緩動');
gui.add(options, 'delay', 0, 1, 0.1).name('延遲');
gui.add({ run }, 'run').name('播放');
run();
engine.start();
```

## AnimationParams
狀態機的參數：名稱 → 數字或布林。

```ts
const params: AnimationParams = { speed: 0.8, grounded: true };
const isRunning = (p: AnimationParams) => Number(p.speed) > 0.5 && p.grounded === true;
console.log('在跑嗎？', isRunning(params));
```

## EasingFn
緩動函式：輸入 0~1 的進度，輸出套用曲線後的進度。可以自己寫。

```ts
const steps: EasingFn = (t) => Math.floor(t * 4) / 4; // 一格一格跳
spawn.camera(world, { position: [0, 2, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
const box = spawn.mesh(world, { geometry: { box: 0.6 }, material: '#ff6b6b', position: [-2, 0, 0] });
tweens.to(world.require(box, Transform).position, { x: 2 }, { duration: 2, easing: steps, repeat: Infinity, yoyo: true });
console.log([0, 0.3, 0.6, 0.9].map(steps));
engine.start();
```

## EasingName
緩動曲線的名稱。

```ts
const names: EasingName[] = ['sineIn', 'sineOut', 'backInOut'];
for (const n of names) console.log(n, Easing[n](0.25).toFixed(3));
```

## TweenProps
可以補間的欄位：物件裡數字型別的屬性。

```ts
const hero = { hp: 100, name: '勇者', speed: 3 };
const target: TweenProps<typeof hero> = { hp: 40, speed: 1 }; // name 是文字，不能補間
tweens.to(hero, target, { duration: 0.5, onComplete: () => console.log(hero) });
engine.start();
```

## TweenState
補間的狀態：播放中、暫停、播完、被停止。

```ts
const tw = tweens.to({ x: 0 }, { x: 1 }, { duration: 1 });
const states: TweenState[] = [tw.state];
tw.pause();
states.push(tw.state);
tw.stop();
states.push(tw.state);
console.log(states.join(' → '));
```

## create
`create.clip`：用資料建立模型動畫片段（不用 three.js）。鍵是「物件名稱.屬性」：position、scale、rotation（弧度）、visible、材質的數字或顏色。這隻小機器人揮手、點頭、眨眼。

```ts
spawn.camera(world, { position: [0, 1.4, 3.5], target: [0, 0.9, 0] });
spawn.defaultLights(world);
const robot = create.group(
  create.mesh({ box: [0.7, 1, 0.4] }, '#4cc9f0', { name: 'body', position: [0, 0.6, 0] }),
  create.mesh({ box: 0.45 }, '#ffd166', { name: 'head', position: [0, 1.4, 0] }),
  create.mesh({ box: [0.15, 0.6, 0.15], offset: [0, -0.25, 0] }, '#ff6b6b', { name: 'arm', position: [0.45, 1, 0] }),
  create.mesh({ sphere: 0.06 }, { basic: { color: '#000' } }, { name: 'eye', position: [0.1, 1.45, 0.23] }),
);
const hello = create.clip('hello', {
  'arm.rotation': { times: [0, 0.3, 0.6, 0.9, 1.2], values: [[0, 0, 0], [0, 0, 2.4], [0, 0, 1.8], [0, 0, 2.4], [0, 0, 0]], interpolation: 'smooth' },
  'head.rotation': { times: [0, 0.6, 1.2], values: [[0, 0, 0], [0.3, 0, 0], [0, 0, 0]] },
  'eye.visible': { times: [0, 1, 1.1], values: [true, false, true] },
  'body.material.color': { times: [0, 0.6, 1.2], values: ['#4cc9f0', '#9acd32', '#4cc9f0'] },
});
world.spawn(Transform, SceneObject.with({ object: robot }), Animator.with({ clips: [hello], play: 'hello' }));
console.log('片段長度：', hello.duration, '秒，軌道：', hello.tracks.map((t) => t.name));
engine.start();
```

## ClipTrack
`create.clip` 的一條軌道：時間點、每個時間點的值、內插方式（linear 直線、smooth 平滑曲線、step 一格一格跳）。點畫面切換內插方式比較。

```ts
spawn.camera(world, { position: [0, 1, 4], target: [0, 0.5, 0] });
spawn.defaultLights(world);
const ball = create.mesh({ sphere: 0.3 }, '#ffd166', { name: 'ball' });
const make = (interpolation: ClipTrack['interpolation']) => {
  const track: ClipTrack = { times: [0, 0.5, 1, 1.5, 2], values: [[-1.5, 0, 0], [-0.5, 1, 0], [0.5, 0, 0], [1.5, 1, 0], [-1.5, 0, 0]], interpolation };
  return create.clip(interpolation ?? 'linear', { 'ball.position': track });
};
const clips = [make('linear'), make('smooth'), make('step')];
const e = world.spawn(Transform, SceneObject.with({ object: create.group(ball) }), Animator.with({ clips, play: 'linear' }));
let i = 0;
addEventListener('pointerdown', () => {
  world.require(e, Animator).play = clips[++i % 3].name;
  console.log('內插：', clips[i % 3].name);
});
console.log('點畫面切換 linear／smooth／step');
engine.start();
```

## AnimationClip
模型動畫片段（three.js 的型別）：`create.clip` 建立，或 `Model` 載入的模型附帶（`model.animations`），交給 `Animator` 的 `clips` 播放。

```ts
const gltf = await assets.load('models/robot.gltf', 'gltf');
const fromModel: AnimationClip[] = gltf.animations;
const mine: AnimationClip = create.clip('nod', { 'Head.rotation': { times: [0, 0.5, 1], values: [[0, 0, 0], [0.4, 0, 0], [0, 0, 0]] } });
console.log('模型的片段：', fromModel.map((c) => `${c.name}（${c.duration} 秒）`));
console.log('自己做的：', mine.name, mine.duration, '秒');
spawn.camera(world, { position: [2, 2, 4], target: [0, 0.8, 0] });
spawn.defaultLights(world);
world.spawn(Transform, Model.with({ url: 'models/robot.gltf' }), Animator.with({ clips: [...fromModel, mine], play: 'nod' }));
engine.start();
```
