import type { OverlayPainter, Rect } from './elements';
import {
  UIButton,
  UICheckBox,
  UICheckIndicator,
  type UIElement,
  UIImage,
  UILabel,
  UIRadioButton,
  UIScrollView,
  UISelect,
  UISlider,
} from './elements';
import { fontString } from './text';
import { bool, isVisibleColor, num, roundRectPath, type Context2D } from './draw';
import { UIToggle } from './widgets';
import { createLogger } from '../core/Logger';

const log = createLogger('ui2d');

export type { Context2D };

/** 互動狀態（決定按鈕外觀） */
export interface PaintState {
  /** 滑鼠移到的元件 */
  hover: UIElement | null;
  /** 按著的元件 */
  pressed: UIElement | null;
  /** 展開中的下拉選單（畫在最上層） */
  openSelect?: UISelect | null;
  /** 畫在所有元件之上的東西（拖曳中的圖示、浮動說明） */
  overlays?: OverlayPainter[];
}

/** 已載入的圖片（給繪圖用） */
export type ImageSourceLookup = (url: string) => CanvasImageSource | undefined;

interface Shadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

/** 解析 "0 4px 12px rgba(0,0,0,0.5)" 這類陰影寫法 */
export function parseShadow(v: string | undefined): Shadow | null {
  if (!v) return null;
  const nums: number[] = [];
  let rest = v.trim();
  while (nums.length < 3) {
    const m = /^(-?[\d.]+)(px)?\s*/.exec(rest);
    if (!m) break;
    nums.push(parseFloat(m[1]));
    rest = rest.slice(m[0].length);
  }
  if (nums.length < 2) return null;
  return { x: nums[0], y: nums[1], blur: nums[2] ?? 0, color: rest || 'rgba(0,0,0,0.5)' };
}

/**
 * 介面繪圖器：把整棵介面樹畫到 2D 畫布上（引擎內繪製，不使用 HTML 元素）。
 * 位置與大小完全來自 Yoga 的排版結果。
 */
export class UIPainter {
  /** 最後才畫的東西（數值提示等），確保在所有元件之上 */
  private overlays: (() => void)[] = [];

  constructor(private readonly images: ImageSourceLookup) {}

  /**
   * 畫介面（width、height 為 CSS 像素，pixelRatio 為裝置像素比）。
   * 有給 region 時只重畫該範圍（局部重畫）：先清除再在裁切範圍內重畫。
   */
  paint(
    ctx: Context2D,
    root: UIElement,
    width: number,
    height: number,
    pixelRatio: number,
    state: PaintState,
    region?: Rect,
  ): void {
    ctx.save();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (region) {
      ctx.beginPath();
      ctx.rect(region.x, region.y, region.width, region.height);
      ctx.clip();
      ctx.clearRect(region.x, region.y, region.width, region.height);
    } else {
      ctx.clearRect(0, 0, width, height);
    }
    ctx.globalAlpha = 1;
    this.overlays = [];
    this.paintElement(ctx, root, 0, 0, pixelRatio, state);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.globalAlpha = 1;
    for (const draw of this.overlays.splice(0)) draw();
    if (state.openSelect) this.paintPopup(ctx, state.openSelect, height, pixelRatio);
    for (const draw of state.overlays ?? []) {
      ctx.save();
      draw(ctx);
      ctx.restore();
    }
    ctx.restore();
  }

