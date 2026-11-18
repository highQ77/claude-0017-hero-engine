import { describe, expect, test, vi } from 'vitest';
import {
  UI2D,
  type UIButton,
  UIElement,
  type UIImage,
  type UILabel,
  type UIList,
  XmlError,
  measure,
  uiXml,
  draw,
  type Attrs,
  type UIContext,
} from '../src/ui2d';

/** 無畫面模式：固定寬度的文字量測（每字元 = 字級 × 0.5，中文字 × 1） */
async function makeUI(width = 400, height = 300, options: Partial<Parameters<typeof UI2D.create>[0]> = {}) {
  return UI2D.create({
    container: null,
    width,
    height,
    measure: measure.fixed(0.5),
    loadImage: async () => ({ width: 64, height: 32 }),
    ...options,
  });
}

const rect = (el: UIElement | undefined) => {
  const r = el!.absoluteRect;
  return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100);
};

// ───────── XML ─────────

describe('XML 解析', () => {
  test('巢狀、屬性、文字、自我關閉、註解、實體字元', () => {
    const tree = uiXml.parse(`
      <!-- 註解 -->
      <UILayout dir="v" sm:dir='h'>
        <UILabel>你好 &amp; 歡迎</UILabel>
        <UIImage src="a.png"/>
      </UILayout>`);
    expect(tree.tag).toBe('UILayout');
    expect(tree.attrs).toEqual({ dir: 'v', 'sm:dir': 'h' });
    expect(tree.children.map((c) => c.tag)).toEqual(['UILabel', 'UIImage']);
    expect(tree.children[0].text).toBe('你好 & 歡迎');
    expect(tree.children[1].line).toBe(5);
  });

  test('規格裡的寫法：UIImage 不寫結尾也可以', () => {
    const tree = uiXml.parse(`<UILayout dir="v">\n  <UIImage src="./xxx.png">\n</UILayout>`, { voidTags: ['UIImage'] });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].attrs.src).toBe('./xxx.png');
    const two = uiXml.parse(`<UILayout><UIImage src="a"><UIImage src="b"></UILayout>`, { voidTags: ['UIImage'] });
    expect(two.children.map((c) => c.attrs.src)).toEqual(['a', 'b']); // 兩張圖是兄弟，不是巢狀
  });

  test('錯誤訊息附行號', () => {
    expect(() => uiXml.parse('<UILayout>\n  <UILabel>\n</UILayout>')).toThrow(
      /第 3 行.*多出結尾標籤 <\/UILayout>.*<UILabel>（第 2 行）/,
    );
    expect(() => uiXml.parse('<UILayout>\n<UILabel/>')).toThrow(/<UILayout>（第 1 行）沒有結尾標籤/);
    expect(() => uiXml.parse('<A/><B/>')).toThrow(/最外層只能有一個元素/);
    expect(() => uiXml.parse('<A x="1" x="2"/>')).toThrow(/重複的屬性/);
    try {
      uiXml.parse('<A>\n\n</B>');
    } catch (e) {
      expect(e).toBeInstanceOf(XmlError);
      expect((e as XmlError).line).toBe(3);
    }
  });
});

// ───────── 文字 ─────────

describe('文字換行', () => {
  const font = { size: 10, family: 'x', weight: 'normal', lineHeight: 1.5 };
  const measureText = measure.fixed(0.5); // 英文 5px、中文 10px

  test('英文依單字、中文依字換行；高度依行數', () => {
    expect(draw.tokenize('hello world')).toEqual(['hello ', 'world']);
    expect(draw.tokenize('你好ab')).toEqual(['你', '好', 'ab']);
    const en = draw.wrapText('hello world foo', font, 50, measureText); // 「hello world」要 55px，放不下
    expect(en.lines).toEqual(['hello', 'world foo']);
    expect(en.height).toBe(30);
    const zh = draw.wrapText('一二三四五', font, 30, measureText);
    expect(zh.lines).toEqual(['一二三', '四五']);
  });

  test('強制換行、單字太長時切開、無限寬度不換行', () => {
    expect(draw.wrapText('a\nb', font, 100, measureText).lines).toEqual(['a', 'b']);
    expect(draw.wrapText('abcdefgh', font, 20, measureText).lines).toEqual(['abcd', 'efgh']);
    expect(draw.wrapText('a b c', font, Infinity, measureText).lines).toEqual(['a b c']);
  });
});

