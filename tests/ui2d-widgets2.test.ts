import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  UI2D,
  UIRichText,
  UIStackView,
  type UITable,
  measure,
  parse,
  type UIButton,
  type UIElement,
  type UIEvent,
  type UILabel,
} from '../src/ui2d';

async function makeUI(xml: string, handlers: Record<string, (e: UIEvent) => void> = {}) {
  const ui = await UI2D.create({
    container: null,
    width: 800,
    height: 600,
    measure: measure.fixed(0.5),
    handlers,
    autoTick: false,
  });
  ui.loadString(xml);
  return ui;
}

function click(ui: UI2D, el: UIElement) {
  const r = el.absoluteRect;
  ui.handlePointer('down', r.x + r.width / 2, r.y + r.height / 2);
  ui.handlePointer('up', r.x + r.width / 2, r.y + r.height / 2);
}

const run = (ui: UI2D, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) ui.tick(1 / 60);
};

afterEach(() => {
  UI2D.setSkin('UIButton', null);
  UI2D.setSkin('UILabel', null);
});

describe('外觀（skin）', () => {
  test('<UISkin> 改變某種元件的預設外觀；優先度：預設 < skin < style < 自己的屬性', async () => {
    const ui = await makeUI(`
      <UI>
        <UISkin for="UIButton" background="#9acd32" color="#141a07" radius="14"/>
        <UIStyle name="danger" background="#ff4d4f"/>
        <UIButton id="a" text="A"/>
        <UIButton id="b" text="B" style="danger"/>
        <UIButton id="c" text="C" background="#123456"/>
        <UILabel id="l">不受影響</UILabel>
      </UI>`);
    const a = ui.require('a');
    expect([a.attrs.background, a.attrs.color, a.attrs.radius]).toEqual(['#9acd32', '#141a07', '14']);
    expect(a.attrs.hoverBackground).toBe('#5a92ff'); // 沒有改到的維持元件預設
    expect(ui.require('b').attrs.background).toBe('#ff4d4f');
    expect(ui.require('c').attrs.background).toBe('#123456');
    expect(ui.require('l').attrs.color).toBe('#ffffff');
    // 按鈕文字的顏色跟著按鈕
    expect((a as UIButton).label!.attrs.color).toBe('#141a07');
  });

  test('全域外觀 UI2D.setSkin；XML 的 <UISkin> 蓋過全域；斷點前綴', async () => {
    UI2D.setSkin('UIButton', { background: '#111111', radius: '2' });
    const ui = await makeUI(`
      <UI>
        <UISkin for="UIButton" radius="20" md:radius="30"/>
        <UIButton id="a" text="A"/>
      </UI>`);
    const a = ui.require('a');
    expect(a.attrs.background).toBe('#111111');
    expect(a.attrs.radius).toBe('30'); // 800 寬 ≥ md
    ui.resize(500, 600);
    expect(ui.require('a').attrs.radius).toBe('20');
  });

  test('執行中修改外觀：setDocumentSkin 重新套用', async () => {
    const ui = await makeUI('<UI><UIButton id="a" text="A"/></UI>');
    ui.setDocumentSkin('UIButton', { background: '#abcdef' });
    ui.layout();
    expect(ui.require('a').attrs.background).toBe('#abcdef');
    ui.setDocumentSkin('UIButton', null);
    ui.layout();
    expect(ui.require('a').attrs.background).toBe('#3a7bfd');
  });

  test('<UISkin> 少了 for 會報錯', async () => {
    const ui = await UI2D.create({ container: null, width: 100, height: 100, measure: measure.fixed(0.5) });
    expect(() => ui.loadString('<UI><UISkin background="#f00"/></UI>')).toThrow(/for/);
  });
});

