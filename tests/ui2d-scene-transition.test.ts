import { afterEach, describe, expect, test, vi } from 'vitest';
import { SceneTransition, UI2D, uiXml, measure, type UILabel, type UIProgressBar } from '../src/ui2d';

function files(map: Record<string, string>) {
  uiXml.register(Object.fromEntries(Object.entries(map).map(([path, xml]) => [`/ui/${path}`, async () => xml])));
}
const create = () =>
  UI2D.create({
    container: null,
    width: 800,
    height: 600,
    measure: measure.fixed(0.5),
    autoTick: false,
    loadImage: async () => ({ width: 10, height: 10 }),
  });
afterEach(() => uiXml.clearCache());

describe('相對路徑：場景資料夾裡的介面', () => {
  test('uiXml.normalizePath 整理 ./ 與 ../', () => {
    expect(uiXml.normalizePath('ui/orbit/../theme.xml')).toBe('ui/theme.xml');
    expect(uiXml.normalizePath('ui/./coin.png')).toBe('ui/coin.png');
    expect(uiXml.normalizePath('ui/../../x.png')).toBe('../x.png');
    expect(uiXml.normalizePath('/ui/a/../b.xml?v=1')).toBe('/ui/b.xml?v=1');
  });

  test('疊加圖層的圖片、UIImport 以圖層自己的檔案位置為基準', async () => {
    files({
      'p1/theme.xml': '<UI><UIStyle name="big" fontSize="30"/></UI>',
      'p1/scene/hud.xml':
        '<UI><UIImport src="../theme.xml"/><UILabel id="t" style="big">字</UILabel><UIImage id="img" src="bg.png"/></UI>',
    });
    const ui = await create();
    ui.loadString('<UI/>', 'ui/');
    const xml =
      '<UI><UIImport src="../theme.xml"/><UILabel id="t" style="big">字</UILabel><UIImage id="img" src="bg.png"/></UI>';
    await ui.preloadComponents(xml, 'ui/p1/scene/', 'ui/p1/scene/hud.xml');
    const layer = ui.addLayer('hud', xml, 'ui/p1/scene/hud.xml');
    ui.layout();
    expect((layer.find('img') as unknown as { src: string }).src).toBe('ui/p1/scene/bg.png');
    expect(layer.find('t')!.attrs.fontSize).toBe('30'); // ../theme.xml 的樣式有套用
  });

  test('內嵌元件的內容以那個檔案的位置為基準', async () => {
    files({ 'p2/card/card.xml': '<UI><UIImage id="img" src="icon.png"/></UI>' });
    const ui = await create();
    ui.loadString('<UI><UIComponent src="p2/card/card.xml"/></UI>', 'ui/');
    await ui.whenComponentsLoaded();
    expect((ui.get('img') as unknown as { src: string }).src).toBe('ui/p2/card/icon.png');
  });
});

