import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, World } from '../ecs';
import type { RenderPlugin } from '../render/RenderPlugin';
import { ParticleController } from './ParticleController';
import { ParticlesKey } from './keys';
import { registerSceneCodecs } from '../scene/SceneFile';
import { particleCodecs } from './sceneCodecs';
export { ParticlesKey } from './keys';

/** 粒子模擬在 update 階段的優先度（補間是 100） */
export const PARTICLE_PRIORITY = 200;

/**
 * 粒子外掛。需先安裝 EcsPlugin、ScenePlugin 與 RenderPlugin。
 * 粒子物件直接放在繪製外掛的 three.js 場景裡，不經過 ECS 的網格綁定。
 */
export class ParticlePlugin implements Plugin {
  readonly name = 'particles';
  readonly dependencies = ['ecs', 'scene', 'render'] as const;
  private _controller: ParticleController | null = null;
  private ecs: EcsPlugin | null = null;
  private world: World | null = null;
  /** 取消登記場景檔存讀規則 */
  private offCodecs: () => void = () => {};

  /** 粒子的控制器（也可以用 world.requireResource(ParticlesKey) 取得） */
  get controller(): ParticleController {
    if (!this._controller) throw new Error('ParticlePlugin 尚未安裝');
    return this._controller;
  }

  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    const render = engine.getPlugin<RenderPlugin>('render')!;
    this.ecs = ecs;
    this.world = ecs.world;
    const controller = (this._controller = new ParticleController(ecs.world, render.scene));
    ecs.world.setResource(ParticlesKey, controller);
    this.offCodecs = registerSceneCodecs(ecs.world, particleCodecs);
    ecs.addSystem({ name: 'particles', priority: PARTICLE_PRIORITY, run: (_w, time) => controller.update(time.delta) });
    ecs.addSystem({ name: 'particles-sync', phase: 'render', priority: 850, run: () => controller.syncMatrices() });
  }

  uninstall(): void {
    this.offCodecs();
    this.offCodecs = () => {};
    this.ecs?.removeSystem('particles-sync').removeSystem('particles');
    this._controller?.dispose();
    if (this.world?.getResource(ParticlesKey) === this._controller) this.world?.removeResource(ParticlesKey);
    this._controller = null;
    this.ecs = this.world = null;
  }
}