  private paintElement(ctx: Context2D, el: UIElement, ox: number, oy: number, pr: number, state: PaintState): void {
    if (!el.visible) return;
    const a = el.attrs;
    const { width: w, height: h } = el.layout;
    const x = ox + el.layout.x + el.offsetX;
    const y = oy + el.layout.y + el.offsetY;

    ctx.save();
    if (a.opacity !== undefined) ctx.globalAlpha *= num(a.opacity, 1);
    if (el.alpha !== 1) ctx.globalAlpha *= Math.max(0, el.alpha);
    if (ctx.globalAlpha <= 0.001) {
      ctx.restore();
      return;
    }

    // 按鈕、下拉選單、勾選框的狀態（背景顏色與背景圖片一起決定）
    let background = a.background;
    let bgImage = a.bgImage;
    const hovered = state.hover === el || (el instanceof UISelect && state.openSelect === el);
    const pressed = state.pressed === el;
    const disabled = (el as { disabled?: boolean }).disabled === true;
    if (disabled && a.disabledBgImage) bgImage = a.disabledBgImage;
    else if (pressed && a.pressedBgImage) bgImage = a.pressedBgImage;
    else if ((hovered || pressed) && a.hoverBgImage) bgImage = a.hoverBgImage;
    if ((el instanceof UISelect || el instanceof UICheckBox || el instanceof UISlider) && el.disabled)
      ctx.globalAlpha *= 0.5;
    else if (el instanceof UISelect && (state.hover === el || state.openSelect === el))
      background = a.hoverBackground ?? background;
    else if (!(el instanceof UIButton) && a.hoverBackground !== undefined) {
      // 其他元件（例如表格的列）也可以有滑鼠移入、按下的背景
      if (state.pressed === el && a.pressedBackground !== undefined) background = a.pressedBackground;
      else if (state.hover === el || state.pressed === el) background = a.hoverBackground;
    }
    if (el instanceof UIButton) {
      if (el.disabled) {
        background = a.disabledBackground ?? background;
        ctx.globalAlpha *= 0.5;
      } else if (state.pressed === el) {
        background = a.pressedBackground ?? background;
        // 按下時稍微縮小
        ctx.translate(x + w / 2, y + h / 2);
        ctx.scale(0.97, 0.97);
        ctx.translate(-(x + w / 2), -(y + h / 2));
      } else if (state.hover === el) {
        background = a.hoverBackground ?? background;
      }
    }

    const radius = num(a.radius, 0);
    if (isVisibleColor(background)) {
      const shadow = parseShadow(a.shadow);
      if (shadow) {
        // 陰影參數不受座標轉換影響，要自己乘上像素比
        ctx.shadowOffsetX = shadow.x * pr;
        ctx.shadowOffsetY = shadow.y * pr;
        ctx.shadowBlur = shadow.blur * pr;
        ctx.shadowColor = shadow.color;
      }
      ctx.fillStyle = background;
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    }
    if (bgImage && bgImage !== 'none') this.paintBackgroundImage(ctx, el, bgImage, x, y, w, h, radius);
    if (el.isEmptyContainer) this.paintEmptyHint(ctx, el, x, y, w, h, radius);
    if (a.border) {
      const [bw, ...color] = a.border.split(/\s+/);
      const lw = num(bw, 1);
      if (lw > 0) {
        ctx.lineWidth = lw;
        ctx.strokeStyle = color.join(' ') || '#ffffff';
        roundRectPath(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, Math.max(0, radius - lw / 2));
        ctx.stroke();
      }
    }

    // 元件自己的內容（還沒排版、大小為 0 時不畫：有些圖形會算出負的半徑）
    if (w > 0 && h > 0) {
      try {
        if (el instanceof UILabel) {
          const p = el.padding;
          this.paintText(ctx, el, x + p.left, y + p.top, w - p.left - p.right, pr);
        }
        if (el instanceof UIImage) this.paintImage(ctx, el, x, y, w, h);
        if (el instanceof UICheckIndicator) this.paintIndicator(ctx, el, x, y, w, h, state);
        if (el instanceof UISelect) this.paintArrow(ctx, el, x, y, w, h, state.openSelect === el);
        if (el instanceof UISlider) this.paintSlider(ctx, el, x, y, w, h, state, pr);
        if (el.paintContent) {
          ctx.save();
          try {
            el.paintContent(ctx, x, y, w, h);
          } finally {
            ctx.restore();
          }
        }
      } catch (error) {
        // 一個元件畫壞了不要讓整個介面都畫不出來（每種元件只回報一次）
        if (!reportedPaintErrors.has(el.type)) {
          reportedPaintErrors.add(el.type);
          log.error(`繪製 <${el.type}> 時發生錯誤（第 ${el.line} 行）：`, error);
        }
      }
    }

    if (el instanceof UIScrollView) {
      // 列表：裁切範圍外的內容，並套用捲動位置
      ctx.save();
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.clip();
      for (const c of el.children) this.paintElement(ctx, c, x - el.scrollLeft, y - el.scrollTop, pr, state);
      ctx.restore();
      this.paintScrollbar(ctx, el, x, y, w, h);
    } else {
      for (const c of el.children) this.paintElement(ctx, c, x, y, pr, state);
    }
    ctx.restore();
  }

