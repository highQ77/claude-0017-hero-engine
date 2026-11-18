import { describe, expect, test, vi } from 'vitest';
import { Euler, Quaternion } from 'three';
import { Engine, type Plugin } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import {
  ICON_NAMES,
  MinimapMarker,
  MinimapPlugin,
  UI2D,
  type UIBadge,
  type UICooldown,
  type UIDialogue,
  type UIJoystick,
  type UIMinimap,
  type UIProgressBar,
  type UIScrollView,
  type UISlot,
  type UISlider,
  UITab,
  type UITabs,
  UIToast,
  type UIToggle,
  type UIWindow,
  measure,
  draw,
  type UIElement,
  type UIEvent,
} from '../src/ui2d';
import { fakeScheduler } from './helpers';

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

/** 在元件中央點一下 */
function click(ui: UI2D, el: UIElement) {
  const r = el.absoluteRect;
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  ui.handlePointer('down', x, y);
  ui.handlePointer('up', x, y);
}

/** 推進動畫 seconds 秒 */
function run(ui: UI2D, seconds: number, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) ui.tick(step);
}

describe('UIProgressBar 進度條', () => {
  test('數值限制在範圍內、文字格式、平滑移動', async () => {
    const ui = await makeUI(
      '<UI><UIProgressBar id="hp" value="80" max="200" textFormat="{value}/{max} {percent}"/></UI>',
    );
    const bar = ui.require<UIProgressBar>('hp');
    expect([bar.layout.width, bar.layout.height]).toEqual([200, 14]);
    expect(bar.displayText).toBe('80/200 40%');
    bar.value = 500;
    expect(bar.value).toBe(200);
    expect(bar.ratio).toBeCloseTo(0.4); // 還沒開始動
    run(ui, 0.1);
    expect(bar.ratio).toBeGreaterThan(0.4);
    expect(bar.ratio).toBeLessThan(1);
    run(ui, 1);
    expect(bar.ratio).toBe(1);
    expect(ui.animatingCount).toBe(0);
  });

  test('減少時有殘影，之後慢慢跟上並消失', async () => {
    const ui = await makeUI('<UI><UIProgressBar id="hp" value="100"/></UI>');
    const bar = ui.require<UIProgressBar>('hp');
    bar.value = 40;
    expect(bar.trail).toBe(100);
    run(ui, 0.3);
    expect(bar.trail).toBe(100); // 先停留一下
    run(ui, 2);
    expect(bar.trail).toBeNull();
    expect(bar.ratio).toBeCloseTo(0.4);
    // 增加不會有殘影
    bar.value = 90;
    expect(bar.trail).toBeNull();
  });
});

describe('UIProgressBar 圓形進度', () => {
  test('shape="radial"：預設尺寸、百分比文字、畫出環與進度弧（有動畫與殘影）', async () => {
    const ui = await makeUI('<UI align="start"><UIProgressBar id="r" shape="radial" value="25" showText="true"/></UI>');
    const r = ui.require<UIProgressBar>('r');
    expect([r.radial, r.layout.width, r.layout.height]).toEqual([true, 64, 64]);
    expect(r.displayText).toBe('25%');
    const arcs: number[][] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) =>
        k in t
          ? t[k]
          : k === 'arc'
            ? (...a: number[]) => arcs.push(a)
            : k === 'measureText'
              ? () => ({ width: 10 })
              : () => {},
      set: (t, k: string, v) => {
        t[k] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    r.paintContent(ctx, 0, 0, 64, 64);
    // 底環（整圈）+ 進度弧（四分之一圈，從 12 點鐘開始）
    expect(arcs).toHaveLength(2);
    const [, , , s0, e0] = arcs[1];
    expect(s0).toBeCloseTo(-Math.PI / 2);
    expect(e0 - s0).toBeCloseTo(Math.PI / 2);
    // 減少時有殘影弧
    r.value = 10;
    run(ui, 0.15); // 進度往下動，殘影先停在原處
    arcs.length = 0;
    r.paintContent(ctx, 0, 0, 64, 64);
    expect(arcs).toHaveLength(2 + 1);
    run(ui, 2);
    expect(r.trail).toBeNull();
  });
});

