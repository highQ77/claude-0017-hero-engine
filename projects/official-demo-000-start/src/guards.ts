/**
 * AI：巡邏的守衛（行為樹 + 找路 + 視覺），以及導航網格。
 */
import { BT, type BTContext, BehaviorTree, Brain, NavGrid, PathFollower, SteeringAgent, sense } from '@engine/ai';
import type { Entity, World } from '@engine/ecs';
import { Vector3 } from '@engine/math';
import { Collider, RigidBody } from '@engine/physics';
import { type MaterialDesc, MeshRenderer, type MeshStandardMaterial, SceneObject, create, spawn } from '@engine/render';
import { Transform } from '@engine/scene';
import { Text3D } from '@engine/text3d';
import { MinimapMarker } from '@engine/ui2d';
import { ai, audio, physics, tweens } from './engine';
import { state } from './state';

/** 導航網格的線框（和碰撞形狀一起顯示）：場景裡的實體，換場景時一起移除 */
let navDebug: Entity | null = null;

/** 依目前場景的碰撞體烘焙導航網格（金字塔等固定物體會被避開） */
export function bakeNavGrid(world: World, visible: boolean): void {
  const grid = new NavGrid({ min: { x: -9.5, z: -9.5 }, max: { x: 9.5, z: 9.5 }, cellSize: 0.5, y: -0.6 });
  grid.bakeFromPhysics(physics, world, { probeY: -0.7, agentRadius: 0.4 });
  ai.navGrid = grid;
  navDebug = world.spawn(Transform, SceneObject.with({ object: grid.createDebugMesh(), visible }));
}

/** 顯示／隱藏導航網格 */
export function setNavDebugVisible(world: World, visible: boolean): void {
  const obj = navDebug !== null ? world.get(navDebug, SceneObject) : undefined;
  if (obj) obj.visible = visible;
}

// ───────── 守衛 ─────────

interface GuardMemory {
  waypoints: Vector3[];
  next: number;
  material: MeshStandardMaterial;
  [key: string]: unknown;
}

const visorMaterial: MaterialDesc = { standard: { color: '#111111', emissive: '#88ddff', emissiveIntensity: 3 } };
const CALM = { color: 0x2a5cff, intensity: 0.6, speed: 1.8 };
const ALERT = { color: 0xff2a2a, intensity: 2.5, speed: 3.2 };

/**
 * 守衛的行為樹（每個守衛各自一棵）。由上到下依優先順序：
 * 1. 撲擊：方塊就在身邊 → 把方塊撞得變形（2 秒冷卻）
 * 2. 追逐：看得到方塊 → 找路追過去（眼睛變紅）
 * 3. 巡邏：依序走到每個巡邏點，停一下（眼睛是藍色）
 */
function guardTree(): BehaviorTree<GuardMemory> {
  type Ctx = BTContext<GuardMemory>;
  const agent = (c: Ctx) => c.world.require(c.entity, SteeringAgent);
  const follow = (c: Ctx) => c.world.require(c.entity, PathFollower);
  const mood = (c: Ctx, m: typeof CALM) => {
    c.blackboard.material.emissive.setHex(m.color);
    c.blackboard.material.emissiveIntensity = m.intensity;
    agent(c).maxSpeed = m.speed;
  };
  const near = (c: Ctx) => state.player !== null && sense.distance(c.world, c.entity, state.player) < 1.3;
  const sees = (c: Ctx) =>
    state.player !== null && sense.canSee(c.world, c.entity, state.player, { range: 7, fov: 110, eyeHeight: 0.3 });

  return new BehaviorTree(
    BT.selector<GuardMemory>(
      BT.cooldown(
        2,
        BT.sequence(
          BT.condition(near, '在旁邊？'),
          BT.action((c) => {
            const scale = c.world.require(state.player!, Transform).scale;
            tweens.killTweensOf(scale);
            tweens.play(
              tweens
                .timeline()
                .to(scale, { x: 0.6, y: 1.5, z: 0.6 }, { duration: 0.08 })
                .to(scale, { x: 1, y: 1, z: 1 }, { duration: 0.5, easing: 'elasticOut' }),
              { entity: state.player! },
            );
            audio.play('sounds/pop.wav', { pitch: 0.5, volume: 0.8 });
          }, '撲擊'),
        ),
      ),
      BT.sequence(
        BT.condition(sees, '看得到方塊？'),
        BT.action((c) => {
          mood(c, ALERT);
          follow(c).destination = null;
          follow(c).targetEntity = state.player;
          return 'running';
        }, '追逐'),
      ),
      BT.sequence(
        BT.action((c) => {
          mood(c, CALM);
          const f = follow(c);
          f.targetEntity = null;
          const wp = c.blackboard.waypoints[c.blackboard.next];
          if (f.destination?.x !== wp.x || f.destination?.z !== wp.z) f.destination = { x: wp.x, y: wp.y, z: wp.z };
          return f.status === 'arrived' ? 'success' : 'running';
        }, '巡邏'),
        BT.wait(1),
        BT.action((c) => {
          c.blackboard.next = (c.blackboard.next + 1) % c.blackboard.waypoints.length;
        }, '下一個巡邏點'),
      ),
    ),
  );
}

/** 建立一個依序走過巡邏點（[x, z]）的守衛 */
export function spawnGuard(world: World, waypoints: [number, number][]): Entity {
  // 每隻守衛各一份材質（create.material 不共用）：行為樹會依狀態改它的發光顏色
  const material = create.material({
    standard: { color: 0x5a6070, roughness: 0.5, emissive: CALM.color, emissiveIntensity: CALM.intensity },
  });
  const points = waypoints.map(([x, z]) => new Vector3(x, -0.6, z));
  const guard = spawn.entity(
    world,
    { position: points[0] },
    MeshRenderer.with({ geometry: { capsule: [0.3, 0.6] }, material, castShadow: true }),
    RigidBody.with({ type: 'kinematic' }), // 由 AI 移動，會推開球和箱子
    Collider.with({ shape: 'capsule', radius: 0.3, halfHeight: 0.3 }),
    SteeringAgent.with({ maxSpeed: CALM.speed, maxForce: 12, separation: 2, separationRadius: 1.2 }),
    PathFollower,
    Brain.with({ tree: guardTree() as BehaviorTree<object>, blackboard: { waypoints: points, next: 0, material } }),
    MinimapMarker.with({ color: '#ff5a5a', shape: 'arrow', showHeading: true, size: 6 }),
  );
  // 面罩：看得出守衛面向哪裡（-Z 為前方）
  spawn.mesh(world, {
    geometry: { box: [0.36, 0.1, 0.12] },
    material: visorMaterial,
    position: [0, 0.28, -0.26],
    parent: guard,
  });
  spawn.entity(
    world,
    { position: [0, 0.75, 0], parent: guard },
    Text3D.with({
      mode: 'flat',
      text: '守衛',
      size: 0.22,
      billboard: true,
      anchorY: 'bottom',
      color: 0xffffff,
      background: 'rgba(10,14,22,0.65)',
      padding: 0.3,
    }),
  );
  return guard;
}