// ───────── 排版 ─────────

describe('Yoga 排版', () => {
  test('垂直與水平排列、padding、gap、flex', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(`
      <UILayout id="root" dir="v" padding="10" gap="5" width="100%" height="100%">
        <UILayout id="top" height="50" background="#333"/>
        <UILayout id="row" dir="h" flex="1" gap="10">
          <UILayout id="a" width="100"/>
          <UILayout id="b" flex="1"/>
        </UILayout>
      </UILayout>`);
    expect(rect(ui.get('top'))).toEqual([10, 10, 380, 50]);
    expect(rect(ui.get('row'))).toEqual([10, 65, 380, 225]);
    expect(rect(ui.get('a'))).toEqual([10, 65, 100, 225]);
    expect(rect(ui.get('b'))).toEqual([120, 65, 270, 225]);
  });

  test('對齊、置中、百分比、絕對定位、margin 簡寫', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(`
      <UI>
        <UILayout id="box" width="50%" height="100" align="center" justify="center" margin="10 20">
          <UILayout id="dot" width="20" height="20"/>
        </UILayout>
        <UILayout id="badge" position="absolute" right="8" top="8" width="30" height="30"/>
      </UI>`);
    expect(rect(ui.get('box'))).toEqual([20, 10, 200, 100]);
    expect(rect(ui.get('dot'))).toEqual([110, 50, 20, 20]);
    expect(rect(ui.get('badge'))).toEqual([362, 8, 30, 30]);
  });

  test('文字依容器寬度換行並撐開高度', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(`
      <UILayout width="40" align="start">
        <UILabel id="t" fontSize="10" lineHeight="1">hello world foo</UILabel>
      </UILayout>`);
    const label = ui.get<UILabel>('t')!;
    expect(label.metrics.lines).toEqual(['hello', 'world', 'foo']);
    expect(rect(label)[3]).toBe(30);
    label.setText('hi');
    ui.layout();
    expect(rect(label)).toEqual([0, 0, 10, 10]);
  });

  test('圖片：原始尺寸、只給寬度時維持比例、載入完成後重新排版', async () => {
    let resolveImage!: (s: { width: number; height: number }) => void;
    const pending = new Promise<{ width: number; height: number }>((r) => (resolveImage = r));
    const ui = await makeUI(400, 300, { loadImage: () => pending }); // 同一張圖共用一次載入
    ui.loadString(
      `<UILayout align="start"><UIImage id="a" src="icon.png"/><UIImage id="b" src="icon.png" width="128"/></UILayout>`,
      'ui/',
    );
    expect(ui.get<UIImage>('a')!.src).toBe('ui/icon.png');
    expect(rect(ui.get('a'))[2]).toBe(0);
    resolveImage({ width: 64, height: 32 });
    await new Promise((r) => setTimeout(r, 0));
    expect(rect(ui.get('a'))).toEqual([0, 0, 64, 32]);
    expect(rect(ui.get('b'))[3]).toBe(64); // 128 × 32/64
  });

  test('hidden 不佔空間；set() 修改屬性會重新排版', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(`<UILayout><UILayout id="a" height="50" hidden="true"/><UILayout id="b" height="50"/></UILayout>`);
    expect(rect(ui.get('b'))[1]).toBe(0);
    ui.get('a')!.visible = true;
    ui.layout();
    expect(rect(ui.get('b'))[1]).toBe(50);
    ui.get('a')!.set('height', 80);
    ui.layout();
    expect(rect(ui.get('b'))[1]).toBe(80);
  });
});

// ───────── RWD ─────────

