# @engine/physics 的範例

## Physics
物理世界（`physics`）：施力、設定速度、射線、範圍查詢、碰撞事件。點畫面把所有方塊往上炸飛。

```ts
spawn.camera(world, { position: [0, 6, 10], target: [0, 1, 0] });
spawn.defaultLights(world);
const ground = spawn.mesh(world, { geometry: { box: [12, 0.2, 12] }, material: '#666666', position: [0, -0.1, 0] });
world.add(ground, Collider, { halfExtents: { x: 6, y: 0.1, z: 6 } });
for (let i = 0; i < 12; i++) {
  const e = spawn.mesh(world, { geometry: { box: 0.6 }, material: '#ffa94f', position: [(i % 4) - 1.5, 0.5 + Math.floor(i / 4) * 0.7, 0] });
  world.add(e, RigidBody);
  world.add(e, Collider, { halfExtents: { x: 0.3, y: 0.3, z: 0.3 } });
}
addEventListener('pointerdown', () => {
  const hit = physics.overlapSphere({ x: 0, y: 0, z: 0 }, 5);
  for (const e of hit) if (world.has(e, RigidBody)) physics.applyImpulse(e, { x: (Math.random() - 0.5) * 2, y: 3, z: (Math.random() - 0.5) * 2 });
  console.log('炸飛', hit.length - 1, '個方塊');
});
physics.onCollision((ev) => ev.a === ground && engine.time.frame % 10 === 0 && console.log('落地'));
engine.start();
```

## PhysicsPlugin
物理外掛（手冊的 `physicsPlugin`）。用 `await PhysicsPlugin.create()` 建立（會先載入 Rapier）；`debug` 顯示碰撞形狀的線框。

```ts
spawn.camera(world, { position: [0, 3, 6], target: [0, 0.5, 0] });
spawn.defaultLights(world);
const floor = world.spawn(Transform.at(0, -0.1, 0), Collider.with({ halfExtents: { x: 3, y: 0.1, z: 3 } }));
const ball = spawn.mesh(world, { geometry: { sphere: 0.5 }, material: '#4cc9f0', position: [0, 3, 0] });
world.add(ball, RigidBody);
world.add(ball, Collider, { shape: 'sphere', radius: 0.5, restitution: 0.7 });
physicsPlugin.debug = true; // 看不見的地板也會畫出線框
console.log('外掛：', physicsPlugin.name, '，地板實體：', floor);
engine.start();
```

## Collider
碰撞體：沒有剛體時是固定的（地板、牆）。形狀、大小、摩擦、彈性、感應器。用 lil-gui 調整彈性後按「重新落下」。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 3, 7], target: [0, 1, 0] });
spawn.defaultLights(world);
const floor = spawn.mesh(world, { geometry: { box: [8, 0.2, 4] }, material: '#777777', position: [0, -0.1, 0] });
world.add(floor, Collider, { halfExtents: { x: 4, y: 0.1, z: 2 } });
const shapes = [
  { geometry: { sphere: 0.4 }, collider: { shape: 'sphere' as const, radius: 0.4 } },
  { geometry: { box: 0.7 }, collider: { shape: 'box' as const, halfExtents: { x: 0.35, y: 0.35, z: 0.35 } } },
  { geometry: { capsule: [0.3, 0.5] }, collider: { shape: 'capsule' as const, radius: 0.3, halfHeight: 0.25 } },
];
const params = { restitution: 0.5, friction: 0.5 };
const balls = shapes.map((s, i) => {
  const e = spawn.mesh(world, { geometry: s.geometry, material: '#ffa94f', position: [i * 2 - 2, 3, 0] });
  world.add(e, RigidBody);
  world.add(e, Collider, s.collider);
  return e;
});
const drop = () =>
  balls.forEach((e, i) => {
    Object.assign(world.require(e, Collider), params);
    physics.teleport(e, { x: i * 2 - 2, y: 3, z: 0 });
    physics.setLinearVelocity(e, { x: 0, y: 0, z: 0 });
  });
