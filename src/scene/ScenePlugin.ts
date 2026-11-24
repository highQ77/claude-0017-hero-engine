import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin } from '../ecs';
import { Hierarchy } from './Hierarchy';
import { SceneCodecs, transformCodec } from './SceneFile';
import { SceneCodecsKey } from './keys';
import { SceneManager } from './SceneManager';
import { transformSystem } from './Transform';

/**
 * 場景外掛：提供父子層級、變換計算、場景管理。需先安裝 EcsPlugin。
 */
export class ScenePlugin implements Plugin {
  readonly name = 'scene';
  readonly dependencies = ['ecs'] as const;
  private _scenes: SceneManager | null = null;
  private _hierarchy: Hierarchy | null = null;
  private _codecs: SceneCodecs | null = null;
  private ecs: EcsPlugin | null = null;

  /** 場景管理（註冊、載入、切換場景） */
  get scenes(): SceneManager {
    if (!this._scenes) throw new Error('ScenePlugin 尚未安裝');
    return this._scenes;
  }

  /** 父子關係（setParent、childrenOf…） */
  get hierarchy(): Hierarchy {
    if (!this._hierarchy) throw new Error('ScenePlugin 尚未安裝');
    return this._hierarchy;
  }

  /** 場景檔的元件存讀規則（其他外掛在這裡登記自己的元件） */
  get codecs(): SceneCodecs {
    if (!this._codecs) throw new Error('ScenePlugin 尚未安裝');
    return this._codecs;
  }

  /**
   * @param engine 引擎
   */
  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    this.ecs = ecs;
    this._hierarchy = new Hierarchy(ecs.world);
    this._scenes = new SceneManager(ecs.world);
    this._codecs = new SceneCodecs();
    this._codecs.register(transformCodec);
    ecs.world.setResource(SceneCodecsKey, this._codecs);
    ecs.addSystem(transformSystem);
  }

  uninstall(): void {
    this._scenes?.unloadAll();
    this._scenes?.dispose();
    this.ecs?.removeSystem(transformSystem.name);
    this._hierarchy?.dispose();
    if (this.ecs?.world.getResource(SceneCodecsKey) === this._codecs) this.ecs?.world.removeResource(SceneCodecsKey);
    this._scenes = this._hierarchy = this._codecs = this.ecs = null;
  }
}