describe('SceneTransition', () => {
  const setup = async (extra: Partial<ConstructorParameters<typeof SceneTransition>[0]> = {}) => {
    const ui = await create();
    ui.loadString('<UI/>', 'ui/');
    const loaded: string[] = [];
    const scenes = { load: vi.fn((name: string) => loaded.push(name)) };
    const assets = {
      load: vi.fn(async (url: string) => {
        if (url.includes('missing')) throw new Error('404');
        return url;
      }),
    };
    const t = new SceneTransition({ ui, scenes, assets, duration: 0, minLoadingTime: 0, ...extra });
    return { ui, t, scenes, assets, loaded };
  };

  test('進入場景：載入頁面 → 下載資源 → 切換 3D 場景 → 疊上場景介面，轉場用的圖層都移除', async () => {
    files({ 's1/forest/hud.xml': '<UI><UILabel id="sceneName">森林</UILabel></UI>' });
    const { ui, t, scenes, assets } = await setup();
    t.define('forest', {
      scene: 'forestScene',
      title: '迷霧森林',
      hud: 'ui/s1/forest/hud.xml',
      assets: ['textures/a.png', { url: 'models/b.glb', type: 'gltf' }],
    });
    const progress: number[] = [];
    t.onProgress((p) => progress.push(p.progress));
    await t.go('forest');
    expect(scenes.load).toHaveBeenCalledWith('forestScene');
    expect(assets.load).toHaveBeenCalledWith('textures/a.png', undefined);
    expect(assets.load).toHaveBeenCalledWith('models/b.glb', 'gltf');
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect(ui.layerNames).toEqual(['scene:forest']);
    expect(ui.get<UILabel>('sceneName')?.text).toBe('森林');
    expect(t.current).toBe('forest');
  });

  test('載入頁面顯示場景名稱與進度；失敗的資源不會讓轉場卡住', async () => {
    files({
      's2/loading.xml':
        '<UI><UILabel id="loadingTitle"/><UIProgressBar id="loadingBar"/><UILabel id="loadingText"/></UI>',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ui, t } = await setup({ loading: 'ui/s2/loading.xml' });
    t.define('a', { title: '第一關', assets: ['ok.png', 'missing.png'] });
    let seen: { title?: string; bar?: number; text?: string } = {};
    t.onProgress((p) => {
      if (p.loaded !== p.total) return;
      const page = ui.getLayer('__sceneLoading')!;
      seen = {
        title: (page.find('loadingTitle') as UILabel).text,
        bar: (page.find('loadingBar') as unknown as UIProgressBar).value,
        text: (page.find('loadingText') as UILabel).text,
      };
    });
    await t.go('a');
    expect(seen).toEqual({ title: '第一關', bar: 100, text: '100%' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing.png'));
    expect(ui.layerNames).toEqual([]);
    warn.mockRestore();
  });

  test('換場景：移除舊場景的介面、呼叫 onExit／onEnter；每次進入都會經過載入頁面', async () => {
    files({ 's3/one/hud.xml': '<UI><UILabel id="one"/></UI>', 's3/two/hud.xml': '<UI><UILabel id="two"/></UI>' });
    const { ui, t, loaded } = await setup();
    const log: string[] = [];
    t.define('one', {
      hud: 'ui/s3/one/hud.xml',
      onEnter: () => void log.push('enter one'),
      onExit: () => void log.push('exit one'),
    }).define('two', { hud: 'ui/s3/two/hud.xml', onEnter: () => void log.push('enter two') });
    const pages: string[] = [];
    t.onProgress((p) => p.loaded === 0 && ui.getLayer('__sceneLoading') && pages.push(p.scene));
    await t.go('one');
    await t.go('two');
    expect(loaded).toEqual(['one', 'two']);
    expect(pages).toEqual(['one', 'two']);
    expect(log).toEqual(['enter one', 'exit one', 'enter two']);
    expect(ui.layerNames).toEqual(['scene:two']);
  });

  test('轉場中再呼叫 go：結束後進入最後要求的場景', async () => {
    const { t, loaded } = await setup();
    t.defineAll({ a: {}, b: {}, c: {} });
    const first = t.go('a');
    void t.go('b');
    void t.go('c');
    await first;
    await vi.waitFor(() => expect(t.current).toBe('c'));
    await vi.waitFor(() => expect(t.busy).toBe(false));
    expect(loaded).toEqual(['a', 'c']);
  });

  test('沒有定義的場景：錯誤訊息列出已定義的場景', async () => {
    const { t } = await setup();
    t.define('a');
    await expect(t.go('zzz')).rejects.toThrow('已定義：a');
  });
});

describe('addLayer 的 order', () => {
  test("order: 'bottom' 放在所有圖層下面；點擊先打到上面的圖層", async () => {
    const ui = await create();
    ui.loadString('<UI/>', 'ui/');
    ui.addLayer('window', '<UI><UIButton id="top" width="100" height="100" onClick="x"/></UI>');
    ui.addLayer('hud', '<UI><UIButton id="under" width="100" height="100" onClick="x"/></UI>', undefined, {
      order: 'bottom',
    });
    ui.layout();
    expect(ui.layerNames).toEqual(['hud', 'window']);
    expect(ui.hitTest(50, 50)?.id).toBe('top');
  });

  test('場景介面放在已經開著的畫面下面', async () => {
    files({ 's9/hud.xml': '<UI><UILabel id="h"/></UI>' });
    const ui = await create();
    ui.loadString('<UI/>', 'ui/');
    ui.addLayer('title', '<UI/>');
    const t = new SceneTransition({ ui, duration: 0, minLoadingTime: 0 }).define('a', { hud: 'ui/s9/hud.xml' });
    await t.go('a');
    expect(ui.layerNames).toEqual(['scene:a', 'title']);
  });
});

test('target：轉場中是正在進入的場景', async () => {
  const ui = await create();
  ui.loadString('<UI/>', 'ui/');
  const t = new SceneTransition({ ui, duration: 0, minLoadingTime: 0 }).defineAll({ a: {}, b: {} });
  expect(t.target).toBe(null);
  const p = t.go('a');
  expect(t.target).toBe('a');
  expect(t.current).toBe(null);
  await p;
  expect([t.current, t.target]).toEqual(['a', 'a']);
});

test('轉場中才打開的畫面不會蓋過黑幕與載入頁面', async () => {
  const ui = await create();
  ui.loadString('<UI/>', 'ui/');
  const t = new SceneTransition({ ui, duration: 0, minLoadingTime: 0.15 }).define('a');
  let during: string[] = [];
  t.onProgress((p) => {
    if (p.loaded !== p.total) return;
    ui.addLayer('title', '<UI/>'); // 載入中打開標題畫面
    setTimeout(() => (during = ui.layerNames), 80);
  });
  await t.go('a');
  expect(during).toEqual(['title', '__sceneCover', '__sceneLoading']);
  expect(ui.layerNames).toEqual(['title']);
});

describe('淡入前準備好畫面（不會閃爍）', () => {
  test('beforeReveal 在淡入前執行：打開的畫面在黑幕下面，淡入時已經在畫面上', async () => {
    const ui = await create();
    ui.loadString('<UI/>', 'ui/');
    const opacities: string[] = [];
    const t = new SceneTransition({ ui, duration: 0, minLoadingTime: 0 }).define('a');
    await t.go('a', {
      beforeReveal: () => {
        ui.addLayer('title', '<UI/>');
        opacities.push(ui.getLayer('__sceneCover')!.attrs.opacity);
      },
    });
    expect(opacities).toEqual(['1']); // 打開標題時畫面是全黑的
    expect(ui.layerNames).toEqual(['title']);
  });

  test('第一次進入直接全黑（不從透明淡出）', async () => {
    const ui = await create();
    ui.loadString('<UI/>', 'ui/');
    const seen: string[] = [];
    const t = new SceneTransition({ ui, duration: 0.05, minLoadingTime: 0 }).defineAll({ a: {}, b: {} });
    t.onChange(
      (c) =>
        c.type === 'start' && queueMicrotask(() => seen.push(`${c.to}:${ui.getLayer('__sceneCover')?.attrs.opacity}`)),
    );
    await t.go('a');
    await t.go('b');
    expect(seen[0]).toBe('a:1');
    expect(seen[1]).toBe('b:0'); // 之後的轉場照常從透明淡出
  });

  test('ui.whenReady() 等圖片讀完；轉場淡入前也會等', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ui = await UI2D.create({
      container: null,
      width: 800,
      height: 600,
      measure: measure.fixed(0.5),
      autoTick: false,
      loadImage: async () => {
        await gate;
        return { width: 10, height: 10 };
      },
    });
    ui.loadString('<UI><UIImage src="big.png"/></UI>', 'ui/');
    let ready = false;
    void ui.whenReady().then(() => (ready = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(ready).toBe(false);
    release();
    await vi.waitFor(() => expect(ready).toBe(true));
  });
});

describe('全螢幕單色層淡入淡出（不重畫介面）', () => {
  const setup = async () => {
    files({ 'f1/hud.xml': '<UI><UILabel id="hudLabel">HUD</UILabel></UI>' });
    const ui = await create();
    ui.loadString('<UI/>', 'ui/');
    let faderValue = 0;
    const faderValues: number[] = [];
    const fader = {
      set: (v: number) => {
        faderValue = v;
        faderValues.push(v);
      },
    };
    const coverOpacities = new Set<string>();
    const events: string[] = [];
    // 每一幀記錄介面黑幕的透明度、載入頁面出現時單色層的狀態
    const requestFrame = (cb: () => void) =>
      setTimeout(() => {
        const cover = ui.getLayer('__sceneCover');
        if (cover) coverOpacities.add(cover.attrs.opacity);
        if (ui.getLayer('__sceneLoading') && !events.some((e) => e.startsWith('loading')))
          events.push(`loading:${faderValue}`);
        cb();
      }, 1);
    const scenes = { load: (name: string) => events.push(`load ${name}:${faderValue}`) };
    const t = new SceneTransition({ ui, scenes, fader, duration: 0.03, minLoadingTime: 0, requestFrame }).defineAll({
      a: { hud: 'ui/f1/hud.xml' },
      b: {},
    });
    return { ui, t, events, faderValues, coverOpacities, value: () => faderValue };
  };

  test('淡入淡出只改單色層；介面黑幕只有 0 或 1（不會每幀重畫介面）', async () => {
    const { ui, t, faderValues, coverOpacities, value } = await setup();
    await t.go('a');
    await t.go('b');
    expect(faderValues.some((v) => v > 0 && v < 1)).toBe(true); // 有中間值：真的有動畫
    expect([...coverOpacities].every((o) => o === '0' || o === '1')).toBe(true);
    expect(value()).toBe(0); // 結束後看不到
    expect(ui.layerNames).toEqual([]); // 轉場用的圖層都移除（b 沒有場景介面）
  });

  test('載入頁面、切換 3D 場景都在全黑時發生；轉場一開始就擋住滑鼠', async () => {
    const { ui, t, events } = await setup();
    await t.go('a');
    events.length = 0;
    const going = t.go('b');
    ui.layout();
    expect(ui.hitTest(400, 300)).toBe(ui.getLayer('__sceneCover')); // 淡出中點不到遊戲介面
    await going;
    expect(events).toEqual(['loading:1', 'load b:1']);
  });

  test('effect: none 或指定 fader: null 時改用介面圖層', async () => {
    const ui = await create();
    ui.loadString('<UI/>', 'ui/');
    const fader = { set: vi.fn() };
    await new SceneTransition({ ui, fader: null, duration: 0, minLoadingTime: 0 }).define('a').go('a');
    await new SceneTransition({ ui, fader, effect: 'none', minLoadingTime: 0 }).define('a').go('a');
    expect(fader.set).not.toHaveBeenCalled();
  });
});
