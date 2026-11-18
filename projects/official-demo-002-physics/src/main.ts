/**
 * official-demo-002-physics：物理介紹。
 *
 * 四個分頁，每一頁是一個場景（切換分頁時換場景）：
 *   ① 剛體（bodies）：dynamic／fixed／kinematic 三種剛體、四種碰撞形狀
 *   ② 材質（materials）：彈性（restitution）與摩擦（friction）、重力
 *   ③ 施力（forces）：改速度射出球、衝量爆炸、射線檢測
 *   ④ 碰撞事件（events）：onCollision、感應器（sensor）、碰撞群組（groups）
 *
 * 介面在 public/ui/scene.xml（左邊的說明面板）；這裡是每一頁的 3D 內容與按鈕的處理函式。
 */
import type { Entity, World } from '@engine/ecs';
import { Color, Vector3 } from '@engine/math';
import { Collider, type ColliderData, RigidBody, type RigidBodyData, collision } from '@engine/physics';
import { PluginManager } from '@engine/plugins';
import perfMonitor from '@engine/packages/perf-monitor';
import { OrbitControl, create, spawn } from '@engine/render';
import { type Scene, Transform, math } from '@engine/scene';
import * as ui2d from '@engine/ui2d';
import type { UILabel, UISelect, UISlider, UIStackView, UIToggle } from '@engine/ui2d';
import { audio, engine, input, physics, physicsPlugin, render, scenes, ui, world } from './engine';

type Vec3 = [number, number, number];
type Material = Parameters<typeof spawn.mesh>[1]['material'];

// ───────── 共用：舞台（燈光、地面）、每頁的攝影機 ─────────

const GRAVITY = 9.81;
for (const e of Object.values(spawn.defaultLights(world, { shadows: true }))) scenes.persist(e);
// 地面：看得到的圓盤 + 圓柱形的碰撞體（只有碰撞體、沒有剛體 → 固定不動）
const ground = spawn.mesh(world, {
  geometry: { cylinder: [9, 0.2, 64] },
  material: '#262c22',
  position: [0, -0.1, 0],
  receiveShadow: true,
});
world.add(ground, Collider, { shape: 'cylinder', radius: 9, halfHeight: 0.1 });
scenes.persist(ground);
scenes.persist(spawn.grid(world, { size: 18, divisions: 18, color: '#343c2e', position: [0, 0.01, 0] }));

/**
 * 這一頁的攝影機（可以用滑鼠轉動；換頁時跟著場景移除）。
 * 左邊的說明面板會擋住畫面左側，所以攝影機和注視點一起往左移一點，讓場景出現在右邊看得到的地方。
 */
function camera(position: Vec3, target: Vec3): Entity {
  const eye = new Vector3(...position);
  const look = new Vector3(...target);
  const right = look
    .clone()
    .sub(eye)
    .cross(new Vector3(0, 1, 0))
    .normalize();
  const shift = right.multiplyScalar(-0.15 * eye.distanceTo(look));
  eye.add(shift);
  look.add(shift);
  const cam = spawn.camera(world, { position: eye, target: look, fov: 50 });
  world.add(cam, OrbitControl, {
    target: look,
    minDistance: 3,
    maxDistance: 24,
    wheelNeedsFocus: true,
  });
  return cam;
}

/** 每幀要做的事、碰撞事件的處理（只在目前這一頁執行；換頁時清掉） */
let pageUpdate: ((dt: number) => void) | null = null;
let pageCollision: ((a: Entity, b: Entity, started: boolean) => void) | null = null;
engine.on('update', (time) => pageUpdate?.(time.delta));
physics.onCollision((ev) => pageCollision?.(ev.a, ev.b, ev.started));

// 掉出地面的東西：每秒檢查一次，掉到很下面就刪除
engine.timers.every(1, () => {
  const fallen = world
    .query([RigidBody, Transform])
    .entities.filter((e) => world.require(e, Transform).position.y < -15);
  for (const e of fallen) world.destroy(e);
});

// ───────── 建立物理物件的小工具 ─────────

type Shape = 'box' | 'sphere' | 'capsule' | 'cylinder';

