# @engine/ai 的範例

## AIPlugin
AI 外掛（`ai`）：行為樹大腦、導航網格找路、轉向移動。`ai.navGrid` 設定導航網格後，PathFollower 就能找路。點地面讓角色走過去（會繞過牆）。

```ts
spawn.camera(world, { position: [0, 12, 8], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { plane: 16 }, material: '#555555', rotation: [-Math.PI / 2, 0, 0], name: 'ground' });
const grid = new NavGrid({ min: { x: -8, z: -8 }, max: { x: 8, z: 8 }, cellSize: 0.5 });
for (const [x, z, w, d] of [[-2, -4, 0.5, 8], [3, 2, 6, 0.5]]) {
  spawn.mesh(world, { geometry: { box: [w, 1, d] }, material: '#888888', position: [x, 0.5, z] });
  grid.setArea(x - w / 2, z - d / 2, x + w / 2, z + d / 2, false);
}
grid.inflate(1);
ai.navGrid = grid;
const npc = spawn.mesh(world, { geometry: { capsule: [0.3, 0.6] }, material: '#4cc9f0', position: [-6, 0.6, 0] });
world.add(npc, SteeringAgent, { maxSpeed: 3 });
const follower = world.add(npc, PathFollower);
render.renderer.domElement.addEventListener('pointerdown', (ev) => {
  const r = render.renderer.domElement.getBoundingClientRect();
  const hit = render.pick(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  if (hit) follower.destination = { x: hit.point.x, y: 0.6, z: hit.point.z };
});
engine.on('update', () => follower.path.length && render.debug.path(follower.path, { color: '#ffd166' }));
engine.timers.every(1, () => console.log('找路狀態：', follower.status));
follower.destination = { x: 6, y: 0.6, z: 5 };
engine.start();
```

## BehaviorTree
行為樹：用節點組合出 AI 的決策。這隻守衛看到玩家（紅球）就追、看不到就巡邏。每個實體要有自己的一棵樹，所以用函式建立。

```ts
spawn.camera(world, { position: [0, 12, 9], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.grid(world, { size: 16, divisions: 16 });
const player = spawn.mesh(world, { geometry: { sphere: 0.4 }, material: '#ff6b6b', position: [5, 0.4, 0] });
const guard = spawn.mesh(world, { geometry: { cone: [0.4, 1], rotation: [-Math.PI / 2, 0, 0] }, material: '#4cc9f0' });
const agent = world.add(guard, SteeringAgent, { maxSpeed: 2.5 });
type Mem = { patrol: number };
const points = [{ x: -4, y: 0.5, z: -4 }, { x: 4, y: 0.5, z: -4 }, { x: 4, y: 0.5, z: 4 }, { x: -4, y: 0.5, z: 4 }];
const makeTree = () =>
  new BehaviorTree<Mem>(
    BT.selector(
      BT.sequence(
        BT.condition(() => sense.canSee(world, guard, player, { range: 6, fov: 120, occlusion: false }), '看得到玩家'),
        BT.action(() => {
          agent.mode = 'pursue';
          agent.targetEntity = player;
          return 'running';
        }, '追擊'),
      ),
      BT.action((ctx) => {
        agent.mode = 'arrive';
        agent.targetEntity = null;
        agent.target = points[ctx.blackboard.patrol % points.length];
        if (agent.arrived) ctx.blackboard.patrol++;
        return 'running';
      }, '巡邏'),
    ),
  );
world.add(guard, Brain, { tree: makeTree() as BehaviorTree<object>, blackboard: { patrol: 0 } });
engine.on('update', (t) => world.require(player, Transform).position.set(Math.cos(t.elapsed * 0.4) * 6, 0.4, Math.sin(t.elapsed * 0.7) * 5));
engine.timers.every(1, () => console.log('守衛：', world.require(guard, Brain).tree?.activePath.join(' > ')));
engine.start();
```

## BTNode
行為樹節點的基礎類別：繼承它、實作 `run` 和 `children`，就能做自己的節點。這裡做一個「隨機成功或失敗」的節點。

