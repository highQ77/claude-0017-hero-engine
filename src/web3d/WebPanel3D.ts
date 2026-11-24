import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { Entity, World } from '../ecs';
import { defineComponent } from '../ecs/Component';
import { SceneObject } from '../render/components';

/**
 * 3D 網頁面板：把真正的網頁（iframe 或一段 HTML）放在 3D 世界裡的平面上。
 * 和 UIPanel3D 不同，這是瀏覽器自己畫的網頁：CSS、表單、中文輸入法、捲動、影片都和一般網頁一樣。
 *
 * 做法：網頁在畫布「下面」的一層（three.js 的 CSS3DRenderer，用 CSS 3D 變換跟著攝影機），
 * 3D 畫面在網頁的位置挖一個透明的洞讓網頁露出來，所以前面的物體、2D 介面都會蓋在網頁上面。
 * 限制：網頁不受燈光、陰影、後製影響；網頁透明的地方看不到後面的 3D 物體；洞的邊緣沒有反鋸齒。
 *
 * @example
 * world.spawn(
 *   Transform.at(0, 1.5, 0),
 *   WebPanel3D.with({ src: 'pages/news.html', width: 1024, height: 640, worldWidth: 2.4 }),
 * );
 * // 直接給 HTML（和遊戲同一份文件，可以用程式操作裡面的元素）
 * world.spawn(Transform.at(2, 1.5, 0), WebPanel3D.with({ html: '<input placeholder="輸入名字">' }));
 */
export interface WebPanel3DData {
  /** 網頁網址：用 iframe 顯示（與 html 擇一；別的網站要允許被嵌入，很多網站不允許） */
  src: string;
  /** 直接給 HTML：放在面板的元素裡（和遊戲同一份文件，可以用程式操作、加事件） */
  html: string;
  /** 網頁的寬（CSS 像素：網頁用這個大小排版） */
  width: number;
  /** 網頁的高（CSS 像素） */
  height: number;
  /** 面板在世界中的寬度（高度依比例） */
  worldWidth: number;
  /** 可以用滑鼠操作網頁（false：只顯示，滑鼠照常操作遊戲） */
  interactive: boolean;
  /** 背面也看得到（看到的是左右相反的網頁；預設 false） */
  doubleSided: boolean;
  /** 網頁的背景色（CSS 顏色；預設白色。透明的網頁設 'transparent' 會露出畫布後面的頁面背景） */
  background: string;
  /** 由系統填寫：面板的外層元素（html 的內容放在這裡；載入前是 null） */
  element: HTMLDivElement | null;
  /** 由系統填寫：src 用的 iframe（沒有 src 時是 null） */
  iframe: HTMLIFrameElement | null;
}

/** 3D 網頁面板元件：把網頁（iframe 或 HTML）放在 3D 空間的平面上，可以直接操作 */
export const WebPanel3D = defineComponent<WebPanel3DData>('WebPanel3D', () => ({
  src: '',
  html: '',
  width: 1024,
  height: 768,
  worldWidth: 2,
  interactive: true,
  doubleSided: false,
  background: '#ffffff',
  element: null,
  iframe: null,
}));

/** 一個網頁面板的執行狀態 */
export interface WebPanelState {
  /** 面板的實體 */
  entity: Entity;
  /** 綁到實體上的群組（Transform 控制它） */
  group: THREE.Group;
  /** 挖洞的平面：把畫布寫成透明，露出下面的網頁 */
  hole: THREE.Mesh;
  /** CSS3D 物件（在網頁層的場景裡，每幀跟著 group 的位置） */
  css: CSS3DObject;
  /** 面板的外層元素 */
  element: HTMLDivElement;
  /** 目前的內容（換 src、html 時重建） */
  contentKey: string;
  /** 目前的大小設定（改變時重建平面） */
  shapeKey: string;
}

const contentKey = (p: WebPanel3DData) => `${p.src}\u0000${p.html}`;
const shapeKey = (p: WebPanel3DData) =>
  [p.width, p.height, p.worldWidth, p.doubleSided, p.background, p.interactive].join('|');

/** iframe 的權限：和 YouTube 嵌入碼相同（自動播放、加密影片、子母畫面、全螢幕、陀螺儀、分享…） */
const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share';

const _scale = new THREE.Matrix4();
const _view = new THREE.Matrix4();
const _corner = new THREE.Vector3();

/**
 * 網頁面板的建立、更新與釋放（不含繪製；繪製與滑鼠由 Web3DPlugin 處理）。
 */
export class WebPanel3DController {
  /** 所有面板的狀態 */
  readonly panels = new Map<Entity, WebPanelState>();
  /** 網頁層的場景（CSS3DRenderer 畫它） */
  readonly cssScene = new THREE.Scene();
  private readonly off: () => void;

  /**
   * @param world ECS 世界
   */
  constructor(private readonly world: World) {
    this.off = world.onRemove(WebPanel3D, (e) => this.release(e, true));
  }

  /** 每幀：建立新面板、套用設定變更 */
  update(): void {
    this.world.query([WebPanel3D]).each((e, data) => {
      let st = this.panels.get(e);
      if (!st) {
        st = this.create(e, data);
        this.panels.set(e, st);
      }
      if (st.contentKey !== contentKey(data)) this.setContent(st, data);
      if (st.shapeKey !== shapeKey(data)) this.reshape(st, data);
    });
  }

