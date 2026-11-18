import { afterEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin } from '../src/scene';
import { RenderPlugin } from '../src/render';
import { PluginManager } from '../src/plugins';
import * as ui2d from '../src/ui2d';
import { UI2D, UIKey, UIPainter, measure, type Context2D } from '../src/ui2d';
import perfMonitor, { PerfMonitorKey, PerfStatsKey } from '../src/packages/perf-monitor';
import { fakeScheduler } from './helpers';

/** 假繪製器：每次 render() 都算 2 次繪製呼叫、100 個三角形；有 autoReset 行為 */
function fakeRenderer() {
  const info = {
    autoReset: true,
    render: { calls: 0, triangles: 0, points: 0, lines: 0, frame: 0 },
    memory: { geometries: 3, textures: 5 },
    programs: [{}, {}],
    reset() {
      this.render.calls = this.render.triangles = this.render.points = this.render.lines = 0;
    },
  };
  const renderer = {
    domElement: { parentElement: null, remove() {} },
    shadowMap: {},
    autoClear: true,
    info,
    setPixelRatio() {},
    getPixelRatio: () => 1,
    setSize() {},
    clear() {},
    dispose() {},
    setRenderTarget() {},
    render() {
      if (info.autoReset) info.reset();
      info.render.calls += 2;
      info.render.triangles += 100;
    },
  };
  return renderer as unknown as THREE.WebGLRenderer & { info: typeof info };
}

// 元件註冊表是全域的：每個測試結束都移除套件，避免影響下一個測試
const managers: PluginManager[] = [];
afterEach(() => {
  for (const m of managers.splice(0)) m.uninstallAll();
});

async function setup(options: Parameters<typeof perfMonitor.setup>[1] = {}, withUI = true) {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const renderer = fakeRenderer();
  const render = new RenderPlugin({ renderer, size: { width: 800, height: 600 } });
  const engine = new Engine({ scheduler: clock.scheduler, maxDelta: 1, pauseOnHidden: false });
  engine.use(ecs).use(new ScenePlugin()).use(render);
  // 疊加一層（模擬介面）：每幀會多一次 render()
  render.addOverlay(new THREE.Scene(), new THREE.OrthographicCamera());
  let ui: UI2D | null = null;
  if (withUI) {
    ui = await UI2D.create({ container: null, width: 800, height: 600, measure: measure.fixed() });
    ui.loadString('<UI><UILabel>遊戲介面</UILabel></UI>');
    ecs.world.setResource(UIKey, ui);
  }
  const plugins = new PluginManager(engine, { api: { ui2d } });
  managers.push(plugins);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await plugins.install(perfMonitor, { interval: 0.5, ...options });
  log.mockRestore();
  engine.start();
  return { clock, world: ecs.world, engine, plugins, renderer, ui, render };
}

describe('效能監視器：統計', () => {
  test('FPS、每幀時間、最低／最高、曲線資料', async () => {
    const { clock, world } = await setup();
    for (let i = 0; i < 40; i++) clock.frame(i % 2 ? 20 : 10); // 交錯 10ms、20ms（超過 0.5 秒的統計週期）
    const s = world.requireResource(PerfStatsKey);
    expect(s.fps).toBeCloseTo(1000 / 15, 0);
    expect(s.frameMs).toBeCloseTo(15, 0);
    expect(s.frameMinMs).toBeCloseTo(10, 1);
    expect(s.frameMaxMs).toBeCloseTo(20, 1);
    expect(s.history.length).toBe(40);
    expect(Object.keys(s.cpu)).toEqual(['input', 'fixedUpdate', 'update', 'lateUpdate', 'render']);
    expect(s.cpuTotalMs).toBeGreaterThanOrEqual(0);
  });

  test('GPU：一幀內多次 render()（場景 + 疊加圖層）會加總', async () => {
    const { clock, world, renderer, render } = await setup();
    world.spawn(...[]);
    // 沒有攝影機時只會畫疊加圖層（1 次 render），加一台攝影機：每幀 2 次
    const { Camera } = await import('../src/render');
    const { Transform } = await import('../src/scene');
    world.spawn(Transform, Camera);
    for (let i = 0; i < 40; i++) clock.frame(16);
    const s = world.requireResource(PerfStatsKey);
    expect(s.gpu!.calls).toBeCloseTo(4, 5); // 2 次 render × 2 次繪製呼叫
    expect(s.gpu!.triangles).toBeCloseTo(200, 5);
    expect([s.gpu!.geometries, s.gpu!.textures, s.gpu!.programs]).toEqual([3, 5, 2]);
    expect(renderer.info.autoReset).toBe(false);
    expect(s.entities).toBe(2);
    expect(render).toBeDefined();
  });

  test('記憶體：瀏覽器不支援時為 null；支援時換算成 MB', async () => {
    const { clock, world } = await setup();
    for (let i = 0; i < 40; i++) clock.frame(16);
    expect(world.requireResource(PerfStatsKey).memory).toBeNull();
    const perf = performance as Performance & { memory?: unknown };
    perf.memory = { usedJSHeapSize: 50 * 1048576, totalJSHeapSize: 80 * 1048576, jsHeapSizeLimit: 4096 * 1048576 };
    for (let i = 0; i < 40; i++) clock.frame(16);
    expect(world.requireResource(PerfStatsKey).memory).toEqual({ usedMB: 50, totalMB: 80, limitMB: 4096 });
    delete perf.memory;
  });
});

