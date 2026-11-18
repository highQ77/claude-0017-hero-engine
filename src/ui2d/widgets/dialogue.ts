/** 進階介面元件：RPG 對話框 */
import { UIButton, UIElement, UIImage, UILabel, UILayout, type Attrs, type UIContext } from '../elements';
import { bool, num, type Context2D } from '../draw';
import { UIRichText } from '../richtext';
import type { XmlNode } from '../xml';
import { createLogger } from '../../core/Logger';

const log = createLogger('ui2d');

/** 對話選項 */
export interface DialogChoice {
  /** 選項的值（choose 事件的 value） */
  value: string;
  /** 顯示的文字 */
  label: string;
}

/**
 * RPG 對話框：頭像、名字、逐字打字效果、選項。對話內容支援多樣式文字標記（[b]、[color=#f55]、[icon=coin]…）。
 * 點擊對話框：打字中 → 直接顯示全部；已顯示 → 觸發 next 事件。選了選項觸發 choose 事件（event.value）。
 * @example
 * <UIDialogue id="talk" speaker="村長" portrait="chief.png">歡迎來到村子！
 *   <UIChoice value="quest">有什麼任務嗎？</UIChoice>
 *   <UIChoice value="bye">再見</UIChoice>
 * </UIDialogue>
 * // 程式：ui.require<UIDialogue>('talk').say('勇者，請幫幫我們！', { choices: [...] })
 */
export class UIDialogue extends UIElement {
  /** 頭像 */
  readonly portrait: UIImage;
  /** 對話內容區 */
  readonly body: UILayout;
  /** 說話者名稱 */
  readonly nameLabel: UILabel;
  /** 對話內容（多樣式文字：可以用 [b]、[color=…]、[icon=…] 等標記） */
  readonly textLabel: UIRichText;
  /** 選項區 */
  readonly choiceBox: UILayout;
  /** 目前的選項 */
  choices: DialogChoice[] = [];
  /** 已顯示的字數（打字中為小數） */
  private shownChars = Infinity;
  private blink = 0;
  private blinkOn = true;

  constructor(ctx: UIContext, type: string, raw: Attrs = {}, text = '') {
    super(ctx, type, raw);
    this.portrait = new UIImage(ctx, 'UIImage', { width: '88', height: '88', fit: 'cover', radius: '10' });
    this.body = new UILayout(ctx, 'UIDialogBody', { dir: 'v', gap: '6', grow: '1', shrink: '1', basis: '0' });
    this.nameLabel = new UILabel(ctx, 'UILabel', { fontSize: '15', fontWeight: 'bold' });
    this.textLabel = new UIRichText(ctx, 'UIRichText', { fontSize: '17', lineHeight: '1.55' }, raw.text ?? text);
    this.choiceBox = new UILayout(ctx, 'UIDialogChoices', { dir: 'v', gap: '6', marginTop: '6' });
    this.body.add(this.nameLabel);
    this.body.add(this.textLabel);
    this.body.add(this.choiceBox);
    this.add(this.portrait);
    this.add(this.body);
    if (bool(raw.autoplay)) this.shownChars = 0;
  }

  override defaults(): Attrs {
    return {
      dir: 'h',
      gap: '14',
      padding: '16 18',
      align: 'start',
      minHeight: '110',
      background: 'rgba(14,17,12,0.94)',
      radius: '14',
      border: '1 rgba(255,255,255,0.12)',
      shadow: '0 10 30 rgba(0,0,0,0.45)',
      nameColor: '#ffd75e',
      color: '#ffffff',
      speed: '40',
      cursor: 'pointer',
      accent: '#9acd32',
    };
  }

  /** XML 裡的 <UIChoice> */
  override consumeChild(node: XmlNode): boolean {
    if (node.tag !== 'UIChoice') return false;
    this.choices.push({
      value: node.attrs.value ?? node.text,
      label: node.text || node.attrs.label || node.attrs.value || '',
    });
    return true;
  }

  override onBuilt(): void {
    this.rebuildChoices();
    if (this.typing) {
      this.textLabel.revealed = 0;
      this.ctx.animate?.(this);
    }
  }

  /** 目前的對話內容 */
  get text(): string {
    return this.textLabel.text;
  }

  /** 還在逐字顯示 */
  get typing(): boolean {
    return this.shownChars < this.textLabel.length;
  }

