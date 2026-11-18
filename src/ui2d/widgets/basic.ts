/** 進階介面元件：進度條、開關、圖示 */
import { UICheckBox, UIElement, type Attrs } from '../elements';
import { bool, fillStyle, num, roundRectPath, uiFont, type Context2D } from '../draw';
import { drawIcon } from '../icons';
import { approach } from './shared';

/**
 * 進度條：血條、魔力、經驗值、載入進度。數值改變時平滑移動；
 * 減少時留下淡色「殘影」再慢慢跟上（受傷的感覺）。
 * shape="radial" 為圓形（環狀）進度：圓形血量、技能充能、載入轉圈；ringWidth 設環的粗細。
 * @example <UIProgressBar id="hp" value="80" max="100" fill="#ff5a5a,#ffb347" showText="true"/>
 * @example <UIProgressBar shape="radial" value="65" width="72" height="72" showText="true"/>
 */
export class UIProgressBar extends UIElement {
  /** 畫面上顯示的值（動畫中） */
  shown: number | null = null;
  /** 殘影的值（沒有殘影時為 null） */
  trail: number | null = null;
  private trailHold = 0;

  override defaults(): Attrs {
    if (this.raw.shape === 'radial') {
      // 用 left＋right／top＋bottom 撐開時不給預設大小（例如蓋在物品格外圍）
      const r = this.raw;
      const stretchX = r.left !== undefined && r.right !== undefined;
      const stretchY = r.top !== undefined && r.bottom !== undefined;
      return {
        ...(stretchX ? {} : { width: '64' }),
        ...(stretchY ? {} : { height: '64' }),
        min: '0',
        max: '100',
        ringWidth: '7',
        startAngle: '0',
        trackColor: 'rgba(255,255,255,0.14)',
        fill: '#9acd32',
        trailColor: 'rgba(255,255,255,0.6)',
        animate: '0.25',
        textFormat: '{percent}',
        fontSize: '14',
        color: '#ffffff',
      };
    }
    const vertical = bool(this.raw.vertical);
    return {
      width: vertical ? '14' : '200',
      height: vertical ? '120' : '14',
      min: '0',
      max: '100',
      radius: '7',
      trackColor: 'rgba(255,255,255,0.14)',
      fill: '#9acd32',
      trailColor: 'rgba(255,255,255,0.6)',
      animate: '0.25',
      textFormat: '{value} / {max}',
      fontSize: '11',
      color: '#ffffff',
    };
  }

  /** 是否垂直（vertical 屬性） */
  get vertical(): boolean {
    return bool(this.attrs.vertical);
  }

  /** 圓形（環狀）進度：shape="radial" */
  get radial(): boolean {
    return this.attrs.shape === 'radial';
  }

  /** 最小值（min 屬性，預設 0） */
  get min(): number {
    return num(this.attrs.min, 0);
  }

  /** 最大值（max 屬性，預設 100） */
  get max(): number {
    const m = num(this.attrs.max, 100);
    return m > this.min ? m : this.min + 1;
  }

  get value(): number {
    return Math.min(this.max, Math.max(this.min, num(this.raw.value, this.min)));
  }

  /** 設定數值（有動畫；減少時有殘影） */
  set value(v: number) {
    const old = this.shown ?? this.value;
    const next = Math.min(this.max, Math.max(this.min, Number.isFinite(v) ? v : this.min));
    if (next === this.value && this.raw.value !== undefined) return;
    this.raw.value = String(next);
    if (this.shown === null) this.shown = old;
    if (next < old && this.attrs.trailColor !== 'none') {
      this.trail = Math.max(this.trail ?? old, old);
      this.trailHold = 0.35;
    }
    this.ctx.animate?.(this);
    this.ctx.damage?.(this, 20);
    this.ctx.invalidate?.();
  }

  /** 顯示的比例 0~1（動畫中的值） */
  get ratio(): number {
    return ((this.shown ?? this.value) - this.min) / (this.max - this.min);
  }