describe('RWD', () => {
  const xml = `
    <UILayout id="wrap" dir="v" md:dir="h" width="100%">
      <UILayout id="a" height="40" width="100%" md:width="30%"/>
      <UILayout id="b" height="40" width="100%" md:width="70%"/>
      <UILabel id="hint" hidden="true" lg:hidden="false">大螢幕才顯示</UILabel>
    </UILayout>`;

  test('依寬度切換斷點屬性（行動優先）', async () => {
    const ui = await makeUI(375, 600);
    ui.loadString(xml);
    expect(ui.breakpoint).toEqual([]);
    expect(rect(ui.get('b'))).toEqual([0, 40, 375, 40]); // 手機：上下排
    expect(ui.get('hint')!.visible).toBe(false);

    ui.resize(800, 600);
    expect(ui.breakpoint).toEqual(['sm', 'md']);
    expect(rect(ui.get('a'))).toEqual([0, 0, 240, 40]); // 平板：左右排
    expect(rect(ui.get('b'))).toEqual([240, 0, 560, 40]);
    expect(ui.get('hint')!.visible).toBe(false);

    ui.resize(1280, 720);
    expect(ui.get('hint')!.visible).toBe(true);
    ui.resize(375, 600); // 縮回來，舊的屬性要清掉
    expect(rect(ui.get('b'))).toEqual([0, 40, 375, 40]);
  });

  test('樣式（UIStyle）與斷點一起使用', async () => {
    const ui = await makeUI(375, 600);
    ui.loadString(`
      <UI>
        <UIStyle name="card" padding="8" md:padding="24" background="#222">
        <UILayout id="c" style="card"><UILayout id="inner" height="10"/></UILayout>
      </UI>`);
    expect(ui.get('c')!.get('background')).toBe('#222');
    expect(rect(ui.get('inner'))[0]).toBe(8);
    ui.resize(800, 600);
    expect(rect(ui.get('inner'))[0]).toBe(24);
  });
});

// ───────── 元件 ─────────

describe('按鈕與事件', () => {
  test('onClick 呼叫 handlers；on() 監聽；disabled 不觸發', async () => {
    const clicked: string[] = [];
    const ui = await makeUI(400, 300, { handlers: { start: (e) => clicked.push(`start:${e.target.id}`) } });
    ui.loadString(`<UILayout><UIButton id="go" onClick="start">開始遊戲</UIButton></UILayout>`);
    const btn = ui.get<UIButton>('go')!;
    expect(btn.label!.text).toBe('開始遊戲');
    expect(btn.label!.get('color')).toBe('#ffffff'); // 文字顏色跟著按鈕
    btn.on('click', () => clicked.push('listener'));
    btn.click();
    expect(clicked).toEqual(['start:go', 'listener']);
    btn.disabled = true;
    ui.layout();
    btn.click();
    expect(clicked).toHaveLength(2);
  });

  test('按鈕內容置中、尺寸由文字與 padding 決定', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(`<UILayout align="start"><UIButton id="b" padding="10" fontSize="10" text="abcd"/></UILayout>`);
    const b = ui.get<UIButton>('b')!;
    expect(rect(b)).toEqual([0, 0, 40, 33]); // 文字 20×13 + padding 10
    expect(rect(b.label!)).toEqual([10, 10, 20, 13]);
  });

  test('找不到 handler 時警告', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = await makeUI();
    ui.loadString(`<UILayout><UIButton id="b" onClick="nope" text="x"/></UILayout>`);
    ui.get('b')!.click();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/找不到事件處理函式「nope」/));
    warn.mockRestore();
  });
});

