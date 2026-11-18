import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin, type Entity } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import { Collider, PhysicsPlugin, RigidBody, collision, load, type CollisionEvent } from '../src/physics';
import { fakeScheduler } from './helpers';

beforeAll(async () => {
  await load.rapier();
});

async function setup(options: { interpolate?: boolean } = {}) {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const scene = new ScenePlugin();
  const plugin = await PhysicsPlugin.create({ interpolate: options.interpolate ?? false });
  const engine = new Engine({
    scheduler: clock.scheduler,
    fixedDelta: 1 / 60,
    maxDelta: 0.25,
    maxFixedSteps: 20,
    pauseOnHidden: false,
  });
  engine.use(ecs).use(scene).use(plugin);
  engine.start();
  const world = ecs.world;
  /** 推進 n 秒（每幀 1/60 秒） */
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) clock.frame(1000 / 60);
  };
  const spawnAt = (x: number, y: number, z: number, ...rest: Parameters<typeof world.spawn>) => {
    const e = world.spawn(...rest);
    world.add(e, Transform).position.set(x, y, z);
    return e;
  };
  /** 地板：固定的大方塊，頂面在 y = 0 */
  const floor = () =>
    spawnAt(0, -0.5, 0, RigidBody.with({ type: 'fixed' }), Collider.with({ halfExtents: { x: 20, y: 0.5, z: 20 } }));
  return { clock, world, physics: plugin.physics, plugin, scene, engine, run, spawnAt, floor };
}

describe('剛體與碰撞', () => {
  test('受重力落下，停在地板上，位置寫回 Transform', async () => {
    const { world, run, spawnAt, floor } = await setup();
    floor();
    const ball = spawnAt(0, 5, 0, RigidBody.with({}), Collider.with({ shape: 'sphere', radius: 0.5 }));
    run(0.5);
    const y = world.get(ball, Transform)!.position.y;
    expect(y).toBeLessThan(5);
    expect(y).toBeGreaterThan(0.5);
    run(3);
    expect(world.get(ball, Transform)!.position.y).toBeCloseTo(0.5, 1);
  });

  test('世界縮放會套用到碰撞體大小', async () => {
    const { world, run, spawnAt, floor } = await setup();
    floor();
    const box = spawnAt(0, 3, 0, RigidBody.with({}), Collider);
    world.get(box, Transform)!.scale.set(2, 2, 2); // 方塊變成邊長 2
    run(3);
    expect(world.get(box, Transform)!.position.y).toBeCloseTo(1, 1);
  });

  test('固定碰撞體（沒有剛體）、組合形狀（子節點的碰撞體附著到父剛體）', async () => {
    const { world, run, spawnAt, scene } = await setup();
    spawnAt(0, -0.5, 0, Collider.with({ halfExtents: { x: 20, y: 0.5, z: 20 } })); // 沒有剛體的地板
    const body = spawnAt(0, 3, 0, RigidBody.with({}), Collider.with({ shape: 'sphere', radius: 0.5 }));
    // 子節點：在父剛體下方 1.5 的小方塊 → 整體落地時由它支撐
    const foot = world.spawn(Collider.with({ halfExtents: { x: 0.25, y: 0.25, z: 0.25 } }));
    world.add(foot, Transform).position.set(0, -1.5, 0);
    scene.hierarchy.setParent(foot, body);
    run(3);
    // 球心高度 = 腳的半高 0.25 + 1.5
    expect(world.get(body, Transform)!.position.y).toBeCloseTo(1.75, 1);
  });

  test('運動學剛體跟隨 Transform 並推開動態物體', async () => {
    const { world, run, spawnAt } = await setup();
    const pusher = spawnAt(-3, 0.5, 0, RigidBody.with({ type: 'kinematic' }), Collider);
    const box = spawnAt(0, 0.5, 0, RigidBody.with({ gravityScale: 0 }), Collider);
    for (let i = 0; i < 60; i++) {
      world.get(pusher, Transform)!.position.x += 3 / 60;
      run(1 / 60);
    }
    expect(world.get(pusher, Transform)!.position.x).toBeCloseTo(0, 5);
    expect(world.get(box, Transform)!.position.x).toBeGreaterThan(0.5);
  });

  test('手動改動態剛體的 Transform 會搬移剛體；teleport 也可以', async () => {
    const { world, run, spawnAt, physics } = await setup();
    const e = spawnAt(0, 0, 0, RigidBody.with({ gravityScale: 0 }), Collider);
    run(0.1);
    world.get(e, Transform)!.position.set(10, 0, 0);
    run(0.1);
    expect(physics.bodyOf(e)!.translation().x).toBeCloseTo(10, 5);
    physics.teleport(e, { x: -4, y: 2, z: 0 });
    expect(world.get(e, Transform)!.position.toArray()).toEqual([-4, 2, 0]);
    run(0.1);
    expect(physics.bodyOf(e)!.translation().x).toBeCloseTo(-4, 5);
  });

  test('衝量、速度、旋轉鎖定', async () => {
    const { world, run, spawnAt, physics } = await setup();
    const e = spawnAt(
      0,
      0,
      0,
      RigidBody.with({ gravityScale: 0, rotations: { x: false, y: false, z: false } }),
      Collider,
    );
    physics.applyImpulse(e, { x: 2, y: 0, z: 0 }); // 質量 1（邊長 1、密度 1）→ 速度 2
    expect(physics.getLinearVelocity(e).x).toBeCloseTo(2, 3);
    physics.applyTorqueImpulse(e, { x: 0, y: 5, z: 0 });
    run(1);
    expect(world.get(e, Transform)!.position.x).toBeCloseTo(2, 1);
    expect(world.get(e, Transform)!.rotation.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 5);
    expect(() => physics.applyImpulse(world.create(), { x: 1, y: 0, z: 0 })).toThrow(/沒有剛體/);
  });

  test('移除元件、銷毀實體會清掉物理物件；移除剛體後碰撞體變成固定的', async () => {
    const { world, run, spawnAt, physics } = await setup();
    const e = spawnAt(0, 5, 0, RigidBody.with({}), Collider);
    run(0.1);
    expect(physics.world.bodies.len()).toBe(1);
    world.remove(e, RigidBody);
    expect(physics.world.bodies.len()).toBe(0);
    run(0.1);
    expect(physics.colliderOf(e)).toBeDefined(); // 重新建立成固定碰撞體
    const y = world.get(e, Transform)!.position.y;
    run(0.5);
    expect(world.get(e, Transform)!.position.y).toBe(y); // 不再落下
    world.destroy(e);
    expect(physics.world.colliders.len()).toBe(0);
  });
});

