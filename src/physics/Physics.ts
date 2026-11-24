import type RAPIER from '@dimforge/rapier3d-compat';

/** Rapier 模組（動態載入，見 initRapier） */
export type RapierModule = typeof RAPIER;
import * as THREE from 'three';
import type { Entity, World } from '../ecs';
import { MeshGeometryKey } from '../scene/keys';
import { HierarchyKey, Parent, Transform } from '../scene';
import { updateTransforms } from '../scene/Transform';
import { Collider, RigidBody, type ColliderData, type RigidBodyData } from './components';
import { createLogger } from '../core/Logger';

const log = createLogger('physics');

/** 三維向量（{ x, y, z }，Vector3 也可以） */
export interface Vec3 {
  /** X */
  x: number;
  /** Y */
  y: number;
  /** Z */
  z: number;
}

/** 碰撞事件（physics.collisions、physics.onCollision、腳本的 onCollisionEnter） */
export interface CollisionEvent {
  /** 碰撞的其中一個實體 */
  a: Entity;
  /** 碰撞的另一個實體 */
  b: Entity;
  /** true：開始接觸；false：分開 */
  started: boolean;
  /** 其中一方是感應器 */
  sensor: boolean;
}

/** 射線查詢的設定 */
export interface RaycastOptions {
  /** 忽略這個實體（例如射線從角色自己身上發出） */
  exclude?: Entity;
  /** 是否打得到感應器，預設 false */
  includeSensors?: boolean;
  /** 只打這些群組（用 collisionGroups() 產生） */
  groups?: number;
}

/** 射線打到的結果 */
export interface PhysicsHit {
  /** 打到的實體 */
  entity: Entity;
  /** 打到的位置（世界座標） */
  point: THREE.Vector3;
  /** 打到的表面朝外的方向 */
  normal: THREE.Vector3;
  /** 從起點到打到的位置的距離 */
  distance: number;
}

interface BodyTracked {
  body: RAPIER.RigidBody;
  type: RigidBodyData['type'];
  prevPos: THREE.Vector3;
  prevRot: THREE.Quaternion;
  currPos: THREE.Vector3;
  currRot: THREE.Quaternion;
  /** 上一次寫進 Transform 的世界姿態（用來偵測使用者手動搬移） */
  written: { pos: THREE.Vector3; rot: THREE.Quaternion } | null;
}

interface ColliderTracked {
  collider: RAPIER.Collider;
  /** 附著的剛體所屬實體；null 代表沒有剛體（固定碰撞體） */
  owner: Entity | null;
  /** 沒有剛體時，上一次同步的世界矩陣 */
  matrix: THREE.Matrix4 | null;
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _rot = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/**
 * 物理世界：包裝 Rapier，負責 ECS 與物理之間的同步。
 * 透過 world.requireResource(PhysicsKey) 在系統中取得。
 */
export class Physics {
  /** Rapier 的物理世界（進階用途：關節、角色控制器等） */
  readonly world: RAPIER.World;
  /** 讓畫面在兩次物理更新之間平滑插值 */
  interpolate: boolean;

  private readonly bodies = new Map<Entity, BodyTracked>();
  private readonly colliders = new Map<Entity, ColliderTracked>();
  private readonly colliderOwners = new Map<number, Entity>(); // 碰撞體 handle → 實體
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly listeners = new Set<(event: CollisionEvent) => void>();
  private readonly offs: (() => void)[] = [];
  private _collisions: CollisionEvent[] = [];

  /**
   * @param ecs ECS 世界
   * @param options 重力、是否平滑插值
   */
  constructor(
    /** Rapier 模組本身（進階用途：建立關節、角色控制器等） */
    readonly rapier: RapierModule,
    private readonly ecs: World,
    options: {
      /** 重力（公尺／秒²），預設 (0, -9.81, 0) */
      gravity?: Vec3;
      /** 讓畫面在兩次物理更新之間平滑插值，預設開啟 */
      interpolate?: boolean;
    } = {},
  ) {
    this.world = new rapier.World(options.gravity ?? { x: 0, y: -9.81, z: 0 });
    this.eventQueue = new rapier.EventQueue(true);
    this.interpolate = options.interpolate ?? true;
    this.offs.push(
      ecs.onRemove(RigidBody, (e) => this.removeBody(e)),
      ecs.onRemove(Collider, (e) => this.removeCollider(e)),
    );
  }

