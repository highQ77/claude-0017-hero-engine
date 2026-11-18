/**
 * official-demo-006-ai：AI 介紹。
 *
 * 四個分頁，每一頁是一個場景（切換分頁時換場景）：
 *   ① 轉向（steering）：一群角色對同一個目標 seek／arrive／pursue／flee／evade／wander，保持距離
 *   ② 找路（path）：導航網格 + A*，點地面讓角色繞過牆走過去，寵物跟著主人
 *   ③ 狀態機（fsm）：村民在工作、口渴、喝水、回家、休息之間切換
 *   ④ 行為樹（bt）：守衛巡邏，看到玩家就追，追丟了去最後看到的地方找，再回去巡邏
 *
 * 介面在 public/ui/scene.xml。
 */
import {
  BT,
  BehaviorTree,
  Brain,
  NavGrid,
  PathFollower,
  type PathFollowerData,
  Selector,
  Sequence,
  StateMachine,
  SteeringAgent,
  type SteeringAgentData,
  type SteeringMode,
  sense,
} from '@engine/ai';
import type { Entity, World } from '@engine/ecs';
import { type Quaternion, Random, Vector3 } from '@engine/math';
import { PluginManager } from '@engine/plugins';
import perfMonitor from '@engine/packages/perf-monitor';
import { OrbitControl, SceneObject, create, spawn } from '@engine/render';
import { type Scene, Transform, math } from '@engine/scene';
import * as ui2d from '@engine/ui2d';
import type { UILabel, UIProgressBar, UISelect, UISlider, UIStackView, UIToggle } from '@engine/ui2d';
import { ai, audio, engine, input, render, scenes, ui, world } from './engine';

type Vec3 = [number, number, number];

// ───────── 共用 ─────────

for (const e of Object.values(spawn.defaultLights(world, { shadows: true }))) scenes.persist(e);
/** 地面（點地面時用 render.pick 找它） */
const floor = spawn.mesh(world, {
  geometry: { circle: 9.5 },
  material: '#262c22',
  rotation: [-Math.PI / 2, 0, 0],
  receiveShadow: true,
});
scenes.persist(floor);
scenes.persist(spawn.grid(world, { size: 18, divisions: 36, color: '#30372a', position: [0, 0.01, 0] }));

/** 每幀要做的事（只在目前這一頁執行；換頁時清掉） */
let pageUpdate: ((dt: number, elapsed: number) => void) | null = null;
engine.on('update', (time) => pageUpdate?.(time.delta, time.elapsed));

/** 可以用滑鼠轉動的攝影機；左邊的說明面板會擋住畫面左側，所以整個往左移一點，場景才會在右邊 */
function camera(position: Vec3, target: Vec3): Entity {
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
  world.add(cam, OrbitControl, { target: look, minDistance: 4, maxDistance: 30, wheelNeedsFocus: true });
  return cam;
}

/** 角色：膠囊身體 + 白色的鼻子（指向前方 -Z，看得出面向哪裡） */
function agentBody(w: World, color: string, x: number, z: number, size = 1): Entity {
  const e = spawn.mesh(w, {
    geometry: { capsule: [0.28 * size, 0.5 * size] },
    material: color,
    position: [x, 0.53 * size, z],
    castShadow: true,
  });
  spawn.mesh(w, {
    geometry: { cone: [0.13 * size, 0.3 * size], rotation: [-Math.PI / 2, 0, 0] },
    material: '#ffffff',
    position: [0, 0.18 * size, -0.32 * size],
    parent: e,
  });
  return e;
}

/** 點一下畫面（按下到放開幾乎沒移動）；拖曳是轉動視角，不算點擊 */
let press: { x: number; y: number } | null = null;
function clicked(): boolean {
  if (input.wasPressed('Mouse:Left')) press = { x: input.pointer.x, y: input.pointer.y };
  if (!input.wasReleased('Mouse:Left') || !press) return false;
  const moved = Math.hypot(input.pointer.x - press.x, input.pointer.y - press.y);
  press = null;
  return moved < 6;
}

