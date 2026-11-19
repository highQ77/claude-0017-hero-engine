import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import { Camera, RenderPlugin } from '../src/render';
import { ColorGradeEffect, PostFxKey, PostProcessingPlugin } from '../src/postfx';
import { defaultPostFxSettings } from '../src/postfx/PostProcessingPlugin';
import { postfxSettings } from '../src/postfx/sceneSettings';
import { ShaderPlugin } from '../src/shaders';
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

describe('後製外掛：效果和著色器庫共用', () => {
  /** 等非同步載入（動態 import、fetch）完成 */
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
  };
  const chainOf = (postfx: PostProcessingPlugin) =>
    (postfx as unknown as { chain: { grade: ShaderPass; effects: { index: number; pass: ShaderPass }[] } }).chain;

  function setupWithShaders(settings: ConstructorParameters<typeof PostProcessingPlugin>[0] = {}) {
    const clock = fakeScheduler();
    const fake = fakeRenderer();
    const ecs = new EcsPlugin();
    const shaders = new ShaderPlugin();
    const render = new RenderPlugin({ renderer: fake.renderer, size: { width: 200, height: 100 } });
    const postfx = new PostProcessingPlugin(settings);
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    engine.use(ecs).use(new ScenePlugin()).use(shaders).use(render).use(postfx);
    ecs.world.spawn(Transform, Camera);
    engine.start();
    return { clock, postfx, library: shaders.library, world: ecs.world };
  }

  test('調色是著色器庫的效果：有 ShaderPlugin 時註冊在它的庫裡，可以用 update 修改', () => {
    const { clock, postfx, library } = setupWithShaders({ vignette: { enabled: true } });
    clock.frame(16);
    expect(postfx.shaderLibrary).toBe(library);
    expect(library.has(ColorGradeEffect.name)).toBe(true);
    expect(library.liveCount(ColorGradeEffect.name)).toBe(1);
    library.update(ColorGradeEffect.name, { fragment: `${ColorGradeEffect.fragment}\n color.r = 1.0;` });
    const m = chainOf(postfx).grade.material as THREE.ShaderMaterial;
    expect(m.fragmentShader).toContain('color.r = 1.0;');
  });

  test('沒有 ShaderPlugin 時用後製自己的著色器庫', () => {
    const { clock, postfx } = setup({ color: { enabled: true } });
    clock.frame(16);
    expect(postfx.shaderLibrary.has(ColorGradeEffect.name)).toBe(true);
  });

  test('settings.effects：已註冊的效果依順序加進後製，uniform 每幀寫入，enabled: false 拿掉', () => {
    const { clock, postfx, library } = setupWithShaders();
    library.defineEffect({
      name: 'tintRed',
      uniforms: { amount: 0.5, tint: new THREE.Color(1, 0, 0) },
      fragment: 'color.r += amount;',
    });
    postfx.settings.effects = [{ name: 'tintRed', uniforms: { amount: 0.8, tint: '#00ff00' } }];
    clock.frame(16);
    expect(postfx.passNames).toEqual(['render', 'output', 'fx:0:tintRed']);
    const u = chainOf(postfx).effects[0].pass.uniforms as Record<string, THREE.IUniform>;
    expect(u.amount.value).toBe(0.8);
    expect((u.tint.value as THREE.Color).getHex()).toBe(0x00ff00);
    // 改數值不用重建
    const pass = chainOf(postfx).effects[0].pass;
    (postfx.settings.effects[0] as { uniforms: Record<string, unknown> }).uniforms.amount = 0.1;
    clock.frame(16);
    expect(chainOf(postfx).effects[0].pass).toBe(pass);
    expect(u.amount.value).toBe(0.1);
    // scene 階段放在色調映射之前；關閉時拿掉
    postfx.settings.effects = [{ name: 'tintRed', stage: 'scene' }];
    clock.frame(16);
    expect(postfx.passNames).toEqual(['render', 'fx:0:tintRed', 'output']);
    postfx.settings.effects = [{ name: 'tintRed', enabled: false }];
    clock.frame(16);
    expect(postfx.passNames).toEqual([]);
  });

  test('settings.effects：內建的 EffectPresets 名稱會自動註冊', async () => {
    const { clock, postfx, library } = setupWithShaders({ effects: ['pixelate'] });
    clock.frame(16);
    expect(postfx.passNames).toEqual([]); // 還在載入
    await settle();
    clock.frame(16);
    expect(library.has('pixelate')).toBe(true);
    expect(postfx.passNames).toEqual(['render', 'output', 'fx:0:pixelate']);
  });

  test('settings.effects：節點圖檔自動載入，存檔後重新載入', async () => {
    const graph = (color: string) =>
      JSON.stringify({
        format: 'hero-shader-graph',
        version: 1,
        graph: {
          nodes: [
            { id: 1, type: 'color', x: 0, y: 0, values: {}, params: { color } },
            { id: 2, type: 'effectOutput', x: 200, y: 0, values: { alpha: 1 }, params: {} },
          ],
          links: [{ from: 1, fromPort: 'rgb', to: 2, toPort: 'color' }],
          nextId: 3,
        },
      });
    let content = graph('#ff0000');
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(content)) as typeof fetch;
    try {
      const { clock, postfx, library } = setupWithShaders({ effects: [{ graph: 'shaders/red.shader.json' }] });
      clock.frame(16);
      await settle();
      clock.frame(16);
      expect(postfx.passNames).toEqual(['render', 'output', 'fx:0:red']);
      expect((chainOf(postfx).effects[0].pass.material as THREE.ShaderMaterial).fragmentShader).toContain(
        'vec3(1.0, 0.0, 0.0)',
      );
      // 存檔（開發伺服器通知）：重新載入、重建
      content = graph('#0000ff');
      postfx.reloadGraph('shaders/red.shader.json');
      await settle();
      clock.frame(16);
      expect(library.has('red')).toBe(true);
      expect((chainOf(postfx).effects[0].pass.material as THREE.ShaderMaterial).fragmentShader).toContain(
        'vec3(0.0, 0.0, 1.0)',
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('場景檔：effects 整個清單替換，卸載場景時恢復；格式不對時說明哪裡錯', () => {
    const settings = defaultPostFxSettings();
    const [handler] = postfxSettings(() => settings, defaultPostFxSettings);
    const ctx = { world: new EcsPlugin().world, warn: () => {} };
    const undo = handler.apply(
      {
        effects: ['pixelate', { graph: 'shaders/crt.shader.json', uniforms: { uMouse: [0.5, 0.5] } }],
      },
      ctx,
    ) as () => void;
    expect(settings.effects).toHaveLength(2);
    undo();
    expect(settings.effects).toEqual([]);
    expect(() => handler.apply({ effects: 'pixelate' }, ctx)).toThrow(/effects 要是陣列/);
    expect(() => handler.apply({ effects: [{ uniforms: {} }] }, ctx)).toThrow(/需要 name 或 graph/);
    expect(() => handler.apply({ effects: [{ name: 'x', stage: 'later' }] }, ctx)).toThrow(/stage/);
    expect(() => handler.apply({ effects: [{ name: 'x', speed: 1 }] }, ctx)).toThrow(
      /不認識的欄位「effects\[0\]\.speed」/,
    );
  });
});
