import * as THREE from 'three';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import type { Entity, World } from '../ecs';
import { defineComponent } from '../ecs/Component';
import type { AssetManager } from '../assets/AssetManager';
import { SceneObject } from '../render/components';
import { createLogger } from '../core/Logger';

const log = createLogger('text3d');

/** 文字類型：extrude（有厚度的立體字）、flat（平面文字，可以用任何系統字型，中文也可以） */
export type Text3DMode = 'extrude' | 'flat';

/**
 * 3D 文字。
 * - extrude：立體文字（有厚度、受光照、可投影）。沒有指定 font 時使用內建字型（Helvetiker Bold，英文字母、數字、符號）；
 *   中文等其他文字請指定字型檔：.typeface.json 或 .ttf / .otf
 * - flat：平面文字（用畫布繪製），可以用任何系統字型（中文也沒問題），適合名牌、標示；
 *   billboard 為 true 時永遠面向攝影機
 *
 * 文字可以用 \n 換行。修改任何欄位都會自動重建。
 */
export interface Text3DData {
  /** 文字內容 */
  text: string;
  /** 文字類型（預設 extrude） */
  mode: Text3DMode;
  /** 文字高度（世界單位） */
  size: number;
  /** 顏色 */
  color: THREE.ColorRepresentation;
  /** 自發光強度（搭配光暈效果會發亮） */
  emissive: number;
  /** 水平對齊 */
  align: 'left' | 'center' | 'right';
  /** 垂直對齊：以文字的上緣、中間或下緣對準實體位置 */
  anchorY: 'top' | 'middle' | 'bottom';
  /** 行高倍率 */
  lineHeight: number;
  /** 自訂材質（不給就依 color 建立） */
  material: THREE.Material | null;
  /** 投射陰影 */
  castShadow: boolean;
  /** 接收陰影 */
  receiveShadow: boolean;

  // ── extrude ──
  /** 字型網址：.typeface.json、.ttf、.otf；空字串或 BUILTIN_FONT 為內建字型（Helvetiker Bold） */
  font: string;
  /** 厚度 */
  depth: number;
  /** 曲線的平滑程度（越大越圓滑） */
  curveSegments: number;
  /** 立體字的邊緣是否有斜角 */
  bevel: boolean;
  /** 斜角的大小 */
  bevelSize: number;
  /** 斜角的深度 */
  bevelThickness: number;

  // ── flat ──
  /** 平面文字的字體（例如 'sans-serif'、'Noto Sans TC'） */
  fontFamily: string;
  /** 平面文字的粗細（例如 'bold'） */
  fontWeight: string;
  /** 每個世界單位的像素數（越大越清晰） */
  resolution: number;
  /** 背景顏色（null 為透明） */
  background: string | null;
  /** 內距（相對於文字高度的比例） */
  padding: number;
  /** 永遠面向攝影機 */
  billboard: boolean;

  /** 由系統填寫 */
  status: 'idle' | 'loading' | 'ready' | 'error';
}

/** 內建字型的名稱（font 不填也是用它）：Helvetiker Bold，只有英文字母、數字與符號 */
export const BUILTIN_FONT = 'builtin:helvetiker-bold';

let builtinFont: Promise<Font> | null = null;
/** 載入內建字型（第一次使用時才下載，之後共用同一份） */
export function loadBuiltinFont(): Promise<Font> {
  builtinFont ??= Promise.all([
    import('./fonts/helvetiker_bold.typeface.json'),
    import('three/examples/jsm/loaders/FontLoader.js'),
  ]).then(([mod, { FontLoader }]) => {
    const data = ((mod as { default?: unknown }).default ?? mod) as Parameters<
      InstanceType<typeof FontLoader>['parse']
    >[0];
    return new FontLoader().parse(data);
  });
  builtinFont.catch(() => {
    builtinFont = null;
  }); // 失敗時下次再試
  return builtinFont;
}

/** 3D 文字元件 */
export const Text3D = defineComponent<Text3DData>('Text3D', () => ({
  text: '',
  mode: 'extrude',
  size: 1,
  color: 0xffffff,
  emissive: 0,
  align: 'center',
  anchorY: 'bottom',
  lineHeight: 1.2,
  material: null,
  castShadow: false,
  receiveShadow: false,
  font: '',
  depth: 0.2,
  curveSegments: 6,
  bevel: false,
  bevelSize: 0.02,
  bevelThickness: 0.03,
  fontFamily: 'system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif',
  fontWeight: 'bold',
  resolution: 128,
  background: null,
  padding: 0.15,
  billboard: false,
  status: 'idle',
}));

/** 建立畫布（瀏覽器用 DOM，測試可以替換） */
export type CanvasFactory = () => HTMLCanvasElement | OffscreenCanvas;