/** 滑鼠指著的地面位置（沒指到地面時是 null） */
function pointerOnFloor(): Vector3 | null {
  return render.pick(input.pointer.ndcX, input.pointer.ndcY, (h) => h.entity === floor)?.point ?? null;
}

/** 牆：看得到的方塊，並在導航網格上標記為擋住 */
function wall(
  w: World,
  grids: NavGrid[],
  x: number,
  z: number,
  width: number,
  depth: number,
  color = '#6a7360',
): Entity {
  for (const g of grids) g.setArea(x - width / 2, z - depth / 2, x + width / 2, z + depth / 2, false);
  return spawn.mesh(w, {
    geometry: { box: [width, 1.2, depth] },
    material: color,
    position: [x, 0.6, z],
    castShadow: true,
    receiveShadow: true,
  });
}

/** 離 p 最近、可以走的格子中心（巡邏點不小心落在牆邊時用） */
function nearestWalkable(grid: NavGrid, p: { x: number; z: number }): Vector3 {
  if (grid.isWalkable(p)) return new Vector3(p.x, 0, p.z);
  for (let r = 1; r < 10; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const q = { x: p.x + dx * grid.cellSize, z: p.z + dz * grid.cellSize };
        if (grid.isWalkable(q)) return new Vector3(q.x, 0, q.z);
      }
  return new Vector3(p.x, 0, p.z);
}

// ───────── ① 轉向 ─────────

let steerAgents: SteeringAgentData[] = [];

const steeringPage: Scene = {
  name: 'steering',
  setup(w) {
    camera([0, 11, 11], [0, 0, 0]);
    const target = spawn.mesh(w, {
      geometry: { sphere: 0.35 },
      material: { standard: { color: '#ffd166', emissive: '#ffd166', emissiveIntensity: 0.4 } },
      position: [4, 0.35, 0],
      castShadow: true,
    });
    const agents: Entity[] = [];
    steerAgents = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const e = agentBody(w, `hsl(${190 + i * 8}, 70%, 60%)`, Math.cos(a) * 6, Math.sin(a) * 6, 0.8);
      steerAgents.push(w.add(e, SteeringAgent, { targetEntity: target }));
      agents.push(e);
    }
    applySteering();

    const tPos = w.require(target, Transform).position;
    const showVectors = ui.require<UIToggle>('showVectors');
    const followMouse = ui.require<UIToggle>('followMouse');
    pageUpdate = (_dt, elapsed) => {
      // 目標：跟著滑鼠，或自己繞 8 字形
      const p = followMouse.checked ? pointerOnFloor() : null;
      if (p) tPos.set(p.x, 0.35, p.z);
      else if (!followMouse.checked) tPos.set(Math.sin(elapsed * 0.5) * 5, 0.35, Math.sin(elapsed) * 3);
      agents.forEach((e, i) => {
        const pos = w.require(e, Transform).position;
        const v = steerAgents[i].velocity;
        // 不要跑出圓盤：碰到邊緣就停在邊上，去掉往外的速度
        const r = Math.hypot(pos.x, pos.z);
        if (r > 8.8) {
          const nx = pos.x / r;
          const nz = pos.z / r;
          pos.x = nx * 8.8;
          pos.z = nz * 8.8;
          const out = v.x * nx + v.z * nz;
          if (out > 0) {
            v.x -= out * nx;
            v.z -= out * nz;
          }
        }
        if (showVectors.checked && v.lengthSq() > 0.01)
          render.debug.ray([pos.x, 0.1, pos.z], [v.x, 0, v.z], v.length() * 0.5, { color: '#ffd166' });
      });
    };
  },
};

/** 左邊的選單、滑桿 → 每個角色的 SteeringAgent */
function applySteering(): void {
  const mode = ui.require<UISelect>('mode').value as SteeringMode;
  for (const a of steerAgents) {
    a.mode = mode;
    a.maxSpeed = ui.require<UISlider>('maxSpeed').value;
    a.maxForce = ui.require<UISlider>('maxForce').value;
    a.separation = ui.require<UISlider>('separation').value;
    a.separationRadius = 1.2;
  }
}

// ───────── ② 找路 ─────────