describe('UIToggle 開關、UIIcon 圖示', () => {
  test('點擊切換、觸發 change、圓鈕滑動', async () => {
    const changes: unknown[] = [];
    const ui = await makeUI('<UI><UIToggle id="t" text="垂直同步" onChange="c"/></UI>', {
      c: (e) => changes.push(e.value),
    });
    const t = ui.require<UIToggle>('t');
    expect(t.indicator.layout.width).toBe(42);
    click(ui, t);
    expect(t.checked).toBe(true);
    expect(changes).toEqual([true]);
    expect(t.knob).toBe(0);
    run(ui, 0.05);
    expect(t.knob).toBeGreaterThan(0.3);
    run(ui, 0.5);
    expect(t.knob).toBe(1);
  });

  test('圖示：大小、內建清單、不認識的名稱', async () => {
    const ui = await makeUI('<UI><UIIcon id="i" name="heart" size="32"/></UI>');
    expect(ui.require('i').layout.width).toBe(32);
    expect(ICON_NAMES).toEqual(expect.arrayContaining(['heart', 'star', 'coin', 'gear', 'close', 'sword', 'shield']));
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(40);
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;
    expect(draw.icon(ctx, 'heart', 0, 0, 24, 24, '#fff')).toBe(true);
    expect(draw.icon(ctx, 'nope', 0, 0, 24, 24, '#fff')).toBe(false);
  });
});

describe('UIToast 提示訊息', () => {
  test('ui.toast 自動建立、淡入淡出、時間到移除、數量上限', async () => {
    const ui = await makeUI('<UI><UILabel>遊戲</UILabel></UI>');
    ui.toast('獲得金幣 ×10', { icon: 'coin', duration: 1 });
    const toast = ui.root!.children.find((c) => c instanceof UIToast) as UIToast;
    expect(toast).toBeDefined();
    expect(toast.count).toBe(1);
    const item = toast.children[0];
    expect(item.alpha).toBe(0);
    run(ui, 0.3);
    expect(item.alpha).toBe(1);
    run(ui, 1);
    expect(toast.count).toBe(0);
    for (let i = 0; i < 6; i++) ui.toast(`訊息 ${i}`);
    expect(toast.count).toBe(4);
  });
});

describe('UIWindow 視窗', () => {
  const xml = `
    <UI>
      <UIWindow id="w" title="設定" position="absolute" left="100" top="100" width="300" onClose="closed">
        <UILabel id="inside">內容</UILabel>
        <UIButton id="ok" text="確定"/>
      </UIWindow>
    </UI>`;

  test('子元件放進內容區、標題、關閉鈕', async () => {
    const closed = vi.fn();
    const ui = await makeUI(xml, { closed });
    const w = ui.require<UIWindow>('w');
    expect(ui.require('inside').parent).toBe(w.body);
    expect(w.titleLabel.text).toBe('設定');
    expect(ui.require('inside').absoluteRect.y).toBeGreaterThan(w.header.absoluteRect.y + w.header.layout.height - 1);
    click(ui, w.closeButton);
    expect(w.visible).toBe(false);
    expect(closed).toHaveBeenCalledTimes(1);
    w.open();
    expect(w.visible).toBe(true);
  });

  test('拖曳標題列移動（含子元件的點擊位置），不會拖出畫面', async () => {
    const ui = await makeUI(xml);
    const w = ui.require<UIWindow>('w');
    const h = w.header.absoluteRect;
    ui.handlePointer('down', h.x + 20, h.y + 10);
    ui.handlePointer('move', h.x + 70, h.y + 40);
    ui.handlePointer('up', h.x + 70, h.y + 40);
    expect([w.offsetX, w.offsetY]).toEqual([50, 30]);
    expect(w.absoluteRect.x).toBe(150);
    // 按鈕跟著移動，點新位置有效
    const ok = ui.require('ok');
    const clicked = vi.fn();
    ok.on('click', clicked);
    click(ui, ok);
    expect(clicked).toHaveBeenCalled();
    // 拖到很遠
    ui.handlePointer('down', w.header.absoluteRect.x + 20, w.header.absoluteRect.y + 10);
    ui.handlePointer('move', 5000, -5000);
    ui.handlePointer('up', 5000, -5000);
    expect(w.absoluteRect.x).toBeLessThanOrEqual(800 - 40);
    expect(w.absoluteRect.y).toBe(0);
  });
});

