/** 進階介面元件：虛擬搖桿 */
import { UIElement, type Attrs, type PointerCapture } from '../elements';
import { num, type Context2D } from '../draw';
import { approach } from './shared';

/**
 * 虛擬搖桿（手機操作）：拖曳圓鈕，event.value 為 { x, y }（-1~1，往右、往下為正）。
 * 拖曳中觸發 input 事件，放開觸發 end 事件；也可以直接讀 joystick.x / joystick.y。
 * @example <UIJoystick id="stick" position="absolute" left="24" bottom="24" onInput="move"/>
 */
export class UIJoystick extends UIElement {
  /** 水平方向（-1 左 ~ 1 右） */
  x = 0;
  /** 垂直方向（-1 上 ~ 1 下） */
  y = 0;
  /** 是否正在拖曳 */
  active = false;
  /** 圓鈕的顯示位置（-1~1，放開時彈回中央） */
  private knobX = 0;
  private knobY = 0;

  override defaults(): Attrs {
    return {
      width: '128',
      height: '128',
      knobSize: '0.42',
      deadzone: '0.12',
      baseColor: 'rgba(255,255,255,0.10)',
      ringColor: 'rgba(255,255,255,0.28)',
      knobColor: 'rgba(255,255,255,0.88)',
      accent: '#9acd32',
      cursor: 'grab',
    };
  }

  private geometry() {
    const r = this.absoluteRect;
    const radius = Math.min(r.width, r.height) / 2;
    const knob = radius * Math.min(0.8, Math.max(0.2, num(this.attrs.knobSize, 0.42)));
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, radius, knob, travel: radius - knob * 0.6 };
  }

  override pointerDown(px: number, py: number): PointerCapture | null {
    const g = this.geometry();
    if (Math.hypot(px - g.cx, py - g.cy) > g.radius * 1.15) return null;
    this.active = true;
    this.update(px, py);
    const release = () => {
      this.active = false;
      this.x = this.y = 0;
      this.emit('input', { value: { x: 0, y: 0 } });
      this.emit('end');
      this.ctx.animate?.(this); // 圓鈕彈回中央
    };
    return { move: (x, y) => this.update(x, y), up: release, cancel: release };
  }

  private update(px: number, py: number): void {
    const g = this.geometry();
    let dx = (px - g.cx) / g.travel;
    let dy = (py - g.cy) / g.travel;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.knobX = dx;
    this.knobY = dy;
    const l = Math.min(1, len);
    const dz = Math.min(0.9, Math.max(0, num(this.attrs.deadzone, 0.12)));
    const k = l < dz ? 0 : (l - dz) / (1 - dz) / (l || 1);
    const x = Math.round(dx * k * 1000) / 1000;
    const y = Math.round(dy * k * 1000) / 1000;
    this.ctx.damage?.(this, 8);
    this.ctx.invalidate?.();
    if (x === this.x && y === this.y) return;
    this.x = x;
    this.y = y;
    this.emit('input', { value: { x, y } });
  }

  override tick(dt: number): boolean {
    if (this.active) return false;
    this.knobX = approach(this.knobX, 0, dt, 0.05);
    this.knobY = approach(this.knobY, 0, dt, 0.05);
    if (Math.hypot(this.knobX, this.knobY) < 0.01) this.knobX = this.knobY = 0;
    this.ctx.damage?.(this, 8);
    return this.knobX !== 0 || this.knobY !== 0;
  }

  override paintContent(ctx: Context2D, x: number, y: number, w: number, h: number): void {
    const a = this.attrs;
    const radius = Math.min(w, h) / 2;
    const knob = radius * Math.min(0.8, Math.max(0.2, num(a.knobSize, 0.42)));
    const travel = radius - knob * 0.6;
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.fillStyle = a.baseColor ?? 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0, radius - 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = a.ringColor ?? 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 方向提示：推動的方向亮起一段弧
    const len = Math.hypot(this.knobX, this.knobY);
    if (this.active && len > 0.2) {
      const ang = Math.atan2(this.knobY, this.knobX);
      ctx.strokeStyle = a.accent ?? '#9acd32';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, radius - 4), ang - 0.5, ang + 0.5);
      ctx.stroke();
    }
    const kx = cx + this.knobX * travel;
    const ky = cy + this.knobY * travel;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = a.knobColor ?? 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.arc(kx, ky, knob * (this.active ? 1.06 : 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  override get interactive(): boolean {
    return true;
  }
}