  /** 重力（預設 { x: 0, y: -9.81, z: 0 }） */
  get gravity(): Vec3 {
    return this.world.gravity;
  }

  set gravity(g: Vec3) {
    this.world.gravity = { x: g.x, y: g.y, z: g.z };
  }

  /** 這一幀所有物理更新產生的碰撞事件（每幀開頭清空） */
  get collisions(): readonly CollisionEvent[] {
    return this._collisions;
  }

  /**
   * 監聽碰撞事件（在物理更新後立即呼叫）
   * @param listener 碰撞開始、結束時呼叫
   */
  onCollision(listener: (event: CollisionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ───────── 剛體操作 ─────────

  /**
   * 實體的 Rapier 剛體（進階用途；沒有時是 undefined）
   * @param e 實體
   */
  bodyOf(e: Entity): RAPIER.RigidBody | undefined {
    return this.bodies.get(e)?.body;
  }

  /**
   * 實體的 Rapier 碰撞體（進階用途；沒有時是 undefined）
   * @param e 實體
   */
  colliderOf(e: Entity): RAPIER.Collider | undefined {
    return this.colliders.get(e)?.collider;
  }

  /**
   * 由碰撞體找到所屬實體
   * @param collider Rapier 碰撞體
   */
  entityOf(collider: RAPIER.Collider): Entity | undefined {
    return this.colliderOwners.get(collider.handle);
  }

  /**
   * 施加瞬間衝量（例如跳躍、爆炸）
   * @param e 有剛體的實體
   * @param impulse 衝量（方向 × 大小，公斤·公尺／秒）
   */
  applyImpulse(e: Entity, impulse: Vec3): void {
    this.requireBody(e).applyImpulse(impulse, true);
  }

  /**
   * 施加旋轉的衝量（瞬間轉起來）
   * @param e 有剛體的實體
   * @param impulse 旋轉衝量（繞 x、y、z 軸）
   */
  applyTorqueImpulse(e: Entity, impulse: Vec3): void {
    this.requireBody(e).applyTorqueImpulse(impulse, true);
  }

  /**
   * 設定移動速度（公尺／秒）
   * @param e 有剛體的實體
   * @param v 速度（公尺／秒）
   */
  setLinearVelocity(e: Entity, v: Vec3): void {
    this.requireBody(e).setLinvel(v, true);
  }

  /**
   * 目前的移動速度
   * @param e 有剛體的實體
   * @param out 存放結果的向量（省略時建立新的）
   */
  getLinearVelocity(e: Entity, out = new THREE.Vector3()): THREE.Vector3 {
    const v = this.requireBody(e).linvel();
    return out.set(v.x, v.y, v.z);
  }

  /**
   * 設定旋轉速度（弧度／秒）
   * @param e 有剛體的實體
   * @param v 旋轉速度（繞 x、y、z 軸，弧度／秒）
   */
  setAngularVelocity(e: Entity, v: Vec3): void {
    this.requireBody(e).setAngvel(v, true);
  }

  /**
   * 瞬間移動到指定位置（同時更新 Transform，不會插值拖影）
   * @param e 有剛體的實體
   * @param position 新的位置
   * @param rotation 新的旋轉（四元數）；省略時不變
   */
  teleport(e: Entity, position: Vec3, rotation?: { x: number; y: number; z: number; w: number }): void {
    const t = this.ecs.require(e, Transform);
    const tracked = this.bodies.get(e);
    _pos.set(position.x, position.y, position.z);
    if (rotation) _rot.set(rotation.x, rotation.y, rotation.z, rotation.w);
    else this.worldPose(e, new THREE.Vector3(), _rot);
    this.writeWorldPose(e, t, _pos, _rot);
    if (tracked) {
      tracked.body.setTranslation(_pos, true);
      tracked.body.setRotation(_rot, true);
      this.resetInterpolation(tracked, _pos, _rot);
    }
  }

  // ───────── 查詢 ─────────

  /**
   * 射線檢測：回傳最近的命中
   * @param origin 射線起點
   * @param direction 方向（會自動正規化）
   * @param maxDistance 最遠距離
   * @param options 排除的實體、是否打到感應區、只打哪些群組
   */
  raycast(origin: Vec3, direction: Vec3, maxDistance = 1000, options: RaycastOptions = {}): PhysicsHit | null {
    const dir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    const ray = new this.rapier.Ray(origin, dir);
    const exclude = options.exclude !== undefined ? this.bodies.get(options.exclude)?.body : undefined;
    const excludeCollider = options.exclude !== undefined ? this.colliders.get(options.exclude)?.collider : undefined;
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      options.includeSensors ? undefined : this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      options.groups,
      excludeCollider,
      exclude,
    );
    if (!hit) return null;
    const entity = this.colliderOwners.get(hit.collider.handle);
    if (entity === undefined) return null;
    const point = new THREE.Vector3(origin.x, origin.y, origin.z).addScaledVector(dir, hit.timeOfImpact);
    return {
      entity,
      point,
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: hit.timeOfImpact,
    };
  }

  /**
   * 找出與球體重疊的所有實體（例如爆炸範圍）
   * @param center 球心
   * @param radius 半徑
   * @param options 是否也算感應區
   */
  overlapSphere(
    center: Vec3,
    radius: number,
    options: {
      /** 也算感應區（sensor 碰撞體），預設不算 */
      includeSensors?: boolean;
    } = {},
  ): Entity[] {
    const found = new Set<Entity>();
    this.world.intersectionsWithShape(
      center,
      { x: 0, y: 0, z: 0, w: 1 },
      new this.rapier.Ball(radius),
      (collider) => {
        const e = this.colliderOwners.get(collider.handle);
        if (e !== undefined) found.add(e);
        return true;
      },
      options.includeSensors ? undefined : this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    return [...found];
  }

  // ───────── 每幀流程（由 PhysicsPlugin 呼叫） ─────────

  /** 每幀開頭：清空上一幀的碰撞事件 */
  beginFrame(): void {
    this._collisions = [];
  }

  /** 建立新加入的剛體與碰撞體（物理更新前自動呼叫；需要立刻查詢時也可以手動呼叫） */
  flush(): void {
    const ecs = this.ecs;
    const newBodies = ecs.query([RigidBody, Transform]).entities.filter((e) => !this.bodies.has(e));
    const newColliders = ecs.query([Collider, Transform]).entities.filter((e) => !this.colliders.has(e));
    if (newBodies.length === 0 && newColliders.length === 0) return;
    updateTransforms(ecs); // 新實體的世界矩陣可能還沒算過
    for (const e of newBodies) this.createBody(e);
    for (const e of ecs.query([Collider, Transform]).entities) if (!this.colliders.has(e)) this.createCollider(e);
    // 讓射線、範圍查詢立刻找得到剛建立的物件（不必等下一次物理更新）
    this.world.propagateModifiedBodyPositionsToColliders();
    this.world.updateSceneQueries();
  }

  /**
   * 推進一步物理模擬
   * @param dt 步長（秒）
   */
  step(dt: number): void {
    this.flush();
    this.syncToPhysics();
    this.world.timestep = dt;
    this.world.step(this.eventQueue);
    this.syncFromPhysics();
    this.dispatchEvents();
  }

  /**
   * 把剛體姿態寫回 Transform（有插值時依 alpha 平滑）
   * @param alpha 插值比例 0~1（上一步到這一步之間的位置）
   */
  writeTransforms(alpha: number): void {
    const a = this.interpolate ? alpha : 1;
    for (const [e, t] of this.bodies) {
      if (t.type !== 'dynamic') continue;
      const transform = this.ecs.get(e, Transform);
      if (!transform) continue;
      _pos.lerpVectors(t.prevPos, t.currPos, a);
      _rot.slerpQuaternions(t.prevRot, t.currRot, a);
      this.writeWorldPose(e, transform, _pos, _rot);
      if (!t.written) t.written = { pos: new THREE.Vector3(), rot: new THREE.Quaternion() };
      t.written.pos.copy(_pos);
      t.written.rot.copy(_rot);
    }
  }

  /** 除錯用線段資料 */
  debugBuffers(): { vertices: Float32Array; colors: Float32Array } {
    return this.world.debugRender();
  }

  /** 釋放物理世界 */
  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.listeners.clear();
    this.bodies.clear();
    this.colliders.clear();
    this.colliderOwners.clear();
    this.eventQueue.free();
    this.world.free();
  }

  // ───────── 內部：建立與移除 ─────────

  private createBody(e: Entity): void {
    const data = this.ecs.get(e, RigidBody)!;
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    this.worldPose(e, pos, rot);
    const desc =
      data.type === 'fixed'
        ? this.rapier.RigidBodyDesc.fixed()
        : data.type === 'kinematic'
          ? this.rapier.RigidBodyDesc.kinematicPositionBased()
          : this.rapier.RigidBodyDesc.dynamic();
    desc.setTranslation(pos.x, pos.y, pos.z).setRotation(rot);
    const body = this.world.createRigidBody(desc);
    const tracked: BodyTracked = {
      body,
      type: data.type,
      prevPos: pos.clone(),
      prevRot: rot.clone(),
      currPos: pos.clone(),
      currRot: rot.clone(),
      written: null,
    };
    this.bodies.set(e, tracked);
    this.applyBodySettings(body, data);

    // 原本沒有剛體、自己成了固定碰撞體的子孫碰撞體 → 重新建立以附著到新剛體
    const reattach = (target: Entity) => {
      const c = this.colliders.get(target);
      if (c && c.owner === null) this.removeCollider(target);
    };
    reattach(e);
    this.ecs.getResource(HierarchyKey)?.forEachDescendant(e, reattach);
  }

  private applyBodySettings(body: RAPIER.RigidBody, d: RigidBodyData): void {
    body.setLinearDamping(d.linearDamping);
    body.setAngularDamping(d.angularDamping);
    body.setGravityScale(d.gravityScale, false);
    body.enableCcd(d.ccd);
    body.setEnabledRotations(d.rotations.x, d.rotations.y, d.rotations.z, false);
    if (!d.canSleep && body.isSleeping()) body.wakeUp();
  }

  private createCollider(e: Entity): void {
    const data = this.ecs.get(e, Collider)!;
    const transform = this.ecs.get(e, Transform)!;
    transform.worldMatrix.decompose(_pos, _rot, _scale);

    // 找到最近的剛體（自己或祖先）
    let owner: Entity | null = null;
    for (let cur: Entity | null = e; cur !== null; cur = this.parentOf(cur)) {
      if (this.bodies.has(cur)) {
        owner = cur;
        break;
      }
    }

    const desc = this.shapeDesc(e, data, _scale);
    if (!desc) {
      log.warn(`實體 ${e} 的碰撞形狀無法建立（${data.shape}），已略過`);
      return;
    }

    // 相對位置：附著剛體時相對於剛體，否則為世界座標
    const offset = new THREE.Vector3(data.offset.x, data.offset.y, data.offset.z)
      .multiply(_scale)
      .applyQuaternion(_rot);
    const worldPos = _pos.clone().add(offset);
    const worldRot = _rot.clone();
    if (owner !== null) {
      const body = this.bodies.get(owner)!.body;
      const bt = body.translation();
      const br = body.rotation();
      const invBodyRot = new THREE.Quaternion(br.x, br.y, br.z, br.w).invert();
      const localPos = worldPos.sub(new THREE.Vector3(bt.x, bt.y, bt.z)).applyQuaternion(invBodyRot);
      const localRot = invBodyRot.multiply(worldRot);
      desc.setTranslation(localPos.x, localPos.y, localPos.z).setRotation(localRot);
    } else {
      desc.setTranslation(worldPos.x, worldPos.y, worldPos.z).setRotation(worldRot);
    }
    desc
      .setFriction(data.friction)
      .setRestitution(data.restitution)
      .setDensity(data.density)
      .setSensor(data.sensor)
      .setCollisionGroups(data.groups)
      .setActiveEvents(data.events ? this.rapier.ActiveEvents.COLLISION_EVENTS : this.rapier.ActiveEvents.NONE);
    // 讓感應器也能偵測到固定、運動學物體
    if (data.sensor) desc.setActiveCollisionTypes(this.rapier.ActiveCollisionTypes.ALL);

    const parentBody = owner !== null ? this.bodies.get(owner)!.body : undefined;
    const collider = this.world.createCollider(desc, parentBody);
    this.colliders.set(e, { collider, owner, matrix: owner === null ? transform.worldMatrix.clone() : null });
    this.colliderOwners.set(collider.handle, e);
  }

  private shapeDesc(e: Entity, d: ColliderData, scale: THREE.Vector3): RAPIER.ColliderDesc | null {
    const sx = Math.abs(scale.x),
      sy = Math.abs(scale.y),
      sz = Math.abs(scale.z);
    const radial = Math.max(sx, sz);
    switch (d.shape) {
      case 'box':
        return this.rapier.ColliderDesc.cuboid(d.halfExtents.x * sx, d.halfExtents.y * sy, d.halfExtents.z * sz);
      case 'sphere':
        return this.rapier.ColliderDesc.ball(d.radius * Math.max(sx, sy, sz));
      case 'capsule':
        return this.rapier.ColliderDesc.capsule(d.halfHeight * sy, d.radius * radial);
      case 'cylinder':
        return this.rapier.ColliderDesc.cylinder(d.halfHeight * sy, d.radius * radial);
      case 'cone':
        return this.rapier.ColliderDesc.cone(d.halfHeight * sy, d.radius * radial);
      case 'convexHull':
      case 'trimesh': {
        // 沒有指定幾何：用同一實體的網格（由繪製外掛提供；網格用描述時是一份暫時的幾何）
        const found = d.geometry
          ? { geometry: d.geometry, temporary: false }
          : (this.ecs.getResource(MeshGeometryKey)?.geometryOf(e) ?? null);
        if (!found) return null;
        const geometry = found.geometry;
        const temporary = found.temporary ? geometry : null;
        const position = geometry.getAttribute('position');
        const vertices = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) {
          vertices[i * 3] = position.getX(i) * scale.x;
          vertices[i * 3 + 1] = position.getY(i) * scale.y;
          vertices[i * 3 + 2] = position.getZ(i) * scale.z;
        }
        const index = geometry.getIndex();
        const indices = index
          ? new Uint32Array(index.array)
          : Uint32Array.from({ length: position.count }, (_, i) => i);
        temporary?.dispose();
        if (d.shape === 'convexHull') return this.rapier.ColliderDesc.convexHull(vertices);
        return this.rapier.ColliderDesc.trimesh(vertices, indices);
      }
    }
  }

