import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { RenderPlugin, ScreenHole } from '../src/render/RenderPlugin';
import { UI2D, UIWeb, measure } from '../src/ui2d';
import { UIWebLayer } from '../src/ui2d/web2d';

// Node 沒有網頁：最小的假元素、假畫布
class FakeElement {
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  innerHTML = '';
  className = '';
  src = '';
  allow = '';
  removed = false;
  parentElement: FakeElement | null = null;
  constructor(readonly tag: string) {}
  addEventListener(): void {}
  removeEventListener(): void {}
  appendChild(c: FakeElement): FakeElement {
    this.children.push(c);
    c.parentElement = this;
    return c;
  }
  insertBefore(c: FakeElement): FakeElement {
    return this.appendChild(c);
  }
  replaceChildren(): void {
    this.children = [];
    this.innerHTML = '';
  }
  remove(): void {
    this.removed = true;
  }
  scrollTo(): void {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
  }
}
beforeAll(() => {
  vi.stubGlobal('document', { createElement: (tag: string) => new FakeElement(tag) });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('getComputedStyle', () => ({ position: 'static' }));
});
afterAll(() => vi.unstubAllGlobals());

async function setup(xml: string) {
  const ui = await UI2D.create({
    container: null,
    width: 800,
    height: 600,
    measure: measure.fixed(0.5),
    autoTick: false,
  });
  ui.loadString(xml);
  ui.tick(0);
  const canvas = new FakeElement('canvas');
  new FakeElement('body').appendChild(canvas);
  const holes: ScreenHole[][] = [];
  const render = {
    renderer: { domElement: canvas },
    size: { width: 800, height: 600 },
    setScreenHoles: (h: ScreenHole[]) => holes.push(h.map((x) => ({ ...x }))),
  } as unknown as RenderPlugin;
  const layer = new UIWebLayer(ui, render);
  return { ui, canvas, layer, holes };
}

describe('2D 介面的網頁元件（UIWeb）', () => {
  test('XML 可以用 <UIWeb>；會接收滑鼠（hitTest 找得到）', async () => {
    const { ui } = await setup('<UI padding="10"><UIWeb id="w" src="pages/a.html" width="200" height="100"/></UI>');
    const w = ui.require<UIWeb>('w');
    expect(w).toBeInstanceOf(UIWeb);
    expect(w.src).toBe('pages/a.html');
    expect(ui.hitTest(50, 50)).toBe(w);
  });

  test('畫的時候用 destination-out 清掉自己範圍裡、先畫的東西', async () => {
    const { ui } = await setup('<UI><UIWeb id="w" html="x" width="200" height="100" radius="6"/></UI>');
    const ops: string[] = [];
    const ctx = new Proxy({ globalCompositeOperation: 'source-over' } as Record<string, unknown>, {
      get: (t, k) =>
        k in t ? t[k as string] : k === 'fill' ? () => ops.push(String(t.globalCompositeOperation)) : () => {},
      set: (t, k, v) => {
        t[k as string] = v;
        return true;
      },
    });
    ui.require<UIWeb>('w').paintContent(ctx as unknown as CanvasRenderingContext2D, 0, 0, 200, 100);
    expect(ops).toEqual(['destination-out']);
  });

  test('網頁層：元素跟著排版位置；畫面上的洞；隱藏時移除洞、保留元素', async () => {
    const { ui, canvas, layer, holes } = await setup(
      '<UI padding="20"><UIWeb id="w" src="pages/a.html" width="300" height="200" radius="8" background="#123456"/></UI>',
    );
    const w = ui.require<UIWeb>('w');
    layer.update();
    const box = w.element as unknown as FakeElement;
    expect(box).not.toBeNull();
    expect(box.style.left).toBe('20px');
    expect(box.style.top).toBe('20px');
    expect(box.style.width).toBe('300px');
    expect(box.style.background).toBe('#123456');
    expect((w.iframe as unknown as FakeElement).src).toMatch(/pages\/a\.html$/); // 網址以介面檔的資料夾為準
    expect(holes.at(-1)).toEqual([{ x: 20, y: 20, width: 300, height: 200, radius: 8, strength: 1 }]);
    // 畫布放到網頁層上面
    expect(canvas.style.zIndex).toBe('1');
    // 隱藏：元素保留（iframe 的內容不會不見）、洞移除
    w.visible = false;
    layer.update();
    expect(box.style.display).toBe('none');
    expect(box.removed).toBe(false);
    expect(holes.at(-1)).toEqual([]);
    layer.dispose();
    expect(box.removed).toBe(true);
    expect(w.element).toBeNull();
  });

  test('在列表裡：超出列表範圍的部分裁掉（元素與洞）', async () => {
    const { ui, layer, holes } = await setup(
      '<UI padding="0"><UIScrollView height="100" width="300"><UIWeb id="w" html="x" width="300" height="250"/></UIScrollView></UI>',
    );
    layer.update();
    const box = ui.require<UIWeb>('w').element as unknown as FakeElement;
    expect(box.style.clipPath).toBe('inset(0px 0px 150px 0px)');
    expect(holes.at(-1)).toEqual([{ x: 0, y: 0, width: 300, height: 100, radius: 0, strength: 1 }]);
  });

  test('換內容：src 改成 html 時 iframe 拿掉', async () => {
    const { ui, layer } = await setup('<UI><UIWeb id="w" src="pages/a.html"/></UI>');
    const w = ui.require<UIWeb>('w');
    layer.update();
    w.set('src', '');
    w.set('html', '<b>hi</b>');
    layer.update();
    expect(w.iframe).toBeNull();
    expect((w.element as unknown as FakeElement).innerHTML).toBe('<b>hi</b>');
  });
});
