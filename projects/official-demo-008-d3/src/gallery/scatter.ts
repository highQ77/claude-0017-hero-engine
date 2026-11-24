/**
 * 散佈圖：兩軸縮放（zoom="xy"），用 d3.Delaunay 找滑鼠最近的點，畫出它的 Voronoi 格子。
 */
import * as d3 from 'd3';
import { drawTooltip, type UID3Chart } from '@engine/packages/d3-chart';
import { PALETTE, axes, clipBox, inBox } from './theme';

interface Dot {
  x: number;
  y: number;
  g: number;
}
const GROUPS = ['A 組', 'B 組', 'C 組'];
const CENTERS = [
  [28, 35],
  [55, 72],
  [78, 38],
];
const rand = d3.randomLcg(11);
const normal = d3.randomNormal.source(rand)(0, 8);
const dots: Dot[] = d3.range(270).map((i) => ({
  x: CENTERS[i % 3][0] + normal(),
  y: CENTERS[i % 3][1] + normal(),
  g: i % 3,
}));

export function setupScatter(chart: UID3Chart): void {
  const m = { top: 12, right: 14, bottom: 26, left: 38 };
  chart.draw((ctx, { width, height, transform, pointer }) => {
    const box = { x0: m.left, x1: width - m.right, y0: m.top, y1: height - m.bottom };
    const x = transform.rescaleX(d3.scaleLinear([0, 100], [box.x0, box.x1]));
    const y = transform.rescaleY(d3.scaleLinear([0, 100], [box.y1, box.y0]));
    axes(ctx, x, y, box);
    ctx.save();
    clipBox(ctx, box);
    // 每個點一格的 Voronoi 圖：滑鼠落在哪一格，就是離哪個點最近
    const delaunay = d3.Delaunay.from(
      dots,
      (d) => x(d.x),
      (d) => y(d.y),
    );
    const voronoi = delaunay.voronoi([box.x0, box.y0, box.x1, box.y1]);
    ctx.beginPath();
    voronoi.render(ctx);
    ctx.strokeStyle = 'rgba(154, 205, 50, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const near = pointer && inBox(pointer, box) ? delaunay.find(pointer.x, pointer.y) : -1;
    if (near >= 0) {
      ctx.beginPath();
      voronoi.renderCell(near, ctx);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.stroke();
    }
    const r = Math.min(7, 3 * Math.sqrt(transform.k)); // 放大時點也稍微變大
    for (const [i, d] of dots.entries()) {
      ctx.beginPath();
      ctx.arc(x(d.x), y(d.y), i === near ? r + 3 : r, 0, Math.PI * 2);
      ctx.globalAlpha = i === near ? 1 : 0.75;
      ctx.fillStyle = PALETTE[d.g];
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (near >= 0) {
      const d = dots[near];
      drawTooltip(ctx, x(d.x), y(d.y), [GROUPS[d.g], `x ${d.x.toFixed(1)}　y ${d.y.toFixed(1)}`], {
        bounds: { width, height },
      });
    }
  });
}