  private removeBody(e: Entity): void {
    const t = this.bodies.get(e);
    if (!t) return;
    // 移除剛體會一併移除附著的碰撞體：清掉紀錄，之後若碰撞元件還在會重新建立成固定碰撞體
    for (const [ce, c] of [...this.colliders]) {
      if (c.owner === e) {
        this.colliderOwners.delete(c.collider.handle);
        this.colliders.delete(ce);
      }
    }
    this.world.removeRigidBody(t.body);
    this.bodies.delete(e);
  }

  private removeCollider(e: Entity): void {
    const c = this.colliders.get(e);
    if (!c) return;
    this.colliderOwners.delete(c.collider.handle);
    this.world.removeCollider(c.collider, true);
    this.colliders.delete(e);
  }

  // ───────── 內部：同步 ─────────

  private syncToPhysics(): void {
    for (const [e, t] of this.bodies) {
      const data = this.ecs.get(e, RigidBody);
      if (!data) continue;
      this.applyBodySettings(t.body, data);
      this.worldPose(e, _pos, _rot);
      if (t.type === 'kinematic') {
        t.body.setNextKinematicTranslation(_pos);
        t.body.setNextKinematicRotation(_rot);
      } else if (t.type === 'fixed') {
        const p = t.body.translation();
        const r = t.body.rotation();
        if (!nearPos(_pos, p) || !nearRot(_rot, r)) {
          t.body.setTranslation(_pos, true);
          t.body.setRotation(_rot, true);
        }
      } else if (t.written && (!nearPos(_pos, t.written.pos) || !nearRot(_rot, t.written.rot))) {
        // 使用者手動改了動態剛體的 Transform → 搬過去
        t.body.setTranslation(_pos, true);
        t.body.setRotation(_rot, true);
        this.resetInterpolation(t, _pos, _rot);
      }
    }
    for (const [e, c] of this.colliders) {
      const data = this.ecs.get(e, Collider);
      if (!data) continue;
      c.collider.setFriction(data.friction);
      c.collider.setRestitution(data.restitution);
      if (c.collider.density() !== data.density) c.collider.setDensity(data.density);
      c.collider.setSensor(data.sensor);
      c.collider.setCollisionGroups(data.groups);
      // 沒有剛體的碰撞體：Transform 變了就跟著搬
      const t = this.ecs.get(e, Transform);
      if (c.matrix && t && !c.matrix.equals(t.worldMatrix)) {
        c.matrix.copy(t.worldMatrix);
        t.worldMatrix.decompose(_pos, _rot, _scale);
        const o = new THREE.Vector3(data.offset.x, data.offset.y, data.offset.z).multiply(_scale).applyQuaternion(_rot);
        c.collider.setTranslation(_pos.add(o));
        c.collider.setRotation(_rot);
      }
    }
  }

