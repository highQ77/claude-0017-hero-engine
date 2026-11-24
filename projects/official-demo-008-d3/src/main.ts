/**
 * official-demo-008-d3：用 d3.js 在 2D 介面與 3D 看板上畫互動圖表。
 *
 * - d3-chart 套件（@engine/packages/d3-chart，在 engine.ts 安裝）註冊 <UID3Chart>：繼承 UICanvas，負責懸停、縮放、平移、點擊與重畫
 * - 圖表內容用 d3 畫：比例尺（scaleLinear、scaleBand）、形狀（line、area、arc、pie）用 .context(d3Context) 直接畫進畫布
 * - 2D 介面（public/ui/scene.xml）：折線圖（滾輪縮放橫軸、拖曳平移、懸停十字線與提示）、長條圖（懸停、點擊選取）
 * - 3D 看板（public/ui/panel3d.xml，UIPanel3D）：甜甜圈圖，滑鼠在 3D 空間裡一樣可以懸停、點擊
 * - 長條圖和甜甜圈圖選取的是同一個地區：點任何一邊，兩張圖一起更新
 * - 圖庫（src/gallery/）：散佈圖、熱度圖、矩形樹圖、力導向圖、雷達圖、河流圖、弦圖、密度等高線，每個分頁一種
 */
import * as d3 from 'd3';
import { define } from '@engine/ecs';
import { Transform, create, load, previewScene } from '@engine/scene';
import { OrbitControl } from '@engine/render';
import { Vector3 } from '@engine/math';
import { drawTooltip, type UID3Chart } from '@engine/packages/d3-chart';
import type { UILabel, UIStackView } from '@engine/ui2d';
import { UIPanel3D } from '@engine/ui3d';
import { ecs, engine, scenes, ui, ui3d } from './engine';
import { setupChord } from './gallery/chord';
import { setupDensity } from './gallery/density';
import { setupForce } from './gallery/force';
import { setupHeatmap } from './gallery/heatmap';
import { setupRadar } from './gallery/radar';
import { setupScatter } from './gallery/scatter';
import { setupStream } from './gallery/stream';
import { setupTreemap } from './gallery/treemap';

// ───────── 資料 ─────────

const rand = d3.randomLcg(7); // 固定種子：每次的資料一樣
/** 兩條每日數列（隨機漫步） */
interface Day {
  day: number;
  visits: number;
  orders: number;
}
const days: Day[] = [];
{
  let v = 60;
  let o = 25;
  for (let day = 1; day <= 120; day++) {
    v = Math.max(10, v + (rand() - 0.47) * 9 + Math.sin(day / 9) * 2);
    o = Math.max(4, o + (rand() - 0.48) * 5 + Math.sin(day / 7) * 1.2);
    days.push({ day, visits: v, orders: o });
  }
}
/** 各地區的銷售 */
const regions = [
  { name: '北區', value: 42 },
  { name: '中區', value: 31 },
  { name: '南區', value: 27 },
  { name: '東區', value: 12 },
  { name: '離島', value: 6 },
  { name: '海外', value: 18 },
];
const color = d3.scaleOrdinal<string, string>(
  regions.map((r) => r.name),
  ['#3dd6c6', '#7aa2ff', '#ffb35c', '#ff6b8b', '#c79bff', '#9be07a'],
);

/** 目前選取的地區（長條圖、甜甜圈圖共用） */
let picked: string | null = null;
const charts: UID3Chart[] = [];
function pick(name: string | null): void {
  picked = picked === name ? null : name;
  const r = regions.find((x) => x.name === picked);
  ui.get<UILabel>('picked')?.setText(r ? `${r.name}　${r.value} 萬` : '—');
  for (const c of charts) c.redraw();
}

const FONT = '11px system-ui, sans-serif';
const AXIS = '#6c7690';
const GRID = '#232a38';

// ───────── 折線圖：滾輪縮放、拖曳平移、懸停十字線 ─────────

