/** 進階介面元件：提示訊息 */
import { UILabel, UILayout, type Attrs } from '../elements';
import { num } from '../draw';
import { UIIcon } from './basic';

/** 提示訊息的設定 */
export interface ToastOptions {
  /** 前面的圖示名稱（UIIcon） */
  icon?: string;
  /** 圖示顏色 */
  color?: string;
  /** 顯示幾秒（預設 2.5） */
  duration?: number;
  /** 背景顏色 */
  background?: string;
}

/**
 * 提示訊息：「獲得金幣 ×10」「存檔完成」，自動淡入淡出、可以疊好幾則。
 * 放在介面裡一次（預設在畫面上方中央），之後用 ui.toast('文字') 或 toastEl.show('文字')。
 * @example <UIToast id="toast" placement="top"/>
 */
export class UIToast extends UILayout {
  private readonly items: { el: UILayout; age: number; life: number }[] = [];

  override defaults(): Attrs {
    const bottom = this.raw.placement === 'bottom';
    return {
      dir: 'v',
      position: 'absolute',
      left: '0',
      right: '0',
      align: 'center',
      gap: '8',
      ...(bottom ? { bottom: '24' } : { top: '16' }),
      max: '4',
      itemBackground: 'rgba(16,20,14,0.92)',
      accent: '#9acd32',
      fontSize: '15',
      color: '#ffffff',
    };
  }

  /** 訊息由 show() 產生，不是放子元件的容器 */
  override get acceptsChildren(): boolean {
    return false;
  }

  /** 目前顯示中的訊息數 */
  get count(): number {
    return this.items.length;
  }

  /**
   * 顯示一則提示訊息
   * @param text 訊息文字
   * @param options 圖示、顏色、顯示幾秒、背景顏色
   */
  show(text: string, options: ToastOptions = {}): void {
    const a = this.attrs;
    const item = new UILayout(this.ctx, 'UIToastItem', {
      dir: 'h',
      align: 'center',
      gap: '8',
      padding: '10 16',
      radius: '10',
      background: options.background ?? a.itemBackground ?? 'rgba(16,20,14,0.92)',
      border: '1 rgba(255,255,255,0.10)',
      shadow: '0 6 18 rgba(0,0,0,0.4)',
    });
    if (options.icon)
      item.add(
        new UIIcon(this.ctx, 'UIIcon', {
          name: options.icon,
          size: '18',
          color: options.color ?? a.accent ?? '#9acd32',
        }),
      );
    item.add(new UILabel(this.ctx, 'UILabel', { fontSize: a.fontSize ?? '15', color: a.color ?? '#ffffff' }, text));
    item.walk((e) => e.resolve());
    item.alpha = 0;
    const bottom = a.placement === 'bottom';
    // 新的訊息靠近畫面邊緣
    this.add(item, bottom ? this.children.length : 0);
    this.items.push({ el: item, age: 0, life: options.duration ?? 2.5 });
    const max = Math.max(1, Math.floor(num(a.max, 4)));
    while (this.items.length > max) this.items.shift()!.el.destroy();
    this.ctx.requestLayout(true);
    this.ctx.animate?.(this);
  }

  override tick(dt: number): boolean {
    const bottom = this.attrs.placement === 'bottom';
    for (const it of [...this.items]) {
      it.age += dt;
      const enter = Math.min(1, it.age / 0.22);
      const exit = Math.min(1, Math.max(0, (it.life - it.age) / 0.4));
      it.el.alpha = Math.min(enter, exit);
      it.el.offsetY = (1 - enter) * (bottom ? 10 : -10);
      if (it.age >= it.life) {
        this.items.splice(this.items.indexOf(it), 1);
        it.el.destroy();
        this.ctx.requestLayout(true);
      }
    }
    this.ctx.damage?.(this, 24);
    return this.items.length > 0;
  }
}
