import { describe, expect, test } from 'vitest';
import {
  UI2D,
  type UICheckBox,
  UIPainter,
  type UIRadioButton,
  type UISelect,
  measure,
  type Context2D,
  type UIEvent,
} from '../src/ui2d';

async function makeUI(width = 400, height = 300, handlers: Record<string, (e: UIEvent) => void> = {}) {
  return UI2D.create({ container: null, width, height, measure: measure.fixed(0.5), handlers });
}

/** 點擊某個元件的中心（經過引擎的點中判斷） */
function click(ui: UI2D, id: string) {
  const r = ui.require(id).absoluteRect;
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  ui.handlePointer('down', x, y);
  ui.handlePointer('up', x, y);
}

function clickAt(ui: UI2D, x: number, y: number) {
  const a = ui.handlePointer('down', x, y);
  const b = ui.handlePointer('up', x, y);
  return a || b;
}

describe('UICheckBox', () => {
  test('排版：方塊大小、文字在後面；點擊切換並觸發 change', async () => {
    const changes: unknown[] = [];
    const ui = await makeUI(400, 300, { setMusic: (e) => changes.push([e.checked, e.value]) });
    ui.loadString(
      `<UILayout align="start"><UICheckBox id="cb" text="音樂" boxSize="18" gap="6" fontSize="10" onChange="setMusic"/></UILayout>`,
    );
    const cb = ui.require<UICheckBox>('cb');
    expect(cb.checked).toBe(false);
    expect(cb.indicator.layout.width).toBe(18);
    expect(cb.label!.layout.x).toBe(24); // 18 + 6
    click(ui, 'cb');
    expect(cb.checked).toBe(true);
    // 點在文字上也算
    const lr = cb.label!.absoluteRect;
    clickAt(ui, lr.x + 2, lr.y + 2);
    expect(cb.checked).toBe(false);
    expect(changes).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  test('程式設定 checked 不會觸發 change；停用時點擊無效', async () => {
    let changes = 0;
    const ui = await makeUI(400, 300, { c: () => changes++ });
    ui.loadString(`<UILayout align="start"><UICheckBox id="cb" checked="true" onChange="c" text="x"/></UILayout>`);
    const cb = ui.require<UICheckBox>('cb');
    expect(cb.checked).toBe(true);
    cb.checked = false;
    expect(cb.checked).toBe(false);
    cb.disabled = true;
    ui.layout();
    click(ui, 'cb');
    expect(cb.checked).toBe(false);
    expect(changes).toBe(0);
  });
});

describe('UIRadioButton', () => {
  const xml = `
    <UILayout dir="h" align="start" gap="10">
      <UIRadioButton id="h" group="q" value="high" text="高" onChange="q"/>
      <UIRadioButton id="m" group="q" value="mid" text="中" checked="true" onChange="q"/>
      <UIRadioButton id="l" group="q" value="low" text="低" onChange="q"/>
      <UIRadioButton id="other" group="x" value="1" text="別組" checked="true"/>
    </UILayout>`;

  test('同一組只能選一個；change 帶 value；別組不受影響', async () => {
    const values: unknown[] = [];
    const ui = await makeUI(400, 300, { q: (e) => values.push(e.value) });
    ui.loadString(xml);
    expect(ui.getRadioValue('q')).toBe('mid');
    click(ui, 'h');
    expect(ui.getRadioValue('q')).toBe('high');
    expect([ui.require<UIRadioButton>('m').checked, ui.require<UIRadioButton>('other').checked]).toEqual([false, true]);
    click(ui, 'h'); // 已選取：再點不會取消、不觸發
    expect(ui.require<UIRadioButton>('h').checked).toBe(true);
    expect(values).toEqual(['high']);
  });

  test('setRadioValue：程式選取（不觸發 change）', async () => {
    const values: unknown[] = [];
    const ui = await makeUI(400, 300, { q: (e) => values.push(e.value) });
    ui.loadString(xml);
    ui.setRadioValue('q', 'low');
    expect(ui.getRadioValue('q')).toBe('low');
    expect(values).toEqual([]);
  });
});

describe('UISelect', () => {
  const xml = `
    <UILayout padding="10" align="start">
      <UISelect id="s" value="b" onChange="pick" fontSize="10" width="120" maxItems="3">
        <UIOption value="a">甲</UIOption>
        <UIOption value="b">乙</UIOption>
        <UIOption value="c">丙</UIOption>
        <UIOption value="d">丁</UIOption>
        <UIOption>戊</UIOption>
      </UISelect>
      <UIButton id="under" text="下面的按鈕" onClick="under"/>
    </UILayout>`;

  test('讀取 UIOption；顯示選取的文字；沒有 value 時用文字當值', async () => {
    const ui = await makeUI();
    ui.loadString(xml);
    const s = ui.require<UISelect>('s');
    expect(s.options.map((o) => o.value)).toEqual(['a', 'b', 'c', 'd', '戊']);
    expect(s.label.text).toBe('乙');
    s.value = 'd';
    expect(s.label.text).toBe('丁');
  });

  test('點擊展開、滑鼠移入、點選項選取並收起、觸發 change', async () => {
    const values: unknown[] = [];
    const ui = await makeUI(400, 300, { pick: (e) => values.push(e.value) });
    ui.loadString(xml);
    const s = ui.require<UISelect>('s');
    click(ui, 's');
    expect(ui.activeSelect).toBe(s);
    const p = s.popupLayout(300);
    expect(p.up).toBe(false);
    expect(p.visible).toBe(3);
    // 第一個選項（甲）
    const ix = p.x + 20;
    const iy = p.y + p.padding + p.itemHeight / 2;
    ui.handlePointer('move', ix, iy);
    expect(s.hoverIndex).toBe(0);
    expect(clickAt(ui, ix, iy)).toBe(true);
    expect(ui.activeSelect).toBeNull();
    expect(s.value).toBe('a');
    expect(values).toEqual(['a']);
  });

  test('展開時點外面：收起，且不會點到下面的按鈕；點下拉選單本身也會收起', async () => {
    const clicked: string[] = [];
    const ui = await makeUI(400, 300, { under: () => clicked.push('under') });
    ui.loadString(xml);
    click(ui, 's');
    const p = ui.require<UISelect>('s').popupLayout(300);
    // 選單蓋住了下面的按鈕：點在選單裡的空白處（選項範圍外）
    const btn = ui.require('under').absoluteRect;
    expect(clickAt(ui, btn.x + btn.width - 2, btn.y + btn.height - 2)).toBe(true);
    expect(ui.activeSelect).toBeNull();
    expect(clicked).toEqual([]);
    click(ui, 's');
    click(ui, 's');
    expect(ui.activeSelect).toBeNull();
    expect(p.height).toBeGreaterThan(0);
  });

  test('滾輪捲動選項；下方空間不夠時往上展開', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(xml);
    const s = ui.require<UISelect>('s');
    click(ui, 's');
    const p = s.popupLayout(300);
    ui.handleWheel(0, 1000, p.x + 10, p.y + 10);
    expect(s.popupScroll).toBe((5 - 3) * p.itemHeight);

    const low = await makeUI(400, 300);
    low.loadString(
      `<UILayout padding="10" justify="end" height="100%"><UISelect id="s" maxItems="4"><UIOption>1</UIOption><UIOption>2</UIOption><UIOption>3</UIOption><UIOption>4</UIOption></UISelect></UILayout>`,
    );
    const ls = low.require<UISelect>('s');
    const lp = ls.popupLayout(300);
    expect(lp.up).toBe(true);
    expect(lp.y + lp.height).toBeLessThanOrEqual(ls.absoluteRect.y);
  });

  test('setOptions 由程式設定選項；停用時不能展開', async () => {
    const ui = await makeUI();
    ui.loadString(`<UILayout align="start"><UISelect id="s" placeholder="請選擇"/></UILayout>`);
    const s = ui.require<UISelect>('s');
    expect(s.label.text).toBe('請選擇');
    s.setOptions([{ value: 'x', label: '選項 X' }]);
    ui.layout();
    expect(s.label.text).toBe('選項 X');
    s.disabled = true;
    ui.layout();
    click(ui, 's');
    expect(ui.activeSelect).toBeNull();
  });

  test('UISelect 裡放其他元件會報錯', async () => {
    const ui = await makeUI();
    expect(() => ui.loadString('<UILayout><UISelect><UILabel/></UISelect></UILayout>')).toThrow(/只能放 <UIOption>/);
    expect(() => ui.loadString('<UILayout><UICheckBox><UILabel/></UICheckBox></UILayout>')).toThrow(/只能放文字/);
  });
});

describe('繪製', () => {
  test('勾選框畫勾勾、單選按鈕畫圓點、下拉選單畫箭頭與展開的選項', async () => {
    const ui = await makeUI();
    ui.loadString(`
      <UILayout align="start" gap="8">
        <UICheckBox id="cb" checked="true" text="a"/>
        <UIRadioButton group="g" checked="true" text="b"/>
        <UISelect id="s"><UIOption>一</UIOption><UIOption>二</UIOption></UISelect>
      </UILayout>`);
    click(ui, 's');
    const ops: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(t, k: string) {
        if (k in t) return t[k];
        if (k === 'measureText') return (s: string) => ({ width: s.length * 8 });
        return (...args: unknown[]) => ops.push(`${k}${k === 'fillText' ? `:${args[0]}` : ''}`);
      },
      set(t, k: string, v) {
        t[k] = v;
        return true;
      },
    }) as unknown as Context2D;
    new UIPainter(() => undefined).paint(ctx, ui.root!, 400, 300, 1, ui.paintState);
    expect(ops.filter((o) => o === 'arc').length).toBeGreaterThanOrEqual(2); // 單選的圓圈與圓點
    expect(ops.filter((o) => o === 'lineTo').length).toBeGreaterThanOrEqual(2); // 勾勾、箭頭
    // 選項畫在最後（最上層）
    const texts = ops.filter((o) => o.startsWith('fillText'));
    expect(texts.slice(-2)).toEqual(['fillText:一', 'fillText:二']);
  });
});
