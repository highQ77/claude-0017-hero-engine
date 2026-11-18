/// <reference types="vite/client" />
import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { AssetPlugin } from '../src/assets';
import { ShaderPlugin, ShadersKey } from '../src/shaders';
import { UI2D, measure } from '../src/ui2d';
import * as ui2d from '../src/ui2d';
import * as physics from '../src/physics';
import { ENGINE_VERSION, PluginManager, semver, integrity, define, type PluginPackage } from '../src/plugins';
import { fakeScheduler } from './helpers';

describe('語意化版本', () => {
  test('比較與範圍', () => {
    expect(semver.compare('1.2.3', '1.10.0')).toBeLessThan(0);
    expect(semver.compare('1.0.0-beta', '1.0.0')).toBeLessThan(0);
    expect(semver.satisfies('0.1.5', '^0.1.0')).toBe(true);
    expect(semver.satisfies('0.2.0', '^0.1.0')).toBe(false); // 0.x 的 ^ 只允許同一個 minor
    expect(semver.satisfies('1.9.0', '^1.2.0')).toBe(true);
    expect(semver.satisfies('2.0.0', '^1.2.0')).toBe(false);
    expect(semver.satisfies('1.2.9', '~1.2.0')).toBe(true);
    expect(semver.satisfies('1.3.0', '~1.2.0')).toBe(false);
    expect(semver.satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(semver.satisfies('3.0.0', '^1.0.0 || ^3.0.0')).toBe(true);
    expect(semver.satisfies('0.1.0', '*')).toBe(true);
    expect(semver.satisfies('0.1.0', '^0.1')).toBe(true);
  });
});

function setup(managerOptions: ConstructorParameters<typeof PluginManager>[1] = {}) {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  engine
    .use(ecs)
    .use(new AssetPlugin({ noDefaultLoaders: true }))
    .use(new ShaderPlugin());
  engine.start();
  const plugins = new PluginManager(engine, managerOptions);
  return { engine, plugins, world: ecs.world, ecs, frame: () => clock.frame(16) };
}

const minimal = (overrides: Partial<PluginPackage> = {}): PluginPackage => ({
  name: 'test/minimal',
  version: '1.0.0',
  setup() {},
  ...overrides,
});

describe('安裝與檢查', () => {
  test('格式、版本、相依、重複安裝', async () => {
    const { plugins } = setup();
    await expect(plugins.install({ name: 'x', version: '1', setup() {} } as PluginPackage)).rejects.toThrow(
      /版本格式錯誤/,
    );
    await expect(plugins.install({ name: 'bad name!', version: '1.0.0', setup() {} })).rejects.toThrow(/名稱格式錯誤/);
    await expect(plugins.install({ name: 'x', version: '1.0.0' } as PluginPackage)).rejects.toThrow(/缺少 setup/);
    await expect(plugins.install(minimal({ engine: '^9.0.0' }))).rejects.toThrow(
      new RegExp(`需要引擎版本 \\^9\\.0\\.0，目前是 ${ENGINE_VERSION.replace(/\./g, '\\.')}`),
    );
    await expect(plugins.install(minimal({ requires: ['physics'] }))).rejects.toThrow(/需要先安裝：physics/);

    const info = await plugins.install(minimal({ description: '說明', engine: '^0.1.0', requires: ['ecs'] }));
    expect(info).toMatchObject({ name: 'test/minimal', version: '1.0.0', description: '說明', source: 'local' });
    await expect(plugins.install(minimal())).rejects.toThrow(/已安裝/);
    expect(plugins.list().map((p) => p.name)).toEqual(['test/minimal']);
  });

  test('套件之間的相依：被依賴的不能先移除', async () => {
    const { plugins } = setup();
    await plugins.install(minimal({ name: 'test/base' }));
    await plugins.install(minimal({ name: 'test/addon', requires: ['test/base'] }));
    expect(() => plugins.uninstall('test/base')).toThrow(/test\/addon 需要它/);
    plugins.uninstallAll();
    expect(plugins.list()).toEqual([]);
  });
});

describe('自動撤銷', () => {
  test('系統、階段回呼、資源、載入器、介面元件、著色器、片段都會在移除時撤銷', async () => {
    const { plugins, world, ecs, frame } = setup();
    const runs: string[] = [];
    const key = { name: 'test-resource' } as never;
    class UIThing extends (await import('../src/ui2d')).UILabel {}
    const pkg = define.plugin<{ label: string }>({
      name: 'test/everything',
      version: '1.0.0',
      setup(ctx, options) {
        ctx.addSystem({ name: 'tick', run: () => runs.push(options.label) });
        ctx.on('lateUpdate', () => runs.push('late'));
        ctx.setResource(key, 42);
        ctx.registerLoader('custom', { extensions: ['.custom'], load: async () => 'ok' });
        ctx.registerUIComponent('UIThing', UIThing);
        ctx.defineShader({ name: 'testShader', base: 'unlit' });
        ctx.registerChunk('test_chunk', 'float x;');
        ctx.onDispose(() => runs.push('disposed'));
        expect(ctx.api.THREE).toBe(THREE); // 共用同一份 three.js
      },
    });
    await plugins.install(pkg, { label: 'tick' });
    frame();
    expect(runs).toEqual(['tick', 'late']);
    expect(ecs.hasSystem('test/everything:tick')).toBe(true);
    expect(world.getResource(key)).toBe(42);
    expect(UI2D.components.has('UIThing')).toBe(true);
    expect(world.requireResource(ShadersKey).has('testShader')).toBe(true);
    expect((THREE.ShaderChunk as Record<string, string>).test_chunk).toBe('float x;');

    plugins.uninstall('test/everything');
    runs.length = 0;
    frame();
    expect(runs).toEqual([]);
    expect(ecs.hasSystem('test/everything:tick')).toBe(false);
    expect(world.getResource(key)).toBeUndefined();
    expect(UI2D.components.has('UIThing')).toBe(false);
    expect(world.requireResource(ShadersKey).has('testShader')).toBe(false);
    expect((THREE.ShaderChunk as Record<string, string>).test_chunk).toBeUndefined();
  });

  test('覆蓋內建元件時，移除後還原原本的', async () => {
    const { plugins } = setup();
    const original = UI2D.components.get('UILabel');
    class MyLabel extends (await import('../src/ui2d')).UILabel {}
    await plugins.install(minimal({ setup: (ctx) => ctx.registerUIComponent('UILabel', MyLabel) }));
    expect(UI2D.components.get('UILabel')).toBe(MyLabel);
    plugins.uninstall('test/minimal');
    expect(UI2D.components.get('UILabel')).toBe(original);
  });

  test('安裝失敗時撤銷已註冊的部分', async () => {
    const { plugins, ecs } = setup();
    await expect(
      plugins.install(
        minimal({
          setup(ctx) {
            ctx.addSystem({ name: 'half', run() {} });
            throw new Error('壞掉了');
          },
        }),
      ),
    ).rejects.toThrow(/安裝失敗：壞掉了/);
    expect(ecs.hasSystem('test/minimal:half')).toBe(false);
    expect(plugins.has('test/minimal')).toBe(false);
  });
});

describe('從網址安裝', () => {
  const pkgModule = { default: minimal({ name: 'remote/pkg' }) };

  test('非信任來源沒有 integrity 會拒絕', async () => {
    const { plugins } = setup();
    await expect(plugins.installFromUrl('https://evil.example.com/p.js')).rejects.toThrow(/非信任來源/);
  });

  test('信任來源直接匯入', async () => {
    const importModule = vi.fn(async () => pkgModule);
    const { plugins } = setup({ trustedOrigins: ['https://cdn.example.com'], importModule });
    const info = await plugins.installFromUrl('https://cdn.example.com/p.js');
    expect(importModule).toHaveBeenCalledWith('https://cdn.example.com/p.js');
    expect(info.source).toBe('https://cdn.example.com/p.js');
  });

  test('integrity 驗證：內容相符才安裝，被竄改就拒絕', async () => {
    const code = 'export default { name: "remote/pkg", version: "1.0.0", setup() {} };';
    const hash = await integrity.compute(code);
    let served = code;
    const fetch = async () => ({ ok: true, status: 200, text: async () => served });
    const importModule = vi.fn(async (_url: string, src?: string) => {
      expect(src).toBe(code); // 匯入的就是驗證過的那一份
      return pkgModule;
    });
    const { plugins } = setup({ fetch, importModule });
    await plugins.installFromUrl('https://other.example.com/p.js', { integrity: hash });
    expect(plugins.has('remote/pkg')).toBe(true);
    plugins.uninstall('remote/pkg');

    served = `${code}\nstealCookies();`;
    await expect(plugins.installFromUrl('https://other.example.com/p.js', { integrity: hash })).rejects.toThrow(
      /驗證失敗/,
    );
    expect(plugins.has('remote/pkg')).toBe(false);
  });

  test('模組沒有匯出套件時報錯', async () => {
    const { plugins } = setup({ importModule: async () => ({ something: 1 }) });
    await expect(plugins.installFromUrl('local.js')).rejects.toThrow(/沒有匯出套件/);
  });
});

describe('第三方套件：從原始碼安裝（ES 模組，只透過 ctx.api 使用引擎）', () => {
  /** 一個獨立的第三方套件：註冊 <UIHello> 元件，系統每 interval 秒更新文字 */
  const source = `export default {
    name: 'community/hello', version: '1.0.0', engine: '^0.1.0', requires: ['ecs'],
    setup(ctx, options) {
      const { UILabel } = ctx.api.ui2d;
      const labels = new Set();
      class UIHello extends UILabel {
        constructor(c, type, raw, text) { super(c, type, raw, text || 'hello'); labels.add(this); }
        destroy() { labels.delete(this); super.destroy(); }
      }
      ctx.registerUIComponent('UIHello', UIHello);
      let t = 0;
      ctx.addSystem({ name: 'update', phase: 'render', run(world, time) {
        t += time.realDelta ?? time.unscaledDelta;
        if (t < (options.interval ?? 0.5)) return;
        t = 0;
        for (const l of labels) l.setText('實體 ' + world.entityCount);
      } });
      ctx.onDispose(() => labels.clear());
    },
  };`;

  test('驗證雜湊後安裝：註冊自訂元件、系統更新文字；移除套件後元件也移除', async () => {
    const { plugins, frame, world } = setup({
      importModule: async (_u, code) =>
        import(/* @vite-ignore */ `data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code!)))}`),
      fetch: async () => ({ ok: true, status: 200, text: async () => source }),
      api: { ui2d }, // 套件用到 ctx.api.ui2d
    });
    await plugins.installFromUrl('plugins/hello.js', {
      integrity: await integrity.compute(source),
      options: { interval: 0.1 },
    });

    const ui = await UI2D.create({ container: null, width: 300, height: 100, measure: measure.fixed() });
    ui.loadString('<UILayout><UIHello id="hello"/></UILayout>');
    world.spawn();
    for (let i = 0; i < 8; i++) frame();
    expect((ui.get('hello') as unknown as { text: string }).text).toBe('實體 1');

    plugins.uninstall('community/hello');
    expect(() => ui.loadString('<UILayout><UIHello/></UILayout>')).toThrow(/不認識的元件/);
  });
});

describe('ctx.api：只提供遊戲給的模組', () => {
  test('沒有提供的模組：用到時說明要加哪一個；version、THREE 一定有', async () => {
    const { plugins } = setup();
    const seen: unknown[] = [];
    await plugins.install(minimal({ setup: (ctx) => void seen.push(ctx.api.version, typeof ctx.api.THREE.Vector3) }));
    expect(seen).toEqual([ENGINE_VERSION, 'function']);
    await expect(
      plugins.install(minimal({ name: 'test/needs-ui', setup: (ctx) => void ctx.api.ui2d.UILabel })),
    ).rejects.toThrow(/ctx\.api\.ui2d.*api: \{ ui2d \}/);
  });

  test('optionalApi：可有可無的模組，沒提供時是 undefined', async () => {
    const got: unknown[] = [];
    const pkg = minimal({ setup: (ctx) => void got.push(ctx.optionalApi('physics'), ctx.optionalApi('audio')) });
    await setup({ api: { physics } }).plugins.install(pkg);
    expect(got).toEqual([physics, undefined]);
  });
});
