/**
 * 畫布合成器：引擎內顯示介面時，UICanvas 直接畫在 three.js 的 WebGL 上（共用模式），
 * 這裡每次繪製時把每個畫布當成一塊四邊形疊在介面圖層上。
 *
 * 和「畫布複製到介面的 2D 畫布、再上傳成貼圖」相比：
 * - 畫布內容改變時，介面不用重畫、也不用重新上傳（四邊形每幀直接讀畫布的 GPU 貼圖）
 * - 不用在好幾個 WebGL context 之間複製畫面、切換 context
 *
 * 疊放順序：介面圖層 → 畫布 → 蓋帽（比畫布晚畫、又和畫布重疊的東西：之後的元件、捲軸、浮動說明、下拉選單）。
 * 蓋帽只在介面重畫時更新，而且只畫畫布那一小塊。
 */
import * as THREE from 'three';
import type { RenderPlugin } from '../render/RenderPlugin';
import { num } from './draw';
import { UIScrollView, type Rect, type UICanvasHost, type UICanvasLayer, type UIElement } from './elements';
import { UIPainter } from './UIPainter';
import type { UI2D } from './UI2D';

const VERTEX = /* glsl */ `
uniform vec4 uBox;   // 畫布在介面上的位置與大小（CSS 像素：x, y, 寬, 高）
varying vec2 vUv;
varying vec2 vPx;
void main() {
  vUv = uv;
  vPx = uBox.xy + vec2(uv.x, 1.0 - uv.y) * uBox.zw;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// 畫布貼圖是預乘 alpha 的 sRGB 值：直接輸出（介面圖層也是 sRGB 值），不做色彩轉換
const FRAGMENT = /* glsl */ `
uniform sampler2D uTex;
uniform vec4 uBox;
uniform vec4 uClip;   // 可以顯示的範圍（CSS 像素：x0, y0, x1, y1）
uniform float uRadius;
uniform float uOpacity;
uniform float uPixelRatio;
varying vec2 vUv;
varying vec2 vPx;
void main() {
  if (vPx.x < uClip.x || vPx.y < uClip.y || vPx.x > uClip.z || vPx.y > uClip.w) discard;
  float cover = 1.0;
  if (uRadius > 0.0) {
    vec2 hs = uBox.zw * 0.5;
    vec2 q = abs(vPx - (uBox.xy + hs)) - (hs - uRadius);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
    cover = clamp(0.5 - d * uPixelRatio, 0.0, 1.0);
  }
  gl_FragColor = texture2D(uTex, vUv) * (uOpacity * cover);
}`;

interface Entry {
  layer: UICanvasLayer;
  wrapper: THREE.Texture;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  cap: {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    texture: THREE.CanvasTexture;
    mesh: THREE.Mesh;
  };
}

/** three.js 的貼圖物件包住一張自己的 GPU 貼圖（three.js 不會上傳、也不會刪除它） */
function injectTexture(renderer: THREE.WebGLRenderer, texture: THREE.Texture, gl: WebGLTexture): void {
  const props = renderer.properties.get(texture) as { __webglTexture?: WebGLTexture; __webglInit?: boolean };
  props.__webglTexture = gl;
  props.__webglInit = true;
}

/** 釋放包裝用的貼圖物件，但不刪除底下的 GPU 貼圖（那是 UICanvas 的） */
function releaseWrapper(renderer: THREE.WebGLRenderer, texture: THREE.Texture): void {
  const props = renderer.properties.get(texture) as { __webglInit?: boolean };
  props.__webglInit = undefined;
  texture.dispose();
}

function makeCanvas(): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1);
  return document.createElement('canvas');
}

export class UICanvasCompositor implements UICanvasHost {
  readonly gl: WebGL2RenderingContext;
  private readonly entries: Entry[] = [];
  private readonly painter: UIPainter;
  private readonly offDraw: () => void;
  private ui: UI2D | null = null;

  constructor(
    private readonly render3d: RenderPlugin,
    /** 介面圖層所在的場景（畫布四邊形加在這裡，跟著介面一起畫） */
    private readonly scene: THREE.Scene,
  ) {
    this.gl = render3d.renderer.getContext() as WebGL2RenderingContext;
    this.painter = new UIPainter((url) => this.ui?.imageSource(url));
    this.offDraw = render3d.onBeforeDraw(() => this.beforeDraw());
  }

  attach(ui: UI2D): void {
    this.ui = ui;
  }

  resetState(): void {
    this.render3d.renderer.resetState();
  }

  wrapTexture(texture: WebGLTexture, colorSpace: 'srgb' | 'none'): THREE.Texture {
    const t = new THREE.Texture();
    t.colorSpace = colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.flipY = false;
    injectTexture(this.render3d.renderer, t, texture);
    // 釋放時只拿掉包裝，不刪除 UICanvas 的 GPU 貼圖
    t.dispose = () => {
      const props = this.render3d.renderer.properties.get(t) as { __webglInit?: boolean };
      props.__webglInit = undefined;
      THREE.Texture.prototype.dispose.call(t);
    };
    return t;
  }

  add(layer: UICanvasLayer): () => void {
    const wrapper = new THREE.Texture();
    wrapper.generateMipmaps = false;
    wrapper.flipY = false;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTex: { value: wrapper },
        uBox: { value: new THREE.Vector4() },
        uClip: { value: new THREE.Vector4() },
        uRadius: { value: 0 },
        uOpacity: { value: 1 },
        uPixelRatio: { value: 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // 預乘 alpha
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    const capCanvas = makeCanvas();
    const capTexture = new THREE.CanvasTexture(capCanvas as HTMLCanvasElement);
    capTexture.colorSpace = THREE.SRGBColorSpace;
    capTexture.generateMipmaps = false;
    capTexture.minFilter = THREE.LinearFilter;
    const capMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: capTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    capMesh.frustumCulled = false;
    capMesh.visible = false;
    const entry: Entry = {
      layer,
      wrapper,
      mesh,
      material,
      cap: {
        canvas: capCanvas,
        ctx: capCanvas.getContext('2d') as CanvasRenderingContext2D,
        texture: capTexture,
        mesh: capMesh,
      },
    };
    this.entries.push(entry);
    this.scene.add(mesh, capMesh);
    this.updateOrder();
    // 蓋帽要等介面下次重畫：先要求重畫一次
    this.ui?.invalidate(layer.element);
    return () => this.remove(entry);
  }

  /** 介面重畫之後：更新每個畫布的蓋帽（只畫畫布那一塊） */
  afterUIRender(): void {
    const ui = this.ui;
    if (!ui?.root) return;
    for (const e of this.entries) {
      const view = this.view(e.layer.element);
      const cap = e.cap;
      if (!view) {
        cap.mesh.visible = false;
        continue;
      }
      const pr = ui.pixelRatio;
      const r = view.rect;
      const w = Math.max(1, Math.ceil(r.width * pr));
      const h = Math.max(1, Math.ceil(r.height * pr));
      if (cap.canvas.width !== w || cap.canvas.height !== h) {
        cap.canvas.width = w;
        cap.canvas.height = h;
        cap.texture.dispose(); // 尺寸改變：重新配置 GPU 貼圖
      }
      this.painter.paint(
        cap.ctx,
        ui.root,
        ui.size.width,
        ui.size.height,
        pr,
        {
          ...ui.paintState,
          paintAfter: e.layer.element,
          origin: { x: r.x, y: r.y },
        },
        r,
      );
      const empty = this.painter.paintedCount === 0;
      cap.mesh.visible = !empty;
      if (!empty) cap.texture.needsUpdate = true;
    }
  }

  dispose(): void {
    this.offDraw();
    for (const e of [...this.entries]) this.remove(e);
  }

  // ───────── 內部 ─────────

  private remove(entry: Entry): void {
    const i = this.entries.indexOf(entry);
    if (i === -1) return;
    this.entries.splice(i, 1);
    this.scene.remove(entry.mesh, entry.cap.mesh);
    entry.mesh.geometry.dispose();
    entry.material.dispose();
    (entry.cap.mesh.material as THREE.Material).dispose();
    entry.cap.texture.dispose();
    releaseWrapper(this.render3d.renderer, entry.wrapper);
    this.updateOrder();
  }

  /** 疊放順序：介面圖層（0）→ 每個畫布 → 它的蓋帽 */
  private updateOrder(): void {
    this.entries.forEach((e, i) => {
      e.mesh.renderOrder = 10 + i * 2;
      e.cap.mesh.renderOrder = 11 + i * 2;
    });
  }

  /**
   * 畫布目前顯示的樣子：位置、可以顯示的範圍（被捲動區裁切）、透明度。
   * 不在介面上、被隱藏、完全透明或完全被裁掉時回傳 null
   */
  private view(el: UIElement): { rect: Rect; clip: [number, number, number, number]; opacity: number } | null {
    const ui = this.ui;
    if (!ui?.root || el.isDestroyed) return null;
    let opacity = 1;
    let x0 = 0;
    let y0 = 0;
    let x1 = ui.size.width;
    let y1 = ui.size.height;
    let top: UIElement = el;
    for (let p: UIElement | null = el; p; p = p.parent) {
      if (!p.visible) return null;
      opacity *= num(p.attrs.opacity, 1) * Math.max(0, p.alpha);
      if (p !== el && p instanceof UIScrollView) {
        const r = p.absoluteRect;
        x0 = Math.max(x0, r.x);
        y0 = Math.max(y0, r.y);
        x1 = Math.min(x1, r.x + r.width);
        y1 = Math.min(y1, r.y + r.height);
      }
      top = p;
    }
    if (top !== ui.root || opacity <= 0.001) return null;
    const rect = el.absoluteRect;
    if (rect.width <= 0 || rect.height <= 0) return null;
    x0 = Math.max(x0, rect.x);
    y0 = Math.max(y0, rect.y);
    x1 = Math.min(x1, rect.x + rect.width);
    y1 = Math.min(y1, rect.y + rect.height);
    if (x1 <= x0 || y1 <= y0) return null;
    return { rect, clip: [x0, y0, x1, y1], opacity };
  }

  /** 每次繪製前：更新每個畫布四邊形的位置、裁切、透明度與貼圖 */
  private beforeDraw(): void {
    const ui = this.ui;
    if (!ui) return;
    const W = Math.max(1, ui.size.width);
    const H = Math.max(1, ui.size.height);
    for (const e of this.entries) {
      e.layer.beforeDraw?.();
      const view = this.view(e.layer.element);
      const tex = e.layer.texture();
      if (!view || !tex) {
        e.mesh.visible = false;
        e.cap.mesh.visible = false;
        continue;
      }
      injectTexture(this.render3d.renderer, e.wrapper, tex);
      const { rect, clip, opacity } = view;
      const u = e.material.uniforms;
      (u.uBox.value as THREE.Vector4).set(rect.x, rect.y, rect.width, rect.height);
      (u.uClip.value as THREE.Vector4).set(...clip);
      u.uRadius.value = Math.min(num(e.layer.element.attrs.radius, 0), rect.width / 2, rect.height / 2);
      u.uOpacity.value = opacity;
      u.uPixelRatio.value = ui.pixelRatio;
      // 介面座標（左上 0,0、y 向下）→ 正交攝影機的 -1～1（y 向上）
      for (const m of [e.mesh, e.cap.mesh]) {
        m.position.set(((rect.x + rect.width / 2) / W) * 2 - 1, 1 - ((rect.y + rect.height / 2) / H) * 2, 0);
        m.scale.set((rect.width / W) * 2, (rect.height / H) * 2, 1);
      }
      e.mesh.visible = true;
    }
  }
}
