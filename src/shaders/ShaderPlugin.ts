import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, World } from '../ecs';
import { registerMaterialType } from '../render/descriptors';
import { ShaderLibrary } from './ShaderLibrary';
import { shaderGraphMaterial } from './graph/material';
import { ShadersKey } from './keys';
export { ShadersKey } from './keys';

/**
 * 著色器外掛：提供 ShaderLibrary（自訂材質與全螢幕效果，TSL 節點）。需先安裝 EcsPlugin。
 * 也讓材質描述可以寫 { shaderGraph: 'shaders/名稱.shader.json' }（著色器編輯器的節點圖檔）。
 * 時間、畫面大小等內建的值（ctx.time、ctx.resolution）由 three.js 每幀自動更新。
 */
export class ShaderPlugin implements Plugin {
  readonly name = 'shaders';
  readonly dependencies = ['ecs'] as const;
  /** 著色器庫（也可以用 world.requireResource(ShadersKey) 取得） */
  readonly library = new ShaderLibrary();
  private world: World | null = null;
  private offMaterial: (() => void) | null = null;

  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    this.world = ecs.world;
    ecs.world.setResource(ShadersKey, this.library);
    this.offMaterial = registerMaterialType('shaderGraph', (url) => shaderGraphMaterial(this.library, String(url)));
  }

  uninstall(): void {
    this.offMaterial?.();
    this.offMaterial = null;
    if (this.world?.getResource(ShadersKey) === this.library) this.world.removeResource(ShadersKey);
    this.world = null;
  }
}
