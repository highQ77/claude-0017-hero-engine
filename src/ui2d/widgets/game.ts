/** 進階介面元件：遊戲用：物品格、冷卻、角標 */
import { UIElement, UIImage, UILabel, type Attrs, type PointerCapture, type Rect, type UIContext } from '../elements';
import { bool, num, roundRectPath, uiFont, type Context2D } from '../draw';
import { UIIcon } from './basic';
import { drawIcon } from '../icons';

/** 物品稀有度的顏色 */
export const RARITY_COLORS: Record<string, string> = {
  common: '#9aa3b2',
  uncommon: '#5fd068',
  rare: '#4f9dff',
  epic: '#b072ff',
  legendary: '#ffb347',
};

/**
 * 物品格：背包、快捷列。顯示圖示（icon 圖檔或 iconName 內建圖示）、數量、稀有度外框。
 * 可以拖曳到另一個物品格：目標觸發 drop 事件（event.source 為來源物品格），來源觸發 dragend。
 * @example <UISlot icon="sword.png" count="3" rarity="epic" onDrop="moveItem" onClick="useItem"/>
 */
export class UISlot extends UIElement {
  /** 物品圖片（iconSrc） */
  readonly image: UIImage;
  /** 內建圖示（iconName） */
  readonly icon: UIIcon;
  /** 數量文字 */
  readonly countLabel: UILabel;
  /** 拖曳中（畫面上有跟著滑鼠的圖示） */
  dragging = false;
  /** 拖曳時滑鼠下的物品格（顯示放置提示） */
  dropTarget = false;

  constructor(ctx: UIContext, type: string, raw: Attrs = {}, _text = '') {
    super(ctx, type, raw);
    this.image = new UIImage(ctx, 'UIImage', {
      position: 'absolute',
      left: '6',
      top: '6',
      right: '6',
      bottom: '6',
      fit: 'contain',
    });
    this.icon = new UIIcon(ctx, 'UIIcon', { position: 'absolute', left: '10', top: '10', right: '10', bottom: '10' });
    this.countLabel = new UILabel(ctx, 'UILabel', {
      position: 'absolute',
      right: '5',
      bottom: '2',
      fontSize: '13',
      fontWeight: 'bold',
      textShadow: '0 1 2 rgba(0,0,0,0.9)',
    });
    this.add(this.image);
    this.add(this.icon);
    this.add(this.countLabel);
  }

  override defaults(): Attrs {
    return {
      width: '56',
      height: '56',
      radius: '10',
      background: 'rgba(255,255,255,0.06)',
      border: '2 rgba(255,255,255,0.14)',
      accent: '#9acd32',
      color: '#ffffff',
      cursor: 'pointer',
      draggable: 'true',
    };
  }

  /** 有沒有放東西 */
  get empty(): boolean {
    return !this.attrs.icon && !this.attrs.iconName;
  }

  /** 數量（count 屬性） */
  get count(): number {
    return num(this.attrs.count, 0);
  }

  override resolve(): void {
    super.resolve();
    const a = this.attrs;
    const rarity = a.rarity ? (RARITY_COLORS[a.rarity] ?? a.rarity) : null;
    if (rarity && this.raw.border === undefined) a.border = `2 ${rarity}`;
    if (bool(a.selected)) a.border = `2 ${a.accent ?? '#9acd32'}`;
    this.image.raw.src = a.icon ?? '';
    this.image.raw.hidden = a.icon ? 'false' : 'true';
    this.icon.raw.name = a.iconName ?? '';
    this.icon.raw.color = a.iconColor ?? rarity ?? '#ffffff';
    this.icon.raw.hidden = a.iconName && !a.icon ? 'false' : 'true';
    const count = a.count ?? '';
    this.countLabel.raw.hidden = count === '' || count === '0' || count === '1' ? 'true' : 'false';
    this.countLabel.raw.color = a.color ?? '#ffffff';
    if (this.countLabel.text !== count) this.countLabel.setText(count);
    // 拖曳中的來源變淡
    this.alpha = this.dragging ? 0.45 : 1;
  }

  /** 設定內容（null 清空） */
  setItem(item: { icon?: string; iconName?: string; count?: number; rarity?: string } | null): void {
    for (const key of ['icon', 'iconName', 'count', 'rarity']) delete this.raw[key];
    if (item) {
      if (item.icon) this.raw.icon = item.icon;
      if (item.iconName) this.raw.iconName = item.iconName;
      if (item.count !== undefined) this.raw.count = String(item.count);
      if (item.rarity) this.raw.rarity = item.rarity;
    }
    this.set('updated', String(Date.now())); // 觸發重新套用
  }

