import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, Entity, World } from '../ecs';
import { SceneObject } from '../render/components';
import type { RenderPlugin } from '../render/RenderPlugin';
import { AnimatorController } from './Animator';
import { updateStateMachines } from './StateMachine';
import { TweenManager } from './Tween';
import { TweensKey } from './keys';
import { registerSceneCodecs } from '../scene/SceneFile';
import { animationCodecs } from './sceneCodecs';
export { TweensKey } from './keys';

/** 補間在 update 階段的優先度（使用者系統預設 0，先執行） */
export const TWEEN_PRIORITY = 100;
/** 狀態機在 lateUpdate 的優先度 */
export const STATE_MACHINE_PRIORITY = 400;
/** 動畫播放在 lateUpdate 的優先度（變換系統是 1000） */
export const ANIMATOR_PRIORITY = 500;

/**
 * 動畫外掛：補間、時間軸、動畫片段播放、動畫狀態機。
 * 需先安裝 EcsPlugin 與 RenderPlugin（動畫要作用在 three.js 物件上）。
 */
export class AnimationPlugin implements Plugin {
  readonly name = 'animation';
  readonly dependencies = ['ecs', 'render'] as const;
  /** 取消登記場景檔存讀規則 */
  private offCodecs: () => void = () => {};
  private _tweens: TweenManager | null = null;
  private _animators: AnimatorController | null = null;
  private ecs: EcsPlugin | null = null;
  private world: World | null = null;

  /** 補間動畫（也可以用 world.requireResource(TweensKey) 取得） */
  get tweens(): TweenManager {
    if (!this._tweens) throw new Error('AnimationPlugin 尚未安裝');
    return this._tweens;
  }

  /** 模型動畫的控制器 */
  get animators(): AnimatorController {
    if (!this._animators) throw new Error('AnimationPlugin 尚未安裝');
    return this._animators;
  }

  /**
   * @param engine 引擎
   */
  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    const render = engine.getPlugin<RenderPlugin>('render')!;
    const world = ecs.world;
    this.ecs = ecs;
    this.world = world;

    const tweens = (this._tweens = new TweenManager(world));
    world.setResource(TweensKey, tweens);
    this.offCodecs = registerSceneCodecs(ecs.world, animationCodecs);

    // 動畫根物件：優先用 SceneObject（模型），否則用網格
    const getRoot = (e: Entity) => world.get(e, SceneObject)?.object ?? render.getObject(e, 'mesh');
    const animators = (this._animators = new AnimatorController(world, getRoot));

    ecs.addSystem({
      name: 'tweens',
      priority: TWEEN_PRIORITY,
      run: (_w, time) => tweens.update(time.delta, time.unscaledDelta),
    });
    ecs.addSystem({
      name: 'animation-state-machine',
      phase: 'lateUpdate',
      priority: STATE_MACHINE_PRIORITY,
      run: (w) => updateStateMachines(w),
    });
    ecs.addSystem({
      name: 'animator',
      phase: 'lateUpdate',
      priority: ANIMATOR_PRIORITY,
      run: (_w, time) => animators.update(time.delta),
    });
  }

  uninstall(): void {
    this.offCodecs();
    this.offCodecs = () => {};
    this.ecs?.removeSystem('animator').removeSystem('animation-state-machine').removeSystem('tweens');
    this._tweens?.stopAll();
    this._animators?.dispose();
    if (this.world?.getResource(TweensKey) === this._tweens) this.world?.removeResource(TweensKey);
    this._tweens = this._animators = null;
    this.ecs = this.world = null;
  }
}