describe('UIStackView 頁面堆疊', () => {
  test('頁面比換頁容器高時縮到容器的大小（捲動區可以捲動）；有寫尺寸的頁面照自己的', async () => {
    const tall = Array.from({ length: 20 }, () => '<UILayout height="40"/>').join('');
    const ui = await makeUI(`
      <UI width="400" height="300">
        <UIStackView id="pages" height="200">
          <UIScrollView id="long">${tall}</UIScrollView>
          <UILayout id="fixed" height="80"/>
        </UIStackView>
      </UI>`);
    ui.layout();
    const long = ui.require('long') as UIElement & { contentHeight: number };
    expect(long.layout.height).toBe(200); // 填滿容器，而不是內容的高度（約 950）
    expect(long.contentHeight).toBeGreaterThan(200); // 超出的部分可以捲動
    ui.require<UIStackView>('pages').show('fixed');
    ui.layout();
    expect(ui.require('fixed').layout.height).toBe(80);
  });

  test('換頁容器的大小依內容決定時（例如視窗裡的分頁），頁面仍然是內容的大小', async () => {
    const ui = await makeUI(`
      <UI width="400" height="600">
        <UILayout id="win" height="fit">
          <UIStackView id="pages">
            <UILayout id="page" gap="4"><UILayout height="50"/><UILayout height="50"/></UILayout>
          </UIStackView>
        </UILayout>
      </UI>`);
    ui.layout();
    expect(ui.require('page').layout.height).toBe(104);
    expect(ui.require('pages').layout.height).toBe(104);
  });

  const xml = `
    <UI>
      <UILayout dir="h">
        <UIButton id="t0" text="角色" select="pages:0" activeBackground="#9acd32" activeColor="#000000"/>
        <UIButton id="t1" text="技能" select="pages:skills" activeBackground="#9acd32"/>
      </UILayout>
      <UIStackView id="pages" width="400" height="200" indicator="dots" swipe="true" onChange="changed">
        <UILayout id="hero"><UILabel id="heroText">角色頁</UILabel></UILayout>
        <UILayout id="skills"><UIButton id="skillBtn" text="火球"/></UILayout>
        <UILayout id="items"><UILabel>道具頁</UILabel></UILayout>
      </UIStackView>
    </UI>`;

  test('一次只顯示一頁；select 按鈕切換並亮起；change 事件', async () => {
    const changes: unknown[] = [];
    const ui = await makeUI(xml, { changed: (e) => changes.push(e.value) });
    const stack = ui.require<UIStackView>('pages');
    expect(stack.count).toBe(3);
    expect(stack.pages.map((p) => p.visible)).toEqual([true, false, false]);
    expect(ui.require('t0').attrs.background).toBe('#9acd32');
    expect(ui.require('t0').attrs.color).toBe('#000000');
    expect(ui.require('t1').attrs.background).toBe('#3a7bfd');
    // 目前這一頁的按鈕：滑鼠移上去也維持亮起的背景（不換成一般的 hover 顏色）
    expect(ui.require('t0').attrs.hoverBackground).toBe('#9acd32');
    expect(ui.require('t1').attrs.hoverBackground).not.toBe('#9acd32');

    click(ui, ui.require('t1'));
    await Promise.resolve();
    expect(stack.selectedIndex).toBe(1);
    expect(stack.selectedPage!.id).toBe('skills');
    expect(changes).toEqual([1]);
    expect(ui.require('t1').attrs.background).toBe('#9acd32');
    expect(ui.require('t0').attrs.background).toBe('#3a7bfd');
    expect(ui.require('heroText').layout.width).toBe(0); // 隱藏的頁不佔空間
  });

  test('切換動畫：新的一頁從透明滑入', async () => {
    const ui = await makeUI(xml);
    const stack = ui.require<UIStackView>('pages');
    stack.show('items');
    const page = stack.pages[2];
    expect(page.alpha).toBe(0);
    run(ui, 0.1);
    expect(page.alpha).toBeGreaterThan(0);
    expect(page.offsetX).toBeGreaterThan(0); // 往後的頁從右邊進來
    run(ui, 0.5);
    expect([page.alpha, page.offsetX]).toEqual([1, 0]);
    // 往前從左邊
    stack.prev();
    run(ui, 0.05);
    expect(stack.pages[1].offsetX).toBeLessThan(0);
  });

  test('左右滑動換頁；按在頁面的按鈕上照常點擊', async () => {
    const ui = await makeUI(xml);
    const stack = ui.require<UIStackView>('pages');
    const r = stack.absoluteRect;
    ui.handlePointer('down', r.x + 300, r.y + 150);
    ui.handlePointer('move', r.x + 200, r.y + 150);
    ui.handlePointer('up', r.x + 150, r.y + 150);
    expect(stack.selectedIndex).toBe(1);
    const clicked = vi.fn();
    ui.require('skillBtn').on('click', clicked);
    run(ui, 1);
    await Promise.resolve();
    click(ui, ui.require('skillBtn'));
    expect(clicked).toHaveBeenCalled();
    expect(stack.selectedIndex).toBe(1);
    // 到最後一頁再往後：不循環
    stack.show(2);
    stack.next();
    expect(stack.selectedIndex).toBe(2);
  });
});

