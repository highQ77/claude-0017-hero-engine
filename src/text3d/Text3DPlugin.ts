import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin } from '../ecs';
import type { AssetPlugin } from '../assets/AssetPlugin';
import { registerSceneCodecs } from '../scene/SceneFile';
import { Text3DController, type CanvasFactory } from './Text3D';
import { text3dCodecs } from './sceneCodecs';

/**
 * 3D 文字外掛。需先安裝 EcsPlugin、AssetPlugin（載入字型）與 RenderPlugin（顯示）。
 */
export class Text3DPlugin implements Plugin {
  readonly name = 'text3d';
  readonly dependencies = ['ecs', 'assets', 'render'] as const;
  private _controller: Text3DController | null = null;
  private ecs: EcsPlugin | null = null;
  private offCodecs: () => void = () => {};

  /**
   * @param options 建立畫布的方式（測試用）
   */
  constructor(
    private readonly options: {
      /** 建立畫布的方式（測試、沒有 DOM 的環境用）；省略時用 document.createElement('canvas') */
      createCanvas?: CanvasFactory;
    } = {},
  ) {}

  /** 3D 文字的控制器 */
  get controller(): Text3DController {
    if (!this._controller) throw new Error('Text3DPlugin 尚未安裝');
    return this._controller;
  }

  /**
   * @param engine 引擎
   */
  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    const assets = engine.getPlugin<AssetPlugin>('assets')!.assets;
    this.ecs = ecs;
    const controller = (this._controller = new Text3DController(ecs.world, assets, this.options.createCanvas));
    // 在 update 開頭建立（和模型載入一樣），變換與繪製之前就緒
    ecs.addSystem({ name: 'text3d', priority: -900, run: () => controller.update() });
    // 場景檔可以寫 Text3D（有安裝場景外掛時）
    this.offCodecs = registerSceneCodecs(ecs.world, text3dCodecs);
  }

  uninstall(): void {
    this.offCodecs();
    this.offCodecs = () => {};
    this.ecs?.removeSystem('text3d');
    this._controller?.dispose();
    this._controller = null;
    this.ecs = null;
  }
}