interface Tracked {
  /** 目前物件對應的設定（改變時重建） */
  key: string;
  object: THREE.Object3D | null;
  ownedMaterial: THREE.Material | null;
  texture: THREE.Texture | null;
  /** 正在使用的字型網址（用於參考計數） */
  fontUrl: string;
  fontType: 'font' | 'ttf' | null;
  font: Font | null;
  token: number;
}

/** 文字繪製設定的識別字串：任何影響外觀的欄位改變都會重建 */
function keyOf(t: Text3DData): string {
  const common = [
    t.mode,
    t.text,
    t.size,
    String(t.color),
    t.emissive,
    t.align,
    t.anchorY,
    t.lineHeight,
    t.material?.uuid ?? '',
  ];
  const specific =
    t.mode === 'extrude'
      ? [t.font, t.depth, t.curveSegments, t.bevel, t.bevelSize, t.bevelThickness]
      : [t.fontFamily, t.fontWeight, t.resolution, t.background ?? '', t.padding, t.billboard];
  return [...common, ...specific].join('|');
}

/**
 * 3D 文字的建立與更新。字型透過 AssetManager 載入（共用、參考計數）。
 */
export class Text3DController {
  private readonly tracked = new Map<Entity, Tracked>();
  private readonly results: (() => void)[] = [];
  private readonly off: () => void;
  private nextToken = 1;

  /**
   * @param world ECS 世界
   * @param assets 資源管理器（載入字型）
   * @param createCanvas 建立畫布的方式
   */
  constructor(
    private readonly world: World,
    private readonly assets: AssetManager | null,
    private readonly createCanvas: CanvasFactory = () =>
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas'),
  ) {
    this.off = world.onRemove(Text3D, (e) => this.release(e, true));
  }

  /** 更新所有 3D 文字（每幀由外掛呼叫） */
  update(): void {
    for (const apply of this.results.splice(0)) apply();
    this.world.query([Text3D]).each((e, t) => {
      let tr = this.tracked.get(e);
      if (!tr) {
        tr = {
          key: '',
          object: null,
          ownedMaterial: null,
          texture: null,
          fontUrl: '',
          fontType: null,
          font: null,
          token: 0,
        };
        this.tracked.set(e, tr);
      }
      if (t.mode === 'extrude') this.ensureFont(e, t, tr);
      else this.dropFont(tr);

      const key = keyOf(t);
      if (key === tr.key) return;
      if (t.mode === 'extrude' && !tr.font) {
        t.status = t.status === 'error' ? 'error' : 'loading';
        return;
      }
      tr.key = key;
      try {
        this.rebuild(e, t, tr);
        t.status = 'ready';
      } catch (error) {
        t.status = 'error';
        log.error(`3D 文字建立失敗（實體 ${e}）：`, error);
      }
    });
  }

  /** 移除所有 3D 文字 */
  dispose(): void {
    this.off();
    for (const e of [...this.tracked.keys()]) this.release(e, false);
    this.results.length = 0;
  }

  // ───────── 字型 ─────────