describe('事件與查詢', () => {
  test('碰撞開始／結束事件、感應器', async () => {
    const { run, spawnAt, physics, floor } = await setup();
    const ground = floor();
    const zone = spawnAt(0, 2, 0, Collider.with({ sensor: true, halfExtents: { x: 1, y: 0.5, z: 1 } }));
    const ball = spawnAt(0, 4, 0, RigidBody.with({}), Collider.with({ shape: 'sphere', radius: 0.25 }));
    const events: CollisionEvent[] = [];
    physics.onCollision((ev) => events.push(ev));
    run(2);
    const involving = (x: Entity) => events.filter((ev) => ev.a === x || ev.b === x);
    const sensorEvents = involving(zone);
    expect(sensorEvents.map((ev) => [ev.started, ev.sensor])).toEqual([
      [true, true],
      [false, true],
    ]); // 穿過感應區
    expect(involving(ground).some((ev) => ev.started && !ev.sensor && (ev.a === ball || ev.b === ball))).toBe(true);
  });

  test('collisions 只保留這一幀的事件', async () => {
    const { run, spawnAt, physics, floor } = await setup();
    floor();
    spawnAt(0, 0.6, 0, RigidBody.with({}), Collider);
    let total = 0;
    for (let i = 0; i < 60; i++) {
      run(1 / 60);
      total += physics.collisions.length;
      if (physics.collisions.length > 0) expect(physics.collisions.every((c) => c.started)).toBe(true);
    }
    expect(total).toBe(1);
  });

  test('射線與球形重疊查詢', async () => {
    const { run, spawnAt, physics } = await setup();
    const near = spawnAt(0, 0, -3, RigidBody.with({ type: 'fixed' }), Collider);
    const far = spawnAt(0, 0, -6, RigidBody.with({ type: 'fixed' }), Collider);
    const trigger = spawnAt(0, 0, -1, Collider.with({ sensor: true }));
    run(1 / 60);
    const hit = physics.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })!;
    expect(hit.entity).toBe(near);
    expect(hit.distance).toBeCloseTo(2.5, 5);
    expect(hit.normal.z).toBeCloseTo(1, 5);
    expect(physics.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 1000, { exclude: near })!.entity).toBe(far);
    expect(physics.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 1000, { includeSensors: true })!.entity).toBe(
      trigger,
    );
    expect(physics.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 2)).toBeNull();
    expect(physics.overlapSphere({ x: 0, y: 0, z: -4.5 }, 1.2).sort()).toEqual([near, far].sort());
  });

  test('碰撞群組', async () => {
    const { world, run, spawnAt } = await setup();
    const GROUND = 0,
      GHOST = 1;
    spawnAt(
      0,
      -0.5,
      0,
      Collider.with({ halfExtents: { x: 20, y: 0.5, z: 20 }, groups: collision.groups([GROUND], [0, 2]) }),
    );
    const ghost = spawnAt(0, 1, 0, RigidBody.with({}), Collider.with({ groups: collision.groups([GHOST], [2]) }));
    run(1);
    expect(world.get(ghost, Transform)!.position.y).toBeLessThan(-1); // 穿過地板
    expect(() => collision.groups([16], [])).toThrow(/0~15/);
  });
});

describe('插值', () => {
  test('畫面姿態介於上一步與這一步之間', async () => {
    const { world, clock, physics, spawnAt } = await setup({ interpolate: true });
    const e = spawnAt(0, 0, 0, RigidBody.with({ gravityScale: 0 }), Collider);
    clock.frame(1000 / 60);
    physics.setLinearVelocity(e, { x: 60, y: 0, z: 0 }); // 每步移動 1
    clock.frame(1000 / 60); // 一步：0 → 1，alpha 約 0
    clock.frame((1000 / 60) * 0.5); // 不足一步：alpha 約 0.5
    const x = world.get(e, Transform)!.position.x;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(1);
  });
});

describe('flush', () => {
  test('flush 後不必等物理更新，查詢就找得到新物件', async () => {
    const { physics, spawnAt } = await setup();
    const wall = spawnAt(0, 0, -3, RigidBody.with({ type: 'fixed' }), Collider);
    physics.flush();
    expect(physics.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })?.entity).toBe(wall);
  });
});
