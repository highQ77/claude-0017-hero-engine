import { describe, expect, test, vi } from 'vitest';
import { UI2D, UIPainter, measure, type Context2D, type UIElement, type UIRenderer } from '../src/ui2d';

/** 假圖片：只有尺寸 */
const images: Record<string, { width: number; height: number }> = {
  'ui/frame.png': { width: 48, height: 48 },
  'ui/wide.png': { width: 400, height: 200 },
  'ui/hover.png': { width: 48, height: 48 },
};

async function setup(xml: string) {
  const loadImage = vi.fn(async (url: string) => images[url] ?? { width: 10, height: 10 });
  const ui = await UI2D.create({
    container: null,
    width: 800,
    height: 600,
    measure: measure.fixed(0.5),
    loadImage,
    autoTick: false,
  });
  let renders = 0;
  const renderer: UIRenderer = { attach() {}, render: () => void renders++, dispose() {} };
  ui.setRenderer(renderer);
  ui.loadString(xml, 'ui/');
  return { ui, loadImage, renders: () => renders };
}

/** 記錄 drawImage 的目的範圍（後 4 個參數） */
function recorder() {
  const draws: number[][] = [];
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'drawImage')
        return (_img: unknown, ...args: number[]) => draws.push(args.slice(-4).map((n) => Math.round(n * 100) / 100));
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createPattern') return () => ({ pattern: true });
      return () => calls.push(k);
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as Context2D;
  return { ctx, draws, calls };
}

const painter = new UIPainter((url) => images[url] as unknown as CanvasImageSource);
const paint = (ui: UI2D, ctx: Context2D, hover: UIElement | null = null) =>
  painter.paint(ctx, ui.root!, 800, 600, 1, { ...ui.paintState, hover });

describe('背景圖片 bgImage', () => {
  test('載入背景圖片（含各種狀態），載入完成後重畫', async () => {
    const { ui, loadImage, renders } = await setup(
      '<UI><UILayout id="p" width="100" height="50" bgImage="frame.png" hoverBgImage="hover.png"/></UI>',
    );
    expect(loadImage.mock.calls.map((c) => c[0]).sort()).toEqual(['ui/frame.png', 'ui/hover.png']);
    const before = renders();
    await new Promise((r) => setTimeout(r, 0));
    expect(renders()).toBeGreaterThan(before);
    // 只有背景圖片、沒有背景色的元件也會擋住點擊（不會穿透到遊戲）
    expect(ui.hitTest(50, 25)?.id).toBe('p');
  });

  test('cover（預設）填滿並置中裁切、contain 完整放進來、fill 拉伸、bgPosition 對齊', async () => {
    const { ui } = await setup(`
      <UI align="start">
        <UILayout width="100" height="100" bgImage="wide.png"/>
        <UILayout width="100" height="100" bgImage="wide.png" bgFit="contain" bgPosition="top"/>
        <UILayout width="100" height="100" bgImage="wide.png" bgFit="fill"/>
      </UI>`);
    const { ctx, draws } = recorder();
    paint(ui, ctx);
    expect(draws[0]).toEqual([-50, 0, 200, 100]); // 400×200 放大到高 100，水平置中
    expect(draws[1]).toEqual([0, 100, 100, 50]); // 縮小到寬 100，貼上方
    expect(draws[2]).toEqual([0, 200, 100, 100]);
  });

  test('九宮格：九塊，四角原尺寸、中間延伸；元件太小時邊框等比縮小', async () => {
    const { ui } = await setup(`
      <UI align="start">
        <UILayout width="200" height="80" bgImage="frame.png" bgSlice="16"/>
        <UILayout width="20" height="20" bgImage="frame.png" bgSlice="16"/>
      </UI>`);
    const { ctx, draws } = recorder();
    paint(ui, ctx);
    expect(draws.slice(0, 9)).toEqual([
      [0, 0, 16, 16],
      [16, 0, 168, 16],
      [184, 0, 16, 16],
      [0, 16, 16, 48],
      [16, 16, 168, 48],
      [184, 16, 16, 48],
      [0, 64, 16, 16],
      [16, 64, 168, 16],
      [184, 64, 16, 16],
    ]);
    // 20×20：邊框 16+16 放不下 → 縮成 10+10，中間為 0（不畫）
    const small = draws.slice(9);
    expect(small).toHaveLength(4);
    expect(small[0]).toEqual([0, 80, 10, 10]);
  });

  test('tile 重複、滑鼠移入時換成 hoverBgImage、bgOpacity', async () => {
    const { ui } = await setup(`
      <UI align="start">
        <UILayout width="100" height="40" bgImage="frame.png" bgFit="tile"/>
        <UIButton id="b" text="按鈕" bgImage="frame.png" hoverBgImage="hover.png" bgFit="fill" bgOpacity="0.5"/>
      </UI>`);
    const used: string[] = [];
    const p = new UIPainter((url) => {
      used.push(url);
      return images[url] as unknown as CanvasImageSource;
    });
    const { ctx, calls } = recorder();
    p.paint(ctx, ui.root!, 800, 600, 1, ui.paintState);
    expect(calls).toContain('fillRect'); // 用圖樣填滿
    expect(used).toEqual(['ui/frame.png', 'ui/frame.png']);
    used.length = 0;
    p.paint(ctx, ui.root!, 800, 600, 1, { ...ui.paintState, hover: ui.require('b') });
    expect(used).toEqual(['ui/frame.png', 'ui/hover.png']);
  });

  test('外觀（skin）也能設定背景圖片', async () => {
    const { ui, loadImage } = await setup(
      '<UI><UISkin for="UIButton" bgImage="frame.png" bgSlice="16"/><UIButton id="b" text="A"/></UI>',
    );
    expect(ui.require('b').attrs.bgImage).toBe('frame.png');
    expect(loadImage).toHaveBeenCalledWith('ui/frame.png');
  });
});