describe('UITable 表格', () => {
  const xml = `
    <UI>
      <UITable id="t" width="400" height="200" onSelect="picked">
        <UIColumn key="rank" title="#" width="40" align="center"/>
        <UIColumn key="name" title="玩家"/>
        <UIColumn key="score" title="分數" width="80" align="right"/>
        <UIRow rank="1" name="小明" score="980"/>
        <UIRow rank="2" name="阿華" score="1200"/>
        <UIRow rank="3" name="Bob" score="50"/>
      </UITable>
    </UI>`;

  const texts = (t: UITable) => t.body.children.map((row) => row.children.map((c) => (c as UILabel).text));

  test('XML 的欄位與資料、欄寬', async () => {
    const ui = await makeUI(xml);
    const t = ui.require<UITable>('t');
    expect(t.columns.map((c) => c.key)).toEqual(['rank', 'name', 'score']);
    expect(texts(t)).toEqual([
      ['1', '小明', '980'],
      ['2', '阿華', '1200'],
      ['3', 'Bob', '50'],
    ]);
    const [c0, c1, c2] = t.header.children;
    expect(c0.layout.width).toBe(40);
    expect(c2.layout.width).toBe(80);
    expect(c1.layout.width).toBe(400 - 40 - 80); // 其餘寬度給沒有固定寬度的欄
    // 斑馬紋
    expect(t.body.children[1].attrs.background).toBe('rgba(255,255,255,0.03)');
  });

  test('點標題排序（數字自動判斷）、再點反向', async () => {
    const ui = await makeUI(xml);
    const t = ui.require<UITable>('t');
    click(ui, t.header.children[2]);
    await Promise.resolve();
    expect(texts(t).map((r) => r[2])).toEqual(['50', '980', '1200']);
    expect((t.header.children[2] as UILabel).text).toBe('分數 ▲');
    click(ui, t.header.children[2]);
    await Promise.resolve();
    expect(texts(t).map((r) => r[2])).toEqual(['1200', '980', '50']);
    t.sortBy('name', 1);
    const names = ['小明', '阿華', 'Bob'].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    expect(texts(t).map((r) => r[1])).toEqual(names);
  });

  test('點資料列選取：select 事件帶該列資料、選取樣式', async () => {
    const picked: unknown[] = [];
    const ui = await makeUI(xml, { picked: (e) => picked.push(e.item) });
    const t = ui.require<UITable>('t');
    click(ui, t.body.children[1]);
    await Promise.resolve();
    expect(picked).toEqual([{ rank: '2', name: '阿華', score: '1200' }]);
    expect(t.selectedIndex).toBe(1);
    expect(t.body.children[1].attrs.background).toBe('rgba(154,205,50,0.22)');
  });

  test('setRows 換資料、超過高度可以捲動、沒有資料顯示提示', async () => {
    const ui = await makeUI(xml);
    const t = ui.require<UITable>('t');
    t.setRows(Array.from({ length: 30 }, (_, i) => ({ rank: i + 1, name: `玩家${i}`, score: i * 10 })));
    ui.layout();
    expect(t.body.children).toHaveLength(30);
    expect(t.body.contentHeight).toBeGreaterThan(t.body.layout.height);
    ui.handleWheel(0, 100, t.body.absoluteRect.x + 50, t.body.absoluteRect.y + 30);
    expect(t.body.scrollTop).toBe(100);
    t.setRows([]);
    ui.layout();
    expect((t.body.children[0] as UILabel).text).toBe('沒有資料');
  });
});

