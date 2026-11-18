/**
 * 多樣式文字（UIRichText）：BBCode 風格的標記，支援打字機效果（revealed）。
 */
import { MeasureMode } from 'yoga-layout/load';
import { UIElement, type Attrs, type UIContext } from './elements';
import { num, UI_FONT_FAMILY, type Context2D } from './draw';
import { drawIcon } from './icons';
import { tokenize, type FontSpec } from './text';

// ═════════════════════════ UIRichText ═════════════════════════

interface RichStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string | null;
  size: number | null;
  background: string | null;
}

type RichItem =
  | { kind: 'text'; text: string; style: RichStyle }
  | { kind: 'icon'; name: string; color: string | null; style: RichStyle }
  | { kind: 'br' };

interface PlacedItem {
  item: Exclude<RichItem, { kind: 'br' }>;
  text: string;
  x: number;
  width: number;
  size: number;
}

interface RichLine {
  items: PlacedItem[];
  width: number;
  height: number;
  /** 這一行最大的字級（決定基線） */
  maxSize: number;
}

/**
 * 解析 BBCode 風格的標記：
 * [b]粗體[/b] [i]斜體[/i] [u]底線[/u] [s]刪除線[/s] [color=#f55]顏色[/color] [size=22]大小[/size]
 * [bg=#333]底色[/bg] [icon=fire] [icon=coin color=#ffd75e] [br] 換行；[[ 代表一個 [
 */
export function parseRichText(markup: string): RichItem[] {
  const items: RichItem[] = [];
  const stack: RichStyle[] = [
    { bold: false, italic: false, underline: false, strike: false, color: null, size: null, background: null },
  ];
  const style = () => stack[stack.length - 1];
  const push = (patch: Partial<RichStyle>) => stack.push({ ...style(), ...patch });
  const text = (t: string) => {
    if (!t) return;
    const last = items[items.length - 1];
    if (last?.kind === 'text' && last.style === style()) last.text += t;
    else items.push({ kind: 'text', text: t, style: style() });
  };
  const re = /\[\[|\[(\/?)(b|i|u|s|color|size|bg|icon|br)(?:=([^\]\s]*))?((?:\s+\w+=[^\]\s]*)*)\]/gi;
  let last = 0;
  for (let m = re.exec(markup); m; m = re.exec(markup)) {
    text(markup.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[0] === '[[') {
      text('[');
      continue;
    }
    const [, close, rawTag, value, extra] = m;
    const tag = rawTag.toLowerCase();
    if (tag === 'br') {
      items.push({ kind: 'br' });
      continue;
    }
    if (tag === 'icon') {
      const color = /color=([^\s\]]+)/.exec(extra ?? '')?.[1] ?? null;
      items.push({ kind: 'icon', name: value ?? '', color, style: style() });
      continue;
    }
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (tag === 'b') push({ bold: true });
    else if (tag === 'i') push({ italic: true });
    else if (tag === 'u') push({ underline: true });
    else if (tag === 's') push({ strike: true });
    else if (tag === 'color') push({ color: value || null });
    else if (tag === 'size') push({ size: Number.isFinite(parseFloat(value ?? '')) ? parseFloat(value!) : null });
    else if (tag === 'bg') push({ background: value || null });
  }
  text(markup.slice(last));
  return items;
}

/**
 * 多樣式文字：同一段文字裡可以混用粗體、顏色、大小、圖示，會自動換行。
 * 標記語法見 parseRichText（[b] [color=#f55] [size=22] [icon=fire] [br] …）。
 * @example <UIRichText>造成 [b][color=#ff6b6b]120[/color][/b] 點 [icon=fire color=#ffb347] 火焰傷害</UIRichText>
 */
export class UIRichText extends UIElement {
  /** 標記文字（[b]、[color=…]、[icon=…]） */
  markup: string;
  private items: RichItem[] = [];
  /** 排版後的每一行 */
  lines: RichLine[] = [];
  /** 只顯示前幾個字（打字機效果；圖示算一個字；排版仍以完整內容計算，不會跳動） */
  revealed = Infinity;

  constructor(ctx: UIContext, type: string, raw: Attrs = {}, text = '') {
    super(ctx, type, raw);
    this.markup = raw.text ?? text;
    this.items = parseRichText(this.markup);
    this.node.setMeasureFunc((width, widthMode) => {
      const max = widthMode === MeasureMode.Undefined ? Infinity : width;
      const lines = this.layoutLines(max);
      const w = lines.reduce((m, l) => Math.max(m, l.width), 0);
      const h = lines.reduce((s, l) => s + l.height, 0);
      return { width: widthMode === MeasureMode.Exactly ? width : Math.min(Math.ceil(w), max), height: Math.ceil(h) };
    });
  }

  override defaults(): Attrs {
    return { fontSize: '16', color: '#ffffff', lineHeight: '1.5', fontWeight: 'normal' };
  }

  /** 換內容（標記語法） */
  setText(markup: string): this {
    if (markup === this.markup) return this;
    this.markup = markup;
    this.items = parseRichText(markup);
    this.ctx.damage?.(this);
    this.node.markDirty();
    this.ctx.requestLayout();
    return this;
  }

  /** 可以逐字顯示的單位數（文字的字數 + 圖示數） */
  get length(): number {
    let n = 0;
    for (const i of this.items) n += i.kind === 'text' ? [...i.text].length : i.kind === 'icon' ? 1 : 0;
    return n;
  }

  /** 和 UILabel 一樣可以讀 text（標記原文） */
  get text(): string {
    return this.markup;
  }