/** 形狀 → 看得到的幾何 + 對應大小的碰撞體（size 約等於物件的寬度） */
function shapeOf(shape: Shape, size: number) {
  const s = size;
  switch (shape) {
    case 'box':
      return { geometry: { box: s }, collider: { shape, halfExtents: { x: s / 2, y: s / 2, z: s / 2 } } };
    case 'sphere':
      return { geometry: { sphere: s / 2 }, collider: { shape, radius: s / 2 } };
    case 'capsule':
      // 膠囊：半徑 + 中間直線段的長度；碰撞體的 halfHeight 是直線段的一半
      return { geometry: { capsule: [s * 0.3, s * 0.6] }, collider: { shape, radius: s * 0.3, halfHeight: s * 0.3 } };
    case 'cylinder':
      return { geometry: { cylinder: [s * 0.4, s * 0.8] }, collider: { shape, radius: s * 0.4, halfHeight: s * 0.4 } };
  }
}

interface BodyOptions {
  shape: Shape;
  size: number;
  material: Material;
  position: Vec3;
  rotation?: Vec3;
  /** 剛體設定；false 表示只有碰撞體（固定不動） */
  body?: Partial<RigidBodyData> | false;
  collider?: Partial<ColliderData>;
}

/** 建立一個有外觀、剛體、碰撞體的實體 */
function body(w: World, o: BodyOptions): Entity {
  const { geometry, collider } = shapeOf(o.shape, o.size);
  const e = spawn.mesh(w, {
    geometry,
    material: o.material,
    position: o.position,
    rotation: o.rotation,
    castShadow: true,
    receiveShadow: true,
  });
  if (o.body !== false) w.add(e, RigidBody, o.body ?? {});
  w.add(e, Collider, { ...collider, ...o.collider });
  return e;
}

