import { afterEach, describe, expect, test, vi } from 'vitest';
import { UI2D, type UIComponent, UILabel, UIScreenManager, uiXml, measure, type UIElement } from '../src/ui2d';

/** 假的檔案（用打包後的對照表提供，不需要網路） */
function files(map: Record<string, string>) {
  const loads: string[] = [];
  uiXml.register(
    Object.fromEntries(
      Object.entries(map).map(([path, xml]) => [
        `/ui/${path}`,
        async () => {
          loads.push(path);
          return xml;
        },
      ]),
    ),
  );
  return loads;
}

const create = () =>
  UI2D.create({ container: null, width: 800, height: 600, measure: measure.fixed(0.5), autoTick: false });
const label = (ui: UI2D, id: string) => ui.get<UILabel>(id);
const texts = (el: UIElement) => {
  const out: string[] = [];
  el.walk((e) => {
    if (e instanceof UILabel) out.push(e.text);
  });
  return out;
};

afterEach(() => uiXml.clearCache());

describe('<UIComponent src>：內嵌外部介面檔', () => {
  test('ui.load 會先讀好內嵌的檔案：載入後馬上找得到裡面的元件', async () => {
    files({
      'c1-main.xml': '<UI><UILabel id="outer">外面</UILabel><UIComponent id="card" src="c1-card.xml"/></UI>',
      'c1-card.xml': '<UI gap="6"><UILabel id="inner">卡片</UILabel></UI>',
    });
    const ui = await create();
    await ui.load('ui/c1-main.xml');
    const card = ui.get<UIComponent>('card')!;
    expect(card.status).toBe('loaded');
    expect(label(ui, 'inner')?.text).toBe('卡片');
    expect(label(ui, 'inner')!.parent).toBe(card);
    expect(label(ui, 'inner')!.includedFrom).toBe('ui/c1-card.xml');
    expect(card.attrs.gap).toBe('6'); // 外部 <UI> 的屬性套用到元件上
  });

  test('loadString 沒有先讀：背景讀取後放入內容', async () => {
    files({ 'c2-card.xml': '<UI><UILabel id="inner">稍後出現</UILabel></UI>' });
    const ui = await create();
    ui.loadString('<UI><UIComponent id="card" src="c2-card.xml"/></UI>', 'ui/');
    expect(ui.get<UIComponent>('card')!.status).toBe('loading');
    await ui.whenComponentsLoaded();
    expect(ui.get<UIComponent>('card')!.status).toBe('loaded');
    expect(label(ui, 'inner')?.text).toBe('稍後出現');
    ui.layout();
    expect(label(ui, 'inner')!.layout.width).toBeGreaterThan(0); // 有排版
  });

  test('同一個檔案可以重複使用；同時要求只會讀一次', async () => {
    const loads = files({ 'c3-row.xml': '<UILabel>一列</UILabel>' });
    const ui = await create();
    ui.loadString(
      '<UI><UIComponent src="c3-row.xml"/><UIComponent src="c3-row.xml"/><UIComponent src="./c3-row.xml"/></UI>',
      'ui/',
    );
    await ui.whenComponentsLoaded();
    expect(texts(ui.root!)).toEqual(['一列', '一列', '一列']);
    expect(loads.filter((n) => n === 'c3-row.xml')).toHaveLength(1);
  });

  test('根元素不是 <UI> 時整個放進來；自己寫的屬性比外部 <UI> 的屬性優先', async () => {
    files({
      'c4-win.xml': '<UIWindow id="win" title="視窗"><UILabel>內容</UILabel></UIWindow>',
      'c4-box.xml': '<UI padding="20" gap="4"><UILabel>x</UILabel></UI>',
    });
    const ui = await create();
    await ui.load('ui/c4-host.xml').catch(() => null); // 沒有這個檔案：確認不影響後面
    ui.loadString(
      '<UI><UIComponent id="a" src="c4-win.xml"/><UIComponent id="b" src="c4-box.xml" padding="2"/></UI>',
      'ui/',
    );
    await ui.whenComponentsLoaded();
    ui.layout();
    expect(ui.get('win')!.type).toBe('UIWindow');
    expect(ui.get('win')!.parent!.id).toBe('a');
    expect(ui.get('b')!.attrs.padding).toBe('2');
    expect(ui.get('b')!.attrs.gap).toBe('4');
  });

  test('外部檔案的樣式只套用在裡面；外層的樣式在裡面也可以用', async () => {
    files({
      'c5-card.xml':
        '<UI><UIStyle name="title" fontSize="30"/><UISkin for="UILabel" color="#ff0000"/><UILabel id="t" style="title">標題</UILabel><UILabel id="o" style="outerStyle">外層樣式</UILabel></UI>',
    });
    const ui = await create();
    ui.loadString(
      '<UI><UIStyle name="outerStyle" fontSize="11"/><UIStyle name="title" fontSize="12"/><UIComponent src="c5-card.xml"/><UILabel id="main" style="title">外面</UILabel></UI>',
      'ui/',
    );
    await ui.whenComponentsLoaded();
    ui.layout();
    expect(label(ui, 't')!.attrs.fontSize).toBe('30'); // 裡面用自己的 title
    expect(label(ui, 't')!.attrs.color).toBe('#ff0000'); // 裡面的外觀
    expect(label(ui, 'o')!.attrs.fontSize).toBe('11'); // 外層的樣式也找得到
    expect(label(ui, 'main')!.attrs.fontSize).toBe('12'); // 外面不受影響
    expect(label(ui, 'main')!.attrs.color).not.toBe('#ff0000');
  });

  test('內嵌裡還有內嵌；循環內嵌會顯示錯誤而不會卡住', async () => {
    files({
      'c6-a.xml': '<UI><UILabel id="la">A</UILabel><UIComponent src="c6-b.xml"/></UI>',
      'c6-b.xml': '<UI><UILabel id="lb">B</UILabel><UIComponent id="back" src="c6-a.xml"/></UI>',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = await create();
    await ui.load('ui/c6-a.xml');
    expect(label(ui, 'la')?.text).toBe('A');
    expect(label(ui, 'lb')?.text).toBe('B');
    const back = ui.get<UIComponent>('back')!;
    expect(back.status).toBe('error');
    expect(back.error).toMatch(/循環內嵌/);
    expect(texts(back)[0]).toMatch(/⚠ 循環內嵌/);
    warn.mockRestore();
  });

  test('找不到檔案、XML 錯誤、沒有 src：元件裡顯示訊息', async () => {
    files({ 'c7-bad.xml': '<UI><UILabel>沒有關閉</UI>' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '' })),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = await create();
    ui.loadString(
      '<UI><UIComponent id="miss" src="c7-missing.xml"/><UIComponent id="bad" src="c7-bad.xml"/><UIComponent id="none"/></UI>',
      'ui/',
    );
    await ui.whenComponentsLoaded();
    expect(ui.get<UIComponent>('miss')!.status).toBe('error');
    expect(texts(ui.get('miss')!)[0]).toMatch(/無法讀取 c7-missing\.xml.*404/);
    expect(ui.get<UIComponent>('bad')!.status).toBe('error');
    expect(ui.get<UIComponent>('none')!.status).toBe('empty');
    expect(texts(ui.get('none')!)[0]).toMatch(/請設定 src/);
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  test('標籤裡不能放子元件', async () => {
    const ui = await create();
    expect(() =>
      ui.loadString('<UI><UIComponent src="x.xml"><UILabel>不行</UILabel></UIComponent></UI>', 'ui/'),
    ).toThrow(/不能放子元件/);
  });

  test('畫面管理：切換畫面後內嵌的內容馬上就在', async () => {
    files({ 'c9-shared.xml': '<UI><UIButton id="sharedBtn" text="共用按鈕"/></UI>' });
    const ui = await create();
    const pages: Record<string, string> = {
      'ui/c9-hud.xml': '<UI><UILabel>HUD</UILabel></UI>',
      'ui/c9-menu.xml': '<UI><UIWindow title="選單"><UIComponent src="c9-shared.xml"/></UIWindow></UI>',
    };
    const screens = new UIScreenManager(ui, { fetch: async (url) => pages[url] }).registerAll({
      hud: 'ui/c9-hud.xml',
      menu: 'ui/c9-menu.xml',
    });
    await screens.show('hud');
    await screens.open('menu');
    expect(ui.get('sharedBtn')).toBeDefined();
  });
});

describe('<UIImport src>：匯入另一個檔案的樣式與外觀（共用主題）', () => {
  test('匯入的 UIStyle、UISkin 可以用；自己寫的蓋過匯入的；匯入檔裡的元件不會建立', async () => {
    files({
      'i1-theme.xml':
        '<UI><UIStyle name="title" fontSize="24" color="#ffd75e"/><UISkin for="UIButton" radius="12" color="#111111"/><UILabel id="preview">主題預覽</UILabel></UI>',
    });
    const ui = await create();
    await ui.load('ui/i1-main.xml').catch(() => null);
    await ui.preloadComponents('<UI><UIImport src="i1-theme.xml"/></UI>', 'ui/');
    ui.loadString(
      '<UI><UIImport src="i1-theme.xml"/><UISkin for="UIButton" color="#222222"/><UILabel id="t" style="title">標題</UILabel><UIButton id="b" text="按鈕"/></UI>',
      'ui/',
    );
    expect(label(ui, 't')!.attrs.fontSize).toBe('24');
    expect(ui.get('b')!.attrs.radius).toBe('12'); // 匯入的外觀
    expect(ui.get('b')!.attrs.color).toBe('#222222'); // 自己的外觀優先
    expect(ui.get('preview')).toBeUndefined(); // 匯入只取樣式
  });

  test('還沒讀過的主題：背景讀好後自動重新套用（圖層、內嵌元件也一樣）', async () => {
    files({
      'i2-theme.xml': '<UI><UIStyle name="big" fontSize="40"/></UI>',
      'i2-part.xml': '<UI><UIImport src="i2-theme.xml"/><UILabel id="inPart" style="big">x</UILabel></UI>',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = await create();
    ui.loadString(
      '<UI><UIImport src="i2-theme.xml"/><UILabel id="a" style="big">a</UILabel><UIComponent src="i2-part.xml"/></UI>',
      'ui/',
    );
    ui.addLayer('pop', '<UI><UIImport src="i2-theme.xml"/><UILabel id="l" style="big">l</UILabel></UI>');
    await ui.whenComponentsLoaded();
    ui.layout();
    expect(label(ui, 'a')!.attrs.fontSize).toBe('40');
    expect(label(ui, 'l')!.attrs.fontSize).toBe('40');
    expect(label(ui, 'inPart')!.attrs.fontSize).toBe('40');
    warn.mockRestore();
  });

  test('主題讀取中不誤報「找不到樣式」；讀好後真的沒有的樣式才警告', async () => {
    files({ 'i4-theme.xml': '<UI><UIStyle name="big" fontSize="40"/></UI>' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = await create();
    ui.loadString(
      '<UI><UIImport src="i4-theme.xml"/><UILabel style="big">a</UILabel><UILabel style="nope">b</UILabel></UI>',
      'ui/',
    );
    const missing = () => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('找不到樣式'));
    expect(missing()).toEqual([]); // 主題還在讀：不警告
    await ui.whenComponentsLoaded();
    expect(missing().some((m) => m.includes('big'))).toBe(false);
    expect(missing().some((m) => m.includes('nope'))).toBe(true);
    warn.mockRestore();
  });

  test('ui.load 會先讀好主題（載入後馬上套用）；循環匯入不會卡住', async () => {
    files({
      'i3-a.xml': '<UI><UIImport src="i3-b.xml"/><UIStyle name="fromA" fontSize="11"/></UI>',
      'i3-b.xml': '<UI><UIImport src="i3-a.xml"/><UIStyle name="fromB" fontSize="22"/></UI>',
      'i3-main.xml': '<UI><UIImport src="i3-a.xml"/><UILabel id="x" style="fromB">x</UILabel></UI>',
    });
    const ui = await create();
    await ui.load('ui/i3-main.xml');
    expect(label(ui, 'x')!.attrs.fontSize).toBe('22');
  });

  test('沒有 src 是錯誤', async () => {
    const ui = await create();
    expect(() => ui.loadString('<UI><UIImport/></UI>', 'ui/')).toThrow(/需要 src/);
  });
});

describe('pointerEvents="none" 與內建 <UIFpsMeter>', () => {
  test('pointerEvents="none" 的元件和裡面的元件都不接收滑鼠（hitTest 穿透到後面）', async () => {
    const ui = await create();
    ui.loadString(
      '<UI><UILayout id="back" position="absolute" left="0" top="0" width="200" height="200" background="#111"/><UILayout id="over" position="absolute" left="0" top="0" width="100" height="100" background="#222" pointerEvents="none"><UIButton id="inner" text="x"/></UILayout></UI>',
    );
    ui.layout();
    expect(ui.hitTest(20, 20)?.id).toBe('back');
    expect(ui.handlePointer('down', 20, 20)).toBe(true); // 後面的面板接到
    ui.loadString('<UI><UILayout pointerEvents="none" width="100" height="100" background="#222"/></UI>');
    ui.layout();
    expect(ui.hitTest(20, 20)).toBeNull();
    expect(ui.handlePointer('down', 20, 20)).toBe(false); // 交給遊戲
  });

  test('UIFpsMeter 是內建元件：預設滑鼠穿透；依量到的 FPS 更新文字與顏色', async () => {
    const ui = await create();
    ui.loadString('<UI><UIFpsMeter id="fps" format="FPS {fps}" interval="0.1"/></UI>');
    ui.layout();
    const meter = ui.get('fps') as unknown as {
      text: string;
      fps: number;
      attrs: Record<string, string>;
      tick(): boolean;
    };
    expect(meter.text).toBe('FPS --');
    expect(meter.attrs.pointerEvents).toBe('none');
    expect(ui.hitTest(10, 10)).toBeNull();
    const now = vi.spyOn(performance, 'now');
    let t = 1000;
    now.mockImplementation(() => t);
    for (let i = 0; i < 7; i++) {
      meter.tick();
      t += 1000 / 60;
    } // 60 FPS
    expect(meter.fps).toBe(60);
    expect(meter.text).toBe('FPS 60');
    expect(meter.attrs.color).toBe('#9be29b');
    for (let i = 0; i < 3; i++) {
      meter.tick();
      t += 1000 / 20;
    } // 20 FPS
    expect(meter.fps).toBeLessThan(30);
    expect(meter.attrs.color).toBe('#ff8a80');
    now.mockRestore();
  });
});

describe('<UIComponent> 的寬高由外部檔案的 <UI> 決定', () => {
  const size = (el: UIElement | undefined) => [Math.round(el!.layout.width), Math.round(el!.layout.height)];

  test('外部 <UI width height>：固定大小', async () => {
    files({ 's1-card.xml': '<UI width="300" height="120"><UILabel>卡片</UILabel></UI>' });
    const ui = await create();
    ui.loadString('<UI align="start"><UIComponent id="card" src="s1-card.xml"/></UI>', 'ui/');
    await ui.whenComponentsLoaded();
    ui.layout();
    expect(size(ui.get('card'))).toEqual([300, 120]);
  });

  test('UIComponent 自己寫的寬高會被忽略並提醒', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    files({ 's2-card.xml': '<UI width="300" height="120"><UILabel>卡片</UILabel></UI>' });
    const ui = await create();
    ui.loadString(
      '<UI align="start"><UIComponent id="card" src="s2-card.xml" width="50" md:width="60" height="40" padding="4"/></UI>',
      'ui/',
    );
    await ui.whenComponentsLoaded();
    ui.layout();
    expect(size(ui.get('card'))).toEqual([300, 120]);
    expect(ui.get('card')!.attrs.padding).toBe('4'); // 其他屬性照常使用
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('width、md:width、height'));
    warn.mockRestore();
  });

  test('外部 <UI> 沒寫寬高：依內容決定大小', async () => {
    files({ 's3-badge.xml': '<UI dir="h"><UILayout width="72" height="20"/></UI>' });
    const ui = await create();
    ui.loadString('<UI align="start"><UIComponent id="badge" src="s3-badge.xml"/></UI>', 'ui/');
    await ui.whenComponentsLoaded();
    ui.layout();
    expect(size(ui.get('badge'))).toEqual([72, 20]);
  });

  test('外部 <UI width="auto" height="300">：寬度填滿放置的位置、高度固定', async () => {
    files({ 's4-bar.xml': '<UI width="auto" height="300"><UILabel>橫幅</UILabel></UI>' });
    const ui = await create();
    ui.loadString('<UI align="start" padding="10"><UIComponent id="bar" src="s4-bar.xml"/></UI>', 'ui/');
    await ui.whenComponentsLoaded();
    ui.layout();
    expect(size(ui.get('bar'))).toEqual([780, 300]);
  });
});

describe('<UIComponent> 嵌入 <UI height="fit">', () => {
  test('寬固定、高依內容；不會被水平排列拉高', async () => {
    files({ 'f1-badge.xml': '<UI width="100" height="fit" dir="h"><UILayout width="24" height="24"/></UI>' });
    const ui = await create();
    ui.loadString(
      '<UI dir="h"><UIComponent id="badge" src="f1-badge.xml"/><UILayout width="50" height="200"/></UI>',
      'ui/',
    );
    await ui.whenComponentsLoaded();
    ui.layout();
    const r = ui.get('badge')!.layout;
    expect([Math.round(r.width), Math.round(r.height)]).toEqual([100, 24]);
  });
});
