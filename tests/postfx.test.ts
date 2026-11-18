import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import { Camera, RenderPlugin } from '../src/render';
import { PostFxKey, PostProcessingPlugin } from '../src/postfx';
import { fakeScheduler } from './helpers';

/**
 * 繪製器替身：記錄 render 呼叫，其他沒實作的方法一律當成什麼都不做。
 * 讓 three.js 的後製管線可以在 Node 裡完整跑一次。
 */
function fakeRenderer() {
  const calls: { scene: THREE.Object3D; camera: THREE.Camera; target: unknown }[] = [];
  let target: unknown = null;
  const base = {
    domElement: { parentElement: null, remove() {} },
    shadowMap: {},
    autoClear: true,
    toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    getPixelRatio: () => 1,
    getSize: (v: THREE.Vector2) => v.set(200, 100),
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(200, 100),
    getClearColor: (c: THREE.Color) => c.set(0, 0, 0),
    getClearAlpha: () => 1,
    getRenderTarget: () => target,
    setRenderTarget: (t: unknown) => {
      target = t;
    },
    render(scene: THREE.Object3D, camera: THREE.Camera) {
      scene.updateMatrixWorld();
      calls.push({ scene, camera, target });
    },
  };
  const renderer = new Proxy(base as Record<string | symbol, unknown>, {
    get: (obj, key) => (key in obj ? obj[key] : () => undefined),
  });
  return { renderer: renderer as unknown as THREE.WebGLRenderer, calls, base };
}

function setup(settings: ConstructorParameters<typeof PostProcessingPlugin>[0] = {}) {
  const clock = fakeScheduler();
  const fake = fakeRenderer();
  const ecs = new EcsPlugin();
  const render = new RenderPlugin({ renderer: fake.renderer, size: { width: 200, height: 100 } });
  const postfx = new PostProcessingPlugin(settings);
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  engine.use(ecs).use(new ScenePlugin()).use(render).use(postfx);
  const world = ecs.world;
  const cam = world.spawn(Transform, Camera);
  engine.start();
  return { clock, fake, world, render, postfx, engine, cam };
}

