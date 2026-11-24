/**
 * 著色器編輯器的預覽：用 three.js 的 WebGPURenderer 和引擎的 ShaderLibrary（和遊戲同一套，TSL 節點），
 * 節點圖轉成 shaderGraphDefinition 後建立材質，所以預覽看到的就是遊戲裡的樣子。
 *
 * - 主預覽：球體、立方體、圓環、平面 3D、平面 2D（滿版），拖曳旋轉、滾輪縮放
 * - 節點縮圖：共用一個離屏的 three.js 繪製器，每個節點畫一次滿版方塊，再複製到節點上的 2D 畫布
 * - 全螢幕效果的圖（Effect Output）：在平面 2D 上預覽效果套用在一張示範畫面（screenSample）上的樣子
 */
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { ShaderLibrary, type CustomMaterial, type EffectDefinition, type ShaderDefinition } from '../../shaders';
import {
  type ShaderGraphFile,
  ShaderGraphTextures,
  shaderGraphDefinition,
  shaderGraphEffectDefinition,
} from '../../shaders/graph';

/** 預覽網格 */
export type PreviewMesh = 'sphere' | 'cube' | 'torus' | 'plane' | 'quad';

/** 預覽網格的選項（選單用） */
export const PREVIEW_MESHES: readonly [PreviewMesh, string][] = [
  ['sphere', '球體'],
  ['cube', '立方體'],
  ['torus', '圓環'],
  ['plane', '平面 3D'],
  ['quad', '平面 2D'],
];

function geometry(mesh: PreviewMesh): THREE.BufferGeometry {
  switch (mesh) {
    case 'cube':
      return new THREE.BoxGeometry(1.5, 1.5, 1.5, 32, 32, 32);
    case 'torus':
      return new THREE.TorusGeometry(0.72, 0.32, 48, 128);
    case 'plane':
      return new THREE.PlaneGeometry(2, 2, 160, 160).rotateX(-Math.PI / 2); // 朝上，像地面
    case 'quad':
      return new THREE.PlaneGeometry(2, 2);
    default:
      return new THREE.SphereGeometry(1, 96, 64);
  }
}

/** 共用的著色器庫與貼圖（主預覽、縮圖都用） */
const library = new ShaderLibrary();
const textures = new ShaderGraphTextures();

let screen: THREE.Texture | null = null;
/**
 * 全螢幕效果預覽用的「畫面」：天空、太陽、山、房子、文字（顏色鮮明、有細節，看得出扭曲、模糊、調色的效果）。
 * 和遊戲裡效果拿到的畫面一樣是畫面上的顏色（不做色彩轉換）
 */
export function screenSample(): THREE.Texture {
  if (screen) return screen;
  const c = document.createElement('canvas');
  c.width = 960;
  c.height = 540;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 540);
  sky.addColorStop(0, '#2b5ea8');
  sky.addColorStop(0.55, '#f2a65a');
  sky.addColorStop(1, '#f6d58e');
  g.fillStyle = sky;
  g.fillRect(0, 0, 960, 540);
  g.fillStyle = '#fff3c4';
  g.beginPath();
  g.arc(690, 250, 70, 0, Math.PI * 2);
  g.fill();
  const hill = (color: string, base: number, amp: number, freq: number, phase: number) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, 540);
    for (let x = 0; x <= 960; x += 8)
      g.lineTo(x, base - Math.sin(x * freq + phase) * amp - Math.sin(x * freq * 2.7) * amp * 0.3);
    g.lineTo(960, 540);
    g.fill();
  };
  hill('#5b4a7a', 360, 60, 0.008, 1);
  hill('#2f5d50', 420, 40, 0.012, 3);
  hill('#1e3d2f', 470, 25, 0.02, 0);
  // 房子
  g.fillStyle = '#c94f3d';
  g.fillRect(200, 380, 120, 80);
  g.fillStyle = '#7a2e24';
  g.beginPath();
  g.moveTo(185, 385);
  g.lineTo(260, 330);
  g.lineTo(335, 385);
  g.fill();
  g.fillStyle = '#ffe9a8';
  g.fillRect(222, 400, 26, 26);
  g.fillRect(272, 400, 26, 26);
  // 文字與格線（看得出扭曲、像素化）
  g.fillStyle = '#ffffff';
  g.font = 'bold 72px system-ui, sans-serif';
  g.fillText('HERO ENGINE', 40, 110);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 1;
  for (let x = 0; x <= 960; x += 48) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, 540);
    g.stroke();
  }
  screen = new THREE.CanvasTexture(c);
  screen.colorSpace = THREE.NoColorSpace;
  screen.minFilter = THREE.LinearFilter;
  screen.generateMipmaps = false;
  return screen;
}

/** 預覽的時間（節點圖的 Time）：編輯器控制，暫停時停住 */
const previewTime = uniform(0);

/** 節點圖 → 自訂著色器的定義（用預覽共用的貼圖、時間） */
export const graphDefinition = (file: ShaderGraphFile, target?: { nodeId: number; port: string }) =>
  shaderGraphDefinition(file, target ? `thumb${target.nodeId}` : 'preview', {
    target,
    textures,
    screen: screenSample(),
    time: previewTime,
  });

/** 全螢幕效果的圖 → 遊戲裡用的效果定義（「程式碼」分頁顯示這份） */
export const graphEffectDefinition = (file: ShaderGraphFile, name = 'effect'): EffectDefinition =>
  shaderGraphEffectDefinition(file, name, { textures });

