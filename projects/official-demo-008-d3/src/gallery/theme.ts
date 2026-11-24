/**
 * 圖庫範例共用的顏色、字型與小工具（格線、裁切、範圍判斷）。
 */
import type * as d3 from 'd3';
import type { ChartDrawFn } from '@engine/packages/d3-chart';

/** 繪圖用的 context（圖表繪圖函式拿到的 ctx） */
export type Ctx = Parameters<ChartDrawFn>[0];
/** 繪圖座標的一點 */
export interface Pt {
  x: number;
  y: number;
}
/** 繪圖區的範圍 */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const FONT = '11px system-ui, sans-serif';
export const AXIS = '#8f9884';
export const GRID = '#232a20';
export const TEXT = '#e9f6d2';
export const PALETTE = ['#3dd6c6', '#7aa2ff', '#ffb35c', '#ff6b8b', '#c79bff', '#9be07a', '#ffd166', '#5ec8ff'];

/** 點是否在範圍內 */
export const inBox = (p: Pt, b: Box): boolean => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;

/** 只畫在範圍內（呼叫前先 ctx.save()，畫完 ctx.restore()） */
export function clipBox(ctx: Ctx, b: Box): void {
  ctx.beginPath();
  ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  ctx.clip();
}

/** 格線與兩軸的刻度（d3-axis 要 SVG，這裡用 scale.ticks() 自己畫） */
export function axes(
  ctx: Ctx,
  x: d3.ScaleLinear<number, number>,
  y: d3.ScaleLinear<number, number>,
  b: Box,
  ticks: [number, number] = [8, 5],
): void {
  ctx.font = FONT;
  ctx.lineWidth = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of x.ticks(ticks[0])) {
    const px = x(t);
    if (px < b.x0 - 0.5 || px > b.x1 + 0.5) continue;
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(px, b.y0);
    ctx.lineTo(px, b.y1);
    ctx.stroke();
    ctx.fillStyle = AXIS;
    ctx.fillText(String(t), px, b.y1 + 6);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of y.ticks(ticks[1])) {
    const py = y(t);
    if (py < b.y0 - 0.5 || py > b.y1 + 0.5) continue;
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(b.x0, py);
    ctx.lineTo(b.x1, py);
    ctx.stroke();
    ctx.fillStyle = AXIS;
    ctx.fillText(String(t), b.x0 - 6, py);
  }
}

/** 角度（d3 的角度：12 點鐘方向為 0、順時針）與半徑 → 座標 */
export const polar = (angle: number, radius: number): [number, number] => [
  Math.sin(angle) * radius,
  -Math.cos(angle) * radius,
];

/** 點相對圓心的 d3 角度（0～2π） */
export function angleOf(dx: number, dy: number): number {
  const a = Math.atan2(dx, -dy);
  return a < 0 ? a + Math.PI * 2 : a;
}