```ts
class Coin extends BTNode {
  constructor(private chance = 0.5) {
    super('擲硬幣');
  }
  protected run(): BTStatus {
    return Math.random() < this.chance ? 'success' : 'failure';
  }
  get children() {
    return [];
  }
}
const tree = new BehaviorTree(BT.selector(BT.sequence(new Coin(0.3), BT.action(() => console.log('正面！'))), BT.action(() => console.log('反面'))));
for (let i = 0; i < 5; i++) tree.tick({ world, entity: NULL_ENTITY, dt: 0.016, blackboard: {} });
```

## NavGrid
導航網格（格子版）：標記哪些格子能走，用 A* 找路。`createDebugMesh` 把擋住的格子畫出來。

```ts
spawn.camera(world, { position: [0, 14, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
const grid = new NavGrid({ min: { x: -6, z: -6 }, max: { x: 6, z: 6 }, cellSize: 0.5 });
grid.setArea(-1, -6, 0, 3, false);
grid.setArea(2, -2, 3, 6, false);
world.spawn(Transform, SceneObject.with({ object: grid.createDebugMesh() }));
const path = grid.findPath({ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
engine.on('update', () => path && render.debug.path(path, { color: '#9acd32' }));
console.log('格子：', grid.cols, 'x', grid.rows, '，路徑點：', path?.length, '，直線可走嗎？', grid.lineOfSight({ x: -5, z: 0 }, { x: 5, z: 0 }));
engine.start();
```

## Parallel
同時執行所有子節點：`all` 全部成功才成功，`one` 任一成功就成功（例如「邊跑邊射擊」）。

```ts
let shots = 0;
let steps = 0;
const tree = new BehaviorTree(
  new Parallel('跑＋射擊', 'all', [
    BT.action(() => (++steps < 3 ? 'running' : 'success'), '跑'),
    BT.action(() => (++shots < 5 ? 'running' : 'success'), '射擊'),
  ]),
);
let status: BTStatus = 'running';
for (let f = 1; status === 'running'; f++) {
  status = tree.tick({ world, entity: NULL_ENTITY, dt: 0.1, blackboard: {} });
  console.log(`第 ${f} 次：${status}（跑 ${steps}、射擊 ${shots}）`);
}
```

## Selector
依優先順序選擇：第一個不失敗的生效（「能攻擊就攻擊，不行就靠近，再不行就待命」）。

```ts
const bb = { distance: 5 };
const tree = new BehaviorTree(
  new Selector('決策', [
    BT.sequence(BT.condition<typeof bb>((c) => c.blackboard.distance < 1), BT.action(() => console.log('  攻擊'), '攻擊')),
    BT.sequence(BT.condition<typeof bb>((c) => c.blackboard.distance < 6), BT.action(() => console.log('  靠近'), '靠近')),
    BT.action(() => console.log('  待命'), '待命'),
  ]),
);
for (const d of [8, 4, 0.5]) {
  bb.distance = d;
  console.log('距離', d, '：');
  tree.tick({ world, entity: NULL_ENTITY, dt: 0.016, blackboard: bb });
}
```

## Sequence
依序執行：全部成功才成功，遇到失敗就停。會記得做到哪一步，下一幀從那裡繼續。

```ts
const tree = new BehaviorTree(
  new Sequence('開門', [
    BT.action(() => console.log('走到門前'), '走過去'),
    BT.wait(0.2),
    BT.action(() => console.log('拿鑰匙開門'), '開門'),
  ]),
);
let t = 0;
let status: BTStatus = 'running';
while (status === 'running') {
  status = tree.tick({ world, entity: NULL_ENTITY, dt: 0.1, blackboard: {} });
  t += 0.1;
}
console.log('完成：', status, '，花了', t.toFixed(1), '秒');
```

## StateMachine
有限狀態機：適合狀態清楚的行為（門、陷阱）。這個陷阱「待機 → 警告閃爍 → 攻擊 → 冷卻」循環。