const gui = new GUI();
gui.add(params, 'restitution', 0, 1, 0.05).name('彈性');
gui.add(params, 'friction', 0, 2, 0.05).name('摩擦');
gui.add({ drop }, 'drop').name('重新落下');
engine.start();
```

## colliderCodec
Collider 在場景檔裡的寫法。

```ts
console.log(colliderCodec.write({ ...Collider.create(), shape: 'sphere', radius: 0.3, restitution: 0.8 }));
```

## collision
`collision.groups`：碰撞群組。「自己屬於哪些群組、會和哪些群組碰撞」。這裡紅球只和地板碰，會穿過藍色方塊。

```ts
spawn.camera(world, { position: [0, 3, 7], target: [0, 1, 0] });
spawn.defaultLights(world);
const FLOOR = 0;
const BLOCK = 1;
const BALL = 2;
world.spawn(Transform.at(0, -0.1, 0), Collider.with({ halfExtents: { x: 4, y: 0.1, z: 4 }, groups: collision.groups([FLOOR], [BALL, BLOCK]) }));
const block = spawn.mesh(world, { geometry: { box: [2, 0.2, 2] }, material: '#4cc9f0', position: [0, 1.2, 0] });
world.add(block, Collider, { halfExtents: { x: 1, y: 0.1, z: 1 }, groups: collision.groups([BLOCK], [FLOOR]) });
const ball = spawn.mesh(world, { geometry: { sphere: 0.3 }, material: '#ff6b6b', position: [0, 3, 0] });
world.add(ball, RigidBody);
world.add(ball, Collider, { shape: 'sphere', radius: 0.3, groups: collision.groups([BALL], [FLOOR]) });
console.log('群組數值：', collision.groups([BALL], [FLOOR]).toString(16));
engine.start();
```

## load
`load.rapier`：載入物理引擎 Rapier（`PhysicsPlugin.create()` 會自動呼叫；自己建立 `Physics` 時用）。

```ts
const rapier = await load.rapier();
console.log('Rapier 版本：', rapier.version());
```

## PHYSICS_STEP_PRIORITY
物理更新在 fixedUpdate 的順序：你在 fixedUpdate（預設 0）施的力，這一步就生效。

```ts
console.log('物理更新：', PHYSICS_STEP_PRIORITY, '，腳本的 onFixedUpdate：', SCRIPT_FIXED_PRIORITY);
```

## PHYSICS_WRITE_PRIORITY
把剛體的位置寫回 Transform 在 lateUpdate 的順序（變換計算之前）。

```ts
console.log('寫回 Transform：', PHYSICS_WRITE_PRIORITY, '→ 變換計算：', TRANSFORM_PRIORITY);
```

## PhysicsKey
系統裡用 `world.requireResource(PhysicsKey)` 取得物理世界。

```ts
const p = world.requireResource(PhysicsKey);
console.log('和 physics 同一個：', p === physics, '，重力：', p.gravity);
```

## RigidBody
剛體：讓實體受物理模擬。`dynamic` 受力、`fixed` 不動、`kinematic` 由程式移動（會推開其他物體）。這裡旋轉的 kinematic 擋板推著球。

```ts
spawn.camera(world, { position: [0, 6, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
world.spawn(Transform.at(0, -0.1, 0), Collider.with({ halfExtents: { x: 4, y: 0.1, z: 4 } }));
spawn.grid(world, { size: 8, divisions: 8 });
const paddle = spawn.mesh(world, { geometry: { box: [3, 0.4, 0.2] }, material: '#4cc9f0', position: [0, 0.2, 0] });
world.add(paddle, RigidBody, { type: 'kinematic' });
world.add(paddle, Collider, { halfExtents: { x: 1.5, y: 0.2, z: 0.1 } });
for (let i = 0; i < 8; i++) {
  const b = spawn.mesh(world, { geometry: { sphere: 0.2 }, material: '#ffd166', position: [Math.cos(i) * 1.2, 0.2, Math.sin(i) * 1.2] });
  world.add(b, RigidBody, { linearDamping: 0.5 });
  world.add(b, Collider, { shape: 'sphere', radius: 0.2 });
}
engine.on('fixedUpdate', (t) => math.setRotation(world.require(paddle, Transform), [0, t.elapsed * 1.5, 0]));
engine.start();
```

## rigidBodyCodec
RigidBody 在場景檔裡的寫法。

```ts
console.log(rigidBodyCodec.write({ ...RigidBody.create(), type: 'dynamic', gravityScale: 0.5, rotations: { x: false, y: true, z: false } }));
```

## ColliderData
Collider 的資料：形狀與大小、位移、摩擦、彈性、密度、感應器、碰撞群組、是否回報事件。

```ts
const data: ColliderData = Collider.create();
console.log('預設形狀', data.shape, '，半邊長', data.halfExtents, '，摩擦', data.friction, '，彈性', data.restitution);
```

## CollisionEvent
碰撞事件：哪兩個實體、開始或結束、是否是感應器。這裡金幣是感應器，球滾過去就撿起來。

```ts
spawn.camera(world, { position: [0, 4, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
world.spawn(Transform.at(0, -0.1, 0), Collider.with({ halfExtents: { x: 5, y: 0.1, z: 5 } }));
const coin = spawn.mesh(world, { geometry: { cylinder: [0.3, 0.08] }, material: '#ffd166', position: [1.5, 0.3, 0], rotation: [Math.PI / 2, 0, 0] });
world.add(coin, Collider, { shape: 'cylinder', radius: 0.3, halfHeight: 0.04, sensor: true });
const ball = spawn.mesh(world, { geometry: { sphere: 0.3 }, material: '#ff6b6b', position: [-2, 0.3, 0] });
world.add(ball, RigidBody);
world.add(ball, Collider, { shape: 'sphere', radius: 0.3 });
physics.onCollision((ev: CollisionEvent) => {
  console.log(ev.started ? '開始' : '結束', ev.sensor ? '（感應器）' : '');
  if (ev.started && ev.sensor) world.defer(() => world.destroy(coin));
});
engine.timers.after(0.3, () => physics.setLinearVelocity(ball, { x: 3, y: 0, z: 0 }));
engine.start();
```

## PhysicsHit
`physics.raycast` 的結果：打到的實體、位置、表面方向、距離。這裡從上往下打，畫出打到的位置與法線。

```ts
spawn.camera(world, { position: [0, 4, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
const ramp = spawn.mesh(world, { geometry: { box: [4, 0.2, 2] }, material: '#888888', rotation: [0, 0, 0.4] });
world.add(ramp, Collider, { halfExtents: { x: 2, y: 0.1, z: 1 } });
engine.on('update', (t) => {
  const origin = { x: Math.sin(t.elapsed) * 1.8, y: 3, z: 0 };
  const hit: PhysicsHit | null = physics.raycast(origin, { x: 0, y: -1, z: 0 }, 10);
  if (!hit) return;
  render.debug.line([origin.x, origin.y, origin.z], hit.point, { color: '#ffd166' });
  render.debug.ray(hit.point, hit.normal, 0.8, { color: '#ff6b6b' });
  if (t.frame % 30 === 0) console.log('距離', hit.distance.toFixed(2), '法線', hit.normal.toArray().map((n) => n.toFixed(2)));
});
engine.start();
```

## PhysicsOptions
`PhysicsPlugin.create(options)` 的設定：重力、畫面插值、除錯線框。執行中也可以改 `physics.gravity`。用 lil-gui 調整重力。

```ts
import GUI from 'lil-gui';

const options: PhysicsOptions = { gravity: { x: 0, y: -9.81, z: 0 }, interpolate: true, debug: false };
console.log('建立時的設定：', options);
spawn.camera(world, { position: [0, 3, 7], target: [0, 1, 0] });
spawn.defaultLights(world);
world.spawn(Transform.at(0, -0.1, 0), Collider.with({ halfExtents: { x: 4, y: 0.1, z: 4 } }));
const ball = spawn.mesh(world, { geometry: { sphere: 0.4 }, material: '#9acd32', position: [0, 3, 0] });
world.add(ball, RigidBody);
world.add(ball, Collider, { shape: 'sphere', radius: 0.4, restitution: 0.9 });
const gui = new GUI();
gui.add(physics.gravity, 'y', -20, 5, 0.1).name('重力 Y');
gui.add(physics.gravity, 'x', -5, 5, 0.1).name('重力 X');
engine.start();
```

## RaycastOptions
射線的設定：忽略某個實體（例如從角色自己身上發出）、打不打得到感應器、只打某些群組。

```ts
const self = world.spawn(Transform.at(0, 0, 0), Collider.with({ shape: 'sphere', radius: 0.5 }));
const wall = world.spawn(Transform.at(3, 0, 0), Collider.with({ halfExtents: { x: 0.1, y: 1, z: 1 } }));
physics.flush();
const options: RaycastOptions = { exclude: self };
console.log('不排除自己：', physics.raycast({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })?.entity === self ? '打到自己' : '打到牆');
console.log('排除自己：', physics.raycast({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10, options)?.entity === wall ? '打到牆' : '?');
```

## RigidBodyData
剛體的資料：種類、阻力、重力倍率、高速偵測、可旋轉的軸、休眠。用 lil-gui 調整。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 3, 7], target: [0, 1, 0] });
spawn.defaultLights(world);
world.spawn(Transform.at(0, -0.1, 0), Collider.with({ halfExtents: { x: 5, y: 0.1, z: 5 } }));
const box = spawn.mesh(world, { geometry: { box: 0.8 }, material: '#ff6b6b', position: [0, 2, 0] });
const body: RigidBodyData = world.add(box, RigidBody);
world.add(box, Collider, { halfExtents: { x: 0.4, y: 0.4, z: 0.4 } });
const gui = new GUI();
gui.add(body, 'gravityScale', -1, 3, 0.1).name('重力倍率');
gui.add(body, 'linearDamping', 0, 5, 0.1).name('移動阻力');
gui.add(body, 'angularDamping', 0, 5, 0.1).name('旋轉阻力');
const kick = () => {
  physics.applyImpulse(box, { x: 0, y: 4, z: 0 });
  physics.applyTorqueImpulse(box, { x: 0.5, y: 1, z: 0 });
};
gui.add({ kick }, 'kick').name('踢一下');
engine.start();
```

## Vec3
三維向量 `{ x, y, z }`（Vector3 也可以），物理的參數都用它。

```ts
const v: Vec3 = { x: 1, y: 5, z: 0 };
const e = world.spawn(Transform.at(0, 2, 0), RigidBody, Collider);
physics.flush();
physics.setLinearVelocity(e, v);
console.log('速度：', physics.getLinearVelocity(e).toArray());
```

## ColliderShape
碰撞形狀：方塊、球、膠囊、圓柱、圓錐、凸包、三角網格（後兩個用網格的形狀）。

```ts
spawn.camera(world, { position: [0, 4, 8], target: [0, 0, 0] });
spawn.defaultLights(world);
world.spawn(Transform.at(0, -0.1, 0), Collider.with({ halfExtents: { x: 6, y: 0.1, z: 3 } }));
const list: [ColliderShape, GeometryDesc][] = [
  ['box', { box: 0.8 }], ['sphere', { sphere: 0.4 }], ['capsule', { capsule: [0.3, 0.4] }],
  ['cylinder', { cylinder: [0.4, 0.8] }], ['cone', { cone: [0.4, 0.8] }], ['convexHull', { icosahedron: 0.5 }],
];
list.forEach(([shape, geometry], i) => {
  const e = spawn.mesh(world, { geometry, material: `hsl(${i * 60}, 70%, 60%)`, position: [i * 1.4 - 3.5, 2 + i * 0.3, 0], rotation: [0.5, 0, 0.3] });
  world.add(e, RigidBody);
  world.add(e, Collider, { shape, radius: 0.4, halfHeight: shape === 'capsule' ? 0.2 : 0.4, halfExtents: { x: 0.4, y: 0.4, z: 0.4 } });
});
engine.start();
```

## RapierModule
Rapier 模組的型別（`load.rapier()` 的結果）。進階用途可以直接用 Rapier 的 API。

```ts
const rapier: RapierModule = await load.rapier();
const body = physics.bodyOf(world.spawn(Transform.at(0, 1, 0), RigidBody, Collider)) ?? (physics.flush(), null);
console.log('Rapier 的剛體種類：', Object.keys(rapier.RigidBodyType).filter((k) => isNaN(Number(k))), body);
```

## RigidBodyType
剛體種類：`dynamic` 受力與重力、`fixed` 不動、`kinematic` 由程式移動。

```ts
spawn.camera(world, { position: [0, 2, 6], target: [0, 1, 0] });
spawn.defaultLights(world);
const types: RigidBodyType[] = ['dynamic', 'fixed', 'kinematic'];
types.forEach((type, i) => {
  const e = spawn.mesh(world, { geometry: { box: 0.6 }, material: ['#ff6b6b', '#888888', '#4cc9f0'][i], position: [i * 1.5 - 1.5, 2, 0] });
  world.add(e, RigidBody, { type });
  world.add(e, Collider, { halfExtents: { x: 0.3, y: 0.3, z: 0.3 } });
});
console.log('紅：dynamic 會掉下去；灰：fixed 不動；藍：kinematic 不受重力，由程式移動');
engine.start();
```