  /** 進度條上的文字：{value} {max} {min} {percent} */
  get displayText(): string {
    const v = this.value;
    return (this.attrs.textFormat ?? '{value} / {max}')
      .replace('{value}', String(Math.round(v * 100) / 100))
      .replace('{max}', String(this.max))
      .replace('{min}', String(this.min))
      .replace('{percent}', `${Math.round(((v - this.min) / (this.max - this.min)) * 100)}%`);
  }

  override tick(dt: number): boolean {
    const target = this.value;
    const tau = num(this.attrs.animate, 0.25) / 3;
    const range = this.max - this.min;
    let shown = approach(this.shown ?? target, target, dt, tau);
    if (Math.abs(shown - target) < range * 0.001) shown = target;
    this.shown = shown;
    if (this.trail !== null) {
      if (this.trailHold > 0) this.trailHold -= dt;
      else this.trail = approach(this.trail, shown, dt, tau * 2);
      if (this.trail <= shown + range * 0.002) this.trail = null;
    }
    this.ctx.damage?.(this, 4);
    return shown !== target || this.trail !== null;
  }

  /** 環狀：從 12 點鐘（加上 startAngle 度）順時針填滿；中間可以顯示文字 */
  private paintRadial(ctx: Context2D, x: number, y: number, w: number, h: number): void {
    const a = this.attrs;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const ring = Math.max(1, num(a.ringWidth, 7));
    const r = Math.max(1, Math.min(w, h) / 2 - ring / 2);
    const start = -Math.PI / 2 + (num(a.startAngle, 0) * Math.PI) / 180;
    const range = this.max - this.min;
    const ratio = Math.min(1, Math.max(0, this.ratio));
    const arc = (from: number, to: number, style: string | CanvasGradient, cap: CanvasLineCap) => {
      if (to - from <= 0.0005) return;
      ctx.strokeStyle = style;
      ctx.lineCap = cap;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start + from * Math.PI * 2, start + to * Math.PI * 2);
      ctx.stroke();
    };
    ctx.lineWidth = ring;
    ctx.strokeStyle = a.trackColor ?? 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (this.trail !== null) {
      const tr = Math.min(1, Math.max(0, (this.trail - this.min) / range));
      arc(ratio, tr, a.trailColor ?? 'rgba(255,255,255,0.6)', 'butt');
    }
    // 兩色漸層：沿著圓周（支援 conic 漸層時），否則上下漸層
    const parts = (a.fill ?? '#9acd32')
      .split(/,(?![^(]*\))/)
      .map((c) => c.trim())
      .filter(Boolean);
    let style: string | CanvasGradient = parts[0] ?? '#9acd32';
    if (parts.length > 1) {
      const conic = (ctx as CanvasRenderingContext2D).createConicGradient?.(start, cx, cy);
      const g = conic ?? ctx.createLinearGradient(cx, cy - r, cx, cy + r);
      parts.forEach((c, i) =>
        g.addColorStop(
          conic ? (i / (parts.length - 1)) * Math.min(0.999, Math.max(ratio, 0.001)) : i / (parts.length - 1),
          c,
        ),
      );
      // 起點的圓頭會畫在 12 點鐘「之前」（漸層的尾端）：尾端回到起始色，才不會露出結尾的顏色
      if (conic) g.addColorStop(1, parts[0]);
      style = g;
    }
    // 滿的時候不要圓頭（頭尾會重疊）
    arc(0, ratio, style, ratio >= 0.999 ? 'butt' : 'round');
    if (bool(a.showText)) {
      ctx.font = uiFont(num(a.fontSize, 14), 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = a.color ?? '#ffffff';
      ctx.fillText(this.displayText, cx, cy + 0.5);
    }
  }