```ts
spawn.camera(world, { position: [0, 3, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const trap = spawn.mesh(world, { geometry: { cone: [0.5, 1] }, material: '#888888', position: [0, -0.3, 0] });
const mesh = () => world.require(trap, MeshRenderer);
const fsm: StateMachine<{ trap: Entity }> = new StateMachine({ trap }, 'idle', {
  idle: { enter: () => (mesh().material = '#888888'), update: (_c, _dt) => (fsm.timeInState > 1.5 ? 'warn' : undefined) },
  warn: { update: () => ((mesh().material = Math.floor(fsm.timeInState * 8) % 2 ? '#ffd166' : '#888888'), fsm.timeInState > 1 ? 'strike' : undefined) },
  strike: { enter: () => ((mesh().material = '#ff6b6b'), (world.require(trap, Transform).position.y = 0.5)), update: () => (fsm.timeInState > 0.5 ? 'cooldown' : undefined) },
  cooldown: { enter: () => (world.require(trap, Transform).position.y = -0.3), update: () => (fsm.timeInState > 1 ? 'idle' : undefined) },
});
fsm.onChange((to, from) => console.log(from, '→', to));
engine.on('update', (t) => fsm.update(t.delta));
engine.start();
```

## decodeWalkable
把「可走、擋住交替的格數」還原成 0／1 陣列（場景檔存導航網格用的壓縮格式）。

```ts
const cells = decodeWalkable([3, 2, 4], 12);
console.log([...cells].join(''), '（3 格可走、2 格擋住、4 格可走，不夠的補可走）');
```

## encodeWalkable
0／1 陣列壓縮成「可走、擋住交替的格數」。

```ts
console.log(encodeWalkable([1, 1, 1, 0, 0, 1, 1, 1, 1, 1]));
console.log(encodeWalkable([0, 0, 1]), '（第一個是可走的格數，可以是 0）');
```

## navGridFromFile
場景檔的寫法 → 導航網格（格式錯誤時丟出錯誤）。

```ts
const grid = navGridFromFile({ min: [-2, -2], max: [2, 2], cellSize: 1, walkable: [5, 2, 9] });
console.log(grid.cols, 'x', grid.rows, '，(-0.5, -1.5) 能走嗎？', grid.isWalkable({ x: 1.5, z: -0.5 }));
try {
  navGridFromFile({ min: [0, 0] });
} catch (error) {
  console.log('錯誤：', (error as Error).message);
}
```

## navGridToFile
導航網格 → 場景檔寫法（3D 場景編輯器存檔時用）。

```ts
const grid = new NavGrid({ min: { x: 0, z: 0 }, max: { x: 4, z: 2 }, cellSize: 1 });
grid.setWalkable(1, 0, false);
grid.setWalkable(2, 1, false);
console.log(JSON.stringify(navGridToFile(grid)));
```

## Brain
大腦元件：每幀（或每秒幾次）執行實體的行為樹。`blackboard` 是節點之間共用的記憶。

```ts
const e = world.spawn(Transform);
const tree = new BehaviorTree<{ hunger: number }>(
  BT.selector(
    BT.sequence(BT.condition((c) => c.blackboard.hunger > 5, '餓了'), BT.action((c) => ((c.blackboard.hunger = 0), console.log('吃飯')), '吃')),
    BT.action((c) => void c.blackboard.hunger++, '玩'),
  ),
);
const brain = world.add(e, Brain, { tree: tree as BehaviorTree<object>, blackboard: { hunger: 0 }, tickRate: 4 });
engine.timers.every(0.5, () => console.log('飢餓值', brain.blackboard.hunger, '，狀態', brain.status));
engine.start();
```

## BRAIN_PRIORITY
update 階段的順序：大腦（決定做什麼）→ 找路 → 轉向移動。

```ts
console.log('大腦', BRAIN_PRIORITY, '→ 找路', PATH_PRIORITY, '→ 轉向', STEERING_PRIORITY);
```

## BT
建立行為樹節點的工具：sequence、selector、parallel、condition、action、wait、invert、repeat、cooldown、timeout……

```ts
let mana = 3;
const tree = new BehaviorTree(
  BT.repeat(
    BT.selector(
      BT.cooldown(1, BT.sequence(BT.condition(() => mana > 0), BT.action(() => console.log('火球！剩', --mana, '魔力')))),
      BT.timeout(0.5, BT.action(() => 'running', '等待')),
      BT.succeed(BT.invert(BT.action(() => console.log('普通攻擊')))),
    ),
  ),
);
const e = world.spawn(Transform);
world.add(e, Brain, { tree: tree as BehaviorTree<object>, tickRate: 5 });
engine.start();
```

## NavGridKey
導航網格資源：`world.setResource(NavGridKey, grid)`（和 `ai.navGrid = grid` 一樣）。

