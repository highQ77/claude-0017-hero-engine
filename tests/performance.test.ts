import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import { AdaptiveResolution, Camera, RenderPlugin } from '../src/render';
import { PostProcessingPlugin } from '../src/postfx';
import { fakeScheduler } from './helpers';

/** 以固定幀時間跑 seconds 秒，回傳期間所有的調整 */
function run(a: AdaptiveResolution, frameMs: number, seconds: number): number[] {
  const changes: number[] = [];
  for (let t = 0; t < seconds * 1000; t += frameMs) {
    const r = a.update(frameMs / 1000);
    if (r !== null) changes.push(r);
  }
  return changes;
}

describe('動態解析度', () => {
  test('持續變慢就降低解析度，直到下限', () => {
    const a = new AdaptiveResolution(2, { targetFps: 60, minPixelRatio: 1, warmup: 0 });
    const changes = run(a, 33.3, 10); // 30 FPS
    expect(changes[0]).toBeCloseTo(1.7, 2);
    expect(a.pixelRatio).toBe(1);
  });

  test('流暢時不調整；穩定一段時間後慢慢升回上限', () => {
    const a = new AdaptiveResolution(2, { minPixelRatio: 1, warmup: 0 });
    expect(run(a, 16.7, 4)).toEqual([]);
    run(a, 33.3, 2); // 先降下來
    const lowered = a.pixelRatio;
    expect(lowered).toBeLessThan(2);
    const raised = run(a, 16.7, 30);
    expect(raised.length).toBeGreaterThan(0);
    expect(a.pixelRatio).toBe(2);
  });

  test('升高後又變慢：降回來，並在 20 秒內不再升高（避免震盪）', () => {
    const a = new AdaptiveResolution(1.5, { minPixelRatio: 0.5, maxPixelRatio: 2, warmup: 0 });
    // 1.5 流暢 → 升到 1.65
    run(a, 16.7, 7);
    expect(a.pixelRatio).toBeCloseTo(1.65, 2);
    // 1.65 跟不上 → 降回（冷卻 1.5 秒後才開始判斷，所以給 4 秒）
    run(a, 25, 4);
    const after = a.pixelRatio;
    expect(after).toBeLessThan(1.65);
    // 接下來即使流暢，20 秒內不升
    expect(run(a, 16.7, 15)).toEqual([]);
    expect(run(a, 16.7, 15).length).toBeGreaterThan(0);
  });

  test('暖機期間（啟動時編譯著色器）不調整', () => {
    const a = new AdaptiveResolution(2, { warmup: 3 });
    expect(run(a, 40, 2.9)).toEqual([]);
    expect(a.pixelRatio).toBe(2);
  });

  test('單次長停頓（載入、切換分頁）不列入判斷', () => {
    const a = new AdaptiveResolution(2);
    expect(a.update(2)).toBeNull();
    expect(run(a, 16.7, 2)).toEqual([]);
    expect(a.pixelRatio).toBe(2);
  });
});

/** 假繪製器：記錄像素比 */
function fakeRenderer(pixelRatio: number) {
  let pr = pixelRatio;
  const r = {
    domElement: { parentElement: null, remove() {} },
    shadowMap: {},
    autoClear: true,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    info: { autoReset: true, render: {}, memory: {}, reset() {} },
    setPixelRatio(v: number) {
      pr = v;
    },
    getPixelRatio: () => pr,
    getSize: (v: THREE.Vector2) => v.set(800, 600),
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(800 * pr, 600 * pr),
    getClearColor: (c: THREE.Color) => c,
    getClearAlpha: () => 1,
    getRenderTarget: () => null,
    setSize() {},
    clear() {},
    dispose() {},
    setRenderTarget() {},
    render() {},
  };
  return new Proxy(r as Record<string | symbol, unknown>, {
    get: (o, k) => (k in o ? o[k] : () => undefined),
  }) as unknown as THREE.WebGLRenderer;
}

describe('RenderPlugin 與後製整合', () => {
  function setup(pixelRatio: number, adaptive = false) {
    const clock = fakeScheduler();
    const renderer = fakeRenderer(pixelRatio);
    const render = new RenderPlugin({
      renderer,
      pixelRatio,
      size: { width: 800, height: 600 },
      adaptiveResolution: adaptive ? { minPixelRatio: 1, warmup: 0 } : undefined,
    });
    const postfx = new PostProcessingPlugin({ bloom: { enabled: true } });
    const engine = new Engine({ scheduler: clock.scheduler, maxDelta: 0.25, pauseOnHidden: false });
    engine.use(new EcsPlugin()).use(new ScenePlugin()).use(render).use(postfx);
    (engine.getPlugin('ecs') as EcsPlugin).world.spawn(Transform, Camera);
    engine.start();
    return { clock, render, postfx, renderer };
  }

  test('反鋸齒 auto：一般螢幕用 MSAA，高解析度螢幕用 FXAA', () => {
    const low = setup(1);
    low.clock.frame(16);
    expect(low.postfx.resolvedAntialias).toBe('msaa');
    expect(low.postfx.passNames).not.toContain('fxaa');
    const high = setup(2);
    high.clock.frame(16);
    expect(high.postfx.resolvedAntialias).toBe('fxaa');
    expect(high.postfx.passNames).toContain('fxaa');
  });

  test('動態解析度：變慢時降低繪製器的像素比，後製改用 MSAA', () => {
    const { clock, render, postfx } = setup(2, true);
    for (let i = 0; i < 120; i++) clock.frame(40); // 25 FPS
    expect(render.pixelRatio).toBeLessThan(2);
    expect(render.adaptiveResolution!.pixelRatio).toBe(render.pixelRatio);
    // 降到 1.25 以下時，auto 會切回 MSAA（像素少了，MSAA 也不貴了）
    for (let i = 0; i < 200; i++) clock.frame(40);
    expect(render.pixelRatio).toBe(1);
    expect(postfx.resolvedAntialias).toBe('msaa');
  });
});
