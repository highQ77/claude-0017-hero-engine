# packages/d3-chart 的範例

## default
d3 圖表套件：註冊 `<UID3Chart>` 元件（繼承 UICanvas），懸停、滾輪縮放、拖曳平移、點擊都包好，內容用 d3 畫。要在介面載入之前安裝。

```ts
import * as d3 from 'd3';
import d3Chart, { type UID3Chart } from '@engine/packages/d3-chart';

await new PluginManager(engine, { api: engineApi }).install(d3Chart);
ui.loadString(`<UI align="center" justify="center"><UID3Chart id="c" width="360" height="200" radius="8"/></UI>`);
const data = [12, 30, 22, 41, 18];
ui.require<UID3Chart>('c').draw((ctx, { width, height }) => {
  const x = d3.scaleBand(d3.range(data.length), [20, width - 20]).padding(0.3);
  const y = d3.scaleLinear([0, 45], [height - 20, 10]);
  ctx.fillStyle = '#3dd6c6';
  data.forEach((v, i) => ctx.fillRect(x(i)!, y(v), x.bandwidth(), y(0) - y(v)));
});
engine.start();
```

## createD3ChartClass
用指定的 UICanvas 類別做出圖表元件類別（套件內部用 `ctx.api.ui2d.UICanvas` 呼叫）。自己註冊成別的標籤名稱時用。

```ts
import { createD3ChartClass } from '@engine/packages/d3-chart';

const plugins = new PluginManager(engine, { api: engineApi });
await plugins.install(
  define.plugin({
    name: 'my-chart',
    version: '1.0.0',
    setup(ctx) {
      ctx.registerUIComponent('MyChart', createD3ChartClass(ctx.api.ui2d.UICanvas));
    },
  }),
);
ui.loadString(`<UI align="center" justify="center"><MyChart id="c" width="200" height="120"/></UI>`);
console.log('MyChart 是畫布：', ui.get('c') instanceof engineApi.ui2d.UICanvas);
engine.start();
```

## UID3Chart
圖表元件：`draw(fn)` 設定繪圖函式、`redraw()` 資料改了重畫、`transform` 目前的縮放、`pointer` 滑鼠位置、`resetZoom()` 回到原狀。事件：`zoom`、`chartclick`。

```ts
import * as d3 from 'd3';
import d3Chart, { type UID3Chart } from '@engine/packages/d3-chart';

await new PluginManager(engine, { api: engineApi }).install(d3Chart);
ui.loadString(`<UI align="center" justify="center"><UID3Chart id="c" width="360" height="200" zoom="xy"/></UI>`);
const chart = ui.require<UID3Chart>('c');
const points = d3.range(60).map(() => ({ x: Math.random() * 100, y: Math.random() * 100 }));
chart.draw((ctx, { width, height, transform }) => {
  const x = transform.rescaleX(d3.scaleLinear([0, 100], [10, width - 10]));
  const y = transform.rescaleY(d3.scaleLinear([0, 100], [height - 10, 10]));
  ctx.fillStyle = '#ffb35c';
  for (const p of points) ctx.fillRect(x(p.x) - 2, y(p.y) - 2, 4, 4);
});
chart.on('zoom', () => console.log('縮放倍率', chart.transform.k.toFixed(2)));
chart.on('chartclick', (e) => {
  points.push({ x: Math.random() * 100, y: Math.random() * 100 });
  chart.redraw(); // 資料改了：重畫
  console.log('點擊位置', e.value);
});
engine.start();
```

## ChartInfo
繪圖函式拿到的資訊：繪圖區大小、縮放（d3 的 ZoomTransform）、滑鼠位置（沒有時是 null）、是否正在拖曳，以及給 d3 `.context()` 用的 `d3Context`。

```ts
import * as d3 from 'd3';
import d3Chart, { type ChartInfo, type UID3Chart } from '@engine/packages/d3-chart';

await new PluginManager(engine, { api: engineApi }).install(d3Chart);
ui.loadString(`<UI align="center" justify="center"><UID3Chart id="c" width="360" height="200"/></UI>`);
ui.require<UID3Chart>('c').draw((ctx, info: ChartInfo) => {
  const { width, height, pointer, d3Context } = info;
  ctx.beginPath();
  d3.line().context(d3Context)(d3.range(0, width, 8).map((x) => [x, height / 2 + Math.sin(x / 20) * 50]));
  ctx.strokeStyle = info.dragging ? '#ff6b8b' : '#7aa2ff';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (pointer) ctx.fillText(`(${pointer.x.toFixed(0)}, ${pointer.y.toFixed(0)})`, pointer.x + 8, pointer.y - 8);
});
engine.start();
```

## ChartDrawFn
繪圖函式的型別：`(ctx, info) => void`。懸停、縮放、尺寸改變時自動呼叫。可以先寫成獨立函式，再交給 `draw`。

```ts
import d3Chart, { type ChartDrawFn, type UID3Chart } from '@engine/packages/d3-chart';

await new PluginManager(engine, { api: engineApi }).install(d3Chart);
ui.loadString(`<UI align="center" justify="center"><UID3Chart id="c" width="300" height="160"/></UI>`);
const crosshair: ChartDrawFn = (ctx, { width, height, pointer }) => {
  if (!pointer) return;
  ctx.strokeStyle = '#8f9bbd';
  ctx.beginPath();
  ctx.moveTo(pointer.x, 0);
  ctx.lineTo(pointer.x, height);
  ctx.moveTo(0, pointer.y);
  ctx.lineTo(width, pointer.y);
  ctx.stroke();
};
ui.require<UID3Chart>('c').draw(crosshair);
engine.start();
```

## ChartZoom
`zoom` 屬性：`"none"`（預設，不縮放，滾輪交給外層）、`"x"`（只縮放橫軸，時間序列常用）、`"y"`、`"xy"`。倍率範圍用 `minZoom`、`maxZoom`。

```ts
import d3Chart, { type ChartZoom, type UID3Chart } from '@engine/packages/d3-chart';

await new PluginManager(engine, { api: engineApi }).install(d3Chart);
const mode: ChartZoom = 'x';
ui.loadString(`<UI align="center" justify="center">
  <UID3Chart id="c" width="320" height="160" zoom="${mode}" minZoom="1" maxZoom="6"/>
</UI>`);
const chart = ui.require<UID3Chart>('c');
chart.draw((ctx, { width, height, transform }) => {
  ctx.fillStyle = '#3dd6c6';
  for (let i = 0; i < 20; i++) ctx.fillRect(transform.applyX(i * (width / 20)), height / 3, 4, height / 3);
});
chart.on('zoom', () => console.log('倍率', chart.transform.k.toFixed(2)));
engine.start();
```

## drawTooltip
畫提示框：在 (x, y) 旁邊畫圓角框和幾行文字，`bounds` 給繪圖區大小時不會超出畫布。

```ts
import d3Chart, { drawTooltip, type UID3Chart } from '@engine/packages/d3-chart';

await new PluginManager(engine, { api: engineApi }).install(d3Chart);
ui.loadString(`<UI align="center" justify="center"><UID3Chart id="c" width="320" height="180"/></UI>`);
ui.require<UID3Chart>('c').draw((ctx, { width, height, pointer }) => {
  if (!pointer) return;
  drawTooltip(ctx, pointer.x, pointer.y, ['滑鼠位置', `x ${pointer.x.toFixed(0)}　y ${pointer.y.toFixed(0)}`], {
    bounds: { width, height },
  });
});
engine.start();
```