describe('UITabs 分頁、UIScrollView 捲動區', () => {
  test('只顯示選取的分頁、點標籤切換、change 事件', async () => {
    const changes: unknown[] = [];
    const ui = await makeUI(
      `
      <UI>
        <UITabs id="tabs" onChange="c">
          <UITab title="畫面"><UILabel id="a">A</UILabel></UITab>
          <UITab title="聲音"><UILabel id="b">B</UILabel></UITab>
        </UITabs>
      </UI>`,
      { c: (e) => changes.push(e.value) },
    );
    const tabs = ui.require<UITabs>('tabs');
    expect(tabs.tabs).toHaveLength(2);
    expect(tabs.bar.children.map((b) => (b as unknown as { label: { text: string } }).label.text)).toEqual([
      '畫面',
      '聲音',
    ]);
    expect(tabs.tabs[0].visible).toBe(true);
    expect(tabs.tabs[1].visible).toBe(false);
    expect(ui.require('b').layout.width).toBe(0); // 不顯示的分頁不佔空間
    click(ui, tabs.bar.children[1]);
    await Promise.resolve();
    expect(tabs.selectedIndex).toBe(1);
    expect(changes).toEqual([1]);
    expect(tabs.selectedTab).toBe(tabs.tabs[1]);
    expect(tabs.tabs[1]).toBeInstanceOf(UITab);
    expect(ui.require('b').layout.width).toBeGreaterThan(0);
    // 用標題選
    tabs.set('value', '畫面');
    expect(tabs.selectedIndex).toBe(0);
  });

  test('捲動區：兩個方向都能捲、限制在內容範圍', async () => {
    const ui = await makeUI(`
      <UI>
        <UIScrollView id="sv" width="200" height="100" scroll="both">
          <UILayout width="500" height="400" background="#333"/>
        </UIScrollView>
      </UI>`);
    const sv = ui.require<UIScrollView>('sv');
    expect(sv.scrollAxis).toBe('both');
    expect([sv.contentWidth, sv.contentHeight]).toEqual([500, 400]);
    ui.handleWheel(120, 80, 50, 50);
    expect([sv.scrollLeft, sv.scrollTop]).toEqual([120, 80]);
    ui.handleWheel(9999, 9999, 50, 50);
    expect([sv.scrollLeft, sv.scrollTop]).toEqual([300, 300]);
  });
});

