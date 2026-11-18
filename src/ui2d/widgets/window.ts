/** 進階介面元件：視窗 */
import { UIButton, UIElement, UILabel, UILayout, type Attrs, type PointerCapture, type UIContext } from '../elements';
import { bool, num } from '../draw';

/**
 * 視窗：有標題列與關閉鈕的對話框，可以拖曳標題列移動（closable、draggable）。
 * 裡面寫的元件會放進內容區。關閉時觸發 close 事件。
 * @example
 * <UIWindow id="settings" title="設定" position="absolute" left="40" top="40" width="320">
 *   <UILabel>內容</UILabel>
 * </UIWindow>
 */
export class UIWindow extends UIElement {
  /** 標題列 */
  readonly header: UILayout;
  /** 標題文字 */
  readonly titleLabel: UILabel;
  /** 關閉鈕 */
  readonly closeButton: UIButton;
  /** 內容區 */
  readonly body: UILayout;

  constructor(ctx: UIContext, type: string, raw: Attrs = {}, _text = '') {
    super(ctx, type, raw);
    this.header = new UILayout(ctx, 'UIWindowHeader', {
      dir: 'h',
      align: 'center',
      justify: 'between',
      padding: '7 8 7 16',
      gap: '8',
    });
    this.titleLabel = new UILabel(ctx, 'UILabel', { fontSize: '16', fontWeight: 'bold' }, raw.title ?? '');
    // 關閉鈕：至少 34×34，看得出是按鈕（點擊範圍夠大，不會誤點到標題列）
    this.closeButton = new UIButton(
      ctx,
      'UIButton',
      {
        text: '✕',
        width: '34',
        height: '34',
        padding: '0',
        background: 'rgba(255,255,255,0.06)',
        hoverBackground: 'rgba(255,107,107,0.22)',
        pressedBackground: 'rgba(255,107,107,0.36)',
        fontSize: '16',
        radius: '8',
        color: '#dfe5d6',
        shrink: '0',
        tooltip: '關閉（Esc）',
      },
      '✕',
    );
    this.closeButton.on('click', () => this.close());
    this.header.add(this.titleLabel);
    this.header.add(this.closeButton);
    this.body = new UILayout(ctx, 'UIWindowBody', { dir: 'v', padding: '4 16 16', gap: '10', grow: '1' });
    this.add(this.header);
    this.add(this.body);
  }

  override defaults(): Attrs {
    return {
      dir: 'v',
      minWidth: '220',
      background: 'rgba(20,24,18,0.96)',
      radius: '12',
      border: '1 rgba(255,255,255,0.12)',
      shadow: '0 12 36 rgba(0,0,0,0.5)',
      headerBackground: 'rgba(255,255,255,0.04)',
      color: '#ffffff',
      closable: 'true',
      draggable: 'true',
    };
  }

  override get contentParent(): UIElement {
    return this.body;
  }

  override resolve(): void {
    super.resolve();
    // 子元件在之後才 resolve：先把設定寫進它們的屬性
    const a = this.attrs;
    const r = num(a.radius, 12);
    this.header.raw.background = a.headerBackground ?? 'transparent';
    this.header.raw.radius = String(r);
    this.titleLabel.raw.color = a.titleColor ?? a.color ?? '#ffffff';
    this.closeButton.raw.hidden = bool(a.closable) ? 'false' : 'true';
    if (this.titleLabel.text !== (a.title ?? '')) this.titleLabel.setText(a.title ?? '');
  }

  /** 打開（顯示） */
  open(): void {
    if (this.visible) return;
    this.visible = true;
    this.emit('open');
  }

  /** 關閉（隱藏，觸發 close 事件） */
  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.emit('close');
  }

  /** 拖曳標題列移動（不改變排版，只改位移；不會被拖出畫面） */
  override pointerDown(px: number, py: number): PointerCapture | null {
    if (!bool(this.attrs.draggable)) return null;
    const h = this.header.absoluteRect;
    const c = this.closeButton.absoluteRect;
    if (px < h.x || px > h.x + h.width || py < h.y || py > h.y + h.height) return null;
    if (this.closeButton.visible && px >= c.x && px <= c.x + c.width && py >= c.y && py <= c.y + c.height) return null;
    const start = { x: this.offsetX, y: this.offsetY, px, py };
    return {
      move: (x, y) => {
        const vp = this.ctx.viewport?.() ?? { width: Infinity, height: Infinity };
        const base = this.absoluteRect;
        this.ctx.damage?.(this, 40);
        let ox = start.x + x - start.px;
        let oy = start.y + y - start.py;
        // 標題列至少留 40px 在畫面內
        const bx = base.x - this.offsetX;
        const by = base.y - this.offsetY;
        ox = Math.min(vp.width - 40 - bx, Math.max(40 - base.width - bx, ox));
        oy = Math.min(vp.height - 30 - by, Math.max(-by, oy));
        this.offsetX = ox;
        this.offsetY = oy;
        this.ctx.damage?.(this, 40);
        this.ctx.invalidate?.();
      },
      up: () => this.emit('move', { value: { x: this.offsetX, y: this.offsetY } }),
    };
  }

  override get interactive(): boolean {
    return true;
  }
}
