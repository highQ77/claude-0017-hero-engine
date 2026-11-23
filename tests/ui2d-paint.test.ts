import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin } from '../src/scene';
import { RenderPlugin } from '../src/render';
import {
  UI2D,
  type UIButton,
  type UIList,
  UIPainter,
  measure,
  parse,
  type Context2D,
  type UIRenderer,
} from '../src/ui2d';
import { fakeScheduler } from './helpers';

/** 記錄繪圖指令的假 2D 畫布 */
function recordingContext() {
  const ops: string[] = [];
  const state = { fillStyle: '', strokeStyle: '', font: '', globalAlpha: 1, lineWidth: 1 };
  const stack: (typeof state)[] = [];
  const ctx = new Proxy(state as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'save')
        return () => {
          stack.push({ ...state });
          ops.push('save');
        };
      if (key === 'restore')
        return () => {
          Object.assign(state, stack.pop());
          ops.push('restore');
        };
      if (key === 'fill')
        return () => ops.push(`fill ${state.fillStyle} α${Math.round(state.globalAlpha * 100) / 100}`);
      if (key === 'stroke') return () => ops.push(`stroke ${state.strokeStyle} ${state.lineWidth}`);
      if (key === 'fillText')
        return (t: string, x: number, y: number) =>
          ops.push(`text「${t}」@${Math.round(x)},${Math.round(y)} ${state.fillStyle}`);
      if (key === 'measureText') return (t: string) => ({ width: [...t].length * 8 });
      if (key === 'drawImage')
        return (_i: unknown, x: number, y: number, w: number, h: number) => ops.push(`image ${x},${y},${w},${h}`);
      if (key === 'clip') return () => ops.push('clip');
      if (key === 'rect') return (x: number, y: number, w: number, h: number) => ops.push(`rect ${x},${y},${w},${h}`);
      return () => {};
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as Context2D, ops };
}

async function makeUI(width = 400, height = 300, handlers = {}) {
  return UI2D.create({
    container: null,
    width,
    height,
    measure: measure.fixed(0.5),
    loadImage: async () => ({ width: 100, height: 50 }),
    handlers,
  });
}

function paint(ui: UI2D) {
  const { ctx, ops } = recordingContext();
  const painter = new UIPainter(() => ({}) as CanvasImageSource);
  painter.paint(ctx, ui.root!, ui.size.width, ui.size.height, 1, ui.paintState);
  return ops;
}