  /** 去掉標記後的純文字 */
  get plainText(): string {
    return this.items.map((i) => (i.kind === 'text' ? i.text : i.kind === 'br' ? '\n' : '')).join('');
  }

  private font(style: RichStyle): FontSpec {
    const base = this.attrs.fontWeight ?? 'normal';
    return {
      size: style.size ?? num(this.attrs.fontSize, 16),
      family: this.attrs.fontFamily ?? UI_FONT_FAMILY,
      weight: `${style.italic ? 'italic ' : ''}${style.bold ? 'bold' : base}`,
      lineHeight: num(this.attrs.lineHeight, 1.5),
    };
  }

  /** 依寬度排版成好幾行 */
  private layoutLines(maxWidth: number): RichLine[] {
    const lh = num(this.attrs.lineHeight, 1.5);
    const baseSize = num(this.attrs.fontSize, 16);
    const lines: RichLine[] = [];
    let line: RichLine = { items: [], width: 0, height: 0, maxSize: baseSize };
    const finish = () => {
      // 行尾空白不算寬度
      const lastItem = line.items[line.items.length - 1];
      if (lastItem?.item.kind === 'text' && lastItem.text.endsWith(' ')) {
        const trimmed = lastItem.text.trimEnd();
        const w = this.ctx.measure(trimmed, this.font(lastItem.item.style));
        line.width -= lastItem.width - w;
        lastItem.text = trimmed;
        lastItem.width = w;
      }
      line.height = line.maxSize * lh;
      lines.push(line);
      line = { items: [], width: 0, height: 0, maxSize: baseSize };
    };
    const place = (item: PlacedItem['item'], text: string, width: number, size: number) => {
      if (line.items.length > 0 && line.width + width > maxWidth + 0.5) {
        finish();
        if (text.trim() === '' && item.kind === 'text') return; // 新的一行不要以空白開頭
        text = text.replace(/^ +/, '');
        if (item.kind === 'text') width = this.ctx.measure(text, this.font(item.style));
      }
      line.items.push({ item, text, x: line.width, width, size });
      line.width += width;
      line.maxSize = Math.max(line.maxSize, size);
    };
    for (const item of this.items) {
      if (item.kind === 'br') {
        finish();
        continue;
      }
      if (item.kind === 'icon') {
        const size = (item.style.size ?? baseSize) * 1.1;
        place(item, '', size + 2, item.style.size ?? baseSize);
        continue;
      }
      const font = this.font(item.style);
      for (const token of tokenize(item.text)) place(item, token, this.ctx.measure(token, font), font.size);
    }
    if (line.items.length > 0 || lines.length === 0) finish();
    // 同一行同樣式的片段合併（繪圖次數少一點）
    for (const l of lines) {
      const merged: PlacedItem[] = [];
      for (const p of l.items) {
        const prev = merged[merged.length - 1];
        if (prev && p.item.kind === 'text' && prev.item === p.item && Math.abs(prev.x + prev.width - p.x) < 0.01) {
          prev.text += p.text;
          prev.width += p.width;
        } else merged.push({ ...p });
      }
      l.items = merged;
    }
    return lines;
  }

  override applyLayout(): void {
    super.applyLayout();
    this.node.markDirty(); // 字型屬性可能改變
  }

  override readLayout(): void {
    super.readLayout();
    const p = this.padding;
    this.lines = this.layoutLines(Math.max(0, this.layout.width - p.left - p.right) + 0.5);
  }

  override paintContent(ctx: Context2D, bx: number, by: number, bw: number): void {
    // 畫在內距裡面
    const pad = this.padding;
    const x = bx + pad.left;
    const y = by + pad.top;
    const w = bw - pad.left - pad.right;
    const align = this.attrs.textAlign ?? 'left';
    const baseColor = this.attrs.color ?? '#ffffff';
    let top = y;
    let budget = this.revealed;
    for (const line of this.lines) {
      if (budget <= 0) break;
      const ox = align === 'center' ? (w - line.width) / 2 : align === 'right' ? w - line.width : 0;
      const baseline = top + (line.height - line.maxSize) / 2 + line.maxSize * 0.82;
      for (const p of line.items) {
        if (budget <= 0) break;
        const px = x + ox + p.x;
        const style = p.item.style;
        const color = (p.item.kind === 'icon' ? p.item.color : null) ?? style.color ?? baseColor;
        if (style.background) {
          ctx.fillStyle = style.background;
          ctx.fillRect(px - 1, baseline - p.size * 0.95, p.width + 2, p.size * 1.25);
        }
        if (p.item.kind === 'icon') {
          budget -= 1;
          const s = p.size * 1.1;
          drawIcon(ctx, p.item.name, px + 1, baseline - s * 0.86, s, s, color);
          continue;
        }
        // 打字機效果：這一段只畫前面幾個字
        const chars = [...p.text];
        const shown = chars.length > budget ? chars.slice(0, budget).join('') : p.text;
        budget -= chars.length;
        ctx.font = `${this.font(style).weight} ${p.size}px ${this.attrs.fontFamily ?? UI_FONT_FAMILY}`;
        const width = shown === p.text ? p.width : ctx.measureText(shown).width;
        ctx.fillStyle = color;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        ctx.fillText(shown, px, baseline);
        if (style.underline || style.strike) {
          ctx.fillRect(
            px,
            style.underline ? baseline + p.size * 0.12 : baseline - p.size * 0.3,
            width,
            Math.max(1, p.size * 0.07),
          );
        }
      }
      top += line.height;
    }
  }
}
