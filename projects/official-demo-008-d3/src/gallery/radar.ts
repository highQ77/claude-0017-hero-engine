/**
 * 雷達圖：d3.lineRadial 畫閉合多邊形；移到多邊形上看數值，點左上的圖例隱藏或顯示角色。
 */
import * as d3 from 'd3';
import { drawTooltip, type UID3Chart } from '@engine/packages/d3-chart';
import { AXIS, FONT, GRID, PALETTE, TEXT, polar, type Pt } from './theme';

const AXES = ['攻擊', '防禦', '速度', '魔力', '體力', '技巧'];
const HEROES = [
  { name: '劍士', values: [85, 72, 55, 20, 82, 60], color: PALETTE[2] },
  { name: '法師', values: [40, 30, 50, 96, 42, 76], color: PALETTE[4] },
  { name: '盜賊', values: [64, 36, 95, 30, 52, 90], color: PALETTE[0] },
];

export function setupRadar(chart: UID3Chart): void {
  const hidden = new Set<string>();
  const angle = (i: number) => (i / AXES.length) * Math.PI * 2;
  const geometry = (width: number, height: number) => {
    const R = Math.min(width, height) / 2 - 44;
    return { cx: width / 2 + 40, cy: height / 2 + 4, r: d3.scaleLinear([0, 100], [0, R]) };
  };
  /** 圖例第幾列（左上，每列 22 px） */
  const legendAt = (p: Pt) =>
    p.x < 110 && p.y >= 10 && p.y < 10 + HEROES.length * 22 ? Math.floor((p.y - 10) / 22) : -1;

  chart.draw((ctx, { width, height, pointer, d3Context }) => {
    const { cx, cy, r } = geometry(width, height);
    const shape = (values: number[]) =>
      d3
        .lineRadial<number>()
        .angle((_, i) => angle(i))
        .radius((v) => r(v))
        .curve(d3.curveLinearClosed)
        .context(d3Context)(values);
    // 滑鼠下的角色：包含滑鼠的多邊形裡面積最小的那個
    const visible = HEROES.filter((h) => !hidden.has(h.name));
    const hover = pointer
      ? (d3.least(
          visible.filter((h) =>
            d3.polygonContains(
              h.values.map((v, i) => polar(angle(i), r(v))),
              [pointer.x - cx, pointer.y - cy],
            ),
          ),
          (h) => Math.abs(d3.polygonArea(h.values.map((v, i) => polar(angle(i), r(v))))),
        ) ?? null)
      : null;
    ctx.save();
    ctx.translate(cx, cy);
    // 網格：同心多邊形與放射線
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (const v of [20, 40, 60, 80, 100]) {
      ctx.beginPath();
      shape(AXES.map(() => v));
      ctx.stroke();
    }
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [i, name] of AXES.entries()) {
      const [x, y] = polar(angle(i), r(100));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(x, y);
      ctx.stroke();
      const [lx, ly] = polar(angle(i), r(100) + 18);
      ctx.fillStyle = TEXT;
      ctx.fillText(name, lx, ly);
    }
    ctx.fillStyle = AXIS;
    for (const v of [50, 100]) ctx.fillText(String(v), 0, -r(v) + 8);
    // 角色
    for (const h of visible) {
      const dim = hover !== null && h !== hover;
      ctx.beginPath();
      shape(h.values);
      ctx.globalAlpha = dim ? 0.08 : h === hover ? 0.35 : 0.18;
      ctx.fillStyle = h.color;
      ctx.fill();
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.strokeStyle = h.color;
      ctx.lineWidth = h === hover ? 3 : 2;
      ctx.stroke();
      for (const [i, v] of h.values.entries()) {
        const [x, y] = polar(angle(i), r(v));
        ctx.beginPath();
        ctx.arc(x, y, h === hover ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = h.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // 圖例（點一下隱藏／顯示）
    ctx.textAlign = 'left';
    for (const [i, h] of HEROES.entries()) {
      const y = 10 + i * 22;
      const off = hidden.has(h.name);
      ctx.beginPath();
      ctx.roundRect(12, y + 4, 12, 12, 3);
      if (off) {
        ctx.strokeStyle = h.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = h.color;
        ctx.fill();
      }
      ctx.fillStyle = off ? AXIS : TEXT;
      ctx.fillText(off ? `${h.name}（已隱藏）` : h.name, 30, y + 10);
    }
    if (hover && pointer) {
      const v = hover.values;
      drawTooltip(
        ctx,
        pointer.x,
        pointer.y,
        [
          hover.name,
          AXES.slice(0, 3)
            .map((a, i) => `${a} ${v[i]}`)
            .join('　'),
          AXES.slice(3)
            .map((a, i) => `${a} ${v[i + 3]}`)
            .join('　'),
        ],
        { bounds: { width, height } },
      );
    }
  });
  chart.on('chartclick', (e) => {
    const row = legendAt(e.value as Pt);
    if (row < 0 || row >= HEROES.length) return;
    const name = HEROES[row].name;
    if (hidden.has(name)) hidden.delete(name);
    else hidden.add(name);
    chart.redraw();
  });
}