describe('UIRichText 多樣式文字', () => {
  test('解析標記：巢狀樣式、圖示、換行、[[ 跳脫、不認識的標記保留原文', () => {
    const items = parse.richText('造成 [b][color=#f55]120[/color][/b] 點[icon=fire color=#fb4][br]第二行 [[x] [what]');
    expect(items.map((i) => i.kind)).toEqual(['text', 'text', 'text', 'icon', 'br', 'text']);
    const red = items[1] as { text: string; style: { bold: boolean; color: string } };
    expect([red.text, red.style.bold, red.style.color]).toEqual(['120', true, '#f55']);
    expect(items[3]).toMatchObject({ kind: 'icon', name: 'fire', color: '#fb4' });
    expect((items[5] as { text: string }).text).toBe('第二行 [x] [what]');
  });

  test('排版：混合大小自動換行、行高取該行最大字級', async () => {
    const ui = await makeUI(
      '<UI align="start"><UIRichText id="r" width="200" fontSize="10">一二三四五[size=20]六七[/size]八九十[br]完</UIRichText></UI>',
    );
    const r = ui.require<UIRichText>('r');
    // 測試用的字寬：中文 = 字級（10 號字 10px、20 號字 20px）
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].width).toBe(5 * 10 + 2 * 20 + 3 * 10);
    expect(r.lines[0].height).toBe(30); // 20 × 1.5
    expect(r.lines[1].height).toBe(15);
    expect(r.layout.height).toBe(45);
    expect(r.plainText).toBe('一二三四五六七八九十\n完');
    r.setText('[b]換[/b]了');
    ui.layout();
    expect(r.lines).toHaveLength(1);
  });

  test('窄的時候自動換行（中文逐字、英文以單字）', async () => {
    const ui = await makeUI(
      '<UI align="start"><UIRichText id="r" width="35" fontSize="10">hello world 你好</UIRichText></UI>',
    );
    const r = ui.require<UIRichText>('r');
    const lineTexts = r.lines.map((l) => l.items.map((p) => p.text).join(''));
    expect(lineTexts).toEqual(['hello', 'world', '你好']);
  });
});

describe('整併：UITabs 使用 UIStackView、對話框支援多樣式文字', () => {
  test('UITabs 的內容是頁面堆疊：切換有動畫、可以滑動換頁（標籤與 change 事件同步）', async () => {
    const changes: unknown[] = [];
    const ui = await makeUI(
      `
      <UI>
        <UITabs id="tabs" transition="slide" swipe="true" onChange="c" width="400">
          <UITab title="一" height="100"><UILabel>A</UILabel></UITab>
          <UITab title="二" height="100"><UILabel>B</UILabel></UITab>
        </UITabs>
      </UI>`,
      { c: (e) => changes.push(e.value) },
    );
    const { UITabs } = await import('../src/ui2d');
    const tabs = ui.require('tabs') as InstanceType<typeof UITabs>;
    expect(tabs.content).toBeInstanceOf(UIStackView);
    click(ui, tabs.bar.children[1]);
    expect(tabs.tabs[1].alpha).toBe(0); // 動畫開始
    run(ui, 0.5);
    expect(tabs.tabs[1].alpha).toBe(1);
    expect(changes).toEqual([1]);
    // 在內容區往右滑：回到第一頁，標籤也跟著換
    const r = tabs.content.absoluteRect;
    ui.handlePointer('down', r.x + 50, r.y + 50);
    ui.handlePointer('move', r.x + 150, r.y + 50);
    ui.handlePointer('up', r.x + 200, r.y + 50);
    await Promise.resolve();
    expect(tabs.selectedIndex).toBe(0);
    expect(changes).toEqual([1, 0]);
    expect(tabs.bar.children[0].attrs.background).toBe('#3a7bfd');
  });

  test('多樣式文字的打字機效果：只畫前幾個字，圖示算一個字', async () => {
    const ui = await makeUI('<UI align="start"><UIRichText id="r">ab[b]cd[/b][icon=coin]ef</UIRichText></UI>');
    const r = ui.require<UIRichText>('r');
    expect(r.length).toBe(7);
    const drawn: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) =>
        k in t
          ? t[k]
          : k === 'measureText'
            ? () => ({ width: 5 })
            : k === 'fillText'
              ? (s: string) => drawn.push(s)
              : () => {},
      set: (t, k: string, v) => {
        t[k] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    r.revealed = 3;
    r.paintContent(ctx, 0, 0, 200);
    expect(drawn).toEqual(['ab', 'c']);
    drawn.length = 0;
    r.revealed = Infinity;
    r.paintContent(ctx, 0, 0, 200);
    expect(drawn).toEqual(['ab', 'cd', 'ef']);
  });

  test('對話框內容可以用標記；逐字顯示以去掉標記後的字數計算', async () => {
    const ui = await makeUI(
      '<UI><UIDialogue id="d" autoplay="true" speed="10">獲得 [color=#ffd75e]金幣[/color]！</UIDialogue></UI>',
    );
    const { UIDialogue } = await import('../src/ui2d');
    const d = ui.require('d') as InstanceType<typeof UIDialogue>;
    expect(d.textLabel).toBeInstanceOf(UIRichText);
    expect(d.textLabel.length).toBe(6); // 獲 得 空白 金 幣 ！
    run(ui, 0.35);
    expect(d.typing).toBe(true);
    run(ui, 0.4);
    expect(d.typing).toBe(false);
    d.say('[b]下一句[/b]');
    expect(d.textLabel.revealed).toBe(0);
    expect(d.textLabel.length).toBe(3);
  });
});