```ts
const grid = new NavGrid({ min: { x: -5, z: -5 }, max: { x: 5, z: 5 } });
world.setResource(NavGridKey, grid);
console.log('ai.navGrid 也是它：', ai.navGrid === grid);
```

## PATH_PRIORITY
找路系統在 update 階段的順序。

```ts
console.log('找路：', PATH_PRIORITY);
```

## PathFollower
找路元件：設定目的地（或要跟隨的實體），自動在導航網格上找路並移動（需要 SteeringAgent）。這隻寵物跟著繞圈的主人。

```ts
spawn.camera(world, { position: [0, 12, 8], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.grid(world, { size: 16, divisions: 16 });
ai.navGrid = new NavGrid({ min: { x: -8, z: -8 }, max: { x: 8, z: 8 } });
const owner = spawn.mesh(world, { geometry: { capsule: [0.3, 0.6] }, material: '#ffd166', position: [4, 0.6, 0] });
const pet = spawn.mesh(world, { geometry: { sphere: 0.25 }, material: '#ff6b6b', position: [-4, 0.25, 0] });
world.add(pet, SteeringAgent, { maxSpeed: 4, stopDistance: 1 });
world.add(pet, PathFollower, { targetEntity: owner, repathInterval: 0.3 });
engine.on('update', (t) => world.require(owner, Transform).position.set(Math.cos(t.elapsed * 0.5) * 5, 0.6, Math.sin(t.elapsed * 0.5) * 5));
engine.start();
```

## sense
感知：`canSee` 判斷看不看得到（距離、視角、遮擋），`distance` 兩個實體的距離。

```ts
spawn.camera(world, { position: [0, 10, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
const eye = spawn.mesh(world, { geometry: { cone: [0.4, 1], rotation: [-Math.PI / 2, 0, 0] }, material: '#4cc9f0' });
const target = spawn.mesh(world, { geometry: { sphere: 0.3 }, material: '#ff6b6b' });
engine.on('update', (t) => {
  world.require(target, Transform).position.set(Math.cos(t.elapsed) * 4, 0, Math.sin(t.elapsed) * 4);
  const seen = sense.canSee(world, eye, target, { range: 6, fov: 90, occlusion: false });
  world.require(target, MeshRenderer).material = seen ? '#9acd32' : '#ff6b6b';
  if (t.frame % 30 === 0) console.log(seen ? '看到了' : '看不到', '，距離', sense.distance(world, eye, target).toFixed(1));
});
engine.start();
```

## steer
轉向行為的計算（不用元件，自己控制移動時用）：seek、flee、arrive、pursue、evade、wander、separation。這裡三隻分別 seek、flee、wander。

```ts
spawn.camera(world, { position: [0, 14, 8], target: [0, 0, 0] });
spawn.defaultLights(world);
const target = spawn.mesh(world, { geometry: { box: 0.4 }, material: '#ffd166' });
const make = (color: string, x: number) => ({ e: spawn.mesh(world, { geometry: { sphere: 0.3 }, material: color, position: [x, 0.3, 3] }), v: new Vector3() });
const seeker = make('#9acd32', -3);
const fleer = make('#ff6b6b', 0);
const wanderer = make('#4cc9f0', 3);
const ws = { angle: 0 };
engine.on('update', (t) => {
  const tp = world.require(target, Transform).position.set(Math.cos(t.elapsed * 0.6) * 4, 0.2, Math.sin(t.elapsed * 0.6) * 4);
  for (const [a, force] of [
    [seeker, steer.seek(world.require(seeker.e, Transform).position, seeker.v, tp, 3)],
    [fleer, steer.flee(world.require(fleer.e, Transform).position, fleer.v, tp, 3)],
    [wanderer, steer.wander(world.require(wanderer.e, Transform).position, wanderer.v, ws, 2, t.delta)],
  ] as const) {
    a.v.add(force.multiplyScalar(t.delta));
    steer.truncate(a.v, 3);
    const p = world.require(a.e, Transform).position.addScaledVector(a.v, t.delta);
    p.x = MathUtils.clamp(p.x, -7, 7);
    p.z = MathUtils.clamp(p.z, -7, 7);
  }
});
engine.start();
```

## STEERING_PRIORITY
轉向系統在 update 階段的順序（在找路之後）。

