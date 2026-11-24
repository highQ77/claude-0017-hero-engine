import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, World } from '../ecs';
import { AssetManager, type AssetManagerOptions } from './AssetManager';
import { registerDefaultLoaders, type DefaultLoaderOptions } from './loaders';
import { ModelController } from './Model';
import { AssetsKey } from './keys';
import { registerSceneCodecs } from '../scene/SceneFile';
import { assetCodecs } from './sceneCodecs';
export { AssetsKey } from './keys';

/** AssetPlugin 的設定 */
export interface AssetPluginOptions extends AssetManagerOptions, DefaultLoaderOptions {
  /** 不註冊內建載入器（全部自己提供） */
  noDefaultLoaders?: boolean;
}

/** 套用模型載入結果的優先度（update 階段最前面） */
export const MODEL_PRIORITY = -1000;

/**
 * 資源外掛：提供 AssetManager 與 Model 元件的自動載入。需先安裝 EcsPlugin。
 * Model 載入後會加上 SceneObject，要顯示出來還需要 RenderPlugin。
 */
export class AssetPlugin implements Plugin {
  readonly name = 'assets';
  readonly dependencies = ['ecs'] as const;
  /** 資源管理器（也可以用 world.requireResource(AssetsKey) 取得） */
  readonly assets: AssetManager;
  private models: ModelController | null = null;
  private ecs: EcsPlugin | null = null;
  private world: World | null = null;
  /** 取消登記場景檔存讀規則 */
  private offCodecs: () => void = () => {};

  /**
   * @param options 網址前綴（baseUrl）、Draco 解碼器路徑、是否不註冊預設的載入器
   */
  constructor(options: AssetPluginOptions = {}) {
    this.assets = new AssetManager(options);
    if (!options.noDefaultLoaders) registerDefaultLoaders(this.assets, options);
  }

  /**
   * @param engine 引擎
   */
  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    this.ecs = ecs;
    this.world = ecs.world;
    ecs.world.setResource(AssetsKey, this.assets);
    this.offCodecs = registerSceneCodecs(ecs.world, assetCodecs);
    const models = (this.models = new ModelController(ecs.world, this.assets));
    ecs.addSystem({ name: 'model-loader', priority: MODEL_PRIORITY, run: () => models.update() });
  }

  uninstall(): void {
    this.offCodecs();
    this.offCodecs = () => {};
    this.ecs?.removeSystem('model-loader');
    this.models?.dispose();
    this.models = null;
    if (this.world?.getResource(AssetsKey) === this.assets) this.world.removeResource(AssetsKey);
    this.assets.disposeAll();
    this.ecs = this.world = null;
  }
}
