/**
 * 河流圖：d3.stack 把數列疊起來，stackOffsetWiggle 以中線上下擺動；移到色帶上看那一週的數值。
 */
import * as d3 from 'd3';
import { drawTooltip, type UID3Chart } from '@engine/packages/d3-chart';
import { AXIS, FONT, PALETTE } from './theme';

const KEYS = ['動作', '角色扮演', '策略', '休閒', '運動', '獨立'];
const WEEKS = 52;
const rand = d3.randomLcg(21);
/** 幾個高斯「山丘」加起來的數列 */
function bumps(n: number): number[] {
  const a = new Array<number>(n).fill(0.2);
  for (let k = 0; k < 4; k++) {
    const height = 1 / (0.15 + rand());
    const center = rand() * 1.2 - 0.1;
    const sharp = 6 / (0.15 + rand());
    for (let j = 0; j < n; j++) {
      const w = (j / n - center) * sharp;
      a[j] += height * Math.exp(-w * w);
    }
  }
  return a;
}
type Row = Record<string, number>;
const layers = KEYS.map(() => bumps(WEEKS));
const rows: Row[] = d3.range(WEEKS).map((i) => Object.fromEntries(KEYS.map((k, j) => [k, layers[j][i] * 10])));
const series = d3.stack<Row>().keys(KEYS).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut)(rows);

export function setupStream(chart: UID3Chart): void {
  const m = { top: 10, right: 24, bottom: 26, left: 24 };
  chart.draw((ctx, { width, height, pointer, d3Context }) => {
    const x = d3.scaleLinear([0, WEEKS - 1], [m.left, width - m.right]);
    const y = d3.scaleLinear(
      [d3.min(series, (s) => d3.min(s, (d) => d[0]))!, d3.max(series, (s) => d3.max(s, (d) => d[1]))!],
      [height - m.bottom, m.top],
    );
    const i = pointer && pointer.x >= m.left && pointer.x <= width - m.right ? Math.round(x.invert(pointer.x)) : -1;
    const hover =
      i >= 0 && pointer ? (series.find((s) => y(s[i][1]) <= pointer.y && pointer.y <= y(s[i][0])) ?? null) : null;
    const area = d3
      .area<d3.SeriesPoint<Row>>()
      .x((_, j) => x(j))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveBasis)
      .context(d3Context);
    for (const s of series) {
      ctx.beginPath();
      area(s);
      ctx.globalAlpha = hover && s !== hover ? 0.25 : 0.92;
      ctx.fillStyle = PALETTE[s.index];
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 每條色帶在最粗的地方寫名稱
    ctx.font = `bold ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0e110c';
    for (const s of series) {
      const j = d3.maxIndex(s, (d) => d[1] - d[0]);
      if (y(s[j][0]) - y(s[j][1]) <= 16) continue;
      // 名稱不要超出左右兩邊
      const half = ctx.measureText(s.key).width / 2 + 4;
      const lx = Math.min(width - m.right - half, Math.max(m.left + half, x(j)));
      ctx.fillText(s.key, lx, (y(s[j][0]) + y(s[j][1])) / 2);
    }
    // 橫軸：週
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    ctx.fillStyle = AXIS;
    for (const t of [1, 10, 20, 30, 40, 52]) {
      ctx.textAlign = t === 1 ? 'left' : t === 52 ? 'right' : 'center';
      ctx.fillText(`第 ${t} 週`, x(t - 1), height - m.bottom + 8);
    }
    if (i >= 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x(i), m.top);
      ctx.lineTo(x(i), height - m.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (hover && pointer) {
      drawTooltip(
        ctx,
        x(i),
        pointer.y,
        [`第 ${i + 1} 週・${hover.key}`, `${(hover[i][1] - hover[i][0]).toFixed(1)} 萬人`],
        { bounds: { width, height } },
      );
    }
  });
}