function drawLine(chart: UID3Chart): void {
  const m = { top: 12, right: 14, bottom: 24, left: 40 };
  chart.draw((ctx, { width, height, transform, pointer, d3Context }) => {
    const x0 = d3.scaleLinear([1, 120], [m.left, width - m.right]);
    const x = transform.rescaleX(x0); // 縮放、平移後的比例尺
    const y = d3
      .scaleLinear([0, d3.max(days, (d) => Math.max(d.visits, d.orders))! * 1.1], [height - m.bottom, m.top])
      .nice();
    // 格線與縱軸刻度
    ctx.font = FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of y.ticks(5)) {
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(m.left, y(t));
      ctx.lineTo(width - m.right, y(t));
      ctx.stroke();
      ctx.fillStyle = AXIS;
      ctx.fillText(String(t), m.left - 6, y(t));
    }
    // 橫軸刻度（跟著縮放變密）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of x.ticks(8).filter((t) => t >= 1 && t <= 120 && Number.isInteger(t))) {
      ctx.fillText(`${t}`, x(t), height - m.bottom + 6);
    }
    // 只畫在繪圖區裡（平移出去的部分裁掉）
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.left, m.top, width - m.left - m.right, height - m.top - m.bottom);
    ctx.clip();
    // 訪客：面積 + 線
    ctx.beginPath();
    d3
      .area<Day>()
      .x((d) => x(d.day))
      .y0(y(0))
      .y1((d) => y(d.visits))
      .curve(d3.curveMonotoneX)
      .context(d3Context)(days);
    ctx.fillStyle = 'rgba(61, 214, 198, 0.15)';
    ctx.fill();
    for (const [key, stroke] of [
      ['visits', '#3dd6c6'],
      ['orders', '#ffb35c'],
    ] as const) {
      ctx.beginPath();
      d3
        .line<Day>()
        .x((d) => x(d.day))
        .y((d) => y(d[key]))
        .curve(d3.curveMonotoneX)
        .context(d3Context)(days);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // 懸停：最近的一天，十字線、資料點、提示
    if (pointer && pointer.x >= m.left && pointer.x <= width - m.right) {
      const day = Math.round(Math.min(120, Math.max(1, x.invert(pointer.x))));
      const d = days[day - 1];
      ctx.strokeStyle = '#8f9bbd';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x(day), m.top);
      ctx.lineTo(x(day), height - m.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [v, c] of [
        [d.visits, '#3dd6c6'],
        [d.orders, '#ffb35c'],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x(day), y(v), 4, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
      }
      ctx.restore();
      drawTooltip(
        ctx,
        x(day),
        y(d.visits),
        [`第 ${day} 天`, `訪客　${d.visits.toFixed(0)}`, `訂單　${d.orders.toFixed(0)}`],
        { bounds: { width, height } },
      );
    } else ctx.restore();
  });
  // 縮放時更新顯示範圍
  chart.on('zoom', () => {
    const x = chart.transform.rescaleX(d3.scaleLinear([1, 120], [40, chart.width - 14]));
    const [a, b] = x.domain().map((v) => Math.round(Math.min(120, Math.max(1, v))));
    ui.get<UILabel>('range')?.setText(`第 ${a}～${b} 天`);
    ui.get<UILabel>('zoomK')?.setText(`${chart.transform.k.toFixed(1)}×`);
  });
}

// ───────── 長條圖：懸停高亮、點擊選取 ─────────