describe('UIList', () => {
  test('垂直列表：項目不縮小，內容高度超出時可捲動', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(`
      <UILayout>
        <UIList id="list" height="100" gap="10">
          <UILayout height="40"/><UILayout height="40"/><UILayout height="40"/>
        </UIList>
      </UILayout>`);
    const list = ui.get<UIList>('list')!;
    expect(list.children.map((c) => rect(c)[3])).toEqual([40, 40, 40]);
    expect(list.contentHeight).toBe(140);
    expect(list.children[2].layout.y).toBe(100);
  });

  test('水平列表', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(
      `<UILayout><UIList id="h" type="horizontal" height="60" gap="0"><UILayout width="150"/><UILayout width="150"/><UILayout width="150"/></UIList></UILayout>`,
    );
    const list = ui.get<UIList>('h')!;
    expect(list.children.map((c) => c.layout.x)).toEqual([0, 150, 300]);
    expect(list.contentWidth).toBe(450);
  });

  test('grid：依欄數平均分配寬度並換行；斷點切換欄數', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(`
      <UILayout>
        <UIList id="g" type="grid" columns="3" md:columns="4" gap="10" padding="10" height="200">
          <UILayout height="50"/><UILayout height="50"/><UILayout height="50"/><UILayout height="50"/>
        </UIList>
      </UILayout>`);
    const g = ui.get<UIList>('g')!;
    // (400 - 20 padding - 20 gap) / 3 = 120
    expect(g.children.map((c) => [c.layout.x, c.layout.y, c.layout.width])).toEqual([
      [10, 10, 120],
      [140, 10, 120],
      [270, 10, 120],
      [10, 70, 120],
    ]);
    ui.resize(800, 300);
    // (800 - 20 - 30) / 4 = 187.5
    expect(g.children.map((c) => c.layout.y)).toEqual([10, 10, 10, 10]);
    // (800 - 20 - 30) / 4 = 187.5，Yoga 會對齊到整數像素
    expect(Math.abs(g.children[0].layout.width - 187.5)).toBeLessThanOrEqual(0.5);
  });

  test('樣板：setItems 由資料產生項目；事件帶資料與索引', async () => {
    const picked: unknown[] = [];
    const ui = await makeUI(400, 300, { handlers: { pick: (e) => picked.push([e.item, e.index]) } });
    ui.loadString(`
      <UILayout>
        <UIList id="inv" type="grid" columns="2" height="200">
          <UITemplate>
            <UIButton onClick="pick"><UILabel>{name} ×{count}</UILabel></UIButton>
          </UITemplate>
        </UIList>
      </UILayout>`);
    ui.setItems('inv', [
      { name: '劍', count: 1 },
      { name: '藥水', count: 5 },
    ]);
    ui.layout();
    const list = ui.get<UIList>('inv')!;
    expect(list.children).toHaveLength(2);
    const label = list.children[1].children[0] as UILabel;
    expect(label.text).toBe('藥水 ×5');
    list.children[1].click();
    expect(picked).toEqual([[{ name: '藥水', count: 5 }, 1]]);
    ui.setItems('inv', []);
    ui.layout();
    expect(list.children).toHaveLength(0);
  });
});

describe('錯誤與擴充', () => {
  test('不認識的元件、樣板位置錯誤', async () => {
    const ui = await makeUI();
    expect(() => ui.loadString('<UILayout>\n<UIFoo/></UILayout>')).toThrow(/第 2 行.*不認識的元件 <UIFoo>/);
    expect(() => ui.loadString('<UILayout><UITemplate><UILabel/></UITemplate></UILayout>')).toThrow(
      /只能放在 <UIList>/,
    );
    expect(() => ui.setItems('nope', [])).toThrow(/找不到介面元件/);
  });

  test('自訂元件：UI2D.register', async () => {
    class UIBar extends UIElement {
      constructor(ctx: UIContext, type: string, raw: Attrs) {
        super(ctx, type, raw);
      }
      override defaults(): Attrs {
        return { height: '12', background: '#e33', radius: '6' };
      }
    }
    UI2D.register('UIBar', UIBar);
    const ui = await makeUI(200, 100);
    ui.loadString('<UILayout><UIBar id="hp" width="50%"/></UILayout>');
    expect(rect(ui.get('hp'))).toEqual([0, 0, 100, 12]);
    UI2D.components.delete('UIBar');
  });

  test('requestLayout 會在同一輪合併成一次排版', async () => {
    const ui = await makeUI();
    ui.loadString('<UILayout align="start"><UILabel id="a">x</UILabel></UILayout>');
    let count = 0;
    ui.onLayout(() => count++);
    const a = ui.get<UILabel>('a')!;
    a.setText('1');
    a.setText('22');
    a.set('fontSize', 20);
    await Promise.resolve();
    expect(count).toBe(1);
    expect(rect(a)[2]).toBe(20); // 2 字 × 20 × 0.5
  });
});

