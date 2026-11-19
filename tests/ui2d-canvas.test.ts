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

  test('pointerEvents="none" 時滑鼠穿透', async () => {
    const ui = await makeUI('<UI><UICanvas id="c" pointerEvents="none"/></UI>');
    const c = ui.require<UICanvas>('c');
    let n = 0;
    c.on('pointerdown', () => n++);
    ui.handlePointer('down', 20, 20);
    expect(n).toBe(0);
  });
});