  override paintContent(ctx: Context2D, x: number, y: number, w: number, h: number): void {
    const a = this.attrs;
    const r = num(a.radius, 10);
    const rarity = a.rarity ? (RARITY_COLORS[a.rarity] ?? a.rarity) : null;
    if (rarity && !this.empty) {
      // 稀有度：底部發光
      const g = ctx.createLinearGradient(x, y + h, x, y);
      g.addColorStop(0, `${rarity}55`);
      g.addColorStop(0.7, `${rarity}00`);
      ctx.fillStyle = g;
      roundRectPath(ctx, x, y, w, h, r);
      ctx.fill();
    }
    if (this.dropTarget) {
      ctx.strokeStyle = a.accent ?? '#9acd32';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      roundRectPath(ctx, x - 3, y - 3, w + 6, h + 6, r + 3);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** 拖曳時跟著滑鼠的圖示 */
  private paintGhost(ctx: Context2D, cx: number, cy: number): void {
    const { width: w, height: h } = this.layout;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const a = this.attrs;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(30,36,26,0.92)';
    roundRectPath(ctx, x, y, w, h, num(a.radius, 10));
    ctx.fill();
    ctx.shadowColor = 'transparent';
    const img = a.icon ? this.ctx.imageSource?.(this.image.src) : undefined;
    if (img) {
      const n = this.image.natural;
      const iw = w - 12;
      const ih = h - 12;
      const s = n ? Math.min(iw / n.width, ih / n.height) : 1;
      const dw = n ? n.width * s : iw;
      const dh = n ? n.height * s : ih;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else if (a.iconName) {
      drawIcon(ctx, a.iconName, x + 10, y + 10, w - 20, h - 20, this.icon.attrs.color ?? '#ffffff');
    }
    ctx.restore();
  }

  override pointerDown(px: number, py: number): PointerCapture | null {
    if (bool(this.attrs.disabled)) return null;
    const canDrag = bool(this.attrs.draggable) && !this.empty;
    const key = {};
    let ghost: Rect | null = null;
    let moved = false;
    let over: UISlot | null = null;
    const slotOf = (el: UIElement | null): UISlot | null => {
      for (let e = el; e; e = e.parent) if (e instanceof UISlot) return e;
      return null;
    };
    const setOver = (slot: UISlot | null) => {
      if (slot === over) return;
      if (over) {
        over.dropTarget = false;
        this.ctx.damage?.(over, 8);
      }
      over = slot && slot !== this ? slot : null;
      if (over) {
        over.dropTarget = true;
        this.ctx.damage?.(over, 8);
      }
    };
    const moveGhost = (x: number, y: number) => {
      const { width: w, height: h } = this.layout;
      if (ghost) this.ctx.damageRect?.(ghost);
      ghost = { x: x - w / 2 - 20, y: y - h / 2 - 20, width: w + 40, height: h + 40 };
      this.ctx.damageRect?.(ghost);
      this.ctx.setOverlay?.(key, (ctx) => this.paintGhost(ctx, x, y));
    };
    return {
      move: (x, y, target) => {
        if (!canDrag) return;
        if (!moved && Math.hypot(x - px, y - py) > 6) {
          moved = true;
          this.dragging = true;
          this.alpha = 0.45;
          this.ctx.damage?.(this, 4);
          this.emit('dragstart');
        }
        if (!moved) return;
        moveGhost(x, y);
        setOver(slotOf(target));
        this.ctx.invalidate?.();
      },
      up: (_x, _y, target) => {
        const dropOn = over;
        setOver(null);
        if (ghost) this.ctx.damageRect?.(ghost);
        this.ctx.setOverlay?.(key, null);
        if (!moved) {
          if (slotOf(target) === this) this.emit('click');
          return;
        }
        this.dragging = false;
        this.alpha = 1;
        this.ctx.damage?.(this, 4);
        if (dropOn) dropOn.emit('drop', { source: this });
        this.emit('dragend', { value: dropOn });
        this.ctx.invalidate?.();
      },
      // 拖曳被中斷：物品回到原位，不放到任何格子
      cancel: () => {
        setOver(null);
        if (ghost) this.ctx.damageRect?.(ghost);
        this.ctx.setOverlay?.(key, null);
        if (!moved) return;
        this.dragging = false;
        this.alpha = 1;
        this.ctx.damage?.(this, 4);
        this.emit('dragend', { value: null });
        this.ctx.invalidate?.();
      },
    };
  }

  override get interactive(): boolean {
    return true;
  }
}

/**
 * 冷卻遮罩：放在物品格或按鈕裡，start(秒數) 後顯示扇形遮罩與倒數，結束時觸發 ready 事件。
 * 預設蓋滿父元件；不會擋住點擊。value="0.4" 可以畫一個固定的遮罩（編輯器預覽用）。
 * @example <UISlot iconName="fire"><UICooldown id="fireCd"/></UISlot>  →  ui.require<UICooldown>('fireCd').start(3)
 */
export class UICooldown extends UIElement {
  /** 剩餘秒數 */
  remaining = 0;
  /** 這次冷卻的總秒數 */
  duration = 0;

  override defaults(): Attrs {
    return {
      position: 'absolute',
      left: '0',
      top: '0',
      right: '0',
      bottom: '0',
      maskColor: 'rgba(0,0,0,0.62)',
      showText: 'true',
      fontSize: '15',
      color: '#ffffff',
    };
  }

  /** 開始冷卻 */
  start(seconds: number): void {
    this.duration = this.remaining = Math.max(0, seconds);
    this.ctx.damage?.(this, 2);
    this.ctx.animate?.(this);
    this.ctx.invalidate?.();
  }

  /** 中止冷卻 */
  reset(): void {
    this.remaining = 0;
    this.ctx.damage?.(this, 2);
    this.ctx.invalidate?.();
  }

  /** 冷卻結束了嗎 */
  get ready(): boolean {
    return this.remaining <= 0;
  }

  /** 剩下的比例 1 → 0 */
  get ratio(): number {
    if (this.remaining > 0 && this.duration > 0) return this.remaining / this.duration;
    const fixed = this.attrs.value;
    return fixed !== undefined ? Math.min(1, Math.max(0, num(fixed, 0))) : 0;
  }

  override tick(dt: number): boolean {
    if (this.remaining <= 0) return false;
    this.remaining = Math.max(0, this.remaining - dt);
    this.ctx.damage?.(this, 2);
    if (this.remaining === 0) {
      this.emit('ready');
      return false;
    }
    return true;
  }

  override paintContent(ctx: Context2D, x: number, y: number, w: number, h: number): void {
    const ratio = this.ratio;
    if (ratio <= 0) return;
    const r = num(this.attrs.radius ?? this.parent?.attrs.radius, 0);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const R = Math.hypot(w, h);
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.clip();
    // 從 12 點鐘方向順時針：已經過的部分變亮，剩下的部分是遮罩
    const start = -Math.PI / 2 + (1 - ratio) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, start, -Math.PI / 2 + Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = this.attrs.maskColor ?? 'rgba(0,0,0,0.62)';
    ctx.fill();
    // 掃過的邊線
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(start) * R, cy + Math.sin(start) * R);
    ctx.stroke();
    ctx.restore();
    if (bool(this.attrs.showText) && this.remaining > 0) {
      const t = this.remaining >= 1 ? String(Math.ceil(this.remaining)) : this.remaining.toFixed(1);
      ctx.font = uiFont(num(this.attrs.fontSize, 15), 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.attrs.color ?? '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 3;
      ctx.fillText(t, cx, cy);
    }
  }

  override get interactive(): boolean {
    return false;
  }
}

/**
 * 角標：紅點或數字通知，預設放在父元件右上角。value 為 0 時隱藏（showZero="true" 可以顯示）。
 * 超過 max（預設 99）顯示「99+」；dot="true" 只顯示一個點。
 * @example <UIButton text="任務"><UIBadge value="3"/></UIButton>
 */
export class UIBadge extends UILabel {
  constructor(ctx: UIContext, type: string, raw: Attrs = {}, text = '') {
    super(ctx, type, raw, raw.value ?? text);
  }

  override defaults(): Attrs {
    const dot = bool(this.raw.dot);
    return {
      ...super.defaults(),
      position: 'absolute',
      top: dot ? '-3' : '-7',
      right: dot ? '-3' : '-7',
      background: '#ff4d4f',
      color: '#ffffff',
      fontSize: '11',
      fontWeight: 'bold',
      lineHeight: '1.45',
      radius: '10',
      padding: dot ? '0' : '0 5',
      minWidth: dot ? '10' : '18',
      textAlign: 'center',
      border: '2 rgba(16,18,14,0.9)',
      max: '99',
      ...(dot ? { width: '10', height: '10' } : {}),
    };
  }

  /** 數值（非數字的文字也可以，例如 NEW） */
  get value(): string {
    return this.raw.value ?? this.text;
  }

  /** 設定數字，回傳自己（可以串接） */
  setValue(v: string | number): this {
    return this.set('value', String(v)) as this;
  }

  override resolve(): void {
    super.resolve();
    const v = this.raw.value ?? this.text;
    const n = Number(v);
    const max = num(this.attrs.max, 99);
    const display = bool(this.attrs.dot) ? '' : Number.isFinite(n) && v !== '' && n > max ? `${max}+` : v;
    if (display !== this.text) {
      this.text = display;
      this.node.markDirty();
    }
    // 保留原本的值（顯示文字可能被改成 99+）
    if (this.raw.value === undefined) this.raw.value = v;
  }

  override get visible(): boolean {
    const v = this.raw.value ?? this.text;
    const zero = v === '' || v === '0';
    return super.visible && (bool(this.attrs.dot) || !zero || bool(this.attrs.showZero));
  }

  override set visible(v: boolean) {
    super.visible = v;
  }

  override get interactive(): boolean {
    return false;
  }
}