  /**
   * 背景圖片：bgImage（狀態：hoverBgImage、pressedBgImage、disabledBgImage）
   * bgFit：cover（預設，填滿裁切）、contain、fill（拉伸）、tile（重複）、none（原尺寸）
   * bgPosition：center（預設）、top、bottom、left、right，或組合如 "top left"
   * bgSlice：九宮格切割（圖片像素，"16" 或 "上 右 下 左"），四角不變形、邊與中間延伸，適合做框、按鈕
   * bgSliceWidth：九宮格邊框在畫面上的寬度（預設和 bgSlice 相同）
   * bgOpacity：透明度；bgFilter：濾鏡（例如 grayscale(1)、brightness(1.2)）
   * 都會依 radius 裁成圓角。
   */
  private paintBackgroundImage(
    ctx: Context2D,
    el: UIElement,
    src: string,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
  ): void {
    const img = this.images(el.ctx.resolveUrl(src, el));
    if (!img || w <= 0 || h <= 0) return;
    const size = imageSize(img);
    if (!size.width || !size.height) return;
    const a = el.attrs;
    ctx.save();
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.clip();
    if (a.bgOpacity !== undefined) ctx.globalAlpha *= Math.min(1, Math.max(0, num(a.bgOpacity, 1)));
    if (a.bgFilter && 'filter' in ctx) ctx.filter = a.bgFilter;
    if (a.bgSlice) {
      drawNineSlice(ctx, img, size, a.bgSlice, a.bgSliceWidth, x, y, w, h);
    } else {
      const fit = a.bgFit ?? 'cover';
      if (fit === 'fill') {
        ctx.drawImage(img, x, y, w, h);
      } else if (fit === 'tile') {
        const pattern = createTilePattern(ctx, img, size);
        if (pattern) {
          const [px, py] = bgOffset(a.bgPosition, w, h, size.width, size.height);
          ctx.translate(x + px, y + py);
          ctx.fillStyle = pattern;
          ctx.fillRect(-px, -py, w, h);
        }
      } else {
        const scale =
          fit === 'contain'
            ? Math.min(w / size.width, h / size.height)
            : fit === 'none'
              ? 1
              : Math.max(w / size.width, h / size.height);
        const dw = size.width * scale;
        const dh = size.height * scale;
        const [ox, oy] = bgOffset(a.bgPosition, w, h, dw, dh);
        ctx.drawImage(img, x + ox, y + oy, dw, dh);
      }
    }
    ctx.restore();
  }