  private syncFromPhysics(): void {
    for (const t of this.bodies.values()) {
      t.prevPos.copy(t.currPos);
      t.prevRot.copy(t.currRot);
      const p = t.body.translation();
      const r = t.body.rotation();
      t.currPos.set(p.x, p.y, p.z);
      t.currRot.set(r.x, r.y, r.z, r.w);
    }
  }

  private dispatchEvents(): void {
    const events: CollisionEvent[] = [];
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      const a = this.colliderOwners.get(h1);
      const b = this.colliderOwners.get(h2);
      if (a === undefined || b === undefined) return;
      const c1 = this.world.getCollider(h1);
      const c2 = this.world.getCollider(h2);
      events.push({ a, b, started, sensor: (c1?.isSensor() ?? false) || (c2?.isSensor() ?? false) });
    });
    // 先收集再分派：回呼裡銷毀實體不會影響後續事件
    for (const ev of events) {
      this._collisions.push(ev);
      for (const listener of [...this.listeners]) listener(ev);
    }
  }

  private resetInterpolation(t: BodyTracked, pos: THREE.Vector3, rot: THREE.Quaternion): void {
    t.prevPos.copy(pos);
    t.currPos.copy(pos);
    t.prevRot.copy(rot);
    t.currRot.copy(rot);
    t.written = { pos: pos.clone(), rot: rot.clone() };
  }

  private requireBody(e: Entity): RAPIER.RigidBody {
    this.flush();
    const body = this.bodies.get(e)?.body;
    if (!body) throw new Error(`實體 ${e} 沒有剛體`);
    return body;
  }

  private parentOf(e: Entity): Entity | null {
    const p = this.ecs.get(e, Parent);
    return p && this.ecs.isAlive(p.entity) ? p.entity : null;
  }

  /** 由 Transform 算出世界位置與旋轉（父節點用它已算好的世界矩陣） */
  private worldPose(e: Entity, pos: THREE.Vector3, rot: THREE.Quaternion): void {
    const t = this.ecs.get(e, Transform)!;
    const parent = this.parentOf(e);
    const pt = parent !== null ? this.ecs.get(parent, Transform) : undefined;
    if (!pt) {
      pos.copy(t.position);
      rot.copy(t.rotation);
      return;
    }
    _m.compose(t.position, t.rotation, t.scale).premultiply(pt.worldMatrix);
    _m.decompose(pos, rot, _scale);
  }

  /** 把世界姿態寫回 Transform（有父節點時換算成區域座標，保留原本的縮放） */
  private writeWorldPose(
    e: Entity,
    t: { position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 },
    pos: THREE.Vector3,
    rot: THREE.Quaternion,
  ): void {
    const parent = this.parentOf(e);
    const pt = parent !== null ? this.ecs.get(parent, Transform) : undefined;
    if (!pt) {
      t.position.copy(pos);
      t.rotation.copy(rot);
      return;
    }
    _m.compose(pos, rot, _scale.set(1, 1, 1));
    _m2.copy(pt.worldMatrix).invert().multiply(_m);
    const keepScale = t.scale.clone();
    _m2.decompose(t.position, t.rotation, _scale);
    t.scale.copy(keepScale);
  }
}

function nearPos(a: THREE.Vector3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.y - b.y) < 1e-5 && Math.abs(a.z - b.z) < 1e-5;
}

function nearRot(a: THREE.Quaternion, b: { x: number; y: number; z: number; w: number }): boolean {
  return Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w) > 1 - 1e-6;
}