const PATH_STATUS: Record<string, string> = {
  idle: '待命（沒有目的地）',
  moving: '移動中',
  arrived: '到了',
  unreachable: '到不了',
};
let mazeSeed = 1;
let rebuildMaze: () => void = () => {};
let heroFollower: PathFollowerData | null = null;
let gridDebug: Entity | null = null;

const pathPage: Scene = {
  name: 'path',
  setup(w) {
    camera([0, 14, 9], [0, 0, 0]);
    const hero = agentBody(w, '#4cc9f0', -6.5, -6.5);
    w.add(hero, SteeringAgent, { maxSpeed: 3.2, maxForce: 14 });
    heroFollower = w.add(hero, PathFollower, { destination: { x: 6.5, y: 0, z: 6.5 } });
    const pet = agentBody(w, '#ff6b6b', -7, -5.5, 0.6);
    w.add(pet, SteeringAgent, { maxSpeed: 3.6, maxForce: 14, stopDistance: 1.2 });
    w.add(pet, PathFollower, { targetEntity: hero, repathInterval: 0.3 });

    let walls: Entity[] = [];
    rebuildMaze = () => {
      for (const e of walls) w.destroy(e);
      if (gridDebug !== null) w.destroy(gridDebug);
      walls = [];
      const grid = new NavGrid({ min: { x: -8, z: -8 }, max: { x: 8, z: 8 }, cellSize: 0.5 });
      const rng = new Random(`maze-${mazeSeed++}`);
      const keepClear = [hero, pet].map((e) => w.require(e, Transform).position.clone());
      for (let i = 0; i < 11; i++) {
        const horizontal = rng.next() < 0.5;
        const len = rng.range(2.5, 6);
        const [width, depth] = horizontal ? [len, 0.5] : [0.5, len];
        const x = Math.round(rng.range(-6, 6) * 2) / 2;
        const z = Math.round(rng.range(-6, 6) * 2) / 2;
        // 不要把牆蓋在角色身上
        const blocked = keepClear.some((p) => Math.abs(p.x - x) < width / 2 + 1 && Math.abs(p.z - z) < depth / 2 + 1);
        if (blocked) continue;
        walls.push(wall(w, [grid], x, z, width, depth));
      }
      // 角色有寬度：牆的周圍再擋住一格，路線才不會貼著牆角
      grid.inflate(1);
      ai.navGrid = grid;
      gridDebug = w.spawn(Transform.at(0, 0.02, 0), SceneObject.with({ object: grid.createDebugMesh() }));
      // 顯示與否用元件的 visible 欄位（每幀會同步到 three.js 物件；直接改物件的 visible 會被蓋掉）
      w.require(gridDebug, SceneObject).visible = ui.require<UIToggle>('showGrid').checked;
    };
    rebuildMaze();

    const status = ui.require<UILabel>('pathStatus');
    const info = ui.require<UILabel>('pathInfo');
    pageUpdate = () => {
      const f = heroFollower!;
      if (f.path.length) render.debug.path(f.path.slice(f.index > 0 ? f.index - 1 : 0), { color: '#ffd166' });
      if (f.destination) render.debug.sphere([f.destination.x, 0.05, f.destination.z], 0.25, { color: '#ffd166' });
      if (clicked()) {
        const p = pointerOnFloor();
        if (p) {
          f.destination = { x: p.x, y: 0, z: p.z };
          audio.play('sounds/pop.wav', { volume: 0.3 });
        }
      }
      status.setText(PATH_STATUS[f.status] ?? f.status);
      info.setText(f.path.length ? `路徑點 ${Math.min(f.index + 1, f.path.length)} / ${f.path.length}` : ' ');
    };
  },
  teardown() {
    ai.navGrid = null;
    heroFollower = null;
    gridDebug = null;
  },
};

// ───────── ③ 狀態機 ─────────

const PLACES = { field: new Vector3(-3.5, 0, 1.5), well: new Vector3(3.8, 0, -2.2), house: new Vector3(3.2, 0, 3.6) };
const FSM_RULES = ['work>thirsty', 'work>tired', 'thirsty>drink', 'drink>work', 'tired>rest', 'rest>work'];
const STATE_COLORS: Record<string, string> = {
  work: '#9acd32',
  thirsty: '#4cc9f0',
  drink: '#4cc9f0',
  tired: '#b072ff',
  rest: '#b072ff',
};
const villager = { thirst: 30, energy: 80 };
let fsm: StateMachine<typeof villager> | null = null;

