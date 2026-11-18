import { describe, expect, test } from 'vitest';
import { UI2D, UIPainter, type UISlider, measure, type Context2D, type UIEvent } from '../src/ui2d';

async function makeUI(handlers: Record<string, (e: UIEvent) => void> = {}) {
  return UI2D.create({ container: null, width: 400, height: 300, measure: measure.fixed(0.5), handlers });
}

/** 滑桿上某個比例位置的座標 */
function at(slider: UISlider, ratio: number) {
  const t = slider.trackRange();
  return { x: t.x0 + (t.x1 - t.x0) * ratio, y: t.y0 + (t.y1 - t.y0) * ratio };
}

describe('UISlider 數值', () => {
  test('預設值、限制範圍、對齊 step、小數位數', async () => {
    const ui = await makeUI();
    ui.loadString(`
      <UILayout align="start">
        <UISlider id="a"/>
        <UISlider id="b" min="0" max="1" step="0.1" value="0.33"/>
        <UISlider id="c" min="-10" max="10" step="5" value="99"/>
      </UILayout>`);
    const a = ui.require<UISlider>('a');
    expect([a.value, a.min, a.max, a.layout.width, a.layout.height]).toEqual([0, 0, 100, 160, 24]);
    const b = ui.require<UISlider>('b');
    expect([b.value, b.decimals]).toEqual([0.3, 1]);
    b.value = 0.1 + 0.2; // 浮點誤差會被去掉
    expect(b.value).toBe(0.3);
    expect(ui.require<UISlider>('c').value).toBe(10);
    ui.require<UISlider>('c').value = -7;
    expect(ui.require<UISlider>('c').value).toBe(-5);
  });

  test('前後綴的顯示文字', async () => {
    const ui = await makeUI();
    ui.loadString(
      `<UILayout><UISlider id="s" min="0" max="2" step="0.25" value="1.5" suffix="x" prefix="×"/></UILayout>`,
    );
    expect(ui.require<UISlider>('s').displayValue).toBe('×1.50x');
  });
});

