import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, World } from '../ecs';
import type { RenderPlugin } from '../render/RenderPlugin';
import { registerMaterialType } from '../render/descriptors';
import { ShaderLibrary } from './ShaderLibrary';
import { shaderGraphMaterial } from './graph/material';
import { ShadersKey } from './keys';
export { ShadersKey } from './keys';

/**
 * 著色器外掛：提供 ShaderLibrary，並每幀更新 uTime、uDeltaTime、uResolution。需先安裝 EcsPlugin。
 * 也讓材質描述可以寫 { shaderGraph: 'shaders/名稱.shader.json' }（著色器編輯器的節點圖檔）。
 */
export class ShaderPlugin implements Plugin {
  readonly name = 'shaders';
  readonly dependencies = ['ecs'] as const;
  /** 著色器庫（也可以用 world.requireResource(ShadersKey) 取得） */
  readonly library = new ShaderLibrary();
  private ecs: EcsPlugin | null = null;
  private world: World | null = null;
  private offMaterial: (() => void) | null = null;

  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    this.ecs = ecs;
    this.world = ecs.world;
    ecs.world.setResource(ShadersKey, this.library);
    this.offMaterial = registerMaterialType('shaderGraph', (url) => shaderGraphMaterial(this.library, String(url)));
    const b = this.library.builtins;
    ecs.addSystem({
      name: 'shader-uniforms',
      phase: 'render',
      priority: 800,
      run: (_w, time) => {
        b.uTime.value = time.elapsed;
        b.uDeltaTime.value = time.delta;
        const render = engine.getPlugin<RenderPlugin>('render');
        if (render) {
          // 3D 場景實際的繪製解析度（動態解析度降低時比畫布小）
          const pr = render.pixelRatio;
          b.uResolution.value.set(render.size.width * pr, render.size.height * pr);
        }
      },
    });
  }

  uninstall(): void {
    this.offMaterial?.();
    this.offMaterial = null;
    this.ecs?.removeSystem('shader-uniforms');
    if (this.world?.getResource(ShadersKey) === this.library) this.world.removeResource(ShadersKey);
    this.ecs = this.world = null;
  }
}
