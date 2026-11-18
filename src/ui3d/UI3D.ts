import * as THREE from 'three';
import type { Entity, World } from '../ecs';
import { defineComponent } from '../ecs/Component';
import { SceneObject } from '../render/components';
import { UI2D, UITextureRenderer, type UIHandler } from '../ui2d';
import { createLogger } from '../core/Logger';

const log = createLogger('ui3d');

/**
 * 3D 介面面板：把一份 UI2D 介面（同樣的 XML、同樣的元件）畫在 3D 世界裡的平面上。
 * 可以點擊、拖曳滑桿、捲動列表，就像 2D 介面一樣；會被前面的物體擋住。
 *
 * @example
 * world.spawn(
 *   Transform.with({ position: new Vector3(0, 2, -3) }),
 *   UIPanel3D.with({ src: 'ui/kiosk.xml', worldWidth: 2.4, handlers: { buy } }),
 * );
 * // 面板的像素尺寸用介面檔的 <UI width="480" height="320">；也可以在這裡用 width、height 指定（優先）
 * // 取得面板裡的元件
 * world.get(e, UIPanel3D)!.ui?.require<UILabel>('price').setText('$ 30');
 */
export interface UIPanel3DData {
  /** 介面檔網址（與 xml 擇一） */
  src: string;
  /** 直接給 XML 文字 */
  xml: string;
  /**
   * 介面的像素尺寸（排版用，等同 2D 介面的畫面大小）。
   * 0（預設）：用介面檔 <UI width="…" height="…"> 的數字；沒寫或 auto 時是 512 × 384。
   */
  width: number;
  /** 介面的高（像素；0 時用 XML 的 <UI height>） */
  height: number;
  /** 面板在世界中的寬度（高度依比例） */
  worldWidth: number;
  /** 貼圖解析度倍率：越大越清晰（預設 2） */
  resolution: number;
  /** 事件處理函式：XML 裡的 onClick="名稱" 會呼叫這裡同名的函式（再找外掛的共用處理函式） */
  handlers: Record<string, UIHandler>;
  /** 可以用滑鼠操作 */
  interactive: boolean;
  /** 永遠面向攝影機 */
  billboard: boolean;
  /** 背面也看得到 */
  doubleSided: boolean;
  /** 受場景光照影響（預設 false：顏色和 2D 介面一樣準確） */
  lit: boolean;
  /** 自發光強度（搭配光暈效果會發亮；lit 為 false 時是亮度倍率） */
  emissive: number;
  /** 不透明度（0~1） */
  opacity: number;
  /** 會被前面的物體遮住（false = 永遠畫在最上面） */
  depthTest: boolean;
  /** 由系統填寫 */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** 由系統填寫：面板裡的介面（載入完成後才有） */
  ui: UI2D | null;
}

/** 3D 介面面板元件：把 2D 介面（XML）畫在 3D 空間的平面上，可以直接點擊 */
export const UIPanel3D = defineComponent<UIPanel3DData>('UIPanel3D', () => ({
  src: '',
  xml: '',
  width: 0,
  height: 0,
  worldWidth: 2,
  resolution: 2,
  handlers: {},
  interactive: true,
  billboard: false,
  doubleSided: true,
  lit: false,
  emissive: 1,
  opacity: 1,
  depthTest: true,
  status: 'idle',
  ui: null,
}));

/** 一個面板的執行狀態 */
export interface PanelState {
  /** 面板的實體 */
  entity: Entity;
  /** 面板的介面（載入完成前是 null） */
  ui: UI2D | null;
  /** 面板的貼圖繪製器 */
  target: UITextureRenderer | null;
  /** 綁到實體上的群組（Transform 控制它） */
  group: THREE.Group;
  /** 真正的面片（billboard 時會轉向攝影機） */
  mesh: THREE.Mesh;
  /** 目前的內容來源（換 src 或 xml 時重新載入） */
  sourceKey: string;
  /** 目前的大小設定（改變時重建平面） */
  shapeKey: string;
  /** 載入的序號（換內容時舊的載入結果作廢） */
  token: number;
  /** 平面的寬（世界單位） */
  worldWidth: number;
  /** 平面的高（世界單位） */
  worldHeight: number;
  /** 實際使用的像素尺寸（UIPanel3D 的 width、height，或介面檔 <UI> 的寬高） */
  width: number;
  /** 介面的高（像素） */
  height: number;
  /** 介面檔 <UI> 上的固定寬高（載入後才知道） */
  xmlWidth?: number;
  /** XML 寫的高（<UI height>） */
  xmlHeight?: number;
}

/** 沒有指定尺寸、介面檔也沒寫固定寬高時的大小 */
export const DEFAULT_PANEL_SIZE = { width: 512, height: 384 } as const;