/** 固定不動的長方體（牆、斜坡、地墊）：只有碰撞體、沒有剛體 */
function fixedBox(
  w: World,
  size: Vec3,
  position: Vec3,
  material: Material,
  extra: Partial<ColliderData> = {},
  rotation?: Vec3,
): Entity {
  const e = spawn.mesh(w, {
    geometry: { box: size },
    material,
    position,
    rotation,
    castShadow: true,
    receiveShadow: true,
  });
  w.add(e, Collider, { halfExtents: { x: size[0] / 2, y: size[1] / 2, z: size[2] / 2 }, ...extra });
  return e;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

// ───────── ① 剛體 ─────────

const DYNAMIC_COLORS = ['#ffb347', '#ff8c42', '#ffd166', '#f4845f'];
const SHAPES: Shape[] = ['box', 'sphere', 'capsule', 'cylinder'];
const MAX_DROPPED = 150;
let dropped: Entity[] = [];

const bodiesPage: Scene = {
  name: 'bodies',
  setup(w) {
    const cam = camera([0, 8, 11], [0, 0.5, 0]);
    dropped = [];
    // fixed：兩根柱子、一個斜坡
    const stone = '#8a9479';
    for (const x of [-3.5, 3.5]) {
      const pillar = spawn.mesh(w, {
        geometry: { cylinder: [0.4, 2] },
        material: stone,
        position: [x, 1, -3],
        castShadow: true,
      });
      w.add(pillar, Collider, { shape: 'cylinder', radius: 0.4, halfHeight: 1 });
    }
    fixedBox(w, [3, 0.3, 2.4], [0, 1, -4.5], stone, {}, [0.35, 0, 0]);
    // fixed：一圈矮圍欄，讓被擋板推開的東西留在圓盤上
    const FENCE = { radius: 7, segments: 28 };
    for (let i = 0; i < FENCE.segments; i++) {
      const a = (i / FENCE.segments) * Math.PI * 2;
      const pos: Vec3 = [Math.cos(a) * FENCE.radius, 0.3, Math.sin(a) * FENCE.radius];
      fixedBox(w, [1.6, 0.6, 0.25], pos, '#4a5340', {}, [0, -a - Math.PI / 2, 0]);
    }
    // kinematic：會轉的擋板（由程式改 Transform，物理會用它推開別人）
    const sweeper = spawn.mesh(w, {
      geometry: { box: [7, 0.5, 0.3] },
      material: '#4cc9f0',
      position: [0, 0.25, 1],
      castShadow: true,
    });
    w.add(sweeper, RigidBody, { type: 'kinematic' });
    w.add(sweeper, Collider, { halfExtents: { x: 3.5, y: 0.25, z: 0.15 } });

    let angle = 0;
    const sweep = ui.require<UIToggle>('sweep');
    pageUpdate = (dt) => {
      if (sweep.checked) angle += dt * 0.6;
      math.setRotation(w.require(sweeper, Transform), [0, angle, 0]);
    };
    // 數量每 0.25 秒更新一次（文字沒變時不會重畫）
    engine.timers.every(
      0.25,
      () => ui.get<UILabel>('bodyCount')?.setText(String(dropped.filter((e) => w.isAlive(e)).length)),
      { owner: cam },
    );
    drop();
  },
};

/** 從上面丟下 10 個物件 */
function drop(): void {
  const choice = ui.require<UISelect>('shape').value;
  dropped = dropped.filter((e) => world.isAlive(e));
  for (let i = 0; i < 10; i++) {
    const shape = choice === 'mix' ? SHAPES[Math.floor(Math.random() * SHAPES.length)] : (choice as Shape);
    dropped.push(
      body(world, {
        shape,
        size: rand(0.45, 0.8),
        material: DYNAMIC_COLORS[i % DYNAMIC_COLORS.length],
        position: [rand(-3, 3), rand(4, 8), rand(-2.5, 2.5)],
        rotation: [rand(0, 3), rand(0, 3), rand(0, 3)],
      }),
    );
  }
  // 太多時刪掉最舊的
  for (const e of dropped.splice(0, Math.max(0, dropped.length - MAX_DROPPED))) world.destroy(e);
}

// ───────── ② 材質：彈性與摩擦 ─────────

const BOUNCE = [
  { value: 0, note: '不彈', color: '#ff6b6b' },
  { value: 0.5, note: '彈一半', color: '#ffd166' },
  { value: 0.9, note: '很會彈', color: '#9acd32' },
];
const FRICTION = [
  { value: 0, note: '像冰，一路滑下去', color: '#4cc9f0' },
  { value: 0.2, note: '慢慢滑', color: '#b072ff' },
  { value: 0.6, note: '停在原地', color: '#ff6b9a' },
];
ui.setItems('bounceList', BOUNCE);
ui.setItems('frictionList', FRICTION);

/** 滑道的傾斜角度（弧度；約 20°，tan ≈ 0.36：摩擦小於 0.36 才會滑下去） */
const RAMP_ANGLE = -0.35;
let restartMaterials: () => void = () => {};

const materialsPage: Scene = {
  name: 'materials',
  setup(w) {
    camera([0, 4.5, 11], [0, 1.4, 0]);
    // 左邊：三塊地墊（球的下面），右邊：三條滑道；同一組的地墊／滑道和球／箱子用一樣的值
    const ballX = (i: number) => -4.4 + i * 1.3;
    BOUNCE.forEach(({ value }, i) => fixedBox(w, [1, 0.2, 1], [ballX(i), 0.1, 0], '#3a4232', { restitution: value }));
    const cos = Math.cos(RAMP_ANGLE);
    const sin = Math.sin(RAMP_ANGLE);
    const lanes = FRICTION.map(({ value }, i) => {
      const z = (i - 1) * 1.3;
      const center: Vec3 = [3, 1.3, z];
      fixedBox(w, [5, 0.2, 1], center, '#3a4232', { friction: value }, [0, 0, RAMP_ANGLE]);
      // 箱子的起點在滑道上端：滑道的區域座標 (-2, 0.36) 轉成世界座標
      const lx = -2;
      const ly = 0.1 + 0.25 + 0.01;
      return [center[0] + lx * cos - ly * sin, center[1] + lx * sin + ly * cos, z] as Vec3;
    });

    // 球和箱子：重新開始時刪掉舊的、重新建立（滾出圓盤的會被自動刪除，所以不重複使用舊的實體）
    let movers: Entity[] = [];
    restartMaterials = () => {
      for (const e of movers) if (w.isAlive(e)) w.destroy(e);
      movers = [
        ...BOUNCE.map(({ value, color }, i) =>
          body(w, {
            shape: 'sphere',
            size: 0.6,
            material: color,
            position: [ballX(i), 4.5, 0],
            collider: { restitution: value },
          }),
        ),
        ...FRICTION.map(({ value, color }, i) =>
          body(w, {
            shape: 'box',
            size: 0.5,
            material: color,
            position: lanes[i],
            rotation: [0, 0, RAMP_ANGLE],
            collider: { friction: value },
          }),
        ),
      ];
    };
    restartMaterials();
    // 重力：physics.gravity 是整個物理世界共用的
    physics.gravity = { x: 0, y: -ui.require<UISlider>('gravity').value, z: 0 };
  },
  teardown() {
    physics.gravity = { x: 0, y: -GRAVITY, z: 0 };
  },
};

// ───────── ③ 施力與射線 ─────────

const WALL = { columns: 6, rows: 6, size: 0.5, z: -2 };
let wall: Entity[] = [];
let shots: Entity[] = [];
const names = new Map<Entity, string>();

/** 疊一面方塊牆（先刪掉舊的） */
function buildWall(): void {
  for (const e of wall) world.destroy(e);
  wall = [];
  const { columns, rows, size, z } = WALL;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x = (col - (columns - 1) / 2) * size + (row % 2 ? size / 4 : -size / 4);
      const e = body(world, {
        shape: 'box',
        size: size * 0.98,
        material: (row + col) % 2 ? '#ffb347' : '#f4845f',
        position: [x, size / 2 + row * size, z],
      });
      wall.push(e);
      names.set(e, `方塊（第 ${row + 1} 層）`);
    }
  }
}

