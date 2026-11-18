import { describe, expect, test } from 'vitest';
import { UI2D, UICheckIndicator, UIImage, UILabel, UISelect, UISlider, measure, type UIElement } from '../src/ui2d';
import { PALETTE } from '../src/editors/ui-editor/model';
import { COMPONENT_DEMOS } from '../src/editors/ui-editor/componentDemos';

/** 會在畫面上畫出東西的元件（有大小，而且有背景、邊框、文字、圖片或自訂繪製） */
function paints(el: UIElement): boolean {
  if (!el.visible || el.layout.width <= 0 || el.layout.height <= 0) return false;
  const a = el.attrs;
  const color = (c?: string) => !!c && c !== 'transparent' && c !== 'none';
  return (
    color(a.background) ||
    !!a.bgImage ||
    !!a.border ||
    (el instanceof UILabel && el.text.trim() !== '') ||
    el instanceof UIImage ||
    el instanceof UISlider ||
    el instanceof UICheckIndicator ||
    el instanceof UISelect ||
    typeof el.paintContent === 'function'
  );
}

describe('元件庫：每個元件的預覽都看得到東西', () => {
  for (const item of PALETTE) {
    test(`${item.label}（${item.tag}）`, async () => {
      const demo = COMPONENT_DEMOS[item.label] ?? {};
      const ui = await UI2D.create({
        container: null,
        width: 590,
        height: 300,
        measure: measure.fixed(0.5),
        autoTick: false,
        loadImage: async () => ({ width: 48, height: 48 }),
        unknownTags: 'placeholder',
      });
      ui.loadString(
        `<UI padding="28" align="${demo.wide ? 'stretch' : 'center'}" justify="center" gap="12">${demo.xml ?? item.xml}</UI>`,
        'ui/',
      );
      // 示範腳本（提示訊息等）也跑一次
      const stop = demo.run?.(ui, () => {});
      await new Promise((r) => setTimeout(r, 0)); // 等圖片載入（取得原始尺寸）
      ui.layout();
      let count = 0;
      ui.root!.walk((el) => {
        if (el !== ui.root && paints(el)) count++;
      });
      stop?.();
      ui.destroy();
      expect(count, `預覽「${item.label}」沒有任何看得到的內容`).toBeGreaterThan(0);
    });
  }
});
