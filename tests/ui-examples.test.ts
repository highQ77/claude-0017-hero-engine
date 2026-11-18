/// <reference types="vite/client" />
import { describe, expect, test, vi } from 'vitest';
import { UI2D, UIComponent, measure, uiXml, type XmlNode } from '../src/ui2d';

// 範例專案 projects/official-demo-000-start/public/ui 裡所有的 XML（用 Vite 讀成文字）
const sources = import.meta.glob('../projects/official-demo-000-start/public/ui/*.xml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const text = Object.fromEntries(Object.entries(sources).map(([path, xml]) => [path.split('/').pop()!, xml]));
const files = Object.keys(text).sort();
// 範例檔用 <UIComponent src> 互相內嵌：直接提供檔案內容（不需要網路）
uiXml.register(Object.fromEntries(files.map((f) => [`/ui/${f}`, async () => text[f]])));

/** XML 裡用到的所有標籤與屬性 */
function collect(node: XmlNode, tags: Set<string>, attrs: Set<string>): void {
  tags.add(node.tag);
  for (const k of Object.keys(node.attrs)) attrs.add(k.replace(/^\w+:/, ''));
  for (const c of node.children) collect(c, tags, attrs);
}

describe('UI XML 範例', () => {
  test('有標題、設定、背包、對話、排行榜、手機版等範例', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'title.xml',
        'settings.xml',
        'inventory.xml',
        'dialogue.xml',
        'leaderboard.xml',
        'mobile.xml',
        'scene.xml',
      ]),
    );
  });

  for (const file of files) {
    test(`${file} 可以正確載入`, async () => {
      const ui = await UI2D.create({
        container: null,
        width: 1280,
        height: 720,
        measure: measure.fixed(0.5),
        autoTick: false,
        loadImage: async () => ({ width: 48, height: 48 }),
        unknownTags: 'placeholder',
      });
      // 先讀好 <UIImport>（共用主題）與 <UIComponent> 的檔案；樣式名稱寫錯會出現警告
      await ui.preloadComponents(text[file], 'ui/', `ui/${file}`);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => ui.loadString(text[file], 'ui/', `ui/${file}`)).not.toThrow();
      // <UIComponent src> 內嵌的範例檔都讀得到、沒有錯誤
      await ui.whenComponentsLoaded();
      const broken: string[] = [];
      ui.root!.walk((e) => {
        if (e instanceof UIComponent && e.status !== 'loaded') broken.push(`${e.raw.src}：${e.error ?? e.status}`);
      });
      expect(broken).toEqual([]);
      ui.layout();
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([]);
      warn.mockRestore();
      expect(ui.unknownComponents).toEqual([]);
      ui.destroy();
    });
  }

  test('所有 UI 元件都至少在一個範例裡用到', () => {
    const tags = new Set<string>();
    const attrs = new Set<string>();
    for (const f of files)
      collect(uiXml.parse(text[f], { voidTags: ['UIImage', 'UIStyle', 'UISkin', 'UIColumn', 'UIRow'] }), tags, attrs);
    const components = [...UI2D.components.keys()].filter((t) => t !== 'UIDialog'); // UIDialog 是舊名稱
    const childTags = ['UITemplate', 'UIOption', 'UIChoice', 'UIColumn', 'UIRow', 'UIStyle', 'UISkin'];
    const missing = [...components, ...childTags].filter((t) => !tags.has(t));
    expect(missing, `範例裡沒有用到：${missing.join('、')}`).toEqual([]);
    // 通用功能也要展示到
    for (const a of [
      'bgImage',
      'bgSlice',
      'hoverBgImage',
      'tooltip',
      'select',
      'activeBackground',
      'orientation',
      'shape',
    ]) {
      expect(attrs.has(a), `範例裡沒有用到屬性 ${a}`).toBe(true);
    }
  });
});
