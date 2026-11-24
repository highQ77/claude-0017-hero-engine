/**
 * 熱度圖：一週 7 天 × 24 小時的活躍度，連續色階（scaleSequential）與漸層圖例。
 */
import * as d3 from 'd3';
import { drawTooltip, type UID3Chart } from '@engine/packages/d3-chart';
import { AXIS, FONT, TEXT, type Pt } from './theme';

const DAYS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const rand = d3.randomLcg(5);
/** grid[天][小時] = 0～100 */
const grid = DAYS.map((_, d) =>
  d3.range(24).map((h) => {
    const weekend = d >= 5;
    const evening = Math.exp(-((h - (weekend ? 15 : 21)) ** 2) / (weekend ? 30 : 8));
    const lunch = weekend ? 0 : Math.exp(-((h - 12.5) ** 2) / 2) * 0.45;
    const base = h < 7 ? 0.04 : 0.15;
    return Math.round(100 * Math.min(1, base + evening * 0.8 + lunch + rand() * 0.12));
  }),
);

export function setupHeatmap(chart: UID3Chart): void {
  const m = { top: 8, right: 14, bottom: 64, left: 46 };
  const color = d3.scaleSequential([0, 100], d3.interpolateViridis);
  /** 滑鼠下的格子 */
  const cellAt = (p: Pt | null, width: number, height: number) => {
    if (!p) return null;
    const h = Math.floor((p.x - m.left) / ((width - m.left - m.right) / 24));
    const d = Math.floor((p.y - m.top) / ((height - m.top - m.bottom) / 7));
    return h >= 0 && h < 24 && d >= 0 && d < 7 ? { d, h } : null;
  };
  chart.draw((ctx, { width, height, pointer }) => {
    const cw = (width - m.left - m.right) / 24;
    const ch = (height - m.top - m.bottom) / 7;
    const hover = cellAt(pointer, width, height);
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        ctx.beginPath();
        ctx.roundRect(m.left + h * cw + 1, m.top + d * ch + 1, cw - 2, ch - 2, 3);
        ctx.fillStyle = color(grid[d][h]);
        ctx.fill();
      }
    }
    // 標籤：滑鼠所在的那一天、那一小時亮起來
    ctx.font = FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const [d, name] of DAYS.entries()) {
      ctx.fillStyle = hover?.d === d ? TEXT : AXIS;
      ctx.fillText(name, m.left - 8, m.top + (d + 0.5) * ch);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let h = 0; h < 24; h++) {
      if (h % 3 !== 0 && hover?.h !== h) continue;
      ctx.fillStyle = hover?.h === h ? TEXT : AXIS;
      ctx.fillText(`${h}`, m.left + (h + 0.5) * cw, m.top + 7 * ch + 6);
    }
    // 漸層圖例
    const lx = m.left;
    const ly = height - 24;
    const lw = 220;
    const gradient = ctx.createLinearGradient(lx, 0, lx + lw, 0);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) gradient.addColorStop(t, color(t * 100));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(lx, ly, lw, 10, 5);
    ctx.fill();
    ctx.fillStyle = AXIS;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('少', lx - 6, ly + 5);
    ctx.textAlign = 'left';
    ctx.fillText('多　活躍指數（0～100）・橫軸是幾點', lx + lw + 6, ly + 5);
    if (hover) {
      const cx = m.left + hover.h * cw;
      const cy = m.top + hover.d * ch;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(cx + 1, cy + 1, cw - 2, ch - 2, 3);
      ctx.stroke();
      drawTooltip(
        ctx,
        cx + cw / 2,
        cy + ch / 2,
        [`${DAYS[hover.d]} ${hover.h}:00～${hover.h + 1}:00`, `活躍指數 ${grid[hover.d][hover.h]}`],
        { bounds: { width, height } },
      );
    }
  });
}
