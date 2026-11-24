import * as THREE from 'three';
import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, Entity, World } from '../ecs';
import { PhysicsKey } from '../physics/keys';
import { RigidBody } from '../physics/components';
import { Parent, Transform, type TransformData } from '../scene';
import { Brain, PathFollower, SteeringAgent } from './components';
import type { NavGrid } from './NavGrid';
import { arrive, evade, flee, pursue, seek, separation, truncate, wander } from './steering';
import { NavGridKey } from './keys';
import { registerSceneSettings } from '../scene/SceneFile';
import { aiSettings } from './sceneSettings';
export { NavGridKey } from './keys';

/** update 階段的順序：大腦（決定要做什麼）→ 找路 → 轉向移動 */
export const BRAIN_PRIORITY = 250;
/** 找路系統在 update 階段的優先度 */
export const PATH_PRIORITY = 280;
/** 轉向系統在 update 階段的優先度（在找路之後） */
export const STEERING_PRIORITY = 300;

const _pos = new THREE.Vector3();
const _target = new THREE.Vector3();
const _force = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _targetVel = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * AI 外掛：行為樹大腦、導航網格找路、轉向移動。需先安裝 EcsPlugin 與 ScenePlugin。
 * 有 PhysicsPlugin 時，動態剛體的角色會用物理速度移動。
 */
export class AIPlugin implements Plugin {
  readonly name = 'ai';
  readonly dependencies = ['ecs', 'scene'] as const;
  private ecs: EcsPlugin | null = null;
  private world: World | null = null;
  private pendingGrid: NavGrid | null = null;
  private readonly lastRepath = new Map<Entity, { time: number; target: THREE.Vector3 }>();
  private elapsed = 0;
  private offRemove: (() => void) | null = null;
  /** 取消登記場景設定 */
  private offSettings: () => void = () => {};

  /** 設定或取得導航網格 */
  get navGrid(): NavGrid | null {
    return this.world?.getResource(NavGridKey) ?? this.pendingGrid;
  }

  set navGrid(grid: NavGrid | null) {
    if (!this.world) {
      this.pendingGrid = grid;
      return;
    }
    if (grid) this.world.setResource(NavGridKey, grid);
    else this.world.removeResource(NavGridKey);
    // 網格改變：所有角色重新找路
    this.lastRepath.clear();
  }

