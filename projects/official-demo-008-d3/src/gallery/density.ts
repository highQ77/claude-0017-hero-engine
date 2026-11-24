/**
 * 密度等高線：d3.contourDensity 算出等高線，d3.geoPath（不投影）畫進畫布。
 * 滾輪調整頻寬（平滑程度），點一下顯示原始資料點。
 */
import * as d3 from 'd3';
import { drawTooltip, type UID3Chart } from '@engine/packages/d3-chart';
import { FONT, TEXT } from './theme';

type P = [number, number];
const rand = d3.randomLcg(8);
const normal = d3.randomNormal.source(rand)(0, 1);
/** 玩家位置（0～100 的地圖座標）：兩個熱點加一些散落的人 */
const points: P[] = [
  ...d3.range(520).map((): P => [34 + normal() * 9, 60 + normal() * 12]),
  ...d3.range(380).map((): P => [70 + normal() * 7, 33 + normal() * 7]),
  ...d3.range(160).map((): P => [rand() * 100, rand() * 100]),
];

export function setupDensity(chart: UID3Chart): void {
  let bandwidth = 20;
  let showPoints = false;
  // 等高線的計算比較花時間：大小與頻寬沒變就重用（懸停時只重畫）
  let cacheKey = '';
  let contours: d3.ContourMultiPolygon[] = [];
  const contains = (c: d3.ContourMultiPolygon, p: P) =>
    c.coordinates.some(
      (poly) =>
        d3.polygonContains(poly[0] as P[], p) && !poly.slice(1).some((hole) => d3.polygonContains(hole as P[], p)),
    );

  chart.draw((ctx, { width, height, pointer, d3Context }) => {
    const x = d3.scaleLinear([0, 100], [0, width]);
    const y = d3.scaleLinear([0, 100], [height, 0]);
    const key = `${width}x${height}x${bandwidth}`;
    if (key !== cacheKey) {
      cacheKey = key;
      contours = d3
        .contourDensity<P>()
        .x((d) => x(d[0]))
        .y((d) => y(d[1]))
        .size([width, height])
        .bandwidth(bandwidth)
        .thresholds(14)(points);
    }
    const color = d3.scaleSequential([0, d3.max(contours, (c) => c.value) ?? 1], (t) =>
      d3.interpolateMagma(0.15 + t * 0.8),
    );
    const path = d3.geoPath(null, d3Context);
    const p: P | null = pointer ? [pointer.x, pointer.y] : null;
    let level = -1;
    if (p) for (let i = contours.length - 1; i >= 0 && level < 0; i--) if (contains(contours[i], p)) level = i;
    for (const [i, c] of contours.entries()) {
      ctx.beginPath();
      path(c);
      ctx.fillStyle = color(c.value);
      ctx.fill();
      ctx.strokeStyle = i === level ? '#ffffff' : 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = i === level ? 2 : 1;
      ctx.stroke();
    }
    if (showPoints) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      for (const [px, py] of points) ctx.fillRect(x(px) - 1, y(py) - 1, 2, 2);
    }
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = TEXT;
    ctx.fillText(`頻寬 ${bandwidth}（滾輪調整）・${points.length} 個點・${contours.length} 層等高線`, 10, 10);
    if (level >= 0 && pointer) {
      drawTooltip(
        ctx,
        pointer.x,
        pointer.y,
        [`第 ${level + 1}／${contours.length} 層`, `密度 ${(contours[level].value * 1e4).toFixed(2)}`],
        {
          bounds: { width, height },
        },
      );
    }
  });
  chart.on('wheel', (e) => {
    const { dy } = e.value as { dy: number };
    bandwidth = Math.min(60, Math.max(6, bandwidth + Math.sign(dy) * 2));
    chart.redraw();
  });
  chart.on('chartclick', () => {
    showPoints = !showPoints;
    chart.redraw();
  });
}
