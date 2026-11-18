import type { Context2D } from './draw';

/**
 * 內建圖示（24×24 座標，線條風格）。
 * stroke：用線條畫的路徑；fill：填滿的路徑（SVG path 語法）。
 */
interface IconDef {
  stroke?: string[];
  fill?: string[];
  /** 線條畫在填滿的圖形上（用較深的顏色，例如金幣的內圈） */
  inset?: boolean;
}

/** 正多角星（填滿） */
function starPath(points: number, outer: number, inner: number, cx = 12, cy = 12.5): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'L'}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  }
  return `${d}Z`;
}

/** 齒輪外框 */
function gearPath(): string {
  const teeth = 8;
  let d = '';
  for (let i = 0; i < teeth * 4; i++) {
    const r = i % 4 < 2 ? 10 : 7.6;
    const a = (i / (teeth * 4)) * Math.PI * 2 + Math.PI / (teeth * 4);
    d += `${i === 0 ? 'M' : 'L'}${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`;
  }
  return `${d}Z`;
}

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

/** 內建圖示：名稱 → 向量路徑 */
export const ICONS: Record<string, IconDef> = {
  heart: {
    fill: [
      'M12 21s-7.5-4.6-9.6-9.4C.9 8 3 4.5 6.6 4.5c2.2 0 3.7 1.2 5.4 3.2 1.7-2 3.2-3.2 5.4-3.2 3.6 0 5.7 3.5 4.2 7.1C19.5 16.4 12 21 12 21z',
    ],
  },
  star: { fill: [starPath(5, 10, 4.2)] },
  coin: { fill: [circle(12, 12, 9.5)], stroke: [circle(12, 12, 6), 'M12 8.5v7'], inset: true },
  gem: { stroke: ['M6.5 3.5h11l4 5.5L12 21 2.5 9z', 'M2.5 9h19', 'M9.5 3.5 8 9l4 12 4-12-1.5-5.5'] },
  gear: { stroke: [gearPath(), circle(12, 12, 3)] },
  close: { stroke: ['M6 6l12 12', 'M18 6L6 18'] },
  check: { stroke: ['M4.5 12.5l5 5L19.5 7'] },
  plus: { stroke: ['M12 5v14', 'M5 12h14'] },
  minus: { stroke: ['M5 12h14'] },
  play: { fill: ['M7 4.5v15l12.5-7.5z'] },
  pause: { fill: ['M6 4.5h4v15H6z', 'M14 4.5h4v15h-4z'] },
  home: { stroke: ['M3 11.5 12 4l9 7.5', 'M5.5 10v10h4.5v-6h4v6h4.5V10'] },
  menu: { stroke: ['M4 6.5h16', 'M4 12h16', 'M4 17.5h16'] },
  search: { stroke: [circle(10.5, 10.5, 6.5), 'M15.5 15.5 21 21'] },
  lock: { stroke: ['M5 11h14v10H5z', 'M8 11V7.5a4 4 0 0 1 8 0V11'] },
  sound: { stroke: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9a4.2 4.2 0 0 1 0 6', 'M18.5 6a8.5 8.5 0 0 1 0 12'] },
  mute: { stroke: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M16 9.5l5 5', 'M21 9.5l-5 5'] },
  sword: { stroke: ['M20.5 3.5 10 14', 'M20.5 3.5H16', 'M20.5 3.5V8', 'M6.5 12.5l5 5', 'M8.5 15.5 4 20'] },
  shield: { stroke: ['M12 3 19.5 6v5.5c0 4.8-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.7-7.5-9.5V6z'] },
  potion: {
    stroke: ['M9.5 3h5', 'M10.5 3v5.5L5.5 17a3 3 0 0 0 2.6 4.5h7.8a3 3 0 0 0 2.6-4.5l-5-8.5V3', 'M7.5 14.5h9'],
  },
  bolt: { fill: ['M13.5 2 4.5 13.5h6.5L10 22l9.5-12H13z'] },
  fire: {
    fill: [
      'M12 22c-4.1 0-7-2.9-7-6.8 0-3.3 2.1-5.4 3.7-7.2.3 1.6 1.1 2.8 2.3 3.6-.4-3.4 1.2-6.6 4.2-9.1.4 3.4 1.9 5.4 3.3 7.3 1.1 1.5 1.8 3.2 1.8 5.4C20.3 19.1 16.1 22 12 22z',
    ],
  },
  clock: { stroke: [circle(12, 12, 9), 'M12 7v5l3.5 2'] },
  info: { stroke: [circle(12, 12, 9), 'M12 11v6'], fill: [circle(12, 7.6, 1.2)] },
  warning: { stroke: ['M12 3.5 2.5 20h19z', 'M12 10v4.5'], fill: [circle(12, 17.2, 1.1)] },
  user: { stroke: [circle(12, 8, 4), 'M4 21a8 8 0 0 1 16 0'] },
  trophy: {
    stroke: [
      'M7.5 4h9v5a4.5 4.5 0 0 1-9 0z',
      'M7.5 6H4.5a3 3 0 0 0 3 4',
      'M16.5 6h3a3 3 0 0 1-3 4',
      'M12 13.5V17',
      'M8 21h8',
      'M9.5 17h5v4h-5z',
    ],
  },
  bag: { stroke: ['M5 8h14l-1.2 13H6.2z', 'M9 8V6.5a3 3 0 0 1 6 0V8'] },
  map: { stroke: ['M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z', 'M9 4v13.5', 'M15 6.5V20'] },
  refresh: { stroke: ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v4.5h-4.5'] },
  arrowUp: { stroke: ['M12 19V5', 'M5.5 11.5 12 5l6.5 6.5'] },
  arrowDown: { stroke: ['M12 5v14', 'M5.5 12.5 12 19l6.5-6.5'] },
  arrowLeft: { stroke: ['M19 12H5', 'M11.5 5.5 5 12l6.5 6.5'] },
  arrowRight: { stroke: ['M5 12h14', 'M12.5 5.5 19 12l-6.5 6.5'] },
  chevronUp: { stroke: ['M6 15l6-6 6 6'] },
  chevronDown: { stroke: ['M6 9l6 6 6-6'] },
  chevronLeft: { stroke: ['M15 6l-6 6 6 6'] },
  chevronRight: { stroke: ['M9 6l6 6-6 6'] },
  chat: { stroke: ['M4 5h16v11H9l-5 4z'] },
  flag: { stroke: ['M5 21V4', 'M5 4h12l-2.5 4 2.5 4H5'] },
  target: { stroke: [circle(12, 12, 9), circle(12, 12, 5)], fill: [circle(12, 12, 1.6)] },
};

/** 所有內建圖示的名稱 */
export const ICON_NAMES = Object.keys(ICONS);

const pathCache = new Map<string, Path2D>();
function path(d: string): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  let p = pathCache.get(d);
  if (!p) pathCache.set(d, (p = new Path2D(d)));
  return p;
}

/**
 * 在 (x, y, w, h) 範圍中央畫圖示。
 * @returns 是否有這個圖示
 */
export function drawIcon(
  ctx: Context2D,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  strokeWidth = 2,
): boolean {
  const def = ICONS[name];
  if (!def) return false;
  const size = Math.min(w, h);
  if (size <= 0) return true;
  const s = size / 24;
  ctx.save();
  ctx.translate(x + (w - size) / 2, y + (h - size) / 2);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of def.fill ?? []) {
    const p = path(d);
    if (p) ctx.fill(p);
  }
  if (def.inset) ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  for (const d of def.stroke ?? []) {
    const p = path(d);
    if (p) ctx.stroke(p);
  }
  ctx.restore();
  return true;
}
