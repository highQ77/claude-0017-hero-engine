/**
 * 繪製器（WebGPURenderer）：非同步初始化、不支援 WebGPU 時的 WebGL2 備援。
 * 測試環境沒有 GPU：用替身繪製器（isWebGPURenderer: true 的就是 WebGPURenderer 的替身）。
 */
import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { createParticleMaterial } from '../src/particles/ParticleMaterial';
import { PostProcessingPlugin } from '../src/postfx';
import { type EngineRenderer, RenderPlugin, isWebGPURenderer } from '../src/render';
import { ScenePlugin } from '../src/scene';
import { fakeScheduler } from './helpers';

/** 替身繪製器：記錄 render 的次數；有 isWebGPURenderer 與非同步的 init（gpu: false 是 WebGL2 備援） */
function fakeRenderer(gpu = true) {
  let resolveInit: () => void = () => {};
  const r = {
    renders: 0,
    domElement: { parentElement: null, remove() {} },
    shadowMap: { enabled: false, type: 0 },
    autoClear: true,
    toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
    toneMappingExposure: 1,
    getPixelRatio: () => 1,
    setPixelRatio() {},
    setSize() {},
    render() {
      r.renders++;
    },
    clear() {},
    dispose() {},
    isWebGPURenderer: true,
    backend: { isWebGPUBackend: gpu },
    init: () =>
      new Promise<void>((ok) => {
        resolveInit = ok;
      }),
  };
  return { renderer: r as unknown as EngineRenderer & { renders: number }, finishInit: () => resolveInit() };
}

function setup(renderer: EngineRenderer, extra: (engine: Engine) => void = () => {}) {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const render = new RenderPlugin({ renderer, size: { width: 100, height: 50 } });
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  engine.use(ecs).use(new ScenePlugin()).use(render);
  extra(engine);
  ecs.world.spawn(); // 沒有攝影機也會 clear；這裡只看 render 的次數
  return { render, engine, clock, world: ecs.world };
}

describe('繪製器', () => {
  test('isWebGPURenderer 只認 isWebGPURenderer === true（替身對任何屬性都回傳函式也不會誤判）', () => {
    const anything = new Proxy({}, { get: () => () => undefined });
    expect(isWebGPURenderer(anything)).toBe(false);
    expect(isWebGPURenderer(fakeRenderer().renderer)).toBe(true);
    expect(isWebGPURenderer(null)).toBe(false);
  });

  test('WebGPU：初始化完成前不繪製；完成後 ready、gpuApi 才有值', async () => {
    const fake = fakeRenderer();
    const { render, engine, clock } = setup(fake.renderer);
    const { Camera } = await import('../src/render');
    const { Transform } = await import('../src/scene');
    engine.getPlugin<EcsPlugin>('ecs')!.world.spawn(Transform, Camera);
    engine.start();
    clock.frame(16);
    clock.frame(16);
    expect(fake.renderer.renders).toBe(0);
    expect(render.gpuApi).toBeNull();
    fake.finishInit();
    await render.ready;
    clock.frame(16);
    expect(fake.renderer.renders).toBe(1);
    expect(render.gpuApi).toBe('webgpu');
  });

  test('WebGPURenderer 在不支援 WebGPU 的瀏覽器改用 WebGL2：gpuApi 是 webgl2', async () => {
    const fake = fakeRenderer(false);
    const { render } = setup(fake.renderer);
    fake.finishInit();
    await render.ready;
    expect(render.gpuApi).toBe('webgl2');
  });

  test('後製沒有效果時直接繪製：色調映射與曝光套用到繪製器', async () => {
    const fake = fakeRenderer();
    const postfx = new PostProcessingPlugin({ toneMapping: 'aces', exposure: 1.4 });
    const { render, engine, clock } = setup(fake.renderer, (e) => e.use(postfx));
    const { Camera } = await import('../src/render');
    const { Transform } = await import('../src/scene');
    engine.getPlugin<EcsPlugin>('ecs')!.world.spawn(Transform, Camera);
    fake.finishInit();
    await render.ready;
    engine.start();
    clock.frame(16);
    expect(fake.renderer.renders).toBe(1); // 直接繪製（沒有後製的管線）
    expect(fake.renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(fake.renderer.toneMappingExposure).toBe(1.4);
  });
});

describe('介面合成', () => {
  test('接管繪製的外掛自己疊介面：拿到 overlay、直接畫到畫布，不再多一次全螢幕合成', async () => {
    const fake = fakeRenderer();
    const targets: unknown[] = [];
    let current: unknown = null;
    Object.assign(fake.renderer, {
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(100, 50),
      getRenderTarget: () => current,
      setRenderTarget: (t: unknown) => {
        current = t;
        targets.push(t);
      },
      getClearColor: (c: THREE.Color) => c.set(0, 0, 0),
      getClearAlpha: () => 1,
      setClearColor() {},
    });
    const { render, engine, clock } = setup(fake.renderer);
    const { Camera } = await import('../src/render');
    const { Transform } = await import('../src/scene');
    engine.getPlugin<EcsPlugin>('ecs')!.world.spawn(Transform, Camera);
    render.addOverlay(new THREE.Scene(), new THREE.OrthographicCamera());
    const got: unknown[] = [];
    render.setDrawHandler(
      (_s, _c, overlay) => {
        got.push(overlay);
        return overlay ? 'composited' : 'encoded';
      },
      { compositesOverlays: true },
    );
    fake.finishInit();
    await render.ready;
    engine.start();
    clock.frame(16);
    expect(got).toHaveLength(1);
    const overlay = got[0] as { key: string; composite: unknown };
    expect(overlay.key).toMatch(/^ui\d+$/);
    expect(typeof overlay.composite).toBe('function');
    // 介面畫到自己的緩衝區，接著直接畫到畫布（null）；沒有多重取樣的全螢幕緩衝區
    expect(targets.at(-1)).toBeNull();
    expect((targets.filter(Boolean) as THREE.RenderTarget[]).every((t) => t.samples === 0)).toBe(true);
    // 沒有宣告 compositesOverlays 的外掛：照舊（拿不到 overlay）
    render.setDrawHandler(null);
    render.setDrawHandler((_s, _c, overlay) => {
      got.push(overlay);
    });
    clock.frame(16);
    expect(got.at(-1)).toBeUndefined();
  });
});

describe('粒子材質', () => {
  test('節點材質：可以改 uniforms.map、uniforms.stretch；加法混合、不寫深度', () => {
    const m = createParticleMaterial();
    expect((m as unknown as { isNodeMaterial?: boolean }).isNodeMaterial).toBe(true);
    const tex = new THREE.Texture();
    m.uniforms.map.value = tex;
    m.uniforms.stretch.value = 0.5;
    expect([m.uniforms.map.value, m.uniforms.stretch.value]).toEqual([tex, 0.5]);
    expect([m.transparent, m.depthWrite, m.blending]).toEqual([true, false, THREE.AdditiveBlending]);
  });
  test('每個發射器的材質共用同一份著色器（快取鍵相同：放特效時不用重新編譯，不會卡一下）', () => {
    const key = (m: object) => (m as { customProgramCacheKey(): string }).customProgramCacheKey();
    const a = createParticleMaterial();
    const b = createParticleMaterial();
    b.uniforms.map.value = new THREE.Texture();
    b.uniforms.stretch.value = 0.3;
    expect(key(a)).toBe(key(b));
    expect(a.uniforms.stretch.value).toBe(0); // 值還是各自獨立
  });
});
