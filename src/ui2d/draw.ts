/** 繪圖與屬性解析的小工具（繪圖器與各元件共用） */

/** 2D 繪圖環境（瀏覽器的 CanvasRenderingContext2D 或 OffscreenCanvas 的） */
export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 圓角矩形路徑（不依賴 ctx.roundRect，相容性較好） */
export function roundRectPath(ctx: Context2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (radius === 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export const num = (v: string | undefined, fallback: number): number => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export const bool = (v: string | undefined): boolean => v !== undefined && v !== 'false' && v !== '0';

export const isVisibleColor = (c: string | undefined): c is string => !!c && c !== 'transparent' && c !== 'none';

export const UI_FONT_FAMILY = 'system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif';

/** 介面預設字型字串 */
export const uiFont = (size: number, weight = 'normal'): string => `${weight} ${size}px ${UI_FONT_FAMILY}`;

/** 兩色漸層的寫法："#f00,#0f0"（左到右）；單一顏色直接回傳 */
export function fillStyle(
  ctx: Context2D,
  value: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): string | CanvasGradient {
  const parts = value
    .split(/,(?![^(]*\))/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return value;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  parts.forEach((c, i) => g.addColorStop(i / (parts.length - 1), c));
  return g;
}
