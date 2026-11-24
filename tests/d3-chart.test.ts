import { afterEach, describe, expect, test } from 'vitest';
import { zoomIdentity, type ZoomTransform } from 'd3-zoom';
import { Engine } from '../src/core';
import { PluginManager } from '../src/plugins';
import * as ui2d from '../src/ui2d';
import { UI2D, measure } from '../src/ui2d';
import d3Chart, { type UID3Chart } from '../src/packages/d3-chart';
import { fakeScheduler } from './helpers';

let plugins: PluginManager | null = null;
afterEach(async () => {
  await plugins?.uninstall('d3-chart');
  plugins = null;
});

/** 安裝套件，建立有一個圖表的介面（圖表在 (10, 10)，200×100） */
async function setup(attrs = 'zoom="x"') {
  const engine = new Engine({ scheduler: fakeScheduler().scheduler, pauseOnHidden: false });
  plugins = new PluginManager(engine, { api: { ui2d } });
  await plugins.install(d3Chart);
  const ui = await UI2D.create({
    container: null,
    width: 800,
    height: 600,
    measure: measure.fixed(0.5),
    autoTick: false,
  });
  ui.loadString(`<UI padding="10"><UID3Chart id="c" width="200" height="100" ${attrs}/></UI>`);
  return { ui, chart: ui.require<UID3Chart>('c') };
}

describe('d3 圖表套件（UID3Chart）', () => {
  test('安裝後 XML 可以用 <UID3Chart>（繼承 UICanvas），移除套件後不能再用', async () => {
    const { chart } = await setup();
    expect(chart).toBeInstanceOf(ui2d.UICanvas);
    expect(chart.transform.k).toBe(1);
    await plugins!.uninstall('d3-chart');
    plugins = null;
    const ui = await UI2D.create({
      container: null,
      width: 100,
      height: 100,
      measure: measure.fixed(0.5),
      autoTick: false,
    });
    expect(() => ui.loadString('<UI><UID3Chart id="c"/></UI>')).toThrow(/不認識的元件 <UID3Chart>/);
  });

  test('懸停：pointer 是滑鼠的繪圖座標，離開畫布後是 null', async () => {
    const { ui, chart } = await setup();
    ui.handlePointer('move', 10 + 50, 10 + 20);
    expect(chart.pointer).toEqual({ x: 50, y: 20 });
    ui.handlePointer('leave', 0, 0);
    expect(chart.pointer).toBeNull();
  });

  test('滾輪縮放：以滑鼠位置為中心；zoom="x" 時縱向不平移；觸發 zoom 事件', async () => {
    const { ui, chart } = await setup('zoom="x" maxZoom="8"');
    const events: ZoomTransform[] = [];
    chart.on('zoom', (e) => events.push(e.value as ZoomTransform));
    expect(ui.handleWheel(0, -300, 10 + 50, 10 + 40)).toBe(true); // 往上捲：放大
    const t = chart.transform;
    expect(t.k).toBeGreaterThan(1);
    expect(t.y).toBe(0);
    expect(t.applyX(t.invertX(50))).toBeCloseTo(50); // 滑鼠下的點縮放前後在同一個位置
    expect(t.invertX(50)).toBeCloseTo(50);
    expect(events.at(-1)).toBe(t);
    // 縮放倍率有上限
    for (let i = 0; i < 20; i++) ui.handleWheel(0, -500, 60, 50);
    expect(chart.transform.k).toBe(8);
  });

  test('拖曳平移：移動超過一點點才算拖曳；不能拖到露出空白；沒移動的按下→放開是 chartclick', async () => {
    const { ui, chart } = await setup('zoom="xy"');
    chart.setTransform(zoomIdentity.scale(2)); // 內容 400×200，可以往左上拖
    ui.handlePointer('down', 10 + 100, 10 + 50);
    ui.handlePointer('move', 10 + 60, 10 + 30);
    ui.handlePointer('up', 10 + 60, 10 + 30);
    expect([chart.transform.x, chart.transform.y]).toEqual([-40, -20]);
    // 往右下拖：x、y 不能大於 0（不露出左上的空白）
    ui.handlePointer('down', 10 + 50, 10 + 50);
    ui.handlePointer('move', 10 + 190, 10 + 95);
    ui.handlePointer('up', 10 + 190, 10 + 95);
    expect([chart.transform.x, chart.transform.y]).toEqual([0, 0]);
    // 點擊
    const clicks: unknown[] = [];
    chart.on('chartclick', (e) => clicks.push(e.value));
    ui.handlePointer('down', 10 + 30, 10 + 30);
    ui.handlePointer('move', 10 + 31, 10 + 31);
    ui.handlePointer('up', 10 + 31, 10 + 31);
    expect(clicks).toEqual([{ x: 31, y: 31 }]);
    chart.resetZoom();
    expect(chart.transform.k).toBe(1);
  });

  test('zoom="none"（預設）：不縮放，滾輪交還給外層（有人收聽 wheel 時才攔截）', async () => {
    const { ui, chart } = await setup('');
    expect(ui.handleWheel(0, -300, 60, 50)).toBe(true); // 在畫布上（UI 沒有可捲動的列表：照舊回傳 true）
    expect(chart.transform.k).toBe(1);
    let n = 0;
    chart.on('wheel', () => n++);
    ui.handleWheel(0, -300, 60, 50);
    expect(n).toBe(1);
  });
});