test('卡頓：每幀時間用真實間隔（不受 maxDelta 限制）', async () => {
  const { clock, world } = await setup();
  for (let i = 0; i < 20; i++) clock.frame(16);
  clock.frame(1500); // 卡了 1.5 秒（引擎的 maxDelta 是 1 秒）
  const s = world.requireResource(PerfStatsKey);
  expect(s.frameMaxMs).toBeCloseTo(1500, 0);
});

describe('效能監視器：面板', () => {
  test('自動加到介面上；重新載入介面後會再加回去；面板畫出 FPS 與數據', async () => {
    const { clock, ui } = await setup({ position: { top: 10, left: 20 } });
    const panel = ui!.get('perfMonitor')!;
    expect(panel.type).toBe('UIPerfMonitor');
    ui!.layout();
    expect([panel.absoluteRect.x, panel.absoluteRect.y]).toEqual([20, 10]);
    for (let i = 0; i < 40; i++) clock.frame(16);

    const texts: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(t, k: string) {
        if (k in t) return t[k];
        if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
        if (k === 'fillText') return (s: string) => texts.push(s);
        return () => {};
      },
      set(t, k: string, v) {
        t[k] = v;
        return true;
      },
    }) as unknown as Context2D;
    new UIPainter(() => undefined).paint(ctx, ui!.root!, 800, 600, 1, ui!.paintState);
    expect(texts.some((t) => /^6[23] FPS$/.test(t))).toBe(true); // 16ms → 62.5 FPS
    expect(texts.some((t) => t.includes('次繪製'))).toBe(true);
    expect(texts.some((t) => t.startsWith('不支援'))).toBe(true); // 記憶體

    ui!.loadString('<UI><UILabel>新的介面</UILabel></UI>');
    expect(ui!.get('perfMonitor')).toBeDefined();
  });

  test('顯示／隱藏；移除套件時清除面板並還原繪製統計設定', async () => {
    const { world, ui, plugins, renderer } = await setup({ visible: false });
    const control = world.requireResource(PerfMonitorKey);
    expect(ui!.get('perfMonitor')!.visible).toBe(false);
    control.toggle();
    expect([control.visible, ui!.get('perfMonitor')!.visible]).toEqual([true, true]);
    plugins.uninstall('engine/perf-monitor');
    expect(ui!.get('perfMonitor')).toBeUndefined();
    expect(renderer.info.autoReset).toBe(true);
    expect(world.getResource(PerfStatsKey)).toBeUndefined();
    expect(UI2D.components.has('UIPerfMonitor')).toBe(false);
  });

  test('拖曳移動；不會拖出畫面', async () => {
    const { ui } = await setup({ position: { top: 10, left: 20 }, rememberPosition: false });
    ui!.layout();
    const panel = ui!.get('perfMonitor')!;
    expect(ui!.hitTest(30, 20)).toBe(panel); // 可以點到（不再穿透）
    expect(panel.attrs.cursor).toBe('grab');
    ui!.handlePointer('down', 30, 20);
    ui!.handlePointer('move', 130, 220);
    ui!.handlePointer('up', 130, 220);
    ui!.layout();
    expect([panel.absoluteRect.x, panel.absoluteRect.y]).toEqual([120, 210]);
    ui!.handlePointer('down', 130, 220);
    ui!.handlePointer('move', 5000, -5000);
    ui!.handlePointer('up', 5000, -5000);
    ui!.layout();
    const r = panel.absoluteRect;
    expect([r.x + r.width, r.y]).toEqual([800, 0]); // 貼在右上角，整個面板還在畫面內
  });

  test('視窗縮小：拖到右下角的面板會拉回畫面內', async () => {
    const { ui, clock } = await setup({ position: { top: 10, left: 20 }, rememberPosition: false });
    ui!.layout();
    ui!.handlePointer('down', 30, 20);
    ui!.handlePointer('move', 5000, 5000);
    ui!.handlePointer('up', 5000, 5000);
    ui!.resize(500, 400);
    ui!.layout();
    for (let i = 0; i < 40; i++) clock.frame(16); // 面板更新數據時檢查
    ui!.layout();
    const r = ui!.get('perfMonitor')!.absoluteRect;
    expect([r.x + r.width, r.y + r.height]).toEqual([500, 400]);
  });

  test('記住位置：換介面檔、重新安裝後還在原處', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    try {
      const { ui, plugins } = await setup({ position: { top: 10, left: 20 } });
      ui!.layout();
      ui!.handlePointer('down', 30, 20);
      ui!.handlePointer('move', 80, 60);
      ui!.handlePointer('up', 80, 60);
      ui!.loadString('<UI><UILabel>新的介面</UILabel></UI>');
      ui!.layout();
      expect([ui!.get('perfMonitor')!.absoluteRect.x, ui!.get('perfMonitor')!.absoluteRect.y]).toEqual([70, 50]);
      expect(JSON.parse(store.get('hero.perfMonitor.offset')!)).toEqual({ x: 50, y: 40 });
      plugins.uninstall('engine/perf-monitor');
      const again = await setup({ position: { top: 10, left: 20 } });
      again.ui!.layout();
      expect(again.ui!.get('perfMonitor')!.absoluteRect.x).toBe(70);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('draggable: false：滑鼠穿透面板', async () => {
    const { ui } = await setup({ position: { top: 10, left: 20 }, draggable: false });
    ui!.layout();
    expect(ui!.hitTest(30, 20)).not.toBe(ui!.get('perfMonitor'));
  });

  test('沒有 UI 時只提供數據', async () => {
    const { clock, world } = await setup({}, false);
    for (let i = 0; i < 40; i++) clock.frame(16);
    expect(world.requireResource(PerfStatsKey).fps).toBeGreaterThan(0);
  });
});