  private ensureFont(e: Entity, t: Text3DData, tr: Tracked): void {
    const url = t.font || BUILTIN_FONT; // 沒有指定字型：用內建的
    if (url === tr.fontUrl) return;
    this.dropFont(tr);
    tr.fontUrl = url;
    tr.key = ''; // 字型換了要重建
    const builtin = url === BUILTIN_FONT;
    if (!builtin && !this.assets) return;
    const type = /\.(ttf|otf)(\?|#|$)/i.test(url) ? 'ttf' : 'font';
    tr.fontType = builtin ? null : type; // 內建字型不經過資源管理（不用釋放）
    const token = (tr.token = this.nextToken++);
    t.status = 'loading';
    (builtin ? loadBuiltinFont() : (this.assets!.load(url, type) as Promise<Font>)).then(
      (font) =>
        this.results.push(() => {
          if (this.tracked.get(e) !== tr || tr.token !== token) return;
          tr.font = font;
          tr.key = '';
        }),
      (error: Error) =>
        this.results.push(() => {
          if (this.tracked.get(e) !== tr || tr.token !== token) return;
          const data = this.world.get(e, Text3D);
          if (data) data.status = 'error';
          log.error(error);
        }),
    );
  }

  private dropFont(tr: Tracked): void {
    if (tr.fontUrl && tr.fontType && this.assets) this.assets.release(tr.fontUrl, tr.fontType);
    tr.fontUrl = '';
    tr.fontType = null;
    tr.font = null;
    tr.token = 0;
  }

  // ───────── 建立物件 ─────────

  private rebuild(e: Entity, t: Text3DData, tr: Tracked): void {
    this.disposeObject(tr);
    const object = t.mode === 'extrude' ? this.buildExtruded(t, tr) : this.buildFlat(t, tr);
    object.castShadow = t.castShadow;
    object.receiveShadow = t.receiveShadow;
    tr.object = object;
    this.world.add(e, SceneObject).object = object;
  }

  private material(t: Text3DData, tr: Tracked, factory: () => THREE.Material): THREE.Material {
    if (t.material) return t.material;
    tr.ownedMaterial = factory();
    return tr.ownedMaterial;
  }

  private buildExtruded(t: Text3DData, tr: Tracked): THREE.Mesh {
    const geometry = new TextGeometry(t.text || ' ', {
      font: tr.font!,
      size: t.size,
      depth: t.depth,
      curveSegments: t.curveSegments,
      bevelEnabled: t.bevel,
      bevelSize: t.bevelSize,
      bevelThickness: t.bevelThickness,
    });
    // 對齊：依外框把文字移到正確位置；厚度往後（-Z）
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const x = t.align === 'left' ? -box.min.x : t.align === 'right' ? -box.max.x : -(box.min.x + box.max.x) / 2;
    const y = t.anchorY === 'bottom' ? -box.min.y : t.anchorY === 'top' ? -box.max.y : -(box.min.y + box.max.y) / 2;
    geometry.translate(x, y, -t.depth / 2);
    const color = new THREE.Color(t.color);
    const material = this.material(
      t,
      tr,
      () =>
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.4,
          metalness: 0.1,
          emissive: color,
          emissiveIntensity: t.emissive,
        }),
    );
    return new THREE.Mesh(geometry, material);
  }

  private buildFlat(t: Text3DData, tr: Tracked): THREE.Object3D {
    const lines = (t.text || ' ').split('\n');
    const px = t.resolution;
    const font = `${t.fontWeight} ${px}px ${t.fontFamily}`;
    const canvas = this.createCanvas();
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.font = font;
    const pad = Math.round(px * t.padding);
    const lineH = px * t.lineHeight;
    const widths = lines.map((l) => ctx.measureText(l).width);
    const w = Math.ceil(Math.max(1, ...widths) + pad * 2);
    const h = Math.ceil(lineH * lines.length + pad * 2);
    canvas.width = w;
    canvas.height = h;
    // 改尺寸會重設畫布狀態，重新設定
    ctx.font = font;
    ctx.textBaseline = 'middle';
    if (t.background) {
      ctx.fillStyle = t.background;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = `#${new THREE.Color(t.color).getHexString()}`;
    lines.forEach((line, i) => {
      const lw = widths[i];
      const x = t.align === 'left' ? pad : t.align === 'right' ? w - pad - lw : (w - lw) / 2;
      ctx.fillText(line, x, pad + lineH * (i + 0.5));
    });

    const texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    tr.texture = texture;

    // 世界尺寸：一行字高 = size
    const scale = t.size / px;
    const worldW = w * scale;
    const worldH = h * scale;
    const ax = t.align === 'left' ? 0 : t.align === 'right' ? 1 : 0.5;
    const ay = t.anchorY === 'bottom' ? 0 : t.anchorY === 'top' ? 1 : 0.5;
    const tint = new THREE.Color(1, 1, 1).multiplyScalar(1 + t.emissive);

    if (t.billboard) {
      const material = this.material(
        t,
        tr,
        () => new THREE.SpriteMaterial({ map: texture, transparent: true, color: tint, depthWrite: false }),
      );
      const sprite = new THREE.Sprite(material as THREE.SpriteMaterial);
      sprite.center.set(ax, ay);
      sprite.scale.set(worldW, worldH, 1);
      // 精靈的大小來自 scale，但 Transform 會蓋掉 matrix：包一層群組
      const group = new THREE.Group();
      group.add(sprite);
      return group;
    }
    const geometry = new THREE.PlaneGeometry(worldW, worldH);
    geometry.translate(worldW * (0.5 - ax), worldH * (0.5 - ay), 0);
    const material = this.material(
      t,
      tr,
      () =>
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          side: THREE.DoubleSide,
          color: tint,
          depthWrite: false,
        }),
    );
    return new THREE.Mesh(geometry, material);
  }

  // ───────── 釋放 ─────────

  private disposeObject(tr: Tracked): void {
    tr.object?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !(o instanceof THREE.Sprite)) mesh.geometry.dispose();
    });
    tr.ownedMaterial?.dispose();
    tr.texture?.dispose();
    tr.object = null;
    tr.ownedMaterial = null;
    tr.texture = null;
  }

  private release(e: Entity, removed: boolean): void {
    const tr = this.tracked.get(e);
    if (!tr) return;
    this.tracked.delete(e);
    const so = this.world.isAlive(e) ? this.world.get(e, SceneObject) : undefined;
    if (so && tr.object && so.object === tr.object) {
      if (removed) this.world.remove(e, SceneObject);
      else so.object = null;
    }
    this.disposeObject(tr);
    this.dropFont(tr);
  }
}