function drawBars(chart: UID3Chart): void {
  const m = { top: 14, right: 14, bottom: 22, left: 40 };
  /** 滑鼠下的長條 */
  const barAt = (p: { x: number; y: number } | null, x: d3.ScaleBand<string>) =>
    p ? (regions.find((r) => p.x >= x(r.name)! && p.x <= x(r.name)! + x.bandwidth()) ?? null) : null;
  const scales = (width: number, height: number) => ({
    x: d3
      .scaleBand(
        regions.map((r) => r.name),
        [m.left, width - m.right],
      )
      .padding(0.25),
    y: d3.scaleLinear([0, d3.max(regions, (r) => r.value)! * 1.15], [height - m.bottom, m.top]),
  });
  chart.draw((ctx, { width, height, pointer }) => {
    const { x, y } = scales(width, height);
    const hover = barAt(pointer, x);
    ctx.font = FONT;
    ctx.textAlign = 'center';
    for (const r of regions) {
      const dim = picked !== null && picked !== r.name;
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.fillStyle = color(r.name);
      ctx.beginPath();
      ctx.roundRect(x(r.name)!, y(r.value), x.bandwidth(), y(0) - y(r.value), [4, 4, 0, 0]);
      ctx.fill();
      if (r === hover || r.name === picked) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e8ecf4';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${r.value}`, x(r.name)! + x.bandwidth() / 2, y(r.value) - 3);
      ctx.fillStyle = AXIS;
      ctx.textBaseline = 'top';
      ctx.fillText(r.name, x(r.name)! + x.bandwidth() / 2, height - m.bottom + 5);
    }
    if (hover && pointer)
      drawTooltip(ctx, pointer.x, pointer.y, [`${hover.name}`, `${hover.value} 萬（點擊選取）`], {
        bounds: { width, height },
      });
  });
  chart.on('chartclick', (e) => {
    const p = e.value as { x: number; y: number };
    const bar = barAt(p, scales(chart.width, chart.height).x);
    pick(bar ? bar.name : null);
  });
}

// ───────── 甜甜圈圖（3D 看板）：懸停放大扇形、點擊選取 ─────────

function drawDonut(chart: UID3Chart): void {
  const pie = d3
    .pie<(typeof regions)[number]>()
    .value((r) => r.value)
    .sort(null)
    .padAngle(0.02);
  const arcs = pie(regions);
  const total = d3.sum(regions, (r) => r.value);
  /** 滑鼠下的扇形 */
  const sliceAt = (p: { x: number; y: number } | null, cx: number, cy: number, r0: number, r1: number) => {
    if (!p) return null;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < r0 || dist > r1 + 10) return null;
    // d3 的角度從 12 點鐘方向順時針
    let a = Math.atan2(dx, -dy);
    if (a < 0) a += Math.PI * 2;
    return arcs.find((s) => a >= s.startAngle && a <= s.endAngle) ?? null;
  };
  const geometry = (width: number, height: number) => {
    const r1 = Math.min(width, height) / 2 - 18;
    return { cx: width / 2, cy: height / 2, r0: r1 * 0.58, r1 };
  };
  chart.draw((ctx, { width, height, pointer, d3Context }) => {
    const { cx, cy, r0, r1 } = geometry(width, height);
    const hover = sliceAt(pointer, cx, cy, r0, r1);
    ctx.save();
    ctx.translate(cx, cy);
    for (const s of arcs) {
      const active = s === hover || s.data.name === picked;
      const dim = picked !== null && s.data.name !== picked && s !== hover;
      ctx.beginPath();
      d3
        .arc<d3.PieArcDatum<(typeof regions)[number]>>()
        .innerRadius(r0)
        .outerRadius(active ? r1 + 10 : r1)
        .cornerRadius(4)
        .context(d3Context)(s);
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.fillStyle = color(s.data.name);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // 中間的說明：懸停或選取的地區，否則是總數
    const focus = hover?.data ?? regions.find((r) => r.name === picked) ?? null;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8ecf4';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(focus ? focus.name : '總計', 0, -12);
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillStyle = '#8f9bbd';
    ctx.fillText(focus ? `${focus.value} 萬・${((focus.value / total) * 100).toFixed(0)}%` : `${total} 萬`, 0, 14);
    ctx.restore();
  });
  chart.on('chartclick', (e) => {
    const { cx, cy, r0, r1 } = geometry(chart.width, chart.height);
    const s = sliceAt(e.value as { x: number; y: number }, cx, cy, r0, r1);
    pick(s ? s.data.name : null);
  });
}

// ───────── 場景 ─────────

/** 3D 看板載入完成後，取得裡面的圖表、設定繪圖函式（只做一次） */
const DonutPanel = define.tag('DonutPanel');
ecs.each('donut-panel', [UIPanel3D, DonutPanel], (e, panel) => {
  if (panel.status !== 'ready') return;
  const chart = ui3d.uiOf(e)?.get<UID3Chart>('donut');
  if (!chart) return;
  charts.push(chart);
  drawDonut(chart);
  ecs.world.remove(e, DonutPanel);
});