describe('UIPainter：引擎內繪製', () => {
  test('局部重畫：完全在範圍外的元件不畫（含陰影的元件留餘裕）；捲動區整個在外時裡面也不走', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(`
      <UILayout dir="v" gap="10" padding="10">
        <UILabel id="a" width="100" height="20">上面</UILabel>
        <UILabel id="b" width="100" height="20" background="#222" shadow="0 4 12 #000">有陰影</UILabel>
        <UIScrollView height="40"><UILabel>捲動區裡</UILabel></UIScrollView>
        <UILabel id="c" width="100" height="20">下面</UILabel>
      </UILayout>`);
    const { ctx, ops } = recordingContext();
    const painter = new UIPainter(() => ({}) as CanvasImageSource);
    const c = ui.require('c').absoluteRect;
    painter.paint(ctx, ui.root!, 400, 300, 1, ui.paintState, { x: c.x, y: c.y, width: c.width, height: c.height });
    const texts = ops.filter((o) => o.startsWith('text')).map((o) => o.slice(5, o.indexOf('」')));
    expect(texts).toEqual(['下面']);
    // 陰影延伸到下方：範圍只碰到陰影時也要畫
    const b = ui.require('b').absoluteRect;
    const { ctx: ctx2, ops: ops2 } = recordingContext();
    painter.paint(ctx2, ui.root!, 400, 300, 1, ui.paintState, { x: b.x, y: b.y + b.height + 6, width: 50, height: 4 });
    expect(ops2.some((o) => o.includes('有陰影'))).toBe(true);
  });

  test('背景、邊框、文字依排版位置畫出；隱藏的不畫', async () => {
    const ui = await makeUI();
    ui.loadString(`
      <UILayout padding="10">
        <UILayout background="#123456" border="2 #ff0000" radius="8" padding="4" align="start">
          <UILabel fontSize="10" color="#00ff00" lineHeight="2">hi</UILabel>
        </UILayout>
        <UILabel hidden="true">不會出現</UILabel>
      </UILayout>`);
    const ops = paint(ui);
    expect(ops).toContain('fill #123456 α1');
    expect(ops).toContain('stroke #ff0000 2');
    // 文字：x = 10 + 4，第一行中心 y = 10 + 4 + 20/2
    expect(ops).toContain('text「hi」@14,24 #00ff00');
    expect(ops.some((o) => o.includes('不會出現'))).toBe(false);
  });

  test('文字置中、透明度會乘上去', async () => {
    const ui = await makeUI();
    ui.loadString(
      `<UILayout opacity="0.5"><UILabel width="100" textAlign="center" fontSize="10" background="#fff">ab</UILabel></UILayout>`,
    );
    const ops = paint(ui);
    expect(ops).toContain('fill #fff α0.5');
    // 置中：(100 - 2×8) / 2 = 42
    expect(ops.find((o) => o.startsWith('text'))).toMatch(/@42,/);
  });

  test('按鈕狀態：滑鼠移入、按下、停用', async () => {
    const ui = await makeUI();
    ui.loadString(
      `<UILayout align="start"><UIButton id="b" text="OK" background="#111" hoverBackground="#222" pressedBackground="#333"/></UILayout>`,
    );
    const b = ui.get<UIButton>('b')!;
    const r = b.absoluteRect;
    expect(paint(ui)).toContain('fill #111 α1');
    ui.handlePointer('move', r.x + 5, r.y + 5);
    expect(paint(ui)).toContain('fill #222 α1');
    ui.handlePointer('down', r.x + 5, r.y + 5);
    expect(paint(ui)).toContain('fill #333 α1');
    ui.handlePointer('up', r.x + 5, r.y + 5);
    b.disabled = true;
    ui.layout();
    expect(paint(ui)).toContain('fill #111 α0.5');
  });

  test('圖片 contain 置中；列表裁切並套用捲動位置、畫出捲軸', async () => {
    const ui = await makeUI();
    ui.loadString(`
      <UILayout align="start">
        <UIImage id="img" src="a.png" width="200" height="200"/>
        <UIList id="list" width="100" height="50" gap="0">
          <UILabel fontSize="10" lineHeight="3">a</UILabel>
          <UILabel fontSize="10" lineHeight="3">b</UILabel>
          <UILabel fontSize="10" lineHeight="3">c</UILabel>
        </UIList>
      </UILayout>`);
    await new Promise((r) => setTimeout(r, 0));
    ui.layout();
    let ops = paint(ui);
    expect(ops).toContain('image 0,50,200,100'); // 100×50 放大成 200×100，垂直置中
    expect(ops).toContain('clip');
    expect(ops).toContain('text「b」@0,245 #ffffff');
    ui.scrollTo(ui.get<UIList>('list')!, 0, 20);
    ops = paint(ui);
    expect(ops).toContain('text「b」@0,225 #ffffff'); // 往上捲 20
    expect(ops.filter((o) => o.startsWith('fill rgba(255,255,255,0.35)'))).toHaveLength(1); // 捲軸
  });

  test('陰影寫法解析', () => {
    expect(parse.shadow('0 4px 12px rgba(0,0,0,0.5)')).toEqual({ x: 0, y: 4, blur: 12, color: 'rgba(0,0,0,0.5)' });
    expect(parse.shadow('2 3')).toEqual({ x: 2, y: 3, blur: 0, color: 'rgba(0,0,0,0.5)' });
    expect(parse.shadow('none')).toBeNull();
  });
});