  /** 編輯器：空的容器畫虛線框與提示文字 */
  private paintEmptyHint(
    ctx: Context2D,
    el: UIElement,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
  ): void {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(154,205,50,0.55)';
    ctx.fillStyle = 'rgba(154,205,50,0.06)';
    roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, Math.max(4, radius));
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    const size = Math.max(9, Math.min(12, h * 0.28));
    ctx.font = `normal ${size}px system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(200,240,122,0.8)';
    const dir = el.attrs.dir === 'h' ? '水平' : '';
    const text = w > 150 ? `空的 ${el.type}${dir ? `（${dir}）` : ''} · 把元件拖進來` : `空的 ${el.type}`;
    ctx.fillText(text, x + w / 2, y + h / 2, w - 8);
    ctx.restore();
  }

  private paintText(ctx: Context2D, el: UILabel, x: number, y: number, w: number, pr: number): void {
    const f = el.font;
    const lh = f.size * f.lineHeight;
    ctx.font = fontString(f);
    ctx.fillStyle = el.attrs.color ?? '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const shadow = parseShadow(el.attrs.textShadow);
    if (shadow) {
      ctx.shadowOffsetX = shadow.x * pr;
      ctx.shadowOffsetY = shadow.y * pr;
      ctx.shadowBlur = shadow.blur * pr;
      ctx.shadowColor = shadow.color;
    }
    const align = el.attrs.textAlign ?? 'left';
    // 打字機效果：只畫前 revealed 個字（位置以完整文字計算）
    let budget = el.revealed;
    for (let i = 0; i < el.metrics.lines.length && budget > 0; i++) {
      const full = el.metrics.lines[i];
      const chars = [...full];
      const line = chars.length > budget ? chars.slice(0, budget).join('') : full;
      budget -= chars.length;
      const lw = align === 'left' ? 0 : ctx.measureText(full).width;
      const lx = align === 'center' ? x + (w - lw) / 2 : align === 'right' ? x + w - lw : x;
      ctx.fillText(line, lx, y + lh * (i + 0.5));
    }
  }

  private paintImage(ctx: Context2D, el: UIImage, x: number, y: number, w: number, h: number): void {
    const src = el.src;
    const img = src ? this.images(src) : undefined;
    const n = el.natural;
    if (!img || !n || n.width === 0 || n.height === 0 || w <= 0 || h <= 0) return;
    const fit = el.attrs.fit ?? 'contain';
    if (el.attrs.tint && 'filter' in ctx) ctx.filter = el.attrs.tint; // 例如 grayscale(1)
    if (fit === 'fill') {
      ctx.drawImage(img, x, y, w, h);
    } else {
      const scale = fit === 'cover' ? Math.max(w / n.width, h / n.height) : Math.min(w / n.width, h / n.height);
      const dw = n.width * scale;
      const dh = n.height * scale;
      if (fit === 'cover') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
      }
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      if (fit === 'cover') ctx.restore();
    }
    if (el.attrs.tint && 'filter' in ctx) ctx.filter = 'none';
  }

  /** 勾選框的方塊與勾勾、單選按鈕的圓圈與圓點 */
  private paintIndicator(
    ctx: Context2D,
    el: UICheckIndicator,
    x: number,
    y: number,
    w: number,
    h: number,
    state: PaintState,
  ): void {
    const owner = el.parent;
    if (!(owner instanceof UICheckBox)) return;
    if (owner instanceof UIToggle) {
      this.paintSwitch(ctx, owner, x, y, w, h, state);
      return;
    }
    const checked = owner.checked;
    const accent = owner.attrs.accent ?? '#3a7bfd';
    const hover = state.hover === owner && !owner.disabled;
    const radio = owner instanceof UIRadioButton;
    const size = Math.min(w, h);
    const lw = Math.max(1.5, size * 0.1);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const path = () => {
      if (radio) {
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2 - lw / 2, 0, Math.PI * 2);
      } else {
        roundRectPath(ctx, cx - size / 2 + lw / 2, cy - size / 2 + lw / 2, size - lw, size - lw, size * 0.22);
      }
    };
    if (checked && !radio) {
      ctx.fillStyle = accent;
      path();
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      path();
      ctx.fill();
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = checked ? accent : hover ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)';
    path();
    ctx.stroke();
    if (!checked) return;
    if (radio) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.24, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 勾勾
      ctx.strokeStyle = owner.attrs.checkColor ?? '#ffffff';
      ctx.lineWidth = Math.max(2, size * 0.12);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.24, cy + size * 0.02);
      ctx.lineTo(cx - size * 0.06, cy + size * 0.2);
      ctx.lineTo(cx + size * 0.26, cy - size * 0.18);
      ctx.stroke();
    }
  }

  /** 開關：圓角軌道與圓鈕（開啟時軌道為強調色） */
  private paintSwitch(
    ctx: Context2D,
    owner: UIToggle,
    x: number,
    y: number,
    w: number,
    h: number,
    state: PaintState,
  ): void {
    const k = owner.knob;
    const r = h / 2;
    ctx.fillStyle = owner.attrs.offColor ?? 'rgba(255,255,255,0.18)';
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
    if (k > 0) {
      ctx.save();
      ctx.globalAlpha *= k;
      ctx.fillStyle = owner.attrs.accent ?? '#3a7bfd';
      roundRectPath(ctx, x, y, w, h, r);
      ctx.fill();
      ctx.restore();
    }
    if (state.hover === owner && !owner.disabled) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, r);
      ctx.stroke();
    }
    const knobR = Math.max(1, r - 3);
    const cx = x + r + (w - h) * k;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = owner.attrs.knobColor ?? '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, y + r, knobR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 滑桿：軌道、已填滿的部分、圓點；拖曳或滑鼠移入時在圓點上方顯示數值 */
  private paintSlider(
    ctx: Context2D,
    el: UISlider,
    x: number,
    y: number,
    w: number,
    h: number,
    state: PaintState,
    pr: number,
  ): void {
    const a = el.attrs;
    const vertical = el.vertical;
    const thumb = Math.min(num(a.thumbSize, 18), vertical ? w : h);
    const track = Math.min(num(a.trackHeight, 6), thumb);
    const half = thumb / 2;
    const ratio = el.ratio;
    const active = state.pressed === el;
    const hover = state.hover === el && !el.disabled;

    // 軌道（和 UISlider.trackRange 的範圍一致）
    const tx = vertical ? x + (w - track) / 2 : x + half - track / 2;
    const ty = vertical ? y + half - track / 2 : y + (h - track) / 2;
    const tw = vertical ? track : w - thumb + track;
    const th = vertical ? h - thumb + track : track;
    ctx.fillStyle = a.trackColor ?? 'rgba(255,255,255,0.18)';
    roundRectPath(ctx, tx, ty, tw, th, track / 2);
    ctx.fill();

    // 圓點中心
    const cx = vertical ? x + w / 2 : x + half + (w - thumb) * ratio;
    const cy = vertical ? y + h - half - (h - thumb) * ratio : y + h / 2;

    // 已填滿的部分（最小值到圓點）
    ctx.fillStyle = a.accent ?? '#3a7bfd';
    if (vertical) roundRectPath(ctx, tx, cy - track / 2, track, y + h - half + track / 2 - (cy - track / 2), track / 2);
    else roundRectPath(ctx, tx, ty, cx + track / 2 - tx, track, track / 2);
    ctx.fill();

    // 圓點
    const radius = half * (active ? 1.08 : 1);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 4 * pr;
    ctx.shadowOffsetY = 1 * pr;
    ctx.fillStyle = a.thumbColor ?? '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (active || hover) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = a.accent ?? '#3a7bfd';
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 數值提示：最後才畫，避免被後面的元件蓋住
    // （列表捲動、按下縮放等座標轉換在這裡就要算好）
    if (bool(a.showValue) && (active || hover)) {
      const m = ctx.getTransform?.();
      this.overlays.push(() => {
        ctx.save();
        if (m) ctx.setTransform(m);
        this.paintSliderTooltip(ctx, el, cx, cy, half, vertical);
        ctx.restore();
      });
    }
  }

  /** 滑桿的數值提示（水平：圓點上方；直立：圓點右側） */
  private paintSliderTooltip(
    ctx: Context2D,
    el: UISlider,
    cx: number,
    cy: number,
    half: number,
    vertical: boolean,
  ): void {
    const a = el.attrs;
    const text = el.displayValue;
    const size = num(a.fontSize, 12);
    ctx.font = `bold ${size}px system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`;
    const bw = ctx.measureText(text).width + 12;
    const bh = size + 10;
    const bx = vertical ? cx + half + 6 : cx - bw / 2;
    const by = vertical ? cy - bh / 2 : cy - half - bh - 6;
    ctx.fillStyle = 'rgba(15,18,24,0.92)';
    roundRectPath(ctx, bx, by, bw, bh, 6);
    ctx.fill();
    ctx.fillStyle = a.color ?? '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + 6, by + bh / 2);
  }

  /** 下拉選單右側的箭頭（展開時朝上） */
  private paintArrow(ctx: Context2D, el: UISelect, x: number, y: number, w: number, h: number, open: boolean): void {
    const cx = x + w - 16;
    const cy = y + h / 2;
    const s = 4;
    ctx.fillStyle = el.attrs.color ?? '#ffffff';
    ctx.beginPath();
    if (open) {
      ctx.moveTo(cx - s, cy + s / 2);
      ctx.lineTo(cx + s, cy + s / 2);
      ctx.lineTo(cx, cy - s / 2);
    } else {
      ctx.moveTo(cx - s, cy - s / 2);
      ctx.lineTo(cx + s, cy - s / 2);
      ctx.lineTo(cx, cy + s / 2);
    }
    ctx.closePath();
    ctx.fill();
  }

  /** 展開的下拉選單（畫在所有介面之上） */
  private paintPopup(ctx: Context2D, el: UISelect, viewportHeight: number, pr: number): void {
    const p = el.popupLayout(viewportHeight);
    const a = el.attrs;
    const radius = num(a.radius, 8);
    const font = el.label.font;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 16 * pr;
    ctx.shadowOffsetY = 6 * pr;
    ctx.fillStyle = a.popupBackground ?? '#1f242d';
    roundRectPath(ctx, p.x, p.y, p.width, p.height, radius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    roundRectPath(ctx, p.x + 0.5, p.y + 0.5, p.width - 1, p.height - 1, radius);
    ctx.stroke();

    // 選項（超出範圍的裁掉）
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y + p.padding, p.width, p.height - p.padding * 2);
    ctx.clip();
    ctx.font = fontString(font);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const accent = a.accent ?? '#3a7bfd';
    const selected = el.selectedIndex;
    el.options.forEach((option, i) => {
      const iy = p.y + p.padding + i * p.itemHeight - el.popupScroll;
      if (iy + p.itemHeight < p.y || iy > p.y + p.height) return;
      if (i === el.hoverIndex) {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        roundRectPath(ctx, p.x + 4, iy, p.width - 8, p.itemHeight, 6);
        ctx.fill();
      }
      if (i === selected) {
        ctx.fillStyle = accent;
        roundRectPath(ctx, p.x + 6, iy + p.itemHeight * 0.25, 3, p.itemHeight * 0.5, 1.5);
        ctx.fill();
      }
      ctx.fillStyle = i === selected ? '#ffffff' : (a.color ?? '#ffffff');
      ctx.fillText(option.label, p.x + 16, iy + p.itemHeight / 2);
    });
    ctx.restore();

    // 捲軸
    const total = el.options.length * p.itemHeight;
    const view = p.visible * p.itemHeight;
    if (total > view) {
      const thumb = Math.max(16, (view * view) / total);
      const ty = p.y + p.padding + (el.popupScroll / (total - view)) * (view - thumb);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      roundRectPath(ctx, p.x + p.width - 6, ty, 3, thumb, 1.5);
      ctx.fill();
    }
    ctx.restore();
  }

  private paintScrollbar(ctx: Context2D, el: UIScrollView, x: number, y: number, w: number, h: number): void {
    ctx.fillStyle = el.attrs.scrollbarColor ?? 'rgba(255,255,255,0.35)';
    const axis = el.scrollAxis;
    if (axis !== 'x' && el.contentHeight > h + 0.5) {
      const thumb = Math.max(20, (h * h) / el.contentHeight);
      const ty = y + (el.scrollTop / (el.contentHeight - h)) * (h - thumb);
      roundRectPath(ctx, x + w - 5, ty, 3, thumb, 1.5);
      ctx.fill();
    }
    if (axis !== 'y' && el.contentWidth > w + 0.5) {
      const thumb = Math.max(20, (w * w) / el.contentWidth);
      const tx = x + (el.scrollLeft / (el.contentWidth - w)) * (w - thumb);
      roundRectPath(ctx, tx, y + h - 5, thumb, 3, 1.5);
      ctx.fill();
    }
  }
}

const reportedPaintErrors = new Set<string>();

/** 圖片原始尺寸（HTMLImageElement、ImageBitmap、畫布都適用） */
function imageSize(img: CanvasImageSource): { width: number; height: number } {
  const i = img as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number | { baseVal: { value: number } };
    height?: number | { baseVal: { value: number } };
  };
  const read = (v: unknown) =>
    typeof v === 'number' ? v : ((v as { baseVal?: { value: number } } | undefined)?.baseVal?.value ?? 0);
  return { width: i.naturalWidth || read(i.width), height: i.naturalHeight || read(i.height) };
}

/** 重複底紋用的點陣圖快取（圖片 → 依縮放倍率） */
const tileCache = new WeakMap<object, Map<number, HTMLCanvasElement | OffscreenCanvas>>();

/**
 * 建立重複底紋（bgFit="tile"）。
 * Safari（WebKit）直接把 SVG 圖片拿去 createPattern 會把整張畫布標成「被污染」，
 * 之後介面貼圖再也無法上傳到 GPU（SecurityError），畫面就停在舊的樣子（例如背包關不掉）。
 * 所以先把圖片畫到一般畫布（drawImage 不會污染），再用那張畫布做圖樣；依目前縮放倍率點陣化，維持清晰。
 */
function createTilePattern(
  ctx: Context2D,
  img: CanvasImageSource,
  size: { width: number; height: number },
): CanvasPattern | null {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const scale = Math.min(4, Math.max(1, t ? Math.hypot(t.a, t.b) : 1));
  const w = Math.max(1, Math.round(size.width * scale));
  const h = Math.max(1, Math.round(size.height * scale));
  let tile: HTMLCanvasElement | OffscreenCanvas | undefined;
  let byScale = tileCache.get(img);
  tile = byScale?.get(scale);
  if (!tile) {
    tile =
      typeof document !== 'undefined'
        ? document.createElement('canvas')
        : typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(w, h)
          : undefined;
    const tctx = tile?.getContext('2d') as Context2D | null | undefined;
    if (!tile || !tctx) return ctx.createPattern(img, 'repeat'); // 沒有畫布可用（例如測試環境）
    tile.width = w;
    tile.height = h;
    tctx.drawImage(img, 0, 0, w, h);
    if (!byScale) tileCache.set(img, (byScale = new Map()));
    byScale.set(scale, tile);
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern && scale !== 1 && typeof DOMMatrix !== 'undefined')
    pattern.setTransform(new DOMMatrix().scale(1 / scale, 1 / scale));
  return pattern;
}

/** bgPosition 關鍵字 → 圖片左上角相對於元件的位移 */
function bgOffset(position: string | undefined, w: number, h: number, dw: number, dh: number): [number, number] {
  const words = (position ?? 'center').toLowerCase().split(/\s+/);
  const has = (k: string) => words.includes(k);
  const ox = has('left') ? 0 : has('right') ? w - dw : (w - dw) / 2;
  const oy = has('top') ? 0 : has('bottom') ? h - dh : (h - dh) / 2;
  return [ox, oy];
}

/** 九宮格（bgSlice）：四角原尺寸、四邊單向延伸、中間雙向延伸；編輯器的九宮格預覽也用它 */
export function drawNineSlice(
  ctx: Context2D,
  img: CanvasImageSource,
  size: { width: number; height: number },
  slice: string,
  sliceWidth: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const edges = (v: string) => {
    const n = v
      .trim()
      .split(/\s+/)
      .map((p) => Math.max(0, parseFloat(p) || 0));
    const [t, r = t, b = t, l = r] = n;
    return [t, r, b, l];
  };
  const [st, sr, sb, sl] = edges(slice);
  let [dt, dr, db, dl] = sliceWidth ? edges(sliceWidth) : [st, sr, sb, sl];
  // 元件比邊框還小時等比縮小邊框
  const k = Math.min(1, w / Math.max(1, dl + dr), h / Math.max(1, dt + db));
  [dt, dr, db, dl] = [dt * k, dr * k, db * k, dl * k];
  const sw = size.width;
  const sh = size.height;
  const scx = Math.max(0, sw - sl - sr);
  const scy = Math.max(0, sh - st - sb);
  const dcx = Math.max(0, w - dl - dr);
  const dcy = Math.max(0, h - dt - db);
  const cols: [number, number, number, number][] = [
    [0, sl, x, dl],
    [sl, scx, x + dl, dcx],
    [sw - sr, sr, x + w - dr, dr],
  ];
  const rows: [number, number, number, number][] = [
    [0, st, y, dt],
    [st, scy, y + dt, dcy],
    [sh - sb, sb, y + h - db, db],
  ];
  for (const [sy, shh, dy, dhh] of rows) {
    for (const [sx, sww, dx, dww] of cols) {
      if (sww <= 0 || shh <= 0 || dww <= 0 || dhh <= 0) continue;
      ctx.drawImage(img, sx, sy, sww, shh, dx, dy, dww, dhh);
    }
  }
}