/** 攝影機位置與滑鼠指向的方向 */
function pointerRay(): { origin: Vector3; dir: Vector3 } | null {
  const cam = render.activeCameraObject;
  if (!cam) return null;
  const origin = cam.getWorldPosition(new Vector3());
  const dir = new Vector3(input.pointer.ndcX, input.pointer.ndcY, 0.5).unproject(cam).sub(origin).normalize();
  return { origin, dir };
}

/** 從攝影機往滑鼠的方向射出一顆球 */
function shoot(): void {
  const ray = pointerRay();
  if (!ray) return;
  const start = ray.origin.clone().addScaledVector(ray.dir, 1);
  const ball = body(world, {
    shape: 'sphere',
    size: 0.36,
    material: '#e9f6d2',
    position: [start.x, start.y, start.z],
    body: { ccd: true }, // 連續碰撞偵測：高速的球不會穿過方塊
    collider: { density: 4 },
  });
  names.set(ball, '射出的球');
  physics.setLinearVelocity(ball, ray.dir.multiplyScalar(ui.require<UISlider>('shotSpeed').value));
  shots.push(ball);
  for (const old of shots.splice(0, Math.max(0, shots.length - 30))) world.destroy(old);
  audio.play('sounds/pop.wav', { volume: 0.4, pitch: 1.3 });
}

/** 從牆的底部中央往外炸：越近的推得越用力 */
function explode(): void {
  const center = new Vector3(0, 0.2, WALL.z + 0.4);
  const radius = 4;
  for (const e of physics.overlapSphere(center, radius)) {
    if (!world.has(e, RigidBody)) continue;
    const away = world.require(e, Transform).position.clone().sub(center);
    const strength = 1.4 * (1 - Math.min(1, away.length() / radius));
    away.normalize().setY(0.8).multiplyScalar(strength);
    physics.applyImpulse(e, away);
    physics.applyTorqueImpulse(e, { x: rand(-0.05, 0.05), y: rand(-0.05, 0.05), z: rand(-0.05, 0.05) });
  }
  audio.play('sounds/bounce.wav', { volume: 0.7, pitch: 0.6 });
}