  /**
   * @param engine 引擎
   */
  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    this.ecs = ecs;
    this.world = ecs.world;
    if (this.pendingGrid) this.navGrid = this.pendingGrid;
    this.offSettings = registerSceneSettings(ecs.world, aiSettings(this));
    this.offRemove = ecs.world.onRemove(PathFollower, (e) => this.lastRepath.delete(e));
    ecs.addSystem({ name: 'ai-brain', priority: BRAIN_PRIORITY, run: (w, t) => this.updateBrains(w, t.delta) });
    ecs.addSystem({ name: 'ai-path', priority: PATH_PRIORITY, run: (w, t) => this.updatePaths(w, t.delta) });
    ecs.addSystem({ name: 'ai-steering', priority: STEERING_PRIORITY, run: (w, t) => this.updateSteering(w, t.delta) });
  }

  uninstall(): void {
    this.ecs?.removeSystem('ai-steering').removeSystem('ai-path').removeSystem('ai-brain');
    this.offRemove?.();
    this.offSettings();
    this.offSettings = () => {};
    this.lastRepath.clear();
    this.ecs = this.world = null;
  }

  // ───────── 大腦 ─────────

  private updateBrains(world: World, dt: number): void {
    world.query([Brain]).each((entity, brain) => {
      if (!brain.enabled || !brain.tree) return;
      let step = dt;
      if (brain.tickRate > 0) {
        brain.accumulator += dt;
        const interval = 1 / brain.tickRate;
        if (brain.accumulator + 1e-9 < interval) return; // 容許浮點誤差
        step = brain.accumulator;
        brain.accumulator = 0;
      }
      brain.status = brain.tree.tick({ entity, world, dt: step, blackboard: brain.blackboard });
    });
  }

  // ───────── 找路 ─────────

  private updatePaths(world: World, dt: number): void {
    this.elapsed += dt;
    const grid = world.getResource(NavGridKey);
    world.query([PathFollower, SteeringAgent, Transform]).each((e, pf, agent, t) => {
      // 目標位置
      let goal: THREE.Vector3 | null = null;
      if (pf.targetEntity !== null) {
        const tt = world.get(pf.targetEntity, Transform);
        if (tt) goal = worldPosition(world, pf.targetEntity, tt, _target);
        else pf.targetEntity = null; // 目標已消失
      }
      if (!goal && pf.destination) goal = _target.set(pf.destination.x, pf.destination.y, pf.destination.z);
      if (!goal) {
        if (pf.status !== 'idle') this.stop(pf, agent);
        return;
      }
      if (!grid) return; // 還沒有導航網格

      worldPosition(world, e, t, _pos);
      const last = this.lastRepath.get(e);
      const needRepath =
        !last ||
        pf.status === 'idle' ||
        (this.elapsed - last.time >= pf.repathInterval && last.target.distanceTo(goal) > pf.repathDistance);
      if (needRepath) {
        const path = grid.findPath(_pos, goal);
        this.lastRepath.set(e, { time: this.elapsed, target: goal.clone() });
        if (!path) {
          pf.path = [];
          pf.status = 'unreachable';
          agent.mode = 'idle';
          agent.target = null;
          return;
        }
        pf.path = path;
        pf.index = path.length > 1 ? 1 : 0; // 第 0 點是自己的位置
        pf.status = 'moving';
      }
      if (pf.status !== 'moving' && pf.status !== 'arrived') return;

      // 經過路徑點就換下一個
      while (pf.index < pf.path.length - 1 && horizontalDistance(_pos, pf.path[pf.index]) < pf.waypointRadius)
        pf.index++;
      const isLast = pf.index >= pf.path.length - 1;
      const waypoint = pf.path[pf.index];
      agent.targetEntity = null;
      agent.target = { x: waypoint.x, y: _pos.y, z: waypoint.z };
      agent.mode = isLast ? 'arrive' : 'seek';
      pf.status = isLast && horizontalDistance(_pos, waypoint) <= agent.stopDistance + 0.05 ? 'arrived' : 'moving';
    });
  }

  private stop(pf: { path: THREE.Vector3[]; status: string }, agent: { mode: string; target: unknown }): void {
    pf.path = [];
    pf.status = 'idle';
    agent.mode = 'idle';
    agent.target = null;
  }

  // ───────── 轉向移動 ─────────

  private updateSteering(world: World, dt: number): void {
    if (dt <= 0) return;
    const physics = world.getResource(PhysicsKey);
    const agents = world.query([SteeringAgent, Transform]);
    // 鄰居位置（分離用）：角色不多時直接兩兩比較
    const positions = new Map<Entity, THREE.Vector3>();
    for (const e of agents.entities)
      positions.set(e, worldPosition(world, e, world.get(e, Transform)!, new THREE.Vector3()));

    agents.each((e, a, t) => {
      const pos = positions.get(e)!;
      const v = a.velocity;
      _force.set(0, 0, 0);

      // 目標
      let target: THREE.Vector3 | null = null;
      _targetVel.set(0, 0, 0);
      if (a.targetEntity !== null) {
        const tt = world.get(a.targetEntity, Transform);
        if (tt) {
          target = worldPosition(world, a.targetEntity, tt, _target);
          const other = world.get(a.targetEntity, SteeringAgent);
          if (other) _targetVel.copy(other.velocity);
          else if (physics?.bodyOf(a.targetEntity)) physics.getLinearVelocity(a.targetEntity, _targetVel);
        }
      } else if (a.target) {
        target = _target.set(a.target.x, a.target.y, a.target.z);
      }
      if (target && a.planar) target.y = pos.y;

      a.arrived = false;
      switch (a.mode) {
        case 'seek':
          if (target) seek(pos, v, target, a.maxSpeed, _force);
          if (target && horizontalDistance(pos, target) <= a.stopDistance) a.arrived = true;
          break;
        case 'arrive':
          if (target) {
            arrive(pos, v, target, a.maxSpeed, a.slowRadius, _force);
            if (horizontalDistance(pos, target) <= a.stopDistance) a.arrived = true;
          }
          break;
        case 'flee':
          if (target) flee(pos, v, target, a.maxSpeed, _force);
          break;
        case 'pursue':
          if (target) pursue(pos, v, target, _targetVel, a.maxSpeed, _force);
          break;
        case 'evade':
          if (target) evade(pos, v, target, _targetVel, a.maxSpeed, _force);
          break;
        case 'wander': {
          const state = { angle: a.wanderAngle };
          wander(pos, v, state, a.maxSpeed, dt, {}, _force);
          a.wanderAngle = state.angle;
          break;
        }
        default:
          _force.copy(v).multiplyScalar(-4); // idle：逐漸停下
      }
      // 轉向力 =（期望速度 − 目前速度）× 靈敏度。
      // 只用速度差當力時，力最多只有 maxSpeed，速度要好幾秒才跟得上；
      // 乘上 maxForce / maxSpeed 後，差距最大時能用滿 maxForce，反應才靈活。
      if (a.mode !== 'idle') _force.multiplyScalar(a.maxForce / Math.max(a.maxSpeed, 1e-6));

      if (a.separation > 0) {
        const neighbors: THREE.Vector3[] = [];
        for (const [other, p] of positions)
          if (other !== e && p.distanceTo(pos) < a.separationRadius) neighbors.push(p);
        if (neighbors.length)
          _force.addScaledVector(separation(pos, neighbors, a.separationRadius, a.maxSpeed, _tmp), a.separation);
      }

      if (a.planar) _force.y = 0;
      truncate(_force, a.maxForce);
      v.addScaledVector(_force, dt);
      if (a.planar) v.y = 0;
      truncate(v, a.maxSpeed);
      if (a.arrived && a.mode === 'arrive') v.multiplyScalar(0.5); // 抵達後收住，避免來回晃動

      // 移動
      const body = world.get(e, RigidBody);
      if (physics && body?.type === 'dynamic') {
        const current = physics.getLinearVelocity(e, _tmp);
        physics.setLinearVelocity(e, { x: v.x, y: a.planar ? current.y : v.y, z: v.z });
      } else {
        t.position.addScaledVector(v, dt); // 角色最好沒有父節點，區域座標即世界座標
      }

      // 朝向移動方向（-Z 為前方）
      if (a.faceMovement && Math.hypot(v.x, v.z) > 0.05) {
        const yaw = Math.atan2(-v.x, -v.z);
        _q.setFromAxisAngle(_yAxis, yaw);
        const k = 1 - Math.exp(-a.turnSpeed * dt);
        if (physics && body?.type === 'dynamic') {
          const r = physics.bodyOf(e)?.rotation();
          if (r) physics.bodyOf(e)!.setRotation(new THREE.Quaternion(r.x, r.y, r.z, r.w).slerp(_q, k), true);
        } else {
          t.rotation.slerp(_q, k);
        }
      }
    });
  }
}

/**
 * 實體目前的世界位置。沒有父節點時直接用 position（永遠是最新的）；
 * 世界矩陣要到這一幀的變換計算才更新，剛生成的實體還是初始值。
 */
function worldPosition(world: World, e: Entity, t: TransformData, out: THREE.Vector3): THREE.Vector3 {
  return world.has(e, Parent) ? out.setFromMatrixPosition(t.worldMatrix) : out.copy(t.position);
}

function horizontalDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