/** <UI> 的寬高屬性是固定數字時回傳數字（auto、百分比、沒寫都是 undefined） */
function fixedSize(value: string | undefined): number | undefined {
  return value !== undefined && /^\s*\d+(\.\d+)?\s*$/.test(value) && Number(value) > 0 ? Number(value) : undefined;
}

/** 面板的像素尺寸：元件上指定的優先，其次是介面檔 <UI> 的寬高 */
function panelSize(
  p: UIPanel3DData,
  st: Pick<PanelState, 'xmlWidth' | 'xmlHeight'>,
): { width: number; height: number } {
  return {
    width: p.width > 0 ? p.width : (st.xmlWidth ?? DEFAULT_PANEL_SIZE.width),
    height: p.height > 0 ? p.height : (st.xmlHeight ?? DEFAULT_PANEL_SIZE.height),
  };
}

const sourceKey = (p: UIPanel3DData) => `${p.src}\u0000${p.xml}`;
const shapeKey = (p: UIPanel3DData, st: PanelState) =>
  [
    panelSize(p, st).width,
    panelSize(p, st).height,
    p.worldWidth,
    p.resolution,
    p.doubleSided,
    p.lit,
    p.emissive,
    p.opacity,
    p.depthTest,
  ].join('|');

/** UI3DController 的設定 */
export interface UI3DControllerOptions {
  /** 所有面板共用的事件處理函式 */
  handlers?: Record<string, UIHandler>;
  /** WebGL 繪製器（局部上傳用；沒有時每次整張上傳） */
  gl?: () => THREE.WebGLRenderer | null;
  /** 面板畫面更新後呼叫（例如遊戲暫停時補畫一次） */
  onPanelRendered?: () => void;
  /** 建立介面（測試可替換） */
  createUI?: () => Promise<UI2D>;
}

/**
 * 面板的建立、更新與釋放。
 */
export class UI3DController {
  /** 所有面板的狀態 */
  readonly panels = new Map<Entity, PanelState>();
  private readonly results: (() => void)[] = [];
  private readonly off: () => void;
  private nextToken = 1;
  private readonly _q = new THREE.Quaternion();

  constructor(
    private readonly world: World,
    private readonly options: UI3DControllerOptions = {},
  ) {
    this.off = world.onRemove(UIPanel3D, (e) => this.release(e, true));
  }

  /** 每幀：處理載入結果、建立新面板、套用設定變更 */
  update(): void {
    for (const apply of this.results.splice(0)) apply();
    this.world.query([UIPanel3D]).each((e, data) => {
      let st = this.panels.get(e);
      if (!st) {
        st = this.create(e);
        this.panels.set(e, st);
      }
      if (st.sourceKey !== sourceKey(data)) this.reload(st, data);
      if (st.shapeKey !== shapeKey(data, st)) this.reshape(st, data);
      st.group.visible = data.status === 'ready';
    });
  }

  /**
   * 重新載入面板的介面（介面檔改了，例如編輯器收到 UI 編輯器的修改）。
   * match 給的話只重新載入 src 符合的面板；不給時全部重新載入。下一次 update 時生效。
   */
  reloadPanels(match?: (src: string) => boolean): void {
    for (const [e, st] of this.panels) {
      const data = this.world.get(e, UIPanel3D);
      if (data && (!match || (data.src !== '' && match(data.src)))) st.sourceKey = '';
    }
  }

  /** 每次繪製前：billboard 面板轉向攝影機 */
  faceCamera(camera: THREE.Camera | undefined): void {
    if (!camera) return;
    camera.getWorldQuaternion(this._q);
    for (const st of this.panels.values()) {
      const data = this.world.get(st.entity, UIPanel3D);
      if (!data?.billboard) {
        st.mesh.quaternion.identity();
        continue;
      }
      st.group.updateWorldMatrix(true, false);
      const parent = new THREE.Quaternion();
      st.group.getWorldQuaternion(parent);
      st.mesh.quaternion.copy(parent.invert().multiply(this._q));
    }
  }

  /** 移除所有面板 */
  dispose(): void {
    this.off();
    for (const e of [...this.panels.keys()]) this.release(e, false);
    this.results.length = 0;
  }

  // ───────── 內部 ─────────

  private create(e: Entity): PanelState {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    mesh.userData.ui3dPanel = e;
    group.add(mesh);
    group.visible = false;
    this.world.add(e, SceneObject).object = group;
    return {
      entity: e,
      ui: null,
      target: null,
      group,
      mesh,
      sourceKey: '',
      shapeKey: '',
      token: 0,
      worldWidth: 1,
      worldHeight: 1,
      ...DEFAULT_PANEL_SIZE,
    };
  }