const forcesPage: Scene = {
  name: 'forces',
  setup(w) {
    camera([0, 3, 8], [0, 1.2, -2]);
    names.clear();
    names.set(ground, '地面');
    wall = [];
    shots = [];
    buildWall();
    // 牆後的擋板：讓被打飛的方塊留在畫面裡
    const back = fixedBox(w, [6, 2, 0.3], [0, 1, -5], '#3a4232');
    names.set(back, '後面的擋板');

    const info = ui.require<UILabel>('rayInfo');
    let press: { x: number; y: number } | null = null;
    pageUpdate = () => {
      // 點一下（按下到放開幾乎沒移動）才射出；拖曳是轉動視角
      if (input.wasPressed('Mouse:Left')) press = { x: input.pointer.x, y: input.pointer.y };
      if (input.wasReleased('Mouse:Left') && press) {
        if (Math.hypot(input.pointer.x - press.x, input.pointer.y - press.y) < 6) shoot();
        press = null;
      }
      // 射線：每幀從攝影機往滑鼠方向打一條，畫出打到的點與法線
      const ray = input.pointer.inside ? pointerRay() : null;
      const hit = ray && physics.raycast(ray.origin, ray.dir, 50);
      if (!hit) {
        info.setText('（沒有打到東西）');
        return;
      }
      render.debug.sphere(hit.point, 0.06, { color: '#ffd166' });
      render.debug.ray(hit.point, hit.normal, 0.7, { color: '#ff6b6b' });
      // 文字只在內容改變時才會重畫（距離取到 0.1）
      info.setText(`${names.get(hit.entity) ?? `實體 ${hit.entity}`}\n距離 ${hit.distance.toFixed(1)} 公尺`);
    };
  },
};

// ───────── ④ 碰撞事件、感應器、碰撞群組 ─────────

/** 碰撞群組編號（0~15） */
const GROUP = { world: 0, plate: 1, orange: 2, cyan: 3 } as const;
/** 青色球：和所有東西碰撞（包含藍板） */
const CYAN_GROUPS = collision.groups([GROUP.cyan], [GROUP.world, GROUP.plate, GROUP.orange, GROUP.cyan]);
/** 橘色球：不和藍板碰撞 → 直接穿過去 */
const ORANGE_GROUPS = collision.groups([GROUP.orange], [GROUP.world, GROUP.orange, GROUP.cyan]);
/** 藍板：只和青色球碰撞（關掉「碰撞群組」時和所有東西碰撞） */
const PLATE_ONLY_CYAN = collision.groups([GROUP.plate], [GROUP.cyan]);
const PLATE_ALL = collision.groups([GROUP.plate], [GROUP.world, GROUP.orange, GROUP.cyan]);

let setPlateGroups: (on: boolean) => void = () => {};