const fsmPage: Scene = {
  name: 'fsm',
  setup(w) {
    camera([0, 9, 11], [0, 0, 0.5]);
    // 田：一排排的作物
    spawn.mesh(w, {
      geometry: { box: [4, 0.1, 3] },
      material: '#5a4630',
      position: [PLACES.field.x, 0.05, PLACES.field.z],
      receiveShadow: true,
    });
    for (let i = 0; i < 12; i++)
      spawn.mesh(w, {
        geometry: { cone: [0.18, 0.5] },
        material: '#6fbf4a',
        position: [PLACES.field.x - 1.5 + (i % 4), 0.35, PLACES.field.z - 1 + Math.floor(i / 4)],
        castShadow: true,
      });
    // 井
    spawn.mesh(w, {
      geometry: { cylinder: [0.6, 0.7] },
      material: '#8a8a80',
      position: [PLACES.well.x, 0.35, PLACES.well.z],
      castShadow: true,
    });
    spawn.mesh(w, {
      geometry: { cylinder: [0.45, 0.05] },
      material: '#3a7ab0',
      position: [PLACES.well.x, 0.71, PLACES.well.z],
    });
    spawn.mesh(w, {
      geometry: { cone: [0.9, 0.6, 4] },
      material: '#7a3b2e',
      position: [PLACES.well.x, 2, PLACES.well.z],
      rotation: [0, Math.PI / 4, 0],
      castShadow: true,
    });
    for (const dx of [-0.55, 0.55])
      spawn.mesh(w, {
        geometry: { box: [0.08, 1.4, 0.08] },
        material: '#6b4a2b',
        position: [PLACES.well.x + dx, 1.1, PLACES.well.z],
      });
    // 房子
    spawn.mesh(w, {
      geometry: { box: [2, 1.5, 1.8] },
      material: '#d9b48c',
      position: [PLACES.house.x + 1.6, 0.75, PLACES.house.z],
      castShadow: true,
      receiveShadow: true,
    });
    spawn.mesh(w, {
      geometry: { cone: [1.6, 1, 4] },
      material: '#7a3b2e',
      position: [PLACES.house.x + 1.6, 2, PLACES.house.z],
      rotation: [0, Math.PI / 4, 0],
      castShadow: true,
    });

    // 村民：頭上的小球顏色代表狀態
    const body = agentBody(w, '#e9c46a', PLACES.field.x, PLACES.field.z);
    const agent = w.add(body, SteeringAgent, { mode: 'arrive', maxSpeed: 2.2, slowRadius: 1 });
    const markMat = create.material({
      standard: { color: STATE_COLORS.work, emissive: STATE_COLORS.work, emissiveIntensity: 0.5 },
    });
    spawn.mesh(w, { geometry: { sphere: 0.15 }, material: markMat, position: [0, 0.95, 0], parent: body });

    const goTo = (p: Vector3, spread = 0) =>
      (agent.target = { x: p.x + (Math.random() - 0.5) * spread, y: 0, z: p.z + (Math.random() - 0.5) * spread });

    villager.thirst = 30;
    villager.energy = 80;
    // 每個狀態：enter 進來時做的事；update 每幀做的事，回傳下一個狀態的名稱就切換
    fsm = new StateMachine(villager, 'work', {
      work: {
        enter: () => goTo(PLACES.field, 3),
        update: (v, dt) => {
          v.thirst = Math.min(100, v.thirst + dt * 9);
          v.energy = Math.max(0, v.energy - dt * 5);
          if (agent.arrived && Math.random() < dt * 0.8) goTo(PLACES.field, 3); // 在田裡走來走去
          if (v.thirst >= 100) return 'thirsty';
          if (v.energy < 20) return 'tired';
        },
      },
      thirsty: {
        enter: () => goTo(PLACES.well.clone().add(new Vector3(-0.9, 0, 0.6))),
        update: () => (agent.arrived ? 'drink' : undefined),
      },
      drink: {
        update: (v, dt) => {
          v.thirst = Math.max(0, v.thirst - dt * 45);
          return v.thirst <= 0 ? 'work' : undefined;
        },
      },
      tired: {
        enter: () => goTo(PLACES.house.clone().add(new Vector3(-0.4, 0, 1.3))),
        update: () => (agent.arrived ? 'rest' : undefined),
      },
      rest: {
        update: (v, dt) => {
          v.energy = Math.min(100, v.energy + dt * 22);
          return v.energy >= 100 ? 'work' : undefined;
        },
      },
    });
    // 狀態改變：更新左邊的狀態名稱、亮起剛發生的轉換規則、頭上的顏色
    const showState = (to: string, from: string | null) => {
      ui.require<UILabel>('fsmState').setText(to);
      const key = `${from}>${to}`;
      FSM_RULES.forEach((rule, i) => {
        const on = rule === key;
        ui.get<UILabel>(`rule${i}`)?.set('background', on ? 'rgba(255,209,102,0.22)' : 'rgba(0,0,0,0)');
        ui.get<UILabel>(`rule${i}`)?.set('color', on ? '#ffd166' : '#e9f6d2');
      });
      markMat.color.set(STATE_COLORS[to]);
      markMat.emissive.set(STATE_COLORS[to]);
    };
    fsm.onChange(showState);
    showState('work', null);
    pageUpdate = (dt) => fsm?.update(dt);
    // 數值每 0.1 秒更新一次（文字、進度條沒變時不會重畫）
    engine.timers.every(
      0.1,
      () => {
        ui.require<UIProgressBar>('thirst').value = Math.round(villager.thirst);
        ui.require<UIProgressBar>('energy').value = Math.round(villager.energy);
        ui.require<UILabel>('fsmTime').setText(`${(fsm?.timeInState ?? 0).toFixed(1)} 秒`);
      },
      { owner: body },
    );
  },
  teardown() {
    fsm = null;
    engine.time.timeScale = 1;
    ui.require<UIToggle>('fast').checked = false;
  },
};

