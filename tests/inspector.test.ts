import { afterEach, describe, expect, test } from 'vitest';
import type * as THREE from 'three';
import type GUI from 'lil-gui';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin } from '../src/scene';
import { RenderPlugin } from '../src/render';
import { PluginManager } from '../src/plugins';
import { PostProcessingPlugin } from '../src/postfx';
import inspector, { InspectorKey, type InspectorOptions } from '../src/packages/inspector';
import { fakeScheduler } from './helpers';

/** 假的 lil-gui：記錄加了哪些欄位，可以讀寫欄位的值（Node 沒有 DOM） */
interface FakeController {
  label: string;
  object: Record<string, unknown>;
  property: string;
  options?: unknown;
  disabled: boolean;
  listening: boolean;
}
class FakeGUI {
  readonly controllers: FakeController[] = [];
  readonly children: FakeGUI[] = [];
  shown = true;
  closed = false;
  destroyed = false;
  readonly domElement = { classList: { add() {} }, style: {} as Record<string, string> };
  constructor(readonly title: string) {}
  addFolder(title: string) {
    const f = new FakeGUI(title);
    this.children.push(f);
    return f as unknown as GUI;
  }
  add(object: Record<string, unknown>, property: string, options?: unknown) {
    const c: FakeController = { label: property, object, property, options, disabled: false, listening: false };
    this.controllers.push(c);
    const api = {
      name: (n: string) => {
        c.label = n;
        return api;
      },
      listen: () => {
        c.listening = true;
        return api;
      },
      disable: () => {
        c.disabled = true;
        return api;
      },
      onChange: (fn: (v: unknown) => void) => {
        (c as unknown as { change: unknown }).change = fn;
        return api;
      },
      updateDisplay: () => api,
    };
    return api;
  }
  addColor(object: Record<string, unknown>, property: string) {
    return this.add(object, property);
  }
  close() {
    this.closed = true;
  }
  show(v = true) {
    this.shown = v;
  }
  destroy() {
    this.destroyed = true;
  }
  controllersRecursive(): { updateDisplay(): void }[] {
    return [
      ...this.controllers.map(() => ({ updateDisplay() {} })),
      ...this.children.flatMap((c): { updateDisplay(): void }[] => c.controllersRecursive()),
    ];
  }
  /** 找欄位：資料夾標題 › 欄位名稱 */
  find(path: string): FakeController {
    const [folder, label] = path.split(' › ');
    const f = this.children.find((c) => c.title === folder);
    const c = f?.controllers.find((x) => x.label === label);
    if (!c) throw new Error(`找不到欄位 ${path}`);
    return c;
  }
}

function fakeRenderer() {
  return {
    domElement: { parentElement: null, remove() {} },
    shadowMap: {},
    autoClear: true,
    info: { autoReset: true, render: {}, memory: {}, reset() {} },
    setPixelRatio() {},
    getPixelRatio: () => 2,
    setSize() {},
    clear() {},
    dispose() {},
    setRenderTarget() {},
    render() {},
  } as unknown as import('three/webgpu').WebGPURenderer;
}

const managers: PluginManager[] = [];
afterEach(() => {
  for (const m of managers.splice(0)) m.uninstallAll();
});

async function setup(options: InspectorOptions = {}, extras: { postfx?: boolean } = {}) {
  const clock = fakeScheduler();
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  const render = new RenderPlugin({
    renderer: fakeRenderer(),
    size: { width: 200, height: 100 },
    background: 0x112233,
  });
  engine.use(new EcsPlugin()).use(new ScenePlugin()).use(render);
  if (extras.postfx) engine.use(new PostProcessingPlugin());
  const plugins = new PluginManager(engine);
  managers.push(plugins);
  let gui!: FakeGUI;
  await plugins.install(inspector, {
    ...options,
    createGUI: ({ title }) => (gui = new FakeGUI(title)) as unknown as GUI,
  });
  const world = engine.getPlugin<EcsPlugin>('ecs')!.world;
  return { engine, clock, plugins, gui, world, render };
}

describe('調整面板（lil-gui）', () => {
  test('依安裝的外掛建立分類；沒有的外掛不會出現', async () => {
    const { gui } = await setup();
    expect(gui.title).toBe('調整');
    expect(gui.children.map((c) => c.title)).toEqual(['引擎', '繪製']); // 沒有後製、物理、音效
  });

  test('有後製時：反鋸齒、光暈等欄位直接改設定', async () => {
    const { gui, engine } = await setup({}, { postfx: true });
    const settings = engine.getPlugin<PostProcessingPlugin>('postfx')!.settings;
    const aa = gui.find('後製 › 反鋸齒');
    expect(aa.options).toEqual({ 自動: 'auto', MSAA: 'msaa', SMAA: 'smaa', FXAA: 'fxaa', 關閉: 'none' });
    aa.object[aa.property] = 'smaa';
    expect(settings.antialias).toBe('smaa');
    const bloom = gui.children.find((c) => c.title === '後製')!.children.find((c) => c.title === '光暈')!;
    const strength = bloom.controllers.find((c) => c.label === '強度')!;
    strength.object[strength.property] = 1.5;
    expect(settings.bloom.strength).toBe(1.5);
  });

  test('引擎：時間縮放、暫停、FPS 與實體數量（唯讀）', async () => {
    const { gui, engine, clock, world } = await setup();
    const scale = gui.find('引擎 › 時間縮放');
    scale.object[scale.property] = 0.5;
    expect(engine.time.timeScale).toBe(0.5);
    engine.start();
    const pause = gui.find('引擎 › 暫停');
    pause.object[pause.property] = true;
    expect(engine.state).toBe('paused');
    pause.object[pause.property] = false;
    expect(engine.state).toBe('running');
    world.spawn();
    for (let i = 0; i < 20; i++) clock.frame(16);
    const count = gui.find('引擎 › 實體');
    expect(count.disabled).toBe(true);
    expect(count.object[count.property]).toBe(world.entityCount);
  });

  test('繪製：背景顏色', async () => {
    const { gui, render } = await setup();
    const bg = gui.find('繪製 › 背景');
    expect(bg.object[bg.property]).toBe('#112233');
    (bg as unknown as { change: (v: string) => void }).change('#ff0000');
    expect((render.scene.background as THREE.Color).getHexString()).toBe('ff0000');
  });

  test('panels 選擇分類；InspectorKey 加自己的分類、顯示切換；移除套件會關掉面板', async () => {
    const { gui, world, plugins } = await setup({ panels: ['engine'], visible: false });
    expect(gui.children.map((c) => c.title)).toEqual(['引擎']);
    const ins = world.getResource(InspectorKey)!;
    expect(ins.visible).toBe(false);
    expect(gui.shown).toBe(false);
    ins.toggle();
    expect(gui.shown).toBe(true);
    const mine = ins.folder('玩家');
    expect(ins.folder('玩家')).toBe(mine); // 同名共用
    const player = { speed: 3 };
    mine.add(player, 'speed', 0, 10);
    expect((mine as unknown as FakeGUI).controllers[0].property).toBe('speed');
    plugins.uninstall('engine/inspector');
    expect(gui.destroyed).toBe(true);
    expect(world.getResource(InspectorKey)).toBeUndefined();
  });
});