const eventsPage: Scene = {
  name: 'events',
  setup(w) {
    const cam = camera([5, 5.5, 11], [-1, 2.6, 0]);
    // 彈跳球：固定的球形碰撞體，很有彈性；被撞到時閃一下
    const bumperMat = create.material({ standard: { color: '#ff6b9a', roughness: 0.3 } });
    const bumper = body(w, {
      shape: 'sphere',
      size: 1.4,
      material: bumperMat,
      position: [0, 0.7, 0],
      body: false,
      collider: { restitution: 0.9 },
    });
    // 藍板：往左邊傾斜，青色球落在上面會滾到左邊
    const plate = fixedBox(
      w,
      [3, 0.15, 2],
      [-0.6, 3.2, 0],
      { standard: { color: '#4cc9f0', transparent: true, opacity: 0.75 } },
      { groups: PLATE_ONLY_CYAN },
      [0, 0, 0.3],
    );
    setPlateGroups = (on) => (w.require(plate, Collider).groups = on ? PLATE_ONLY_CYAN : PLATE_ALL);
    setPlateGroups(ui.require<UIToggle>('groups').checked);
    // 感應區：只偵測重疊、不會擋住東西
    const zone = spawn.mesh(w, {
      geometry: { box: [2.4, 1, 2.4] },
      material: { standard: { color: '#9acd32', transparent: true, opacity: 0.22, depthWrite: false } },
      position: [-4, 0.5, 0],
    });
    w.add(zone, Collider, { halfExtents: { x: 1.2, y: 0.5, z: 1.2 }, sensor: true });
    // 出球口
    spawn.mesh(w, { geometry: { cylinder: [0.35, 0.4] }, material: '#3a4232', position: [0, 6.6, 0] });

    const balls = new Set<Entity>();
    const cyan = new Set<Entity>();
    let flip = false;
    engine.timers.every(
      0.45,
      () => {
        if (!ui.require<UIToggle>('spout').checked) return;
        flip = !flip;
        const ball = body(w, {
          shape: 'sphere',
          size: 0.36,
          material: flip ? '#4cc9f0' : '#ffb347',
          position: [rand(-0.25, 0.25), 6.2, rand(-0.25, 0.25)],
          collider: { restitution: 0.4, groups: flip ? CYAN_GROUPS : ORANGE_GROUPS },
        });
        balls.add(ball);
        if (flip) cyan.add(ball);
        // 6 秒後自動刪除（綁定實體：球先被刪掉時計時器也會取消）
        engine.timers.after(6, () => world.destroy(ball), { owner: ball });
      },
      { owner: cam },
    );

    // 碰撞事件：a、b 是碰撞的兩個實體（順序不固定），started 是開始或結束
    let bumps = 0;
    let entered = 0;
    let flash = 0;
    const log: string[] = [];
    const addLog = (text: string) => {
      log.unshift(text);
      log.length = Math.min(log.length, 4);
      ui.get<UILabel>('eventLog')?.setText(log.join('\n'));
    };
    pageCollision = (a, b, started) => {
      if (!started) return;
      const other = a === bumper || a === zone ? b : a;
      if (a === bumper || b === bumper) {
        bumps++;
        flash = 1;
        ui.get<UILabel>('bumpCount')?.setText(String(bumps));
        addLog(`💥 ${cyan.has(other) ? '青色' : '橘色'}球撞到彈跳球`);
        audio.play('sounds/bounce.wav', { volume: 0.35, pitch: rand(0.9, 1.2) });
      } else if (a === zone || b === zone) {
        if (!balls.has(other)) return;
        entered++;
        ui.get<UILabel>('sensorCount')?.setText(String(entered));
        addLog(`✓ ${cyan.has(other) ? '青色' : '橘色'}球進入感應區`);
        audio.play('sounds/pop.wav', { volume: 0.4 });
        balls.delete(other);
        world.defer(() => world.destroy(other)); // 事件處理中不要直接刪除，等這一幀結束
      }
    };
    // 彈跳球閃一下：顏色往白色混，慢慢退回去
    const base = new Color('#ff6b9a');
    const white = new Color('#ffffff');
    pageUpdate = (dt) => {
      if (flash <= 0) return;
      flash = Math.max(0, flash - dt * 4);
      bumperMat.color.copy(base).lerp(white, flash * 0.8);
    };
    ui.get<UILabel>('bumpCount')?.setText('0');
    ui.get<UILabel>('sensorCount')?.setText('0');
    ui.get<UILabel>('eventLog')?.setText(' ');
  },
};

// ───────── 分頁切換 ─────────

scenes.register(bodiesPage, materialsPage, forcesPage, eventsPage);
let currentPage = '';
function showPage(name: string): void {
  if (name === currentPage) return;
  pageUpdate = null;
  pageCollision = null;
  currentPage = name;
  // 一般載入（不疊加）：先卸載上一頁，之後按按鈕、計時器建立的物件也算這一頁的，換頁時一起清掉
  //（additive: true 疊加載入時，只有 setup 期間建立的才算）
  scenes.load(name);
}

ui.setHandlers({
  page: () => showPage(ui.require<UIStackView>('pages').selectedPage?.id ?? 'bodies'),
  debug: (e) => (physicsPlugin.debug = (e.target as UIToggle).checked),
  // ① 剛體
  drop: () => drop(),
  clear: () => {
    for (const e of dropped) world.destroy(e);
    dropped = [];
  },
  // ② 材質
  gravity: (e) => (physics.gravity = { x: 0, y: -Number(e.value), z: 0 }),
  restart: () => restartMaterials(),
  // ③ 施力
  explode: () => explode(),
  rebuild: () => buildWall(),
  // ④ 碰撞事件
  groups: (e) => setPlateGroups((e.target as UIToggle).checked),
});

// 效能監視器（FPS、每幀時間、物理的剛體數量）：按 ` 鍵顯示／隱藏，可以拖到畫面任何地方
await new PluginManager(engine, { api: { ui2d } }).install(perfMonitor, { toggleKey: 'Backquote' });

showPage('bodies');
engine.start();
