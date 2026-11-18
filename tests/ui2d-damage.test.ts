import { describe, expect, test } from 'vitest';
import {
  UI2D,
  UIPainter,
  measure,
  type Context2D,
  type UILabel,
  type UIProgressBar,
  type UIRenderer,
} from '../src/ui2d';
import { mergeDamage } from '../src/ui2d/UI2D';

/** 記錄每次重畫拿到的範圍（null = 整張） */
async function setup() {
  const ui = await UI2D.create({ container: null, width: 800, height: 600, measure: measure.fixed(0.5) });
  const renders: ReturnType<UI2D['consumeDamage']>[] = [];
  const renderer: UIRenderer = { attach() {}, render: () => renders.push(ui.consumeDamage()), dispose() {} };
  ui.setRenderer(renderer);
  ui.loadString(`
    <UI padding="20">
      <UILayout dir="h" justify="between">
        <UILabel id="fps" fontSize="10">FPS 60</UILabel>
        <UIButton id="btn" text="選單"/>
      </UILayout>
      <UILayout id="panel" width="200" height="100" background="#222"/>
    </UI>`);
  await Promise.resolve();
  renders.length = 0;
  return { ui, renders };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('局部重畫：只重畫變動的範圍', () => {
  test('文字改變（大小不變）：只重畫那個文字的範圍', async () => {
    const { ui, renders } = await setup();
    const fps = ui.require<UILabel>('fps');
    fps.setText('FPS 59');
    await flush();
    expect(renders).toHaveLength(1);
    const [r] = renders[0]!;
    const a = fps.absoluteRect;
    expect(r.x).toBeLessThanOrEqual(a.x);
    expect(r.x + r.width).toBeGreaterThanOrEqual(a.x + a.width);
    expect(r.width * r.height).toBeLessThan(800 * 600 * 0.05); // 遠小於整個畫面
  });

  test('元件 invalidate()（例如效能面板）：只重畫它自己', async () => {
    const { ui, renders } = await setup();
    ui.require('panel').invalidate();
    await flush();
    const [r] = renders[0]!;
    const p = ui.require('panel').absoluteRect;
    expect([r.x, r.y, r.width, r.height]).toEqual([p.x - 16, p.y - 16, p.width + 32, p.height + 32]);
  });

  test('滑鼠移入：只重畫按鈕', async () => {
    const { ui, renders } = await setup();
    const b = ui.require('btn').absoluteRect;
    ui.handlePointer('move', b.x + 2, b.y + 2);
    await flush();
    const [r] = renders[0]!;
    expect(r.width).toBeLessThan(b.width + 40);
  });

  test('文字變長、位置移動：舊位置與新位置都要重畫', async () => {
    const { ui, renders } = await setup();
    const fps = ui.require<UILabel>('fps');
    const before = fps.absoluteRect;
    fps.setText('FPS 60　實體 123　粒子 456');
    await flush();
    const after = fps.absoluteRect;
    const [r] = renders[renders.length - 1]!;
    expect(r.x).toBeLessThanOrEqual(Math.min(before.x, after.x));
    expect(r.x + r.width).toBeGreaterThanOrEqual(Math.max(before.x + before.width, after.x + after.width));
  });

  test('需要整張重畫的情況：結構改變、尺寸改變、invalidate() 不帶元件、範圍太大', async () => {
    const { ui, renders } = await setup();
    ui.root!.add(ui.createElement('UILabel', {}, '新的'));
    ui.layout();
    expect(renders.at(-1)).toBeNull();
    ui.resize(640, 480);
    expect(renders.at(-1)).toBeNull();
    ui.invalidate();
    await flush();
    expect(renders.at(-1)).toBeNull();
    // 範圍超過畫面一半
    ui.require('panel').set('width', 700);
    ui.layout();
    expect(renders.at(-1)).toBeNull();
  });

  test('沒有任何變化時不用重畫', async () => {
    const { ui, renders } = await setup();
    ui.require<UILabel>('fps').setText('FPS 60'); // 和原本相同
    ui.layout();
    expect(renders.at(-1) ?? []).toEqual([]);
  });
});

describe('繪圖器的局部重畫', () => {
  test('只清除並裁切到指定範圍', async () => {
    const { ui } = await setup();
    const ops: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(t, k: string) {
        if (k in t) return t[k];
        if (k === 'measureText') return () => ({ width: 10 });
        return (...args: number[]) => ops.push(['clearRect', 'rect'].includes(k) ? `${k} ${args.join(',')}` : k);
      },
      set(t, k: string, v) {
        t[k] = v;
        return true;
      },
    }) as unknown as Context2D;
    new UIPainter(() => undefined).paint(ctx, ui.root!, 800, 600, 1, ui.paintState, {
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
    expect(ops.slice(0, 6)).toEqual([
      'save',
      'setTransform',
      'beginPath',
      'rect 10,20,30,40',
      'clip',
      'clearRect 10,20,30,40',
    ]);
    expect(ops).not.toContain('clearRect 0,0,800,600');
    expect(ops.at(-1)).toBe('restore');
  });
});

describe('重畫範圍分塊（不會因為畫面兩端各有一小塊變動就整張重畫）', () => {
  test('右上與左下各一小塊：分成兩塊局部重畫', async () => {
    const ui = await UI2D.create({ container: null, width: 800, height: 600, measure: measure.fixed(0.5) });
    const renders: ReturnType<UI2D['consumeDamage']>[] = [];
    ui.setRenderer({ attach() {}, render: () => renders.push(ui.consumeDamage()), dispose() {} });
    ui.loadString(`<UI>
      <UILayout id="tr" position="absolute" right="10" top="10" width="120" height="80" background="#222"/>
      <UILayout id="bl" position="absolute" left="10" bottom="10" width="120" height="80" background="#222"/>
    </UI>`);
    await Promise.resolve();
    renders.length = 0;
    ui.invalidate(ui.get('tr'), ui.get('bl'));
    await Promise.resolve();
    const r = renders.at(-1);
    expect(r).not.toBeNull(); // 以前合成一個大框（超過畫面一半）→ 整張重畫
    expect(r!.length).toBe(2);
    const area = r!.reduce((s, x) => s + x.width * x.height, 0);
    expect(area).toBeLessThan(800 * 600 * 0.15);
  });

  test('mergeDamage：重疊或相鄰的合併，遠的分開，最多 6 塊', () => {
    const b = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
    expect(mergeDamage([b(0, 0, 10, 10), b(5, 5, 15, 15)])).toEqual([b(0, 0, 15, 15)]);
    expect(mergeDamage([b(0, 0, 10, 10), b(10, 0, 20, 10)])).toEqual([b(0, 0, 20, 10)]); // 相鄰
    expect(mergeDamage([b(0, 0, 10, 10), b(500, 500, 510, 510)])).toHaveLength(2);
    const many = Array.from({ length: 20 }, (_, i) => b(i * 40, (i % 2) * 300, i * 40 + 10, (i % 2) * 300 + 10));
    const out = mergeDamage(many);
    expect(out.length).toBeLessThanOrEqual(6);
    for (const m of many)
      expect(out.some((o) => o.x0 <= m.x0 && o.y0 <= m.y0 && o.x1 >= m.x1 && o.y1 >= m.y1)).toBe(true); // 每塊都被涵蓋
  });

  test('真的變動超過畫面一半：整張重畫', async () => {
    const ui = await UI2D.create({ container: null, width: 800, height: 600, measure: measure.fixed(0.5) });
    const renders: ReturnType<UI2D['consumeDamage']>[] = [];
    ui.setRenderer({ attach() {}, render: () => renders.push(ui.consumeDamage()), dispose() {} });
    ui.loadString('<UI><UILayout id="big" width="700" height="500" background="#222"/></UI>');
    await Promise.resolve();
    renders.length = 0;
    ui.invalidate(ui.get('big'));
    await Promise.resolve();
    expect(renders.at(-1)).toBeNull();
  });
});

describe('set() 與每幀更新不會造成多餘的重畫', () => {
  test('值沒變：不重畫；顏色、背景：只重畫元件自己；大小：整份重新排版', async () => {
    const { ui, renders } = await setup();
    const panel = ui.require('panel');
    panel.set('background', '#222');
    await flush();
    expect(renders).toHaveLength(0);

    panel.set('background', '#9acd32');
    ui.require('fps').set('color', '#ff0000');
    await flush();
    expect(renders).toHaveLength(1);
    expect(renders[0]).not.toBeNull();
    const area = renders[0]!.reduce((s, r) => s + r.width * r.height, 0);
    expect(area).toBeLessThan(800 * 600 * 0.2);
    expect(panel.get('background')).toBe('#9acd32');

    panel.set('width', '300');
    await flush();
    expect(renders.at(-1)).toBeNull();
    expect(panel.absoluteRect.width).toBe(300);
  });

  test('介面動畫進行中：遊戲每幀改進度條，一幀只重畫一次', async () => {
    const frames: FrameRequestCallback[] = [];
    const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
    const saved = [g.requestAnimationFrame, g.cancelAnimationFrame];
    g.requestAnimationFrame = (cb: FrameRequestCallback) => frames.push(cb);
    g.cancelAnimationFrame = () => {};
    try {
      const ui = await UI2D.create({ container: null, width: 800, height: 600, measure: measure.fixed(0.5) });
      const renders: ReturnType<UI2D['consumeDamage']>[] = [];
      ui.setRenderer({ attach() {}, render: () => renders.push(ui.consumeDamage()), dispose() {} });
      ui.loadString('<UI><UIProgressBar id="bar" value="0"/></UI>');
      await flush();
      const bar = ui.require<UIProgressBar>('bar');
      bar.value = 10; // 開始平滑動畫
      await flush();
      renders.length = 0;
      let t = 0;
      for (let i = 0; i < 5; i++) {
        bar.value = 10 + i * 5; // 遊戲更新（引擎的 requestAnimationFrame）
        await flush();
        const cb = frames.shift();
        expect(cb).toBeDefined();
        t += 16;
        cb!(t); // 介面自己的動畫幀
        await flush();
      }
      const drawn = renders.filter((r) => r === null || r.length > 0);
      expect(drawn.length).toBe(5);
    } finally {
      [g.requestAnimationFrame, g.cancelAnimationFrame] = saved;
    }
  });
});