  override resolve(): void {
    super.resolve();
    const a = this.attrs;
    this.portrait.raw.src = a.portrait ?? '';
    this.portrait.raw.hidden = a.portrait ? 'false' : 'true';
    this.nameLabel.raw.color = a.nameColor ?? '#ffd75e';
    this.nameLabel.raw.hidden = a.speaker ? 'false' : 'true';
    this.textLabel.raw.color = a.color ?? '#ffffff';
    if (a.fontSize) this.textLabel.raw.fontSize = a.fontSize;
    if (this.nameLabel.text !== (a.speaker ?? '')) this.nameLabel.setText(a.speaker ?? '');
    this.choiceBox.raw.hidden = this.typing || this.choices.length === 0 ? 'true' : 'false';
    // 等待點擊的箭頭要閃爍
    if (!this.typing && this.choices.length === 0) this.ctx.animate?.(this);
  }

  /**
   * 說一段話（逐字顯示）。choices 會在文字顯示完後出現。
   */
  say(text: string, options: { speaker?: string; portrait?: string; choices?: DialogChoice[] } = {}): void {
    if (options.speaker !== undefined) this.raw.speaker = options.speaker;
    if (options.portrait !== undefined) this.raw.portrait = options.portrait;
    this.choices = options.choices ? options.choices.map((c) => ({ ...c })) : [];
    this.textLabel.setText(text);
    this.shownChars = 0;
    this.textLabel.revealed = 0;
    this.rebuildChoices();
    this.resolve();
    this.ctx.requestLayout(true);
    this.ctx.animate?.(this);
  }

  /** 直接顯示全部文字 */
  skip(): void {
    if (!this.typing) return;
    this.finish();
  }

  private finish(): void {
    this.shownChars = Infinity;
    this.textLabel.revealed = Infinity;
    this.choiceBox.raw.hidden = this.choices.length === 0 ? 'true' : 'false';
    this.ctx.requestLayout(true);
    this.ctx.damage?.(this, 8);
    this.emit('done');
  }

  private rebuildChoices(): void {
    for (const c of [...this.choiceBox.children]) c.destroy();
    this.choices.forEach((choice, index) => {
      const b = new UIButton(
        this.ctx,
        'UIButton',
        {
          justify: 'start',
          padding: '8 12',
          radius: '8',
          fontSize: '15',
          background: 'rgba(255,255,255,0.07)',
          hoverBackground: 'rgba(255,255,255,0.16)',
          pressedBackground: 'rgba(255,255,255,0.24)',
        },
        `▸ ${choice.label}`,
      );
      b.on('click', () => this.emit('choose', { value: choice.value, index }));
      this.choiceBox.add(b);
    });
    this.ctx.requestLayout(true);
  }

  override tick(dt: number): boolean {
    if (this.typing) {
      this.shownChars += num(this.attrs.speed, 40) * dt;
      const n = Math.floor(this.shownChars);
      if (n !== this.textLabel.revealed) {
        this.textLabel.revealed = n;
        this.ctx.damage?.(this.textLabel, 4);
      }
      if (!this.typing) this.finish();
      return true;
    }
    // 等待玩家點擊：右下角的箭頭閃爍
    if (this.choices.length > 0 || this.isDestroyed || !this.visible) return false;
    this.blink += dt;
    const on = this.blink % 1 < 0.6;
    if (on !== this.blinkOn) {
      this.blinkOn = on;
      const r = this.absoluteRect;
      this.ctx.damageRect?.({ x: r.x + r.width - 34, y: r.y + r.height - 30, width: 30, height: 28 });
    }
    return true;
  }

  override paintContent(ctx: Context2D, x: number, y: number, w: number, h: number): void {
    if (this.typing || this.choices.length > 0 || !this.blinkOn || !bool(this.attrs.indicator ?? 'true')) return;
    const cx = x + w - 20;
    const cy = y + h - 16;
    ctx.fillStyle = this.attrs.accent ?? '#9acd32';
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 4);
    ctx.lineTo(cx + 6, cy - 4);
    ctx.lineTo(cx, cy + 4);
    ctx.closePath();
    ctx.fill();
  }

  override emit(type: string, extra = {}): void {
    if (type === 'click') {
      super.emit('click', extra);
      if (this.typing) this.skip();
      else if (this.choices.length === 0) super.emit('next', extra);
      return;
    }
    super.emit(type, extra);
  }

  override get interactive(): boolean {
    return true;
  }
}

let legacyDialogWarned = false;

/**
 * 舊名稱 <UIDialog>（已改名為 UIDialogue，避免和一般介面框架的「彈出視窗 Dialog」混淆）。
 * 仍然可以使用，第一次使用時會在主控台提醒改名。
 * @deprecated 請改用 UIDialogue
 */
export class UIDialog extends UIDialogue {
  constructor(ctx: UIContext, type: string, raw: Attrs = {}, text = '') {
    super(ctx, type, raw, text);
    if (!legacyDialogWarned) {
      legacyDialogWarned = true;
      log.warn('<UIDialog> 已改名為 <UIDialogue>（RPG 對話框），舊名稱之後會移除；彈出視窗請用 <UIWindow>');
    }
  }
}