// ───────── ④ 行為樹 ─────────

const PLAYER_START = new Vector3(-6.5, 0, 6.5);
const GUARD_SIGHT = { range: 7, fov: 110 };
/** 起點的安全區半徑：玩家在裡面時守衛看不到 */
const SAFE_RADIUS = 0.9;
let caughtCount = 0;
let spottedCount = 0;

/** 守衛的記憶（黑板）：巡邏到第幾個點、最後看到玩家的位置 */
// 用 type（不是 interface）：Brain 的 blackboard 是 Record<string, unknown>，interface 不能直接放進去
type GuardMemory = {
  patrol: number;
  lastSeen: Vector3 | null;
};

const btPage: Scene = {
  name: 'bt',
  setup(w) {
    camera([0, 15, 10], [0, 0, 0.5]);
    // 兩張網格：walk 是牆本身（玩家移動、視線判斷）；nav 再往外擋一格（守衛找路，不會貼著牆角）
    const walk = new NavGrid({ min: { x: -8, z: -8 }, max: { x: 8, z: 8 }, cellSize: 0.5 });
    const nav = new NavGrid({ min: { x: -8, z: -8 }, max: { x: 8, z: 8 }, cellSize: 0.5 });
    const WALLS: [number, number, number, number][] = [
      [-1, -3, 7, 0.6],
      [-4, 2, 0.6, 5],
      [3, 2.5, 5, 0.6],
      [5.5, -5.5, 0.6, 3],
      [0.5, 4.5, 0.6, 3],
      [2, -0.3, 1, 1],
      [-6, -1, 1, 1],
    ];
    for (const [x, z, wd, d] of WALLS) wall(w, [walk, nav], x, z, wd, d);
    nav.inflate(1);
    ai.navGrid = nav;

    const player = agentBody(w, '#9acd32', PLAYER_START.x, PLAYER_START.z);
    const playerPos = w.require(player, Transform).position;
    // 起點的安全區
    spawn.mesh(w, {
      geometry: { circle: SAFE_RADIUS },
      material: { standard: { color: '#9acd32', transparent: true, opacity: 0.25 } },
      position: [PLAYER_START.x, 0.03, PLAYER_START.z],
      rotation: [-Math.PI / 2, 0, 0],
    });

    const ROUTES: [number, number][][] = [
      [
        [-6.5, -5.5],
        [3.5, -5.5],
        [3.5, -1.2],
        [-2, -1.2],
      ],
      [
        [6.8, 7],
        [6.8, 0.8],
        [-1.5, 0.8],
        [2, 6.8],
      ],
    ];
    const guards = ROUTES.map((route, gi) => {
      const points = route.map(([x, z]) => nearestWalkable(nav, { x, z }));
      const e = agentBody(w, gi === 0 ? '#ffb347' : '#ff6b9a', points[0].x, points[0].z, 1.1);
      const agent = w.add(e, SteeringAgent, { maxSpeed: 1.6, maxForce: 12 });
      const follower = w.add(e, PathFollower, { repathInterval: 0.4 });
      const pos = w.require(e, Transform).position;
      // 看得到玩家：在視野內（距離、角度），中間沒有牆，而且玩家不在起點的安全區
      const sees = () =>
        playerPos.distanceTo(PLAYER_START) > SAFE_RADIUS &&
        sense.canSee(w, e, player, { ...GUARD_SIGHT, occlusion: false }) &&
        walk.lineOfSight(pos, playerPos);

      // 行為樹：由上往下，第一個不失敗的生效（每幀都從頭判斷，看到玩家會中斷巡邏、搜尋）
      const tree = new BehaviorTree<GuardMemory>(
        new Selector('守衛', [
          new Sequence('追擊玩家', [
            BT.condition(() => sees(), '看得到玩家？'),
            BT.action((c) => {
              follower.destination = null;
              follower.targetEntity = player;
              agent.maxSpeed = 3;
              c.blackboard.lastSeen = playerPos.clone();
              return 'running';
            }, '追過去'),
          ]),
          new Sequence('搜尋', [
            BT.condition((c) => c.blackboard.lastSeen !== null, '有線索？'),
            BT.action((c) => {
              follower.targetEntity = null;
              if (follower.destination !== c.blackboard.lastSeen) follower.destination = c.blackboard.lastSeen;
              agent.maxSpeed = 2.2;
              return follower.status === 'arrived' || follower.status === 'unreachable' ? 'success' : 'running';
            }, '去最後看到的地方'),
            BT.wait(1.5),
            BT.action((c) => {
              c.blackboard.lastSeen = null;
            }, '放棄'),
          ]),
          BT.action((c) => {
            const p = points[c.blackboard.patrol % points.length];
            follower.targetEntity = null;
            if (follower.destination !== p) follower.destination = p;
            agent.maxSpeed = 1.6;
            if (follower.status === 'arrived') c.blackboard.patrol++;
            return 'running';
          }, '巡邏'),
        ]),
      );
      // 黑板：行為樹的節點之間共用的記憶（每個守衛一份）
      const memory: GuardMemory = { patrol: 1, lastSeen: null };
      w.add(e, Brain, { tree: tree as BehaviorTree<object>, blackboard: memory });
      return { e, pos, tree, memory, sees, alerted: false, name: gi === 0 ? 'A' : 'B' };
    });

    const resetPlayer = () => {
      playerPos.copy(PLAYER_START);
      for (const g of guards) {
        g.memory.lastSeen = null;
        g.alerted = false;
      }
    };
    const move = new Vector3();
    pageUpdate = (dt) => {
      // 玩家：WASD／方向鍵；前方是牆就不能走（x、z 分開檢查，可以貼著牆滑過去）
      move.set(
        (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0) -
          (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0),
        0,
        (input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0) -
          (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0),
      );
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(3.5 * dt);
        const r = 0.3;
        if (walk.isWalkable({ x: playerPos.x + move.x + Math.sign(move.x) * r, z: playerPos.z })) playerPos.x += move.x;
        if (walk.isWalkable({ x: playerPos.x, z: playerPos.z + move.z + Math.sign(move.z) * r })) playerPos.z += move.z;
        math.setRotation(w.require(player, Transform), [0, Math.atan2(-move.x, -move.z), 0]);
      }
      for (const g of guards) {
        // 被發現的那一刻：守衛原本沒在追、也沒在找（追擊中在視野邊緣忽隱忽現不重複算）
        const seeing = g.sees();
        if (seeing && !g.alerted) {
          g.alerted = true;
          spottedCount++;
          ui.require<UILabel>('spotted').setText(String(spottedCount));
          ui.toast(`被守衛 ${g.name} 發現了！`, { icon: 'warning', color: '#ff6b6b' });
          audio.play('sounds/jump.wav', { volume: 0.4, pitch: 0.7 });
        }
        if (!seeing && g.memory.lastSeen === null) g.alerted = false; // 搜尋結束、放棄了
        drawSight(
          g.pos,
          yawOf(w.require(g.e, Transform).rotation),
          seeing ? '#ff4040' : g.memory.lastSeen ? '#ffd166' : '#9fb0a0',
        );
        // 抓到了：回到起點
        if (g.pos.distanceTo(playerPos) < 0.75) {
          caughtCount++;
          ui.require<UILabel>('caught').setText(String(caughtCount));
          ui.toast(`被守衛 ${g.name} 抓到了！回到起點`, { icon: 'close', color: '#ff6b6b' });
          resetPlayer();
        }
      }
    };
    // 左邊顯示每個守衛正在執行的節點（tree.activePath）
    engine.timers.every(
      0.2,
      () => guards.forEach((g, i) => ui.require<UILabel>(`guard${i}`).setText(g.tree.activePath.join(' › ') || '—')),
      { owner: player },
    );
  },
  teardown() {
    ai.navGrid = null;
  },
};

