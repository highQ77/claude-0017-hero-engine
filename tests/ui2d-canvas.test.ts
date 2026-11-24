import { describe, expect, test } from 'vitest';
import { UI2D, UICanvas, measure } from '../src/ui2d';

async function makeUI(xml: string, width = 800, height = 600) {
  const ui = await UI2D.create({ container: null, width, height, measure: measure.fixed(0.5), autoTick: false });
  ui.loadString(xml);
  return ui;
}

describe('UICanvas 畫布', () => {
  test('已註冊成元件，可以用 id 取得', async () => {
    expect(UI2D.components.get('UICanvas')).toBe(UICanvas);
    const ui = await makeUI('<UI><UICanvas id="c" width="320" height="200"/></UI>');
    const c = ui.require<UICanvas>('c');
    expect(c).toBeInstanceOf(UICanvas);
    expect([c.layout.width, c.layout.height]).toEqual([320, 200]);
    expect([c.width, c.height]).toEqual([320, 200]);
  });

  test('預設大小 300×150、背景 #333333FF', async () => {
    const ui = await makeUI('<UI><UICanvas id="c"/></UI>');
    const c = ui.require<UICanvas>('c');
    expect(c.get('background')).toBe('#333333FF');
    expect([c.layout.width, c.layout.height]).toEqual([300, 150]);
    expect(c.hasContext).toBe(false);
  });

  test('背景色可以覆寫', async () => {
    const ui = await makeUI('<UI><UICanvas id="c" background="#00000000"/></UI>');
    expect(ui.require<UICanvas>('c').get('background')).toBe('#00000000');
  });

  test('改變大小', async () => {
    const ui = await makeUI('<UI><UICanvas id="c" width="100" height="50"/></UI>');
    const c = ui.require<UICanvas>('c');
    c.resize(64, 32);
    ui.layout();
    expect([c.width, c.height]).toEqual([64, 32]);
    expect([c.layout.width, c.layout.height]).toEqual([64, 32]);
  });

  test('提供 WebGL2D 的 Path2D', () => {
    expect(typeof UICanvas.Path2D).toBe('function');
    expect(UICanvas.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('沒有 document 的環境（伺服器、測試）呼叫 getContext 會丟出清楚的錯誤', async () => {
    const ui = await makeUI('<UI><UICanvas id="c"/></UI>');
    expect(() => ui.require<UICanvas>('c').getContext()).toThrow(/UICanvas/);
  });

  test('滑鼠拖曳：pointerdown、pointermove、pointerup，座標換算成繪圖座標', async () => {
    // 畫布在 (10, 10)：介面座標減去畫布左上角，就是繪圖座標
    const ui = await makeUI('<UI padding="10"><UICanvas id="c" width="200" height="100"/></UI>');
    const c = ui.require<UICanvas>('c');
    const events: string[] = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup'])
      c.on(type, (e) => {
        const p = e.value as { x: number; y: number };
        events.push(`${type} ${p.x},${p.y}`);
      });
    ui.handlePointer('down', 10 + 50, 10 + 20);
    ui.handlePointer('move', 10 + 60, 10 + 30);
    ui.handlePointer('up', 10 + 70, 10 + 40);
    expect(events).toEqual(['pointerdown 50,20', 'pointermove 60,30', 'pointerup 70,40']);
  });

  test('懸停：沒按住的移動觸發 pointerhover，移開、離開畫面觸發 pointerleave；拖曳中不觸發 pointerhover', async () => {
    const ui = await makeUI(
      '<UI padding="10" gap="10"><UICanvas id="c" width="200" height="100"/><UIButton id="b" text="x"/></UI>',
    );
    const c = ui.require<UICanvas>('c');
    const events: string[] = [];
    c.on('pointerhover', (e) => {
      const p = e.value as { x: number; y: number };
      events.push(`hover ${Math.round(p.x)},${Math.round(p.y)}`);
    });
    c.on('pointerleave', () => events.push('leave'));
    c.on('pointermove', () => events.push('drag'));
    ui.handlePointer('move', 10 + 5, 10 + 6);
    ui.handlePointer('move', 10 + 7, 10 + 8);
    ui.handlePointer('move', 400, 400); // 移到畫布外（空白處）
    expect(events).toEqual(['hover 5,6', 'hover 7,8', 'leave']);
    events.length = 0;
    ui.handlePointer('move', 10 + 20, 10 + 20);
    ui.handlePointer('leave', 0, 0); // 滑鼠離開整個畫面
    expect(events).toEqual(['hover 20,20', 'leave']);
    events.length = 0;
    ui.handlePointer('down', 10 + 30, 10 + 30);
    ui.handlePointer('move', 10 + 40, 10 + 40); // 拖曳中：pointermove，不是 pointerhover
    ui.handlePointer('up', 10 + 40, 10 + 40);
    ui.handlePointer('move', 10 + 41, 10 + 41); // 放開後繼續懸停
    expect(events).toEqual(['drag', 'hover 41,41']);
  });

  test('滾輪：有人收聽 wheel 才攔截（不捲動外層列表），event.value 有繪圖座標與捲動量', async () => {
    const ui = await makeUI(
      '<UI><UIScrollView id="list" height="120"><UICanvas id="c" width="200" height="100"/><UILayout height="400"/></UIScrollView></UI>',
    );
    const c = ui.require<UICanvas>('c');
    const list = ui.require('list') as unknown as { scrollTop: number };
    // 沒人收聽：照常捲動列表
    expect(ui.handleWheel(0, 30, 50, 50)).toBe(true);
    expect(list.scrollTop).toBe(30);
    // 有人收聽：畫布用掉，列表不動
    const got: unknown[] = [];
    c.on('wheel', (e) => got.push(e.value));
    ui.handleWheel(0, 30, 50, 50);
    expect(list.scrollTop).toBe(30);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ dx: 0, dy: 30 });
  });

  test('pointerEvents="none" 時滑鼠穿透', async () => {
    const ui = await makeUI('<UI><UICanvas id="c" pointerEvents="none"/></UI>');
    const c = ui.require<UICanvas>('c');
    let n = 0;
    c.on('pointerdown', () => n++);
    ui.handlePointer('down', 20, 20);
    expect(n).toBe(0);
  });
});