describe('UISlot 物品格、UICooldown 冷卻、UIBadge 角標', () => {
  const xml = `
    <UI dir="h" gap="10" padding="10">
      <UISlot id="a" iconName="sword" count="3" rarity="epic" onClick="use" onDragend="end"><UICooldown id="cd"/></UISlot>
      <UISlot id="b" onDrop="drop"/>
      <UISlot id="c" iconName="potion" count="1"/>
    </UI>`;

  test('顯示：數量（1 不顯示）、稀有度外框、內建圖示', async () => {
    const ui = await makeUI(xml);
    const a = ui.require<UISlot>('a');
    expect(a.countLabel.visible).toBe(true);
    expect(a.countLabel.text).toBe('3');
    expect(a.attrs.border).toBe('2 #b072ff');
    expect(a.icon.visible).toBe(true);
    expect(a.image.visible).toBe(false);
    expect(ui.require<UISlot>('c').countLabel.visible).toBe(false);
    expect(ui.require<UISlot>('b').empty).toBe(true);
  });

  test('拖曳到另一格：目標收到 drop（含來源），來源收到 dragend；沒移動算點擊', async () => {
    const events: string[] = [];
    const ui = await makeUI(xml, {
      use: () => events.push('use'),
      drop: (e) => events.push(`drop from ${e.source!.id} to ${e.target.id}`),
      end: (e) => events.push(`end ${(e.value as UIElement | null)?.id}`),
    });
    const a = ui.require<UISlot>('a').absoluteRect;
    const b = ui.require<UISlot>('b').absoluteRect;
    ui.handlePointer('down', a.x + 20, a.y + 20);
    ui.handlePointer('move', a.x + 40, a.y + 20);
    expect(ui.require<UISlot>('a').dragging).toBe(true);
    expect(ui.paintState.overlays).toHaveLength(1); // 跟著滑鼠的圖示
    ui.handlePointer('move', b.x + 20, b.y + 20);
    expect(ui.require<UISlot>('b').dropTarget).toBe(true);
    ui.handlePointer('up', b.x + 20, b.y + 20);
    expect(events).toEqual(['drop from a to b', 'end b']);
    expect(ui.paintState.overlays).toHaveLength(0);
    expect(ui.require<UISlot>('a').dragging).toBe(false);
    click(ui, ui.require('a'));
    expect(events.at(-1)).toBe('use');
    // 空格不能拖
    ui.handlePointer('down', b.x + 20, b.y + 20);
    ui.handlePointer('move', a.x + 20, a.y + 20);
    expect(ui.paintState.overlays).toHaveLength(0);
    ui.handlePointer('up', a.x + 20, a.y + 20);
  });

  test('冷卻：倒數、ready 事件、不擋住點擊', async () => {
    const used = vi.fn();
    const ui = await makeUI(xml, { use: used });
    const cd = ui.require<UICooldown>('cd');
    const ready = vi.fn();
    cd.on('ready', ready);
    expect(cd.layout.width).toBe(56); // 蓋滿物品格
    cd.start(2);
    expect(cd.ratio).toBe(1);
    run(ui, 1);
    expect(cd.ratio).toBeCloseTo(0.5, 1);
    expect(ready).not.toHaveBeenCalled();
    run(ui, 1.1);
    expect(cd.ready).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    click(ui, cd);
    expect(used).toHaveBeenCalledTimes(1);
  });

  test('角標：99+、0 隱藏、紅點', async () => {
    const ui = await makeUI(`
      <UI>
        <UIButton id="btn" text="任務"><UIBadge id="n" value="120"/></UIButton>
        <UIBadge id="z" value="0"/>
        <UIBadge id="d" dot="true"/>
      </UI>`);
    const n = ui.require<UIBadge>('n');
    expect(n.text).toBe('99+');
    expect(n.value).toBe('120');
    const btn = ui.require('btn').absoluteRect;
    const r = n.absoluteRect;
    expect(r.x + r.width).toBeGreaterThan(btn.x + btn.width); // 右上角超出一點
    expect(r.y).toBeLessThan(btn.y);
    expect(ui.require<UIBadge>('z').visible).toBe(false);
    n.setValue(5);
    expect(n.text).toBe('5');
    const d = ui.require<UIBadge>('d');
    expect([d.visible, d.layout.width, d.text]).toEqual([true, 10, '']);
  });
});

describe('tooltip 浮動說明', () => {
  test('停留一段時間後顯示，移開就消失', async () => {
    const ui = await makeUI(
      '<UI padding="20"><UISlot id="s" iconName="sword" tooltip="傷害 +12" tooltipTitle="鐵劍"/><UILabel id="x">x</UILabel></UI>',
    );
    const r = ui.require('s').absoluteRect;
    ui.handlePointer('move', r.x + 10, r.y + 10);
    run(ui, 0.2);
    expect(ui.paintState.overlays).toHaveLength(0);
    run(ui, 0.4);
    expect(ui.paintState.overlays).toHaveLength(1);
    ui.handlePointer('move', 700, 500);
    expect(ui.paintState.overlays).toHaveLength(0);
    // 按下也會關閉
    ui.handlePointer('move', r.x + 10, r.y + 10);
    run(ui, 1);
    ui.handlePointer('down', r.x + 10, r.y + 10);
    expect(ui.paintState.overlays).toHaveLength(0);
  });

  test('不是互動元件也能有 tooltip', async () => {
    const ui = await makeUI('<UI><UILabel id="l" tooltip="說明">文字</UILabel></UI>');
    expect(ui.require('l').interactive).toBe(true);
  });
});