  override paintContent(ctx: Context2D, x: number, y: number, w: number, h: number): void {
    if (this.radial) {
      this.paintRadial(ctx, x, y, w, h);
      return;
    }
    const a = this.attrs;
    const vertical = this.vertical;
    const r = Math.min(num(a.radius, 7), w / 2, h / 2);
    const part = (from: number, to: number): [number, number, number, number] =>
      vertical ? [x, y + h * (1 - to), w, h * (to - from)] : [x + w * from, y, w * (to - from), h];
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.fillStyle = a.trackColor ?? 'rgba(255,255,255,0.14)';
    ctx.fillRect(x, y, w, h);
    const ratio = Math.min(1, Math.max(0, this.ratio));
    if (this.trail !== null) {
      const tr = Math.min(1, Math.max(0, (this.trail - this.min) / (this.max - this.min)));
      ctx.fillStyle = a.trailColor ?? 'rgba(255,255,255,0.6)';
      ctx.fillRect(...part(ratio, tr));
    }
    if (ratio > 0) {
      ctx.fillStyle = vertical
        ? fillStyle(ctx, a.fill ?? '#9acd32', x, y + h, x, y)
        : fillStyle(ctx, a.fill ?? '#9acd32', x, y, x + w, y);
      const [px, py, pw, ph] = part(0, ratio);
      roundRectPath(ctx, px, py, pw, ph, r);
      ctx.fill();
      // 上緣的亮光，看起來比較立體
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      if (vertical) ctx.fillRect(px, py, pw * 0.4, ph);
      else ctx.fillRect(px, py, pw, ph * 0.4);
    }
    ctx.restore();
    if (bool(a.showText) && !vertical) {
      const size = num(a.fontSize, 11);
      ctx.font = uiFont(size, 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = a.color ?? '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 2;
      ctx.fillText(this.displayText, x + w / 2, y + h / 2 + 0.5);
    }
  }
}

/**
 * 開關：比勾選框更像遊戲設定的切換開關（點擊切換，觸發 change 事件）。
 * @example <UIToggle id="vsync" text="垂直同步" checked="true" onChange="setVsync"/>
 */
export class UIToggle extends UICheckBox {
  /** 圓鈕位置 0（關）~ 1（開），切換時有動畫 */
  knob = 0;

  override defaults(): Attrs {
    return { ...super.defaults(), boxSize: '24', switchWidth: '42', offColor: 'rgba(255,255,255,0.18)' };
  }

  override resolve(): void {
    super.resolve();
    this.knob = this.checked ? 1 : 0;
  }

  protected override toggle(): void {
    const from = this.knob;
    super.toggle();
    this.knob = from; // 從原本的位置滑過去
    this.ctx.animate?.(this);
  }

  override tick(dt: number): boolean {
    const target = this.checked ? 1 : 0;
    this.knob = approach(this.knob, target, dt, 0.045);
    if (Math.abs(this.knob - target) < 0.01) this.knob = target;
    this.ctx.damage?.(this.indicator, 4);
    return this.knob !== target;
  }
}

/**
 * 內建向量圖示（不需要圖檔，可換顏色）。名稱見 ICON_NAMES。
 * @example <UIIcon name="heart" size="20" color="#ff5a5a"/>
 */
export class UIIcon extends UIElement {
  override defaults(): Attrs {
    return { name: 'star', size: '24', color: '#ffffff', strokeWidth: '2' };
  }

  override applyLayout(): void {
    super.applyLayout();
    const a = this.attrs;
    const size = num(a.size, 24);
    // 用 left + right（或 top + bottom）撐開時不指定尺寸
    if (a.width === undefined && !(a.left !== undefined && a.right !== undefined)) this.node.setWidth(size);
    if (a.height === undefined && !(a.top !== undefined && a.bottom !== undefined)) this.node.setHeight(size);
    this.node.setFlexShrink(0);
  }

  override paintContent(ctx: Context2D, x: number, y: number, w: number, h: number): void {
    const a = this.attrs;
    if (!drawIcon(ctx, a.name ?? '', x, y, w, h, a.color ?? '#ffffff', num(a.strokeWidth, 2))) {
      // 不認識的名稱：畫一個問號框，方便發現打錯字
      ctx.strokeStyle = 'rgba(255,159,67,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = 'rgba(255,159,67,0.9)';
      ctx.font = uiFont(Math.min(w, h) * 0.6, 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x + w / 2, y + h / 2);
    }
  }
}