  /** 尺寸或外觀設定改變：重建面片與材質 */
  private reshape(st: PanelState, data: UIPanel3DData): void {
    st.shapeKey = shapeKey(data, st);
    const size = panelSize(data, st);
    st.width = size.width;
    st.height = size.height;
    st.worldWidth = data.worldWidth;
    st.worldHeight = (data.worldWidth * size.height) / Math.max(1, size.width);
    st.mesh.geometry.dispose();
    st.mesh.geometry = new THREE.PlaneGeometry(st.worldWidth, st.worldHeight);
    this.applyMaterial(st, data);
    if (st.ui) {
      st.ui.pixelRatio = data.resolution;
      st.ui.resize(size.width, size.height);
    }
  }

  private applyMaterial(st: PanelState, data: UIPanel3DData): void {
    (st.mesh.material as THREE.Material).dispose();
    const common = {
      map: st.target?.texture ?? null,
      transparent: true,
      opacity: data.opacity,
      side: data.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      depthTest: data.depthTest,
      alphaTest: 0.01,
    };
    st.mesh.material = data.lit
      ? new THREE.MeshStandardMaterial({
          ...common,
          roughness: 0.8,
          emissive: 0xffffff,
          emissiveMap: st.target?.texture ?? null,
          emissiveIntensity: Math.max(0, data.emissive - 1),
        })
      : new THREE.MeshBasicMaterial({
          ...common,
          color: new THREE.Color(1, 1, 1).multiplyScalar(data.emissive),
          toneMapped: false,
        });
    // 永遠在最上面的面板最後畫
    st.mesh.renderOrder = data.depthTest ? 0 : 10;
  }

  /** 介面來源改變：重新建立 UI2D 並載入 */
  private reload(st: PanelState, data: UIPanel3DData): void {
    st.sourceKey = sourceKey(data);
    const token = (st.token = this.nextToken++);
    this.dropUI(st);
    data.ui = null;
    st.xmlWidth = st.xmlHeight = undefined; // 新的介面檔：載入後重新讀 <UI> 的寬高
    const size = panelSize(data, st);
    if (!data.src && !data.xml) {
      data.status = 'idle';
      return;
    }
    data.status = 'loading';
    // 處理函式：先找面板自己的，再找外掛共用的（隨時修改都會生效）。
    // UI2D 會複製傳入的物件，所以把查找接在它的原型上。
    const lookup = (name: string) =>
      this.world.get(st.entity, UIPanel3D)?.handlers[name] ?? this.options.handlers?.[name];
    const fallback = new Proxy({} as Record<string, UIHandler>, {
      get: (_t, name) => (typeof name === 'string' ? lookup(name) : undefined),
      has: (_t, name) => typeof name === 'string' && !!lookup(name),
    });
    const create =
      this.options.createUI ??
      (() =>
        UI2D.create({
          container: null,
          renderer: null,
          width: size.width,
          height: size.height,
          pixelRatio: data.resolution,
        }));
    const fail = (error: unknown) =>
      this.results.push(() => {
        if (st.token !== token) return;
        const d = this.world.get(st.entity, UIPanel3D);
        if (d) d.status = 'error';
        log.error(`3D 介面面板載入失敗（實體 ${st.entity}）：`, error);
      });
    create().then(async (ui) => {
      if (st.token !== token) {
        ui.destroy();
        return;
      }
      Object.setPrototypeOf(ui.handlers, fallback);
      try {
        ui.pixelRatio = data.resolution;
        ui.resize(size.width, size.height);
        if (data.src) await ui.load(data.src);
        else ui.loadString(data.xml);
      } catch (error) {
        ui.destroy();
        fail(error);
        return;
      }
      this.results.push(() => {
        if (st.token !== token || !this.panels.has(st.entity)) {
          ui.destroy();
          return;
        }
        const d = this.world.get(st.entity, UIPanel3D);
        if (!d) {
          ui.destroy();
          return;
        }
        st.ui = ui;
        st.target = new UITextureRenderer(this.options.gl ?? (() => null), () => this.options.onPanelRendered?.());
        ui.setRenderer(st.target);
        // 介面檔 <UI width height> 的固定尺寸（元件上沒指定時使用）
        st.xmlWidth = fixedSize(ui.root?.raw.width);
        st.xmlHeight = fixedSize(ui.root?.raw.height);
        this.reshape(st, d); // 面片比例、材質、介面尺寸，並立刻畫第一次
        d.ui = ui;
        d.status = 'ready';
        st.group.visible = true;
      });
    }, fail);
  }

  private dropUI(st: PanelState): void {
    st.ui?.destroy(); // 也會釋放 target
    st.ui = null;
    st.target = null;
  }

  private release(e: Entity, removed: boolean): void {
    const st = this.panels.get(e);
    if (!st) return;
    this.panels.delete(e);
    st.token = 0;
    this.dropUI(st);
    st.mesh.geometry.dispose();
    (st.mesh.material as THREE.Material).dispose();
    const so = this.world.isAlive(e) ? this.world.get(e, SceneObject) : undefined;
    if (so && so.object === st.group) {
      if (removed) this.world.remove(e, SceneObject);
      else so.object = null;
    }
  }
}