describe('UISlider 操作', () => {
  test('點軌道直接跳到該位置；拖曳時觸發 input，放開時觸發一次 change', async () => {
    const events: string[] = [];
    const ui = await makeUI({
      input: (e) => events.push(`input ${e.value}`),
      change: (e) => events.push(`change ${e.value}`),
    });
    ui.loadString(
      `<UILayout align="start"><UISlider id="s" step="10" value="0" onInput="input" onChange="change"/></UILayout>`,
    );
    const s = ui.require<UISlider>('s');
    let p = at(s, 0.5);
    expect(ui.handlePointer('down', p.x, p.y)).toBe(true);
    expect(s.value).toBe(50);
    p = at(s, 0.71);
    ui.handlePointer('move', p.x, p.y);
    ui.handlePointer('move', p.x + 0.5, p.y); // 對齊 step 後數值沒變：不觸發
    p = at(s, 2); // 拖出範圍：限制在最大值
    ui.handlePointer('move', p.x, p.y);
    ui.handlePointer('up', p.x, p.y);
    expect(s.value).toBe(100);
    expect(events).toEqual(['input 50', 'input 70', 'input 100', 'change 100']);
    expect(ui.cursor).not.toBe('grabbing');
  });

  test('數值沒變時放開不觸發 change；停用時不能操作', async () => {
    const events: string[] = [];
    const ui = await makeUI({ change: () => events.push('change') });
    ui.loadString(`<UILayout align="start"><UISlider id="s" value="50" onChange="change"/></UILayout>`);
    const s = ui.require<UISlider>('s');
    const p = at(s, 0.5);
    ui.handlePointer('down', p.x, p.y);
    ui.handlePointer('up', p.x, p.y);
    expect(events).toEqual([]);
    s.disabled = true;
    ui.layout();
    const q = at(s, 0.9);
    ui.handlePointer('down', q.x, q.y);
    ui.handlePointer('up', q.x, q.y);
    expect(s.value).toBe(50);
  });

  test('直立式：下方是最小值', async () => {
    const ui = await makeUI();
    ui.loadString(`<UILayout align="start"><UISlider id="s" vertical="true"/></UILayout>`);
    const s = ui.require<UISlider>('s');
    expect([s.layout.width, s.layout.height]).toEqual([24, 160]);
    const r = s.absoluteRect;
    ui.handlePointer('down', r.x + 12, r.y + 5); // 靠上 → 接近最大值
    ui.handlePointer('up', r.x + 12, r.y + 5);
    expect(s.value).toBe(100);
    ui.handlePointer('down', r.x + 12, r.y + r.height - 5);
    ui.handlePointer('up', r.x + 12, r.y + r.height - 5);
    expect(s.value).toBe(0);
  });

  test('orientation 屬性：水平／垂直、自訂長度與粗細、程式切換', async () => {
    const ui = await makeUI();
    ui.loadString(`
      <UILayout align="start">
        <UISlider id="h" orientation="horizontal"/>
        <UISlider id="v" orientation="vertical" length="200" thickness="30"/>
      </UILayout>`);
    const h = ui.require<UISlider>('h');
    const v = ui.require<UISlider>('v');
    expect([h.orientation, h.layout.width, h.layout.height]).toEqual(['horizontal', 160, 24]);
    expect([v.orientation, v.layout.width, v.layout.height]).toEqual(['vertical', 30, 200]);
    // 垂直：軌道從下到上
    const t = v.trackRange();
    expect(t.x0).toBe(t.x1);
    expect(t.y0).toBeGreaterThan(t.y1);
    h.vertical = true;
    ui.layout();
    expect([h.orientation, h.layout.width, h.layout.height]).toEqual(['vertical', 24, 160]);
    h.vertical = false;
    ui.layout();
    expect([h.layout.width, h.layout.height]).toEqual([160, 24]);
  });

  test('依螢幕寬度切換方向（md:orientation）', async () => {
    const ui = await makeUI();
    ui.loadString(
      `<UILayout align="start"><UISlider id="s" orientation="horizontal" md:orientation="vertical"/></UILayout>`,
    );
    const s = ui.require<UISlider>('s');
    ui.resize(500, 300);
    expect([s.vertical, s.layout.width, s.layout.height]).toEqual([false, 160, 24]);
    ui.resize(900, 600);
    expect([s.vertical, s.layout.width, s.layout.height]).toEqual([true, 24, 160]);
  });

  test('垂直滑桿拖曳：往上變大、往下變小，input 事件帶數值', async () => {
    const values: number[] = [];
    const ui = await makeUI({ v: (e) => values.push(e.value as number) });
    ui.loadString(
      `<UILayout align="start"><UISlider id="s" orientation="vertical" min="0" max="10" value="5" onInput="v"/></UILayout>`,
    );
    const s = ui.require<UISlider>('s');
    const r = s.absoluteRect;
    const cx = r.x + r.width / 2;
    const mid = at(s, 0.5);
    ui.handlePointer('down', cx, mid.y);
    ui.handlePointer('move', cx, r.y - 50); // 超過上端
    expect(s.value).toBe(10);
    ui.handlePointer('move', cx, r.y + r.height + 50); // 超過下端
    expect(s.value).toBe(0);
    ui.handlePointer('up', cx, r.y + r.height + 50);
    expect(values).toEqual([10, 0]);
  });

  test('放在列表裡：拖曳滑桿不會捲動列表', async () => {
    const ui = await makeUI();
    ui.loadString(`
      <UILayout align="start">
        <UIList id="list" width="200" height="60" gap="0">
          <UISlider id="s" width="180"/>
          <UILayout height="200"/>
        </UIList>
      </UILayout>`);
    const s = ui.require<UISlider>('s');
    const list = ui.require<UISlider>('list') as unknown as { scrollTop: number };
    const p = at(s, 0.2);
    ui.handlePointer('down', p.x, p.y);
    ui.handlePointer('move', p.x + 60, p.y - 40);
    ui.handlePointer('up', p.x + 60, p.y - 40);
    expect(list.scrollTop).toBe(0);
    expect(s.value).toBeGreaterThan(20);
  });
});

describe('UISlider 繪製', () => {
  test('畫出軌道、填滿部分、圓點；拖曳時顯示數值提示', async () => {
    const ui = await makeUI();
    ui.loadString(
      `<UILayout align="start" padding="40"><UISlider id="s" value="25" showValue="true" suffix="%"/></UILayout>`,
    );
    const s = ui.require<UISlider>('s');
    const ops: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(t, k: string) {
        if (k in t) return t[k];
        if (k === 'measureText') return (txt: string) => ({ width: txt.length * 7 });
        return (...args: unknown[]) => ops.push(k === 'fillText' ? `fillText:${args[0]}` : k);
      },
      set(t, k: string, v) {
        t[k] = v;
        return true;
      },
    }) as unknown as Context2D;
    const painter = new UIPainter(() => undefined);
    painter.paint(ctx, ui.root!, 400, 300, 1, ui.paintState);
    expect(ops.filter((o) => o === 'arc')).toHaveLength(1); // 圓點
    expect(ops.some((o) => o.startsWith('fillText'))).toBe(false); // 沒拖曳不顯示數值
    const p = at(s, 0.25);
    ui.handlePointer('down', p.x, p.y);
    ops.length = 0;
    painter.paint(ctx, ui.root!, 400, 300, 1, ui.paintState);
    expect(ops).toContain('fillText:25%');
    ui.handlePointer('up', p.x, p.y);
  });
});