  /**
   * 繪製前：CSS3D 物件跟著面板在世界中的位置（含縮放：網頁的像素換成世界單位）。
   * 被隱藏的面板、或有一部分跑到攝影機後面的面板（CSS 的 3D 變換沒有近平面裁切，會畫成變形的細條），
   * 網頁和洞都暫時隱藏。
   * @param camera 目前的攝影機（判斷面板是不是跑到攝影機後面）
   */
  sync(camera?: THREE.Camera): void {
    if (camera) {
      camera.updateMatrixWorld();
      _view.copy(camera.matrixWorld).invert();
    }
    const near = (camera as THREE.PerspectiveCamera | undefined)?.near ?? 0;
    for (const st of this.panels.values()) {
      const data = this.world.get(st.entity, WebPanel3D);
      if (!data) continue;
      st.group.updateWorldMatrix(true, false);
      let visible = isShown(st.group);
      if (visible && camera) {
        // 四個角換到攝影機座標：z 要在近平面前面（攝影機看向 -z）
        const hw = data.worldWidth / 2;
        const hh = (data.worldWidth * data.height) / Math.max(1, data.width) / 2;
        for (const [x, y] of [
          [-hw, -hh],
          [hw, -hh],
          [hw, hh],
          [-hw, hh],
        ] as const) {
          _corner.set(x, y, 0).applyMatrix4(st.group.matrixWorld).applyMatrix4(_view);
          if (_corner.z > -near) {
            visible = false;
            break;
          }
        }
      }
      st.element.style.display = visible ? '' : 'none';
      st.hole.visible = visible;
      if (!visible) continue;
      const k = data.worldWidth / Math.max(1, data.width);
      st.css.matrix.copy(st.group.matrixWorld).multiply(_scale.makeScale(k, k, k));
    }
  }

  /**
   * 世界座標的射線打到的是不是某個面板的洞（給滑鼠判斷「滑鼠在網頁上」用）
   * @param object 射線打到的 three.js 物件
   */
  panelOfHole(object: THREE.Object3D): WebPanelState | null {
    const e = object.userData.webPanel3d as Entity | undefined;
    return e === undefined ? null : (this.panels.get(e) ?? null);
  }

  /** 移除所有面板 */
  dispose(): void {
    this.off();
    for (const e of [...this.panels.keys()]) this.release(e, false);
  }

  // ───────── 內部 ─────────

  private create(e: Entity, data: WebPanel3DData): WebPanelState {
    const group = new THREE.Group();
    // 洞：黑色、透明度 0、不混合（直接把畫布的顏色和 alpha 寫成 0）；寫入深度，後面的物體畫不上去，前面的照樣蓋住它
    const hole = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: false, blending: THREE.NoBlending }),
    );
    hole.userData.webPanel3d = e;
    group.add(hole);
    this.world.add(e, SceneObject).object = group;
    const element = document.createElement('div');
    element.className = 'hero-web-panel';
    // clip：不是捲動區域（hidden 的元素會被 iframe 的錨點連結捲走，見 Web3DPlugin）
    element.style.overflow = 'clip';
    element.addEventListener('scroll', () => element.scrollTo(0, 0));
    const css = new CSS3DObject(element);
    css.matrixAutoUpdate = false;
    this.cssScene.add(css);
    data.element = element;
    return { entity: e, group, hole, css, element, contentKey: '', shapeKey: '' };
  }

  /** 換內容：src 用 iframe，否則放 html */
  private setContent(st: WebPanelState, data: WebPanel3DData): void {
    st.contentKey = contentKey(data);
    st.element.replaceChildren();
    data.iframe = null;
    if (data.src) {
      const iframe = document.createElement('iframe');
      iframe.src = data.src;
      iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:transparent';
      // 和 YouTube 等影片網站的嵌入碼相同的權限（自動播放、加密影片、子母畫面、全螢幕…）
      iframe.allow = IFRAME_ALLOW;
      // 送出來源網站（YouTube 等嵌入的影片需要知道是哪個網站嵌入的，否則可能出現播放器設定錯誤）
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      st.element.appendChild(iframe);
      data.iframe = iframe;
    } else if (data.html) {
      st.element.innerHTML = data.html;
    }
  }

  /** 尺寸或外觀改變 */
  private reshape(st: WebPanelState, data: WebPanel3DData): void {
    st.shapeKey = shapeKey(data);
    const s = st.element.style;
    s.width = `${data.width}px`;
    s.height = `${data.height}px`;
    s.background = data.background;
    s.backfaceVisibility = data.doubleSided ? 'visible' : 'hidden';
    s.pointerEvents = data.interactive ? 'auto' : 'none';
    const worldHeight = (data.worldWidth * data.height) / Math.max(1, data.width);
    st.hole.geometry.dispose();
    st.hole.geometry = new THREE.PlaneGeometry(data.worldWidth, worldHeight);
    const material = st.hole.material as THREE.MeshBasicMaterial;
    material.side = data.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    material.needsUpdate = true;
  }

  private release(e: Entity, removing: boolean): void {
    const st = this.panels.get(e);
    if (!st) return;
    this.panels.delete(e);
    st.hole.geometry.dispose();
    (st.hole.material as THREE.Material).dispose();
    st.group.remove(st.hole);
    this.cssScene.remove(st.css);
    st.element.remove();
    if (!removing && this.world.has(e, SceneObject)) this.world.remove(e, SceneObject);
    const data = this.world.get(e, WebPanel3D);
    if (data) {
      data.element = null;
      data.iframe = null;
    }
  }
}

/** 物件和它所有的上層都是可見的（只看 group 和它的上層，不看洞自己的 visible） */
function isShown(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}