describe('互動：引擎自己判斷點到哪個元件', () => {
  test('點擊：按下與放開都在同一個按鈕上才算；點到按鈕裡的文字也算按鈕', async () => {
    const clicks: string[] = [];
    const ui = await makeUI(400, 300, { go: () => clicks.push('go') });
    ui.loadString(`<UILayout align="start"><UIButton id="b" onClick="go" text="開始" padding="10"/></UILayout>`);
    const r = ui.get('b')!.absoluteRect;
    const label = ui.get<UIButton>('b')!.label!.absoluteRect;
    expect(ui.handlePointer('down', label.x + 2, label.y + 2)).toBe(true); // 點在文字上
    ui.handlePointer('up', label.x + 2, label.y + 2);
    expect(clicks).toEqual(['go']);
    ui.handlePointer('down', r.x + 2, r.y + 2);
    ui.handlePointer('up', 390, 290); // 放開在按鈕外：不算
    expect(clicks).toEqual(['go']);
  });

  test('透明且沒有互動的地方不攔截（讓遊戲收到）；有背景的面板會攔截', async () => {
    const ui = await makeUI();
    ui.loadString(`
      <UILayout width="100%" height="100%">
        <UILayout id="panel" width="100" height="100" background="rgba(0,0,0,0.5)"/>
      </UILayout>`);
    expect(ui.hitTest(300, 200)).toBeNull();
    expect(ui.handlePointer('down', 300, 200)).toBe(false);
    expect(ui.hitTest(50, 50)?.id).toBe('panel');
    expect(ui.handlePointer('down', 50, 50)).toBe(true);
  });

  test('列表：拖曳捲動（不觸發點擊）、滾輪捲動、限制在內容範圍內、列表外的內容點不到', async () => {
    const clicks: number[] = [];
    const ui = await makeUI(400, 300, { pick: (e: { index?: number }) => clicks.push(e.index!) });
    ui.loadString(`
      <UILayout align="start">
        <UIList id="list" width="200" height="100" gap="0">
          <UITemplate><UIButton onClick="pick" height="40" text="{label}"/></UITemplate>
        </UIList>
      </UILayout>`);
    ui.setItems(
      'list',
      Array.from({ length: 5 }, (_, i) => ({ label: `項目${i}` })),
    );
    ui.layout();
    const list = ui.get<UIList>('list')!;
    expect(list.contentHeight).toBe(200);

    // 拖曳：往上拖 30 → 捲動 30，放開時不算點擊
    ui.handlePointer('down', 50, 50);
    ui.handlePointer('move', 50, 35);
    ui.handlePointer('move', 50, 20);
    ui.handlePointer('up', 50, 20);
    expect(list.scrollTop).toBe(30);
    expect(clicks).toEqual([]);

    // 捲動後點擊：y=20 對應內容 y=50 → 第 2 個（索引 1）
    ui.handlePointer('down', 50, 20);
    ui.handlePointer('up', 50, 20);
    expect(clicks).toEqual([1]);

    // 滾輪，且不超過最大值（200 - 100）
    expect(ui.handleWheel(0, 500, 50, 50)).toBe(true);
    expect(list.scrollTop).toBe(100);
    // 列表下方（被裁掉的內容）點不到
    expect(ui.hitTest(50, 150)).toBeNull();
  });

  test('滑鼠移入時游標變成手指；外觀改變時要求重畫', async () => {
    const ui = await makeUI();
    let renders = 0;
    const renderer: UIRenderer = {
      attach() {},
      render: () => {
        renders++;
      },
      dispose() {},
    };
    ui.setRenderer(renderer);
    ui.loadString(`<UILayout align="start"><UIButton id="b" text="x"/></UILayout>`);
    const r = ui.get('b')!.absoluteRect;
    const before = renders;
    ui.handlePointer('move', r.x + 2, r.y + 2);
    await Promise.resolve();
    expect(ui.cursor).toBe('pointer');
    expect(renders).toBe(before + 1);
    ui.handlePointer('leave', 0, 0);
    expect(ui.cursor).toBe('');
  });
});

describe('RenderPlugin 疊加圖層', () => {
  test('3D 畫面之後才畫疊加圖層（不清除畫面）', () => {
    const clock = fakeScheduler();
    const calls: string[] = [];
    const fake = {
      domElement: { parentElement: null, remove() {} },
      shadowMap: {},
      autoClear: true,
      setPixelRatio() {},
      setSize() {},
      clear() {
        calls.push('clear');
      },
      dispose() {},
      setRenderTarget() {},
      render(scene: THREE.Scene) {
        calls.push(`${scene.name} autoClear=${fake.autoClear}`);
      },
    };
    const render = new RenderPlugin({
      renderer: fake as unknown as import('three/webgpu').WebGPURenderer,
      size: { width: 10, height: 10 },
    });
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    engine.use(new EcsPlugin()).use(new ScenePlugin()).use(render);
    render.scene.name = '3d';
    const ui = new THREE.Scene();
    ui.name = 'ui';
    const off = render.addOverlay(ui, new THREE.OrthographicCamera());
    engine.start();
    clock.frame(16);
    expect(calls).toEqual(['clear', 'ui autoClear=false']); // 沒有攝影機：清除後仍畫介面
    expect(fake.autoClear).toBe(true);
    off();
    calls.length = 0;
    clock.frame(16);
    expect(calls).toEqual(['clear']);
  });
});

describe('文字畫在內距裡面', () => {
  test('有 padding 的 UILabel：換行寬度扣掉內距、文字從內距的位置開始畫', async () => {
    const {
      UI2D: UI,
      UIPainter: Painter,
      measure: { fixed },
    } = await import('../src/ui2d');
    const ui = await UI.create({ container: null, width: 400, height: 300, measure: fixed(0.5) });
    ui.loadString(
      '<UI align="start"><UILabel id="l" width="60" padding="8 12" fontSize="10" background="#333">abcdefghij</UILabel></UI>',
    );
    const l = ui.require('l') as unknown as { metrics: { lines: string[] } };
    // 內容寬 60 - 24 = 36 → 每行最多 7 個字（5px）
    expect(l.metrics.lines).toEqual(['abcdefg', 'hij']);
    const texts: [string, number, number][] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) =>
        k in t
          ? t[k]
          : k === 'fillText'
            ? (s: string, x: number, y: number) => texts.push([s, x, y])
            : k === 'measureText'
              ? () => ({ width: 10 })
              : () => {},
      set: (t, k: string, v) => {
        t[k] = v;
        return true;
      },
    }) as never;
    new Painter(() => undefined).paint(ctx, ui.root!, 400, 300, 1, ui.paintState);
    expect(texts[0][1]).toBe(12); // 左內距
    expect(texts[0][2]).toBeCloseTo(8 + 6.5); // 上內距 + 半行高（10 × 1.3 / 2）
  });
});