```ts
console.log('轉向：', STEERING_PRIORITY);
```

## SteeringAgent
轉向角色元件：設定 mode 與目標，系統會平滑地移動、轉向。用 lil-gui 切換行為。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 12, 8], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.grid(world, { size: 16, divisions: 16 });
const mouse = spawn.mesh(world, { geometry: { sphere: 0.3 }, material: '#ffd166' });
engine.on('update', (t) => world.require(mouse, Transform).position.set(Math.cos(t.elapsed * 0.8) * 5, 0.3, Math.sin(t.elapsed * 1.1) * 4));
const cats: SteeringAgentData[] = [];
for (let i = 0; i < 4; i++) {
  const cat = spawn.mesh(world, { geometry: { cone: [0.3, 0.8], rotation: [-Math.PI / 2, 0, 0] }, material: '#ff6b6b', position: [i - 1.5, 0.3, -5] });
  cats.push(world.add(cat, SteeringAgent, { mode: 'pursue', targetEntity: mouse, maxSpeed: 3, separation: 1.5 }));
}
const params = { mode: 'pursue' as SteeringMode, maxSpeed: 3 };
const gui = new GUI();
gui.add(params, 'mode', ['idle', 'seek', 'arrive', 'flee', 'pursue', 'evade', 'wander']).name('行為').onChange((m: SteeringMode) => cats.forEach((c) => (c.mode = m)));
gui.add(params, 'maxSpeed', 0.5, 8, 0.1).name('最快速度').onChange((v: number) => cats.forEach((c) => (c.maxSpeed = v)));
engine.start();
```

## BakeOptions
從物理世界烘焙導航網格的設定：偵測高度、角色半徑、要忽略的實體。

```ts
spawn.camera(world, { position: [0, 12, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
for (const [x, z] of [[-2, 0], [2, 1], [0, -3]]) {
  spawn.mesh(world, { geometry: { box: 1.5 }, material: '#888888', position: [x, 0.75, z] });
  world.spawn(Transform.at(x, 0.75, z), Collider.with({ halfExtents: { x: 0.75, y: 0.75, z: 0.75 } }));
}
const grid = new NavGrid({ min: { x: -6, z: -6 }, max: { x: 6, z: 6 }, cellSize: 0.5 });
const options: BakeOptions = { probeY: 0.5, agentRadius: 0.4 };
physics.flush();
grid.bakeFromPhysics(physics, world, options);
world.spawn(Transform, SceneObject.with({ object: grid.createDebugMesh() }));
console.log('擋住的格子：', grid.walkable.filter((w) => w === 0).length);
engine.start();
```

## BrainData
Brain 的資料：行為樹、黑板、思考頻率、啟用、狀態。

```ts
const data: BrainData = Brain.create();
console.log('預設：tickRate', data.tickRate, '，enabled', data.enabled, '，status', data.status);
```

## BTContext
行為樹執行時拿到的資訊：實體、ECS 世界、這一幀的秒數、黑板。

```ts
const tree = new BehaviorTree<{ hp: number }>(
  BT.action((ctx: BTContext<{ hp: number }>) => {
    console.log('實體', ctx.entity, '，dt', ctx.dt, '，hp', ctx.blackboard.hp);
    ctx.blackboard.hp -= 10;
  }),
);
const ctx: BTContext<{ hp: number }> = { world, entity: world.create(), dt: 0.016, blackboard: { hp: 100 } };
tree.tick(ctx);
tree.tick(ctx);
```

## FsmState
狀態機的一個狀態：enter、update（回傳狀態名稱就切換）、exit。

```ts
type Door = { open: number };
const opening: FsmState<Door> = {
  enter: (_d, from) => console.log('開始開門（從', from, '）'),
  update: (d, dt) => ((d.open = Math.min(1, d.open + dt)), d.open >= 1 ? 'opened' : undefined),
  exit: (_d, to) => console.log('門開好了，接著', to),
};
const fsm = new StateMachine<Door>({ open: 0 }, 'opening', { opening, opened: { enter: () => console.log('完全打開') } });
for (let i = 0; i < 5; i++) fsm.update(0.3);
```

## NavGridFile
場景檔裡的導航網格寫法：範圍、格子大小、高度、壓縮的可走資料。

```ts
const file: NavGridFile = { min: [-3, -3], max: [3, 3], cellSize: 1, y: 0, walkable: [14, 3, 19] };
const grid = navGridFromFile(file);
console.log(grid.cols, 'x', grid.rows, '，擋住', grid.walkable.filter((w) => !w).length, '格');
```

## NavGridOptions
`new NavGrid(options)` 的設定：範圍、格子大小、路徑點高度。

```ts
const options: NavGridOptions = { min: { x: -10, z: -5 }, max: { x: 10, z: 5 }, cellSize: 0.25, y: 0.5 };
const grid = new NavGrid(options);
console.log('格子：', grid.cols, 'x', grid.rows, '，路徑點高度', grid.y);
```

## PathFollowerData
PathFollower 的資料：目的地或跟隨的實體、重新找路的條件、路徑、狀態。

```ts
ai.navGrid = new NavGrid({ min: { x: -5, z: -5 }, max: { x: 5, z: 5 } });
const e = world.spawn(Transform.at(-4, 0, -4), SteeringAgent);
const f: PathFollowerData = world.add(e, PathFollower, { destination: { x: 4, y: 0, z: 4 } });
engine.timers.every(0.5, () => console.log(f.status, '，第', f.index, '/', f.path.length, '個點'));
engine.start();
```

## PathOptions
找路的設定：允許斜走、拉直路徑。

```ts
const grid = new NavGrid({ min: { x: 0, z: 0 }, max: { x: 10, z: 10 }, cellSize: 1 });
for (const options of [{ diagonal: false, smooth: false }, { diagonal: true, smooth: false }, { diagonal: true, smooth: true }] as PathOptions[])
  console.log(JSON.stringify(options), '→', grid.findPath({ x: 0.5, y: 0, z: 0.5 }, { x: 9.5, y: 0, z: 6.5 }, options)?.length, '個點');
```

## SightOptions
視線判斷的設定：視距、視野角度、眼睛高度、遮擋。

```ts
const a = world.spawn(Transform.at(0, 0, 0));
const b = world.spawn(Transform.at(0, 0, -5));
const c = world.spawn(Transform.at(0, 0, 5));
const options: SightOptions = { range: 10, fov: 90, eyeHeight: 1.6, occlusion: false };
tick.transforms(world);
console.log('前方的 b：', sense.canSee(world, a, b, options), '，背後的 c：', sense.canSee(world, a, c, options));
console.log('全方位看得到 c 嗎？', sense.canSee(world, a, c, { ...options, fov: 360 }));
```

## SteeringAgentData
SteeringAgent 的資料：行為、目標、速度、轉向力、保持距離、朝向……

```ts
const data: SteeringAgentData = SteeringAgent.create();
console.log(`預設：mode ${data.mode}、maxSpeed ${data.maxSpeed}、maxForce ${data.maxForce}、stopDistance ${data.stopDistance}`);
```

## BTStatus
節點的結果：成功、失敗、還在執行（下一幀繼續）。

```ts
let n = 0;
const tree = new BehaviorTree(BT.action((): BTStatus => (++n < 3 ? 'running' : 'success')));
const results: BTStatus[] = [];
for (let i = 0; i < 3; i++) results.push(tree.tick({ world, entity: NULL_ENTITY, dt: 0.1, blackboard: {} }));
console.log(results.join(' → '));
```

## PathStatus
找路的狀態：沒有目的地、移動中、已抵達、到不了。

```ts
const grid = new NavGrid({ min: { x: -5, z: -5 }, max: { x: 5, z: 5 } });
grid.setArea(1, -5, 2, 5, false); // 一道完整的牆
ai.navGrid = grid;
const e = world.spawn(Transform.at(-3, 0, 0), SteeringAgent);
const f = world.add(e, PathFollower, { destination: { x: 4, y: 0, z: 0 } });
const seen: PathStatus[] = [];
engine.on('update', () => seen.at(-1) !== f.status && seen.push(f.status) && console.log('狀態：', f.status));
engine.start();
```

## SteeringMode
轉向行為：停止、前往、抵達（接近時減速）、逃離、追擊、躲避、漫步。

```ts
const modes: SteeringMode[] = ['idle', 'seek', 'arrive', 'flee', 'pursue', 'evade', 'wander'];
console.log(modes.join('、'));
```
