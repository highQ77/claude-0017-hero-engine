import { describe, expect, test, vi } from 'vitest';
import { UI2D, UIScreenManager, measure, type UIElement } from '../src/ui2d';

const files: Record<string, string> = {
  'ui/hud.xml':
    '<UI><UIStyle name="big" fontSize="30"/><UILabel id="score" style="big">0</UILabel><UIButton id="openInv" text="背包" onClick="screen.open:inventory"/></UI>',
  'ui/title.xml': '<UI><UILabel id="title">標題</UILabel></UI>',
  'ui/inventory.xml':
    '<UI><UIWindow id="inv" title="背包" width="300"><UIButton id="invClose" text="關閉" onClick="screen.close"/></UIWindow></UI>',
  'ui/settings.xml':
    '<UI><UISkin for="UIButton" background="#9acd32"/><UIButton id="setBack" text="返回" onClick="screen.back"/></UI>',
};

async function setup() {
  const ui = await UI2D.create({ container: null, width: 800, height: 600, measure: measure.fixed(0.5) });
  const fetchText = vi.fn(async (url: string) => {
    if (!(url in files)) throw new Error(`404 ${url}`);
    return files[url];
  });
  const screens = new UIScreenManager(ui, { fetch: fetchText }).registerAll({
    hud: 'ui/hud.xml',
    title: 'ui/title.xml',
    inventory: { url: 'ui/inventory.xml', modal: true },
    settings: { url: 'ui/settings.xml' },
  });
  return { ui, screens, fetchText };
}

function click(ui: UI2D, el: UIElement) {
  const r = el.absoluteRect;
  ui.handlePointer('down', r.x + r.width / 2, r.y + r.height / 2);
  ui.handlePointer('up', r.x + r.width / 2, r.y + r.height / 2);
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('UIScreenManager（XML 管理器）', () => {
  test('show 切換整個畫面；XML 只讀一次（快取）', async () => {
    const { ui, screens, fetchText } = await setup();
    await screens.show('hud');
    expect(ui.get('score')).toBeDefined();
    expect(screens.current).toBe('hud');
    await screens.show('title');
    expect(ui.get('score')).toBeUndefined();
    expect(ui.get('title')).toBeDefined();
    await screens.show('hud');
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  test('open 疊在上層、modal 擋住下面；close／back；疊加畫面的樣式與外觀生效', async () => {
    const { ui, screens } = await setup();
    const changes: string[] = [];
    screens.onChange((c) => changes.push(`${c.type}:${c.name}`));
    await screens.show('hud');
    await screens.open('inventory');
    await screens.open('settings');
    expect(screens.overlays).toEqual(['inventory', 'settings']);
    expect(ui.layerNames).toEqual(['inventory', 'settings']);
    // modal：圖層有半透明背景 → 點不到下面的 HUD
    ui.layout();
    const hudButton = ui.require('openInv').absoluteRect;
    const hit = ui.hitTest(hudButton.x + hudButton.width - 2, hudButton.y + hudButton.height - 2);
    expect(hit?.id).not.toBe('openInv');
    // 疊加畫面的外觀
    expect(ui.require('setBack').attrs.background).toBe('#9acd32');
    expect(screens.back()).toBe(true);
    expect(screens.overlays).toEqual(['inventory']);
    screens.close('inventory');
    expect(screens.back()).toBe(false);
    expect(ui.layerNames).toEqual([]);
    expect(changes).toEqual(['show:hud', 'open:inventory', 'open:settings', 'close:settings', 'close:inventory']);
  });

  test('XML 裡的內建處理函式：screen.open:名稱、screen.close（關自己那層）、screen.back', async () => {
    const { ui, screens } = await setup();
    await screens.show('hud');
    click(ui, ui.require('openInv'));
    await flush();
    expect(screens.isOpen('inventory')).toBe(true);
    await screens.open('settings');
    await flush();
    ui.layout();
    // 關閉的是按鈕所在的「背包」，不是最上層的設定
    click(ui, ui.require('invClose'));
    // 背包被設定蓋住（設定不是 modal，但按鈕位置可能重疊）：直接觸發
    if (screens.isOpen('inventory')) ui.require('invClose').click();
    expect(screens.overlays).toEqual(['settings']);
    ui.layout();
    click(ui, ui.require('setBack'));
    expect(screens.overlays).toEqual([]);
  });

  test('疊加畫面的 <UISkin>、<UIStyle> 只影響自己那一層', async () => {
    const { ui, screens } = await setup();
    await screens.show('hud');
    await screens.open('settings'); // 有 <UISkin for="UIButton" background="#9acd32">
    await screens.open('inventory');
    expect(ui.require('setBack').attrs.background).toBe('#9acd32');
    expect(ui.require('invClose').attrs.background).not.toBe('#9acd32');
    expect(ui.require('openInv').attrs.background).not.toBe('#9acd32');
    // HUD 自己的樣式在 HUD 有效
    expect(ui.require('score').attrs.fontSize).toBe('30');
  });

  test('切換基本畫面時，疊加中的畫面會保留在上面', async () => {
    const { ui, screens } = await setup();
    await screens.show('hud');
    await screens.open('settings');
    await screens.show('title');
    expect(ui.get('title')).toBeDefined();
    expect(ui.layerNames).toEqual(['settings']);
    expect(ui.get('setBack')).toBeDefined();
  });

  test('沒有註冊的畫面、讀取失敗會報錯', async () => {
    const { screens } = await setup();
    await expect(screens.show('nope')).rejects.toThrow(/沒有註冊/);
    screens.register('broken', { url: 'ui/missing.xml' });
    await expect(screens.show('broken')).rejects.toThrow(/404/);
    await expect(screens.open('settings')).rejects.toThrow(/先用 show/);
  });
});