describe('整併：UIList 以 UIScrollView 為基礎、UIDialog 改名', () => {
  test('UIList 是一種 UIScrollView（捲動區不是列表）；捲動區可以水平捲動', async () => {
    const { UIList, UIScrollView } = await import('../src/ui2d');
    const ui = await makeUI(`
      <UI>
        <UIList id="list" height="50"><UILabel>a</UILabel></UIList>
        <UIScrollView id="sv" width="100" height="50" scroll="h" dir="h">
          <UILayout width="300" height="40" background="#333"/>
        </UIScrollView>
      </UI>`);
    const list = ui.require('list');
    const sv = ui.require('sv') as InstanceType<typeof UIScrollView>;
    expect(list).toBeInstanceOf(UIScrollView);
    expect(list).toBeInstanceOf(UIList);
    expect(sv).not.toBeInstanceOf(UIList);
    expect([sv.scrollAxis, sv.contentWidth]).toEqual(['x', 300]);
    ui.handleWheel(0, 80, 20, sv.absoluteRect.y + 10); // 只有垂直滾輪：也會水平捲動
    expect(sv.scrollLeft).toBe(80);
  });

  test('舊名稱 <UIDialog> 仍可使用（提醒一次改名），新名稱 <UIDialogue>', async () => {
    const { UIDialog, UIDialogue } = await import('../src/ui2d');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = await makeUI(
      '<UI><UIDialog id="a">舊</UIDialog><UIDialog id="b">舊</UIDialog><UIDialogue id="c">新</UIDialogue></UI>',
    );
    expect(ui.require('a')).toBeInstanceOf(UIDialogue);
    expect(ui.require('a')).toBeInstanceOf(UIDialog);
    expect(ui.require('c')).toBeInstanceOf(UIDialogue);
    const renameWarnings = warn.mock.calls.filter((c) => String(c[0]).includes('UIDialogue'));
    expect(renameWarnings.length).toBeLessThanOrEqual(1); // 只提醒一次（其他測試可能已經提醒過）
    warn.mockRestore();
  });
});

describe('編輯器模式：空的容器', () => {
  test('空的排版有最小尺寸與提示；刻意的間隔、提示訊息、遊戲模式都不受影響', async () => {
    const xml = `
      <UI align="start">
        <UILayout id="empty"/>
        <UILayout id="spacer" flex="1"/>
        <UILayout id="sized" width="150"/>
        <UILayout id="full"><UILabel>有內容</UILabel></UILayout>
        <UIToast id="toast"/>
      </UI>`;
    const editor = await UI2D.create({
      container: null,
      width: 800,
      height: 600,
      measure: measure.fixed(0.5),
      editorHints: true,
    });
    editor.loadString(xml);
    const e = editor.require('empty');
    expect(e.isEmptyContainer).toBe(true);
    expect([e.layout.width, e.layout.height]).toEqual([120, 48]);
    for (const id of ['spacer', 'sized', 'full', 'toast']) expect(editor.require(id).isEmptyContainer, id).toBe(false);
    const game = await UI2D.create({ container: null, width: 800, height: 600, measure: measure.fixed(0.5) });
    game.loadString(xml);
    expect(game.require('empty').isEmptyContainer).toBe(false);
    expect(game.require('empty').layout.height).toBe(0);
  });
});