// ───────── 套件分頁：最小範例（和介面上顯示的程式一樣） ─────────

function drawMini(chart: UID3Chart): void {
  const data = [4, 8, 15, 16, 23, 42];
  chart.draw((ctx, { width, height, pointer }) => {
    const x = d3.scaleBand(d3.range(6), [0, width]).padding(0.2);
    const y = d3.scaleLinear([0, 42], [height, 0]);
    data.forEach((v, i) => {
      const over = pointer && pointer.x >= x(i)! && pointer.x < x(i)! + x.bandwidth();
      ctx.fillStyle = over ? '#ffd166' : '#9acd32';
      ctx.fillRect(x(i)!, y(v), x.bandwidth(), height - y(v));
    });
  });
}

// ───────── 分頁：右邊跟著換範例；3D 看板只在「3D 看板」分頁出現 ─────────

const BOARD_TAB = 2;
const FORCE_TAB = 7;
let activeTab = 0;
/** 力導向圖（分頁顯示時每一幀算一步） */
let force: ReturnType<typeof setupForce> | null = null;
ecs.addSystem({ name: 'force-graph', run: () => activeTab === FORCE_TAB && force?.step() });
/** 看板的大小（0～1，平滑變化） */
let boardScale = 0;
let boardTarget = 0;
const Board = define.tag('Board');
ecs.each('board-scale', [Transform, UIPanel3D, Board], (_e, t, panel, _board, time) => {
  boardScale += (boardTarget - boardScale) * Math.min(1, time.delta * 10);
  t.scale.setScalar(Math.max(0.001, boardScale));
  panel.interactive = boardTarget === 1; // 隱藏時不接收滑鼠
});

ui.setHandlers({
  tab: (e) => {
    const index = e.value as number;
    ui.get<UIStackView>('stage')?.show(index);
    activeTab = index;
    if (index === FORCE_TAB) force?.reheat();
    boardTarget = index === BOARD_TAB ? 1 : 0;
  },
  resetZoom: () => ui.get<UID3Chart>('line')?.resetZoom(),
  clearPick: () => picked !== null && pick(picked),
});

scenes.register(
  create.sceneFromFile('main', await load.sceneFile('scenes/main.xml'), {
    setup(world, spawned) {
      // 2D 介面的圖表（場景的介面載入後）
      const line = ui.get<UID3Chart>('line');
      const bars = ui.get<UID3Chart>('bars');
      if (line) drawLine(line);
      if (bars) {
        charts.push(bars);
        drawBars(bars);
      }
      const mini = ui.get<UID3Chart>('mini');
      if (mini) drawMini(mini);
      // 圖庫：每個分頁一種圖（src/gallery/）
      const gallery = {
        scatter: setupScatter,
        heat: setupHeatmap,
        tree: setupTreemap,
        radar: setupRadar,
        stream: setupStream,
        chord: setupChord,
        density: setupDensity,
      };
      for (const [id, setup] of Object.entries(gallery)) {
        const chart = ui.get<UID3Chart>(id);
        if (chart) setup(chart);
      }
      const forceChart = ui.get<UID3Chart>('force');
      if (forceChart) force = setupForce(forceChart);
      // 3D 看板：立在地板右邊，稍微轉向攝影機
      world.spawn(
        Transform.at(2.6, 1.35, 0),
        UIPanel3D.with({ src: 'ui/panel3d.xml', worldWidth: 2.0 }),
        DonutPanel,
        Board,
      );
      const t = world.require(world.query([UIPanel3D]).entities.at(-1)!, Transform);
      t.rotation.setFromAxisAngle(new Vector3(0, 1, 0), -0.35);
      // 拖曳空白處轉動視角（在圖表上拖曳是平移圖表）
      spawned.add('camera', OrbitControl, { target: new Vector3(1.4, 1.2, 0), minDistance: 2.5, maxDistance: 12 });
    },
  }),
);
// 3D 場景編輯器的「預覽」會指定正在編輯的場景；平常進入 main
scenes.load(previewScene() ?? 'main');

engine.start();