describe('後製外掛', () => {
  test('沒有任何效果時直接繪製，並套用色調映射', () => {
    const { clock, fake, postfx } = setup({ toneMapping: 'agx', exposure: 1.5 });
    clock.frame(16);
    expect(postfx.passNames).toEqual([]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].target).toBeNull(); // 直接畫到畫面
    expect(fake.base.toneMapping).toBe(THREE.AgXToneMapping);
    expect(fake.base.toneMappingExposure).toBe(1.5);
  });

  test('效果順序：場景效果 → 色調映射 → 顯示效果 → 反鋸齒', () => {
    const { clock, postfx } = setup({
      bloom: { enabled: true },
      dof: { enabled: true },
      vignette: { enabled: true },
      film: { enabled: true },
      antialias: 'fxaa',
    });
    clock.frame(16);
    expect(postfx.passNames).toEqual(['render', 'dof', 'bloom', 'output', 'film', 'grade', 'fxaa']);
  });

  test('執行中開關效果會重建管線；只改數值不重建', () => {
    const { clock, postfx, fake } = setup();
    clock.frame(16);
    expect(postfx.passNames).toEqual([]);

    postfx.settings.bloom.enabled = true;
    clock.frame(16);
    expect(postfx.passNames).toEqual(['render', 'bloom', 'output']);
    const chain = (postfx as unknown as { chain: { composer: unknown } }).chain;

    // 管線真的有跑：場景先畫進中間畫布，接著是光暈的多次全螢幕繪製，最後輸出到畫面
    const frame = fake.calls.slice(-30);
    const sceneCall = fake.calls.find((c) => c.scene instanceof THREE.Scene && c.target !== null);
    expect(sceneCall).toBeDefined();
    expect(fake.calls.length).toBeGreaterThan(5);
    expect(frame.at(-1)!.target).toBeNull();

    postfx.settings.bloom.strength = 2;
    clock.frame(16);
    expect((postfx as unknown as { chain: { composer: unknown } }).chain).toBe(chain);
    const bloom = (postfx as unknown as { chain: { bloom: { strength: number } } }).chain.bloom;
    expect(bloom.strength).toBe(2);

    postfx.settings.bloom.enabled = false;
    fake.calls.length = 0;
    clock.frame(16);
    expect(postfx.passNames).toEqual([]);
    expect(fake.calls).toHaveLength(1); // 回到直接繪製
  });

  test('調色與暗角共用一個效果，數值每幀寫入', () => {
    const { clock, postfx } = setup({ color: { enabled: true, saturation: 0.2, tint: 0xff8800 } });
    clock.frame(16);
    expect(postfx.passNames).toEqual(['render', 'output', 'grade']);
    const grade = (postfx as unknown as { chain: { grade: ShaderPass } }).chain.grade;
    const u = grade.uniforms as Record<string, THREE.IUniform>;
    expect(u.saturation.value).toBe(0.2);
    expect(u.vignetteEnabled.value).toBe(false);
    expect((u.tint.value as THREE.Color).getHex()).toBe(0xff8800);
    postfx.settings.vignette.enabled = true;
    clock.frame(16);
    expect(postfx.passNames).toEqual(['render', 'output', 'grade']);
    expect(u.vignetteEnabled.value).toBe(true);
  });

  test('景深自動對焦到實體', () => {
    const { clock, postfx, world, cam } = setup({ dof: { enabled: true } });
    world.get(cam, Transform)!.position.set(0, 0, 10);
    const target = world.spawn(Transform);
    world.get(target, Transform)!.position.set(0, 0, 4);
    postfx.settings.dof.focusOn = target;
    clock.frame(16);
    clock.frame(16);
    const dof = (postfx as unknown as { chain: { dof: { uniforms: Record<string, THREE.IUniform> } } }).chain.dof;
    expect(dof.uniforms.focus.value).toBeCloseTo(6, 5);
  });

  test('自訂效果插入指定階段；移除後重建', () => {
    const { clock, postfx } = setup();
    const scenePass = new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: '', fragmentShader: '' });
    const displayPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: '',
      fragmentShader: '',
    });
    postfx.addPass(scenePass, 'scene');
    postfx.addPass(displayPass, 'display');
    clock.frame(16);
    expect(postfx.passNames).toEqual(['render', 'custom1', 'output', 'custom2']);
    postfx.removePass(scenePass);
    clock.frame(16);
    expect(postfx.passNames).toEqual(['render', 'output', 'custom2']);
  });

  test('切換攝影機會重建；畫面尺寸改變會更新 FXAA 解析度', () => {
    const { clock, postfx, world, render } = setup({ antialias: 'fxaa' });
    clock.frame(16);
    const sig1 = (postfx as unknown as { chain: { signature: string } }).chain.signature;
    world.spawn(Transform, Camera.with({ priority: 10 }));
    clock.frame(16);
    const chain = (postfx as unknown as { chain: { signature: string; fxaa: ShaderPass } }).chain;
    expect(chain.signature).not.toBe(sig1);
    render.setSize(400, 200);
    const res = (chain.fxaa.uniforms as Record<string, THREE.IUniform>).resolution.value as THREE.Vector2;
    expect([res.x, res.y]).toEqual([1 / 400, 1 / 200]);
  });

  test('卸載後恢復直接繪製；資源可從 ECS 取得', () => {
    const { clock, postfx, engine, fake, world } = setup({ bloom: { enabled: true } });
    expect(world.requireResource(PostFxKey)).toBe(postfx);
    clock.frame(16);
    engine.removePlugin('postfx');
    fake.calls.length = 0;
    clock.frame(16);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].target).toBeNull();
    expect(world.getResource(PostFxKey)).toBeUndefined();
  });

  test('同時只能有一個外掛接管繪製', () => {
    const { render } = setup();
    expect(() => render.setDrawHandler(() => {})).toThrow(/已經有其他外掛/);
  });
});