/** 每幀共用的狀態：時間、滑鼠 */
export interface PreviewState {
  time: number;
  mouse: THREE.Vector2;
}

/** 主預覽 */
export class MainPreview {
  readonly renderer: WebGPURenderer;
  /** WebGPURenderer 初始化完成（之前不繪製） */
  private ready = false;
  private readonly init: Promise<void>;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(43, 1, 0.1, 50);
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private readonly mesh: THREE.Mesh;
  private material: CustomMaterial | null = null;
  /** 攝影機：繞原點旋轉 */
  readonly cam = { yaw: 0.7, pitch: 0.35, dist: 3.4, auto: true };
  meshKind: PreviewMesh = 'sphere';

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.init = this.renderer.init().then(() => {
      this.ready = true;
    });
    this.mesh = new THREE.Mesh(geometry('sphere'));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    // 燈光：只有 Fragment Output 選「標準」光照的材質看得到；方向和節點圖的 uLightDir 預設值一樣
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.45, 0.75, 0.5);
    this.scene.add(sun, new THREE.HemisphereLight(0xdde8ff, 0x3a3226, 1.1));
    this.ortho.position.z = 1;
  }

  /** 換預覽網格 */
  setMesh(kind: PreviewMesh): void {
    if (kind === this.meshKind) return;
    this.meshKind = kind;
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry(kind);
  }

  /** 換成這份定義（graphDefinition 產生的）：回傳錯誤訊息（空字串代表成功） */
  setDefinition(def: ShaderDefinition): string {
    let next: CustomMaterial;
    try {
      next = library.createFromDefinition(def);
    } catch (error) {
      return (error as Error).message;
    }
    this.mesh.material = next;
    this.material?.dispose();
    this.material = next;
    return '';
  }

  /** 目前材質實際的著色器程式（three.js 產生的 WGSL；不支援 WebGPU 的瀏覽器是 GLSL） */
  async shaderCode(): Promise<{ vertexShader: string | null; fragmentShader: string | null } | null> {
    await this.init;
    if (!this.material) return null;
    const camera = this.meshKind === 'quad' ? this.ortho : this.camera;
    return this.renderer.debug.getShaderAsync(this.scene, camera, this.mesh);
  }

  /** 畫一幀 */
  render(state: PreviewState, dt: number): void {
    const canvas = this.canvas;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) this.renderer.setSize(w, h, false);
    previewTime.value = state.time;
    if (!this.ready) return;
    if (!this.material) {
      this.renderer.clear();
      return;
    }
    const u = this.material.uniforms;
    u.uMouse.value.copy(state.mouse);
    if (this.meshKind === 'quad') {
      u.uAspect.value = w / h;
      this.renderer.render(this.scene, this.ortho);
      return;
    }
    u.uAspect.value = 1;
    const cam = this.cam;
    if (cam.auto) cam.yaw += dt * 0.35;
    const cp = Math.cos(cam.pitch);
    this.camera.position.set(
      cam.dist * cp * Math.sin(cam.yaw),
      cam.dist * Math.sin(cam.pitch),
      cam.dist * cp * Math.cos(cam.yaw),
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
}

/** 節點縮圖的大小（像素） */
export const THUMB_PX = 160;

/** 節點縮圖：一個離屏繪製器畫所有節點 */
export class ThumbnailRenderer {
  private readonly renderer: WebGPURenderer;
  /** WebGPURenderer 初始化完成（之前不繪製） */
  private ready = false;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  private readonly materials = new Map<number, CustomMaterial>();

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = THUMB_PX;
    this.renderer = new WebGPURenderer({ canvas, antialias: false, alpha: true });
    this.renderer.setClearColor(0x000000, 1);
    void this.renderer.init().then(() => {
      this.ready = true;
    });
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.camera.position.z = 1;
  }

  /** 更新某個節點的縮圖材質（port 是要顯示的輸出）；編譯失敗時那個節點不顯示 */
  set(file: ShaderGraphFile, nodeId: number, port: string): void {
    this.remove(nodeId);
    try {
      const m = library.createFromDefinition(graphDefinition(file, { nodeId, port }));
      this.materials.set(nodeId, m);
    } catch {
      /* 這個節點目前無法預覽（例如上游有循環） */
    }
  }

  /** 移除某個節點的縮圖材質 */
  remove(nodeId: number): void {
    this.materials.get(nodeId)?.dispose();
    this.materials.delete(nodeId);
  }

  /** 只保留這些節點 */
  keep(ids: Set<number>): void {
    for (const id of [...this.materials.keys()]) if (!ids.has(id)) this.remove(id);
  }

  /** 畫一個節點的縮圖到 2D 畫布 */
  draw(nodeId: number, ctx: CanvasRenderingContext2D, state: PreviewState): void {
    const m = this.materials.get(nodeId);
    if (!m || !this.ready) {
      ctx.clearRect(0, 0, THUMB_PX, THUMB_PX);
      return;
    }
    m.uniforms.uMouse.value.copy(state.mouse);
    this.quad.material = m;
    this.renderer.render(this.scene, this.camera);
    ctx.clearRect(0, 0, THUMB_PX, THUMB_PX);
    ctx.drawImage(this.renderer.domElement, 0, 0);
  }
}
