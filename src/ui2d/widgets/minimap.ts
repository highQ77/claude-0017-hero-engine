/** 進階介面元件：小地圖 */
import { UIElement, type Attrs } from '../elements';
import { bool, num, roundRectPath, uiFont, type Context2D } from '../draw';

/** 小地圖上的標記 */
export interface MinimapMarker {
  /** 世界座標（俯視：x 往右、z 往下） */
  x: number;
  /** 世界座標 Z（俯視時往下） */
  z: number;
  /** 顏色 */
  color?: string;
  /** 形狀 */
  shape?: 'dot' | 'square' | 'diamond' | 'arrow' | 'star';
  /** 大小（像素） */
  size?: number;
  /** 箭頭方向（弧度，0 = 朝 -Z「北方」，順時針為正） */
  heading?: number;
  /** 超出範圍時是否貼在邊緣顯示（任務目標等） */
  pin?: boolean;
}

/**
 * 小地圖：以某個位置為中心的俯視圖，顯示格線與標記。
 * 搭配 MinimapPlugin 可以自動顯示有 MinimapMarker 元件的實體（玩家、敵人、目標）。
 * @example <UIMinimap id="map" width="160" height="160" range="30" rotate="true"/>
 */
export class UIMinimap extends UIElement {
  /** 目前的標記 */
  markers: MinimapMarker[] = [];
  /** 中心的世界座標 X */
  centerX = 0;
  /** 中心的世界座標 Z */
  centerZ = 0;
  /** 中心（玩家）面向（弧度，0 = 北方） */
  heading = 0;

  override defaults(): Attrs {
    const square = this.raw.shape === 'square';
    return {
      width: '160',
      height: '160',
      shape: 'circle',
      range: '30',
      grid: '5',
      rotate: 'false',
      background: 'rgba(12,15,10,0.82)',
      border: '2 rgba(255,255,255,0.22)',
      radius: square ? '12' : '999',
      gridColor: 'rgba(255,255,255,0.07)',
      playerColor: '#9acd32',
      markerColor: '#ffb347',
      markerSize: '6',
      showPlayer: 'true',
    };
  }

  /**
   * 設定中心與面向
   * @param x 中心的世界座標 X
   * @param z 中心的世界座標 Z
   * @param heading 面向（弧度，0 = 北方）
   */
  setView(x: number, z: number, heading = 0): void {
    if (x === this.centerX && z === this.centerZ && heading === this.heading) return;
    this.centerX = x;
    this.centerZ = z;
    this.heading = heading;
    this.invalidate();
  }

  /**
   * 設定標記
   * @param markers 標記：位置、顏色、形狀、大小
   */
  setMarkers(markers: readonly MinimapMarker[]): void {
    this.markers = markers.map((m) => ({ ...m }));
    this.invalidate();
  }

  /**
   * 世界座標 → 小地圖上的位置（相對中心，像素）
   * @param x 世界座標 X
   * @param z 世界座標 Z
   * @param scale 每公尺幾像素
   */
  project(x: number, z: number, scale: number): { px: number; py: number } {
    let dx = (x - this.centerX) * scale;
    let dz = (z - this.centerZ) * scale;
    if (bool(this.attrs.rotate)) {
      const c = Math.cos(this.heading);
      const s = Math.sin(this.heading);
      [dx, dz] = [dx * c + dz * s, -dx * s + dz * c];
    }
    return { px: dx, py: dz };
  }

  override paintContent(ctx: Context2D, x: number, y: number, w: number, h: number): void {
    const a = this.attrs;
    const circle = a.shape !== 'square';
    const cx = x + w / 2;
    const cy = y + h / 2;
    const half = Math.min(w, h) / 2;
    const scale = half / Math.max(1, num(a.range, 30));
    const rotate = bool(a.rotate);
    ctx.save();
    if (circle) {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, half - 1), 0, Math.PI * 2);
    } else {
      roundRectPath(ctx, x, y, w, h, num(a.radius, 12));
    }
    ctx.clip();

    // 格線（跟著世界移動、旋轉）
    const step = num(a.grid, 5);
    if (step > 0) {
      ctx.strokeStyle = a.gridColor ?? 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.save();
      ctx.translate(cx, cy);
      if (rotate) ctx.rotate(-this.heading);
      const extent = Math.hypot(w, h) / scale;
      const x0 = Math.floor((this.centerX - extent) / step) * step;
      const z0 = Math.floor((this.centerZ - extent) / step) * step;
      ctx.beginPath();
      for (let gx = x0; gx <= this.centerX + extent; gx += step) {
        const px = (gx - this.centerX) * scale;
        ctx.moveTo(px, -extent * scale);
        ctx.lineTo(px, extent * scale);
      }
      for (let gz = z0; gz <= this.centerZ + extent; gz += step) {
        const pz = (gz - this.centerZ) * scale;
        ctx.moveTo(-extent * scale, pz);
        ctx.lineTo(extent * scale, pz);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 標記
    for (const m of this.markers) {
      let { px, py } = this.project(m.x, m.z, scale);
      const limit = half - (m.size ?? num(a.markerSize, 6)) - 3;
      const dist = circle ? Math.hypot(px, py) : Math.max(Math.abs(px), Math.abs(py));
      if (dist > limit) {
        if (!m.pin) continue;
        px *= limit / dist;
        py *= limit / dist;
      }
      const heading = m.heading !== undefined ? m.heading - (rotate ? this.heading : 0) : undefined;
      drawMarker(
        ctx,
        cx + px,
        cy + py,
        m.shape ?? (heading !== undefined ? 'arrow' : 'dot'),
        m.size ?? num(a.markerSize, 6),
        m.color ?? a.markerColor ?? '#ffb347',
        heading ?? 0,
      );
    }

    // 中心（玩家）
    if (bool(a.showPlayer))
      drawMarker(ctx, cx, cy, 'arrow', num(a.markerSize, 6) + 2, a.playerColor ?? '#9acd32', rotate ? 0 : this.heading);
    ctx.restore();

    // 北方標示（旋轉模式才需要）
    if (rotate) {
      const nx = cx + Math.sin(-this.heading) * (half - 10);
      const ny = cy - Math.cos(-this.heading) * (half - 10);
      ctx.font = uiFont(11, 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText('N', nx, ny);
    }
  }
}

function drawMarker(
  ctx: Context2D,
  x: number,
  y: number,
  shape: string,
  size: number,
  color: string,
  heading: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (shape === 'arrow') {
    ctx.rotate(heading);
    ctx.moveTo(0, -size * 1.3);
    ctx.lineTo(size, size);
    ctx.lineTo(0, size * 0.45);
    ctx.lineTo(-size, size);
    ctx.closePath();
  } else if (shape === 'square') {
    ctx.rect(-size * 0.8, -size * 0.8, size * 1.6, size * 1.6);
  } else if (shape === 'diamond') {
    ctx.moveTo(0, -size);
    ctx.lineTo(size, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size, 0);
    ctx.closePath();
  } else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? size * 1.2 : size * 0.5;
      const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
      else ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    ctx.closePath();
  } else {
    ctx.arc(0, 0, size * 0.8, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