// ───────── 根元件 <UI> 的版面尺寸 ─────────

describe('<UI> 版面尺寸', () => {
  test('沒寫寬高：填滿畫面', async () => {
    const ui = await makeUI(400, 300);
    expect(rect(ui.loadString('<UI/>'))).toEqual([0, 0, 400, 300]);
  });

  test('固定寬高：800 × 600', async () => {
    const ui = await makeUI(1000, 700);
    expect(rect(ui.loadString('<UI width="800" height="600"/>'))).toEqual([0, 0, 800, 600]);
  });

  test('auto：自動滿版，跟著畫面尺寸改變', async () => {
    const ui = await makeUI(400, 300);
    const root = ui.loadString('<UI width="auto" height="auto"><UILabel id="a">字</UILabel></UI>');
    expect(rect(root)).toEqual([0, 0, 400, 300]);
    ui.resize(640, 480);
    expect(rect(ui.root!)).toEqual([0, 0, 640, 480]);
  });

  test('寬自動滿版、高固定', async () => {
    const ui = await makeUI(400, 500);
    const root = ui.loadString('<UI width="auto" height="300"><UILayout id="fill" flex="1"/></UI>');
    expect(rect(root)).toEqual([0, 0, 400, 300]);
    expect(rect(ui.get('fill'))).toEqual([0, 0, 400, 300]);
    ui.resize(800, 500);
    expect(rect(ui.root!)).toEqual([0, 0, 800, 300]);
  });

  test('百分比與斷點', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString('<UI width="50%" height="auto" md:width="300"/>');
    expect(rect(ui.root!)).toEqual([0, 0, 200, 300]);
    ui.resize(1000, 300);
    expect(rect(ui.root!)).toEqual([0, 0, 300, 300]);
  });

  test('執行中改成 auto', async () => {
    const ui = await makeUI(400, 300);
    const root = ui.loadString('<UI width="100" height="100"/>');
    root.set('width', 'auto').set('height', 'auto');
    ui.layout();
    expect(rect(root)).toEqual([0, 0, 400, 300]);
  });
});

describe('width／height="fit"：依內容決定大小', () => {
  test('<UI height="fit">：最外層不滿版，高度依內容', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString('<UI width="100" height="fit"><UILayout height="40"/><UILayout height="20"/></UI>');
    expect(rect(ui.root!)).toEqual([0, 0, 100, 60]);
  });

  test('<UI width="fit" height="fit">：寬高都依內容', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString('<UI width="fit" height="fit" padding="5"><UILayout width="70" height="30"/></UI>');
    expect(rect(ui.root!)).toEqual([0, 0, 80, 40]);
  });

  test('一般元件：不會被父元件的 align="stretch"（預設）拉伸', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(
      '<UI><UILayout id="a" width="fit"><UILayout width="50" height="10"/></UILayout><UILayout id="b"><UILayout width="50" height="10"/></UILayout></UI>',
    );
    expect(rect(ui.get('a'))).toEqual([0, 0, 50, 10]);
    expect(rect(ui.get('b'))).toEqual([0, 10, 400, 10]); // 沒寫：照常拉伸
  });

  test('水平排列裡 height="fit"：不會被拉成一樣高', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString(
      '<UI dir="h"><UILayout id="a" height="fit"><UILayout width="30" height="20"/></UILayout><UILayout width="30" height="80"/></UI>',
    );
    expect(rect(ui.get('a'))).toEqual([0, 0, 30, 20]);
  });

  test('疊加圖層的 fit：依內容決定大小，不撐滿畫面', async () => {
    const ui = await makeUI(400, 300);
    ui.loadString('<UI/>');
    const layer = ui.addLayer('tip', '<UI width="fit" height="fit"><UILayout width="120" height="30"/></UI>');
    ui.layout();
    expect(rect(layer)).toEqual([0, 0, 120, 30]);
  });
});