describe('UIDialogue 對話框', () => {
  test('逐字顯示、點擊直接顯示全部、再點觸發 next', async () => {
    const next = vi.fn();
    const ui = await makeUI(
      '<UI><UIDialogue id="d" speaker="村長" autoplay="true" speed="10" onNext="next">你好勇者</UIDialogue></UI>',
      { next },
    );
    const d = ui.require<UIDialogue>('d');
    expect(d.nameLabel.text).toBe('村長');
    expect(d.typing).toBe(true);
    expect(d.textLabel.revealed).toBe(0);
    run(ui, 0.25);
    expect(d.textLabel.revealed).toBe(2);
    click(ui, d);
    expect(d.typing).toBe(false);
    expect(next).not.toHaveBeenCalled();
    click(ui, d);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('XML 選項與 say()：文字顯示完才出現選項，選了觸發 choose', async () => {
    const chosen: unknown[] = [];
    const ui = await makeUI(
      `
      <UI>
        <UIDialogue id="d" onChoose="pick">要接任務嗎？
          <UIChoice value="yes">好</UIChoice>
          <UIChoice value="no">不要</UIChoice>
        </UIDialogue>
      </UI>`,
      { pick: (e) => chosen.push(e.value) },
    );
    const d = ui.require<UIDialogue>('d');
    expect(d.choices.map((c) => c.value)).toEqual(['yes', 'no']);
    expect(d.choiceBox.visible).toBe(true); // 沒有 autoplay：一開始就完整顯示
    click(ui, d.choiceBox.children[1]);
    expect(chosen).toEqual(['no']);

    d.say('第二句話', { speaker: '旅人', choices: [{ value: 'ok', label: '知道了' }] });
    await Promise.resolve();
    expect(d.nameLabel.text).toBe('旅人');
    expect(d.choiceBox.visible).toBe(false);
    run(ui, 1);
    await Promise.resolve();
    expect(d.choiceBox.visible).toBe(true);
    click(ui, d.choiceBox.children[0]);
    expect(chosen).toEqual(['no', 'ok']);
  });
});

describe('UIJoystick 虛擬搖桿', () => {
  test('拖曳：方向、限制長度、死區；放開歸零', async () => {
    const inputs: { x: number; y: number }[] = [];
    const ui = await makeUI(
      '<UI><UIJoystick id="j" width="100" height="100" deadzone="0.1" onInput="i" onEnd="e"/></UI>',
      {
        i: (e) => inputs.push(e.value as { x: number; y: number }),
      },
    );
    const j = ui.require<UIJoystick>('j');
    const ended = vi.fn();
    j.on('end', ended);
    ui.handlePointer('down', 50, 50); // 中央：在死區內
    expect([j.x, j.y]).toEqual([0, 0]);
    ui.handlePointer('move', 300, 50); // 遠超過右邊
    expect(j.x).toBe(1);
    expect(j.y).toBe(0);
    ui.handlePointer('move', 50, 0); // 往上
    expect(j.x).toBeCloseTo(0);
    expect(j.y).toBeLessThan(-0.9);
    ui.handlePointer('up', 50, 0);
    expect([j.x, j.y]).toEqual([0, 0]);
    expect(inputs.at(-1)).toEqual({ x: 0, y: 0 });
    expect(ended).toHaveBeenCalled();
    expect(j.active).toBe(false);
    // 圓外按下不接管
    ui.handlePointer('down', 99, 99);
    expect(j.active).toBe(false);
  });
});

describe('UIMinimap 小地圖', () => {
  test('座標投影：一般與旋轉模式', async () => {
    const ui = await makeUI('<UI><UIMinimap id="m" width="100" height="100" range="10"/></UI>');
    const m = ui.require<UIMinimap>('m');
    m.setView(5, 5, Math.PI / 2); // 面向東方（+X）
    expect(m.project(10, 5, 5)).toEqual({ px: 25, py: 0 });
    m.set('rotate', 'true');
    // 旋轉模式：面向的方向在上方
    const p = m.project(10, 5, 5);
    expect(p.px).toBeCloseTo(0);
    expect(p.py).toBeCloseTo(-25);
  });

  test('MinimapPlugin：跟著玩家、收集標記', async () => {
    const ui = await makeUI('<UI><UIMinimap id="map"/></UI>');
    const clock = fakeScheduler();
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    const ecs = new EcsPlugin();
    const fakeUi = { name: 'ui2d', ui, install() {} } as unknown as Plugin;
    const world = ecs.world;
    const player = world.spawn(Transform);
    world.get(player, Transform)!.position.set(3, 0, 4);
    world.get(player, Transform)!.rotation.copy(new Quaternion().setFromEuler(new Euler(0, -Math.PI / 2, 0))); // 面向 +X
    const enemy = world.spawn(Transform, MinimapMarker.with({ color: '#f00' }));
    world.get(enemy, Transform)!.position.set(10, 0, -2);
    engine
      .use(ecs)
      .use(new ScenePlugin())
      .use(fakeUi)
      .use(new MinimapPlugin({ minimap: 'map', follow: player, rate: 1000 }));
    engine.start();
    clock.frame(16);
    clock.frame(16);
    const map = ui.require<UIMinimap>('map');
    expect([map.centerX, map.centerZ]).toEqual([3, 4]);
    expect(map.heading).toBeCloseTo(Math.PI / 2);
    expect(map.markers).toEqual([expect.objectContaining({ x: 10, z: -2, color: '#f00' })]);
  });
});

describe('拖曳被中斷時不會卡住', () => {
  const xml = `
    <UI dir="h" gap="10" padding="10">
      <UISlot id="a" iconName="sword" onDragend="end"/>
      <UISlot id="b" onDrop="drop"/>
      <UIButton id="btn" text="關閉" onClick="close"/>
      <UISlider id="s" value="10"/>
    </UI>`;

  test('cancelPointer：物品回到原位、不會放到格子上，跟著滑鼠的圖示消失', async () => {
    const events: string[] = [];
    const ui = await makeUI(xml, {
      drop: () => events.push('drop'),
      end: (e) => events.push(`end:${(e.value as UIElement | null)?.id ?? null}`),
    });
    const a = ui.require<UISlot>('a').absoluteRect;
    const b = ui.require<UISlot>('b').absoluteRect;
    ui.handlePointer('down', a.x + 20, a.y + 20);
    ui.handlePointer('move', b.x + 20, b.y + 20); // 拖到 b 上面
    expect(ui.paintState.overlays).toHaveLength(1);
    ui.cancelPointer(); // 例如視窗失去焦點
    expect(events).toEqual(['end:null']);
    expect(ui.paintState.overlays).toHaveLength(0);
    expect(ui.require<UISlot>('a').dragging).toBe(false);
    expect(ui.require<UISlot>('b').dropTarget).toBe(false);
  });

  test('上一次拖曳沒收到放開：下一次點擊照常有效（不會被吃掉）', async () => {
    const close = vi.fn();
    const ui = await makeUI(xml, { close });
    const a = ui.require<UISlot>('a').absoluteRect;
    ui.handlePointer('down', a.x + 20, a.y + 20);
    ui.handlePointer('move', a.x + 80, a.y + 20);
    // 沒有 up：直接點按鈕
    click(ui, ui.require('btn'));
    expect(close).toHaveBeenCalledTimes(1);
    expect(ui.require<UISlot>('a').dragging).toBe(false);
    expect(ui.paintState.overlays).toHaveLength(0);
    // 滑桿拖到一半被中斷：觸發 change，之後不再跟著滑鼠
    const s = ui.require<UISlider>('s');
    const changes: unknown[] = [];
    s.on('change', (e) => changes.push(e.value));
    const t = s.trackRange();
    ui.handlePointer('down', t.x0 + 2, t.y0);
    ui.handlePointer('move', t.x1, t.y0);
    ui.cancelPointer();
    expect(changes).toEqual([100]);
    ui.handlePointer('move', t.x0, t.y0);
    expect(s.value).toBe(100);
  });
});
