import * as THREE from 'three';
import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, World } from '../ecs';
import type { RenderPlugin } from '../render/RenderPlugin';
import { Physics, type RapierModule, type Vec3 } from './Physics';
import { PhysicsKey } from './keys';
import { registerSceneCodecs } from '../scene/SceneFile';
import { physicsCodecs } from './sceneCodecs';
export { PhysicsKey } from './keys';

/** 物理更新在 fixedUpdate 的優先度（使用者施力的系統預設 0，先執行） */
export const PHYSICS_STEP_PRIORITY = 100;
/** 寫回 Transform 在 lateUpdate 的優先度（變換系統是 1000） */
export const PHYSICS_WRITE_PRIORITY = 900;

/** PhysicsPlugin 的設定 */
export interface PhysicsOptions {
  /** 預設 (0, -9.81, 0) */
  gravity?: Vec3;
  /** 畫面插值，預設 true */
  interpolate?: boolean;
  /** 顯示碰撞形狀的線框（需要 RenderPlugin） */
  debug?: boolean;
}

let rapierReady: Promise<RapierModule> | null = null;

/**
 * 載入並初始化 Rapier（下載並編譯 WebAssembly，只會做一次）。
 * 用動態匯入：沒用到物理的遊戲不必下載物理引擎。
 */
export function initRapier(): Promise<RapierModule> {
  return (rapierReady ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    const rapier = m.default;
    await rapier.init();
    return rapier;
  }));
}

/**
 * 物理外掛：剛體、碰撞、射線、碰撞事件。需先安裝 EcsPlugin 與 ScenePlugin。
 * Rapier 需要非同步初始化，所以請用 create() 建立：
 * @example
 * engine.use(await PhysicsPlugin.create({ gravity: { x: 0, y: -9.81, z: 0 } }));
 */
export class PhysicsPlugin implements Plugin {
  readonly name = 'physics';
  readonly dependencies = ['ecs', 'scene'] as const;
  private _physics: Physics | null = null;
  private ecs: EcsPlugin | null = null;
  private world: World | null = null;
  private engine: Engine | null = null;
  private offs: (() => void)[] = [];
  private debugLines: THREE.LineSegments | null = null;
  private _debug: boolean;
  /** 取消登記場景檔存讀規則 */
  private offCodecs: () => void = () => {};

  private constructor(
    private readonly rapier: RapierModule,
    private readonly options: PhysicsOptions,
  ) {
    this._debug = options.debug ?? false;
  }

  static async create(options: PhysicsOptions = {}): Promise<PhysicsPlugin> {
    return new PhysicsPlugin(await initRapier(), options);
  }

  /** 物理世界（也可以用 world.requireResource(PhysicsKey) 取得） */
  get physics(): Physics {
    if (!this._physics) throw new Error('PhysicsPlugin 尚未安裝');
    return this._physics;
  }

  /** 顯示碰撞形狀線框 */
  get debug(): boolean {
    return this._debug;
  }

  set debug(on: boolean) {
    this._debug = on;
    if (!on && this.debugLines) this.debugLines.visible = false;
  }

  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    this.ecs = ecs;
    this.world = ecs.world;
    this.engine = engine;
    const physics = (this._physics = new Physics(this.rapier, ecs.world, this.options));
    ecs.world.setResource(PhysicsKey, physics);
    this.offCodecs = registerSceneCodecs(ecs.world, physicsCodecs);

    this.offs.push(engine.on('input', () => physics.beginFrame(), -2000));
    ecs.addSystem({
      name: 'physics-step',
      phase: 'fixedUpdate',
      priority: PHYSICS_STEP_PRIORITY,
      run: (_w, time) => physics.step(time.fixedDelta),
    });
    ecs.addSystem({
      name: 'physics-write',
      phase: 'lateUpdate',
      priority: PHYSICS_WRITE_PRIORITY,
      run: (_w, time) => physics.writeTransforms(time.alpha),
    });
    ecs.addSystem({ name: 'physics-debug', phase: 'render', priority: 850, run: () => this.drawDebug() });
  }

  uninstall(): void {
    this.offCodecs();
    this.offCodecs = () => {};
    for (const off of this.offs.splice(0)) off();
    this.ecs?.removeSystem('physics-debug').removeSystem('physics-write').removeSystem('physics-step');
    if (this.debugLines) {
      this.debugLines.removeFromParent();
      this.debugLines.geometry.dispose();
      (this.debugLines.material as THREE.Material).dispose();
      this.debugLines = null;
    }
    this._physics?.dispose();
    if (this.world?.getResource(PhysicsKey) === this._physics) this.world?.removeResource(PhysicsKey);
    this._physics = null;
    this.ecs = this.world = this.engine = null;
  }

  private drawDebug(): void {
    if (!this._debug) return;
    const render = this.engine?.getPlugin<RenderPlugin>('render');
    if (!render) return;
    if (!this.debugLines) {
      const material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true });
      this.debugLines = new THREE.LineSegments(new THREE.BufferGeometry(), material);
      this.debugLines.renderOrder = 999;
      this.debugLines.frustumCulled = false;
    }
    if (this.debugLines.parent !== render.scene) render.scene.add(this.debugLines);
    const { vertices, colors } = this.physics.debugBuffers();
    const geometry = this.debugLines.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.debugLines.visible = true;
  }
}