/** 面向的角度（繞 Y 軸，弧度）：前方是 -Z */
const _forward = new Vector3();
function yawOf(rotation: Quaternion): number {
  _forward.set(0, 0, -1).applyQuaternion(rotation);
  return Math.atan2(-_forward.x, -_forward.z);
}

/** 畫出守衛的視野：兩條邊界線 + 一段弧 */
function drawSight(pos: Vector3, yaw: number, color: string): void {
  const half = ((GUARD_SIGHT.fov / 2) * Math.PI) / 180;
  const at = (a: number, r: number): Vec3 => [pos.x - Math.sin(yaw + a) * r, 0.08, pos.z - Math.cos(yaw + a) * r];
  const o: Vec3 = [pos.x, 0.08, pos.z];
  render.debug.line(o, at(-half, GUARD_SIGHT.range), { color });
  render.debug.line(o, at(half, GUARD_SIGHT.range), { color });
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    const a0 = -half + (2 * half * i) / steps;
    const a1 = -half + (2 * half * (i + 1)) / steps;
    render.debug.line(at(a0, GUARD_SIGHT.range), at(a1, GUARD_SIGHT.range), { color });
  }
}

// ───────── 分頁切換 ─────────

scenes.register(steeringPage, pathPage, fsmPage, btPage);
let currentPage = '';
function showPage(name: string): void {
  if (name === currentPage) return;
  pageUpdate = null;
  currentPage = name;
  scenes.load(name);
}

ui.setHandlers({
  page: () => showPage(ui.require<UIStackView>('pages').selectedPage?.id ?? 'steering'),
  // ① 轉向
  steering: () => applySteering(),
  // ② 找路
  newMaze: () => rebuildMaze(),
  showGrid: (e) => {
    if (gridDebug !== null) world.require(gridDebug, SceneObject).visible = (e.target as UIToggle).checked;
  },
  // ③ 狀態機
  makeThirsty: () => (villager.thirst = 100),
  makeTired: () => (villager.energy = 10),
  fast: (e) => (engine.time.timeScale = (e.target as UIToggle).checked ? 3 : 1),
});

// 效能監視器：按 ` 鍵顯示／隱藏
await new PluginManager(engine, { api: { ui2d } }).install(perfMonitor, {
  toggleKey: 'Backquote',
  visible: false,
  position: { bottom: 16, right: 16 },
});

showPage('steering');
engine.start();
